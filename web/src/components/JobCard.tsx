import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Link } from "react-router-dom";
import { pdfUrl, reportIndexUrl, type HealthRunMeta } from "../api";
import { formatDeviceDateTime, formatDurationMs } from "../lib/time";

export default function JobCard({ run, defaultOpen }: { run: HealthRunMeta; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const fail = run.siteFailures > 0;

  const wall =
    run.durationMsTotal != null
      ? formatDurationMs(run.durationMsTotal)
      : run.startedAt
        ? formatDurationMs(new Date(run.generatedAt).getTime() - new Date(run.startedAt).getTime())
        : null;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        background: "linear-gradient(145deg, var(--glass) 0%, rgba(255,255,255,0.02) 100%)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
        overflow: "hidden",
        marginBottom: 14,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "18px 20px",
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "0.95rem", letterSpacing: "-0.02em" }}>{run.runId}</div>
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: "0.78rem",
              fontFamily: "ui-monospace, Menlo, monospace",
              color: "var(--muted)",
              lineHeight: 1.6,
            }}
          >
            <div>
              <span style={{ color: "var(--muted)", fontWeight: 600, marginRight: 8 }}>START</span>
              {run.startedAt ? formatDeviceDateTime(run.startedAt) : "—"}
            </div>
            <div>
              <span style={{ color: "var(--muted)", fontWeight: 600, marginRight: 8 }}>END</span>
              {formatDeviceDateTime(run.generatedAt)}
            </div>
            <div>
              <span style={{ color: "var(--muted)", fontWeight: 600, marginRight: 8 }}>WALL</span>
              <span style={{ color: "var(--ok)", fontWeight: 600 }}>{wall ?? "—"}</span>
              {run.totalSites ? (
                <span style={{ marginLeft: 10 }}>
                  · {run.totalSites} site{run.totalSites === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 10 }}>
            {run.aiSummary?.skippedReason ? (
              <span style={{ color: "var(--bad)" }}>AI: {run.aiSummary.skippedReason}</span>
            ) : run.geminiSummaryHref ? (
              <span style={{ color: "var(--ok)" }}>AI summary</span>
            ) : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "4px 10px",
                borderRadius: 999,
                background: fail ? "rgba(251,113,133,0.15)" : "rgba(52,211,153,0.15)",
                color: fail ? "#fda4af" : "#6ee7b7",
              }}
            >
              {fail ? "Issues" : "Clean"}
            </span>
            {run.features?.viewportCheck ? (
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--glass2)",
                  color: "var(--muted)",
                }}
              >
                Viewports
              </span>
            ) : null}
            {run.features?.pageSpeedStrategies?.length ? (
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--glass2)",
                  color: "var(--muted)",
                }}
              >
                PSI {run.features.pageSpeedStrategies.join("+")}
              </span>
            ) : null}
          </div>
        </div>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          style={{ color: "var(--muted)", fontSize: "1.1rem", flexShrink: 0 }}
        >
          ▾
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28 }}
            style={{ overflow: "hidden", borderTop: "1px solid var(--border)" }}
          >
            <div style={{ padding: "16px 20px 20px", fontSize: "0.88rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
                <a href={reportIndexUrl(run.runId)} target="_blank" rel="noreferrer">
                  Run index
                </a>
                <Link to={`/run/${encodeURIComponent(run.runId)}`}>Details &amp; AI</Link>
                <a href={pdfUrl(run.runId, "index.html")} target="_blank" rel="noreferrer">
                  PDF (index)
                </a>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Site</th>
                    <th style={{ padding: "6px 8px" }}>Pages</th>
                    <th style={{ padding: "6px 8px" }}>Broken</th>
                    <th style={{ padding: "6px 8px" }}>Crawl ms</th>
                    <th style={{ padding: "6px 8px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {run.sites.map((s) => (
                    <tr key={s.hostname + s.startUrl} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={{ padding: "8px", wordBreak: "break-all" }}>{s.hostname}</td>
                      <td style={{ padding: "8px" }}>{s.pagesVisited}</td>
                      <td style={{ padding: "8px" }}>{s.brokenLinks}</td>
                      <td style={{ padding: "8px", fontFamily: "ui-monospace, Menlo, monospace" }}>{s.durationMs}</td>
                      <td style={{ padding: "8px", color: s.failed ? "var(--bad)" : "var(--ok)" }}>
                        {s.failed ? "Issues" : "OK"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}
