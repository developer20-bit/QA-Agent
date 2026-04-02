import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { captureStartPageScreenshotToDir } from "./capture-start-screenshot.js";
import { crawlSite } from "./crawl-site.js";
import { dedupeNormalizedUrls, healthSiteOutputDirName, loadUrlsFromTxt, siteIdFromUrl } from "./load-urls.js";
import {
  buildGeminiPayloadFromReports,
  generateGeminiQaSummary,
  resolveGeminiApiKey,
} from "./gemini-report.js";
import { attachPageSpeedInsights, resolvePageSpeedApiKey } from "./pagespeed-insights.js";
import { attachViewportChecks } from "./viewport-check.js";
import type { HealthProgressEvent } from "./progress-events.js";
import { masterReportBaseName, perSiteReportBaseName } from "./report-names.js";
import {
  buildHealthIndexHtml,
  buildMasterRedirectHtml,
  buildRunSummaryHtml,
  writeMasterHealthReports,
  writeSiteHealthReports,
} from "./report-site.js";
import type { SiteHealthReport } from "./types.js";

function runId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface HealthRunMeta {
  runId: string;
  /** When the run started (ISO 8601). Omitted in older run-meta.json files. */
  startedAt?: string;
  /** Wall-clock duration for the full run (ms). Omitted in older files. */
  durationMsTotal?: number;
  generatedAt: string;
  urlsSource: "file" | "inline";
  urlsFile?: string;
  totalSites: number;
  siteFailures: number;
  sites: {
    hostname: string;
    startUrl: string;
    failed: boolean;
    pagesVisited: number;
    brokenLinks: number;
    durationMs: number;
    reportHtmlHref: string;
  }[];
  /** Full combined HTML (MASTER-all-sites-*.html): screenshots, PageSpeed, all tables. */
  masterHtmlHref: string;
  /** Compact stats-only HTML for small run-level PDFs (`run-summary.html`). */
  runSummaryHtmlHref?: string;
  indexHtmlHref: string;
  /** Relative path to Markdown AI summary when generated. */
  geminiSummaryHref?: string;
  aiSummary?: {
    generatedAt?: string;
    skippedReason?: string;
  };
  features?: {
    pageSpeedStrategies?: ("mobile" | "desktop")[];
    viewportCheck?: boolean;
  };
}

