import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { bestPerformanceScore, flattenInsights, hasPageSpeedInsights } from "./insight-utils.js";
import { healthSiteOutputDirName } from "./load-urls.js";
import type {
  CrawlSiteResult,
  PageFetchRecord,
  PageSpeedInsightRecord,
  SiteHealthReport,
  ViewportCheckRecord,
} from "./types.js";

function psiStrategiesLabel(meta: NonNullable<CrawlSiteResult["pageSpeedInsightsMeta"]>): string {
  const m = meta as { strategies?: ("mobile" | "desktop")[]; strategy?: string };
  if (m.strategies?.length) return m.strategies.join(" + ");
  if (m.strategy) return m.strategy;
  return "—";
}

function buildViewportRowsHtml(rows: ViewportCheckRecord[]): string {
  return rows
    .map((v) => {
      const mOk = v.mobile.ok ? "cell-ok" : "cell-err";
      const dOk = v.desktop.ok ? "cell-ok" : "cell-err";
      return `<tr>
  <td><a href="${esc(v.url)}">${esc(v.url)}</a></td>
  <td class="num">${v.mobile.loadMs}</td>
  <td class="${mOk}">${v.mobile.ok ? "OK" : "Fail"}</td>
  <td class="num">${v.mobile.consoleErrorCount}</td>
  <td class="num">${v.desktop.loadMs}</td>
  <td class="${dOk}">${v.desktop.ok ? "OK" : "Fail"}</td>
  <td class="num">${v.desktop.consoleErrorCount}</td>
</tr>`;
    })
    .join("\n");
}

/** Shared styles for single-site and combined health HTML. */
const HEALTH_REPORT_CSS = `
    :root {
      --bg: #f5f5f7;
      --surface: rgba(255, 255, 255, 0.82);
      --surface-solid: #ffffff;
      --text: #1d1d1f;
      --text-muted: #86868b;
      --border: rgba(0, 0, 0, 0.08);
      --accent: #0071e3;
      --accent-soft: rgba(0, 113, 227, 0.08);
      --ok: #34c759;
      --ok-bg: rgba(52, 199, 89, 0.12);
      --err: #ff3b30;
      --err-bg: rgba(255, 59, 48, 0.08);
      --warn: #ff9500;
      --radius: 20px;
      --radius-sm: 12px;
      --shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
      --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.08);
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.47059;
      letter-spacing: -0.022em;
      color: var(--text);
      background: linear-gradient(180deg, #e8e8ed 0%, var(--bg) 28%, var(--bg) 100%);
      -webkit-font-smoothing: antialiased;
    }
    .report-shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 22px 56px;
    }
    .report-header {
      background: var(--surface);
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      padding: 32px 32px 28px;
      margin-bottom: 28px;
      border: 1px solid var(--border);
    }
    .report-kicker {
      margin: 0 0 10px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .report-header h1 {
      margin: 0 0 12px;
      font-size: 2.125rem;
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1.1;
      color: var(--text);
    }
    .report-header .lead {
      margin: 0 0 24px;
      color: var(--text-muted);
      font-size: 1.0625rem;
      font-weight: 400;
    }
    .report-header .lead a { color: var(--accent); font-weight: 500; text-decoration: none; }
    .report-header .lead a:hover { text-decoration: underline; }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
      gap: 10px;
    }
    .stat-grid--wide {
      margin-top: 10px;
      grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    }
    .stat {
      background: var(--surface-solid);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 14px 16px;
      box-shadow: var(--shadow);
    }
    .stat-label {
      display: block;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 1.25rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    .stat-value small { font-size: 0.8125rem; font-weight: 500; color: var(--text-muted); }
    .http-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
      align-items: center;
    }
    .http-pills__label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-right: 4px;
    }
    .http-pill {
      display: inline-flex;
      align-items: center;
      padding: 5px 11px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      border: 1px solid var(--border);
      background: var(--surface-solid);
    }
    .http-pill--2xx { color: #1d7a42; background: rgba(52, 199, 89, 0.12); border-color: rgba(52, 199, 89, 0.25); }
    .http-pill--3xx { color: #8b6914; background: rgba(255, 149, 0, 0.12); border-color: rgba(255, 149, 0, 0.25); }
    .http-pill--4xx { color: #b45309; background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.3); }
    .http-pill--5xx { color: #b91c1c; background: rgba(255, 59, 48, 0.1); border-color: rgba(255, 59, 48, 0.25); }
    .http-pill--err { color: #6b7280; background: rgba(107, 114, 128, 0.12); border-color: rgba(107, 114, 128, 0.2); }
    .report-section {
      background: var(--surface-solid);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 26px 28px 28px;
      margin-bottom: 22px;
    }
    .report-section h2 {
      margin: 0 0 8px;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--text);
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      width: 100%;
    }
    .section-desc {
      margin: 12px 0 18px;
      font-size: 0.9375rem;
      color: var(--text-muted);
    }
    .section-desc a { color: var(--accent); }
    .table-wrap {
      overflow-x: auto;
      margin: 0;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    table.data-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.8125rem;
    }
    .data-table thead th {
      text-align: left;
      padding: 11px 12px;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      background: rgba(0, 0, 0, 0.02);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .data-table tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      vertical-align: top;
      word-break: break-word;
    }
    .data-table tbody tr:nth-child(even) td { background: rgba(0, 0, 0, 0.015); }
    .data-table tbody tr:hover td { background: rgba(0, 113, 227, 0.04) !important; }
    .data-table tbody tr.row-ok td { background: rgba(52, 199, 89, 0.06) !important; }
    .data-table tbody tr.row-err td { background: rgba(255, 59, 48, 0.06) !important; }
    .data-table tbody tr.row-ok:hover td { background: rgba(52, 199, 89, 0.1) !important; }
    .data-table tbody tr.row-err:hover td { background: rgba(255, 59, 48, 0.1) !important; }
    .data-table tbody tr:last-child td { border-bottom: none; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cell-mono {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .data-table a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
    }
    .data-table a:hover { text-decoration: underline; }
    .cell-ok { color: var(--ok); font-weight: 600; }
    .cell-err { color: var(--err); font-weight: 500; }
    .empty-state {
      padding: 22px;
      text-align: center;
      color: #1d7a42;
      font-weight: 500;
      background: var(--ok-bg);
      border-radius: var(--radius-sm);
    }
    .ok { color: var(--ok); }
    .err { color: var(--err); }
    .meta { color: var(--text-muted); font-size: 0.85rem; }
    .score-bad { background: rgba(255, 59, 48, 0.1); color: #b91c1c; border-color: rgba(255, 59, 48, 0.25) !important; }
    .score-warn { background: rgba(255, 149, 0, 0.12); color: #9a3412; border-color: rgba(255, 149, 0, 0.3) !important; }
    .score-good { background: rgba(52, 199, 89, 0.12); color: #166534; border-color: rgba(52, 199, 89, 0.3) !important; }
    .screenshot-wrap {
      margin-top: 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      overflow: hidden;
      background: var(--surface-solid);
      box-shadow: var(--shadow);
    }
    .screenshot-img {
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      vertical-align: top;
    }
    .master-thumb {
      display: block;
      max-width: 160px;
      height: auto;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .report-footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--text-muted);
      text-align: center;
    }
    /* PageSpeed cards */
    .psi-grid { display: flex; flex-direction: column; gap: 22px; margin-top: 8px; }
    .psi-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px 26px;
      background: var(--surface-solid);
      box-shadow: var(--shadow);
    }
    .psi-card-err { border-color: #fecaca; background: #fffafa; }
    .psi-card-err .err { margin: 0; font-size: 0.9rem; line-height: 1.45; }
    .psi-card-top { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
    .psi-gauge-box { flex: 0 0 auto; text-align: center; width: 148px; }
    .psi-gauge { width: 120px; height: 120px; display: block; margin: 0 auto; filter: drop-shadow(0 2px 4px rgba(0,0,0,.06)); }
    .psi-gauge-bg { stroke: rgba(0, 0, 0, 0.08); }
    .psi-gauge-score { font-size: 28px; font-weight: 700; fill: var(--text); font-family: var(--font); }
    .psi-gauge-cap { margin: 6px 0 0; font-size: 0.7rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
    .psi-card-head { flex: 1; min-width: 220px; }
    .psi-url { margin: 0 0 14px; font-size: 0.9rem; word-break: break-all; line-height: 1.45; }
    .psi-url a { color: var(--accent); font-weight: 500; }
    .psi-cats { display: flex; flex-wrap: wrap; gap: 8px; }
    .psi-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 600;
      border: 1px solid var(--border); background: rgba(0, 0, 0, 0.02);
    }
    .psi-pill-k { font-weight: 600; color: var(--text-muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: .06em; }
    .psi-foot { margin: 14px 0 0; font-size: 0.8rem; }
    .psi-metrics-h { font-size: 1.05rem; margin: 22px 0 0; font-weight: 700; color: var(--text); }
    .psi-metrics-legend { margin: 6px 0 14px; }
    .psi-metrics { list-style: none; margin: 0; padding: 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
    .psi-metric {
      display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: center;
      padding: 12px 14px; border-bottom: 1px solid #f1f5f9; font-size: 0.88rem;
      background: #fff;
    }
    .psi-metric:last-child { border-bottom: none; }
    .psi-metric:nth-child(even) { background: #fafbfc; }
    .psi-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
    .psi-dot--good { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.2); }
    .psi-dot--warn { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.2); }
    .psi-dot--bad { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.2); }
    .psi-dot--na { background: #94a3b8; }
    .psi-metric-label { color: var(--text); font-weight: 500; }
    .psi-metric-val { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
    .psi-opps { margin-top: 20px; padding: 16px 18px; border-radius: 8px; background: #f8fafc; border: 1px solid var(--border); }
    .psi-opps-title { font-size: 0.9rem; margin: 0 0 12px; font-weight: 700; color: var(--text); }
    .psi-opps-list { margin: 0; padding-left: 1.15rem; color: var(--text); font-size: 0.86rem; line-height: 1.55; }
    .psi-opps-list li { margin-bottom: 8px; }
    .psi-opp-title { display: inline; margin-right: 8px; }
    .psi-opp-save { font-weight: 700; color: var(--accent); }
    .master-site-heading {
      margin: 32px 0 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
      font-size: 1.2rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    /* Table filters (client-side) */
    .table-filters {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 10px 14px;
      margin-bottom: 14px;
      padding: 14px 16px;
      background: rgba(0, 0, 0, 0.02);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .table-filters__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .table-filters__label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .table-filters input[type="search"],
    .table-filters input[type="number"],
    .table-filters select {
      font: inherit;
      font-size: 0.88rem;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      min-width: 0;
    }
    .table-filters__search { flex: 1 1 200px; min-width: 160px; }
    .table-filters__search input { width: 100%; }
    .table-filters__reset {
      font: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      align-self: flex-end;
    }
    .table-filters__reset:hover { background: rgba(0, 113, 227, 0.08); border-color: var(--accent); color: var(--accent); }
    .table-filters__count {
      font-size: 0.82rem;
      color: var(--text-muted);
      align-self: center;
      margin-left: auto;
      white-space: nowrap;
    }
    .data-table tbody tr.filter-hidden { display: none !important; }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .issue-triage-cell { white-space: nowrap; }
    .issue-triage-cell--na { color: var(--text-muted); }
    .issue-triage-select {
      font: inherit;
      font-size: 0.78rem;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-solid);
      color: var(--text);
      max-width: 11rem;
    }
    .data-table tbody tr[data-triage-status="ok"] td,
    .data-table tbody tr[data-triage-status="working"] td,
    .data-table tbody tr[data-triage-status="resolved"] td {
      box-shadow: inset 3px 0 0 0 rgba(52, 199, 89, 0.55);
    }
    /* Sticky dashboard-style nav (single-site + combined reports) */
    .report-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: saturate(180%) blur(16px);
      -webkit-backdrop-filter: saturate(180%) blur(16px);
      border-bottom: 1px solid var(--border);
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
    }
    .report-nav__inner {
      max-width: 1180px;
      margin: 0 auto;
      padding: 10px 22px;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 8px;
    }
    .report-nav__brand {
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-right: 12px;
    }
    .report-nav__sep {
      color: var(--text-muted);
      font-weight: 400;
      margin: 0 2px;
      user-select: none;
    }
    .report-nav__link {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      padding: 6px 12px;
      border-radius: 8px;
    }
    .report-nav__link:hover { background: var(--accent-soft); }
    .report-nav__here {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text);
      padding: 6px 12px;
      border-radius: 8px;
      background: rgba(0, 113, 227, 0.08);
    }
    .report-nav__dash { display: none; }
    .report-nav--http .report-nav__dash { display: inline; }
`;

