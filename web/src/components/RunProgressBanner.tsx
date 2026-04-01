import { AnimatePresence, motion } from "framer-motion";
import { useElapsedMs } from "../hooks/useElapsedMs";
import { formatDeviceDateTime, formatDurationMs } from "../lib/time";

export type RunBannerState =
  | { kind: "idle" }
  | { kind: "posting" }
  | { kind: "queued" }
  | {
      kind: "live";
      runId: string;
      /** ISO — server time when run started (for elapsed clock). */
      startedAt: string;
      totalSites: number;
      sitesDone: number;
      currentIndex: number;
      currentHostname: string;
      lastDetail?: string;
    }
  | {
      kind: "success";
      runId: string;
      siteFailures: number;
      totalSites: number;
      endedAt?: string;
      durationMs?: number;
    }
  | { kind: "error"; message: string };

type Props = {
  state: RunBannerState;
};

function Spinner() {
  return (
    <motion.span
      aria-hidden
      style={{
        display: "inline-block",
        width: 22,
        height: 22,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.15)",
        borderTopColor: "var(--accent2)",
      }}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
    />
  );
}

function LiveElapsed({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedMs(startedAt, true);
  return (
    <div
      style={{
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "0.88rem",
        color: "var(--accent2)",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {formatDurationMs(elapsed)} elapsed
      <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: 10, fontSize: "0.78rem" }}>
        Started {formatDeviceDateTime(startedAt)}
      </span>
    </div>
  );
}

export default function RunProgressBanner({ state }: Props) {
  const active = state.kind !== "idle";

  return (
    <AnimatePresence mode="wait">
      {active ? (
        <motion.div
          key={state.kind === "live" ? state.runId + state.sitesDone : state.kind}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -12, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 28, overflow: "hidden" }}
        >
          <div
            style={{
              position: "relative",
              borderRadius: "var(--radius)",
              padding: "1px",
              background: "linear-gradient(120deg, var(--accent), var(--accent2), #a78bfa, var(--accent))",
              backgroundSize: "300% 100%",
              animation: "qa-shimmer 2.2s ease infinite",
            }}
          >
            <div
              style={{
                borderRadius: "calc(var(--radius) - 1px)",
                padding: "18px 22px",
                background: "rgba(6, 8, 14, 0.92)",
                backdropFilter: "blur(12px)",
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
              }}
            >
              <div style={{ paddingTop: 2 }}>
                {(state.kind === "posting" || state.kind === "queued" || state.kind === "live") && <Spinner />}
                {state.kind === "success" && (
                  <span style={{ fontSize: "1.25rem", lineHeight: 1 }} aria-hidden>
                    ✓
                  </span>
                )}
                {state.kind === "error" && (
                  <span style={{ fontSize: "1.25rem", lineHeight: 1, color: "var(--bad)" }} aria-hidden>
                    !
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "-0.02em", marginBottom: 6 }}>
                  {state.kind === "posting" && "Sending run to server…"}
                  {state.kind === "queued" && "Run accepted — starting workers…"}
                  {state.kind === "live" && (
                    <>
                      Run in progress
                      <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: "0.82rem", marginLeft: 10 }}>
                        {state.runId}
                      </span>
                    </>
                  )}
                  {state.kind === "success" && "Run finished"}
                  {state.kind === "error" && "Run failed"}
                </div>
                {state.kind === "live" && (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      <LiveElapsed startedAt={state.startedAt} />
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.88rem", lineHeight: 1.45, marginBottom: 10 }}>
                      Site {state.currentIndex} of {state.totalSites}: <strong style={{ color: "var(--text)" }}>{state.currentHostname}</strong>
                      {state.lastDetail ? (
                        <span style={{ display: "block", marginTop: 4, fontSize: "0.8rem" }}>{state.lastDetail}</span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <motion.div
                        initial={{ width: "0%" }}
                        animate={{
                          width: `${(() => {
                            if (state.totalSites <= 0) return 5;
                            const pct = (state.sitesDone / state.totalSites) * 100;
                            return Math.min(100, Math.max(6, pct));
                          })()}%`,
                        }}
                        transition={{ type: "spring", stiffness: 120, damping: 20 }}
                        style={{
                          height: "100%",
                          borderRadius: 999,
                          background: "linear-gradient(90deg, var(--accent), var(--accent2))",
                          boxShadow: "0 0 16px rgba(34, 211, 238, 0.35)",
                        }}
                      />
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                      Crawl and optional checks run in the background. You can open <strong>Run history</strong> when the run completes.
                    </p>
                  </>
                )}
                {state.kind === "posting" && (
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>Preparing your URL list…</p>
                )}
                {state.kind === "queued" && (
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
                    Connecting to the live event stream…
                  </p>
                )}
                {state.kind === "success" && (
                  <div style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
                    <p style={{ margin: "0 0 8px" }}>
                      {state.siteFailures > 0
                        ? `${state.siteFailures} of ${state.totalSites} site(s) reported issues.`
                        : `All ${state.totalSites} site(s) passed the checks we run.`}
                    </p>
                    {(state.durationMs != null || state.endedAt) && (
                      <p style={{ margin: 0, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.82rem" }}>
                        {state.durationMs != null ? (
                          <span style={{ color: "var(--ok)", fontWeight: 600 }}>{formatDurationMs(state.durationMs)}</span>
                        ) : null}
                        {state.endedAt ? (
                          <span style={{ marginLeft: 12 }}>
                            Ended {formatDeviceDateTime(state.endedAt)}
                          </span>
                        ) : null}
                      </p>
                    )}
                  </div>
                )}
                {state.kind === "error" && (
                  <p style={{ margin: 0, color: "#fda4af", fontSize: "0.88rem", wordBreak: "break-word" }}>{state.message}</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
