import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pdfParse from "pdf-parse";

const __filename=fileURLToPath(import.meta.url),__dirname=path.dirname(__filename),app=express();
app.use(express.json({limit:"5mb"}));
app.use(express.static(__dirname));
const PORT=process.env.PORT||3000;
const FIFA_PDF="https://fdp.fifa.org/assetspublic/ce281/pdf/SquadLists-English.pdf";

const NAME_MAP={
 "Algeria":"Algeria","Argentina":"Argentina","Australia":"Australia","Austria":"Austria","Belgium":"Belgium","Bosnia And Herzegovina":"Bosnia","Brazil":"Brazil","Canada":"Canada","Congo DR":"DRC","Côte D'Ivoire":"Ivory Coast","Cote D'Ivoire":"Ivory Coast","Croatia":"Croatia","Curaçao":"Curacao","Curacao":"Curacao","Czechia":"Czechia","Ecuador":"Ecuador","Egypt":"Egypt","England":"England","France":"France","Germany":"Germany","Ghana":"Ghana","Haiti":"Haiti","Iran":"Iran","Iraq":"Iraq","Japan":"Japan","Jordan":"Jordan","Korea Republic":"South Korea","Mexico":"Mexico","Morocco":"Morocco","Netherlands":"Netherlands","New Zealand":"New Zealand","Norway":"Norway","Panama":"Panama","Paraguay":"Paraguay","Portugal":"Portugal","Qatar":"Qatar","Saudi Arabia":"Saudi Arabia","Scotland":"Scotland","Senegal":"Senegal","South Africa":"South Africa","Spain":"Spain","Sweden":"Sweden","Switzerland":"Switzerland","Tunisia":"Tunisia","Türkiye":"Turkiye","Turkey":"Turkiye","United States":"USA","USA":"USA","Uruguay":"Uruguay","Uzbekistan":"Uzbekistan","Cape Verde":"Cape Verde"
};

function roleMap(pos){return pos==="GK"?"POR":pos==="DF"?"DIF":pos==="MF"?"CEN":pos==="FW"?"ATT":"UNK";}
function estimateValue(pos,caps,goals){
  let base=pos==="FW"?20:pos==="MF"?15:pos==="DF"?11:9;
  return Math.round((base+Math.min(caps||0,120)*0.18+(goals||0)*1.05)*10)/10;
}
function estimateBonus(pos,caps,goals){
  let base=pos==="FW"?70:pos==="MF"?66:pos==="DF"?62:60;
  return Math.max(45,Math.min(98,Math.round(base+Math.min(caps||0,120)*0.12+(goals||0)*0.45)));
}
function clean(s){return (s||"").replace(/\s+/g," ").trim();}
function normalizeTeam(raw){return NAME_MAP[clean(raw)]||clean(raw);}

function buildPlayer({team,pos,surname,first,dob,club,height,caps,goals}){
  const cleanSurname=clean(surname).replace(/\s+/g," ");
  const cleanFirst=clean(first).replace(/\s+/g," ");
  let display = clean(`${cleanFirst.split(" ")[0]||""} ${cleanSurname.split(" ")[0]||cleanSurname}`);
  if(!display || display.length<3) display=clean(`${cleanSurname} ${cleanFirst}`);
  const role=roleMap(pos);
  return {
    team,
    name:display,
    role,
    status:"Panchina",
    probableXI:false,
    valueM:estimateValue(pos,caps,goals),
    bonus:estimateBonus(pos,caps,goals),
    yellow:pos==="DF"?32:pos==="MF"?28:12,
    sub:pos==="FW"?55:pos==="MF"?48:18,
    setPieces:"",
    club:clean(club),
    height:Number(height)||0,
    caps:Number(caps)||0,
    goals:Number(goals)||0,
    dob,
    source:"FIFA official squad list"
  };
}

