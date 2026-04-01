#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { Command } from "commander";

/** Read integer from env, or use fallback (after dotenv). */
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

/** Parallel fetches per site — main speed lever for large uncapped crawls. */
const DEFAULT_FETCH_CONCURRENCY = String(envInt("QA_AGENT_FETCH_CONCURRENCY", 16, 1, 256));
/** How many sites to crawl at once (health command). */
const DEFAULT_SITE_CONCURRENCY = String(envInt("QA_AGENT_SITE_CONCURRENCY", 4, 1, 64));
const DEFAULT_PAGESPEED_CONCURRENCY = String(envInt("QA_AGENT_PAGESPEED_CONCURRENCY", 3, 1, 64));
/** Max wait (ms) for each PageSpeed API HTTP response; env QA_AGENT_PAGESPEED_TIMEOUT_MS */
const DEFAULT_PAGESPEED_TIMEOUT_MS = String(envInt("QA_AGENT_PAGESPEED_TIMEOUT_MS", 120_000, 10_000, 600_000));
const DEFAULT_VIEWPORT_CONCURRENCY = String(envInt("QA_AGENT_VIEWPORT_CONCURRENCY", 2, 1, 32));
import { loadSitesConfig } from "./config/load.js";
import { orchestrateRun } from "./orchestrate.js";
import { runHealthDashboard } from "./health/health-dashboard-server.js";
import { orchestrateHealthCheck } from "./health/orchestrate-health.js";
import { deliverReport } from "./notify/email.js";
import { buildTextSummary } from "./report/build-summary.js";

const program = new Command();

program
  .name("qa-agent")
  .description(
    "Site health: crawl + internal link checks (see `health`). Legacy: `run` for form tests.",
  )
  .version("0.2.1");

