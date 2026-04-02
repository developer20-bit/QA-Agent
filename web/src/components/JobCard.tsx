import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Link } from "react-router-dom";
import { sitePdfUrl, siteReportHtmlUrl, type HealthRunMeta } from "../api";
import { formatDeviceDateTime, formatDurationMs } from "../lib/time";

type Props = {
  run: HealthRunMeta;
  defaultOpen?: boolean;
  /** When false, the title is plain text (e.g. already on the run workspace page). Default true. */
  titleNavigatesToRun?: boolean;
};

export default function JobCard({ run, defaultOpen, titleNavigatesToRun = true }: Props) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const fail = run.siteFailures > 0;

  const wall =
    run.durationMsTotal != null
      ? formatDurationMs(run.durationMsTotal)
      : run.startedAt
        ? formatDurationMs(new Date(run.generatedAt).getTime() - new Date(run.startedAt).getTime())
        : null;

  const headInner = (
    <div style={{ minWidth: 0 }}>
      {titleNavigatesToRun ? (
        <div style={{ fontWeight: 600, fontSize: "0.95rem", letterSpacing: "-0.02em" }}>{run.runId}</div>
      ) : null}
      <div
        style={{
          marginTop: titleNavigatesToRun ? 10 : 0,
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
      {!titleNavigatesToRun ? (
        <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
          {run.urlsFile ? (
            <>
              <span style={{ fontWeight: 600 }}>{run.urlsSource}</span> · {run.urlsFile}
            </>
          ) : (
            <span>
              URLs · <span style={{ fontWeight: 600 }}>{run.urlsSource}</span>
            </span>
          )}
        </div>
      ) : null}
      {titleNavigatesToRun ? (
        <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 10 }}>
          {run.aiSummary?.skippedReason ? (
            <span style={{ color: "var(--bad)" }}>AI: {run.aiSummary.skippedReason}</span>
          ) : run.geminiSummaryHref ? (
            <span style={{ color: "var(--ok)" }}>AI summary</span>
          ) : null}
        </div>
      ) : null}
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
  );

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
      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
          gap: 0,
        }}
      >
        {titleNavigatesToRun ? (
          <Link
            to={`/run/${encodeURIComponent(run.runId)}`}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "left",
              textDecoration: "none",
              color: "inherit",
              display: "block",
              padding: "18px 8px 18px 20px",
            }}
          >
            {headInner}
          </Link>
        ) : (
          <div style={{ flex: 1, minWidth: 0, padding: "18px 20px" }}>{headInner}</div>
        )}
        {titleNavigatesToRun ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "Collapse run details" : "Expand run details"}
            style={{
              flexShrink: 0,
              width: 48,
              padding: "18px 12px",
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
            }}
          >
            <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ fontSize: "1.1rem" }}>
              ▾
            </motion.span>
          </button>
        ) : null}
      </div>
      {titleNavigatesToRun ? (
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
                <div style={{ marginBottom: 14 }}>
                  <Link
                    to={`/run/${encodeURIComponent(run.runId)}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "10px 18px",
                      borderRadius: 999,
                      fontWeight: 600,
                      fontSize: "0.88rem",
                      textDecoration: "none",
                      color: "#061018",
                      background: "linear-gradient(120deg, var(--accent), var(--accent2))",
                    }}
                  >
                    Open workspace
                  </Link>
                  <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.45 }}>
                    Review reports, set site status, then download the final PDF from the workspace — not here.
                  </p>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>Site</th>
                      <th style={{ padding: "6px 8px" }}>Pages</th>
                      <th style={{ padding: "6px 8px" }}>Broken</th>
                      <th style={{ padding: "6px 8px" }}>Crawl ms</th>
                      <th style={{ padding: "6px 8px" }}>Status</th>
                      <th style={{ padding: "6px 8px" }}>HTML</th>
                      <th style={{ padding: "6px 8px" }}>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.sites.map((s) => (
                      <tr key={s.hostname + s.startUrl} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <td style={{ padding: "8px", wordBreak: "break-all" }}>
                          <a
                            href={siteReportHtmlUrl(run.runId, s.reportHtmlHref)}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontWeight: 600, color: "var(--text)" }}
                          >
                            {s.hostname}
                          </a>
                        </td>
                        <td style={{ padding: "8px" }}>{s.pagesVisited}</td>
                        <td style={{ padding: "8px" }}>{s.brokenLinks}</td>
                        <td style={{ padding: "8px", fontFamily: "ui-monospace, Menlo, monospace" }}>{s.durationMs}</td>
                        <td style={{ padding: "8px", color: s.failed ? "var(--bad)" : "var(--ok)" }}>
                          {s.failed ? "Issues" : "OK"}
                        </td>
                        <td style={{ padding: "8px" }}>
                          <a href={siteReportHtmlUrl(run.runId, s.reportHtmlHref)} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <a href={sitePdfUrl(run.runId, s.reportHtmlHref, { download: true })} style={{ fontWeight: 600 }}>
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </motion.article>
  );
}
