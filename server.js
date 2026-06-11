import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function allowedUrl(raw) {
  const u = new URL(raw);
  const h = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  return h.endsWith("sofascore.com") || h.endsWith("diretta.it") || h.endsWith("flashscore.com");
}

function extractNames(text) {
  const blacklist = new Set([
    "SofaScore", "Diretta", "Flashscore", "Football", "Calcio", "Partita",
    "Statistiche", "Classifiche", "Quote", "Formazioni", "Panchina",
    "Titolari", "Allenatore", "Arbitro", "Stadio", "Mondiali", "World Cup",
    "Live", "Risultati", "News", "Home", "Away"
  ]);

  const re = /\b[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’.-]{2,}(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’.-]{2,}){0,2}\b/g;
  const out = [];
  let m;

  while ((m = re.exec(text))) {
    const name = clean(m[0]);
    if (name.length < 4 || name.length > 36) continue;
    if (blacklist.has(name)) continue;
    if (/\d/.test(name)) continue;
    if (out.includes(name)) continue;
    out.push(name);
  }

  return out.slice(0, 80).map(name => ({
    name,
    status: "Titolare",
    role: "UNK",
    bonus: 60,
    yellow: 25,
    sub: 45
  }));
}

function extractFromHtml(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();

  const parts = [];
  $("[title]").each((_, el) => parts.push($(el).attr("title")));
  $("[aria-label]").each((_, el) => parts.push($(el).attr("aria-label")));
  $("[data-testid]").each((_, el) => parts.push($(el).text()));
  parts.push($("body").text());

  return extractNames(clean(parts.join(" ")));
}

async function scrapeWithPlaywright(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      locale: "it-IT"
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3500);

    const html = await page.content();
    return extractFromHtml(html);
  } finally {
    await browser.close();
  }
}

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/scrape", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.json({ ok: false, error: "URL mancante" });

  try {
    if (!allowedUrl(url)) {
      return res.json({ ok: false, error: "Sono consentiti solo SofaScore, Diretta o Flashscore." });
    }

    let players = [];
    let method = "fetch+cheerio";

    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
          "Accept-Language": "it-IT,it;q=0.9,en;q=0.8"
        }
      });

      if (r.ok) {
        const html = await r.text();
        players = extractFromHtml(html);
      }
    } catch (e) {}

    if (players.length < 8) {
      method = "playwright";
      players = await scrapeWithPlaywright(url);
    }

    res.json({
      ok: true,
      source: url,
      method,
      players,
      note: "Estrazione automatica sperimentale: controlla sempre i nomi letti."
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`FG World Cup AI AUTO attiva su http://localhost:${PORT}`);
});
