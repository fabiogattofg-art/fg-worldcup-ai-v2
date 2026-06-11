import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const FIFA_PDF = "https://fdp.fifa.org/assetspublic/ce281/pdf/SquadLists-English.pdf";
const JINA_URL = "https://r.jina.ai/" + FIFA_PDF;

const TEAM_MAP = {
  "ARG":"Argentina","FRA":"France","BRA":"Brazil","ENG":"England","ESP":"Spain","POR":"Portugal","GER":"Germany","NED":"Netherlands",
  "BEL":"Belgium","URU":"Uruguay","COL":"Colombia","CRO":"Croatia","USA":"USA","MAR":"Morocco","JPN":"Japan","MEX":"Mexico",
  "CAN":"Canada","KOR":"South Korea","SUI":"Switzerland","SEN":"Senegal","NOR":"Norway","AUT":"Austria","TUR":"Turkiye",
  "ECU":"Ecuador","CIV":"Ivory Coast","SWE":"Sweden","AUS":"Australia","SCO":"Scotland","PAR":"Paraguay","QAT":"Qatar",
  "EGY":"Egypt","GHA":"Ghana","KSA":"Saudi Arabia","BIH":"Bosnia","CZE":"Czechia","TUN":"Tunisia","ALG":"Algeria",
  "IRN":"Iran","IRQ":"Iraq","UZB":"Uzbekistan","PAN":"Panama","RSA":"South Africa","COD":"DRC","CPV":"Cape Verde",
  "JOR":"Jordan","NZL":"New Zealand","HAI":"Haiti","CUW":"Curacao"
};

const NAME_MAP = {
  "Algeria":"Algeria","Argentina":"Argentina","Australia":"Australia","Austria":"Austria","Belgium":"Belgium",
  "Bosnia And Herzegovina":"Bosnia","Bosnia and Herzegovina":"Bosnia","Brazil":"Brazil","Canada":"Canada",
  "Congo DR":"DRC","DR Congo":"DRC","Côte D'Ivoire":"Ivory Coast","Cote D'Ivoire":"Ivory Coast","Croatia":"Croatia",
  "Curaçao":"Curacao","Curacao":"Curacao","Czechia":"Czechia","Ecuador":"Ecuador","Egypt":"Egypt","England":"England",
  "France":"France","Germany":"Germany","Ghana":"Ghana","Haiti":"Haiti","Iran":"Iran","Iraq":"Iraq","Japan":"Japan",
  "Jordan":"Jordan","Korea Republic":"South Korea","Mexico":"Mexico","Morocco":"Morocco","Netherlands":"Netherlands",
  "New Zealand":"New Zealand","Norway":"Norway","Panama":"Panama","Paraguay":"Paraguay","Portugal":"Portugal",
  "Qatar":"Qatar","Saudi Arabia":"Saudi Arabia","Scotland":"Scotland","Senegal":"Senegal","South Africa":"South Africa",
  "Spain":"Spain","Sweden":"Sweden","Switzerland":"Switzerland","Tunisia":"Tunisia","Türkiye":"Turkiye","Turkey":"Turkiye",
  "United States":"USA","USA":"USA","Uruguay":"Uruguay","Uzbekistan":"Uzbekistan","Cape Verde":"Cape Verde"
};

