import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { StartPageScreenshotMeta } from "./types.js";

export const START_PAGE_SCREENSHOT_FILE = "start-page.png";

/**
 * Renders the crawl start URL in headless Chromium and saves `start-page.png` under `siteOutDir`.
 *
 * - `QA_AGENT_SCREENSHOT_FULL_PAGE=1` — full scroll height (larger PNG).
 * - `QA_AGENT_SCREENSHOT_WIDTH` / `QA_AGENT_SCREENSHOT_HEIGHT` — viewport (default 1440×900).
 */
export async function captureStartPageScreenshotToDir(options: {
  startUrl: string;
  siteOutDir: string;
  requestTimeoutMs: number;
}): Promise<StartPageScreenshotMeta> {
  const fullPage =
    process.env.QA_AGENT_SCREENSHOT_FULL_PAGE === "1" ||
    process.env.QA_AGENT_SCREENSHOT_FULL_PAGE === "true";
  const vw = Number.parseInt(process.env.QA_AGENT_SCREENSHOT_WIDTH ?? "1440", 10);
  const vh = Number.parseInt(process.env.QA_AGENT_SCREENSHOT_HEIGHT ?? "900", 10);
  const viewportWidth = Number.isFinite(vw) && vw >= 320 ? vw : 1440;
  const viewportHeight = Number.isFinite(vh) && vh >= 240 ? vh : 900;

  await mkdir(options.siteOutDir, { recursive: true });
  const outAbs = path.join(options.siteOutDir, START_PAGE_SCREENSHOT_FILE);
  const t0 = Date.now();

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: viewportWidth, height: viewportHeight },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.goto(options.startUrl, {
        waitUntil: "domcontentloaded",
        timeout: options.requestTimeoutMs,
      });
      await page.screenshot({
        path: outAbs,
        fullPage,
        type: "png",
      });
      await context.close();
    } finally {
      await browser.close();
    }
    const durationMs = Date.now() - t0;
    return {
      fileName: START_PAGE_SCREENSHOT_FILE,
      durationMs,
      viewportWidth,
      viewportHeight,
      fullPage,
    };
  } catch (e) {
    try {
      await unlink(outAbs);
    } catch {
      /* no partial file */
    }
    const msg = e instanceof Error ? e.message : String(e);
    return {
      durationMs: Date.now() - t0,
      viewportWidth,
      viewportHeight,
      fullPage,
      error: msg,
    };
  }
}
