import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import formidable from "formidable";
import type { HealthRunMeta } from "./orchestrate-health.js";
import type { HealthProgressEvent } from "./progress-events.js";
import { renderHtmlFileToPdf } from "./html-to-pdf.js";
import { parseUrlsFromText } from "./load-urls.js";
import {
  buildGeminiPayloadFromReports,
  generateGeminiRunAnswer,
  resolveGeminiApiKey,
} from "./gemini-report.js";
import { orchestrateHealthCheck } from "./orchestrate-health.js";
import { extractUrlsFromPdfBuffer } from "./pdf-urls.js";
import type { SiteHealthReport } from "./types.js";

function webDistRoot(): string {
  return path.join(process.cwd(), "web", "dist");
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const f = path.resolve(candidate);
  return f === r || f.startsWith(r + path.sep);
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const m: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
  };
  return m[ext] ?? "application/octet-stream";
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/** Run folder names from orchestrate (timestamp + short id). */
function isSafeRunIdSegment(name: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(name) && !name.includes("..");
}

/** Relative path under a run dir (only .html report files). */
function isAllowedReportHtmlRel(rel: string): boolean {
  if (!rel || rel.includes("..")) return false;
  const norm = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm.endsWith(".html")) return false;
  return true;
}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface HealthHistoryDay {
  date: string;
  runs: HealthRunMeta[];
}

function parseSummarySiteLine(line: string): {
  hostname: string;
  pages: number;
  broken: number;
  failed: boolean;
} | null {
  const m = line.match(/^([^:]+):\s*pages=(\d+)\s+brokenLinks=(\d+)\s+(OK|FAIL)\s*$/);
  if (!m) return null;
  return {
    hostname: m[1],
    pages: Number(m[2]),
    broken: Number(m[3]),
    failed: m[4] === "FAIL",
  };
}

/**
 * Older runs have no run-meta.json — rebuild a compatible shape from summary.txt + folder layout.
 */
async function loadLegacyRunMeta(runDir: string, runId: string): Promise<HealthRunMeta | null> {
  const summaryPath = path.join(runDir, "summary.txt");
  let raw: string;
  try {
    raw = await readFile(summaryPath, "utf8");
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/);
  let urlsFile: string | undefined;
  const urlLine = lines.find((l) => l.startsWith("URLs file:"));
  if (urlLine) {
    urlsFile = urlLine.replace(/^URLs file:\s*/i, "").trim();
  }

  let totalSites = 0;
  let siteFailures = 0;
  const metaLine = lines.find((l) => /Sites:\s*\d+/.test(l) && /Failed/i.test(l));
  if (metaLine) {
    const m = metaLine.match(/Sites:\s*(\d+)\s*·\s*Failed\s*\(issues found\):\s*(\d+)/i);
    if (m) {
      totalSites = Number(m[1]);
      siteFailures = Number(m[2]);
    }
  }

  let generatedAt: string;
  try {
    const st = await stat(path.join(runDir, "index.html"));
    generatedAt = st.mtime.toISOString();
  } catch {
    try {
      const st = await stat(summaryPath);
      generatedAt = st.mtime.toISOString();
    } catch {
      generatedAt = new Date(0).toISOString();
    }
  }

  const dirents = await readdir(runDir, { withFileTypes: true });
  const siteDirs = dirents
    .filter((e) => e.isDirectory() && /^\d{3}-/.test(e.name))
    .map((e) => e.name)
    .sort();

  const usedLine = new Set<number>();
  const sites: HealthRunMeta["sites"] = [];
  for (const folder of siteDirs) {
    const hostname = folder.replace(/^\d{3}-/, "");
    let pagesVisited = 0;
    let brokenLinks = 0;
    let failed = false;
    for (let i = 0; i < lines.length; i++) {
      if (usedLine.has(i)) continue;
      const parsed = parseSummarySiteLine(lines[i]);
      if (parsed && parsed.hostname === hostname) {
        usedLine.add(i);
        pagesVisited = parsed.pages;
        brokenLinks = parsed.broken;
        failed = parsed.failed;
        break;
      }
    }
    sites.push({
      hostname,
      startUrl: `https://${hostname}/`,
      failed,
      pagesVisited,
      brokenLinks,
      durationMs: 0,
      reportHtmlHref: `${folder}/report.html`,
    });
  }

  const masterFiles = dirents
    .filter((e) => e.isFile() && e.name.startsWith("MASTER-all-sites-") && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort();
  const masterHtmlHref = masterFiles.length > 0 ? `./${masterFiles[0]}` : "./MASTER-all-sites.html";

  return {
    runId,
    generatedAt,
    urlsSource: "file",
    urlsFile,
    totalSites: totalSites || sites.length,
    siteFailures: siteFailures || sites.filter((s) => s.failed).length,
    sites,
    masterHtmlHref,
    indexHtmlHref: "./index.html",
  };
}

async function listHealthHistory(outRoot: string): Promise<{ days: HealthHistoryDay[] }> {
  let entries;
  try {
    entries = await readdir(outRoot, { withFileTypes: true });
  } catch {
    return { days: [] };
  }

  const metas: HealthRunMeta[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (!isSafeRunIdSegment(ent.name)) continue;
    const runDir = path.join(outRoot, ent.name);
    const metaPath = path.join(runDir, "run-meta.json");
    try {
      const raw = await readFile(metaPath, "utf8");
      metas.push(JSON.parse(raw) as HealthRunMeta);
    } catch {
      const legacy = await loadLegacyRunMeta(runDir, ent.name);
      if (legacy) metas.push(legacy);
    }
  }

  const byDay = new Map<string, HealthRunMeta[]>();
  for (const m of metas) {
    const day = m.generatedAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(m);
    byDay.set(day, list);
  }

  const days: HealthHistoryDay[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, runs]) => ({
      date,
      runs: runs.sort((x, y) => (x.generatedAt < y.generatedAt ? 1 : -1)),
    }));

  return { days };
}