const HEALTH_REPORT_HEAD = `
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <meta name="color-scheme" content="light"/>
`;

const INDEX_PAGE_CSS = `
    :root {
      --bg: #f5f5f7;
      --surface: #ffffff;
      --text: #1d1d1f;
      --muted: #86868b;
      --accent: #0071e3;
      --border: rgba(0, 0, 0, 0.08);
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--font);
      color: var(--text);
      background: linear-gradient(180deg, #e8e8ed 0%, var(--bg) 35%, var(--bg) 100%);
      -webkit-font-smoothing: antialiased;
      padding: 36px 22px 52px;
      letter-spacing: -0.022em;
    }
    .idx-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: saturate(180%) blur(16px);
      border-bottom: 1px solid var(--border);
      margin: -36px -22px 24px -22px;
      padding: 12px 22px;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 12px;
    }
    .idx-nav__brand {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-right: 8px;
    }
    .idx-nav__link {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      padding: 6px 12px;
      border-radius: 8px;
    }
    .idx-nav__link:hover { background: rgba(0, 113, 227, 0.08); }
    .idx-nav__here {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text);
      padding: 6px 12px;
      border-radius: 8px;
      background: rgba(0, 113, 227, 0.08);
    }
    .idx-nav__dash { display: none; }
    .idx-nav--http .idx-nav__dash { display: inline; }
    .idx-wrap { max-width: 960px; margin: 0 auto; }
    .idx-hero {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
      border-radius: 20px;
      padding: 32px 34px;
      margin-bottom: 24px;
      border: 1px solid var(--border);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
    }
    .idx-hero h1 { margin: 0 0 10px; font-size: 1.75rem; font-weight: 600; letter-spacing: -0.03em; }
    .idx-kicker { margin: 0 0 18px; font-size: 0.72rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .idx-meta { margin: 0 0 8px; font-size: 0.9375rem; color: var(--muted); }
    .idx-meta strong { color: var(--text); font-weight: 600; }
    .idx-combined {
      margin-top: 16px;
      padding: 14px 18px;
      background: rgba(0, 113, 227, 0.06);
      border: 1px solid rgba(0, 113, 227, 0.15);
      border-radius: 12px;
      font-size: 0.9375rem;
    }
    .idx-combined a { color: var(--accent); font-weight: 600; text-decoration: none; }
    .idx-combined a:hover { text-decoration: underline; }
    .idx-table-wrap {
      background: var(--surface);
      border-radius: 16px;
      border: 1px solid var(--border);
      overflow: hidden;
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.06);
    }
    table.idx-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .idx-table th {
      text-align: left;
      padding: 14px 18px;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: var(--muted);
      font-weight: 600;
      background: rgba(0, 0, 0, 0.02);
      border-bottom: 1px solid var(--border);
    }
    .idx-table td { padding: 14px 18px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); vertical-align: middle; }
    .idx-table tr:last-child td { border-bottom: none; }
    .idx-table tr:hover td { background: rgba(0, 113, 227, 0.04); }
    .idx-table a { color: var(--accent); font-weight: 600; text-decoration: none; font-size: 0.8125rem; }
    .idx-table a:hover { text-decoration: underline; }
    .idx-foot { margin-top: 22px; font-size: 0.8125rem; color: var(--muted); line-height: 1.5; }
`;

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildStartPageScreenshotHtml(c: CrawlSiteResult, startUrl: string): string {
  const s = c.startPageScreenshot;
  if (!s) return "";
  const mode = s.fullPage ? "full page" : "viewport";
  const baseDesc = `Headless Chromium · ${s.viewportWidth}×${s.viewportHeight} · ${mode} · capture ${formatDuration(s.durationMs)}`;
  if (s.error && !s.fileName) {
    return `<section class="report-section">
    <h2>Start page screenshot</h2>
    <p class="section-desc">${esc(baseDesc)}</p>
    <p class="cell-err">Could not capture: ${esc(s.error)}</p>
  </section>`;
  }
  if (!s.fileName) return "";
  return `<section class="report-section">
    <h2>Start page screenshot</h2>
    <p class="section-desc">${esc(baseDesc)} · <a href="${esc(startUrl)}">${esc(startUrl)}</a></p>
    <div class="screenshot-wrap">
      <a href="${esc(s.fileName)}" target="_blank" rel="noopener noreferrer">
        <img src="${esc(s.fileName)}" alt="Screenshot of the start page" class="screenshot-img" loading="lazy"/>
      </a>
    </div>
    ${s.error ? `<p class="meta">Note: ${esc(s.error)}</p>` : ""}
  </section>`;
}

/** Stable id for triage persistence (matches across HTML regenerations for same logical issue). */
function issueKeyHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("base64url").slice(0, 24);
}

function triageSelectCell(issueKey: string): string {
  const id = `triage-${issueKey}`;
  return `<td class="issue-triage-cell">
  <label class="visually-hidden" for="${id}">Triage</label>
  <select class="issue-triage-select" id="${id}" data-issue-key="${esc(issueKey)}" aria-label="Triage status">
    <option value="open">Open</option>
    <option value="ok">OK</option>
    <option value="working">Working</option>
    <option value="resolved">Resolved</option>
  </select>
</td>`;
}

