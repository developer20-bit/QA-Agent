export interface BrokenLinkRecord {
  /** Page where the bad link was found */
  foundOn: string;
  /** Resolved target URL */
  target: string;
  status?: number;
  error?: string;
  /** Wall-clock time for the HTTP request that detected the issue (ms). */
  durationMs?: number;
}

/**
 * When both mobile and desktop PageSpeed runs are enabled, stored per page.
 * Legacy reports use a single `PageSpeedInsightRecord` on `insights` instead.
 */
export interface PageSpeedInsightsBundle {
  mobile?: PageSpeedInsightRecord;
  desktop?: PageSpeedInsightRecord;
}

/** Lighthouse lab scores/metrics from Google PageSpeed Insights API (optional per page). */
export interface PageSpeedInsightRecord {
  url: string;
  strategy: "mobile" | "desktop";
  /** Time for the PageSpeed API request (ms). */
  durationMs: number;
  scores?: {
    performance?: number;
    accessibility?: number;
    bestPractices?: number;
    seo?: number;
  };
  metrics?: {
    fcpMs?: number;
    lcpMs?: number;
    tbtMs?: number;
    cls?: number;
    speedIndexMs?: number;
    ttiMs?: number;
  };
  display?: {
    fcp?: string;
    lcp?: string;
    tbt?: string;
    cls?: string;
    speedIndex?: string;
    tti?: string;
  };
  /** Top Lighthouse “opportunities” (savings / issues), when present in API response. */
  opportunities?: { title: string; displayValue?: string }[];
  error?: string;
}

export interface PageFetchRecord {
  url: string;
  status: number;
  ok: boolean;
  /** Wall-clock time for this page fetch (headers + body read) (ms). */
  durationMs: number;
  error?: string;
  /** Primary MIME type from Content-Type (no charset), when the response was received. */
  contentType?: string;
  /** UTF-8 byte length of the HTML body when read (for sizing transfer). */
  bodyBytes?: number;
  /** True when the browser stack followed redirects to reach the final URL. */
  redirected?: boolean;
  /** Final URL after redirects (may differ from `url`). */
  finalUrl?: string;
  /** Parsed from HTML `<title>` when a body was read (truncated in crawl). */
  documentTitle?: string;
  /** Character length of meta description (name=description or og:description); set when HTML was parsed. */
  metaDescriptionLength?: number;
  /** Count of `<h1>` elements when HTML was parsed. */
  h1Count?: number;
  /** `<html lang>` when present. */
  documentLang?: string;
  /** Absolute URL from `<link rel="canonical">` when present and resolvable. */
  canonicalUrl?: string;
  /** Populated when health run uses --pagespeed and this URL was analyzed. */
  insights?: PageSpeedInsightRecord | PageSpeedInsightsBundle;
}

/** Playwright-based load check for mobile vs desktop viewports (optional per run). */
export interface ViewportCheckRecord {
  url: string;
  mobile: {
    width: number;
    height: number;
    loadMs: number;
    ok: boolean;
    httpStatus?: number;
    consoleErrorCount: number;
    error?: string;
  };
  desktop: {
    width: number;
    height: number;
    loadMs: number;
    ok: boolean;
    httpStatus?: number;
    consoleErrorCount: number;
    error?: string;
  };
}

/** HEAD/GET verification for same-origin URLs discovered but not fetched as HTML in BFS. */
export interface LinkCheckRecord {
  target: string;
  status: number;
  ok: boolean;
  durationMs: number;
  method: "HEAD" | "GET_RANGE";
}

export interface CrawlSiteResult {
  startUrl: string;
  siteId: string;
  hostname: string;
  pagesVisited: number;
  uniqueUrlsChecked: number;
  pages: PageFetchRecord[];
  brokenLinks: BrokenLinkRecord[];
  /** Discovered internal URLs checked with HEAD/GET (not crawled as full pages). Omitted in older report.json files. */
  linkChecks?: LinkCheckRecord[];
  /** Set when PageSpeed Insights was run for this crawl. */
  pageSpeedInsightsMeta?: {
    strategies: ("mobile" | "desktop")[];
    /** @deprecated Old reports used a single strategy string. */
    strategy?: "mobile" | "desktop";
    totalDurationMs: number;
    urlsAnalyzed: number;
  };
  /** Optional Chromium checks: same URLs, mobile vs desktop viewports. */
  viewportChecks?: ViewportCheckRecord[];
  viewportMeta?: {
    totalDurationMs: number;
    urlsChecked: number;
  };
  /** PNG of the start URL taken with headless Chromium (relative file name under the site output folder). */
  startPageScreenshot?: StartPageScreenshotMeta;
  durationMs: number;
}

/** Screenshot of the crawl start URL (main page), written next to report HTML. */
export interface StartPageScreenshotMeta {
  /** Relative to the site folder, e.g. `start-page.png`. Omitted if capture failed. */
  fileName?: string;
  durationMs: number;
  viewportWidth: number;
  viewportHeight: number;
  /** When true, captured full scrollable page (larger file). */
  fullPage: boolean;
  error?: string;
}

export interface SiteHealthReport {
  siteId: string;
  hostname: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  crawl: CrawlSiteResult;
}