export async function orchestrateHealthCheck(options: {
  /** Read URLs from this file (mutually exclusive with `urls`). */
  urlsFile?: string;
  /** Use these URLs directly (mutually exclusive with `urlsFile`). */
  urls?: string[];
  outRoot: string;
  maxPages: number;
  maxLinkChecks: number;
  concurrency: number;
  /** Parallel HTTP requests per site (crawl + link checks). */
  fetchConcurrency: number;
  requestTimeoutMs: number;
  /** Optional Lighthouse lab data via Google PageSpeed Insights API. */
  pageSpeed?: {
    enabled: boolean;
    strategies: ("mobile" | "desktop")[];
    maxUrls: number;
    concurrency: number;
    timeoutMs: number;
  };
  /** Optional Chromium mobile/desktop viewport smoke loads. */
  viewportCheck?: {
    enabled: boolean;
    maxUrls: number;
    timeoutMs: number;
    concurrency: number;
  };
  /** Optional Gemini Markdown executive summary (requires GEMINI_API_KEY). */
  gemini?: boolean;
  onProgress?: (event: HealthProgressEvent) => void;
}): Promise<{ runId: string; runDir: string; siteFailures: number }> {
  const rid = runId();
  const runDir = path.resolve(options.outRoot, rid);
  await mkdir(runDir, { recursive: true });

  let urls: string[];
  let urlsSource: "file" | "inline";
  let resolvedUrlsFile: string | undefined;
  if (options.urls && options.urls.length > 0) {
    urls = dedupeNormalizedUrls(options.urls);
    urlsSource = "inline";
  } else if (options.urlsFile) {
    urls = await loadUrlsFromTxt(options.urlsFile);
    urlsSource = "file";
    resolvedUrlsFile = path.resolve(options.urlsFile);
  } else {
    throw new Error("orchestrateHealthCheck: pass either urlsFile or a non-empty urls array");
  }
  if (urls.length === 0) {
    throw new Error(urlsSource === "file" ? `No URLs found in ${resolvedUrlsFile}` : "No valid URLs in request");
  }

  const emit = options.onProgress;
  const runStartedAt = new Date().toISOString();
  const runStartWallMs = Date.now();
  const sitesMeta = urls.map((u) => ({
    siteId: siteIdFromUrl(u),
    hostname: new URL(u).hostname,
    startUrl: u,
  }));
  emit?.({
    type: "run_start",
    runId: rid,
    runDir,
    totalSites: urls.length,
    startedAt: runStartedAt,
    sites: sitesMeta,
  });

  async function runOneSite(idx: number, startUrl: string): Promise<SiteHealthReport & { failed: boolean }> {
    const index = idx + 1;
    const siteId = siteIdFromUrl(startUrl);
    const hostname = new URL(startUrl).hostname;
    const outputDirName = healthSiteOutputDirName(idx, startUrl);

    emit?.({
      type: "site_start",
      runId: rid,
      siteId,
      hostname,
      startUrl,
      index,
      totalSites: urls.length,
    });

    const startedAt = new Date().toISOString();
    let crawl;
    try {
      crawl = await crawlSite({
        startUrl,
        maxPages: options.maxPages,
        maxLinkChecks: options.maxLinkChecks,
        requestTimeoutMs: options.requestTimeoutMs,
        fetchConcurrency: options.fetchConcurrency,
      });
      const siteDirEarly = path.join(runDir, outputDirName);
      crawl.startPageScreenshot = await captureStartPageScreenshotToDir({
        startUrl,
        siteOutDir: siteDirEarly,
        requestTimeoutMs: options.requestTimeoutMs,
      });
      const ps = options.pageSpeed;
      if (ps?.enabled) {
        const apiKey = resolvePageSpeedApiKey();
        if (!apiKey) {
          throw new Error(
            "PageSpeed Insights enabled but no API key found. Set PAGESPEED_API_KEY or GOOGLE_PAGESPEED_API_KEY (or GOOGLE_API_KEY) in the environment.",
          );
        }
        await attachPageSpeedInsights(crawl, {
          apiKey,
          strategies: ps.strategies.length > 0 ? ps.strategies : ["desktop"],
          maxUrls: ps.maxUrls,
          concurrency: ps.concurrency,
          timeoutMs: ps.timeoutMs,
        });
      }
      const vc = options.viewportCheck;
      if (vc?.enabled) {
        await attachViewportChecks(crawl, {
          maxUrls: vc.maxUrls,
          timeoutMs: vc.timeoutMs,
          concurrency: vc.concurrency,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit?.({
        type: "site_error",
        runId: rid,
        siteId,
        hostname,
        startUrl,
        index,
        totalSites: urls.length,
        message,
      });
      throw err;
    }

    const finishedAt = new Date().toISOString();

    const report: SiteHealthReport = {
      siteId: crawl.siteId,
      hostname: crawl.hostname,
      startUrl,
      startedAt,
      finishedAt,
      crawl,
    };

    const siteDir = path.join(runDir, outputDirName);
    const siteFileBase = perSiteReportBaseName(report.hostname, report.finishedAt);
    await writeSiteHealthReports({ report, outDir: siteDir, fileBaseName: siteFileBase, runId: rid });

    const failed = crawl.brokenLinks.length > 0 || crawl.pages.some((p) => !p.ok);
    const reportHtmlHref = `${outputDirName}/report.html`;

    emit?.({
      type: "site_complete",
      runId: rid,
      siteId: crawl.siteId,
      hostname: crawl.hostname,
      startUrl,
      index,
      totalSites: urls.length,
      failed,
      pagesVisited: crawl.pagesVisited,
      brokenLinks: crawl.brokenLinks.length,
      durationMs: crawl.durationMs,
      reportHtmlHref,
    });

    return { ...report, failed };
  }

  const results: (SiteHealthReport & { failed: boolean })[] = [];

  if (options.concurrency <= 1) {
    for (let idx = 0; idx < urls.length; idx++) {
      results.push(await runOneSite(idx, urls[idx]));
    }
  } else {
    const limit = pLimit(options.concurrency);
    const tasks = urls.map((startUrl, idx) => limit(() => runOneSite(idx, startUrl)));
    results.push(...(await Promise.all(tasks)));
  }
  /** Same order as the URL list (Promise.all preserves index order; this is a safety net). */
  results.sort((a, b) => urls.indexOf(a.startUrl) - urls.indexOf(b.startUrl));
  const siteFailures = results.filter((r) => r.failed).length;

  const runFinishedAt = new Date().toISOString();
  const runWallDurationMs = Math.max(0, Date.now() - runStartWallMs);
  const cleanReports = results.map((r) => {
    const { failed: _f, ...rep } = r;
    return rep;
  });
  const masterBase = masterReportBaseName(runFinishedAt);
  await writeMasterHealthReports({
    reports: cleanReports,
    runDir,
    fileBaseName: masterBase,
    meta: {
      runId: rid,
      urlsFile: urlsSource === "file" && resolvedUrlsFile ? resolvedUrlsFile : "(inline)",
      generatedAt: runFinishedAt,
    },
  });

  await writeFile(
    path.join(runDir, "master.html"),
    buildMasterRedirectHtml(`${masterBase}.html`),
    "utf8",
  );

  await writeFile(
    path.join(runDir, "run-summary.html"),
    buildRunSummaryHtml(cleanReports, {
      runId: rid,
      urlsFile: urlsSource === "file" && resolvedUrlsFile ? resolvedUrlsFile : "(inline)",
      generatedAt: runFinishedAt,
      startedAt: runStartedAt,
    }),
    "utf8",
  );

  const indexItems = results.map((r, i) => {
    const folder = healthSiteOutputDirName(i, r.startUrl);
    const base = perSiteReportBaseName(r.hostname, r.finishedAt);
    return {
      hostname: r.hostname,
      htmlHref: `./${folder}/${base}.html`,
      jsonHref: `./${folder}/${base}.json`,
      label: `${base}.html`,
    };
  });
  const urlsLabel =
    urlsSource === "file" && resolvedUrlsFile ? resolvedUrlsFile : "URLs from UI / inline";

  await writeFile(
    path.join(runDir, "index.html"),
    buildHealthIndexHtml({
      runId: rid,
      generatedAt: runFinishedAt,
      urlsFile: urlsLabel,
      masterHtmlPath: `./${masterBase}.html`,
      masterJsonPath: `./${masterBase}.json`,
      items: indexItems,
    }),
    "utf8",
  );

  let geminiSummaryHref: string | undefined;
  let aiSummary: HealthRunMeta["aiSummary"] | undefined;

  if (options.gemini) {
    if (!resolveGeminiApiKey()) {
      aiSummary = { skippedReason: "GEMINI_API_KEY not set" };
    } else {
      try {
        const cleanReports = results.map((r) => {
          const { failed: _f, ...rep } = r;
          return rep;
        });
        const payload = buildGeminiPayloadFromReports(cleanReports, rid, runFinishedAt);
        const md = await generateGeminiQaSummary(payload);
        await writeFile(path.join(runDir, "gemini-summary.md"), md, "utf8");
        geminiSummaryHref = "./gemini-summary.md";
        aiSummary = { generatedAt: new Date().toISOString() };
      } catch (e) {
        aiSummary = {
          skippedReason: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  const runMeta: HealthRunMeta = {
    runId: rid,
    startedAt: runStartedAt,
    durationMsTotal: runWallDurationMs,
    generatedAt: runFinishedAt,
    urlsSource,
    urlsFile: resolvedUrlsFile,
    totalSites: urls.length,
    siteFailures,
    sites: results.map((r, i) => ({
      hostname: r.hostname,
      startUrl: r.startUrl,
      failed: r.failed,
      pagesVisited: r.crawl.pagesVisited,
      brokenLinks: r.crawl.brokenLinks.length,
      durationMs: r.crawl.durationMs,
      reportHtmlHref: `${healthSiteOutputDirName(i, r.startUrl)}/report.html`,
    })),
    masterHtmlHref: `./${masterBase}.html`,
    runSummaryHtmlHref: "./run-summary.html",
    indexHtmlHref: "./index.html",
    geminiSummaryHref,
    aiSummary,
    features: {
      pageSpeedStrategies: options.pageSpeed?.enabled ? options.pageSpeed.strategies : undefined,
      viewportCheck: options.viewportCheck?.enabled === true,
    },
  };
  await writeFile(path.join(runDir, "run-meta.json"), JSON.stringify(runMeta, null, 2), "utf8");

  const summaryTxt = [
    `QA-Agent health run ${rid}`,
    `URLs: ${urlsLabel}`,
    `Sites: ${urls.length} · Failed (issues found): ${siteFailures}`,
    "",
    ...results.map(
      (r) =>
        `${r.hostname}: pages=${r.crawl.pagesVisited} brokenLinks=${r.crawl.brokenLinks.length} ${r.failed ? "FAIL" : "OK"}`,
    ),
  ].join("\n");
  await writeFile(path.join(runDir, "summary.txt"), summaryTxt, "utf8");

  emit?.({
    type: "run_complete",
    runId: rid,
    runDir,
    siteFailures,
    totalSites: urls.length,
    endedAt: runFinishedAt,
    durationMs: runWallDurationMs,
  });

  return { runId: rid, runDir, siteFailures };
}
