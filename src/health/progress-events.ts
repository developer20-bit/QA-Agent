/** Emitted during `orchestrateHealthCheck` for live dashboards (SSE). */
export type HealthProgressEvent =
  | {
      type: "run_start";
      runId: string;
      runDir: string;
      totalSites: number;
      /** ISO 8601 — wall-clock when this run began (server). */
      startedAt: string;
      sites: { siteId: string; hostname: string; startUrl: string }[];
    }
  | {
      type: "site_start";
      runId: string;
      siteId: string;
      hostname: string;
      startUrl: string;
      index: number;
      totalSites: number;
    }
  | {
      type: "site_complete";
      runId: string;
      siteId: string;
      hostname: string;
      startUrl: string;
      index: number;
      totalSites: number;
      failed: boolean;
      pagesVisited: number;
      brokenLinks: number;
      durationMs: number;
      /** Path under the run folder for `/reports/:runId/…` (e.g. `001-example.com/report.html`). */
      reportHtmlHref: string;
    }
  | {
      type: "site_error";
      runId: string;
      siteId: string;
      hostname: string;
      startUrl: string;
      index: number;
      totalSites: number;
      message: string;
    }
  | {
      type: "run_complete";
      runId: string;
      runDir: string;
      siteFailures: number;
      totalSites: number;
      /** ISO 8601 — when the run finished. */
      endedAt: string;
      /** Wall time from run start to finish (ms). */
      durationMs: number;
    }
  | { type: "run_error"; message: string };
