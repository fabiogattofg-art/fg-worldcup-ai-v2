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

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/api/import-official-squads", (_, res) => {
  try {
    const players = JSON.parse(fs.readFileSync(path.join(__dirname, "official_players.json"), "utf8"));
    const teams = new Set(players.map(p => p.team)).size;
    res.json({ ok:true, source:"Local embedded FIFA official squad list", extraction:"local-json", players, teams });
  } catch(e) {
    res.json({ ok:false, error:e.message });
  }
});

function findKnownInText(text, knownPlayers, home, away){
  const normalizedText = normalizeForMatch(text);
  const found = [];
  for (const p of knownPlayers || []) {
    const key = normalizeForMatch(p.name);
    if(!key || key.length < 4) continue;
    const idx = normalizedText.indexOf(key);
    if(idx >= 0 && !found.some(x => x.name === p.name && x.team === p.team)) found.push({...p, idx});
  }
  const result = [];
  for (const team of [home, away]) {
    const teamRows = found.filter(p => p.team === team).sort((a,b)=>a.idx-b.idx);
    // Safe rule: first 11 known names in the lineup-like text are starters; rest bench.
    teamRows.forEach((p,i)=> result.push({ name:p.name, team:p.team, role:p.role, status:i<11 ? "Titolare" : "Panchina" }));
  }
  return result;
}

async function getCandidateText(home, away){
  const queries = [
    `https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(home+" "+away+" lineups")}`,
    `https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(home+" "+away+" formazioni ufficiali")}`,
    `https://r.jina.ai/http://www.bing.com/search?q=${encodeURIComponent(home+" "+away+" lineups")}`,
    `https://r.jina.ai/http://www.bing.com/search?q=${encodeURIComponent(home+" "+away+" formazioni ufficiali")}`
  ];
  let text="";
  for(const url of queries){
    try{
      const r = await fetch(url, { headers:{"User-Agent":"Mozilla/5.0","Accept":"text/plain"} });
      if(r.ok) text += "\n\nSOURCE: "+url+"\n"+(await r.text()).slice(0,60000);
    }catch(e){}
  }
  return text;
}

app.post("/api/find-official-lineups", async (req, res) => {
  const {home, away, knownPlayers} = req.body || {};
  if(!home || !away) return res.json({ok:false,error:"Squadre mancanti"});
  try{
    const text = await getCandidateText(home, away);
    if(!text || text.length < 500) return res.json({ok:false,error:"Nessuna fonte lineup leggibile",source:"Jina search"});
    const players = findKnownInText(text, knownPlayers || [], home, away);
    const homeXI = players.filter(p=>p.team===home && p.status==="Titolare").length;
    const awayXI = players.filter(p=>p.team===away && p.status==="Titolare").length;
    if(homeXI < 8 || awayXI < 8) return res.json({ok:false,error:`Formazioni non affidabili: trovati ${homeXI}/${awayXI} titolari.`,source:"Official lineup checker",debug:{homeXI,awayXI,found:players.length}});
    res.json({ok:true,source:"Official lineup checker",players,confidence:homeXI>=10&&awayXI>=10?"high":"medium",counts:{homeXI,awayXI,total:players.length}});
  }catch(e){res.json({ok:false,error:e.message,source:"Official lineup checker"});}
});

app.listen(PORT, () => console.log("FG World Cup AI V5.6 local DB on " + PORT));
