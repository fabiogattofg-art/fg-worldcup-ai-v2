import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

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

function makePlayer(team, pos, name, club = "", caps = 0, goals = 0, height = 0, dob = "") {
  return {
    team,
    name: clean(name),
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
    source: "FIFA official squad list"
  };
}

function displayNameFromRow(beforeDob) {
  const tokens = clean(beforeDob).split(/\s+/).filter(Boolean);
  const surname = [];
  while (tokens.length && /^[A-ZÀ-ÖØ-Ý'’.\-]+$/.test(tokens[0])) surname.push(tokens.shift());
  const first = tokens[0] || "";
  const sur = surname[0] || "";
  if (first && sur) return clean(`${first} ${sur}`);
  return clean(beforeDob).split(/\s+/).slice(0, 2).join(" ");
}

async function extractTextWithPdfJs(buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items
      .map(item => ({ str: item.str || "", x: item.transform?.[4] || 0, y: item.transform?.[5] || 0 }))
      .filter(item => item.str.trim());

    // Group by y coordinate to rebuild rows
    const rows = [];
    for (const item of items) {
      let row = rows.find(r => Math.abs(r.y - item.y) < 3);
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }

    rows.sort((a, b) => b.y - a.y);
    const pageText = rows.map(row => row.items.sort((a, b) => a.x - b.x).map(i => i.str).join(" ")).join("\n");
    pages.push(pageText);
  }
  return pages.join("\n");
}

function parseSquads(text) {
  const players = [];
  const normalized = text.replace(/\r/g, "\n").replace(/\u00a0/g, " ");
  const squadRe = /SQUAD\s*LIST\s*([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/g;
  const sections = [];
  let sm;
  while ((sm = squadRe.exec(normalized))) sections.push({ index: sm.index, raw: sm[1], code: sm[2] });

  for (let i = 0; i < sections.length; i++) {
    const start = sections[i];
    const end = sections[i + 1]?.index ?? normalized.length;
    const team = normalizeTeam(start.raw, start.code);
    const section = normalized.slice(start.index, end).replace(/\n/g, " ");

    // Example:
    // GK MUSSO Juan Juan Agustín MUSSO MUSSO 06/05/1994 Atlético De Madrid (ESP) 193 4 0
    const row = /\b(GK|DF|MF|FW)\s+(.{4,170}?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.{2,120}?)\s+(\d{3})\s+(\d{1,3})\s+(\d{1,3})(?=\s+(?:GK|DF|MF|FW)\s+|\s+ROLE\s+COACH|\s+Head coach|\s+DOB Date|\s+FIFA World Cup|\s+Thursday|\s*$)/g;

    let m;
    while ((m = row.exec(section))) {
      const [, pos, beforeDob, dob, club, height, caps, goals] = m;
      const name = displayNameFromRow(beforeDob);
      if (!name || name.length < 3) continue;
      if (players.some(p => p.team === team && p.name === name)) continue;
      players.push(makePlayer(team, pos, name, club, caps, goals, height, dob));
    }
  }

  // Set probable XI per team
  const byTeam = {};
  for (const p of players) (byTeam[p.team] ||= []).push(p);
  for (const ps of Object.values(byTeam)) {
    const order = { POR: 0, DIF: 1, CEN: 2, ATT: 3, UNK: 4 };
    ps.sort((a, b) => order[a.role] - order[b.role] || b.caps - a.caps || b.bonus - a.bonus);
    const xi = [];
    const take = (role, n) => ps.filter(p => p.role === role).slice(0, n).forEach(p => xi.push(p));
    take("POR", 1); take("DIF", 4); take("CEN", 3); take("ATT", 3);
    if (xi.length < 11) ps.filter(p => !xi.includes(p)).slice(0, 11 - xi.length).forEach(p => xi.push(p));
    xi.forEach(p => { p.status = "Titolare"; p.probableXI = true; });
  }

  return players;
}

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/api/import-official-squads", async (_, res) => {
  try {
    const r = await fetch(FIFA_PDF, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return res.json({ ok: false, error: `FIFA PDF non raggiungibile: HTTP ${r.status}` });

    const buffer = Buffer.from(await r.arrayBuffer());
    const text = await extractTextWithPdfJs(buffer);
    const players = parseSquads(text);
    const teams = new Set(players.map(p => p.team)).size;

    if (players.length < 900 || teams < 35) {
      return res.json({
        ok: false,
        error: `Parsing incompleto: trovati ${players.length} giocatori su ${teams} squadre.`,
        debug: {
          textLength: text.length,
          first1000: text.slice(0, 1000),
          sampleSquadHeaders: [...text.matchAll(/SQUAD\s*LIST\s*([A-Za-zÀ-ÿ'’ .-]{2,60}?)\s*\(([A-Z]{3})\)/g)].slice(0, 12).map(x => `${x[1]} (${x[2]})`)
        }
      });
    }

    res.json({ ok: true, source: FIFA_PDF, players, teams });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log("FG World Cup AI V5.3 on " + PORT));