function triageEmptyCell(): string {
  return `<td class="issue-triage-cell issue-triage-cell--na">—</td>`;
}

/** Sticky nav shared by per-site and combined health HTML (stable links via master.html). */
function buildHealthNavHtml(opts: { variant: "site" | "master" }): string {
  const indexHref = opts.variant === "site" ? "../index.html" : "./index.html";
  const combinedHref = opts.variant === "site" ? "../master.html" : "./master.html";
  if (opts.variant === "site") {
    return `<nav class="report-nav" aria-label="Health run navigation">
  <div class="report-nav__inner">
    <span class="report-nav__brand">QA-Agent</span>
    <a class="report-nav__link" href="${indexHref}">Run index</a>
    <span class="report-nav__sep" aria-hidden="true">·</span>
    <a class="report-nav__link" href="${combinedHref}">Combined report</a>
    <span class="report-nav__sep" aria-hidden="true">·</span>
    <a class="report-nav__link report-nav__dash" href="/">Live dashboard</a>
  </div>
</nav>`;
  }
  return `<nav class="report-nav" aria-label="Health run navigation">
  <div class="report-nav__inner">
    <span class="report-nav__brand">QA-Agent</span>
    <a class="report-nav__link" href="${indexHref}">Run index</a>
    <span class="report-nav__sep" aria-hidden="true">·</span>
    <span class="report-nav__here" aria-current="page">Combined report</span>
    <span class="report-nav__sep" aria-hidden="true">·</span>
    <a class="report-nav__link report-nav__dash" href="/">Live dashboard</a>
  </div>
</nav>`;
}

const HEALTH_NAV_SCRIPT = `<script>
(function(){
  if(location.protocol==="http:"||location.protocol==="https:"){
    document.querySelectorAll(".report-nav").forEach(function(n){ n.classList.add("report-nav--http"); });
    document.querySelectorAll(".idx-nav").forEach(function(n){ n.classList.add("idx-nav--http"); });
  }
})();
<\/script>`;