function clean(s) {
  return (s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function roleMap(pos) {
  return pos === "GK" ? "POR" : pos === "DF" ? "DIF" : pos === "MF" ? "CEN" : pos === "FW" ? "ATT" : "UNK";
}

function normalizeTeam(raw, code) {
  const r = clean(raw);
  return TEAM_MAP[code] || NAME_MAP[r] || r;
}

function estimateValue(pos, caps, goals) {
  const base = pos === "FW" ? 20 : pos === "MF" ? 15 : pos === "DF" ? 11 : 9;
  return Math.round((base + Math.min(Number(caps) || 0, 140) * 0.18 + (Number(goals) || 0) * 1.05) * 10) / 10;
}

function estimateBonus(pos, caps, goals) {
  const base = pos === "FW" ? 70 : pos === "MF" ? 66 : pos === "DF" ? 62 : 60;
  return Math.max(45, Math.min(98, Math.round(base + Math.min(Number(caps) || 0, 140) * 0.12 + (Number(goals) || 0) * 0.45)));
}

function makePlayer(team, pos, beforeDob, dob, club, height, caps, goals) {
  const name = displayName(beforeDob);
  return {
    team,
    name,
    role: roleMap(pos),
    status: "Panchina",
    probableXI: false,
    valueM: estimateValue(pos, caps, goals),
    bonus: estimateBonus(pos, caps, goals),
    yellow: pos === "DF" ? 32 : pos === "MF" ? 28 : 12,
    sub: pos === "FW" ? 55 : pos === "MF" ? 48 : 18,
    setPieces: "",
    club: clean(club),
    height: Number(height) || 0,
    caps: Number(caps) || 0,
    goals: Number(goals) || 0,
    dob,
    source: "FIFA official squad list via Jina Reader"
  };
}

function displayName(beforeDob) {
  const tokens = clean(beforeDob).split(/\s+/).filter(Boolean);
  const surname = [];
  while (tokens.length && /^[A-ZÀ-ÖØ-Ý'’.\-]+$/.test(tokens[0])) {
    surname.push(tokens.shift());
  }
  const first = tokens[0] || "";
  const sur = surname[0] || "";
  if (first && sur) return clean(`${first} ${sur}`);
  return clean(beforeDob).split(/\s+/).slice(0, 2).join(" ");
}

function parseSquads(rawText) {
  const text = rawText
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/L\d+@P\d+(?:-\d+)?:\s*/g, "")
    .replace(/^[#>*\-\s]+/gm, "");

  const squadRe = /SQUAD\s*LIST\s*([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/g;
  const sections = [];
  let sm;
  while ((sm = squadRe.exec(text))) {
    sections.push({ index: sm.index, raw: sm[1], code: sm[2] });
  }

  // Fallback: Jina sometimes returns "Algeria (ALG)" without SQUAD LIST at the very start.
  if (!sections.length) {
    const simpleRe = /(?:^|\n)([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/g;
    while ((sm = simpleRe.exec(text))) {
      const team = normalizeTeam(sm[1], sm[2]);
      if (Object.values(TEAM_MAP).includes(team) || Object.values(NAME_MAP).includes(team)) {
        sections.push({ index: sm.index, raw: sm[1], code: sm[2] });
      }
    }
  }

  const players = [];
  for (let i = 0; i < sections.length; i++) {
    const start = sections[i];
    const end = sections[i + 1]?.index ?? text.length;
    const team = normalizeTeam(start.raw, start.code);
    const section = text.slice(start.index, end).replace(/\n/g, " ");

    const row = /\b(GK|DF|MF|FW)\s+(.{4,180}?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.{2,130}?)\s+(\d{3})\s+(\d{1,3})\s+(\d{1,3})(?=\s+(?:GK|DF|MF|FW)\s+|\s+ROLE\s+COACH|\s+Head coach|\s+DOB Date|\s+FIFA World Cup|\s+Thursday|\s*$)/g;

    let m;
    while ((m = row.exec(section))) {
      const [, pos, beforeDob, dob, club, height, caps, goals] = m;
      const p = makePlayer(team, pos, beforeDob, dob, club, height, caps, goals);
      if (p.name && p.name.length >= 3 && !players.some(x => x.team === p.team && x.name === p.name)) {
        players.push(p);
      }
    }
  }

  setProbableXI(players);
  return players;
}

function setProbableXI(players) {
  const byTeam = {};
  for (const p of players) (byTeam[p.team] ||= []).push(p);

  for (const ps of Object.values(byTeam)) {
    ps.forEach(p => { p.status = "Panchina"; p.probableXI = false; });
    const order = { POR: 0, DIF: 1, CEN: 2, ATT: 3, UNK: 4 };
    ps.sort((a, b) => order[a.role] - order[b.role] || b.caps - a.caps || b.bonus - a.bonus);

    const xi = [];
    const take = (role, n) => ps.filter(p => p.role === role).slice(0, n).forEach(p => xi.push(p));
    take("POR", 1);
    take("DIF", 4);
    take("CEN", 3);
    take("ATT", 3);
    if (xi.length < 11) ps.filter(p => !xi.includes(p)).slice(0, 11 - xi.length).forEach(p => xi.push(p));
    xi.forEach(p => { p.status = "Titolare"; p.probableXI = true; });
  }
}

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/api/import-official-squads", async (_, res) => {
  try {
    const r = await fetch(JINA_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/plain"
      }
    });

    if (!r.ok) return res.json({ ok: false, error: `Jina Reader non raggiungibile: HTTP ${r.status}` });

    const text = await r.text();
    const players = parseSquads(text);
    const teams = new Set(players.map(p => p.team)).size;

    if (players.length < 900 || teams < 35) {
      return res.json({
        ok: false,
        error: `Parsing incompleto: trovati ${players.length} giocatori su ${teams} squadre.`,
        debug: {
          source: JINA_URL,
          textLength: text.length,
          first1000: text.slice(0, 1000),
          squadHeaders: [...text.matchAll(/SQUAD\s*LIST\s*([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/g)].slice(0, 20).map(x => `${x[1]} (${x[2]})`)
        }
      });
    }

    res.json({ ok: true, source: FIFA_PDF, extraction: "Jina Reader", players, teams });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});


function normalizeForMatch(s){
  return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
}

function findKnownInWindow(text, knownPlayers, home, away){
  const normalizedText = normalizeForMatch(text);
  const rows = [];
  for(const p of knownPlayers || []){
    const key = normalizeForMatch(p.name);
    if(!key || key.length < 4) continue;
    const idx = normalizedText.indexOf(key);
    if(idx >= 0){
      rows.push({...p, idx});
    }
  }

  // Try to infer status by nearby words and by position in the lineup block.
  const starters = [];
  const bench = [];
  const out = [];

  for(const p of rows){
    const rawIdx = Math.max(0, Math.floor(p.idx * text.length / Math.max(1, normalizedText.length)) - 500);
    const context = text.slice(rawIdx, rawIdx + 1200).toLowerCase();
    if(/(substitutes|bench|panchina|riserve|substitute)/i.test(context) && !/(starting xi|lineups|formazioni|titolari)/i.test(context.slice(0,500))){
      bench.push(p);
    } else if(/(injured|suspended|absent|indisponibile|squalificato|infortunato)/i.test(context)){
      out.push(p);
    } else {
      starters.push(p);
    }
  }

  // If everything fell into starters but too many names were found, split by first 11 per team as starters.
  const result = [];
  for(const team of [home, away]){
    const teamRows = rows.filter(p=>p.team===team).sort((a,b)=>a.idx-b.idx);
    const explicitBench = new Set(bench.filter(p=>p.team===team).map(p=>p.name));
    const explicitOut = new Set(out.filter(p=>p.team===team).map(p=>p.name));

    let starterCandidates = teamRows.filter(p=>!explicitBench.has(p.name) && !explicitOut.has(p.name));
    if(starterCandidates.length > 11) starterCandidates = starterCandidates.slice(0,11);

    for(const p of starterCandidates) result.push({name:p.name, team:p.team, role:p.role, status:"Titolare"});
    for(const p of teamRows){
      if(starterCandidates.some(x=>x.name===p.name)) continue;
      if(explicitOut.has(p.name)) result.push({name:p.name, team:p.team, role:p.role, status:"Fuori"});
      else result.push({name:p.name, team:p.team, role:p.role, status:"Panchina"});
    }
  }

  return result;
}

async function getLineupCandidateText(home, away){
  const queries = [
    `https://r.jina.ai/http://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(home+" "+away+" lineups")}`,
    `https://r.jina.ai/http://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(home+" "+away+" formazioni ufficiali")}`,
    `https://r.jina.ai/http://r.jina.ai/http://www.bing.com/search?q=${encodeURIComponent(home+" "+away+" lineups")}`,
    `https://r.jina.ai/http://r.jina.ai/http://www.bing.com/search?q=${encodeURIComponent(home+" "+away+" formazioni ufficiali")}`
  ];
  let text = "";
  for(const url of queries){
    try{
      const r = await fetch(url, {headers:{"User-Agent":"Mozilla/5.0","Accept":"text/plain"}});
      if(r.ok){
        const t = await r.text();
        text += "\n\nSOURCE: " + url + "\n" + t.slice(0, 50000);
      }
    }catch(e){}
  }
  return text;
}

app.post("/api/find-official-lineups", async (req, res) => {
  const {home, away, knownPlayers} = req.body || {};
  if(!home || !away) return res.json({ok:false,error:"Squadre mancanti"});

  try{
    const text = await getLineupCandidateText(home, away);
    if(!text || text.length < 500){
      return res.json({ok:false,error:"Nessuna fonte lineup leggibile",source:"Jina search"});
    }

    const players = findKnownInWindow(text, knownPlayers || [], home, away);
    const homeXI = players.filter(p=>p.team===home && p.status==="Titolare").length;
    const awayXI = players.filter(p=>p.team===away && p.status==="Titolare").length;

    if(homeXI < 8 || awayXI < 8){
      return res.json({
        ok:false,
        error:`Formazioni non affidabili: trovati ${homeXI}/${awayXI} titolari.`,
        source:"Official lineup checker",
        debug:{homeXI,awayXI,found:players.length}
      });
    }

    res.json({
      ok:true,
      source:"Official lineup checker",
      players,
      confidence: homeXI>=10 && awayXI>=10 ? "high" : "medium",
      counts:{homeXI,awayXI,total:players.length}
    });
  }catch(e){
    res.json({ok:false,error:e.message,source:"Official lineup checker"});
  }
});

app.listen(PORT, () => console.log("FG World Cup AI V5.4 Jina import on " + PORT));
