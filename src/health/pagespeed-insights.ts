import pLimit from "p-limit";
import { isCrawlPageEligibleForLighthouseLab } from "./lab-eligible-crawl-page.js";
import type { CrawlSiteResult, PageFetchRecord, PageSpeedInsightRecord, PageSpeedInsightsBundle } from "./types.js";

const PSI_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Pull `error.message` from Google API JSON error bodies (HTTP 4xx/5xx). */
function extractGoogleApiErrorMessage(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    const m = j.error?.message;
    return typeof m === "string" && m.length > 0 ? m : undefined;
  } catch {
    return undefined;
  }
}

/** Shorter, actionable copy for common Lighthouse/PSI failures. */
function formatPsiFailureMessage(raw: string): string {
  const t = raw.trim();
  if (/NOT_HTML/i.test(t)) {
    return "NOT_HTML — PageSpeed/Lighthouse only analyzes HTML documents, not images or other non-HTML URLs.";
  }
  if (/NO_FCP/i.test(t)) {
    return (
      "NO_FCP — Lighthouse did not detect a painted frame. Common with cookie/consent overlays, slow third parties, or flaky lab runs. " +
      "Try again later, use a single PageSpeed strategy (mobile or desktop), or run without --pagespeed for this URL."
    );
  }
  /** Google’s Chrome in their lab timed out or could not complete the navigation (not QA-Agent’s crawl). */
  if (
    /FAILED_DOCUMENT_REQUEST/i.test(t) ||
    /net::ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i.test(t) ||
    /Lighthouse was unable to reliably load the page/i.test(t)
  ) {
    return (
      "FAILED_DOCUMENT_REQUEST / timeout — Google’s Lighthouse could not load this URL in time from their datacenter (e.g. net::ERR_TIMED_OUT). " +
      "Heavy pages, slow TTFB, geo/WAF rules, or blocking Google’s IPs can cause this. If https://pagespeed.web.dev/ fails the same way, fix hosting/CDN/performance; " +
      "QA-Agent only calls the API. Optional: raise --pagespeed-timeout-ms for the HTTP wait to Google (does not extend Lighthouse’s own page load budget)."
    );
  }
  if (t.length > 320) return `${t.slice(0, 317)}…`;
  return t;
}

function score01To100(score: number | null | undefined): number | undefined {
  if (score == null || Number.isNaN(score)) return undefined;
  return Math.round(score * 100);
}