/** Small redirect page so per-site reports can link to ../master.html before the timestamped filename exists. */
export function buildMasterRedirectHtml(masterHtmlFileName: string): string {
  const base = path.basename(masterHtmlFileName);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Combined health — opening…</title>
  <meta http-equiv="refresh" content="0;url=${esc(base)}"/>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;background:#f5f5f7;color:#444">
  <p>Opening <a href="${esc(base)}">combined health report</a>…</p>
</body>
</html>`;
}

/** Size column: flag empty 200 bodies (often bot/WAF or shell-only HTML). */
function pageBodySizeCell(p: PageFetchRecord): string {
  if (p.bodyBytes == null) return "—";
  if (p.bodyBytes === 0 && p.ok) {
    return `<span title="Empty body with HTTP 2xx — server may strip content for this User-Agent or return a shell only. Set QA_AGENT_USER_AGENT or inspect the URL in a browser.">0 B</span>`;
  }
  return formatBytes(p.bodyBytes);
}

function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const rounded = i === 0 ? Math.round(v) : v >= 10 ? Math.round(v) : Number(v.toFixed(1));
  return `${rounded} ${units[i]}`;
}

interface PageAggregateStats {
  count: number;
  okCount: number;
  successPct: number;
  avgMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  totalBytes: number;
  http2xx: number;
  http3xx: number;
  http4xx: number;
  http5xx: number;
  httpErr: number;
  redirectedCount: number;
}

function computePageAggregateStats(pages: PageFetchRecord[]): PageAggregateStats {
  const count = pages.length;
  if (count === 0) {
    return {
      count: 0,
      okCount: 0,
      successPct: 0,
      avgMs: 0,
      medianMs: 0,
      p95Ms: 0,
      minMs: 0,
      maxMs: 0,
      totalBytes: 0,
      http2xx: 0,
      http3xx: 0,
      http4xx: 0,
      http5xx: 0,
      httpErr: 0,
      redirectedCount: 0,
    };
  }
  const times = pages.map((p) => p.durationMs).sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const mid = Math.floor((times.length - 1) / 2);
  const medianMs =
    times.length % 2 === 1 ? times[mid]! : Math.round((times[mid]! + times[mid + 1]!) / 2);
  const p95Idx = Math.max(0, Math.ceil(0.95 * times.length) - 1);
  const p95Ms = times[p95Idx] ?? 0;
  let okCount = 0;
  let totalBytes = 0;
  let http2xx = 0;
  let http3xx = 0;
  let http4xx = 0;
  let http5xx = 0;
  let httpErr = 0;
  let redirectedCount = 0;
  for (const p of pages) {
    if (p.ok) okCount++;
    if (p.bodyBytes != null) totalBytes += p.bodyBytes;
    if (p.redirected) redirectedCount++;
    if (p.status === 0) httpErr++;
    else if (p.status >= 200 && p.status < 300) http2xx++;
    else if (p.status >= 300 && p.status < 400) http3xx++;
    else if (p.status >= 400 && p.status < 500) http4xx++;
    else if (p.status >= 500) http5xx++;
  }
  return {
    count,
    okCount,
    successPct: Math.round((100 * okCount) / count),
    avgMs: Math.round(sum / count),
    medianMs,
    p95Ms,
    minMs: times[0] ?? 0,
    maxMs: times[times.length - 1] ?? 0,
    totalBytes,
    http2xx,
    http3xx,
    http4xx,
    http5xx,
    httpErr,
    redirectedCount,
  };
}

function shortMime(m: string | undefined): string {
  if (!m) return "—";
  return m.length > 40 ? `${m.slice(0, 37)}…` : m;
}

function displayRedirectPath(p: PageFetchRecord): string {
  if (!p.redirected || !p.finalUrl) return "—";
  if (p.finalUrl === p.url) return "—";
  try {
    const u = new URL(p.finalUrl);
    const path = `${u.pathname}${u.search}`;
    return path.length > 42 ? `${path.slice(0, 39)}…` : path || "—";
  } catch {
    return p.finalUrl.length > 42 ? `${p.finalUrl.slice(0, 39)}…` : p.finalUrl;
  }
}

function redirectYesNo(p: PageFetchRecord): string {
  return p.redirected ? "Yes" : "No";
}

/** Truncated `<title>` with full text in tooltip. */
function cellPageTitleHtml(p: PageFetchRecord): string {
  const t = p.documentTitle?.trim();
  if (!t) return "—";
  const max = 80;
  const show = t.length > max ? `${t.slice(0, max)}…` : t;
  return `<span title="${esc(t)}">${esc(show)}</span>`;
}

function cellMetaDescLen(p: PageFetchRecord): string {
  if (p.metaDescriptionLength === undefined) return "—";
  return String(p.metaDescriptionLength);
}

function cellH1Count(p: PageFetchRecord): string {
  if (p.h1Count === undefined) return "—";
  return String(p.h1Count);
}

function cellDocumentLang(p: PageFetchRecord): string {
  const l = p.documentLang?.trim();
  return l ? esc(l) : "—";
}

function cellCanonicalLink(p: PageFetchRecord): string {
  const c = p.canonicalUrl;
  if (!c) return "—";
  const max = 64;
  const show = c.length > max ? `${c.slice(0, max)}…` : c;
  return `<a href="${esc(c)}" title="${esc(c)}">${esc(show)}</a>`;
}

/** Human-readable outcome for the “Pages fetched” table. */
function pageFetchResult(p: PageFetchRecord): string {
  if (p.ok) return "OK";
  const err = (p.error ?? "").toLowerCase();
  if (err.includes("timeout") || err.includes("timed out") || err.includes("aborted")) {
    return "Timeout";
  }
  if (p.status === 0) {
    return "Network error";
  }
  if (p.status >= 400) {
    return `HTTP error (${p.status})`;
  }
  return "Failed";
}

/** Filter token for Pages fetched rows (must match filter dropdown values). */
function pageFetchFilterKey(p: PageFetchRecord): string {
  if (p.ok) return "ok";
  const err = (p.error ?? "").toLowerCase();
  if (err.includes("timeout") || err.includes("timed out") || err.includes("aborted")) {
    return "timeout";
  }
  if (p.status === 0) return "network";
  if (p.status >= 400) return "http-error";
  return "failed";
}

function brokenHttpKind(status: number | undefined): string {
  if (status == null || status === 0) return "no-status";
  if (status >= 400 && status < 500) return "http-4xx";
  if (status >= 500) return "http-5xx";
  return "other";
}

const FILTER_STATUS_PAGES: { value: string; label: string }[] = [
  { value: "", label: "All results" },
  { value: "ok", label: "OK" },
  { value: "timeout", label: "Timeout" },
  { value: "network", label: "Network error" },
  { value: "http-error", label: "HTTP error (4xx/5xx)" },
  { value: "failed", label: "Failed (other)" },
];

const FILTER_STATUS_LINKS: { value: string; label: string }[] = [
  { value: "", label: "All results" },
  { value: "ok", label: "OK" },
  { value: "failed", label: "Failed" },
];

const FILTER_STATUS_BROKEN: { value: string; label: string }[] = [
  { value: "", label: "All HTTP" },
  { value: "http-4xx", label: "4xx" },
  { value: "http-5xx", label: "5xx" },
  { value: "no-status", label: "No / 0 status" },
  { value: "other", label: "Other (2xx/3xx)" },
];

function buildTableFiltersHtml(
  tableId: string,
  statusOptions: { value: string; label: string }[],
  statusLabel = "Result",
): string {
  const opts = statusOptions.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
  return `<div class="table-filters" data-table-filters-for="${esc(tableId)}">
  <label class="table-filters__field table-filters__search">
    <span class="table-filters__label">Search</span>
    <input type="search" placeholder="URL or text…" autocomplete="off" data-filter-field="search" />
  </label>
  <label class="table-filters__field">
    <span class="table-filters__label">Min ms</span>
    <input type="number" inputmode="numeric" min="0" step="1" data-filter-field="min-ms" placeholder="—" />
  </label>
  <label class="table-filters__field">
    <span class="table-filters__label">Max ms</span>
    <input type="number" inputmode="numeric" min="0" step="1" data-filter-field="max-ms" placeholder="—" />
  </label>
  <label class="table-filters__field">
    <span class="table-filters__label">${esc(statusLabel)}</span>
    <select data-filter-field="status">${opts}</select>
  </label>
  <button type="button" class="table-filters__reset" data-filter-reset>Clear</button>
  <span class="table-filters__count" data-filter-count aria-live="polite"></span>
</div>`;
}

/** Inline script: show/hide rows by data-filter-* on each tr. */
const HEALTH_TABLE_FILTERS_SCRIPT = `<script>
(function(){
  function parseNum(v){ var n=parseFloat(v); return isNaN(n)?NaN:n; }
  function apply(container){
    var id=container.getAttribute("data-table-filters-for");
    if(!id)return;
    var table=document.getElementById(id);
    if(!table)return;
    var searchEl=container.querySelector("[data-filter-field=search]");
    var search=((searchEl&&searchEl.value)||"").trim().toLowerCase();
    var minV=parseNum((container.querySelector("[data-filter-field=min-ms]")||{}).value||"");
    var maxV=parseNum((container.querySelector("[data-filter-field=max-ms]")||{}).value||"");
    var status=(container.querySelector("[data-filter-field=status]")||{}).value||"";
    var rows=table.querySelectorAll("tbody tr");
    var total=0, visible=0;
    rows.forEach(function(tr){
      if(tr.getAttribute("data-filter-skip")==="1")return;
      total++;
      var text=(tr.getAttribute("data-filter-text")||"").toLowerCase();
      var ms=parseFloat(tr.getAttribute("data-filter-ms"));
      if(isNaN(ms))ms=0;
      var res=tr.getAttribute("data-filter-result")||"";
      var ok=true;
      if(search&&text.indexOf(search)===-1)ok=false;
      if(!isNaN(minV)&&ms<minV)ok=false;
      if(!isNaN(maxV)&&ms>maxV)ok=false;
      if(status&&res!==status)ok=false;
      if(ok){ tr.classList.remove("filter-hidden"); visible++; }
      else{ tr.classList.add("filter-hidden"); }
    });
    var c=container.querySelector("[data-filter-count]");
    if(c)c.textContent=visible+(total?(" / "+total):"")+" shown";
  }
  function wire(container){
    var go=function(){ apply(container); };
    var t;
    container.querySelectorAll("input,select").forEach(function(el){
      if(el.getAttribute("data-filter-field")==="search"){
        el.addEventListener("input",function(){
          clearTimeout(t);
          t=setTimeout(go,100);
        });
      } else {
        el.addEventListener("input",go);
        el.addEventListener("change",go);
      }
    });
    var reset=container.querySelector("[data-filter-reset]");
    if(reset)reset.addEventListener("click",function(){
      container.querySelectorAll("input").forEach(function(i){ i.value=""; });
      var s=container.querySelector("[data-filter-field=status]");
      if(s)s.selectedIndex=0;
      go();
    });
    go();
  }
  document.querySelectorAll("[data-table-filters-for]").forEach(wire);
})();
<\/script>`;

/** Persist triage (Open / OK / Working / Resolved) per issue row; merges server JSON + localStorage; POST saves issue-overrides.json on the run folder. */
const HEALTH_ISSUE_TRIAGE_SCRIPT = `<script>
(function(){
  function runId(){ return document.body.getAttribute("data-run-id")||""; }
  function storageKey(){ return "qa-agent-issue-overrides-"+(runId()||"default"); }
  function loadLocal(){ try{ return JSON.parse(localStorage.getItem(storageKey())||"{}")||{}; }catch(e){ return {}; } }
  function saveLocal(o){ try{ localStorage.setItem(storageKey(), JSON.stringify(o)); }catch(e){} }
  function banner(){
    var el=document.getElementById("qa-agent-triage-banner");
    if(!el){
      el=document.createElement("p");
      el.id="qa-agent-triage-banner";
      el.setAttribute("role","status");
      el.setAttribute("aria-live","polite");
      el.style.cssText="margin:0 0 14px;font-size:0.85rem;color:#64748b;padding:10px 14px;border-radius:10px;border:1px solid rgba(0,0,0,0.08);background:rgba(0,0,0,0.02);";
      var shell=document.querySelector(".report-shell");
      if(shell) shell.insertBefore(el, shell.firstChild);
      else document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }
  function applyRow(tr, sel, map){
    var k=tr.getAttribute("data-issue-key");
    if(!k)return;
    var v=map[k]||"open";
    if(sel)sel.value=v;
    tr.setAttribute("data-triage-status", v);
  }
  function merge(a,b){
    var o={};
    for(var k in a)o[k]=a[k];
    for(var k in b)o[k]=b[k];
    return o;
  }
  async function loadServer(){
    var rid=runId();
    if(!rid)return {};
    try{
      var r=await fetch("/reports/"+encodeURIComponent(rid)+"/issue-overrides.json",{cache:"no-store"});
      if(!r.ok)return {};
      var j=await r.json();
      return (j&&typeof j==="object"&&j.overrides&&typeof j.overrides==="object")?j.overrides:j;
    }catch(e){ return {}; }
  }
  async function postAll(map){
    var rid=runId();
    if(!rid)return false;
    var p=window.location.protocol;
    if(p!=="http:"&&p!=="https:"){
      banner().textContent="Open this report via the dashboard (http://127.0.0.1:…) to save triage to issue-overrides.json on disk.";
      return false;
    }
    try{
      var res=await fetch("/api/issue-overrides",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({runId:rid,overrides:map})});
      var txt=await res.text();
      var data={};
      try{ data=JSON.parse(txt);}catch(e){}
      if(!res.ok)throw new Error((data&&data.message)||txt.slice(0,220)||res.statusText||"Save failed");
      if(!data.ok)throw new Error(txt.slice(0,220));
      if(data.overrides&&typeof data.overrides==="object")saveLocal(data.overrides);
      else saveLocal(map);
      banner().textContent="Triage saved to this run (issue-overrides.json). Reopen the report any time — status loads from that file.";
      banner().style.color="#059669";
      return true;
    }catch(e){
      banner().textContent="Could not save triage: "+(e&&e.message?e.message:String(e));
      banner().style.color="#dc2626";
      return false;
    }
  }
  async function init(){
    var server=await loadServer();
    var local=loadLocal();
    var map=merge(server,local);
    document.querySelectorAll("tr[data-issue-key]").forEach(function(tr){
      var sel=tr.querySelector(".issue-triage-select");
      applyRow(tr, sel, map);
    });
    document.querySelectorAll(".issue-triage-select").forEach(function(sel){
      sel.addEventListener("change", async function(){
        var tr=sel.closest("tr");
        var k=tr&&tr.getAttribute("data-issue-key");
        if(!k)return;
        var m=loadLocal();
        m[k]=sel.value;
        saveLocal(m);
        if(tr)tr.setAttribute("data-triage-status", sel.value);
        await postAll(m);
      });
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
<\/script>`;

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return `${ms}`;
}

/** Human-readable duration for stat cards. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtScore(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${n}`;
}

/** Background for Lighthouse category scores (0–100). */
function scoreCellClass(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 50) return "score-bad";
  if (n < 90) return "score-warn";
  return "score-good";
}

/** Lighthouse-style lab thresholds (approximate; same spirit as PageSpeed Insights). */
type MetricRating = "good" | "warn" | "bad" | "na";

function rateFcp(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 1800) return "good";
  if (ms <= 3000) return "warn";
  return "bad";
}
function rateLcp(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 2500) return "good";
  if (ms <= 4000) return "warn";
  return "bad";
}
function rateTbt(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 200) return "good";
  if (ms <= 600) return "warn";
  return "bad";
}
function rateCls(v: number | undefined): MetricRating {
  if (v == null) return "na";
  if (v <= 0.1) return "good";
  if (v <= 0.25) return "warn";
  return "bad";
}
function rateSpeedIndex(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 3400) return "good";
  if (ms <= 5800) return "warn";
  return "bad";
}
function rateTti(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 3800) return "good";
  if (ms <= 7300) return "warn";
  return "bad";
}

