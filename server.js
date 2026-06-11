import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
const __filename=fileURLToPath(import.meta.url),__dirname=path.dirname(__filename),app=express();app.use(express.json({limit:"3mb"}));app.use(express.static(__dirname));const PORT=process.env.PORT||3000;
function clean(s){return(s||"").replace(/\s+/g," ").trim()}
function norm(s){return clean(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function extractKnown(text,home,away,known){const low=text.toLowerCase();if(!["lineups","formazioni","starting xi","titolari","formation"].some(x=>low.includes(x)))return[];const res=[];const ntext=norm(text);for(const name of known||[]){if(name.length<4)continue;if(ntext.includes(norm(name)))res.push({name,status:"Titolare"})}return res.slice(0,22)}
async function fetchText(url){const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept-Language":"it-IT,it;q=0.9"}});if(!r.ok)return"";const html=await r.text();const $=cheerio.load(html);$("script,style,noscript,svg").remove();return $("body").text()+" "+$("[title]").map((_,e)=>$(e).attr("title")).get().join(" ")+" "+$("[aria-label]").map((_,e)=>$(e).attr("aria-label")).get().join(" ")}
async function pwText(url){const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-setuid-sandbox"]});try{const page=await browser.newPage({userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",locale:"it-IT"});await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});await page.waitForTimeout(5000);return await page.textContent("body")||""}finally{await browser.close()}}
app.get("/",(_,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.post("/api/find-lineups",async(req,res)=>{const{home,away,knownPlayers}=req.body||{};if(!home||!away)return res.json({ok:false,error:"Squadre mancanti"});const urls=[`https://www.sofascore.com/search/all?q=${encodeURIComponent(home+" "+away)}`,`https://www.diretta.it/cerca/?q=${encodeURIComponent(home+" "+away)}`];for(const url of urls){try{let text=await fetchText(url);let players=extractKnown(text,home,away,knownPlayers);if(players.length>=16)return res.json({ok:true,source:url,method:"known-player-fetch",players})}catch(e){}try{let text=await pwText(url);let players=extractKnown(text,home,away,knownPlayers);if(players.length>=16)return res.json({ok:true,source:url,method:"known-player-playwright",players})}catch(e){}}res.json({ok:false,error:"Formazioni non disponibili: resto sulla probabile XI.",players:[]})});
app.listen(PORT,()=>console.log("FG World Cup AI V4 on "+PORT));
