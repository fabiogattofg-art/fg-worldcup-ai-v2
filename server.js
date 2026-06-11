import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pdf from "pdf-parse/lib/pdf-parse.js";

const __filename=fileURLToPath(import.meta.url),__dirname=path.dirname(__filename),app=express();
app.use(express.json({limit:"5mb"}));
app.use(express.static(__dirname));
const PORT=process.env.PORT||3000;
const FIFA_PDF="https://fdp.fifa.org/assetspublic/ce281/pdf/SquadLists-English.pdf";

const NAME_MAP={
 "Algeria":"Algeria","Argentina":"Argentina","Australia":"Australia","Austria":"Austria","Belgium":"Belgium","Bosnia And Herzegovina":"Bosnia","Brazil":"Brazil","Canada":"Canada","Congo DR":"DRC","Côte D'Ivoire":"Ivory Coast","Croatia":"Croatia","Curaçao":"Curacao","Czechia":"Czechia","Ecuador":"Ecuador","Egypt":"Egypt","England":"England","France":"France","Germany":"Germany","Ghana":"Ghana","Haiti":"Haiti","Iran":"Iran","Iraq":"Iraq","Japan":"Japan","Jordan":"Jordan","Korea Republic":"South Korea","Mexico":"Mexico","Morocco":"Morocco","Netherlands":"Netherlands","New Zealand":"New Zealand","Norway":"Norway","Panama":"Panama","Paraguay":"Paraguay","Portugal":"Portugal","Qatar":"Qatar","Saudi Arabia":"Saudi Arabia","Scotland":"Scotland","Senegal":"Senegal","South Africa":"South Africa","Spain":"Spain","Sweden":"Sweden","Switzerland":"Switzerland","Tunisia":"Tunisia","Türkiye":"Turkiye","Turkey":"Turkiye","United States":"USA","USA":"USA","Uruguay":"Uruguay","Uzbekistan":"Uzbekistan","Cape Verde":"Cape Verde","Curacao":"Curacao"
};

function roleMap(pos){return pos==="GK"?"POR":pos==="DF"?"DIF":pos==="MF"?"CEN":pos==="FW"?"ATT":"UNK";}
function estimateValue(pos,caps,goals){let base=pos==="FW"?18:pos==="MF"?14:pos==="DF"?10:8;return Math.round((base+Math.min(caps,100)*0.18+goals*1.1)*10)/10;}
function estimateBonus(pos,caps,goals){let base=pos==="FW"?70:pos==="MF"?66:pos==="DF"?62:60;return Math.max(45,Math.min(98,Math.round(base+Math.min(caps,100)*0.12+goals*0.45)));}
function parsePlayerLine(line,team){
  line=line.replace(/\s+/g," ").trim();
  if(!/^(GK|DF|MF|FW)\s/.test(line)) return null;
  const dob=line.match(/\d{2}\/\d{2}\/\d{4}/);
  if(!dob) return null;
  const before=line.slice(0,dob.index).trim();
  const after=line.slice(dob.index+10).trim();
  const parts=before.split(" ");
  const pos=parts.shift();
  if(parts.length<2) return null;
  const rawName=parts.slice(0,2).join(" ");
  const clubMatch=after.match(/(.+?)\s+(\d{2,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  let club="",height=0,caps=0,goals=0;
  if(clubMatch){club=clubMatch[1].trim();height=Number(clubMatch[2]);caps=Number(clubMatch[3]);goals=Number(clubMatch[4]);}
  const role=roleMap(pos);
  return {team,name:rawName,role,status:"Panchina",probableXI:false,valueM:estimateValue(pos,caps,goals),bonus:estimateBonus(pos,caps,goals),yellow:pos==="DF"?32:pos==="MF"?28:12,sub:pos==="FW"?55:pos==="MF"?48:18,setPieces:"",club,height,caps,goals,source:"FIFA official squad list"};
}
function parseSquads(text){
  const lines=text.split(/\n/).map(x=>x.trim()).filter(Boolean);
  let team=null, players=[];
  for(const line of lines){
    const squad=line.match(/SQUAD LIST\s*([A-Za-zÀ-ÿ' .]+)\s*\(([A-Z]{3})\)/);
    if(squad){
      const raw=squad[1].trim();
      team=NAME_MAP[raw]||raw;
      continue;
    }
    const p=team?parsePlayerLine(line,team):null;
    if(p) players.push(p);
  }
  const byTeam={};
  for(const p of players){
    if(!byTeam[p.team]) byTeam[p.team]=[];
    byTeam[p.team].push(p);
  }
  for(const [t,ps] of Object.entries(byTeam)){
    const sorted=[...ps].sort((a,b)=>{
      const order={POR:0,DIF:1,CEN:2,ATT:3};
      return order[a.role]-order[b.role] || b.caps-a.caps || b.bonus-a.bonus;
    });
    sorted.slice(0,11).forEach(p=>{p.status="Titolare";p.probableXI=true;});
  }
  return players;
}
app.get("/",(_,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/api/import-official-squads",async(_,res)=>{
  try{
    const r=await fetch(FIFA_PDF,{headers:{"User-Agent":"Mozilla/5.0"}});
    if(!r.ok) return res.json({ok:false,error:`FIFA PDF non raggiungibile: HTTP ${r.status}`});
    const buf=Buffer.from(await r.arrayBuffer());
    const parsed=await pdf(buf);
    const players=parseSquads(parsed.text);
    if(players.length<500) return res.json({ok:false,error:`Parsing incompleto: trovati solo ${players.length} giocatori`});
    const teams=new Set(players.map(p=>p.team)).size;
    res.json({ok:true,source:FIFA_PDF,players,teams});
  }catch(e){res.json({ok:false,error:e.message});}
});
app.listen(PORT,()=>console.log("FG World Cup AI V5 on "+PORT));
