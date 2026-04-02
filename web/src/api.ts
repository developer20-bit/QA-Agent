export type HealthRunMeta = {
  runId: string;
  /** ISO start time (newer runs). */
  startedAt?: string;
  /** Wall-clock run duration in ms (newer runs). */
  durationMsTotal?: number;
  generatedAt: string;
  urlsSource: string;
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
  masterHtmlHref: string;
  /** Compact stats HTML for small run-level PDFs; omitted on older runs. */
  runSummaryHtmlHref?: string;
  indexHtmlHref: string;
  geminiSummaryHref?: string;
  aiSummary?: { generatedAt?: string; skippedReason?: string };
  features?: {
    pageSpeedStrategies?: string[];
    viewportCheck?: boolean;
  };
};

export type HistoryDay = { date: string; runs: HealthRunMeta[] };

export async function fetchHistory(): Promise<{ days: HistoryDay[] }> {
  const res = await fetch("/api/history");
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ days: HistoryDay[] }>;
}

/** Single run metadata from disk (`run-meta.json` or legacy). Prefer this for the workspace route. */
export async function fetchRunMeta(runId: string): Promise<HealthRunMeta | null> {
  const res = await fetch(`/api/run-meta?runId=${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json() as Promise<HealthRunMeta>;
}

export async function startRun(body: {
  urlsText: string;
  pageSpeedBoth?: boolean;
  viewportCheck?: boolean;
  gemini?: boolean;
}): Promise<void> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new Error("A run is already in progress.");
  if (!res.ok) throw new Error(await res.text());
}

export function streamUrl(): string {
  return `${window.location.origin}/api/stream`;
}

export async function fetchGeminiSummary(runId: string): Promise<string | null> {
  const res = await fetch(`/api/gemini-summary?runId=${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

export async function parseUrlsFile(file: File): Promise<string[]> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/parse-urls-file", { method: "POST", body: fd });
  const text = await res.text();
  let data: { urls?: string[]; error?: string };
  try {
    data = JSON.parse(text) as { urls?: string[]; error?: string };
  } catch {
    throw new Error(text || "Upload failed");
  }
  if (!res.ok) throw new Error(data.error ?? text);
  return data.urls ?? [];
}

export function reportIndexUrl(runId: string): string {
  return `/reports/${encodeURIComponent(runId)}/index.html`;
}

export function pdfUrl(runId: string, fileRel: string, opts?: { download?: boolean }): string {
  const q = new URLSearchParams();
  q.set("runId", runId);
  q.set("file", fileRel);
  if (opts?.download) q.set("download", "1");
  return `/api/pdf?${q.toString()}`;
}

/** Strip `./` and normalize slashes for paths stored in run-meta (e.g. `./001-host/report.html`). */
export function normalizeReportHtmlRel(rel: string): string {
  return rel.replace(/^\.\//, "").replace(/\\/g, "/");
}

/** Full combined all-sites HTML (MASTER-*.html or legacy `master.html` redirect). */
export function combinedReportHtmlUrl(run: HealthRunMeta): string {
  const rel = run.masterHtmlHref?.trim() ? normalizeReportHtmlRel(run.masterHtmlHref) : "master.html";
  const segments = rel.split("/").map(encodeURIComponent).join("/");
  return `/reports/${encodeURIComponent(run.runId)}/${segments}`;
}

/** Compact `run-summary.html` URL when present (stats-only page). */
export function runSummaryReportHtmlUrl(run: HealthRunMeta): string {
  const rel = run.runSummaryHtmlHref?.trim() ? normalizeReportHtmlRel(run.runSummaryHtmlHref) : "run-summary.html";
  const segments = rel.split("/").map(encodeURIComponent).join("/");
  return `/reports/${encodeURIComponent(run.runId)}/${segments}`;
}

/** Per-site `report.html` URL (HTML). */
export function siteReportHtmlUrl(runId: string, reportHtmlHref: string): string {
  const rel = normalizeReportHtmlRel(reportHtmlHref);
  const segments = rel.split("/").map(encodeURIComponent).join("/");
  return `/reports/${encodeURIComponent(runId)}/${segments}`;
}

/** Run-level PDF: same HTML as the combined preview (`masterHtmlHref`), so the file matches what you see in the iframe. */
export function combinedPdfUrl(run: HealthRunMeta, opts?: { download?: boolean }): string {
  const rel = run.masterHtmlHref?.trim()
    ? normalizeReportHtmlRel(run.masterHtmlHref)
    : run.runSummaryHtmlHref?.trim()
      ? normalizeReportHtmlRel(run.runSummaryHtmlHref)
      : "master.html";
  return pdfUrl(run.runId, rel, opts);
}

/** Per-site PDF: same `report.html` as **Open HTML** / the static report page (not run-summary). */
export function sitePdfUrl(runId: string, reportHtmlHref: string, opts?: { download?: boolean }): string {
  return pdfUrl(runId, normalizeReportHtmlRel(reportHtmlHref), opts);
}

export type SiteStatusValue = "open" | "ok" | "working" | "resolved";

export type SiteStatusOverridesPayload = {
  runId: string;
  savedAt?: string;
  sites: Record<string, { status: SiteStatusValue; editedAt?: string }>;
};

export async function fetchSiteStatusOverrides(runId: string): Promise<SiteStatusOverridesPayload | null> {
  const res = await fetch(`/reports/${encodeURIComponent(runId)}/site-status-overrides.json`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SiteStatusOverridesPayload>;
}

/** Persists to `artifacts/health/<runId>/site-status-overrides.json` (used when regenerating PDFs). */
export async function saveSiteStatusOverrides(
  runId: string,
  sites: Record<string, SiteStatusValue>,
): Promise<{ sites: Record<string, { status: SiteStatusValue; editedAt: string }>; savedAt: string }> {
  const sitesNested = Object.fromEntries(
    Object.entries(sites).map(([hostname, status]) => [hostname, { status }]),
  );
  const res = await fetch("/api/site-status-overrides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, sites: sitesNested }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ sites: Record<string, { status: SiteStatusValue; editedAt: string }>; savedAt: string }>;
}
