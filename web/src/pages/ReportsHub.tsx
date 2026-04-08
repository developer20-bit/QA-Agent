import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchHistory, type HealthRunMeta } from "../api";
import { formatDeviceDateTime, formatDurationMs } from "../lib/time";

export default function ReportsHub() {
  const [latest, setLatest] = useState<HealthRunMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await fetchHistory();
      const flat = h.days.flatMap((d) => d.runs);
      flat.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
      setLatest(flat.slice(0, 8));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="qa-page-title">Reports</h1>
        <p className="qa-page-desc">
          Open a run’s <strong style={{ color: "var(--text)" }}>workspace</strong> to review HTML reports, adjust site status, then{" "}
          <strong style={{ color: "var(--text)" }}>download the final combined PDF</strong>. PDF export is only available from the workspace.
        </p>
      </motion.div>

      <div
        style={{
          marginTop: 28,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        <Link to="/upload" className="qa-panel" style={{ padding: 16, textDecoration: "none", color: "var(--text)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.9375rem" }}>URL lists</div>
          <div style={{ fontSize: "0.8125rem", color: "var(--muted)", lineHeight: 1.45 }}>Upload .txt or .pdf, then send to the dashboard.</div>
        </Link>
        <Link to="/history" className="qa-panel" style={{ padding: 16, textDecoration: "none", color: "var(--text)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.9375rem" }}>Full history</div>
          <div style={{ fontSize: "0.8125rem", color: "var(--muted)", lineHeight: 1.45 }}>Browse every run and open workspaces.</div>
        </Link>
      </div>

      <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "32px 0 14px", color: "var(--muted)" }}>Recent reports</h2>
      {err ? <div className="qa-alert qa-alert--error" style={{ marginTop: 8 }}>{err}</div> : null}
      {loading ? (
        <div className="qa-empty">Loading recent reports…</div>
      ) : latest.length === 0 ? (
        <div className="qa-empty">No runs yet. Start a crawl from the Dashboard.</div>
      ) : (
        <motion.ul
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}
        >
          {latest.map((run, i) => (
            <motion.li
              key={run.runId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="qa-panel"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 16,
                padding: "14px 18px",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", wordBreak: "break-all" }}>{run.runId}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 6, fontFamily: "ui-monospace, Menlo, monospace" }}>
                  {run.startedAt ? (
                    <>
                      {formatDeviceDateTime(run.startedAt)} → {formatDeviceDateTime(run.generatedAt)}
                      {run.durationMsTotal != null ? (
                        <span style={{ color: "var(--ok)", marginLeft: 8 }}>· {formatDurationMs(run.durationMsTotal)}</span>
                      ) : null}
                    </>
                  ) : (
                    <>Ended {formatDeviceDateTime(run.generatedAt)}</>
                  )}
                </div>
              </div>
              <Link to={`/run/${encodeURIComponent(run.runId)}`} className="qa-btn-primary" style={{ flexShrink: 0 }}>
                Open workspace
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