const GAUGE_R = 54;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function perfGaugeColor(score: number | undefined): string {
  if (score == null) return "#9e9e9e";
  if (score < 50) return "#ff4e42";
  if (score < 90) return "#ffa400";
  return "#0cce6b";
}

function buildPsiCardHtml(ins: PageSpeedInsightRecord): string {
  if (ins.error) {
    return `<article class="psi-card psi-card-err">
  <p class="meta" style="margin:0 0 8px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">${esc(ins.strategy)}</p>
  <p class="psi-url"><a href="${esc(ins.url)}">${esc(ins.url)}</a></p>
  <p class="err">${esc(ins.error)} <span class="meta">(API ${ins.durationMs}ms)</span></p>
</article>`;
  }

  const s = ins.scores;
  const m = ins.metrics;
  const d = ins.display;
  const perf = s?.performance;
  const dash = perf != null ? (GAUGE_C * perf) / 100 : 0;

  const clsDisplay = d?.cls ?? (m?.cls != null ? String(m.cls) : undefined);

  const metricLine = (label: string, display: string | undefined, rating: MetricRating) => {
    const r = rating === "na" ? "na" : rating;
    return `<li class="psi-metric psi-metric--${r}">
    <span class="psi-dot psi-dot--${r}" title="${r}"></span>
    <span class="psi-metric-label">${esc(label)}</span>
    <span class="psi-metric-val">${esc(display ?? "—")}</span>
  </li>`;
  };

  const opps = ins.opportunities ?? [];
  const oppsHtml =
    opps.length === 0
      ? ""
      : `<div class="psi-opps">
    <h3 class="psi-opps-title">Diagnostics &amp; opportunities</h3>
    <ul class="psi-opps-list">
      ${opps
        .map(
          (o) => `<li><span class="psi-opp-title">${esc(o.title)}</span>
        ${o.displayValue ? `<span class="psi-opp-save">${esc(o.displayValue)}</span>` : ""}</li>`,
        )
        .join("\n")}
    </ul>
  </div>`;

  return `<article class="psi-card">
  <div class="psi-card-top">
    <div class="psi-gauge-box" style="--gauge-color: ${perfGaugeColor(perf)}">
      <svg class="psi-gauge" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="psi-gauge-bg" cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="10" />
        <circle class="psi-gauge-fg" cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="10"
          stroke="${perfGaugeColor(perf)}"
          stroke-dasharray="${dash} ${GAUGE_C}"
          stroke-linecap="round"
          transform="rotate(-90 60 60)" />
        <text class="psi-gauge-score" x="60" y="66" text-anchor="middle">${perf != null ? esc(String(perf)) : "—"}</text>
      </svg>
      <p class="psi-gauge-cap">Performance</p>
    </div>
    <div class="psi-card-head">
      <p class="psi-url"><a href="${esc(ins.url)}">${esc(ins.url)}</a></p>
      <div class="psi-cats" role="group" aria-label="Category scores">
        <span class="psi-pill ${scoreCellClass(s?.performance)}"><span class="psi-pill-k">Perf</span> ${fmtScore(s?.performance)}</span>
        <span class="psi-pill ${scoreCellClass(s?.accessibility)}"><span class="psi-pill-k">A11y</span> ${fmtScore(s?.accessibility)}</span>
        <span class="psi-pill ${scoreCellClass(s?.bestPractices)}"><span class="psi-pill-k">BP</span> ${fmtScore(s?.bestPractices)}</span>
        <span class="psi-pill ${scoreCellClass(s?.seo)}"><span class="psi-pill-k">SEO</span> ${fmtScore(s?.seo)}</span>
      </div>
      <p class="psi-foot meta">Lighthouse lab · ${esc(ins.strategy)} · API ${ins.durationMs}ms</p>
    </div>
  </div>
  <h3 class="psi-metrics-h">Metrics</h3>
  <p class="meta psi-metrics-legend">Green / orange / red follow typical Lighthouse lab thresholds (not field data).</p>
  <ul class="psi-metrics">
    ${metricLine("First Contentful Paint", d?.fcp, rateFcp(m?.fcpMs))}
    ${metricLine("Largest Contentful Paint", d?.lcp, rateLcp(m?.lcpMs))}
    ${metricLine("Total Blocking Time", d?.tbt, rateTbt(m?.tbtMs))}
    ${metricLine("Cumulative Layout Shift", clsDisplay, rateCls(m?.cls))}
    ${metricLine("Speed Index", d?.speedIndex, rateSpeedIndex(m?.speedIndexMs))}
    ${metricLine("Time to Interactive", d?.tti, rateTti(m?.ttiMs))}
  </ul>
  ${oppsHtml}
</article>`;
}

function httpPillsHtml(agg: PageAggregateStats): string {
  if (agg.count === 0) return "";
  return `<div class="http-pills" role="group" aria-label="HTTP status counts">
    <span class="http-pills__label">Responses</span>
    <span class="http-pill http-pill--2xx">2xx · ${agg.http2xx}</span>
    <span class="http-pill http-pill--3xx">3xx · ${agg.http3xx}</span>
    <span class="http-pill http-pill--4xx">4xx · ${agg.http4xx}</span>
    <span class="http-pill http-pill--5xx">5xx · ${agg.http5xx}</span>
    <span class="http-pill http-pill--err">Err · ${agg.httpErr}</span>
  </div>`;
}