function parseSectionRegex(section, team){
  const players=[];
  // Remove obvious repeated headers but keep table rows.
  let text=section
    .replace(/# POS PLAYER NAME FIRST NAME\(S\) LAST NAME\(S\) NAME ON SHIRT DOB CLUB HEIGHT \(CM\) CAPS GOALS/g," ")
    .replace(/DOB Date of birth POS Position GK Goalkeeper DF Defender MF Midfielder FW Forward/g," ")
    .replace(/Head coach[\s\S]*?(?=(?:GK|DF|MF|FW)\s+[A-ZÀ-ÖØ-Ý])/g," ");

  // Main pattern: POS + uppercase surname block + first names until DOB + club + 3 numeric fields.
  const row = /\b(GK|DF|MF|FW)\s+([A-ZÀ-ÖØ-Ý'’.\- ]{2,40}?)\s+([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÿ'’.\- ]{1,80}?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(\d{3})\s+(\d{1,3})\s+(\d{1,3})(?=\s+(?:GK|DF|MF|FW)\s+[A-ZÀ-ÖØ-Ý]|\s+Head coach|\s+DOB Date|\s+FIFA World Cup|\s+Thursday|\s*$)/gs;
  let m;
  while((m=row.exec(text))){
    const [_,pos,surname,firstAndExtra,dob,club,height,caps,goals]=m;
    // firstAndExtra contains "FIRST NAME(S) LAST NAME(S) NAME ON SHIRT" in many rows.
    // For display, using first token + surname is usually enough and stable.
    const p=buildPlayer({team,pos,surname,first:firstAndExtra,dob,club,height,caps:Number(caps),goals:Number(goals)});
    if(p.name && !players.some(x=>x.name===p.name && x.team===p.team)) players.push(p);
  }
  return players;
}

function parseSectionLineFallback(section, team){
  const players=[];
  const lines=section.split(/\n/).map(clean).filter(Boolean);
  for(const line of lines){
    if(!/^(GK|DF|MF|FW)\s/.test(line)) continue;
    const dob=line.match(/\d{2}\/\d{2}\/\d{4}/);
    if(!dob) continue;
    const pos=line.slice(0,2);
    const before=clean(line.slice(2,dob.index));
    const after=clean(line.slice(dob.index+10));
    const nums=after.match(/(.+?)\s+(\d{3})\s+(\d{1,3})\s+(\d{1,3})$/);
    if(!nums) continue;
    const tokens=before.split(/\s+/);
    const surname=[];
    while(tokens.length && /^[A-ZÀ-ÖØ-Ý'’.\-]+$/.test(tokens[0])) surname.push(tokens.shift());
    const first=tokens.join(" ");
    const p=buildPlayer({team,pos,surname:surname.join(" "),first,dob:dob[0],club:nums[1],height:nums[2],caps:Number(nums[3]),goals:Number(nums[4])});
    if(p.name && !players.some(x=>x.name===p.name && x.team===p.team)) players.push(p);
  }
  return players;
}

function parseSquads(text){
  const players=[];
  const normalized=text.replace(/\r/g,"\n").replace(/\u00a0/g," ");
  const squadRe=/SQUAD LIST\s*([A-Za-zÀ-ÿ'’ .-]+?)\s*\(([A-Z]{3})\)/g;
  const starts=[];
  let sm;
  while((sm=squadRe.exec(normalized))){
    starts.push({index:sm.index, raw:sm[1], code:sm[2]});
  }
  for(let i=0;i<starts.length;i++){
    const start=starts[i], end=starts[i+1]?.index ?? normalized.length;
    const team=normalizeTeam(start.raw);
    const section=normalized.slice(start.index,end);
    let ps=parseSectionRegex(section,team);
    if(ps.length<10) ps=[...ps, ...parseSectionLineFallback(section,team)];
    // de-dupe
    const seen=new Set();
    ps=ps.filter(p=>{
      const k=p.team+"|"+p.name;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    });
    players.push(...ps);
  }

  const byTeam={};
  for(const p of players){(byTeam[p.team] ||= []).push(p);}
  for(const [team, ps] of Object.entries(byTeam)){
    const order={POR:0,DIF:1,CEN:2,ATT:3,UNK:4};
    ps.sort((a,b)=>order[a.role]-order[b.role] || b.caps-a.caps || b.bonus-a.bonus);
    // Probable XI: 1 GK, top 4 defenders, top 3 mids, top 3 attackers if available.
    const xi=[];
    const take=(role,n)=>ps.filter(p=>p.role===role).slice(0,n).forEach(p=>xi.push(p));
    take("POR",1); take("DIF",4); take("CEN",3); take("ATT",3);
    if(xi.length<11) ps.filter(p=>!xi.includes(p)).slice(0,11-xi.length).forEach(p=>xi.push(p));
    xi.forEach(p=>{p.status="Titolare";p.probableXI=true;});
  }
  return players;
}

app.get("/",(_,res)=>res.sendFile(path.join(__dirname,"index.html")));

app.get("/api/import-official-squads",async(_,res)=>{
  try{
    const r=await fetch(FIFA_PDF,{headers:{"User-Agent":"Mozilla/5.0"}});
    if(!r.ok) return res.json({ok:false,error:`FIFA PDF non raggiungibile: HTTP ${r.status}`});
    const buf=Buffer.from(await r.arrayBuffer());
    const parsed=await pdfParse(buf);
    const players=parseSquads(parsed.text || "");
    const teams=new Set(players.map(p=>p.team)).size;
    if(players.length<900) {
      return res.json({
        ok:false,
        error:`Parsing incompleto: trovati ${players.length} giocatori su ${teams} squadre. Il formato PDF è diverso dal previsto.`,
        debug:{textLength:(parsed.text||"").length, teams}
      });
    }
    res.json({ok:true,source:FIFA_PDF,players,teams});
  }catch(e){res.json({ok:false,error:e.message});}
});

app.listen(PORT,()=>console.log("FG World Cup AI V5.1 on "+PORT));
