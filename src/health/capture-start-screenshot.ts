import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { StartPageScreenshotBundle, StartPageScreenshotVariant } from "./types.js";

export const START_PAGE_SCREENSHOT_PC = "start-page-pc.png";
export const START_PAGE_SCREENSHOT_TABLET = "start-page-tablet.png";
export const START_PAGE_SCREENSHOT_PHONE = "start-page-phone.png";

/** @deprecated Use {@link START_PAGE_SCREENSHOT_PC}. */
export const START_PAGE_SCREENSHOT_FILE = START_PAGE_SCREENSHOT_PC;

/**
 * Renders the crawl start URL in headless Chromium and saves three PNGs under `siteOutDir`:
 * PC, tablet, and phone viewports.
 *
 * - `QA_AGENT_SCREENSHOT_FULL_PAGE=1` — full scroll height for the **PC** capture only (larger PNG).
 * - `QA_AGENT_SCREENSHOT_WIDTH` / `QA_AGENT_SCREENSHOT_HEIGHT` — **PC** viewport (default 1440×900).
 */
export async function captureStartPageScreenshotToDir(options: {
  startUrl: string;
  siteOutDir: string;
  requestTimeoutMs: number;
}): Promise<StartPageScreenshotBundle> {
  const pcFullPage =
    process.env.QA_AGENT_SCREENSHOT_FULL_PAGE === "1" ||
    process.env.QA_AGENT_SCREENSHOT_FULL_PAGE === "true";
  const vw = Number.parseInt(process.env.QA_AGENT_SCREENSHOT_WIDTH ?? "1440", 10);
  const vh = Number.parseInt(process.env.QA_AGENT_SCREENSHOT_HEIGHT ?? "900", 10);
  const pcW = Number.isFinite(vw) && vw >= 320 ? vw : 1440;
  const pcH = Number.isFinite(vh) && vh >= 240 ? vh : 900;

  const specs: {
    label: StartPageScreenshotVariant["label"];
    fileName: string;
    width: number;
    height: number;
    fullPage: boolean;
  }[] = [
    { label: "PC", fileName: START_PAGE_SCREENSHOT_PC, width: pcW, height: pcH, fullPage: pcFullPage },
    { label: "Tablet", fileName: START_PAGE_SCREENSHOT_TABLET, width: 834, height: 1112, fullPage: false },
    { label: "Phone", fileName: START_PAGE_SCREENSHOT_PHONE, width: 390, height: 844, fullPage: false },
  ];

  await mkdir(options.siteOutDir, { recursive: true });
  const t0 = Date.now();
  const variants: StartPageScreenshotVariant[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    for (const spec of specs) {
      const outAbs = path.join(options.siteOutDir, spec.fileName);
      const tVar = Date.now();
      try {
        const context = await browser.newContext({
          viewport: { width: spec.width, height: spec.height },
          deviceScaleFactor: 1,
        });
        try {
          const page = await context.newPage();
          await page.goto(options.startUrl, {
            waitUntil: "domcontentloaded",
            timeout: options.requestTimeoutMs,
          });
          await page.screenshot({
            path: outAbs,
            fullPage: spec.fullPage,
            type: "png",
          });
        } finally {
          await context.close();
        }
        variants.push({
          label: spec.label,
          fileName: spec.fileName,
          viewportWidth: spec.width,
          viewportHeight: spec.height,
          fullPage: spec.fullPage,
          durationMs: Date.now() - tVar,
        });
      } catch (e) {
        try {
          await unlink(outAbs);
        } catch {
          /* no partial file */
        }
        const msg = e instanceof Error ? e.message : String(e);
        variants.push({
          label: spec.label,
          viewportWidth: spec.width,
          viewportHeight: spec.height,
          fullPage: spec.fullPage,
          durationMs: Date.now() - tVar,
          error: msg,
        });
      }
    }
  } finally {
    await browser.close();
  }

  return {
    totalDurationMs: Date.now() - t0,
    variants,
  };
}