export function buildSiteHealthHtml(
  report: SiteHealthReport,
  options?: { runId?: string },
): string {
  const runIdAttr = options?.runId ?? "";
  const c = report.crawl;
  const host = c.hostname;
  const agg = computePageAggregateStats(c.pages);
  const brokenSorted = [...c.brokenLinks].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
  const pagesSorted = [...c.pages].sort((a, b) => b.durationMs - a.durationMs);
  const linkChecksSorted = [...(c.linkChecks ?? [])].sort((a, b) => b.durationMs - a.durationMs);

  const psiPages = c.pages
    .filter((p) => hasPageSpeedInsights(p))
    .sort((a, b) => bestPerformanceScore(a) - bestPerformanceScore(b));

  const brokenRows =
    brokenSorted.length === 0
      ? `<tr data-filter-skip="1"><td colspan="6"><div class="empty-state">No broken internal links detected in this run.</div></td></tr>`
      : brokenSorted
          .map((b) => {
            const ms = b.durationMs ?? 0;
            const ft = `${b.foundOn} ${b.target} ${b.error ?? ""}`.toLowerCase();
            const ikey = issueKeyHash(["broken", host, b.foundOn, b.target, String(b.status ?? ""), b.error ?? ""]);
            return `<tr data-issue-key="${esc(ikey)}" data-filter-text="${esc(ft)}" data-filter-ms="${String(ms)}" data-filter-result="${brokenHttpKind(b.status)}">
  <td>${esc(b.foundOn)}</td>
  <td><a href="${esc(b.target)}">${esc(b.target)}</a></td>
  <td>${b.status ?? "—"}</td>
  <td class="num">${fmtMs(b.durationMs)}</td>
  <td class="cell-err">${esc(b.error ?? "")}</td>
  ${triageSelectCell(ikey)}
</tr>`;
          })
          .join("\n");

  const brokenFilters =
    brokenSorted.length === 0 ? "" : buildTableFiltersHtml("health-table-broken", FILTER_STATUS_BROKEN, "HTTP");

  const psiMetaHtml = c.pageSpeedInsightsMeta
    ? `<div class="stat"><span class="stat-label">PageSpeed API</span><span class="stat-value">${esc(psiStrategiesLabel(c.pageSpeedInsightsMeta))} <small>· ${c.pageSpeedInsightsMeta.urlsAnalyzed} URLs · ${formatDuration(c.pageSpeedInsightsMeta.totalDurationMs)}</small></span></div>`
    : "";
  const viewportMetaHtml = c.viewportMeta
    ? `<div class="stat"><span class="stat-label">Viewport checks</span><span class="stat-value">Chromium <small>· ${c.viewportMeta.urlsChecked} URLs · ${formatDuration(c.viewportMeta.totalDurationMs)}</small></span></div>`
    : "";

  const aggStatsHtml =
    agg.count === 0
      ? ""
      : `<div class="stat-grid stat-grid--wide">
    <div class="stat"><span class="stat-label">Avg response</span><span class="stat-value">${agg.avgMs}<small> ms</small></span></div>
    <div class="stat"><span class="stat-label">Median</span><span class="stat-value">${agg.medianMs}<small> ms</small></span></div>
    <div class="stat"><span class="stat-label">P95</span><span class="stat-value">${agg.p95Ms}<small> ms</small></span></div>
    <div class="stat"><span class="stat-label">Min · max</span><span class="stat-value">${agg.minMs}<small> · ${agg.maxMs} ms</small></span></div>
    <div class="stat"><span class="stat-label">Success rate</span><span class="stat-value">${agg.successPct}<small> %</small></span></div>
    <div class="stat"><span class="stat-label">HTML transferred</span><span class="stat-value">${formatBytes(agg.totalBytes)}</span></div>
    <div class="stat"><span class="stat-label">Redirects</span><span class="stat-value">${agg.redirectedCount}<small> pages</small></span></div>
  </div>
  ${httpPillsHtml(agg)}`;

  const startPageShotHtml = buildStartPageScreenshotHtml(c, report.startUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${HEALTH_REPORT_HEAD}
  <title>Health — ${esc(c.hostname)}</title>
  <style>${HEALTH_REPORT_CSS}</style>
</head>
<body data-run-id="${esc(runIdAttr)}">
  ${buildHealthNavHtml({ variant: "site" })}
  <div class="report-shell">
  <header class="report-header">
    <p class="report-kicker">QA-Agent · Site health</p>
    <h1>${esc(c.hostname)}</h1>
    <p class="lead">Start URL: <a href="${esc(c.startUrl)}">${esc(c.startUrl)}</a></p>
    <div class="stat-grid">
      <div class="stat"><span class="stat-label">Crawl time</span><span class="stat-value">${formatDuration(c.durationMs)} <small>(${c.durationMs} ms)</small></span></div>
      <div class="stat"><span class="stat-label">Pages crawled</span><span class="stat-value">${c.pagesVisited}</span></div>
      <div class="stat"><span class="stat-label">URLs checked</span><span class="stat-value">${c.uniqueUrlsChecked}</span></div>
      <div class="stat"><span class="stat-label">Broken rows</span><span class="stat-value">${c.brokenLinks.length}</span></div>
      ${psiMetaHtml}
      ${viewportMetaHtml}
    </div>
    ${aggStatsHtml}
    <p class="meta" style="margin:20px 0 0;">Run window: ${esc(report.startedAt)} → ${esc(report.finishedAt)}</p>
  </header>

  ${startPageShotHtml}

  <section class="report-section">
    <h2>Broken internal links</h2>
    <p class="section-desc">Wall-clock time for the HTTP call that reported the issue. Sorted slowest first.</p>
    ${brokenFilters}
    <div class="table-wrap">
    <table class="data-table" id="health-table-broken">
      <thead><tr><th>Found on</th><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Detail</th><th>Triage</th></tr></thead>
      <tbody>${brokenRows}</tbody>
    </table>
    </div>
  </section>

  <section class="report-section">
    <h2>Pages fetched</h2>
    <p class="section-desc">Full page GET (headers + HTML body). <strong>Title</strong>, <strong>Meta</strong> (description length), <strong>H1</strong>, <strong>Lang</strong>, and <strong>Canonical</strong> are parsed from HTML when a body was read. <strong>Type</strong> is the response MIME; <strong>Size</strong> is UTF-8 bytes of the body; <strong>Redirect</strong> shows when the final URL differed. Sorted slowest first.</p>
    ${buildTableFiltersHtml("health-table-pages", FILTER_STATUS_PAGES)}
    <div class="table-wrap">
    <table class="data-table" id="health-table-pages">
      <thead><tr><th>URL</th><th>Title</th><th class="num">Meta</th><th class="num">H1</th><th>Lang</th><th>Canonical</th><th>HTTP</th><th class="num">Time (ms)</th><th>Type</th><th class="num">Size</th><th>Redirect</th><th>Result</th><th>Triage</th></tr></thead>
      <tbody>
        ${pagesSorted
          .map((p) => {
            const ft = `${p.url} ${p.contentType ?? ""} ${p.documentTitle ?? ""}`.toLowerCase();
            const sizeCell = pageBodySizeCell(p);
            const redir =
              p.redirected && p.finalUrl && p.finalUrl !== p.url
                ? `<strong>${esc(redirectYesNo(p))}</strong><br/><span class="cell-mono">${esc(displayRedirectPath(p))}</span>`
                : esc(redirectYesNo(p));
            const pageKey = issueKeyHash(["page", host, p.url]);
            const triage = p.ok ? triageEmptyCell() : triageSelectCell(pageKey);
            const issueAttr = p.ok ? "" : ` data-issue-key="${esc(pageKey)}"`;
            return `<tr class="${p.ok ? "row-ok" : "row-err"}"${issueAttr} data-filter-text="${esc(ft)}" data-filter-ms="${String(p.durationMs)}" data-filter-result="${pageFetchFilterKey(p)}">
          <td><a href="${esc(p.url)}">${esc(p.url)}</a></td>
          <td>${cellPageTitleHtml(p)}</td>
          <td class="num">${esc(cellMetaDescLen(p))}</td>
          <td class="num">${esc(cellH1Count(p))}</td>
          <td>${cellDocumentLang(p)}</td>
          <td>${cellCanonicalLink(p)}</td>
          <td>${p.status}</td>
          <td class="num">${p.durationMs}</td>
          <td><span title="${esc(p.contentType ?? "")}">${esc(shortMime(p.contentType))}</span></td>
          <td class="num">${sizeCell}</td>
          <td>${redir}</td>
          <td class="${p.ok ? "cell-ok" : "cell-err"}">${esc(pageFetchResult(p))}</td>
          ${triage}
        </tr>`;
          })
          .join("\n")}
      </tbody>
    </table>
    </div>
  </section>

  ${
    psiPages.length === 0
      ? ""
      : `<section class="report-section">
    <h2>PageSpeed Insights</h2>
    <p class="section-desc">Lighthouse lab metrics (same engine as <a href="https://pagespeed.web.dev/" rel="noopener noreferrer">PageSpeed Insights</a>). Not field / CrUX data. Sorted by lowest performance score first. Lab errors such as NO_FCP are common on some sites; retry later or use <code>--pagespeed-strategy mobile</code> / <code>desktop</code> alone.</p>
    <div class="psi-grid">
      ${psiPages
        .map((p) => flattenInsights(p.insights).map((ins) => buildPsiCardHtml(ins)).join("\n"))
        .join("\n")}
    </div>
  </section>`
  }

  ${
    (c.viewportChecks?.length ?? 0) === 0
      ? ""
      : `<section class="report-section">
    <h2>Mobile &amp; desktop viewport loads</h2>
    <p class="section-desc">Headless Chromium: <strong>390×844</strong> (mobile) vs <strong>1920×1080</strong> (desktop). <strong>OK</strong> means HTTP 2xx after <code>domcontentloaded</code>. Console column counts <code>console.error</code> events.</p>
    <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>URL</th><th class="num">Mobile ms</th><th>Mobile</th><th class="num">M cons.</th><th class="num">Desktop ms</th><th>Desktop</th><th class="num">D cons.</th></tr></thead>
      <tbody>${buildViewportRowsHtml(c.viewportChecks ?? [])}</tbody>
    </table>
    </div>
  </section>`
  }

  ${
    linkChecksSorted.length === 0
      ? ""
      : `<section class="report-section">
    <h2>Internal link checks</h2>
    <p class="section-desc">Same-origin URLs not fetched as full pages in BFS; verified with HEAD or tiny GET. Sorted slowest first.</p>
    ${buildTableFiltersHtml("health-table-links", FILTER_STATUS_LINKS)}
    <div class="table-wrap">
    <table class="data-table" id="health-table-links">
      <thead><tr><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Method</th><th>Result</th><th>Triage</th></tr></thead>
      <tbody>
        ${linkChecksSorted
          .map((l) => {
            const linkKey = issueKeyHash(["link", host, l.target, l.method]);
            const triage = l.ok ? triageEmptyCell() : triageSelectCell(linkKey);
            const issueAttr = l.ok ? "" : ` data-issue-key="${esc(linkKey)}"`;
            return `<tr class="${l.ok ? "row-ok" : "row-err"}"${issueAttr} data-filter-text="${esc(l.target.toLowerCase())}" data-filter-ms="${String(l.durationMs)}" data-filter-result="${l.ok ? "ok" : "failed"}">
          <td><a href="${esc(l.target)}">${esc(l.target)}</a></td>
          <td>${l.status}</td>
          <td class="num">${l.durationMs}</td>
          <td>${esc(l.method)}</td>
          <td class="${l.ok ? "cell-ok" : "cell-err"}">${l.ok ? "OK" : "Failed"}</td>
          ${triage}
        </tr>`;
          })
          .join("\n")}
      </tbody>
    </table>
    </div>
  </section>`
  }

  <footer class="report-footer">Generated by QA-Agent · Site health crawl</footer>
  </div>
  ${HEALTH_TABLE_FILTERS_SCRIPT}
  ${HEALTH_ISSUE_TRIAGE_SCRIPT}
  ${HEALTH_NAV_SCRIPT}
</body>
</html>`;
}

/** Combined HTML: all sites, all URLs, with Site column where relevant. */
export function buildMasterHealthHtml(
  reports: SiteHealthReport[],
  meta: { runId: string; urlsFile: string; generatedAt: string },
): string {
  const brokenAll = reports.flatMap((r, siteIdx) =>
    r.crawl.brokenLinks.map((b) => ({ ...b, siteHostname: r.hostname, siteIndex: siteIdx })),
  );
  brokenAll.sort((a, b) => {
    if (a.siteIndex !== b.siteIndex) return a.siteIndex - b.siteIndex;
    return (b.durationMs ?? 0) - (a.durationMs ?? 0);
  });

  const brokenRows =
    brokenAll.length === 0
      ? `<tr data-filter-skip="1"><td colspan="7"><div class="empty-state">No broken internal links across all sites.</div></td></tr>`
      : brokenAll
          .map((row) => {
            const { siteIndex: _si, ...b } = row;
            const ms = b.durationMs ?? 0;
            const ft = `${b.siteHostname} ${b.foundOn} ${b.target} ${b.error ?? ""}`.toLowerCase();
            const ikey = issueKeyHash([
              "broken",
              b.siteHostname,
              b.foundOn,
              b.target,
              String(b.status ?? ""),
              b.error ?? "",
            ]);
            return `<tr data-issue-key="${esc(ikey)}" data-filter-text="${esc(ft)}" data-filter-ms="${String(ms)}" data-filter-result="${brokenHttpKind(b.status)}">
  <td>${esc(b.siteHostname)}</td>
  <td>${esc(b.foundOn)}</td>
  <td><a href="${esc(b.target)}">${esc(b.target)}</a></td>
  <td>${b.status ?? "—"}</td>
  <td class="num">${fmtMs(b.durationMs)}</td>
  <td class="cell-err">${esc(b.error ?? "")}</td>
  ${triageSelectCell(ikey)}
</tr>`;
          })
          .join("\n");

  const masterBrokenFilters =
    brokenAll.length === 0 ? "" : buildTableFiltersHtml("master-table-broken", FILTER_STATUS_BROKEN, "HTTP");

  const pagesAll = reports.flatMap((r, siteIdx) =>
    r.crawl.pages.map((p) => ({ ...p, siteHostname: r.hostname, siteIndex: siteIdx })),
  );
  pagesAll.sort((a, b) => {
    if (a.siteIndex !== b.siteIndex) return a.siteIndex - b.siteIndex;
    return b.durationMs - a.durationMs;
  });

  const pageRows = pagesAll
    .map((row) => {
      const { siteIndex: _siteIdx, ...p } = row;
      const ft = `${p.siteHostname} ${p.url} ${p.contentType ?? ""} ${p.documentTitle ?? ""}`.toLowerCase();
      const sizeCell = pageBodySizeCell(p);
      const redir =
        p.redirected && p.finalUrl && p.finalUrl !== p.url
          ? `<strong>${esc(redirectYesNo(p))}</strong><br/><span class="cell-mono">${esc(displayRedirectPath(p))}</span>`
          : esc(redirectYesNo(p));
      const pageKey = issueKeyHash(["page", p.siteHostname, p.url]);
      const triage = p.ok ? triageEmptyCell() : triageSelectCell(pageKey);
      const issueAttr = p.ok ? "" : ` data-issue-key="${esc(pageKey)}"`;
      return `<tr class="${p.ok ? "row-ok" : "row-err"}"${issueAttr} data-filter-text="${esc(ft)}" data-filter-ms="${String(p.durationMs)}" data-filter-result="${pageFetchFilterKey(p)}">
  <td>${esc(p.siteHostname)}</td>
  <td><a href="${esc(p.url)}">${esc(p.url)}</a></td>
  <td>${cellPageTitleHtml(p)}</td>
  <td class="num">${esc(cellMetaDescLen(p))}</td>
  <td class="num">${esc(cellH1Count(p))}</td>
  <td>${cellDocumentLang(p)}</td>
  <td>${cellCanonicalLink(p)}</td>
  <td>${p.status}</td>
  <td class="num">${p.durationMs}</td>
  <td><span title="${esc(p.contentType ?? "")}">${esc(shortMime(p.contentType))}</span></td>
  <td class="num">${sizeCell}</td>
  <td>${redir}</td>
  <td class="${p.ok ? "cell-ok" : "cell-err"}">${esc(pageFetchResult(p))}</td>
  ${triage}
</tr>`;
    })
    .join("\n");

  const linksAll = reports.flatMap((r, siteIdx) =>
    (r.crawl.linkChecks ?? []).map((l) => ({ ...l, siteHostname: r.hostname, siteIndex: siteIdx })),
  );
  linksAll.sort((a, b) => {
    if (a.siteIndex !== b.siteIndex) return a.siteIndex - b.siteIndex;
    return b.durationMs - a.durationMs;
  });

  const linkChecksSection =
    linksAll.length === 0
      ? ""
      : `<section class="report-section">
    <h2>Internal link checks (not crawled as HTML)</h2>
    <p class="section-desc">HEAD / tiny GET for URLs discovered but not fetched as full pages. Order matches your URL list, then slowest first within each site.</p>
    ${buildTableFiltersHtml("master-table-links", FILTER_STATUS_LINKS)}
    <div class="table-wrap">
    <table class="data-table" id="master-table-links">
      <thead><tr><th>Site</th><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Method</th><th>Result</th><th>Triage</th></tr></thead>
      <tbody>
        ${linksAll
          .map((row) => {
            const { siteIndex: _si, ...l } = row;
            const ft = `${l.siteHostname} ${l.target}`.toLowerCase();
            const linkKey = issueKeyHash(["link", l.siteHostname, l.target, l.method]);
            const triage = l.ok ? triageEmptyCell() : triageSelectCell(linkKey);
            const issueAttr = l.ok ? "" : ` data-issue-key="${esc(linkKey)}"`;
            return `<tr class="${l.ok ? "row-ok" : "row-err"}"${issueAttr} data-filter-text="${esc(ft)}" data-filter-ms="${String(l.durationMs)}" data-filter-result="${l.ok ? "ok" : "failed"}">
          <td>${esc(l.siteHostname)}</td>
          <td><a href="${esc(l.target)}">${esc(l.target)}</a></td>
          <td>${l.status}</td>
          <td class="num">${l.durationMs}</td>
          <td>${esc(l.method)}</td>
          <td class="${l.ok ? "cell-ok" : "cell-err"}">${l.ok ? "OK" : "Failed"}</td>
          ${triage}
        </tr>`;
          })
          .join("\n")}
      </tbody>
    </table>
    </div>
  </section>`;

  const summaryRows = reports
    .map((r, i) => {
      const failed = r.crawl.brokenLinks.length > 0 || r.crawl.pages.some((p) => !p.ok);
      const sa = computePageAggregateStats(r.crawl.pages);
      const folder = healthSiteOutputDirName(i, r.startUrl);
      const shot = r.crawl.startPageScreenshot;
      const thumb =
        shot?.fileName && !shot.error
          ? `<a href="./${esc(folder)}/${esc(shot.fileName)}"><img class="master-thumb" src="./${esc(folder)}/${esc(shot.fileName)}" alt="" loading="lazy"/></a>`
          : shot?.error
            ? `<span class="cell-err" title="${esc(shot.error)}">—</span>`
            : "—";
      return `<tr>
  <td>${esc(r.hostname)}</td>
  <td style="vertical-align:middle;width:1%">${thumb}</td>
  <td><a href="${esc(r.startUrl)}">${esc(r.startUrl)}</a></td>
  <td class="num">${r.crawl.pagesVisited}</td>
  <td class="num">${r.crawl.brokenLinks.length}</td>
  <td class="num">${sa.count ? sa.avgMs : "—"}</td>
  <td class="num">${sa.count ? `${sa.successPct}%` : "—"}</td>
  <td class="num">${sa.count ? formatBytes(sa.totalBytes) : "—"}</td>
  <td class="${failed ? "cell-err" : "cell-ok"}">${failed ? "Issues" : "OK"}</td>
  <td class="num" style="font-size:0.8rem">${esc(r.finishedAt)}</td>
</tr>`;
    })
    .join("\n");

  const totalPages = reports.reduce((n, r) => n + r.crawl.pagesVisited, 0);
  const totalBroken = reports.reduce((n, r) => n + r.crawl.brokenLinks.length, 0);

  const psiSections = reports
    .map((r) => {
      const psiPagesM = r.crawl.pages
        .filter((p) => hasPageSpeedInsights(p))
        .sort((a, b) => bestPerformanceScore(a) - bestPerformanceScore(b));
      if (psiPagesM.length === 0) return "";
      return `<h2 class="master-site-heading">${esc(r.hostname)} — PageSpeed Insights (Lighthouse lab)</h2>
    <p class="section-desc">Per-site lab data; same cards as single-site reports.</p>
    <div class="psi-grid">
      ${psiPagesM
        .map((p) => flattenInsights(p.insights).map((ins) => buildPsiCardHtml(ins)).join("\n"))
        .join("\n")}
    </div>`;
    })
    .filter(Boolean)
    .join("\n");

  const psiBlock =
    psiSections.length === 0
      ? ""
      : `<section class="report-section">
    <h2>PageSpeed Insights (all sites)</h2>
    <p class="section-desc">Grouped by hostname. Lab metrics only. Failed runs (e.g. NO_FCP) reflect Google&rsquo;s Lighthouse environment, not your crawl.</p>
    ${psiSections}
  </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${HEALTH_REPORT_HEAD}
  <title>Combined health — all sites</title>
  <style>${HEALTH_REPORT_CSS}</style>
</head>
<body data-run-id="${esc(meta.runId)}">
  ${buildHealthNavHtml({ variant: "master" })}
  <div class="report-shell">
  <header class="report-header">
    <p class="report-kicker">QA-Agent · Combined run</p>
    <h1>All sites — combined report</h1>
    <p class="lead">Single view of every site in this run. Open per-site folders for detail-only exports.</p>
    <div class="stat-grid">
      <div class="stat"><span class="stat-label">Sites</span><span class="stat-value">${reports.length}</span></div>
      <div class="stat"><span class="stat-label">Pages (sum)</span><span class="stat-value">${totalPages}</span></div>
      <div class="stat"><span class="stat-label">Broken rows (sum)</span><span class="stat-value">${totalBroken}</span></div>
      <div class="stat"><span class="stat-label">Run ID</span><span class="stat-value" style="font-size:0.95rem;word-break:break-all">${esc(meta.runId)}</span></div>
    </div>
    <p class="meta" style="margin:18px 0 0;"><strong>Generated:</strong> ${esc(meta.generatedAt)} · <strong>URLs file:</strong> ${esc(meta.urlsFile)}</p>
  </header>

  <section class="report-section">
    <h2>Summary by site</h2>
    <p class="section-desc">Per-site crawl totals and status.</p>
    <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>Site</th><th>Start page</th><th>Start URL</th><th class="num">Pages</th><th class="num">Broken</th><th class="num">Avg ms</th><th class="num">OK %</th><th class="num">HTML size</th><th>Status</th><th>Finished</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
    </div>
  </section>

  <section class="report-section">
    <h2>Broken internal links (all sites)</h2>
    <p class="section-desc">Rows follow your run&rsquo;s URL list order, then slowest first within each site. <strong>Site</strong> is the hostname for that crawl line. Triage choices are saved to <code>issue-overrides.json</code> when you use the dashboard (<code>http://</code>).</p>
    ${masterBrokenFilters}
    <div class="table-wrap">
    <table class="data-table" id="master-table-broken">
      <thead><tr><th>Site</th><th>Found on</th><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Detail</th><th>Triage</th></tr></thead>
      <tbody>${brokenRows}</tbody>
    </table>
    </div>
  </section>

  <section class="report-section">
    <h2>Pages fetched (all sites)</h2>
    <p class="section-desc">Rows follow your run&rsquo;s URL list order, then slowest first within each site. Search matches site, URL, content type, and title. Columns include HTML signals (title, meta description length, H1 count, lang, canonical), MIME type, size, and redirects.</p>
    ${buildTableFiltersHtml("master-table-pages", FILTER_STATUS_PAGES)}
    <div class="table-wrap">
    <table class="data-table" id="master-table-pages">
      <thead><tr><th>Site</th><th>URL</th><th>Title</th><th class="num">Meta</th><th class="num">H1</th><th>Lang</th><th>Canonical</th><th>HTTP</th><th class="num">Time (ms)</th><th>Type</th><th class="num">Size</th><th>Redirect</th><th>Result</th><th>Triage</th></tr></thead>
      <tbody>${pageRows}</tbody>
    </table>
    </div>
  </section>

  ${linkChecksSection}

  ${psiBlock}

  <footer class="report-footer">Generated by QA-Agent · Combined health report</footer>
  </div>
  ${HEALTH_TABLE_FILTERS_SCRIPT}
  ${HEALTH_ISSUE_TRIAGE_SCRIPT}
  ${HEALTH_NAV_SCRIPT}
</body>
</html>`;
}

export async function writeSiteHealthReports(options: {
  report: SiteHealthReport;
  outDir: string;
  /** Filename base without extension (e.g. report-www-example-com-2026-03-23T17-03-21-217Z). */
  fileBaseName: string;
  /** Health run folder id; enables triage persistence in the dashboard. */
  runId?: string;
}): Promise<{ htmlPath: string; jsonPath: string; canonicalHtmlPath: string; canonicalJsonPath: string }> {
  await mkdir(options.outDir, { recursive: true });
  const html = buildSiteHealthHtml(options.report, { runId: options.runId });
  const json = JSON.stringify(options.report, null, 2);
  const canonicalHtmlPath = path.join(options.outDir, `${options.fileBaseName}.html`);
  const canonicalJsonPath = path.join(options.outDir, `${options.fileBaseName}.json`);
  await writeFile(canonicalHtmlPath, html, "utf8");
  await writeFile(canonicalJsonPath, json, "utf8");
  const htmlPath = path.join(options.outDir, "report.html");
  const jsonPath = path.join(options.outDir, "report.json");
  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, json, "utf8");
  return { htmlPath, jsonPath, canonicalHtmlPath, canonicalJsonPath };
}

export async function writeMasterHealthReports(options: {
  reports: SiteHealthReport[];
  runDir: string;
  fileBaseName: string;
  meta: { runId: string; urlsFile: string; generatedAt: string };
}): Promise<{ htmlPath: string; jsonPath: string }> {
  const htmlPath = path.join(options.runDir, `${options.fileBaseName}.html`);
  const jsonPath = path.join(options.runDir, `${options.fileBaseName}.json`);
  const payload = {
    runId: options.meta.runId,
    urlsFile: options.meta.urlsFile,
    generatedAt: options.meta.generatedAt,
    sites: options.reports,
  };
  await writeFile(htmlPath, buildMasterHealthHtml(options.reports, options.meta), "utf8");
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  return { htmlPath, jsonPath };
}

export function buildHealthIndexHtml(options: {
  runId: string;
  generatedAt: string;
  urlsFile: string;
  masterHtmlPath: string;
  masterJsonPath: string;
  items: { hostname: string; htmlHref: string; jsonHref: string; label: string }[];
}): string {
  const rows = options.items
    .map(
      (i) => `<tr>
  <td><strong>${esc(i.hostname)}</strong></td>
  <td><a href="${esc(i.htmlHref)}">${esc(i.label)}</a></td>
  <td><a href="${esc(i.jsonHref)}">Download JSON</a></td>
</tr>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <meta name="color-scheme" content="light"/>
  <title>QA-Agent — health run index</title>
  <style>${INDEX_PAGE_CSS}</style>
</head>
<body>
<nav class="idx-nav" aria-label="Health run navigation">
  <span class="idx-nav__brand">QA-Agent</span>
  <span class="idx-nav__here" aria-current="page">Run index</span>
  <a class="idx-nav__link" href="./master.html">Combined report</a>
  <a class="idx-nav__link idx-nav__dash" href="/">Live dashboard</a>
</nav>
<div class="idx-wrap">
  <div class="idx-hero">
    <p class="idx-kicker">QA-Agent · Health run</p>
    <h1>Reports index</h1>
    <p class="idx-meta"><strong>Run ID</strong> ${esc(options.runId)}</p>
    <p class="idx-meta"><strong>Generated</strong> ${esc(options.generatedAt)}</p>
    <p class="idx-meta"><strong>URLs file</strong> ${esc(options.urlsFile)}</p>
    <div class="idx-combined">
      <strong>Combined (all sites):</strong>
      <a href="./master.html">Combined HTML</a>
      <span class="idx-meta"> (${esc(path.basename(options.masterHtmlPath))})</span>
      · <a href="${esc(options.masterJsonPath)}">JSON</a>
    </div>
  </div>
  <div class="idx-table-wrap">
    <table class="idx-table">
      <thead><tr><th>Site</th><th>HTML report</th><th>Data</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="idx-foot">Each per-site folder includes <code>report.html</code> (and a timestamped copy). <strong>Combined HTML</strong> uses <code>master.html</code> to jump to the versioned combined file. Use the top bar to open the live dashboard when you started the tool with <code>--serve</code>.</p>
</div>
${HEALTH_NAV_SCRIPT}
</body></html>`;
}
