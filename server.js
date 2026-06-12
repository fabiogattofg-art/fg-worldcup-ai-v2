import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

function normalizeForMatch(s){
  return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
}
function clean(s){return (s||"").replace(/\s+/g," ").trim();}

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/api/import-official-squads", (_, res) => {
  try {
    const players = JSON.parse(fs.readFileSync(path.join(__dirname, "official_players.json"), "utf8"));
    const teams = new Set(players.map(p => p.team)).size;
    res.json({ ok:true, source:"Local embedded FIFA official squad list", extraction:"local-json", players, teams });
  } catch(e) { res.json({ ok:false, error:e.message }); }
});

function findWindows(text){
  const signals = ["confirmed lineups","lineups","starting xi","starting lineups","formazioni ufficiali","formazioni","titolari","official lineups","probable lineups"];
  const low = text.toLowerCase();
  const windows=[];
  for(const sig of signals){
    let idx = low.indexOf(sig);
    while(idx >= 0){
      windows.push({sig, start:Math.max(0,idx-1500), end:Math.min(text.length,idx+9000)});
      idx = low.indexOf(sig, idx+sig.length);
    }
  }
  // prefer official/confirmed over probable
  windows.sort((a,b)=>{
    const score=w=>/confirmed|official|ufficial/i.test(w.sig)?0:/probable/i.test(w.sig)?2:1;
    return score(a)-score(b) || a.start-b.start;
  });
  return windows.slice(0,12).map(w=>text.slice(w.start,w.end));
}

function classifyKnownPlayers(text, knownPlayers, home, away){
  const windows=findWindows(text);
  if(!windows.length) return {players:[], reason:"nessun blocco lineups/formazioni"};
  let best={players:[], score:0, reason:""};

  for(const win of windows){
    const nwin=normalizeForMatch(win);
    const found=[];
    for(const p of knownPlayers||[]){
      const key=normalizeForMatch(p.name);
      if(!key || key.length<4) continue;
      const idx=nwin.indexOf(key);
      if(idx>=0 && !found.some(x=>x.name===p.name && x.team===p.team)) found.push({...p, idx});
    }
    const byTeam={};
    for(const team of [home,away]) byTeam[team]=found.filter(p=>p.team===team).sort((a,b)=>a.idx-b.idx);
    const counts=[byTeam[home].length, byTeam[away].length];
    const officialSignal=/confirmed lineups|official lineups|formazioni ufficiali|starting xi|starting lineups|titolari/i.test(win);
    const score=Math.min(counts[0],11)+Math.min(counts[1],11)+(officialSignal?6:0)-(/probable/i.test(win)?4:0);
    if(score>best.score){
      const result=[];
      for(const team of [home,away]){
        const rows=byTeam[team];
        // If a substitutes marker appears, classify names after it as bench. Otherwise first 11 are starters.
        const markerIdx = Math.min(...["substitutes","bench","panchina","riserve"].map(s=>normalizeForMatch(win).indexOf(normalizeForMatch(s))).filter(i=>i>=0));
        rows.forEach((p,i)=>{
          let status="Panchina";
          if(Number.isFinite(markerIdx) && markerIdx>=0){
            status = p.idx < markerIdx ? "Titolare" : "Panchina";
          }else{
            status = i<11 ? "Titolare" : "Panchina";
          }
          // absent marker nearby
          const rawApprox = Math.max(0, Math.floor(p.idx * win.length / Math.max(1,nwin.length))-300);
          const ctx = win.slice(rawApprox, rawApprox+900).toLowerCase();
          if(/injured|suspended|absent|doubtful|indisponibile|squalificato|infortunato|fuori/i.test(ctx)) status="Fuori";
          result.push({name:p.name,team:p.team,role:p.role,status});
        });
      }
      best={players:result, score, reason:officialSignal?"official window":"lineup window"};
    }
  }
  return best;
}

async function fetchText(url){
  try{
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/plain"}});
    if(!r.ok) return "";
    return await r.text();
  }catch(e){return "";}
}

async function getCandidateText(home,away){
  const q1=encodeURIComponent(`${home} ${away} confirmed lineups`);
  const q2=encodeURIComponent(`${home} ${away} formazioni ufficiali`);
  const q3=encodeURIComponent(`${home} ${away} starting xi`);
  const urls=[
    `https://r.jina.ai/http://www.google.com/search?q=${q1}`,
    `https://r.jina.ai/http://www.google.com/search?q=${q2}`,
    `https://r.jina.ai/http://www.bing.com/search?q=${q1}`,
    `https://r.jina.ai/http://www.bing.com/search?q=${q3}`,
    `https://r.jina.ai/http://www.sofascore.com/search/all?q=${encodeURIComponent(home+" "+away)}`,
    `https://r.jina.ai/http://www.diretta.it/cerca/?q=${encodeURIComponent(home+" "+away)}`,
    `https://r.jina.ai/http://www.flashscore.com/search/?q=${encodeURIComponent(home+" "+away)}`
  ];
  let text="";
  for(const url of urls){
    const t=await fetchText(url);
    if(t) text += `\n\nSOURCE: ${url}\n${t.slice(0,80000)}`;
  }
  return text;
}

app.post("/api/find-official-lineups", async (req, res) => {
  const {home, away, knownPlayers} = req.body || {};
  if(!home || !away) return res.json({ok:false,error:"Squadre mancanti"});
  try{
    const text=await getCandidateText(home,away);
    if(!text || text.length<500) return res.json({ok:false,error:"Nessuna fonte leggibile",source:"Official lineup checker"});
    const parsed=classifyKnownPlayers(text,knownPlayers||[],home,away);
    const players=parsed.players||[];
    const homeXI=players.filter(p=>p.team===home&&p.status==="Titolare").length;
    const awayXI=players.filter(p=>p.team===away&&p.status==="Titolare").length;
    const homeKnown=players.filter(p=>p.team===home).length;
    const awayKnown=players.filter(p=>p.team===away).length;
    if(homeXI<10 || awayXI<10){
      return res.json({ok:false,error:`Ufficiali non affidabili: titolari ${homeXI}/${awayXI}, nomi ${homeKnown}/${awayKnown}.`,source:"Official lineup checker",debug:{reason:parsed.reason,homeXI,awayXI,homeKnown,awayKnown}});
    }
    res.json({ok:true,source:"Official lineup checker",players,confidence:"high",counts:{homeXI,awayXI,homeKnown,awayKnown},reason:parsed.reason});
  }catch(e){res.json({ok:false,error:e.message,source:"Official lineup checker"});}
});

app.listen(PORT, () => console.log("FG World Cup AI V5.7 lineups dynamic on " + PORT));
