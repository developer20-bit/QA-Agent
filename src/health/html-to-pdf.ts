import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { applySiteStatusForPdf, loadSiteStatusOverrides } from "./site-status-pdf.js";

/**
 * Legacy `master.html` was a redirect to the timestamped combined HTML. PDF generation must load the
 * real target or the PDF only contains “Opening combined health report…”. New runs use `run-summary.html` directly.
 */
async function resolveCombinedHtmlForPdf(absHtmlPath: string): Promise<string> {
  const base = path.basename(absHtmlPath);
  if (base.toLowerCase() !== "master.html") return absHtmlPath;
  let raw: string;
  try {
    raw = await readFile(absHtmlPath, "utf8");
  } catch {
    return absHtmlPath;
  }
  const m = raw.match(/content\s*=\s*["']0;\s*url=([^"']+)["']/i);
  const target = m?.[1]?.trim().replace(/^\.\//, "");
  if (!target) return absHtmlPath;
  const dir = path.dirname(absHtmlPath);
  const resolved = path.resolve(dir, target);
  try {
    const st = await stat(resolved);
    if (st.isFile()) return resolved;
  } catch {
    /* keep redirect stub */
  }
  return absHtmlPath;
}

/** Fresh browser per attempt. Avoid `--disable-gpu` by default (can destabilize some macOS/ARM setups). */
function chromiumLaunchOptions(): Parameters<typeof chromium.launch>[0] {
  const args = [
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-extensions",
    "--mute-audio",
    "--no-first-run",
    ...(process.env.QA_AGENT_PDF_DISABLE_GPU === "1" ? (["--disable-gpu"] as const) : []),
    ...(process.env.QA_AGENT_PDF_NO_SANDBOX === "1"
      ? (["--no-sandbox", "--disable-setuid-sandbox"] as const)
      : []),
  ];
  return { headless: true, args: [...args] };
}

async function loadPageForPdf(browser: Browser, loadPath: string, runRoot: string | undefined): Promise<Page> {
  const page = await browser.newPage();
  try {
    /* Wider layout so wide tables are laid out before A4 shrink; pairs with @media print in HEALTH_REPORT_CSS. */
    await page.setViewportSize({ width: 1520, height: 1080 });
    page.setDefaultTimeout(600_000);
    await page.goto(pathToFileURL(loadPath).href, {
      waitUntil: "load",
      timeout: 600_000,
    });
    if (runRoot) {
      const ov = await loadSiteStatusOverrides(runRoot);
      await applySiteStatusForPdf(page, ov, loadPath);
    }
    await page.evaluate(`() => {
      document.querySelectorAll("details.report-section__details").forEach((el) => {
        el.open = true;
      });
      document.querySelectorAll(".table-wrap").forEach((el) => {
        el.style.overflow = "visible";
        el.style.maxWidth = "none";
      });
    }`);
    /* Apply @media print rules from health report CSS (screen mode hides them and causes clipped tables). */
    await page.emulateMedia({ media: "print" });
    await page.waitForLoadState("load").catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    return page;
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

/** Each row is one `page.pdf()` after a **new** browser + navigation. Retrying pdf on the same page often yields “browser has been closed”. */
const PDF_ROUNDS: { printBackground: boolean; scale: number }[] = [
  { printBackground: true, scale: 1 },
  { printBackground: true, scale: 0.92 },
  { printBackground: false, scale: 0.92 },
  { printBackground: false, scale: 0.85 },
  { printBackground: false, scale: 0.72 },
  { printBackground: false, scale: 0.6 },
];

/** @deprecated PDF uses a short-lived browser per attempt; nothing to close. */
export async function closeHealthPdfBrowser(): Promise<void> {
  /* no-op */
}

export type RenderHtmlPdfOptions = {
  /** Run artifacts folder — loads `site-status-overrides.json` and applies before PDF. */
  runRoot?: string;
};

/**
 * Render a local HTML file to PDF (uses Chromium; requires `npx playwright install chromium` once).
 * When `runRoot` is set, manual site status overrides are applied to the DOM first.
 */
export async function renderHtmlFileToPdf(absHtmlPath: string, options?: RenderHtmlPdfOptions): Promise<Buffer> {
  const loadPath = await resolveCombinedHtmlForPdf(absHtmlPath);
  const runRoot = options?.runRoot ? path.resolve(options.runRoot) : undefined;

  const basePdf = {
    format: "A4" as const,
    margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
    preferCSSPageSize: false,
    tagged: false,
  };

  let lastErr: unknown;
  for (const round of PDF_ROUNDS) {
    const browser = await chromium.launch(chromiumLaunchOptions());
    try {
      const page = await loadPageForPdf(browser, loadPath, runRoot);
      try {
        const buf = await page.pdf({ ...basePdf, ...round });
        return buf instanceof Buffer ? buf : Buffer.from(buf);
      } finally {
        await page.close().catch(() => {});
      }
    } catch (e) {
      lastErr = e;
    } finally {
      await browser.close().catch(() => {});
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
