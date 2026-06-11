import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const FIFA_PDF = "https://fdp.fifa.org/assetspublic/ce281/pdf/SquadLists-English.pdf";

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

function normalizeTeam(raw, code) {
  const r = clean(raw);
  return TEAM_MAP[code] || NAME_MAP[r] || r;
}

function roleMap(pos) {
  return pos === "GK" ? "POR" : pos === "DF" ? "DIF" : pos === "MF" ? "CEN" : pos === "FW" ? "ATT" : "UNK";
}

function estimateValue(pos, caps, goals) {
  const base = pos === "FW" ? 20 : pos === "MF" ? 15 : pos === "DF" ? 11 : 9;
  return Math.round((base + Math.min(Number(caps) || 0, 140) * 0.18 + (Number(goals) || 0) * 1.05) * 10) / 10;
}

function estimateBonus(pos, caps, goals) {
  const base = pos === "FW" ? 70 : pos === "MF" ? 66 : pos === "DF" ? 62 : 60;
  return Math.max(45, Math.min(98, Math.round(base + Math.min(Number(caps) || 0, 140) * 0.12 + (Number(goals) || 0) * 0.45)));
}

function makePlayer(team, pos, name, club = "", caps = 0, goals = 0, height = 0, dob = "") {
  const role = roleMap(pos);
  return {
    team,
    name: clean(name),
    role,
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
    source: "FIFA official squad list"
  };
}

function simplifyNameFromRow(pos, rowBeforeDob) {
  // FIFA rows usually repeat name pieces:
  // "MESSI Lionel Andrés Lionel Andrés MESSI MESSI"
  // "KIM Seunggyu Seunggyu KIM SEUNGGYU"
  // We prefer first-name token + surname block.
  let tokens = clean(rowBeforeDob).split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  let surnameTokens = [];
  while (tokens.length && /^[A-ZÀ-ÖØ-Ý'’.\-]+$/.test(tokens[0])) {
    surnameTokens.push(tokens.shift());
  }
  const surname = surnameTokens.join(" ");
  const first = tokens[0] || "";
  if (first && surname) return clean(`${first} ${surname.split(" ")[0]}`);
  return clean(rowBeforeDob).split(/\s+/).slice(0, 2).join(" ");
}

function parseByTeamSections(text) {
  const normalized = text.replace(/\r/g, "\n").replace(/\u00a0/g, " ");
  const squadRe = /SQUAD\s*LIST\s*([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/g;
  const starts = [];
  let sm;
  while ((sm = squadRe.exec(normalized))) {
    starts.push({ index: sm.index, raw: sm[1], code: sm[2] });
  }

  const players = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = starts[i + 1]?.index ?? normalized.length;
    const team = normalizeTeam(start.raw, start.code);
    let section = normalized.slice(start.index, end).replace(/\n/g, " ");

    // Row pattern ending at DOB + club + height caps goals.
    const row = /\b(GK|DF|MF|FW)\s+(.{4,160}?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.{2,90}?)\s+(\d{3})\s+(\d{1,3})\s+(\d{1,3})(?=\s+(?:GK|DF|MF|FW)\s+|\s+ROLE COACH|\s+Head coach|\s+DOB Date|\s+FIFA World Cup|\s+Thursday|\s*$)/g;
    let m;
    while ((m = row.exec(section))) {
      const [, pos, beforeDob, dob, club, height, caps, goals] = m;
      const name = simplifyNameFromRow(pos, beforeDob);
      if (name && name.length >= 3 && !players.some(p => p.team === team && p.name === name)) {
        players.push(makePlayer(team, pos, name, club, caps, goals, height, dob));
      }
    }
  }

  return players;
}

function parseGlobally(text) {
  // Fallback if team sections fail: scan linearly and keep current team.
  const normalized = text.replace(/\r/g, "\n").replace(/\u00a0/g, " ");
  const tokens = normalized.split(/\n/).map(clean).filter(Boolean);
  const players = [];
  let currentTeam = "";
  for (const line of tokens) {
    const sm = line.match(/SQUAD\s*LIST\s*([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/);
    if (sm) {
      currentTeam = normalizeTeam(sm[1], sm[2]);
      continue;
    }
    if (!currentTeam) continue;
    const row = line.match(/\b(GK|DF|MF|FW)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(\d{3})\s+(\d{1,3})\s+(\d{1,3})$/);
    if (row) {
      const [, pos, beforeDob, dob, club, height, caps, goals] = row;
      const name = simplifyNameFromRow(pos, beforeDob);
      if (name && !players.some(p => p.team === currentTeam && p.name === name)) {
        players.push(makePlayer(currentTeam, pos, name, club, caps, goals, height, dob));
      }
    }
  }
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

    if (xi.length < 11) {
      ps.filter(p => !xi.includes(p)).slice(0, 11 - xi.length).forEach(p => xi.push(p));
    }
    xi.forEach(p => { p.status = "Titolare"; p.probableXI = true; });
  }
}

function parseSquads(text) {
  let players = parseByTeamSections(text);
  if (players.length < 500) {
    const fallback = parseGlobally(text);
    const merged = [...players];
    for (const p of fallback) {
      if (!merged.some(x => x.team === p.team && x.name === p.name)) merged.push(p);
    }
    players = merged;
  }

  // de-dupe and remove obvious junk
  const seen = new Set();
  players = players.filter(p => {
    const bad = /^(Head|Coach|Role|DOB|FIFA|World|Thursday)$/i.test(p.name);
    const k = `${p.team}|${p.name}`;
    if (bad || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  setProbableXI(players);
  return players;
}

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/api/import-official-squads", async (_, res) => {
  try {
    const r = await fetch(FIFA_PDF, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return res.json({ ok: false, error: `FIFA PDF non raggiungibile: HTTP ${r.status}` });

    const buf = Buffer.from(await r.arrayBuffer());
    const parsed = await pdfParse(buf);
    const text = parsed.text || "";
    const players = parseSquads(text);
    const teams = new Set(players.map(p => p.team)).size;

    if (players.length < 900 || teams < 35) {
      return res.json({
        ok: false,
        error: `Parsing incompleto: trovati ${players.length} giocatori su ${teams} squadre.`,
        debug: {
          textLength: text.length,
          first500: text.slice(0, 500),
          sampleSquadHeaders: [...text.matchAll(/SQUAD\s*LIST\s*([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/g)].slice(0, 10).map(x => `${x[1]} (${x[2]})`)
        }
      });
    }

    res.json({ ok: true, source: FIFA_PDF, players, teams });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log("FG World Cup AI V5.2 on " + PORT));
