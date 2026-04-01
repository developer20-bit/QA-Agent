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

export function pdfUrl(runId: string, fileRel: string): string {
  return `/api/pdf?runId=${encodeURIComponent(runId)}&file=${encodeURIComponent(fileRel)}`;
}
