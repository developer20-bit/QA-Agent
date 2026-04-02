import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  combinedPdfUrl,
  combinedReportHtmlUrl,
  fetchGeminiSummary,
  fetchRunMeta,
  normalizeReportHtmlRel,
  reportIndexUrl,
  runSummaryReportHtmlUrl,
  type HealthRunMeta,
} from "../api";
import JobCard from "../components/JobCard";
import SiteStatusEditor from "../components/SiteStatusEditor";

function decodeRunIdParam(raw: string | undefined): string {
  if (raw == null || raw === "") return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function RunDetail() {
  const rawParam = useParams().runId;
  const runId = decodeRunIdParam(rawParam);
  const [run, setRun] = useState<HealthRunMeta | null>(null);
  const [gemini, setGemini] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Bumps iframe URL after triage save so combined HTML preview stays fresh. */
  const [reportPreviewNonce, setReportPreviewNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setRun(null);
    setGemini(null);

    if (!runId.trim()) {
      setErr("Missing run id in the URL.");
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const meta = await fetchRunMeta(runId);
        if (cancelled) return;
        if (!meta) {
          setErr(
            "This run was not found under artifacts (no run-meta.json or legacy summary). The folder may have been removed, or the link is wrong.",
          );
          return;
        }
        setRun(meta);
        if (meta.geminiSummaryHref) {
          try {
            const g = await fetchGeminiSummary(runId);
            if (!cancelled) setGemini(g);
          } catch {
            if (!cancelled) setGemini(null);
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const title = useMemo(() => run?.runId ?? (runId || "Run"), [run, runId]);

  const combinedHtmlBase = run ? combinedReportHtmlUrl(run) : "";
  const combinedHtmlPreview = combinedHtmlBase
    ? `${combinedHtmlBase}${combinedHtmlBase.includes("?") ? "&" : "?"}_t=${reportPreviewNonce}`
    : "";

  const statsSummaryHtmlBase = run ? runSummaryReportHtmlUrl(run) : "";
  const combinedPdfDownload = run ? combinedPdfUrl(run, { download: true }) : "";

  return (
    <div>
      <Link to="/history" style={{ fontSize: "0.88rem" }}>
        ← Run history
      </Link>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          color: "var(--muted)",
          marginTop: 14,
          marginBottom: 6,
          fontSize: "0.82rem",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        Run workspace
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ fontSize: "1.35rem", fontWeight: 700, marginTop: 0, letterSpacing: "-0.03em", wordBreak: "break-all" }}
      >
        {title}
      </motion.h1>
      {loading ? <p style={{ color: "var(--muted)", marginTop: 16 }}>Loading run…</p> : null}
      {err ? (
        <p style={{ color: "var(--bad)", marginTop: 16, maxWidth: 560, lineHeight: 1.5 }}>
          {err}
        </p>
      ) : null}
      {err ? (
        <p style={{ marginTop: 12, fontSize: "0.9rem" }}>
          <Link to="/reports" style={{ color: "var(--accent2)" }}>
            Back to Reports
          </Link>
          {" · "}
          <Link to="/history" style={{ color: "var(--accent2)" }}>
            Run history
          </Link>
        </p>
      ) : null}
      {run ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 20 }}>
          <JobCard run={run} titleNavigatesToRun={false} />

          <SiteStatusEditor run={run} onSaved={() => setReportPreviewNonce((n) => n + 1)} />

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 }}
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "var(--glass)",
            }}
          >
            <h2 style={{ margin: "0 0 10px", fontSize: "1rem", fontWeight: 600 }}>Run index</h2>
            <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
              Table of contents with links into each site folder (static HTML index).
            </p>
            <a
              href={reportIndexUrl(run.runId)}
              target="_blank"
              rel="noreferrer"
              style={{ fontWeight: 600, color: "var(--accent2)" }}
            >
              Open run index (HTML)
            </a>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            style={{
              marginTop: 32,
              padding: 0,
              borderRadius: "var(--radius)",
              border: "2px solid rgba(34, 211, 238, 0.35)",
              background: "linear-gradient(160deg, rgba(34,211,238,0.1), var(--glass))",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid var(--border)",
                background: "rgba(0,0,0,0.3)",
              }}
            >
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--accent2)",
                }}
              >
                Final step · PDF export
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 14,
                }}
              >
                <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                  <h2 style={{ margin: "0 0 6px", fontSize: "1.15rem", fontWeight: 700 }}>Combined report</h2>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
                    Full all-sites view: start-page screenshots, PageSpeed scores, crawl tables, and triage — same as the legacy combined MASTER report. The preview below reflects saved triage when you export.{" "}
                    <strong style={{ color: "var(--text)" }}>Download PDF</strong> exports this same combined page (not the separate stats-only summary).
                  </p>
                  <p style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "var(--muted)", fontFamily: "ui-monospace, Menlo, monospace" }}>
                    Combined: {normalizeReportHtmlRel(run.masterHtmlHref || "master.html")}
                    {run.runSummaryHtmlHref ? (
                      <>
                        {" · "}
                        Stats: {normalizeReportHtmlRel(run.runSummaryHtmlHref)}
                      </>
                    ) : null}
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "stretch" }}>
                  <motion.a
                    href={combinedPdfDownload}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "12px 22px",
                      borderRadius: 999,
                      fontWeight: 700,
                      textDecoration: "none",
                      color: "#061018",
                      background: "linear-gradient(120deg, var(--accent), var(--accent2))",
                      boxShadow: "0 8px 28px rgba(34, 211, 238, 0.25)",
                      fontSize: "0.95rem",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Download PDF
                  </motion.a>
                  <a
                    href={combinedHtmlBase}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "1px solid var(--border)",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      textDecoration: "none",
                      color: "var(--text)",
                      textAlign: "center",
                    }}
                  >
                    Open combined HTML (new tab)
                  </a>
                  <a
                    href={statsSummaryHtmlBase}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "1px solid var(--border)",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      textDecoration: "none",
                      color: "var(--muted)",
                      textAlign: "center",
                    }}
                  >
                    Stats summary only (new tab)
                  </a>
                </div>
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.35)", minHeight: 480 }}>
              <iframe
                title="Combined report (HTML)"
                src={combinedHtmlPreview}
                style={{
                  width: "100%",
                  height: "min(78vh, 900px)",
                  border: "none",
                  display: "block",
                }}
              />
            </div>
          </motion.section>

          {run.aiSummary?.skippedReason ? (
            <p style={{ color: "var(--bad)", marginTop: 24 }}>Gemini: {run.aiSummary.skippedReason}</p>
          ) : null}
          {gemini ? (
            <motion.article
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginTop: 28,
                padding: 24,
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--glass)",
                lineHeight: 1.6,
                fontSize: "0.95rem",
              }}
            >
              <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Gemini executive summary</h2>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  margin: 0,
                  color: "var(--text)",
                }}
              >
                {gemini}
              </pre>
            </motion.article>
          ) : run.geminiSummaryHref ? (
            <p style={{ color: "var(--muted)", marginTop: 24 }}>Loading AI summary…</p>
          ) : (
            <p style={{ color: "var(--muted)", marginTop: 24 }}>No AI summary for this run.</p>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