program
  .command("health")
  .description(
    "Crawl same-origin pages, verify internal links — write per-site HTML/JSON under --out/<runId>/. Use --serve alone for UI-only (paste URLs in the browser).",
  )
  .option(
    "--urls [file]",
    "Optional: text file with one https URL per line (# comments). Required for non-interactive runs without --serve",
  )
  .option("--out <dir>", "Output root folder (default: artifacts/health)", "artifacts/health")
  .option(
    "--concurrency <n>",
    `How many sites to crawl at once (default ${DEFAULT_SITE_CONCURRENCY}; env QA_AGENT_SITE_CONCURRENCY; use 1 for strictly sequential)`,
    DEFAULT_SITE_CONCURRENCY,
  )
  .option(
    "--max-pages <n>",
    "Max HTML pages to fetch per site (BFS crawl); default 0 = no limit (full same-origin crawl). Set a positive number to cap.",
    "0",
  )
  .option(
    "--max-link-checks <n>",
    "Max extra internal URLs to HEAD-check when not visited in BFS; default 0 = no limit. Set a positive number to cap.",
    "0",
  )
  .option(
    "--timeout-ms <n>",
    "Per-request timeout (ms) for crawl and link checks; slow CMS pages often need 45s+ under parallel load",
    "45000",
  )
  .option(
    "--fetch-concurrency <n>",
    `Parallel HTTP requests per site while crawling and checking links (default ${DEFAULT_FETCH_CONCURRENCY}; env QA_AGENT_FETCH_CONCURRENCY)`,
    DEFAULT_FETCH_CONCURRENCY,
  )
  .option(
    "--serve",
    "Start a live dashboard (HTTP + SSE) on localhost while the run executes; open /reports/… in the same origin",
    false,
  )
  .option("--port <n>", "Port for --serve (default 3847)", "3847")
  .option("--no-browser", "With --serve, do not open a browser tab", false)
  .option(
    "--pagespeed",
    "After crawl, run Google PageSpeed Insights (Lighthouse lab) on crawled pages; set PAGESPEED_API_KEY",
    false,
  )
  .option(
    "--pagespeed-strategy <mobile|desktop|both>",
    "PageSpeed API: one strategy or both (mobile + desktop lab)",
    "desktop",
  )
  .option(
    "--pagespeed-max-urls <n>",
    "Max URLs per site to analyze with PageSpeed (0 = up to 500; default 25)",
    "25",
  )
  .option(
    "--pagespeed-concurrency <n>",
    `Parallel PageSpeed API calls per site (per strategy; default ${DEFAULT_PAGESPEED_CONCURRENCY}; env QA_AGENT_PAGESPEED_CONCURRENCY)`,
    DEFAULT_PAGESPEED_CONCURRENCY,
  )
  .option(
    "--pagespeed-timeout-ms <n>",
    `Timeout per PageSpeed API HTTP request (ms; default ${DEFAULT_PAGESPEED_TIMEOUT_MS}; env QA_AGENT_PAGESPEED_TIMEOUT_MS)`,
    DEFAULT_PAGESPEED_TIMEOUT_MS,
  )
  .option(
    "--viewport-check",
    "After crawl, load each sampled URL in headless Chromium (mobile + desktop viewports)",
    false,
  )
  .option(
    "--viewport-max-urls <n>",
    "Max URLs per site for viewport checks (default 15)",
    "15",
  )
  .option("--viewport-timeout-ms <n>", "Navigation timeout per viewport load (ms)", "60000")
  .option(
    "--viewport-concurrency <n>",
    `Parallel URLs for viewport checks per site (default ${DEFAULT_VIEWPORT_CONCURRENCY}; env QA_AGENT_VIEWPORT_CONCURRENCY)`,
    DEFAULT_VIEWPORT_CONCURRENCY,
  )
  .option(
    "--gemini",
    "After the run, ask Gemini for an executive Markdown summary (set GEMINI_API_KEY)",
    false,
  )
  .action(
    async (opts: {
      urls?: string;
      out: string;
      concurrency: string;
      maxPages: string;
      maxLinkChecks: string;
      timeoutMs: string;
      fetchConcurrency: string;
      serve?: boolean;
      port: string;
      noBrowser?: boolean;
      pagespeed?: boolean;
      pagespeedStrategy: string;
      pagespeedMaxUrls: string;
      pagespeedConcurrency: string;
      pagespeedTimeoutMs: string;
      viewportCheck?: boolean;
      viewportMaxUrls: string;
      viewportTimeoutMs: string;
      viewportConcurrency: string;
      gemini?: boolean;
    }) => {
      const concurrency = Number.parseInt(opts.concurrency, 10);
      const maxPages = Number.parseInt(opts.maxPages, 10);
      const maxLinkChecks = Number.parseInt(opts.maxLinkChecks, 10);
      const requestTimeoutMs = Number.parseInt(opts.timeoutMs, 10);
      const fetchConcurrency = Number.parseInt(opts.fetchConcurrency, 10);
      const servePort = Number.parseInt(opts.port, 10);
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        throw new Error(`Invalid concurrency: ${opts.concurrency}`);
      }
      if (!Number.isFinite(maxPages) || maxPages < 0) {
        throw new Error(`Invalid max-pages: ${opts.maxPages} (use 0 for unlimited)`);
      }
      if (!Number.isFinite(maxLinkChecks) || maxLinkChecks < 0) {
        throw new Error(`Invalid max-link-checks: ${opts.maxLinkChecks} (use 0 for unlimited)`);
      }
      if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1) {
        throw new Error(`Invalid timeout-ms: ${opts.timeoutMs}`);
      }
      if (!Number.isFinite(fetchConcurrency) || fetchConcurrency < 1) {
        throw new Error(`Invalid fetch-concurrency: ${opts.fetchConcurrency}`);
      }
      if (!Number.isFinite(servePort) || servePort < 1) {
        throw new Error(`Invalid port: ${opts.port}`);
      }

      if (!opts.serve && !opts.urls) {
        throw new Error(
          "Pass --urls <file> for a CLI-only run, or use --serve (optionally with --urls) to open the dashboard.",
        );
      }

      const pagespeedMaxUrls = Number.parseInt(opts.pagespeedMaxUrls, 10);
      const pagespeedConcurrency = Number.parseInt(opts.pagespeedConcurrency, 10);
      const pagespeedTimeoutMs = Number.parseInt(opts.pagespeedTimeoutMs, 10);
      const viewportMaxUrls = Number.parseInt(opts.viewportMaxUrls, 10);
      const viewportTimeoutMs = Number.parseInt(opts.viewportTimeoutMs, 10);
      const viewportConcurrency = Number.parseInt(opts.viewportConcurrency, 10);

      if (opts.pagespeed) {
        if (
          opts.pagespeedStrategy !== "mobile" &&
          opts.pagespeedStrategy !== "desktop" &&
          opts.pagespeedStrategy !== "both"
        ) {
          throw new Error(`Invalid pagespeed-strategy: ${opts.pagespeedStrategy} (use mobile, desktop, or both)`);
        }
        if (!Number.isFinite(pagespeedMaxUrls) || pagespeedMaxUrls < 0) {
          throw new Error(`Invalid pagespeed-max-urls: ${opts.pagespeedMaxUrls}`);
        }
        if (!Number.isFinite(pagespeedConcurrency) || pagespeedConcurrency < 1) {
          throw new Error(`Invalid pagespeed-concurrency: ${opts.pagespeedConcurrency}`);
        }
        if (!Number.isFinite(pagespeedTimeoutMs) || pagespeedTimeoutMs < 1) {
          throw new Error(`Invalid pagespeed-timeout-ms: ${opts.pagespeedTimeoutMs}`);
        }
      }

      if (opts.viewportCheck) {
        if (!Number.isFinite(viewportMaxUrls) || viewportMaxUrls < 1) {
          throw new Error(`Invalid viewport-max-urls: ${opts.viewportMaxUrls}`);
        }
        if (!Number.isFinite(viewportTimeoutMs) || viewportTimeoutMs < 1) {
          throw new Error(`Invalid viewport-timeout-ms: ${opts.viewportTimeoutMs}`);
        }
        if (!Number.isFinite(viewportConcurrency) || viewportConcurrency < 1) {
          throw new Error(`Invalid viewport-concurrency: ${opts.viewportConcurrency}`);
        }
      }

      const psStrategies: ("mobile" | "desktop")[] =
        opts.pagespeed && opts.pagespeedStrategy === "both"
          ? ["mobile", "desktop"]
          : opts.pagespeed && opts.pagespeedStrategy === "mobile"
            ? ["mobile"]
            : opts.pagespeed
              ? ["desktop"]
              : [];

      const orchestrateBase = {
        ...(opts.urls ? { urlsFile: path.resolve(opts.urls) } : {}),
        outRoot: path.resolve(opts.out),
        maxPages,
        maxLinkChecks,
        concurrency,
        fetchConcurrency,
        requestTimeoutMs,
        ...(opts.pagespeed
          ? {
              pageSpeed: {
                enabled: true,
                strategies: psStrategies,
                maxUrls: pagespeedMaxUrls,
                concurrency: pagespeedConcurrency,
                timeoutMs: pagespeedTimeoutMs,
              },
            }
          : {}),
        ...(opts.viewportCheck
          ? {
              viewportCheck: {
                enabled: true,
                maxUrls: viewportMaxUrls,
                timeoutMs: viewportTimeoutMs,
                concurrency: viewportConcurrency,
              },
            }
          : {}),
        ...(opts.gemini ? { gemini: true } : {}),
      };

      const { runId, runDir, siteFailures } = opts.serve
        ? await runHealthDashboard({
            port: servePort,
            openBrowser: opts.noBrowser !== true,
            orchestrate: orchestrateBase,
          })
        : await orchestrateHealthCheck(orchestrateBase);

      if (runId) {
        console.log(`\nHealth run ${runId} complete.`);
        console.log(`Index: ${runDir}/index.html (per-site + combined MASTER-all-sites-… reports)`);
        console.log(`Summary: ${runDir}/summary.txt`);
      } else if (opts.serve) {
        console.log(`\nDashboard running — paste URLs in the UI to start crawls and reports.`);
      }
      if (opts.serve) {
        console.log(
          `Live UI: http://127.0.0.1:${servePort}/ (React dashboard if web/dist built; reports: /reports/<runId>/… · PDF: /api/pdf)`,
        );
      }
      process.exitCode = siteFailures > 0 ? 1 : 0;
    },
  );

