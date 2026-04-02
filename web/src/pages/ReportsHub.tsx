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
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, letterSpacing: "-0.04em", margin: "0 0 10px" }}>Reports</h1>
        <p style={{ color: "var(--muted)", maxWidth: 720, lineHeight: 1.55, margin: 0, fontSize: "0.98rem" }}>
          Open a run’s <strong style={{ color: "var(--text)" }}>workspace</strong> to review HTML reports, adjust site status, then{" "}
          <strong style={{ color: "var(--text)" }}>download the final combined PDF</strong> when you’re done. PDF export is not available from this list — only from the workspace.
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
        <Link
          to="/upload"
          style={{
            padding: 20,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--glass)",
            textDecoration: "none",
            color: "var(--text)",
            transition: "transform 0.2s ease",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Import URLs</div>
          <div style={{ fontSize: "0.88rem", color: "var(--muted)" }}>Upload .txt or .pdf, then send to the dashboard.</div>
        </Link>
        <Link
          to="/history"
          style={{
            padding: 20,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--glass)",
            textDecoration: "none",
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Full history</div>
          <div style={{ fontSize: "0.88rem", color: "var(--muted)" }}>Browse every run with timesheet-style cards.</div>
        </Link>
      </div>

      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "36px 0 16px" }}>Recent reports</h2>
      {err ? <p style={{ color: "var(--bad)" }}>{err}</p> : null}
      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      ) : latest.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No runs yet.</p>
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
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 16,
                padding: "16px 20px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "linear-gradient(145deg, var(--glass), rgba(255,255,255,0.02))",
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
              <Link
                to={`/run/${encodeURIComponent(run.runId)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "10px 20px",
                  borderRadius: 999,
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  textDecoration: "none",
                  color: "#061018",
                  background: "linear-gradient(120deg, var(--accent), var(--accent2))",
                  boxShadow: "0 8px 24px rgba(34, 211, 238, 0.2)",
                  flexShrink: 0,
                }}
              >
                Open workspace
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