function auditMs(audits: Record<string, { numericValue?: number }> | undefined, id: string): number | undefined {
  const v = audits?.[id]?.numericValue;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function auditDisplay(audits: Record<string, { displayValue?: string }> | undefined, id: string): string | undefined {
  const d = audits?.[id]?.displayValue;
  return typeof d === "string" && d.length > 0 ? d : undefined;
}

/**
 * Lab data from Google PageSpeed Insights API v5 (Lighthouse).
 * Key env: `PAGESPEED_API_KEY` (preferred), or `GOOGLE_PAGESPEED_API_KEY`, or `GOOGLE_API_KEY`.
 * Not used for Gemini — use `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` for AI summaries.
 */
export async function fetchPageSpeedInsights(
  pageUrl: string,
  options: {
    apiKey: string;
    strategy: "mobile" | "desktop";
    timeoutMs: number;
  },
): Promise<PageSpeedInsightRecord> {
  const t0 = Date.now();
  const params = new URLSearchParams();
  params.set("url", pageUrl);
  params.set("key", options.apiKey);
  params.set("strategy", options.strategy);
  for (const c of ["performance", "accessibility", "best-practices", "seo"] as const) {
    params.append("category", c);
  }

  try {
    const res = await fetch(`${PSI_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const durationMs = Date.now() - t0;
    const text = await res.text();
    if (!res.ok) {
      const extracted = extractGoogleApiErrorMessage(text) ?? text;
      return {
        url: pageUrl,
        strategy: options.strategy,
        durationMs,
        error: `PageSpeed API HTTP ${res.status}: ${formatPsiFailureMessage(extracted)}`,
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { url: pageUrl, strategy: options.strategy, durationMs, error: "Invalid JSON from PageSpeed API" };
    }
    const err = (json as { error?: { message?: string } }).error;
    if (err?.message) {
      return {
        url: pageUrl,
        strategy: options.strategy,
        durationMs,
        error: formatPsiFailureMessage(err.message),
      };
    }
    const lh = (json as { lighthouseResult?: unknown }).lighthouseResult as
      | {
          categories?: Record<string, { score?: number | null }>;
          audits?: Record<string, { numericValue?: number; displayValue?: string }>;
        }
      | undefined;
    if (!lh) {
      return { url: pageUrl, strategy: options.strategy, durationMs, error: "No lighthouseResult in API response" };
    }

    const cat = lh.categories ?? {};
    const audits = lh.audits ?? {};

    const scores = {
      performance: score01To100(cat.performance?.score ?? undefined),
      accessibility: score01To100(cat.accessibility?.score ?? undefined),
      bestPractices: score01To100(cat["best-practices"]?.score ?? undefined),
      seo: score01To100(cat.seo?.score ?? undefined),
    };

    const metrics = {
      fcpMs: auditMs(audits, "first-contentful-paint"),
      lcpMs: auditMs(audits, "largest-contentful-paint"),
      tbtMs: auditMs(audits, "total-blocking-time"),
      cls: auditMs(audits, "cumulative-layout-shift"),
      speedIndexMs: auditMs(audits, "speed-index"),
      ttiMs: auditMs(audits, "interactive"),
    };

    const display = {
      fcp: auditDisplay(audits, "first-contentful-paint"),
      lcp: auditDisplay(audits, "largest-contentful-paint"),
      tbt: auditDisplay(audits, "total-blocking-time"),
      cls: auditDisplay(audits, "cumulative-layout-shift"),
      speedIndex: auditDisplay(audits, "speed-index"),
      tti: auditDisplay(audits, "interactive"),
    };

    const OPPORTUNITY_AUDIT_IDS = [
      "render-blocking-resources",
      "unused-javascript",
      "unused-css-rules",
      "uses-long-cache-ttl",
      "uses-text-compression",
      "uses-optimized-images",
      "modern-image-formats",
      "offscreen-images",
      "uses-rel-preconnect",
      "uses-rel-preload",
      "efficient-animated-content",
      "legacy-javascript",
      "third-party-summary",
      "total-byte-weight",
      "dom-size",
      "largest-contentful-paint-element",
    ];
    const opportunities: { title: string; displayValue?: string }[] = [];
    for (const id of OPPORTUNITY_AUDIT_IDS) {
      const a = audits[id] as
        | { score?: number | null; title?: string; displayValue?: string }
        | undefined;
      if (!a?.title) continue;
      if (a.score == null || a.score >= 0.9) continue;
      opportunities.push({ title: a.title, displayValue: a.displayValue });
    }

    return {
      url: pageUrl,
      strategy: options.strategy,
      durationMs,
      scores,
      metrics,
      display,
      opportunities: opportunities.length > 0 ? opportunities.slice(0, 8) : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      url: pageUrl,
      strategy: options.strategy,
      durationMs: Date.now() - t0,
      error: msg,
    };
  }
}

/**
 * PageSpeed Insights API key only (first non-empty wins).
 * Do not confuse with `GEMINI_API_KEY` — different Google product.
 */
export function resolvePageSpeedApiKey(): string | undefined {
  return (
    process.env.PAGESPEED_API_KEY?.trim() ||
    process.env.GOOGLE_PAGESPEED_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim()
  );
}

const PSI_MAX_URLS_CAP = 500;

/**
 * Runs PageSpeed Insights for up to `maxUrls` successfully crawled **HTML** pages (HTTP 200, ok).
 * Skips non-HTML responses (e.g. images, PDFs) so the API is not called for URLs Lighthouse cannot analyze.
 * Mutates each matching `PageFetchRecord` with `insights` (single record or mobile/desktop bundle).
 */
export async function attachPageSpeedInsights(
  crawl: CrawlSiteResult,
  options: {
    apiKey: string;
    strategies: ("mobile" | "desktop")[];
    maxUrls: number;
    concurrency: number;
    timeoutMs: number;
  },
): Promise<{ totalDurationMs: number; urlsAnalyzed: number }> {
  const t0 = Date.now();
  const cap = Math.min(options.maxUrls <= 0 ? PSI_MAX_URLS_CAP : options.maxUrls, PSI_MAX_URLS_CAP);
  const candidates = crawl.pages.filter(isCrawlPageEligibleForLighthouseLab).slice(0, cap);
  const strategies = options.strategies.length > 0 ? options.strategies : (["desktop"] as const);
  const limit = pLimit(Math.max(1, options.concurrency));

  await Promise.all(
    candidates.map((p) =>
      limit(async () => {
        if (strategies.length === 1) {
          const strategy = strategies[0]!;
          p.insights = await fetchPageSpeedInsights(p.url, {
            apiKey: options.apiKey,
            strategy,
            timeoutMs: options.timeoutMs,
          });
          return;
        }
        const bundle: PageSpeedInsightsBundle = {};
        await Promise.all(
          strategies.map(async (strategy) => {
            const rec = await fetchPageSpeedInsights(p.url, {
              apiKey: options.apiKey,
              strategy,
              timeoutMs: options.timeoutMs,
            });
            if (strategy === "mobile") bundle.mobile = rec;
            if (strategy === "desktop") bundle.desktop = rec;
          }),
        );
        p.insights = bundle;
      }),
    ),
  );

  const totalDurationMs = Date.now() - t0;
  crawl.pageSpeedInsightsMeta = {
    strategies: [...strategies],
    totalDurationMs,
    urlsAnalyzed: candidates.length,
  };
  return { totalDurationMs, urlsAnalyzed: candidates.length };
}