/**
 * Legacy `run-meta.json` could point `masterHtmlHref` at `./master.html` (redirect stub). Resolve to
 * `MASTER-all-sites-*.html` when present. `run-summary.html` is the real file for new runs — no resolution.
 */
async function resolveMasterHtmlIfRedirectStub(runDir: string, meta: HealthRunMeta): Promise<HealthRunMeta> {
  const href = meta.masterHtmlHref?.trim() ?? "";
  const norm = href.replace(/^\.\//, "").replace(/\\/g, "/");
  if (norm === "run-summary.html" || norm.endsWith("/run-summary.html")) return meta;
  if (norm !== "master.html" && !norm.endsWith("/master.html")) return meta;
  let dirents;
  try {
    dirents = await readdir(runDir, { withFileTypes: true });
  } catch {
    return meta;
  }
  const masterFiles = dirents
    .filter((e) => e.isFile() && e.name.startsWith("MASTER-all-sites-") && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort();
  if (masterFiles.length === 0) return meta;
  const pick = masterFiles[masterFiles.length - 1] ?? masterFiles[0];
  return { ...meta, masterHtmlHref: `./${pick}` };
}

/** Load a single run’s `run-meta.json` (or legacy summary) — used by the SPA workspace so it does not depend on history list matching. */
async function loadRunMetaById(outRoot: string, runId: string): Promise<HealthRunMeta | null> {
  if (!isSafeRunIdSegment(runId)) return null;
  const runDir = path.join(outRoot, runId);
  if (!isPathInsideRoot(outRoot, runDir)) return null;
  try {
    const st = await stat(runDir);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  const metaPath = path.join(runDir, "run-meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(raw) as HealthRunMeta;
    return await resolveMasterHtmlIfRedirectStub(runDir, meta);
  } catch {
    return await loadLegacyRunMeta(runDir, runId);
  }
}

/** Combined MASTER report JSON next to the HTML (or latest MASTER-all-sites-*.json). */
async function resolveMasterJsonPath(runDir: string, meta: HealthRunMeta): Promise<string | null> {
  const href = meta.masterHtmlHref?.trim() ?? "";
  const norm = href.replace(/^\.\//, "").replace(/\\/g, "/");
  if (norm.endsWith(".html")) {
    const jsonRel = `${norm.slice(0, -".html".length)}.json`;
    const p = path.join(runDir, jsonRel);
    if (isPathInsideRoot(runDir, p)) {
      try {
        const st = await stat(p);
        if (st.isFile()) return p;
      } catch {
        /* fall through */
      }
    }
  }
  let dirents;
  try {
    dirents = await readdir(runDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const jsonFiles = dirents
    .filter((e) => e.isFile() && e.name.startsWith("MASTER-all-sites-") && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();
  if (jsonFiles.length === 0) return null;
  const pick = jsonFiles[jsonFiles.length - 1] ?? jsonFiles[0];
  return path.join(runDir, pick);
}

async function loadGeminiPayloadForRun(outRoot: string, runId: string) {
  const meta = await loadRunMetaById(outRoot, runId);
  if (!meta) return null;
  const runDir = path.join(outRoot, runId);
  const jsonPath = await resolveMasterJsonPath(runDir, meta);
  if (!jsonPath || !isPathInsideRoot(runDir, jsonPath)) return null;
  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return null;
  }
  let data: { generatedAt?: string; sites?: SiteHealthReport[] };
  try {
    data = JSON.parse(raw) as { generatedAt?: string; sites?: SiteHealthReport[] };
  } catch {
    return null;
  }
  if (!Array.isArray(data.sites) || data.sites.length === 0) return null;
  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : meta.generatedAt;
  return buildGeminiPayloadFromReports(data.sites, runId, generatedAt, {
    pageSpeedSampleLimit: 80,
    pageSpeedPreferAnalyzed: true,
  });
}

const BUFFER_CAP = 2500;

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>QA-Agent — health dashboard</title>
  <style>
    :root {
      --bg: #f5f5f7;
      --surface: rgba(255, 255, 255, 0.9);
      --surface-solid: #ffffff;
      --border: rgba(0, 0, 0, 0.08);
      --text: #1d1d1f;
      --muted: #86868b;
      --accent: #0071e3;
      --ok: #34c759;
      --warn: #ff9500;
      --bad: #ff3b30;
      --run: #5856d6;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      margin: 0;
      background: linear-gradient(180deg, #e8e8ed 0%, var(--bg) 32%, var(--bg) 100%);
      color: var(--text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      letter-spacing: -0.022em;
    }
    header {
      padding: 28px 28px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
    }
    h1 { font-size: 1.75rem; font-weight: 600; margin: 0 0 8px 0; letter-spacing: -0.03em; }
    .sub { font-size: 0.9375rem; color: var(--muted); margin: 0; line-height: 1.4; }
    main { padding: 28px 24px 52px; max-width: 1100px; margin: 0 auto; }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0;
    }
    .tab {
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 10px 16px;
      border: none;
      border-radius: 8px 8px 0 0;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .tab:hover { color: var(--text); }
    .tab[aria-selected="true"] {
      background: var(--surface-solid);
      color: var(--accent);
      border: 1px solid var(--border);
      border-bottom-color: var(--surface-solid);
      margin-bottom: -1px;
    }
    .panel { display: none; }
    .panel.active { display: block; }
    label.lbl { display: block; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
    textarea.urls {
      width: 100%;
      min-height: 120px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface-solid);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      line-height: 1.45;
      resize: vertical;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }
    .row-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
    button.primary {
      font: inherit;
      font-weight: 600;
      padding: 11px 22px;
      border-radius: 980px;
      border: none;
      background: var(--accent);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 113, 227, 0.25);
    }
    button.primary:disabled { opacity: 0.45; cursor: not-allowed; }
    button.ghost {
      font: inherit;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
    }
    .hint { font-size: 0.82rem; color: var(--muted); margin: 10px 0 0 0; }
    .banner {
      padding: 14px 18px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--surface-solid);
      margin-bottom: 20px;
      font-size: 0.9375rem;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
    }
    .banner a { color: var(--accent); font-weight: 500; }
    .banner.err { border-color: rgba(255, 59, 48, 0.35); background: rgba(255, 59, 48, 0.06); }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; }
    tr:hover td { background: rgba(0, 113, 227, 0.04); }
    .hostname { font-weight: 600; word-break: break-all; }
    .url { font-size: 0.8rem; color: var(--muted); word-break: break-all; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.pending { background: rgba(0, 0, 0, 0.06); color: var(--muted); }
    .badge.running { background: rgba(88, 86, 214, 0.12); color: var(--run); }
    .badge.ok { background: rgba(52, 199, 89, 0.15); color: #1d7a42; }
    .badge.fail { background: rgba(255, 59, 48, 0.12); color: var(--bad); }
    .badge.err { background: rgba(255, 59, 48, 0.12); color: var(--bad); }
    .rep-link { margin-left: 8px; font-size: 0.8rem; font-weight: 600; }
    #log {
      margin-top: 24px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.03);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      color: var(--muted);
      max-height: 180px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .job-card {
      border: 1px solid var(--border);
      border-radius: 16px;
      margin-bottom: 12px;
      background: var(--surface-solid);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .job-card__head {
      width: 100%;
      text-align: left;
      padding: 14px 18px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      font: inherit;
      color: inherit;
    }
    .job-card__head:hover { background: rgba(0, 113, 227, 0.05); }
    .job-card__head:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .job-card__head-main { min-width: 0; flex: 1; }
    .job-card__title {
      margin: 0 0 4px 0;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--accent);
      word-break: break-all;
      line-height: 1.35;
    }
    .job-card__sub {
      font-size: 0.8rem;
      color: var(--muted);
      margin: 0;
      line-height: 1.4;
    }
    .job-card__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .job-card__chip {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      background: rgba(0, 0, 0, 0.05);
      color: var(--muted);
    }
    .job-card__chip--bad { background: rgba(255, 59, 48, 0.1); color: var(--bad); }
    .job-card__chip--ok { background: rgba(52, 199, 89, 0.12); color: #1d7a42; }
    .job-card__chevron {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      margin-top: 2px;
      color: var(--muted);
      transition: transform 0.2s ease;
    }
    .job-card--open .job-card__chevron { transform: rotate(180deg); color: var(--accent); }
    .job-card__body {
      padding: 0 18px 18px 18px;
      border-top: 1px solid var(--border);
    }
    .job-card__body[hidden] { display: none !important; }
    .run-meta { font-size: 0.8rem; color: var(--muted); margin-bottom: 10px; }
    .run-links { font-size: 0.85rem; margin-bottom: 10px; }
    .run-links a { color: var(--accent); font-weight: 600; text-decoration: none; margin-right: 12px; }
    .run-links a:hover { text-decoration: underline; }
    .btn-pdf {
      display: inline-block;
      margin-left: 8px;
      padding: 3px 8px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-radius: 6px;
      border: 1px solid var(--border);
      color: var(--muted);
      text-decoration: none;
    }
    .btn-pdf:hover { color: var(--accent); border-color: var(--accent); }
    .mini-table { width: 100%; font-size: 0.8rem; margin-top: 8px; }
    .mini-table th { font-size: 0.68rem; }
    .mini-table td { padding: 6px 8px; }
    .status-ok { color: var(--ok); font-weight: 600; }
    .status-bad { color: var(--bad); font-weight: 600; }
    .history-empty { color: var(--muted); font-size: 0.9rem; padding: 16px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Site health dashboard</h1>
    <p class="sub">Run <code>npm run health -- --serve</code> (no <code>--urls</code> required). Paste root URLs below to crawl, generate HTML/JSON reports, and download PDFs. Open <strong>Past runs</strong> for a list of job cards — click a card to expand links and per-site results.</p>
    <p class="sub" style="margin-top:10px">Each finished run is served at <code>/reports/&lt;runId&gt;/index.html</code> (run index), with per-site folders, a <strong>Combined report</strong> (full analytics), and a <strong>Stats summary</strong> page for compact PDFs. Use the sticky bar to move between the run index, reports, and this dashboard.</p>
  </header>
  <main>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" id="tab-run" aria-selected="true" aria-controls="panel-run">New run</button>
      <button type="button" class="tab" role="tab" id="tab-history" aria-selected="false" aria-controls="panel-history">Past runs</button>
    </div>

    <section id="panel-run" class="panel active" role="tabpanel" aria-labelledby="tab-run">
      <label class="lbl" for="urls-input">URLs (one https URL per line; lines starting with # ignored)</label>
      <textarea id="urls-input" class="urls" placeholder="https://www.example.com&#10;https://another.org"></textarea>
      <div class="row-actions">
        <button type="button" class="primary" id="btn-start">Start health check</button>
        <span id="busy-hint" class="hint" style="display:none">A run is in progress…</span>
      </div>
      <p class="hint">Uses the same crawl options as the CLI (timeouts, fetch concurrency, PageSpeed if enabled). If you launched with <code>--urls path/to/urls.txt</code>, that crawl may already be running or finished below.</p>

      <div id="banner" class="banner">Connecting to live stream…</div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Site</th>
            <th>Status</th>
            <th>Pages</th>
            <th>Broken</th>
            <th>Duration</th>
            <th>HTML / PDF</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="log"></div>
    </section>

    <section id="panel-history" class="panel" role="tabpanel" aria-labelledby="tab-history" hidden>
      <p class="hint" style="margin-top:0">Runs are stored under your artifacts folder. Each row is a <strong>job card</strong> — click the header to show run index / combined report links and the site table.</p>
      <div id="history-root"><p class="history-empty">Loading…</p></div>
    </section>
  </main>
  <script>
    const banner = document.getElementById("banner");
    const rowsEl = document.getElementById("rows");
    const logEl = document.getElementById("log");
    const rows = new Map();
    const tabRun = document.getElementById("tab-run");
    const tabHistory = document.getElementById("tab-history");
    const panelRun = document.getElementById("panel-run");
    const panelHistory = document.getElementById("panel-history");
    const historyRoot = document.getElementById("history-root");
    const urlsInput = document.getElementById("urls-input");
    const btnStart = document.getElementById("btn-start");
    const busyHint = document.getElementById("busy-hint");

    let runBusy = false;

    function log(line) {
      logEl.textContent += line + String.fromCharCode(10);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setBanner(html, isErr) {
      banner.className = "banner" + (isErr ? " err" : "");
      banner.innerHTML = html;
    }

    function reportHref(runId, reportHtmlHref) {
      var parts = String(reportHtmlHref).split("/").map(encodeURIComponent).join("/");
      return "/reports/" + encodeURIComponent(runId) + "/" + parts;
    }

    function pdfHref(runId, fileRel) {
      return "/api/pdf?runId=" + encodeURIComponent(runId) + "&file=" + encodeURIComponent(fileRel);
    }

    function ensureRow(siteId, index, hostname, startUrl) {
      if (rows.has(siteId)) return rows.get(siteId);
      var tr = document.createElement("tr");
      tr.dataset.siteId = siteId;
      tr.innerHTML =
        '<td class="idx"></td>' +
        '<td><div class="hostname"></div><div class="url"></div></td>' +
        '<td class="status"></td>' +
        '<td class="pages">—</td>' +
        '<td class="broken">—</td>' +
        '<td class="dur">—</td>' +
        '<td class="rep"></td>';
      rowsEl.appendChild(tr);
      var o = { tr: tr, siteId: siteId, index: index, hostname: hostname, startUrl: startUrl };
      rows.set(siteId, o);
      return o;
    }

    function paintRow(o) {
      var tr = o.tr;
      tr.querySelector(".idx").textContent = String(o.index ?? "");
      tr.querySelector(".hostname").textContent = o.hostname;
      tr.querySelector(".url").textContent = o.startUrl;
      var st = o.state || "pending";
      var statusCell = tr.querySelector(".status");
      var repCell = tr.querySelector(".rep");
      var labels = {
        pending: ["Pending", "pending"],
        running: ["Checking…", "running"],
        ok: ["OK", "ok"],
        fail: ["Issues", "fail"],
        err: ["Error", "err"],
      };
      var pair = labels[st] || labels.pending;
      var label = pair[0];
      var cls = pair[1];
      statusCell.innerHTML = '<span class="badge ' + cls + '">' + label + "</span>";
      if (o.pagesVisited != null) tr.querySelector(".pages").textContent = String(o.pagesVisited);
      if (o.brokenLinks != null) tr.querySelector(".broken").textContent = String(o.brokenLinks);
      if (o.durationMs != null) tr.querySelector(".dur").textContent = o.durationMs + " ms";
      if (o.reportHref && o.runId && o.reportFileRel) {
        repCell.innerHTML =
          '<a class="rep-link" href="' +
          escapeAttr(o.reportHref) +
          '">HTML</a>' +
          '<a class="btn-pdf" href="' +
          escapeAttr(pdfHref(o.runId, o.reportFileRel)) +
          '" download>PDF</a>';
      } else if (o.reportHref) {
        repCell.innerHTML = '<a class="rep-link" href="' + escapeAttr(o.reportHref) + '">HTML</a>';
      } else {
        repCell.textContent = "—";
      }
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    function escapeAttr(s) {
      return escapeHtml(s);
    }

    function selectTab(which) {
      var run = which === "run";
      tabRun.setAttribute("aria-selected", run ? "true" : "false");
      tabHistory.setAttribute("aria-selected", run ? "false" : "true");
      panelRun.classList.toggle("active", run);
      panelHistory.classList.toggle("active", !run);
      panelRun.hidden = !run;
      panelHistory.hidden = run;
      if (!run) loadHistory();
    }
    tabRun.addEventListener("click", function () { selectTab("run"); });
    tabHistory.addEventListener("click", function () { selectTab("history"); });

    async function loadHistory() {
      historyRoot.innerHTML = '<p class="history-empty">Loading…</p>';
      try {
        var res = await fetch("/api/history");
        var data = await res.json();
        renderHistory(data);
      } catch (e) {
        historyRoot.innerHTML = '<p class="history-empty">Could not load history.</p>';
      }
    }

    function flattenRuns(data) {
      var runs = [];
      if (!data.days) return runs;
      data.days.forEach(function (day) {
        (day.runs || []).forEach(function (run) {
          runs.push(run);
        });
      });
      runs.sort(function (a, b) {
        var ta = String(a.generatedAt || "");
        var tb = String(b.generatedAt || "");
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
      return runs;
    }

    function renderHistory(data) {
      if (!data.days || data.days.length === 0) {
        historyRoot.innerHTML = '<p class="history-empty">No runs found under artifacts. Each run folder needs <code>run-meta.json</code> (new runs) or at least <code>summary.txt</code> + per-site folders (older runs).</p>';
        return;
      }
      var runs = flattenRuns(data);
      if (runs.length === 0) {
        historyRoot.innerHTML = '<p class="history-empty">No runs in history.</p>';
        return;
      }
      var frag = document.createDocumentFragment();
      runs.forEach(function (run) {
        frag.appendChild(jobCard(run));
      });
      historyRoot.textContent = "";
      historyRoot.appendChild(frag);
    }

    function jobCard(run) {
      var wrap = document.createElement("div");
      wrap.className = "job-card";
      var idx = "/reports/" + encodeURIComponent(run.runId) + "/index.html";
      var mh = run.masterHtmlHref || "";
      if (mh.slice(0, 2) === "./") mh = mh.slice(2);
      var master = "/reports/" + encodeURIComponent(run.runId) + "/" + mh.split("/").map(encodeURIComponent).join("/");
      var sitesRows = (run.sites || []).map(function (s) {
        var href = reportHref(run.runId, s.reportHtmlHref);
        var pdf = pdfHref(run.runId, s.reportHtmlHref);
        var st = s.failed ? '<span class="status-bad">Issues</span>' : '<span class="status-ok">OK</span>';
        return (
          "<tr><td>" +
          escapeHtml(s.hostname) +
          "</td><td>" +
          st +
          "</td><td>" +
          String(s.pagesVisited) +
          "</td><td>" +
          String(s.brokenLinks) +
          '</td><td><a href="' +
          escapeAttr(href) +
          '">HTML</a> <a class="btn-pdf" href="' +
          escapeAttr(pdf) +
          '">PDF</a></td></tr>'
        );
      }).join("");
      var masterPdf = pdfHref(run.runId, mh);
      var hasIssues = Number(run.siteFailures) > 0;
      var chipClass = hasIssues ? "job-card__chip job-card__chip--bad" : "job-card__chip job-card__chip--ok";
      var chipLabel = hasIssues ? String(run.siteFailures) + " site(s) with issues" : "All sites OK";

      var head = document.createElement("button");
      head.type = "button";
      head.className = "job-card__head";
      head.setAttribute("aria-expanded", "false");
      head.innerHTML =
        '<span class="job-card__head-main">' +
        '<p class="job-card__title">' +
        escapeHtml(run.runId) +
        "</p>" +
        '<p class="job-card__sub">' +
        escapeHtml(run.generatedAt || "") +
        " · " +
        escapeHtml(run.urlsSource || "") +
        "</p>" +
        '<div class="job-card__chips">' +
        '<span class="job-card__chip">' +
        String(run.totalSites || 0) +
        " site(s)</span>" +
        '<span class="' +
        chipClass +
        '">' +
        chipLabel +
        "</span>" +
        "</div>" +
        '<span class="job-card__hint" style="font-size:0.75rem;color:var(--muted);margin-top:8px;display:block">Click to show links and details</span>' +
        "</span>" +
        '<svg class="job-card__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

      var body = document.createElement("div");
      body.className = "job-card__body";
      body.hidden = true;
      body.setAttribute("hidden", "");
      body.innerHTML =
        '<div class="run-meta"><strong>URLs</strong> · ' +
        (run.urlsFile ? escapeHtml(String(run.urlsFile)) : "—") +
        "</div>" +
        '<div class="run-links"><a href="' +
        escapeAttr(idx) +
        '">Run index</a><a href="' +
        escapeAttr(master) +
        '">Combined HTML</a><a class="btn-pdf" href="' +
        escapeAttr(masterPdf) +
        '">Combined PDF</a></div>' +
        (sitesRows
          ? '<table class="mini-table data-table"><thead><tr><th>Site</th><th>Status</th><th>Pages</th><th>Broken</th><th>HTML / PDF</th></tr></thead><tbody>' +
            sitesRows +
            "</tbody></table>"
          : '<p class="run-meta">No per-site rows in metadata.</p>');

      head.addEventListener("click", function () {
        var open = !wrap.classList.contains("job-card--open");
        wrap.classList.toggle("job-card--open", open);
        head.setAttribute("aria-expanded", open ? "true" : "false");
        body.hidden = !open;
        if (open) body.removeAttribute("hidden");
        else body.setAttribute("hidden", "");
      });

      wrap.appendChild(head);
      wrap.appendChild(body);
      return wrap;
    }

    const es = new EventSource("/api/stream");
    es.onopen = function () {
      log("Connected to event stream.");
      setBanner("Listening for runs… Start a check from this page or wait for the CLI-launched run.", false);
    };

    es.onmessage = function (ev) {
      var data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        log("Bad JSON: " + ev.data);
        return;
      }

      if (data.type === "run_start") {
        rows.clear();
        rowsEl.textContent = "";
        btnStart.disabled = true;
        busyHint.style.display = "inline";
        runBusy = true;
        setBanner(
          "Run <code>" +
            escapeHtml(data.runId) +
            "</code> — " +
            data.totalSites +
            ' site(s). <a href="/reports/' +
            encodeURIComponent(data.runId) +
            '/index.html">Open run index</a>',
          false
        );
        log("run_start: " + data.totalSites + " sites");
        data.sites.forEach(function (s, i) {
          var o = ensureRow(s.siteId, i + 1, s.hostname, s.startUrl);
          o.state = "pending";
          paintRow(o);
        });
        return;
      }

      if (data.type === "site_start") {
        var o = ensureRow(data.siteId, data.index, data.hostname, data.startUrl);
        o.state = "running";
        paintRow(o);
        log("site_start: " + data.hostname);
        return;
      }

      if (data.type === "site_complete") {
        var oc = rows.get(data.siteId);
        if (oc) {
          oc.state = data.failed ? "fail" : "ok";
          oc.pagesVisited = data.pagesVisited;
          oc.brokenLinks = data.brokenLinks;
          oc.durationMs = data.durationMs;
          oc.runId = data.runId;
          oc.reportFileRel = data.reportHtmlHref;
          oc.reportHref = reportHref(data.runId, data.reportHtmlHref);
          paintRow(oc);
        }
        log("site_complete: " + data.hostname + " → " + (data.failed ? "issues" : "ok"));
        return;
      }

      if (data.type === "site_error") {
        var oe = rows.get(data.siteId);
        if (oe) {
          oe.state = "err";
          paintRow(oe);
        }
        log("site_error: " + data.hostname + " — " + data.message);
        return;
      }

      if (data.type === "run_complete") {
        var fail = data.siteFailures > 0;
        setBanner(
          (fail ? "<strong>Finished with issues.</strong> " : "<strong>Finished.</strong> ") +
            data.siteFailures +
            " site(s) with crawl/link problems. " +
            '<a href="/reports/' +
            encodeURIComponent(data.runId) +
            '/index.html">Run index</a> · <code>' +
            escapeHtml(data.runDir) +
            "</code>",
          fail
        );
        log("run_complete: failures=" + data.siteFailures);
        runBusy = false;
        btnStart.disabled = false;
        busyHint.style.display = "none";
        loadHistory();
        return;
      }

      if (data.type === "run_error") {
        setBanner("<strong>Run failed.</strong> " + escapeHtml(data.message), true);
        log("run_error: " + data.message);
        runBusy = false;
        btnStart.disabled = false;
        busyHint.style.display = "none";
      }
    };

    es.onerror = function () {
      log("EventSource error (connection may retry).");
    };

    btnStart.addEventListener("click", async function () {
      if (runBusy) return;
      var text = urlsInput.value || "";
      try {
        btnStart.disabled = true;
        var res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urlsText: text }),
        });
        if (res.status === 409) {
          alert("A run is already in progress.");
          btnStart.disabled = false;
          return;
        }
        if (!res.ok) {
          var errText = await res.text();
          alert("Could not start: " + errText);
          btnStart.disabled = false;
          return;
        }
        runBusy = true;
        busyHint.style.display = "inline";
        log("Requested new run from UI.");
      } catch (e) {
        alert(String(e));
        btnStart.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export type HealthDashboardOrchestrateOptions = Omit<
  Parameters<typeof orchestrateHealthCheck>[0],
  "onProgress"
>;

/**
 * Serves a live dashboard on HTTP and streams progress via SSE.
 * Reports are served at `/reports/:runId/...` under the artifacts root.
 */
export async function runHealthDashboard(options: {
  port: number;
  openBrowser: boolean;
  orchestrate: HealthDashboardOrchestrateOptions;
}): Promise<{ runId: string; runDir: string; siteFailures: number }> {
  const buffer: HealthProgressEvent[] = [];
  const clients = new Set<http.ServerResponse>();
  const outRoot = path.resolve(options.orchestrate.outRoot);

  function broadcast(ev: HealthProgressEvent): void {
    buffer.push(ev);
    if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) {
      try {
        res.write(line);
      } catch {
        /* client gone */
      }
    }
  }

  const baseOrchestrate = options.orchestrate;
  let runInFlight = false;
  let lastResult: { runId: string; runDir: string; siteFailures: number } | null = null;

  async function runOrchestrate(
    extra: Partial<HealthDashboardOrchestrateOptions>,
  ): Promise<{ runId: string; runDir: string; siteFailures: number }> {
    return await orchestrateHealthCheck({
      ...baseOrchestrate,
      ...extra,
      onProgress: broadcast,
    });
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);

      if (req.method === "GET" && !url.pathname.startsWith("/api") && !url.pathname.startsWith("/reports/")) {
        const dist = webDistRoot();
        let spaHtml: string | null = null;
        try {
          spaHtml = await readFile(path.join(dist, "index.html"), "utf8");
        } catch {
          spaHtml = null;
        }
        if (spaHtml) {
          const decoded = decodeURIComponent(url.pathname);
          const rel = decoded.replace(/^\/+/, "") || "index.html";
          const norm = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
          const abs = path.join(dist, norm);
          if (isPathInsideRoot(dist, abs)) {
            try {
              const st = await stat(abs);
              if (st.isFile()) {
                res.writeHead(200, { "Content-Type": mimeFor(abs) });
                createReadStream(abs).pipe(res);
                return;
              }
            } catch {
              /* SPA fallback */
            }
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(spaHtml);
          return;
        }
        if (url.pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(dashboardHtml());
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        const data = await listHealthHistory(outRoot);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(data));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/run-meta") {
        const runIdParam = url.searchParams.get("runId");
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const meta = await loadRunMetaById(outRoot, runIdParam);
        if (!meta) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Run not found" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(meta));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/gemini-summary") {
        const runId = url.searchParams.get("runId");
        if (!runId || !isSafeRunIdSegment(runId)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const p = path.join(outRoot, runId, "gemini-summary.md");
        if (!isPathInsideRoot(outRoot, p)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          const text = await readFile(p, "utf8");
          res.writeHead(200, {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(text);
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gemini-run-chat") {
        let body: string;
        try {
          body = await readBody(req, 32_000);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Bad request" }));
          return;
        }
        let payload: { runId?: unknown; question?: unknown };
        try {
          payload = JSON.parse(body) as { runId?: unknown; question?: unknown };
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }
        const runIdParam = typeof payload.runId === "string" ? payload.runId : "";
        const question =
          typeof payload.question === "string" ? payload.question.trim().slice(0, 4000) : "";
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Bad runId" }));
          return;
        }
        if (!question) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "question required" }));
          return;
        }
        if (!resolveGeminiApiKey()) {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              error: "Gemini API key not configured (set GEMINI_API_KEY or GOOGLE_AI_API_KEY for the server process)",
            }),
          );
          return;
        }
        const qaPayload = await loadGeminiPayloadForRun(outRoot, runIdParam);
        if (!qaPayload) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Run data not found (missing MASTER JSON)" }));
          return;
        }
        try {
          const answer = await generateGeminiRunAnswer(qaPayload, question);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ answer }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/parse-urls-file") {
        const form = formidable({
          maxFileSize: 25 * 1024 * 1024,
          allowEmptyFiles: false,
        });
        let files: formidable.Files;
        try {
          [, files] = await form.parse(req);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
          return;
        }
        const fileList = files.file ?? files.upload ?? [];
        const first = Array.isArray(fileList) ? fileList[0] : fileList;
        if (!first || !first.filepath) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Expected multipart field 'file'" }));
          return;
        }
        const buf = await readFile(first.filepath);
        const name = (first.originalFilename ?? "").toLowerCase();
        let urls: string[];
        if (name.endsWith(".pdf")) {
          urls = await extractUrlsFromPdfBuffer(buf);
        } else {
          urls = parseUrlsFromText(buf.toString("utf8"));
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ urls, count: urls.length }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/pdf") {
        const runId = url.searchParams.get("runId");
        const file = url.searchParams.get("file");
        if (!runId || !file || !isSafeRunIdSegment(runId) || !isAllowedReportHtmlRel(file)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request: need runId and file (relative .html path under the run folder)");
          return;
        }
        const runRoot = path.join(outRoot, runId);
        if (!isPathInsideRoot(outRoot, runRoot)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        const relFs = file
          .replace(/\\/g, "/")
          .split("/")
          .filter(Boolean)
          .join(path.sep);
        const absHtml = path.join(runRoot, relFs);
        if (!isPathInsideRoot(runRoot, absHtml)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          const st = await stat(absHtml);
          if (!st.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
          }
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        try {
          const pdf = await renderHtmlFileToPdf(absHtml, { runRoot });
          const base = path.basename(file, ".html").replace(/[^a-zA-Z0-9._-]+/g, "_");
          const download =
            url.searchParams.get("download") === "1" || url.searchParams.get("download") === "true";
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `${download ? "attachment" : "inline"}; filename="health-${runId}-${base}.pdf"`,
            "Cache-Control": "no-store",
          });
          res.end(pdf);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(
            `PDF generation failed: ${msg}\n\n` +
              `If Chromium is missing, run: npx playwright install chromium\n` +
              `Large reports are retried with a fresh browser and lighter print settings (several attempts). ` +
              `Docker/Linux: QA_AGENT_PDF_NO_SANDBOX=1. If PDFs look wrong on Apple Silicon, try QA_AGENT_PDF_DISABLE_GPU=1.\n`,
          );
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/issue-overrides") {
        let body: string;
        try {
          body = await readBody(req, 512_000);
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request");
          return;
        }
        let payload: { runId?: unknown; overrides?: unknown };
        try {
          payload = JSON.parse(body) as { runId?: unknown; overrides?: unknown };
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }
        const runIdParam =
          typeof payload.runId === "string" ? payload.runId : String(payload.runId ?? "");
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const rawOv = payload.overrides;
        if (!rawOv || typeof rawOv !== "object" || Array.isArray(rawOv)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("overrides must be an object");
          return;
        }
        const allowed = new Set(["open", "ok", "working", "resolved"]);
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawOv as Record<string, unknown>)) {
          if (typeof k !== "string" || k.length > 128) continue;
          if (typeof v !== "string" || !allowed.has(v)) continue;
          cleaned[k] = v;
        }
        const runRoot = path.join(outRoot, runIdParam);
        if (!isPathInsideRoot(outRoot, runRoot)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        const outPath = path.join(runRoot, "issue-overrides.json");
        if (!isPathInsideRoot(runRoot, outPath)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          await mkdir(runRoot, { recursive: true });
          await writeFile(
            outPath,
            JSON.stringify(
              {
                runId: runIdParam,
                savedAt: new Date().toISOString(),
                overrides: cleaned,
              },
              null,
              2,
            ),
            "utf8",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(msg);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, overrides: cleaned, savedAt: new Date().toISOString() }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/site-status-overrides") {
        let body: string;
        try {
          body = await readBody(req, 512_000);
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request");
          return;
        }
        let payload: { runId?: unknown; sites?: unknown };
        try {
          payload = JSON.parse(body) as { runId?: unknown; sites?: unknown };
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }
        const runIdParam =
          typeof payload.runId === "string" ? payload.runId : String(payload.runId ?? "");
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const rawSites = payload.sites;
        if (!rawSites || typeof rawSites !== "object" || Array.isArray(rawSites)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("sites must be an object");
          return;
        }
        const allowed = new Set(["open", "ok", "working", "resolved"]);
        const cleanedSites: Record<string, { status: string; editedAt: string }> = {};
        const now = new Date().toISOString();
        for (const [k, v] of Object.entries(rawSites as Record<string, unknown>)) {
          if (typeof k !== "string" || k.length > 256 || k.includes("..") || k.includes("/") || k.includes("\\")) continue;
          if (!v || typeof v !== "object" || Array.isArray(v)) continue;
          const st = (v as { status?: unknown }).status;
          if (typeof st !== "string" || !allowed.has(st)) continue;
          cleanedSites[k] = { status: st, editedAt: now };
        }
        const runRoot = path.join(outRoot, runIdParam);
        if (!isPathInsideRoot(outRoot, runRoot)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        const outPath = path.join(runRoot, "site-status-overrides.json");
        if (!isPathInsideRoot(runRoot, outPath)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          await mkdir(runRoot, { recursive: true });
          await writeFile(
            outPath,
            JSON.stringify(
              {
                runId: runIdParam,
                savedAt: now,
                sites: cleanedSites,
              },
              null,
              2,
            ),
            "utf8",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(msg);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, sites: cleanedSites, savedAt: now }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        if (runInFlight) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("A run is already in progress.");
          return;
        }
        let body: string;
        try {
          body = await readBody(req, 256_000);
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request");
          return;
        }
        let payload: {
          urlsText?: string;
          urls?: string[];
          pageSpeedBoth?: boolean;
          viewportCheck?: boolean;
          gemini?: boolean;
        };
        try {
          payload = JSON.parse(body) as typeof payload;
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }
        let urls: string[];
        if (Array.isArray(payload.urls) && payload.urls.length > 0) {
          urls = payload.urls.map((u) => String(u).trim()).filter(Boolean);
        } else if (typeof payload.urlsText === "string") {
          urls = parseUrlsFromText(payload.urlsText);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Provide urlsText (string) or urls (non-empty array)");
          return;
        }
        if (urls.length === 0) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("No valid http(s) URLs found");
          return;
        }

        const runExtra: Partial<HealthDashboardOrchestrateOptions> = { urls };
        const ps = baseOrchestrate.pageSpeed;
        if (payload.pageSpeedBoth) {
          runExtra.pageSpeed = {
            enabled: true,
            strategies: ["mobile", "desktop"],
            maxUrls: ps?.maxUrls ?? 25,
            concurrency: ps?.concurrency ?? 1,
            timeoutMs: ps?.timeoutMs ?? 120_000,
          };
        }
        const vc = baseOrchestrate.viewportCheck;
        if (payload.viewportCheck) {
          runExtra.viewportCheck = {
            enabled: true,
            maxUrls: vc?.maxUrls ?? 15,
            timeoutMs: vc?.timeoutMs ?? 60_000,
            concurrency: vc?.concurrency ?? 1,
          };
        }
        if (payload.gemini) {
          runExtra.gemini = true;
        }

        runInFlight = true;
        res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: true, urlCount: urls.length }));
        void runOrchestrate(runExtra)
          .then((r) => {
            lastResult = r;
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            broadcast({ type: "run_error", message });
          })
          .finally(() => {
            runInFlight = false;
          });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
        const raw = url.pathname.slice("/reports/".length);
        const decoded = decodeURIComponent(raw);
        const norm = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
        const segments = norm.split(/[/\\]/).filter(Boolean);
        if (segments.length === 0) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        const runId = segments[0];
        if (!isSafeRunIdSegment(runId)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad run id");
          return;
        }
        const relPath = segments.slice(1).join(path.sep) || "index.html";
        const runRoot = path.join(outRoot, runId);
        const filePath = path.join(runRoot, relPath);
        if (!isPathInsideRoot(outRoot, runRoot) || !isPathInsideRoot(runRoot, filePath)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          const st = await stat(filePath);
          if (!st.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
          }
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": mimeFor(filePath) });
        createReadStream(filePath).pipe(res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        for (const ev of buffer) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
        clients.add(res);
        req.on("close", () => {
          clients.delete(res);
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    })().catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(err));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => {
      server.off("error", onError);
      const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${options.port} is already in use (another qa-agent dashboard still running?).\n` +
              `  • Stop it: focus the other terminal and press Ctrl+C, or run: npm run dashboard:kill\n` +
              `  • Or use another port: QA_AGENT_PORT=3848 npm start   or   npm run health -- --serve --port 3848`,
          ),
        );
        return;
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    server.once("error", onError);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${options.port}/`;
  console.log(`[qa-agent] Live dashboard: ${baseUrl}`);
  if (options.openBrowser) {
    setTimeout(() => openBrowser(baseUrl), 400);
  }

  const hasInitialFile = Boolean(baseOrchestrate.urlsFile);
  if (hasInitialFile) {
    runInFlight = true;
    try {
      const result = await runOrchestrate({});
      lastResult = result;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcast({ type: "run_error", message });
      throw err;
    } finally {
      runInFlight = false;
    }
  }

  if (!lastResult) {
    return { runId: "", runDir: "", siteFailures: 0 };
  }
  return lastResult;
}
