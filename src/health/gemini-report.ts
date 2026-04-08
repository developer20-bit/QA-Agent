import { GoogleGenerativeAI } from "@google/generative-ai";
import { flattenInsights } from "./insight-utils.js";
import type { PageFetchRecord, SiteHealthReport } from "./types.js";

/** Gemini / Google AI Studio key — not the PageSpeed Insights API key. Same key as in AI Studio. */
export function resolveGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim();
}

/**
 * Default when `GEMINI_MODEL` is unset. Prefer a current Flash model on the Generative Language API
 * (older IDs like gemini-1.5-flash may 404 for new keys).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

/** Tried after the primary model when the API returns overload / rate limit / unknown model. */
const BUILTIN_MODEL_FALLBACKS = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
] as const;

function parseCommaList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ordered model ids to try: `GEMINI_MODEL` (or default), then `GEMINI_MODEL_FALLBACKS`, then built-ins.
 * All Gemini calls in this package should use this list so CLI and dashboard behave the same.
 */
export function resolveGeminiModelCandidates(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const envFallbacks = parseCommaList(process.env.GEMINI_MODEL_FALLBACKS);
  const merged = [primary, ...envFallbacks, ...BUILTIN_MODEL_FALLBACKS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of merged) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

function httpStatusFromError(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const o = e as Record<string, unknown>;
  if (typeof o.status === "number") return o.status;
  if (o.cause && typeof o.cause === "object" && typeof (o.cause as { status?: unknown }).status === "number") {
    return (o.cause as { status: number }).status;
  }
  return undefined;
}

/** Overload, rate limits, or missing model — try the next candidate. */
function shouldTryNextGeminiModel(e: unknown): boolean {
  const status = httpStatusFromError(e);
  if (status === 503 || status === 429 || status === 404) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /503|429|404|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|not found|NOT_FOUND/i.test(msg);
}

function geminiRetryDelayMs(attemptIndex: number): number {
  const base = Number(process.env.GEMINI_RETRY_BASE_MS ?? "400");
  const cap = Number(process.env.GEMINI_RETRY_MAX_MS ?? "4000");
  const b = Number.isFinite(base) && base >= 0 ? base : 400;
  const c = Number.isFinite(cap) && cap >= b ? cap : 4000;
  return Math.min(c, Math.round(b * Math.pow(1.6, attemptIndex)));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateGeminiText(prompt: string): Promise<string> {
  const key = resolveGeminiApiKey();
  if (!key) {
    throw new Error("Set GEMINI_API_KEY (or GOOGLE_AI_API_KEY) for Gemini features.");
  }
  const models = resolveGeminiModelCandidates();
  let lastError: unknown;
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i]!;
    if (i > 0) await sleep(geminiRetryDelayMs(i - 1));
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: modelName });
      const res = await model.generateContent(prompt);
      const text = res.response.text();
      if (!text?.trim()) {
        lastError = new Error(`Gemini (${modelName}) returned an empty response.`);
        continue;
      }
      return text.trim();
    } catch (e) {
      lastError = e;
      if (!shouldTryNextGeminiModel(e)) throw e;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError ?? "Gemini request failed."));
}

export type BuildGeminiPayloadOptions = {
  /** Max pages to include PageSpeed sample rows for (default 10). */
  pageSpeedSampleLimit?: number;
  /** Prefer URLs that have Lighthouse scores, then fill from crawl order (default false). */
  pageSpeedPreferAnalyzed?: boolean;
};

function selectPagesForSpeedSample(
  pages: PageFetchRecord[],
  limit: number,
  preferAnalyzed: boolean,
): PageFetchRecord[] {
  if (limit <= 0) return [];
  if (!preferAnalyzed) return pages.slice(0, limit);
  const scored: PageFetchRecord[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const fi = flattenInsights(p.insights);
    if (!fi.some((x) => x.scores?.performance != null)) continue;
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    scored.push(p);
    if (scored.length >= limit) return scored;
  }
  for (const p of pages) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    scored.push(p);
    if (scored.length >= limit) break;
  }
  return scored;
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
  options?: BuildGeminiPayloadOptions,
): GeminiQaPayload {
  const speedLimit = options?.pageSpeedSampleLimit ?? 10;
  const speedPrefer = options?.pageSpeedPreferAnalyzed ?? false;
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
      const speedPages = selectPagesForSpeedSample(pages, speedLimit, speedPrefer);
      const pageSpeedSample = speedPages.map((p) => {
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
  const prompt = `You are a senior QA lead. Given structured JSON from a health crawl, write a VERY SHORT skim-friendly summary for busy stakeholders.

Format (strict):
- Use Markdown only.
- First heading: ## Run at a glance
- Then ### Nutshell — 5–8 bullets max. One line per bullet, ~8–18 words, no nested bullets, no paragraphs.
- Then ### By site — for each hostname in the JSON, exactly 3 bullets:
  - **hostname** — (1) one-line verdict, (2) top risk or "No critical risks in data", (3) one next action.
- No "Executive Summary" essay blocks, no numbered sections like a report, no duplicate points between sections.
- Omit Lighthouse/viewport wording entirely if that data is missing or samples are empty.
- If brokenLinks > 0 or failedPageFetches > 0, state the counts in Nutshell.
- Do not add a Watch list section.
- Hard cap: ~220 words total.

JSON:
${JSON.stringify(payload, null, 2)}`;

  return generateGeminiText(prompt);
}

/**
 * Answers a user question using only the structured run payload (no full HTML).
 * Keeps replies short for an in-app Q&A panel.
 */
export async function generateGeminiRunAnswer(payload: GeminiQaPayload, question: string): Promise<string> {
  const q = question.trim();
  if (!q) {
    throw new Error("Question is empty.");
  }

  const prompt = `You answer questions about ONE website health crawl run. Use ONLY the JSON below — do not invent URLs, scores, counts, or issues.

Rules:
- Very short: either 2–4 sentences OR up to 6 markdown bullet lines (- item), not both long.
- No preamble ("Based on the data…"). Lead with the answer.
- If the JSON does not contain enough information, reply exactly: Not in this run's report data.
- Use numbers from JSON when citing scores or counts.

Question:
${q}

Run data:
${JSON.stringify(payload, null, 2)}`;

  return generateGeminiText(prompt);
}
