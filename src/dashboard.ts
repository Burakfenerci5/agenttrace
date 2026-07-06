/**
 * AgentTrace local dashboard — a zero-dependency web UI over your sessions.
 *
 * `agenttrace serve` starts a tiny HTTP server on localhost that renders the
 * discover→parse→correlate data as a striking, clickable overview: an outcomes
 * hero, an interactive chart (switch the metric: cost / tokens / files / …), a
 * searchable/groupable session list, and per-session drill-down. From a session
 * you can Sign with ActionProof — a real Ed25519 receipt, verified live.
 *
 * Endpoints:
 *   GET  /                     the single-page app (HTML+CSS+JS inline, no build)
 *   GET  /api/sessions         session list as JSON (+ which are verified)
 *   GET  /api/transcript?id=   raw transcript for drill-down (read on demand)
 *   POST /api/sign             { id } -> sign that session's outcome, verify, persist
 *
 * Local-first and offline: binds to 127.0.0.1, no external assets, no network.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { Session } from "./types.ts";
import {
  isActionProofAvailable,
  signSession,
  signAction,
  verifiedSessionIds,
} from "./actionproof.ts";
import {
  readStore,
  setRecState,
  toAgentMarkdown,
  toAgentJson,
  provenRoi,
} from "./analysis.ts";
import {
  readGroups,
  addGroup,
  assignSessions,
  renameGroup,
  renameSession,
  deleteGroup,
} from "./groups.ts";

/** The client app. Kept inline so the tool is a single install with no assets. */
function pageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AgentTrace</title>
<style>
  :root {
    --bg:#0a0e14; --panel:#12171f; --panel2:#161c26; --border:#232b38;
    --text:#e6edf3; --dim:#8b949e; --accent:#58a6ff;
    --kept:#3fb950; --reverted:#f85149; --uncommitted:#d29922;
    --untracked:#58a6ff; --none:#6e7681; --gold:#e3b341;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; }
  body { background:radial-gradient(1200px 600px at 15% -10%, #16202e 0%, var(--bg) 55%);
    color:var(--text); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    min-height:100vh; }
  a { color:var(--accent); }
  .wrap { max-width:1180px; margin:0 auto; padding:0 24px 80px; }
  header { padding:30px 0 10px; display:flex; align-items:center; gap:14px; }
  .logo { display:inline-flex; align-items:center; gap:10px; }
  .logo svg { display:block; }
  .logo .word { font-size:22px; font-weight:650; letter-spacing:-.02em; }

  /* ---- hero stat cards ---- */
  .hero { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
    gap:14px; margin:22px 0 8px; }
  .stat { background:linear-gradient(180deg,var(--panel2),var(--panel));
    border:1px solid var(--border); border-radius:14px; padding:16px 18px; }
  .stat .n { font-size:26px; font-weight:700; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
  .stat .l { color:var(--dim); font-size:12.5px; margin-top:3px; }
  .stat .sub { font-size:12px; margin-top:8px; }
  .pct { height:6px; border-radius:99px; background:#0006; overflow:hidden; margin-top:10px; display:flex; }
  .pct i { height:100%; display:block; }

  /* ---- outcomes recap bar ---- */
  .recap { background:var(--panel); border:1px solid var(--border); border-radius:14px;
    padding:18px 20px; margin:16px 0; }
  .recap h2 { margin:0 0 12px; font-size:14px; color:var(--dim); text-transform:uppercase;
    letter-spacing:.06em; font-weight:600; }
  .recap p { margin:0; font-size:15px; line-height:1.65; }
  .recap b { color:var(--text); }
  .chip { display:inline-block; padding:1px 9px; border-radius:99px; font-size:12.5px;
    font-weight:600; margin:0 2px; }

  /* ---- chart ---- */
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:14px;
    padding:18px 20px; margin:16px 0; }
  .panel-head { display:flex; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
  .panel-head h2 { margin:0; font-size:15px; }
  .seg { display:flex; gap:2px; background:#0006; border:1px solid var(--border);
    border-radius:9px; padding:3px; margin-left:auto; }
  .seg button { background:none; border:none; color:var(--dim); font-size:12.5px;
    padding:5px 11px; border-radius:6px; cursor:pointer; }
  .seg button.on { background:var(--accent); color:#04121f; font-weight:600; }
  .chart { display:flex; align-items:flex-end; gap:6px; height:210px; padding-top:10px; }
  .bar { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:flex-end;
    align-items:center; gap:6px; cursor:pointer; height:100%; }
  .bar .fill { width:100%; border-radius:6px 6px 0 0; min-height:2px; transition:opacity .12s;
    background:linear-gradient(180deg,var(--accent),#1f6feb); }
  .bar:hover .fill { opacity:.75; }
  .bar .v { font-size:10.5px; color:var(--dim); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .bar .x { font-size:10px; color:var(--dim); max-width:100%; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }

  /* ---- controls ---- */
  .controls { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:18px 0 6px; }
  .controls input, .controls select { background:var(--panel); color:var(--text);
    border:1px solid var(--border); border-radius:9px; padding:9px 12px; font-size:13px; }
  .controls input { flex:1; min-width:220px; }
  .filterchips { display:flex; gap:6px; flex-wrap:wrap; }
  .filterchips .chip { cursor:pointer; user-select:none; border:1px solid transparent; }
  .filterchips .chip.off { opacity:.34; }
  .spend { margin-left:auto; color:var(--dim); font-size:13px; }
  .spend b { color:var(--text); }

  /* ---- list ---- */
  .group-head { display:flex; align-items:baseline; gap:10px; margin:20px 4px 4px; }
  .group-head .name { font-weight:700; }
  .group-head .gmeta { color:var(--dim); font-size:12.5px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px;
    padding:14px 16px; margin:9px 0; cursor:pointer; transition:border-color .13s,transform .13s; }
  .card:hover { border-color:var(--accent); transform:translateX(2px); }
  .card .top { display:flex; align-items:center; gap:10px; }
  .title { font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .meta { color:var(--dim); font-size:12.5px; margin-top:6px; }
  .badge { font-size:12px; font-weight:600; padding:2px 10px; border-radius:99px; white-space:nowrap; }
  .badge.kept{color:var(--kept);background:#3fb95020;} .badge.reverted{color:var(--reverted);background:#f8514920;}
  .badge.uncommitted{color:var(--uncommitted);background:#d2992220;} .badge.untracked{color:var(--untracked);background:#58a6ff20;}
  .badge.no-changes,.badge.unknown{color:var(--none);background:#6e768120;}
  .verified { color:var(--kept); font-size:11.5px; font-weight:700; border:1px solid var(--kept);
    border-radius:99px; padding:1px 9px; }
  .cost { font-variant-numeric:tabular-nums; }

  /* ---- dialog ---- */
  dialog { background:var(--panel); color:var(--text); border:1px solid var(--border);
    border-radius:16px; max-width:760px; width:92%; padding:0; }
  dialog::backdrop { background:#000b; backdrop-filter:blur(2px); }
  .dhead { padding:20px 24px; border-bottom:1px solid var(--border); }
  .dbody { padding:20px 24px; max-height:62vh; overflow:auto; }
  .kv { display:grid; grid-template-columns:120px 1fr; gap:7px 16px; font-size:13px; }
  .kv .k { color:var(--dim); }
  .files li,.commits li { font-family:ui-monospace,Menlo,monospace; font-size:12.5px; }
  .tag { font-size:11px; padding:1px 6px; border-radius:4px; margin-right:6px; }
  .tag.new{color:var(--kept);background:#3fb95020;} .tag.edit{color:var(--accent);background:#58a6ff20;}
  h3 { margin:20px 0 8px; font-size:12.5px; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; }
  ul { margin:0; padding-left:18px; }
  .close { float:right; cursor:pointer; color:var(--dim); border:none; background:none; font-size:22px; }
  .rename-btn { background:none; border:1px solid var(--border); color:var(--dim); border-radius:6px;
    font-size:11px; padding:2px 8px; cursor:pointer; margin-left:8px; vertical-align:middle; }
  .rename-btn:hover { border-color:var(--accent); color:var(--accent); }
  .empty { padding:60px 24px; text-align:center; color:var(--dim); }
  .signbox { margin-top:18px; padding:16px; border:1px dashed var(--border); border-radius:12px;
    background:#0d1420; }
  .signbox.done { border-style:solid; border-color:var(--kept); }
  .btn { background:var(--gold); color:#1a1400; border:none; border-radius:9px; padding:9px 16px;
    font-size:13px; font-weight:700; cursor:pointer; }
  .btn:disabled { opacity:.5; cursor:default; }
  .receipt { font-family:ui-monospace,Menlo,monospace; font-size:11px; white-space:pre-wrap;
    word-break:break-all; color:var(--dim); margin-top:12px; max-height:220px; overflow:auto; }

  /* live / recommendation pills on cards */
  .live { color:var(--kept); font-size:11.5px; font-weight:700; animation:pulse 1.6s infinite; }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.4;} }
  .recpill { font-size:11.5px; color:var(--gold); border:1px solid #e3b34155; border-radius:99px; padding:1px 8px; }

  /* recommendations */
  .rec { border:1px solid var(--border); border-left:3px solid var(--dim); border-radius:10px;
    padding:11px 13px; margin:8px 0; background:var(--panel2); }
  .rec.high { border-left-color:var(--reverted); }
  .rec.medium { border-left-color:var(--uncommitted); }
  .rec.low { border-left-color:var(--none); }
  .rec-t { font-weight:600; display:flex; align-items:center; gap:8px; }
  .rec-imp { margin-left:auto; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--dim); }
  .rec-a { margin-top:7px; font-size:12.5px; color:var(--accent); }

  /* actions list */
  .alist { border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  .arow { display:flex; align-items:center; gap:10px; padding:7px 12px; font-size:12.5px;
    border-bottom:1px solid var(--border); }
  .arow:last-child { border-bottom:none; }
  .arow:hover { background:var(--panel2); }
  .a-type { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:var(--accent);
    min-width:92px; }
  .a-sum { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .a-ts { color:var(--dim); font-size:11px; white-space:nowrap; }
  .a-ok { color:var(--kept); font-weight:700; }
  .a-verify { background:none; border:1px solid var(--gold); color:var(--gold); border-radius:6px;
    font-size:11px; padding:2px 9px; cursor:pointer; }
  .a-verify:hover { background:var(--gold); color:#1a1400; }

  /* legend */
  .legend { color:var(--dim); font-size:12px; margin:2px 4px 0; }
  .legend b { color:var(--text); font-weight:600; }

  /* recommendation cards v1 */
  .rec.accepted { opacity:.7; display:flex; align-items:center; gap:12px; border-left-color:var(--kept); }
  .rec.accepted .rec-undo { margin-left:auto; background:none; border:1px solid var(--border);
    color:var(--dim); border-radius:6px; font-size:11px; padding:3px 9px; cursor:pointer; }
  .rec-save { margin-left:8px; color:var(--gold); font-size:11.5px; font-weight:700; }
  .rec-prompt-wrap { margin-top:10px; }
  .rec-plabel { font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--dim); margin-bottom:4px; }
  .rec-prompt { font-family:ui-monospace,Menlo,monospace; font-size:11.5px; white-space:pre-wrap;
    background:#0a0e14; border:1px solid var(--border); border-radius:8px; padding:10px 12px;
    margin:0; color:var(--text); max-height:150px; overflow:auto; }
  .rec-btns { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
  .btn-sm { background:var(--accent); color:#04121f; border:none; border-radius:7px;
    font-size:12px; font-weight:600; padding:6px 12px; cursor:pointer; }
  .btn-sm.ghost { background:none; border:1px solid var(--border); color:var(--text); }
  .btn-sm.accept { background:var(--kept); color:#04180a; margin-left:auto; }

  /* critical actions + risk */
  .arow.is-crit { background:#f8514908; }
  .crit-tag { margin-left:8px; color:var(--uncommitted); font-size:10.5px; font-weight:700;
    border:1px solid #d2992255; border-radius:99px; padding:1px 7px; }
  .a-verify.crit { border-color:var(--reverted); color:var(--reverted); }
  .a-verify.crit:hover { background:var(--reverted); color:#fff; }
  .a-ok { background:none; border:1px solid var(--kept); color:var(--kept); border-radius:6px;
    font-size:11px; font-weight:700; padding:2px 9px; cursor:pointer; }
  .a-ok:hover { background:var(--kept); color:#04180a; }
  .riskbanner { background:#f8514912; border:1px solid #f8514940; color:#ffb4b0;
    border-radius:10px; padding:10px 13px; font-size:12.5px; margin-bottom:10px; }
  .riskbanner.ok { background:#3fb95012; border-color:#3fb95040; color:#8be29a; }
  .riskbanner b { color:#fff; }

  /* multi-select */
  .card.selected { border-color:var(--accent); background:#58a6ff0e; }
  input.sel { width:15px; height:15px; accent-color:var(--accent); cursor:pointer; flex:0 0 auto; }
  #selbar { position:fixed; left:50%; bottom:24px; transform:translateX(-50%) translateY(24px);
    background:var(--panel2); border:1px solid var(--accent); border-radius:12px;
    padding:11px 16px; display:flex; align-items:center; gap:14px; font-size:13px;
    box-shadow:0 10px 40px #000b; opacity:0; pointer-events:none; transition:opacity .18s,transform .18s; z-index:90; }
  #selbar.show { opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(0); }
  #selbar .sb { color:var(--dim); font-variant-numeric:tabular-nums; }
  #selbar b { color:var(--text); }
  #selbar .sb-clear { background:none; border:1px solid var(--border); color:var(--dim);
    border-radius:7px; padding:5px 11px; font-size:12px; cursor:pointer; }
  #selbar .sb-grp-label { color:var(--dim); font-size:12px; margin-left:4px; }
  #selbar .sb-grp { background:#3fb9501a; border:1px solid #3fb95055; color:#8be29a;
    border-radius:7px; padding:5px 10px; font-size:12px; cursor:pointer; }
  #selbar .sb-grp:hover { background:#3fb95030; }
  #selbar .sb-grp.new { background:none; border-style:dashed; color:var(--dim); }

  /* group badge on a card + product badges on recs */
  .gbadge { font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:20px;
    background:#3fb9501a; color:#8be29a; border:1px solid #3fb95040; }
  .prodbadge { font-size:10px; font-weight:700; padding:1px 7px; border-radius:20px;
    border:1px solid currentColor; opacity:.95; white-space:nowrap; }

  /* survival hero — the headline number */
  .tagline { color:var(--dim); font-size:13.5px; margin-left:14px; align-self:center; }
  .survival { display:flex; align-items:center; gap:28px; background:var(--panel);
    border:1px solid var(--border); border-radius:16px; padding:22px 26px; margin:6px 0 14px;
    flex-wrap:wrap; }
  .survival .ring { position:relative; width:132px; height:132px; flex:0 0 auto; }
  .survival .ring svg { transform:rotate(-90deg); }
  .survival .ring .big { position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; }
  .survival .ring .big .v { font-size:30px; font-weight:800; letter-spacing:-.5px; }
  .survival .ring .big .k { font-size:10px; color:var(--dim); text-transform:uppercase; letter-spacing:.6px; }
  .survival .bd { flex:1; min-width:260px; }
  .survival .bd h2 { font-size:15px; margin:0 0 10px; font-weight:700; }
  .survival .sbar { display:flex; height:16px; border-radius:8px; overflow:hidden; background:var(--panel2); }
  .survival .sbar i { display:block; height:100%; }
  .survival .keys { display:flex; gap:16px; margin-top:11px; flex-wrap:wrap; font-size:12.5px; }
  .survival .keys span { color:var(--dim); }
  .survival .keys b { color:var(--text); font-variant-numeric:tabular-nums; }
  .survival .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; vertical-align:baseline; }
  .survival .note { color:var(--dim); font-size:11.5px; margin-top:10px; }

  /* ROI banner — proven value from accepted recommendations */
  .roi { display:none; align-items:center; gap:22px; margin:0 0 14px; padding:16px 22px;
    border-radius:14px; background:linear-gradient(90deg,#3fb95015,#58a6ff10);
    border:1px solid #3fb95040; flex-wrap:wrap; }
  .roi.show { display:flex; }
  .roi .lead { font-size:14px; font-weight:700; color:#8be29a; display:flex; align-items:center; gap:9px; }
  .roi .lead .spark { font-size:18px; }
  .roi .metric { display:flex; flex-direction:column; }
  .roi .metric .v { font-size:22px; font-weight:800; letter-spacing:-.4px; font-variant-numeric:tabular-nums; }
  .roi .metric .k { font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:.5px; }
  .roi .sep { width:1px; align-self:stretch; background:var(--border); }
  .roi .foot { color:var(--dim); font-size:11px; flex-basis:100%; margin-top:2px; }

  /* toast */
  #toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%) translateY(20px);
    background:var(--panel2); border:1px solid var(--border); color:var(--text);
    padding:11px 18px; border-radius:10px; font-size:13px; opacity:0; pointer-events:none;
    transition:opacity .2s,transform .2s; max-width:520px; box-shadow:0 8px 30px #000a; z-index:99; }
  #toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="logo" aria-label="AgentTrace">
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 24 L13 12 L20 18 L27 7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="5" cy="24" r="3" fill="#0a0e14" stroke="url(#g)" stroke-width="2.2"/>
        <circle cx="13" cy="12" r="2.6" fill="url(#g)"/>
        <circle cx="20" cy="18" r="2.6" fill="url(#g)"/>
        <circle cx="27" cy="7" r="3" fill="url(#g)"/>
        <defs><linearGradient id="g" x1="5" y1="24" x2="27" y2="7" gradientUnits="userSpaceOnUse">
          <stop stop-color="#3fb950"/><stop offset="1" stop-color="#58a6ff"/></linearGradient></defs>
      </svg>
      <span class="word">AgentTrace</span>
    </span>
    <span class="tagline">How much of your AI's code actually survived?</span>
  </header>
  <div class="survival" id="survival"></div>
  <div class="roi" id="roi"></div>
  <div class="hero" id="hero"></div>
  <div class="recap" id="recap"></div>
  <div class="panel">
    <div class="panel-head">
      <h2 id="chartTitle">Sessions by cost</h2>
      <div class="seg" id="chartBySeg"></div>
      <div class="seg" id="metricSeg"></div>
    </div>
    <div class="chart" id="chart"></div>
  </div>
  <div class="controls">
    <select id="scopeSel" title="Narrow the whole dashboard to one group"></select>
    <input id="search" type="search" placeholder="Search title, path, model, branch…" />
    <select id="groupBy">
      <option value="group" selected>Group by group</option>
      <option value="project">Group by project</option>
      <option value="outcome">Group by outcome</option>
      <option value="none">No grouping</option>
    </select>
    <select id="sortBy">
      <option value="cost">Most expensive</option>
      <option value="recent" selected>Newest first</option>
      <option value="files">Most files changed</option>
    </select>
  </div>
  <div class="controls">
    <div class="filterchips" id="filters"></div>
    <span class="spend" id="spend"></span>
  </div>
  <div class="legend" id="legend"></div>
  <div class="list" id="list"></div>
</div>
<dialog id="detail"></dialog>
<dialog id="proof"></dialog>
<script>
const LABELS=["kept","reverted","uncommitted","untracked","no-changes","unknown"];
const LABEL_COLOR={kept:"#3fb950",reverted:"#f85149",uncommitted:"#d29922",untracked:"#58a6ff","no-changes":"#6e7681",unknown:"#6e7681"};
// Plain-language display for each internal label (mirrors types.ts outcomeDisplay).
const OUTCOME={
  kept:{text:"Landed",tone:"good",hint:"Committed to git and still in history."},
  reverted:{text:"Reverted",tone:"bad",hint:"Committed, then undone by a later commit."},
  uncommitted:{text:"Not committed",tone:"warn",hint:"In a git repo, but no commit captured these edits."},
  untracked:{text:"Not in git",tone:"neutral",hint:"Files changed outside any git repository."},
  "no-changes":{text:"No edits",tone:"neutral",hint:"The agent changed no files (chat/planning only)."},
  unknown:{text:"Unknown",tone:"neutral",hint:"Not enough information to judge."},
};
function od(label){return OUTCOME[label]||OUTCOME.unknown;}
// Recommendation category → plain, honest feature label. We deliberately show
// plain labels ("Cost", "Security") in the FREE UX rather than sub-brands: for a
// free utility, multiple sub-brands read as "paywall coming" and add friction.
// The internal product keys (tokenkeeper/sessionsentry) are kept in the data
// model for later paid-tier packaging, but the free dashboard stays one brand.
const REC_CATEGORY={
  agenttrace:{name:"Workflow",color:"#58a6ff"},
  tokenkeeper:{name:"Cost",color:"#3fb950"},
  sessionsentry:{name:"Security",color:"#f0883e"},
  actionproof:{name:"Proof",color:"#a371f7"},
};
function recCat(p){return REC_CATEGORY[p]||REC_CATEGORY.agenttrace;}
function prodBadge(p){const x=recCat(p);return '<span class="prodbadge" style="color:'+x.color+'">'+esc(x.name)+'</span>';}
function relTime(min){ if(min==null)return""; if(min<1)return"just now"; if(min<60)return min+"m ago";
  const h=Math.round(min/60); if(h<24)return h+"h ago"; return Math.round(h/24)+"d ago"; }
function fmtDur(min){ if(min==null)return"—"; if(min<60)return min+"m"; const h=Math.floor(min/60),m=min%60; return m?h+"h "+m+"m":h+"h"; }
const METRICS=[
  {k:"cost",label:"Cost",get:s=>s.usage.estCostUsd||0,fmt:v=>"$"+v.toFixed(2)},
  {k:"tokens",label:"Tokens",get:s=>totalTok(s.usage),fmt:fmtTok},
  {k:"files",label:"Files",get:s=>s.filesChanged.length,fmt:v=>String(v)},
  {k:"tools",label:"Tool calls",get:s=>toolTotal(s.toolCounts),fmt:v=>String(v)},
  {k:"duration",label:"Duration",get:s=>s.durationMin||0,fmt:v=>v+"m"},
];
// How the chart breaks the metric down: one bar per session (default), or bars
// rolled up by user group / by project (the metric is summed across each).
const CHART_BY=[
  {k:"session",label:"By session"},
  {k:"group",label:"By group"},
  {k:"project",label:"By project"},
];
let SESSIONS=[], AP_AVAILABLE=false;
// state.scope narrows the WHOLE dashboard (survival, ROI, hero, recap, chart,
// list) to one user group — "show me my Business numbers". "all" = every session.
// state.chartBy is the chart's own breakdown (session / group / project).
const state={q:"",group:"group",sort:"recent",metric:"cost",scope:"all",chartBy:"session",off:new Set()};
// Item 2: multi-select sessions to see combined stats.
const selected=new Set();
function toggleSelect(id,ev){ if(ev)ev.stopPropagation(); selected.has(id)?selected.delete(id):selected.add(id); renderList(); renderSelbar(); }
function clearSelect(){ selected.clear(); renderList(); renderSelbar(); }

// User-defined groups (Personal / Entrepreneurial / Business …), server-persisted.
let GROUPS={groups:[],assignments:{}};
function groupOf(s){ return GROUPS.assignments[s.id]||"Ungrouped"; }
// A session is "in scope" when no group filter is active, or it's in the picked
// group. Every aggregate (survival, ROI, hero, recap, chart, list) reads through
// this so the whole dashboard can answer "just my Business sessions".
function inScope(s){ return state.scope==="all" || groupOf(s)===state.scope; }
function scoped(){ return SESSIONS.filter(inScope); }
async function postGroups(msg){
  const r=await fetch("/api/groups",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(msg)});
  const j=await r.json(); if(j&&j.ok&&j.store)GROUPS=j.store; return j;
}
// Assign the current multi-selection to a group (prompts for/offers a name).
async function assignSelectedToGroup(name){
  if(!selected.size)return;
  const ids=[...selected];
  await postGroups({op:"assign",sessionIds:ids,group:name});
  clearSelect();
  refreshGroupControls(); renderList(); toast(ids.length+" session(s) → "+name);
}
async function promptNewGroup(){
  const name=(window.prompt("New group name (e.g. Personal, Entrepreneurial, Business):")||"").trim();
  if(name) await assignSelectedToGroup(name);
}
// Rename one session — persists a custom title override server-side. Passing an
// empty string restores the original parsed title. The new title shows up
// everywhere (cards, chart, detail, CLI) because loadSessions applies it.
async function renameSessionPrompt(id){
  const s=SESSIONS.find(x=>x.id===id); if(!s)return;
  const next=window.prompt("Rename this session (blank restores the original title):",s.title);
  if(next===null)return; // cancelled
  const title=next.trim();
  const j=await postGroups({op:"rename-session",sessionId:id,title});
  if(!(j&&j.ok)){ toast("Rename failed"+(j&&j.error?": "+j.error:"")+"."); return; }
  // Re-fetch sessions so the title is authoritative — on a blank input the
  // server drops the override and loadSessions restores the parsed title,
  // which we can't reconstruct client-side.
  const fresh=await fetch("/api/sessions").then(r=>r.json()).catch(()=>null);
  if(fresh){ SESSIONS=fresh.map(f=>{ const old=SESSIONS.find(x=>x.id===f.id); return old?Object.assign(old,{title:f.title}):f; }); }
  renderAll();
  const s2=SESSIONS.find(x=>x.id===id); if(s2)openDetail(s2);
  toast(title?"Renamed session.":"Restored original title.");
}

// Recommendation state is SERVER-SIDE (shared with the agent), fetched into this
// map at load: recStates[sessionId][recId] = {status, by, note, at}. A rec is
// "accepted"/closed when status is done or skipped, set by either human or agent.
let recStates={};
function recStatus(sid,rid){const st=recStates[sid]&&recStates[sid][rid];return st?st.status:"open";}
function isAccepted(sid,rid){return recStatus(sid,rid)!=="open";}
async function setRecState(sid,rid,status,note){
  const r=await fetch("/api/recstate",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({sessionId:sid,recId:rid,status,by:"human",note})});
  const j=await r.json();
  if(j&&j.ok){ (recStates[sid]=recStates[sid]||{})[rid]=j.state; }
  return j;
}

function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function fmtDate(iso){if(!iso)return"—";const d=new Date(iso);return d.toLocaleDateString(undefined,{month:"short",day:"numeric"})+" "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});}
function shortModel(m){if(!m)return"—";const x=m.match(/(opus|sonnet|haiku)-([\\d-]+?)(?:-\\d{8})?$/);return x?x[1]+"-"+x[2]:m;}
function toolTotal(tc){return Object.values(tc||{}).reduce((a,b)=>a+b,0);}
function totalTok(u){return(u.inputTokens||0)+(u.cacheCreationTokens||0)+(u.cacheReadTokens||0)+(u.outputTokens||0);}
function fmtTok(n){return n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"k":String(n);}
function fmtCost(u){const c=u.estCostUsd||0;return c===0?"—":c>=1?"$"+c.toFixed(0):"$"+c.toFixed(2);}
function projectOf(s){if(!s.cwd)return"(no directory)";const p=s.cwd.split("/");return p[p.length-1]||s.cwd;}
function isVerified(s){return !!s.verified;}
function metric(){return METRICS.find(m=>m.k===state.metric);}

function passesFilter(s){
  if(!inScope(s))return false;
  if(state.off.has(s.outcome.label))return false;
  if(!state.q)return true;
  const hay=(s.title+" "+s.cwd+" "+(s.model||"")+" "+(s.gitBranch||"")+" "+s.filesChanged.map(f=>f.path).join(" ")).toLowerCase();
  return hay.includes(state.q.toLowerCase());
}
function sortSessions(arr){
  const by={recent:(a,b)=>new Date(b.startedAt||0)-new Date(a.startedAt||0),
    cost:(a,b)=>(b.usage.estCostUsd||0)-(a.usage.estCostUsd||0),
    files:(a,b)=>b.filesChanged.length-a.filesChanged.length};
  return arr.slice().sort(by[state.sort]||by.recent);
}

// Proven ROI: value the user actually banked by clicking "Mark done" on
// recommendations. Unlike the hero's "potential savings", this counts only
// COMPLETED recs (status==="done") — proof of what AgentTrace delivered, not
// what it might. Hidden until there's at least one done rec, so it never shows
// an empty "$0 saved" boast.
function renderRoi(){
  const el=document.getElementById("roi");
  const done=[];
  for(const s of scoped()){
    for(const r of (s.recommendations||[])){
      if(recStatus(s.id,r.id)==="done") done.push(r);
    }
  }
  if(!done.length){ el.className="roi"; el.innerHTML=""; return; }
  const saved=done.reduce((a,r)=>a+(r.product==="tokenkeeper"?(r.estSavingsUsd||0):0),0);
  const security=done.filter(r=>r.product==="sessionsentry").length;
  const workflow=done.filter(r=>r.product==="agenttrace").length;
  // Build metric tiles, only for dimensions that have value to show.
  const tiles=[];
  if(saved>0) tiles.push({v:"$"+saved.toFixed(saved<100?2:0),k:"saved / comparable run"});
  if(security>0) tiles.push({v:String(security),k:security===1?"security issue fixed":"security issues fixed"});
  if(workflow>0) tiles.push({v:String(workflow),k:workflow===1?"workflow improvement":"workflow improvements"});
  tiles.push({v:String(done.length),k:done.length===1?"recommendation applied":"recommendations applied"});
  const metricHtml=tiles.map((t,i)=>
    (i?'<div class="sep"></div>':'')+
    '<div class="metric"><div class="v">'+t.v+'</div><div class="k">'+t.k+'</div></div>').join("");
  el.className="roi show";
  el.innerHTML=
    '<div class="lead"><span class="spark">✨</span>AgentTrace has already paid off</div>'+
    metricHtml+
    '<div class="foot">Proven from recommendations you marked done. Savings are AgentTrace\\'s per-run estimate for each applied fix; security fixes reflect flagged risks you resolved.</div>';
}

// The headline: of the sessions that actually changed code in a git repo, what
// share survived (landed & still on HEAD) vs was reverted vs never committed?
// Untracked / no-edit sessions aren't part of the denominator — you can only
// measure survival where git can adjudicate it.
function renderSurvival(){
  const el=document.getElementById("survival");
  const scope=scoped();
  const kept=scope.filter(s=>s.outcome.label==="kept").length;
  const reverted=scope.filter(s=>s.outcome.label==="reverted").length;
  const uncommitted=scope.filter(s=>s.outcome.label==="uncommitted").length;
  const denom=kept+reverted+uncommitted;
  // A survival % off a tiny sample (e.g. 100% of 2) is misleading, not a hook.
  // Below the threshold we hide the number and explain what unlocks it, rather
  // than show a triumphant-but-empty percentage.
  const MIN_TRACKED=5;
  if(denom<MIN_TRACKED){
    const have=denom;
    el.innerHTML='<div class="bd"><h2>Survival rate — a few more git-tracked sessions to go</h2>'+
      '<div class="note">Survival rate needs at least '+MIN_TRACKED+' sessions that edited files inside a git repo; you have <b>'+have+'</b> so far'+
      (have?' ('+kept+' landed, '+reverted+' reverted, '+uncommitted+' uncommitted)':'')+'. '+
      'Run your agents inside git repositories and AgentTrace will show what share of their work actually survives.</div></div>';
    return;
  }
  const pct=Math.round(100*kept/denom);
  // Donut ring for the survival %.
  const R=58, C=2*Math.PI*R, dash=C*kept/denom;
  const color=pct>=70?"#3fb950":pct>=40?"#d29922":"#f85149";
  const seg=(cnt,col)=>cnt?'<i style="width:'+(100*cnt/denom)+'%;background:'+col+'"></i>':'';
  el.innerHTML=
    '<div class="ring">'+
      '<svg width="132" height="132" viewBox="0 0 132 132">'+
        '<circle cx="66" cy="66" r="'+R+'" fill="none" stroke="var(--panel2)" stroke-width="12"/>'+
        '<circle cx="66" cy="66" r="'+R+'" fill="none" stroke="'+color+'" stroke-width="12" '+
          'stroke-linecap="round" stroke-dasharray="'+dash+' '+C+'"/>'+
      '</svg>'+
      '<div class="big"><div class="v" style="color:'+color+'">'+pct+'%</div><div class="k">survived</div></div>'+
    '</div>'+
    '<div class="bd">'+
      '<h2>'+kept+' of '+denom+' coding sessions landed and stuck</h2>'+
      '<div class="sbar">'+seg(kept,"#3fb950")+seg(reverted,"#f85149")+seg(uncommitted,"#d29922")+'</div>'+
      '<div class="keys">'+
        '<span><span class="dot" style="background:#3fb950"></span><b>'+kept+'</b> landed ('+Math.round(100*kept/denom)+'%)</span>'+
        '<span><span class="dot" style="background:#f85149"></span><b>'+reverted+'</b> reverted ('+Math.round(100*reverted/denom)+'%)</span>'+
        '<span><span class="dot" style="background:#d29922"></span><b>'+uncommitted+'</b> uncommitted ('+Math.round(100*uncommitted/denom)+'%)</span>'+
      '</div>'+
      '<div class="note">Survival = committed and still on HEAD. Denominator is git-tracked sessions only ('+denom+' of '+scope.length+(state.scope==="all"?" total":" in "+esc(state.scope))+'); untracked & no-edit sessions are excluded.</div>'+
    '</div>';
}

function renderHero(){
  const scope=scoped();
  const n=scope.length;
  const cost=scope.reduce((a,s)=>a+(s.usage.estCostUsd||0),0);
  const tok=scope.reduce((a,s)=>a+totalTok(s.usage),0);
  const files=scope.reduce((a,s)=>a+s.filesChanged.length,0);
  const kept=scope.filter(s=>s.outcome.label==="kept").length;
  const commits=scope.reduce((a,s)=>a+s.outcome.commits.length,0);
  const verified=scope.filter(isVerified).length;
  const activeN=scope.filter(s=>s.active).length;
  const t={};LABELS.forEach(l=>t[l]=scope.filter(s=>s.outcome.label===l).length);
  const segs=LABELS.filter(l=>t[l]).map(l=>'<i style="width:'+(100*t[l]/n)+'%;background:'+LABEL_COLOR[l]+'" title="'+t[l]+' '+od(l).text+'"></i>').join("");
  // Recommendations: total count + potential $ savings, minus any accepted ones.
  const openRecs=scope.flatMap(s=>s.recommendations.filter(r=>!isAccepted(s.id,r.id)));
  const recCount=openRecs.length;
  const recSave=openRecs.reduce((a,r)=>a+(r.estSavingsUsd||0),0);
  // "Sessions traced" carries the landed breakdown as a hover.
  const landedHover=LABELS.filter(l=>t[l]).map(l=>t[l]+" "+od(l).text).join(" · ");
  document.getElementById("hero").innerHTML=
    stat(n,"sessions traced",'<div class="pct">'+segs+'</div>',landedHover+" — "+(n?Math.round(100*kept/n):0)+"% landed in git")+
    stat(activeN,"active now","<span class='sub' style='color:"+(activeN?"var(--kept)":"var(--dim)")+"'>"+(activeN?"agent(s) still running":"all idle")+"</span>")+
    stat("$"+cost.toFixed(0),"est. total spend","<span class='sub' style='color:var(--dim)'>"+fmtTok(tok)+" tokens</span>")+
    stat(recCount,"recommendations","<span class='sub' style='color:var(--gold)'>~$"+recSave.toFixed(0)+"/run potential savings</span>","AgentTrace found "+recCount+" ways to improve your agents, worth ~$"+recSave.toFixed(0)+" per comparable session if adopted")+
    stat(verified,"ActionProof verified","<span class='sub' style='color:"+(verified?"var(--kept)":"var(--dim)")+"'>"+(AP_AVAILABLE?"crypto-signed":"not installed")+"</span>");
}
function stat(n,l,sub,hover){return'<div class="stat"'+(hover?' title="'+esc(hover)+'"':'')+'><div class="n">'+n+'</div><div class="l">'+l+'</div>'+(sub||"")+'</div>';}

function renderRecap(){
  const scope=scoped();
  const n=scope.length;
  if(!n){document.getElementById("recap").innerHTML="";return;}
  const t={};LABELS.forEach(l=>t[l]=scope.filter(s=>s.outcome.label===l).length);
  const cost=scope.reduce((a,s)=>a+(s.usage.estCostUsd||0),0);
  const byProj={};scope.forEach(s=>{const p=projectOf(s);byProj[p]=(byProj[p]||0)+(s.usage.estCostUsd||0);});
  const topProj=Object.entries(byProj).sort((a,b)=>b[1]-a[1])[0];
  const priciest=scope.slice().sort((a,b)=>(b.usage.estCostUsd||0)-(a.usage.estCostUsd||0))[0];
  const chip=(l)=>t[l]?'<span class="chip badge '+l+'" title="'+esc(od(l).hint)+'">'+t[l]+' '+od(l).text+'</span>':"";
  const where=state.scope==="all"?"":' <span class="meta">('+esc(state.scope)+' only)</span>';
  document.getElementById("recap").innerHTML=
    '<h2>What your agents accomplished'+where+'</h2><p>'+
    'Across <b>'+n+' sessions</b> in <b>'+Object.keys(byProj).length+' projects</b>, your agents changed <b>'+
    scope.reduce((a,s)=>a+s.filesChanged.length,0)+' files</b> for an estimated <b>$'+cost.toFixed(0)+'</b>. '+
    'Outcomes: '+LABELS.map(chip).filter(Boolean).join(" ")+'. '+
    'Your priciest session was <b>'+esc(priciest.title)+'</b> (~'+fmtCost(priciest.usage)+'), and '+
    '<b>'+esc(topProj[0])+'</b> was your most expensive project (~$'+topProj[1].toFixed(0)+').'+
    (AP_AVAILABLE?" Click any session, then <b>Sign with ActionProof</b> to mint a verifiable receipt.":"")+
    '</p>';
}

// Populate the top-level scope selector: "All groups" + every group that has
// at least one session, each with its session count. Re-render everything on
// change so survival/ROI/hero/recap/chart/list all recompute for the pick.
function renderScopeSel(){
  const sel=document.getElementById("scopeSel");
  if(!sel)return;
  const counts={};
  SESSIONS.forEach(s=>{const g=groupOf(s);counts[g]=(counts[g]||0)+1;});
  // Show user-defined groups (in order) that have sessions, then any ad-hoc
  // group present in assignments, then Ungrouped.
  const ordered=(GROUPS.groups||[]).filter(g=>counts[g]);
  Object.keys(counts).forEach(g=>{ if(g!=="Ungrouped"&&!ordered.includes(g))ordered.push(g); });
  if(counts["Ungrouped"])ordered.push("Ungrouped");
  // If the current scope no longer has sessions, fall back to "all".
  if(state.scope!=="all"&&!counts[state.scope])state.scope="all";
  const opt=(val,label)=>'<option value="'+esc(val)+'"'+(state.scope===val?' selected':'')+'>'+esc(label)+'</option>';
  sel.innerHTML=opt("all","All groups ("+SESSIONS.length+")")+
    ordered.map(g=>opt(g,g+" ("+counts[g]+")")).join("");
}
function renderMetricSeg(){
  document.getElementById("metricSeg").innerHTML=METRICS.map(m=>
    '<button class="'+(m.k===state.metric?"on":"")+'" data-m="'+m.k+'">'+m.label+'</button>').join("");
  document.querySelectorAll("#metricSeg button").forEach(b=>b.onclick=()=>{state.metric=b.dataset.m;renderChart();renderMetricSeg();});
  // Chart breakdown: session / group / project.
  document.getElementById("chartBySeg").innerHTML=CHART_BY.map(c=>
    '<button class="'+(c.k===state.chartBy?"on":"")+'" data-c="'+c.k+'">'+c.label+'</button>').join("");
  document.querySelectorAll("#chartBySeg button").forEach(b=>b.onclick=()=>{state.chartBy=b.dataset.c;renderChart();renderMetricSeg();});
}
function renderChart(){
  const m=metric();
  const shown=sortSessions(SESSIONS.filter(passesFilter));
  const title=document.getElementById("chartTitle");
  const chartEl=document.getElementById("chart");

  // --- Rolled-up modes: one bar per group / project, metric summed across it ---
  if(state.chartBy!=="session"){
    const keyer=state.chartBy==="group"?groupOf:projectOf;
    const agg=new Map();
    shown.forEach(s=>{ const k=keyer(s); agg.set(k,(agg.get(k)||0)+(m.get(s)||0)); });
    // Honor the user's group order when bucketing by group; else sort by value.
    let entries=[...agg.entries()];
    if(state.chartBy==="group"){
      const order=GROUPS.groups||[];
      const rank=n=>{ if(n==="Ungrouped")return 1e6; const i=order.indexOf(n); return i<0?1e5:i; };
      entries.sort((a,b)=>rank(a[0])-rank(b[0]));
    }else{
      entries.sort((a,b)=>b[1]-a[1]);
    }
    entries=entries.slice(0,20);
    title.textContent=(state.chartBy==="group"?"Groups by ":"Projects by ")+m.label.toLowerCase();
    const max=Math.max(1,...entries.map(e=>e[1]));
    chartEl.innerHTML=entries.map(([name,v])=>{
      const h=Math.max(2,100*v/max);
      const isGroup=state.chartBy==="group";
      const color=isGroup?"#3fb950":"#58a6ff";
      const click=isGroup?' onclick="scopeTo(\\''+esc(name).replace(/'/g,"\\\\'")+'\\')" style="cursor:pointer"':'';
      return '<div class="bar" title="'+esc(name)+': '+m.fmt(v)+'"'+click+'>'+
        '<div class="v">'+m.fmt(v)+'</div>'+
        '<div class="fill" style="height:'+h+'%;background:linear-gradient(180deg,'+color+',#1f6feb)"></div>'+
        '<div class="x">'+esc(name)+'</div></div>';
    }).join("") || '<div class="empty">No sessions match.</div>';
    return;
  }

  // --- Default: one bar per session ---
  title.textContent="Sessions by "+m.label.toLowerCase();
  const top=shown.slice().sort((a,b)=>m.get(b)-m.get(a)).slice(0,20);
  const max=Math.max(1,...top.map(m.get));
  chartEl.innerHTML=top.map(s=>{
    const v=m.get(s), h=Math.max(2,100*v/max);
    return '<div class="bar" title="'+esc(s.title)+'" onclick="openDetailById(\\''+s.id+'\\')">'+
      '<div class="v">'+m.fmt(v)+'</div>'+
      '<div class="fill" style="height:'+h+'%;background:linear-gradient(180deg,'+LABEL_COLOR[s.outcome.label]+',#1f6feb)"></div>'+
      '<div class="x">'+esc(projectOf(s))+'</div></div>';
  }).join("") || '<div class="empty">No sessions match.</div>';
}
// Clicking a group bar scopes the whole dashboard to that group.
function scopeTo(name){ state.scope=name; renderAll(); }

function renderFilters(){
  const scope=scoped();
  const t={};LABELS.forEach(l=>t[l]=scope.filter(s=>s.outcome.label===l).length);
  document.getElementById("filters").innerHTML=LABELS.filter(l=>t[l]).map(l=>
    '<span class="chip badge '+l+(state.off.has(l)?' off':'')+'" data-l="'+l+'" title="'+esc(od(l).hint)+'">'+t[l]+' '+od(l).text+'</span>').join("");
  document.querySelectorAll("#filters .chip").forEach(c=>c.onclick=()=>{
    const l=c.dataset.l; state.off.has(l)?state.off.delete(l):state.off.add(l);
    renderFilters(); renderChart(); renderList();
  });
  // One-line legend so the outcome words are self-explanatory.
  const present=LABELS.filter(l=>t[l]);
  document.getElementById("legend").innerHTML="Outcome = did the work land? "+
    present.map(l=>'<b>'+od(l).text+'</b> — '+od(l).hint).join("  ·  ");
}

function cardHtml(s){
  const files=s.filesChanged.length, tools=toolTotal(s.toolCounts);
  const verified=isVerified(s)?'<span class="verified">✓ verified</span>':'';
  const live=s.active?'<span class="live">● active</span>':'';
  const openRecN=(s.recommendations||[]).filter(r=>recStatus(s.id,r.id)==="open").length;
  const recs=openRecN?'<span class="recpill">💡 '+openRecN+'</span>':'';
  const gname=GROUPS.assignments[s.id];
  const gbadge=gname?'<span class="gbadge" title="Group">'+esc(gname)+'</span>':'';
  const sel=selected.has(s.id);
  return '<div class="card'+(sel?' selected':'')+'" onclick="openDetailById(\\''+s.id+'\\')">'+
    '<div class="top">'+
      '<input type="checkbox" class="sel" '+(sel?'checked':'')+' onclick="toggleSelect(\\''+s.id+'\\',event)" title="Select to compare">'+
      '<span class="badge '+s.outcome.label+'" title="'+esc(od(s.outcome.label).hint)+'">'+od(s.outcome.label).text+'</span>'+
      '<span class="title">'+esc(s.title)+'</span>'+gbadge+live+verified+recs+
      '<span class="meta">'+relTime(s.idleMin)+'</span></div>'+
    '<div class="meta">'+
      '⏱ '+fmtDate(s.startedAt)+' → '+fmtDate(s.endedAt)+' ('+fmtDur(s.durationMin)+') · '+
      shortModel(s.model)+' · '+files+' file(s) · '+s.actions.length+' action(s) · '+
      '<span class="cost">'+fmtTok(totalTok(s.usage))+' tok ~'+fmtCost(s.usage)+'</span>'+
      (s.cwd?' · '+esc(s.cwd.split("/").slice(-2).join("/")):'')+'</div></div>';
}
function groupHead(name,items){
  const cost=items.reduce((a,s)=>a+(s.usage.estCostUsd||0),0);
  const files=items.reduce((a,s)=>a+s.filesChanged.length,0);
  return '<div class="group-head"><span class="name">'+esc(name)+'</span>'+
    '<span class="gmeta">'+items.length+' session(s) · '+files+' file(s) · ~$'+cost.toFixed(2)+'</span></div>';
}
function renderList(){
  const list=document.getElementById("list");
  if(!SESSIONS.length){list.innerHTML='<div class="empty">No Claude Code sessions found under ~/.claude/projects yet.<br>Run an agent session, then refresh.</div>';return;}
  const shown=sortSessions(SESSIONS.filter(passesFilter));
  const spend=shown.reduce((a,s)=>a+(s.usage.estCostUsd||0),0);
  document.getElementById("spend").innerHTML='showing <b>'+shown.length+'</b> · est. spend <b>$'+spend.toFixed(2)+'</b>';
  if(!shown.length){list.innerHTML='<div class="empty">No sessions match the current filters.</div>';return;}
  if(state.group==="none"){list.innerHTML=shown.map(cardHtml).join("");return;}
  const keyer=state.group==="project"?projectOf:state.group==="group"?groupOf:(s=>s.outcome.label);
  const groups=new Map();
  shown.forEach(s=>{const k=keyer(s);(groups.get(k)||groups.set(k,[]).get(k)).push(s);});
  // When grouping by user groups, honor the user's defined order, then any
  // ad-hoc groups, then "Ungrouped" last. Otherwise keep insertion order.
  let entries=[...groups.entries()];
  if(state.group==="group"){
    const order=GROUPS.groups||[];
    const rank=n=>{ if(n==="Ungrouped")return 1e6; const i=order.indexOf(n); return i<0?1e5:i; };
    entries.sort((a,b)=>rank(a[0])-rank(b[0]));
  }
  list.innerHTML=entries.map(([name,items])=>groupHead(name,items)+items.map(cardHtml).join("")).join("");
}

// Item 2: floating bar summarizing the combined stats of selected sessions.
function renderSelbar(){
  let bar=document.getElementById("selbar");
  if(!selected.size){ if(bar)bar.className=""; return; }
  if(!bar){ bar=document.createElement("div"); bar.id="selbar"; document.body.appendChild(bar); }
  const sel=SESSIONS.filter(s=>selected.has(s.id));
  const cost=sel.reduce((a,s)=>a+(s.usage.estCostUsd||0),0);
  const tok=sel.reduce((a,s)=>a+totalTok(s.usage),0);
  const files=sel.reduce((a,s)=>a+s.filesChanged.length,0);
  const acts=sel.reduce((a,s)=>a+s.actions.length,0);
  const dur=sel.reduce((a,s)=>a+(s.durationMin||0),0);
  const projects=new Set(sel.map(projectOf)).size;
  bar.className="show";
  // Buttons to file the selection under an existing group, a new one, or clear it.
  const groupBtns=(GROUPS.groups||[]).map(g=>
    '<button class="sb-grp" onclick="assignSelectedToGroup(\\''+g.replace(/'/g,"\\\\'")+'\\')">'+esc(g)+'</button>').join("");
  bar.innerHTML=
    '<b>'+sel.size+' selected</b>'+(projects>1?' · '+projects+' projects':'')+
    '<span class="sb">~$'+cost.toFixed(2)+'</span>'+
    '<span class="sb">'+fmtTok(tok)+' tok</span>'+
    '<span class="sb">'+files+' files</span>'+
    '<span class="sb">'+acts+' actions</span>'+
    '<span class="sb">'+fmtDur(dur)+' total</span>'+
    '<span class="sb-grp-label">group into:</span>'+groupBtns+
    '<button class="sb-grp new" onclick="promptNewGroup()">+ new</button>'+
    '<button class="sb-grp" onclick="assignSelectedToGroup(null)" title="Remove from any group">ungroup</button>'+
    '<button class="sb-clear" onclick="clearSelect()">clear</button>';
}
// Re-sync scope-dependent controls after group assignments change: the scope
// dropdown gains/loses groups, and every aggregate may shift.
function refreshGroupControls(){ renderScopeSel(); renderSurvival(); renderRoi(); renderHero(); renderRecap(); renderChart(); renderFilters(); }

function openDetailById(id){ const s=SESSIONS.find(x=>x.id===id); if(s) openDetail(s); }

function recHtml(s,r){
  const icon={skill:"🧩",cost:"💰",workflow:"🔀",quality:"✅",security:"🛡️"}[r.kind]||"💡";
  const st=recStates[s.id]&&recStates[s.id][r.id];
  const status=st?st.status:"open";
  const save=r.estSavingsUsd>0?'<span class="rec-save">~$'+r.estSavingsUsd.toFixed(2)+'/run</span>':'';
  if(status!=="open"){
    const who=st?(st.by==="agent"?"by agent":"by you"):"";
    const label=status==="done"?"✓ done":"⊘ skipped";
    const banked=(status==="done"&&r.estSavingsUsd>0)?" · banked ~$"+r.estSavingsUsd.toFixed(2)+"/run":"";
    return '<div class="rec accepted"><div class="rec-t">'+label+' '+esc(r.title)+
      '<span class="rec-imp" style="color:'+(status==="done"?"var(--kept)":"var(--dim)")+'">'+status+' '+who+banked+
      (st&&st.note?' — '+esc(st.note):'')+'</span></div>'+
      '<button class="rec-undo" onclick="undoRec(\\''+s.id+'\\',\\''+r.id+'\\')">reopen</button></div>';
  }
  const cwd=esc(s.cwd||"");
  return '<div class="rec '+r.impact+'" id="rec-'+r.id+'">'+
    '<div class="rec-t">'+icon+' '+esc(r.title)+' '+prodBadge(r.product)+save+'<span class="rec-imp">'+r.impact+'</span></div>'+
    '<div class="meta">'+esc(r.detail)+'</div>'+
    '<div class="rec-prompt-wrap"><div class="rec-plabel">Prompt for your next session</div>'+
      '<pre class="rec-prompt" id="pr-'+r.id+'">'+esc(r.prompt)+'</pre></div>'+
    '<div class="rec-btns">'+
      '<button class="btn-sm" onclick="copyPrompt(\\''+r.id+'\\',this)">Copy prompt</button>'+
      '<button class="btn-sm ghost" onclick="openInAgent(\\''+cwd+'\\',\\''+r.id+'\\')">Open in Claude Code ↗</button>'+
      '<button class="btn-sm ghost" onclick="skipRec(\\''+s.id+'\\',\\''+r.id+'\\')">Skip</button>'+
      '<button class="btn-sm accept" onclick="acceptAndBank(\\''+s.id+'\\',\\''+r.id+'\\')">Mark done'+(r.estSavingsUsd>0?" (save ~$"+r.estSavingsUsd.toFixed(2)+")":"")+'</button>'+
    '</div></div>';
}

function actionRow(s,a){
  const v=isVerified(s)||a.verified; // whole-session sign marks all actions verified
  let badge;
  if(v){
    // Item 7: once verified, the ✓ is clickable to view the proof/receipt.
    badge='<button class="a-ok" title="View proof" onclick="event.stopPropagation();showProof(\\''+s.id+'\\','+a.seq+')">✓ proof</button>';
  }else if(AP_AVAILABLE){
    const cls=a.critical?"a-verify crit":"a-verify";
    badge='<button class="'+cls+'" onclick="event.stopPropagation();signAction(\\''+s.id+'\\','+a.seq+')">verify</button>';
  }else badge='';
  const critTag=a.critical&&!v?'<span class="crit-tag" title="'+esc(a.risk||"")+'">⚠ verify recommended</span>':'';
  return '<div class="arow'+(a.critical?' is-crit':'')+'"><span class="a-type">'+esc(a.type)+'</span>'+
    '<span class="a-sum">'+esc(a.summary)+critTag+'</span>'+
    '<span class="a-ts">'+(a.ts?fmtDate(a.ts):'')+'</span>'+badge+'</div>';
}

function openDetail(s){
  const d=document.getElementById("detail");
  const files=s.filesChanged.map(f=>'<li><span class="tag '+(f.created?"new":"edit")+'">'+(f.created?"new":"edit")+'</span>'+esc(f.path)+' ×'+f.edits+'</li>').join("");
  const commits=s.outcome.commits.map(c=>'<li>'+c.hash.slice(0,8)+' '+esc(c.subject)+'</li>').join("");
  const o=od(s.outcome.label);
  const timeline=s.active
    ? '<span class="live">● active</span> last activity '+relTime(s.idleMin)
    : 'ended '+relTime(s.idleMin);
  const openRecs=(s.recommendations||[]).filter(r=>!isAccepted(s.id,r.id));
  const doneRecs=(s.recommendations||[]).filter(r=>isAccepted(s.id,r.id));
  const recs=(s.recommendations&&s.recommendations.length)
    ? '<h3>recommendations to improve this agent ('+openRecs.length+' open'+(doneRecs.length?', '+doneRecs.length+' done':'')+')</h3>'+
      (openRecs.length?openRecs.map(r=>recHtml(s,r)).join(""):'<div class="meta">All recommendations accepted — nice. 🎉</div>')+
      doneRecs.map(r=>recHtml(s,r)).join("")
    : '<h3>recommendations</h3><div class="meta">No issues detected — this session looks efficient.</div>';
  const crit=s.actions.filter(a=>a.critical);
  const critUnverified=crit.filter(a=>!(isVerified(s)||a.verified));
  const riskBanner=critUnverified.length
    ? '<div class="riskbanner">⚠ <b>'+critUnverified.length+' high-consequence action(s)</b> are unverified — '+
      'deploys, pushes, or destructive commands with no tamper-evident proof of what ran. '+
      'Verify the critical ones below to close this gap.</div>'
    : (crit.length?'<div class="riskbanner ok">✓ All '+crit.length+' high-consequence action(s) verified.</div>':'');
  // Item 1: actions needing proof (critical + unverified) float to the top;
  // then remaining critical, then the rest — each group keeps original order.
  const actionRank=a=>{
    const ver=isVerified(s)||a.verified;
    if(a.critical&&!ver)return 0;      // needs proof — top
    if(a.critical)return 1;            // critical but already verified
    return 2;                          // everything else
  };
  const sortedActions=s.actions.map((a,i)=>[a,i]).sort((x,y)=>{
    const r=actionRank(x[0])-actionRank(y[0]); return r||(x[1]-y[1]);
  }).map(p=>p[0]);
  const actionsHtml=s.actions.length
    ? '<h3>actions ('+s.actions.length+') — the unit ActionProof verifies · '+crit.length+' critical'+
        (critUnverified.length?' · <span style="color:var(--reverted)">'+critUnverified.length+' need proof</span>':'')+'</h3>'+
      riskBanner+
      '<div class="alist">'+sortedActions.map(a=>actionRow(s,a)).join("")+'</div>'
    : '';
  const signInner = isVerified(s)
    ? '<b style="color:var(--kept)">✓ All actions verified by ActionProof</b><div class="meta">Signed by '+esc(s.agent||"")+'</div>'+
      (s.receipt?'<div class="receipt">'+esc(JSON.stringify(s.receipt,null,2))+'</div>':'')
    : (AP_AVAILABLE
        ? '<b>Sign this whole session</b>'+
          '<div class="meta" style="margin:6px 0 12px">Mint one tamper-evident Ed25519 receipt over the session\\'s outcome — the same identity your ActionProof MCP server uses. Or verify individual actions above.</div>'+
          '<button class="btn" id="signBtn" onclick="doSign(\\''+s.id+'\\')">Sign session with ActionProof</button>'+
          '<div id="signResult"></div>'
        : '<b>ActionProof not installed</b><div class="meta">Clone ActionProof next to agenttrace (or set ACTIONPROOF_DIR) to sign actions into verifiable receipts.</div>');
  d.innerHTML=
    '<div class="dhead"><button class="close" onclick="detail.close()">×</button>'+
      '<div class="title" style="font-size:16px">'+esc(s.title)+
        ' <button class="rename-btn" title="Rename this session" onclick="renameSessionPrompt(\\''+s.id+'\\')">✎ rename</button></div>'+
      '<div class="meta">'+esc(s.id)+'</div></div>'+
    '<div class="dbody">'+
      '<div class="kv">'+
        '<span class="k">outcome</span><span><span class="badge '+s.outcome.label+'" title="'+esc(o.hint)+'">'+o.text+'</span> <span class="meta">'+esc(o.hint)+'</span></span>'+
        '<span class="k">timeframe</span><span>'+fmtDate(s.startedAt)+' → '+fmtDate(s.endedAt)+' · ran '+fmtDur(s.durationMin)+' · '+timeline+'</span>'+
        '<span class="k">model</span><span>'+shortModel(s.model)+'</span>'+
        '<span class="k">cwd</span><span>'+esc(s.cwd||"—")+(s.gitBranch?" @ "+esc(s.gitBranch):"")+'</span>'+
        '<span class="k">messages</span><span>'+s.userMessages+' you · '+s.assistantMessages+' agent</span>'+
        '<span class="k">usage</span><span>'+fmtTok(s.usage.inputTokens)+' in · '+fmtTok(s.usage.outputTokens)+' out · '+fmtTok(s.usage.cacheReadTokens)+' cache-read · ~'+fmtCost(s.usage)+'</span>'+
      '</div>'+
      recs+
      actionsHtml+
      (files?'<h3>files changed ('+s.filesChanged.length+')</h3><ul class="files">'+files+'</ul>':'')+
      (commits?'<h3>commits</h3><ul class="commits">'+commits+'</ul>':'')+
      (s.prs&&s.prs.length?'<h3>pull requests</h3><ul>'+s.prs.map(p=>'<li>#'+p.number+' '+esc(p.url)+'</li>').join("")+'</ul>':'')+
      '<div class="signbox'+(isVerified(s)?' done':'')+'" id="signbox">'+signInner+'</div>'+
      '<h3>make this analysis agent-readable</h3>'+
      '<div class="meta" style="margin-bottom:10px">Hand this session\\'s analysis to your coding agent so it can plan against it, implement the recommendations, and mark each one done or skipped — that state flows back here.</div>'+
      '<div class="rec-btns">'+
        '<button class="btn-sm" onclick="copyAnalysis(\\''+s.id+'\\',this)">Copy analysis for agent</button>'+
        '<button class="btn-sm ghost" onclick="window.open(\\'/api/analysis?id='+s.id+'&format=md\\',\\'_blank\\')">View Markdown ↗</button>'+
        '<button class="btn-sm ghost" onclick="window.open(\\'/api/analysis?id='+s.id+'&format=json\\',\\'_blank\\')">View JSON ↗</button>'+
      '</div>'+
    '</div>';
  d.showModal();
}

async function doSign(id){
  const btn=document.getElementById("signBtn"), out=document.getElementById("signResult");
  if(btn){btn.disabled=true;btn.textContent="Signing…";}
  try{
    const r=await fetch("/api/sign",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    const j=await r.json();
    if(!j.ok){ if(out)out.innerHTML='<div class="meta" style="color:var(--reverted);margin-top:10px">'+esc(j.error||"Signing failed")+'</div>'; if(btn){btn.disabled=false;btn.textContent="Sign with ActionProof";} return; }
    // Update local state + re-render so the ✓ badge appears everywhere.
    const s=SESSIONS.find(x=>x.id===id);
    Object.assign(s,{verified:j.receipt.verified,agent:j.receipt.agent,receipt:j.receipt.receipt});
    renderHero(); renderRecap(); renderChart(); renderList();
    openDetail(s); // reopen with the verified view
  }catch(e){ if(out)out.innerHTML='<div class="meta" style="color:var(--reverted)">'+esc(e.message)+'</div>'; if(btn){btn.disabled=false;btn.textContent="Sign session with ActionProof";} }
}

async function signAction(id,seq){
  const s=SESSIONS.find(x=>x.id===id); if(!s)return;
  try{
    const r=await fetch("/api/sign",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,seq})});
    const j=await r.json();
    if(!j.ok){ alert("Verify failed: "+(j.error||"unknown")); return; }
    const a=s.actions.find(x=>x.seq===seq); if(a){a.verified=true;a.receipt=j.receipt;}
    renderHero(); openDetail(s); // re-render with the ✓ + banked risk reduction
  }catch(e){ alert("Verify failed: "+e.message); }
}

// Item 7: show the cryptographic proof for a verified action.
function showProof(sid,seq){
  const s=SESSIONS.find(x=>x.id===sid); if(!s)return;
  const a=s.actions.find(x=>x.seq===seq);
  const receipt=(a&&a.receipt)||s.receipt; // per-action receipt, or the session receipt
  const agent=(s.agent)||"";
  const p=document.getElementById("proof");
  p.innerHTML=
    '<div class="dhead"><button class="close" onclick="proof.close()">×</button>'+
      '<div class="title" style="font-size:15px">🔐 ActionProof receipt</div>'+
      '<div class="meta">'+esc(a?a.summary:s.title)+'</div></div>'+
    '<div class="dbody">'+
      '<div class="kv">'+
        '<span class="k">status</span><span><span class="verified">✓ verified</span> — signature checks out; any edit to the receipt breaks it.</span>'+
        '<span class="k">signed by</span><span>'+esc(agent||(receipt&&receipt.receipt&&receipt.receipt.agent&&receipt.receipt.agent.id)||"agent key")+'</span>'+
        '<span class="k">algorithm</span><span>Ed25519 (offline-verifiable)</span>'+
      '</div>'+
      '<h3>signed receipt</h3>'+
      '<div class="receipt">'+esc(JSON.stringify(receipt,null,2))+'</div>'+
      '<div class="meta" style="margin-top:12px">This is a real ActionProof receipt. Anyone can verify it offline with the agent\\'s public key — no server, no trust in AgentTrace.</div>'+
    '</div>';
  p.showModal();
}

// --- Recommendation actions (items 2/3/4) ---
function copyPrompt(rid,btn){
  const el=document.getElementById("pr-"+rid); if(!el)return;
  navigator.clipboard.writeText(el.textContent).then(()=>{
    const old=btn.textContent; btn.textContent="Copied ✓"; setTimeout(()=>btn.textContent=old,1400);
  });
}
// Open Claude Code in the session's project with the prompt pre-filled. Every
// session AgentTrace traces is Claude Code, so we ask the local server to launch
// claude in a new terminal at the session's cwd (macOS). We always also copy
// the prompt to the clipboard as a fallback.
function openInAgent(cwd,rid){
  const el=document.getElementById("pr-"+rid);
  const prompt=el?el.textContent:"";
  if(prompt) navigator.clipboard.writeText(prompt).catch(()=>{});
  if(!cwd){ toast("Prompt copied to clipboard."); return; }
  fetch("/api/launch",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({cwd:cwd,prompt:prompt})})
    .then(r=>r.json())
    .then(res=>{
      if(res&&res.ok) toast("Opening Claude Code in "+cwd+" — the prompt is pre-filled.");
      else toast("Prompt copied. Open a terminal in "+cwd+" and run: claude \\"<paste>\\"");
    })
    .catch(()=>toast("Prompt copied. Open a terminal in "+cwd+" and run claude, then paste."));
}
async function acceptAndBank(sid,rid){
  await setRecState(sid,rid,"done");
  const s=SESSIONS.find(x=>x.id===sid);
  const r=s&&s.recommendations.find(x=>x.id===rid);
  renderRoi(); renderHero(); renderList(); if(s) openDetail(s);
  // Confirm the proven value banked, tailored to what kind of win it was.
  if(r){
    if(r.product==="tokenkeeper"&&r.estSavingsUsd>0) toast("Banked ~$"+r.estSavingsUsd.toFixed(2)+"/run — AgentTrace ROI updated.");
    else if(r.product==="sessionsentry") toast("Security issue resolved — AgentTrace ROI updated.");
    else toast("Improvement applied — AgentTrace ROI updated.");
  }
}
async function skipRec(sid,rid){ await setRecState(sid,rid,"skipped"); const s=SESSIONS.find(x=>x.id===sid); renderRoi(); renderHero(); renderList(); if(s) openDetail(s); }
async function undoRec(sid,rid){ await setRecState(sid,rid,"open"); const s=SESSIONS.find(x=>x.id===sid); renderRoi(); renderHero(); renderList(); if(s) openDetail(s); }

function copyAnalysis(sid,btn){
  fetch("/api/analysis?id="+sid+"&format=md").then(r=>r.text()).then(md=>{
    navigator.clipboard.writeText(md).then(()=>{
      const old=btn.textContent; btn.textContent="Copied ✓ — paste into your agent"; setTimeout(()=>btn.textContent=old,2200);
    });
  });
}
function toast(msg){
  let t=document.getElementById("toast");
  if(!t){t=document.createElement("div");t.id="toast";document.body.appendChild(t);}
  t.textContent=msg; t.className="show"; clearTimeout(toast._t); toast._t=setTimeout(()=>t.className="",4000);
}

// Re-render every scope-sensitive surface (used on load and when the group
// scope changes). Keeps the aggregates and the list in lockstep.
function renderAll(){
  renderScopeSel(); renderSurvival(); renderRoi(); renderHero(); renderRecap();
  renderMetricSeg(); renderChart(); renderFilters(); renderList(); renderSelbar();
}
function boot(data,apAvailable,states,groups){
  SESSIONS=data; AP_AVAILABLE=apAvailable; recStates=states||{};
  GROUPS=groups||{groups:[],assignments:{}};
  renderAll();
}
document.getElementById("scopeSel").addEventListener("change",e=>{state.scope=e.target.value;renderAll();});
document.getElementById("search").addEventListener("input",e=>{state.q=e.target.value;renderChart();renderList();});
document.getElementById("groupBy").addEventListener("change",e=>{state.group=e.target.value;renderList();});
document.getElementById("sortBy").addEventListener("change",e=>{state.sort=e.target.value;renderList();});

Promise.all([
  fetch("/api/sessions").then(r=>r.json()),
  fetch("/api/status").then(r=>r.json()).catch(()=>({actionproof:false})),
  fetch("/api/recstate").then(r=>r.json()).catch(()=>({})),
  fetch("/api/groups").then(r=>r.json()).catch(()=>({groups:[],assignments:{}})),
]).then(([sessions,status,states,groups])=>boot(sessions,status.actionproof,states,groups))
  .catch(e=>{document.getElementById("list").innerHTML='<div class="empty">Failed to load: '+esc(e.message)+'</div>';});
</script>
</body>
</html>`;
}

/** A hostname is loopback if it's localhost or a 127.x / ::1 literal. */
export function isLoopbackHost(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    // Bracketed IPv6 literal, possibly with a :port — "[::1]:4317".
    const close = h.indexOf("]");
    h = close === -1 ? h.slice(1) : h.slice(1, close);
  } else if ((h.match(/:/g) ?? []).length === 1) {
    // Exactly one colon → "host:port"; strip the port. (An unbracketed IPv6
    // literal like "::1" has multiple colons and is left intact.)
    h = h.slice(0, h.lastIndexOf(":"));
  }
  return h === "localhost" || h === "::1" || h === "127.0.0.1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Accept a request only if it's genuinely local: the Host header must be a
 * loopback literal (defeats DNS rebinding), and any Origin/Referer present must
 * itself be loopback (defeats a random web page POSTing to our port). Requests
 * with no Origin (curl, the agent, same-origin navigations) are allowed through
 * the Origin check but still gated by the Host check.
 */
export function isLocalRequest(req: { headers: Record<string, unknown> }): boolean {
  const host = String(req.headers["host"] ?? "");
  if (!host || !isLoopbackHost(host)) return false;
  const origin = req.headers["origin"];
  if (typeof origin === "string" && origin) {
    try {
      if (!isLoopbackHost(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  const referer = req.headers["referer"];
  if (typeof referer === "string" && referer) {
    try {
      if (!isLoopbackHost(new URL(referer).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Single-quote a string for POSIX shells (wraps and escapes embedded quotes). */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** Quote a string as an AppleScript string literal for `osascript -e`. */
export function appleScriptString(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Start the dashboard server. `load` is injected (the CLI passes a function that
 * discovers+parses+correlates) so the data layer stays testable and decoupled.
 */
export function serve(port: number, load: () => Session[]): Promise<void> {
  // Attach any existing verified-receipt flags to sessions before sending.
  function sessionsWithVerification(): (Session & { verified?: boolean })[] {
    const verified = verifiedSessionIds();
    return load().map((s) => (verified.has(s.id) ? { ...s, verified: true } : s));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // --- Local-only guard (DNS-rebinding / CSRF protection) ---
    // We bind to 127.0.0.1, but a malicious web page you visit could still POST
    // to http://127.0.0.1:<port> from your browser, and a DNS-rebinding attack
    // could point an attacker-controlled hostname at 127.0.0.1. Since some
    // endpoints spawn processes (/api/launch) and write files (/api/sign), we
    // require the Host header to be a loopback literal, and reject any request
    // carrying a cross-origin Origin/Referer. Same-origin browser requests send
    // Origin=http://127.0.0.1:<port> (fine); curl/agent requests send no Origin.
    if (!isLocalRequest(req)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden: AgentTrace only accepts local requests");
      return;
    }

    if (url.pathname === "/api/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(sessionsWithVerification()));
      return;
    }

    // Shared recommendation state (read by dashboard AND agent).
    if (url.pathname === "/api/recstate" && req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(readStore()));
      return;
    }
    if (url.pathname === "/api/recstate" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { sessionId, recId, status, by, note } = JSON.parse(body);
        if (!sessionId || !recId || !["open", "done", "skipped"].includes(status)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "need sessionId, recId, status(open|done|skipped)" }));
          return;
        }
        const state = setRecState(sessionId, recId, status, by === "agent" ? "agent" : "human", new Date().toISOString(), note);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, state }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    // --- User-defined session groups (Personal / Entrepreneurial / …) ---
    if (url.pathname === "/api/groups" && req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(readGroups()));
      return;
    }
    if (url.pathname === "/api/groups" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const msg = JSON.parse(body);
        let store;
        switch (msg.op) {
          case "assign":
            // { op:"assign", sessionIds:[...], group:"Business" | null }
            if (!Array.isArray(msg.sessionIds)) throw new Error("sessionIds must be an array");
            store = assignSessions(msg.sessionIds, msg.group ?? null);
            break;
          case "add":
            if (!msg.name) throw new Error("need name");
            store = addGroup(String(msg.name));
            break;
          case "rename":
            if (!msg.from || !msg.to) throw new Error("need from and to");
            store = renameGroup(String(msg.from), String(msg.to));
            break;
          case "rename-session":
            // { op:"rename-session", sessionId, title }  (blank title clears it)
            if (!msg.sessionId) throw new Error("need sessionId");
            store = renameSession(String(msg.sessionId), String(msg.title ?? ""));
            break;
          case "delete":
            if (!msg.name) throw new Error("need name");
            store = deleteGroup(String(msg.name));
            break;
          default:
            throw new Error("unknown op (assign|add|rename|rename-session|delete)");
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, store }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    // Agent-readable analysis of one session (Markdown or JSON).
    if (url.pathname === "/api/analysis") {
      const id = url.searchParams.get("id") ?? "";
      const format = url.searchParams.get("format") ?? "md";
      const session = load().find((s) => s.id === id || s.id.startsWith(id));
      if (!session) {
        res.writeHead(404).end("session not found");
        return;
      }
      if (format === "json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(toAgentJson(session), null, 2));
      } else {
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        res.end(toAgentMarkdown(session));
      }
      return;
    }

    // Open Claude Code in the session's project with a recommendation prompt.
    // Every session AgentTrace traces is Claude Code, so we launch `claude`
    // (not Cursor). On macOS we open a new Terminal tab in the session's cwd
    // and run `claude "<prompt>"`; the prompt is passed via a temp file to
    // avoid any shell-quoting issues. Falls back to { ok:false } so the client
    // can copy-to-clipboard instead.
    if (url.pathname === "/api/launch" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let cwd = "";
      let prompt = "";
      try {
        const parsed = JSON.parse(body);
        cwd = String(parsed.cwd ?? "");
        prompt = String(parsed.prompt ?? "");
      } catch {
        /* ignore */
      }
      if (!cwd || !prompt) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "need cwd and prompt" }));
        return;
      }
      try {
        // Stash the prompt in a temp file so no quoting/escaping is needed.
        const dir = mkdtempSync(join(tmpdir(), "agenttrace-"));
        const promptFile = join(dir, "prompt.txt");
        writeFileSync(promptFile, prompt, "utf8");
        // A shell one-liner Terminal will run: cd into the project, read the
        // prompt from the file into a var, launch claude with it interactively.
        const shellCmd =
          `cd ${shellQuote(cwd)} && ` +
          `AT_PROMPT="$(cat ${shellQuote(promptFile)})" && ` +
          `rm -f ${shellQuote(promptFile)} && ` +
          `claude "$AT_PROMPT"`;
        if (process.platform === "darwin") {
          // Ask Terminal.app to open a new window running our command.
          const osa = `tell application "Terminal"\n  activate\n  do script ${appleScriptString(shellCmd)}\nend tell`;
          const child = spawn("osascript", ["-e", osa], { detached: true, stdio: "ignore" });
          child.unref();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, launched: "terminal" }));
        } else {
          // No cross-platform terminal-spawn story yet; let the client fall back.
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "unsupported platform; prompt copied instead" }));
        }
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    if (url.pathname === "/api/status") {
      const actionproof = await isActionProofAvailable();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ actionproof }));
      return;
    }

    // Proven ROI aggregate (recommendations marked done). Authoritative,
    // server-side calc — handy for scripting or tracking ROI over time.
    if (url.pathname === "/api/roi") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(provenRoi(load())));
      return;
    }

    if (url.pathname === "/api/sign" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let id = "";
      let seq: number | undefined;
      try {
        const parsed = JSON.parse(body);
        id = parsed.id;
        seq = typeof parsed.seq === "number" ? parsed.seq : undefined;
      } catch {
        /* ignore */
      }
      const session = load().find((s) => s.id === id);
      if (!session) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "session not found" }));
        return;
      }
      const result =
        seq != null
          ? await signAction(session, seq, new Date().toISOString())
          : await signSession(session, new Date().toISOString());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === "/api/transcript") {
      const id = url.searchParams.get("id") ?? "";
      const s = load().find((x) => x.id.startsWith(id));
      if (!s) {
        res.writeHead(404).end("not found");
        return;
      }
      try {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(readFileSync(s.transcriptPath, "utf8"));
      } catch {
        res.writeHead(500).end("could not read transcript");
      }
      return;
    }

    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(pageHtml());
      return;
    }

    res.writeHead(404).end("not found");
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    // 127.0.0.1 only — never expose the dashboard beyond the local machine.
    server.listen(port, "127.0.0.1", () => {
      console.log(`\n  AgentTrace dashboard → http://127.0.0.1:${port}\n  (Ctrl-C to stop)\n`);
      resolve();
    });
  });
}
