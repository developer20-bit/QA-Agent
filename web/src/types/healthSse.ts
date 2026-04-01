/** SSE payloads from `/api/stream` (health dashboard). */
export type HealthSsePayload =
  | {
      type: "run_start";
      runId: string;
      totalSites: number;
      startedAt?: string;
      sites: { hostname: string; startUrl: string }[];
    }
  | {
      type: "site_start";
      runId: string;
      index: number;
      totalSites: number;
      hostname: string;
    }
  | {
      type: "site_complete";
      runId: string;
      index: number;
      totalSites: number;
      hostname: string;
      pagesVisited: number;
      brokenLinks: number;
    }
  | { type: "site_error"; runId: string; hostname: string; message: string }
  | {
      type: "run_complete";
      runId: string;
      siteFailures: number;
      totalSites: number;
      endedAt?: string;
      durationMs?: number;
    }
  | { type: "run_error"; message: string };
