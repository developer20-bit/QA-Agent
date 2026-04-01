import { GoogleGenerativeAI } from "@google/generative-ai";
import { flattenInsights } from "./insight-utils.js";
import type { SiteHealthReport } from "./types.js";

/** Gemini / Google AI Studio key — not the PageSpeed Insights API key. */
export function resolveGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim();
}

/**
 * Produces a concise executive QA summary from structured crawl JSON (no raw HTML).
 */
export type GeminiQaPayload = {
  runId: string;
  generatedAt: string;
  sites: {
    hostname: string;
    startUrl: string;
    pagesVisited: number;
    brokenLinks: number;
    failedPageFetches: number;
    avgPageMs?: number;
    pageSpeedSample?: { url: string; perfMobile?: number; perfDesktop?: number }[];
    viewportIssues?: { url: string; mobileOk: boolean; desktopOk: boolean }[];
  }[];
};

export function buildGeminiPayloadFromReports(
  reports: SiteHealthReport[],
  runId: string,
  generatedAt: string,
): GeminiQaPayload {
  return {
    runId,
    generatedAt,
    sites: reports.map((r) => {
      const pages = r.crawl.pages;
      const okPages = pages.filter((p) => p.ok);
      const avg =
        okPages.length > 0
          ? Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length)
          : undefined;
      const failedPageFetches = pages.filter((p) => !p.ok).length;
      const pageSpeedSample = pages.slice(0, 10).map((p) => {
        const fi = flattenInsights(p.insights);
        return {
          url: p.url,
          perfMobile: fi.find((x) => x.strategy === "mobile")?.scores?.performance,
          perfDesktop: fi.find((x) => x.strategy === "desktop")?.scores?.performance,
        };
      });
      const viewportIssues = r.crawl.viewportChecks?.slice(0, 10).map((v) => ({
        url: v.url,
        mobileOk: v.mobile.ok,
        desktopOk: v.desktop.ok,
      }));
      return {
        hostname: r.hostname,
        startUrl: r.startUrl,
        pagesVisited: r.crawl.pagesVisited,
        brokenLinks: r.crawl.brokenLinks.length,
        failedPageFetches,
        avgPageMs: avg,
        pageSpeedSample: pageSpeedSample.some((s) => s.perfMobile != null || s.perfDesktop != null)
          ? pageSpeedSample
          : undefined,
        viewportIssues: viewportIssues?.length ? viewportIssues : undefined,
      };
    }),
  };
}

export async function generateGeminiQaSummary(payload: GeminiQaPayload): Promise<string> {
  const key = resolveGeminiApiKey();
  if (!key) {
    throw new Error("Set GEMINI_API_KEY (or GOOGLE_AI_API_KEY) for AI summaries.");
  }

  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `You are a senior QA lead. Given a structured JSON health crawl report for one or more websites, write a clear, actionable summary for stakeholders.

Rules:
- Use Markdown with ## and ### headings.
- Start with a 3–6 bullet executive summary.
- For each site, list: overall health, top risks, and 3–5 concrete next steps.
- Reference performance (Lighthouse lab) and viewport load checks only where data is present; omit sections if arrays are empty.
- If broken links are non-zero, call them out with severity.
- End with a short "Watch list" of URLs or patterns worth manual follow-up.
- Keep the total under ~900 words.

JSON input:
${JSON.stringify(payload, null, 2)}`;

  const res = await model.generateContent(prompt);
  const text = res.response.text();
  if (!text?.trim()) {
    throw new Error("Gemini returned an empty summary.");
  }
  return text.trim();
}