program
  .command("run")
  .description("Execute all enabled sites from a JSON config file")
  .requiredOption("-c, --config <path>", "Path to sites JSON config")
  .option("--concurrency <n>", "Max parallel browser jobs", "3")
  .option(
    "--artifacts <dir>",
    "Directory for run artifacts (screenshots, reports)",
    "artifacts",
  )
  .option("--headed", "Run browser with UI (not headless)", false)
  .option("--skip-email", "Skip SMTP delivery (still writes report files)")
  .action(async (opts: {
    config: string;
    concurrency: string;
    artifacts: string;
    headed: boolean;
    skipEmail?: boolean;
  }) => {
    const configPath = path.resolve(opts.config);
    const config = await loadSitesConfig(configPath);
    const concurrency = Number.parseInt(opts.concurrency, 10);
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new Error(`Invalid concurrency: ${opts.concurrency}`);
    }

    const summary = await orchestrateRun({
      config,
      configPath,
      concurrency,
      artifactsRoot: path.resolve(opts.artifacts),
      headless: !opts.headed,
    });

    console.log(buildTextSummary(summary));

    const { reportDir, emailSent } = await deliverReport({
      summary,
      config,
      artifactsRoot: path.resolve(opts.artifacts),
      sendEmail: !opts.skipEmail,
    });
    console.log(`\nReports written under: ${reportDir}`);
    if (!opts.skipEmail) {
      console.log(emailSent ? "Email sent." : "Email not sent (see SMTP env or QA_AGENT_NOTIFY_EMAILS).");
    }

    const failed = summary.results.filter((r) => r.status === "failed").length;
    process.exitCode = failed > 0 ? 1 : 0;
  });

program.parse();
