import { chromium } from "playwright";
import pLimit from "p-limit";
import { isCrawlPageEligibleForLighthouseLab } from "./lab-eligible-crawl-page.js";
import type { CrawlSiteResult, ViewportCheckRecord } from "./types.js";

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1920, height: 1080 };

type OneVp = {
  width: number;
  height: number;
  loadMs: number;
  ok: boolean;
  httpStatus?: number;
  consoleErrorCount: number;
  error?: string;
};

async function loadOneViewport(
  url: string,
  width: number,
  height: number,
  timeoutMs: number,
): Promise<OneVp> {
  let consoleErrorCount = 0;
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrorCount += 1;
    });
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const loadMs = Date.now() - t0;
    const ok = res?.ok() ?? false;
    const httpStatus = res?.status();
    await context.close();
    return { width, height, loadMs, ok, httpStatus, consoleErrorCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      width,
      height,
      loadMs: Date.now() - t0,
      ok: false,
      consoleErrorCount,
      error: msg,
    };
  } finally {
    await browser.close();
  }
}

/**
 * For each URL (capped), load in mobile then desktop viewports with separate Chromium sessions.
 * (Isolated sessions avoid shared storage skew between viewport sizes.)
 */
export async function attachViewportChecks(
  crawl: CrawlSiteResult,
  options: {
    maxUrls: number;
    timeoutMs: number;
    concurrency: number;
  },
): Promise<{ totalDurationMs: number; urlsChecked: number }> {
  const t0 = Date.now();
  const cap = Math.max(1, options.maxUrls);
  const candidates = crawl.pages.filter(isCrawlPageEligibleForLighthouseLab).slice(0, cap);
  const limit = pLimit(Math.max(1, options.concurrency));

  const rows: ViewportCheckRecord[] = await Promise.all(
    candidates.map((p) =>
      limit(async (): Promise<ViewportCheckRecord> => {
        const mob = await loadOneViewport(p.url, MOBILE.width, MOBILE.height, options.timeoutMs);
        const desk = await loadOneViewport(p.url, DESKTOP.width, DESKTOP.height, options.timeoutMs);
        return {
          url: p.url,
          mobile: {
            width: mob.width,
            height: mob.height,
            loadMs: mob.loadMs,
            ok: mob.ok,
            httpStatus: mob.httpStatus,
            consoleErrorCount: mob.consoleErrorCount,
            error: mob.error,
          },
          desktop: {
            width: desk.width,
            height: desk.height,
            loadMs: desk.loadMs,
            ok: desk.ok,
            httpStatus: desk.httpStatus,
            consoleErrorCount: desk.consoleErrorCount,
            error: desk.error,
          },
        };
      }),
    ),
  );

  crawl.viewportChecks = rows;
  crawl.viewportMeta = {
    totalDurationMs: Date.now() - t0,
    urlsChecked: rows.length,
  };
  return { totalDurationMs: crawl.viewportMeta.totalDurationMs, urlsChecked: rows.length };
}
