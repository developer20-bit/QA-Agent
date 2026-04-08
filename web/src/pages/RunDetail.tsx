import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  askGeminiAboutRun,
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
import MarkdownBody from "../components/MarkdownBody";
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
  const [runChatQuestion, setRunChatQuestion] = useState("");
  const [runChatAnswer, setRunChatAnswer] = useState<string | null>(null);
  const [runChatLoading, setRunChatLoading] = useState(false);
  const [runChatErr, setRunChatErr] = useState<string | null>(null);
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
    setRunChatQuestion("");
    setRunChatAnswer(null);
    setRunChatErr(null);

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
      <Link to="/history" style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--muted)" }}>
        ← Back to run history
      </Link>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="qa-kicker"
        style={{ marginTop: 16, marginBottom: 4 }}
      >
        Run workspace
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="qa-run-id"
        style={{ fontSize: "1.125rem", marginTop: 4, marginBottom: 0, lineHeight: 1.35 }}
      >
        {title}
      </motion.h1>
      {loading ? (
        <p className="qa-footnote" style={{ marginTop: 20 }}>
          Loading run metadata…
        </p>
      ) : null}
      {err ? <div className="qa-alert qa-alert--error" style={{ marginTop: 16, maxWidth: 560 }}>{err}</div> : null}
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
            className="qa-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 }}
            style={{ marginTop: 24, padding: 20 }}
          >
            <h2 className="qa-panel-title" style={{ margin: "0 0 10px" }}>
              Run index
            </h2>
            <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
              Table of contents with links into each site folder (static HTML index).
            </p>
            <a href={reportIndexUrl(run.runId)} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
              Open run index (HTML)
            </a>
          </motion.section>

          <motion.section
            className="qa-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            style={{ marginTop: 24, padding: 0, overflow: "hidden" }}
          >
            <div className="qa-panel-header">
              <p className="qa-kicker" style={{ marginBottom: 8, letterSpacing: "0.08em" }}>
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
                  <h2 className="qa-panel-title" style={{ margin: "0 0 6px", fontSize: "1.0625rem" }}>
                    Combined report
                  </h2>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
                    Full all-sites view: PC, tablet, and phone start-page screenshots, PageSpeed scores, crawl tables, and triage — same as the legacy combined MASTER report. The preview below reflects saved triage when you export.{" "}
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
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
                  <motion.a
                    href={combinedPdfDownload}
                    className="qa-btn-primary"
                    whileTap={{ scale: 0.98 }}
                    style={{ textAlign: "center", minHeight: 36, fontSize: "0.875rem" }}
                  >
                    Download PDF
                  </motion.a>
                  <a
                    href={combinedHtmlBase}
                    target="_blank"
                    rel="noreferrer"
                    className="qa-btn-default"
                    style={{ textAlign: "center", fontSize: "0.8125rem" }}
                  >
                    Open combined HTML
                  </a>
                  <a
                    href={statsSummaryHtmlBase}
                    target="_blank"
                    rel="noreferrer"
                    className="qa-btn-subtle"
                    style={{ textAlign: "center", fontSize: "0.8125rem" }}
                  >
                    Stats summary only
                  </a>
                </div>
              </div>
            </div>
            <div style={{ background: "#ebecf0", minHeight: 480, borderTop: "1px solid var(--border)" }}>
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
              className="qa-panel"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginTop: 24,
                padding: 20,
                lineHeight: 1.55,
                fontSize: "0.9375rem",
              }}
            >
              <h2 className="qa-panel-title" style={{ marginTop: 0, fontSize: "1.0625rem" }}>
                AI summary
              </h2>
              <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: "0.85rem" }}>
                Saved when the run was started with Gemini enabled — bullet-style snapshot for a quick read.
              </p>
              <MarkdownBody markdown={gemini} />
            </motion.article>
          ) : run.geminiSummaryHref ? (
            <p style={{ color: "var(--muted)", marginTop: 24 }}>Loading AI summary…</p>
          ) : (
            <p style={{ color: "var(--muted)", marginTop: 24 }}>No saved AI summary for this run (enable Gemini when starting a crawl).</p>
          )}

          <motion.section
            className="qa-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginTop: 24, padding: 20 }}
          >
            <h2 className="qa-panel-title" style={{ marginTop: 0, marginBottom: 8, fontSize: "1.0625rem" }}>
              Ask about this run
            </h2>
            <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: "0.88rem", lineHeight: 1.5 }}>
              Short answers from Gemini using this run’s crawl data (same JSON as the combined report). Needs{" "}
              <code style={{ fontSize: "0.82em" }}>GEMINI_API_KEY</code> or{" "}
              <code style={{ fontSize: "0.82em" }}>GOOGLE_AI_API_KEY</code> on the server.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
              <input
                type="text"
                className="qa-input"
                value={runChatQuestion}
                onChange={(e) => setRunChatQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void (async () => {
                      const q = runChatQuestion.trim();
                      if (!q || runChatLoading) return;
                      setRunChatLoading(true);
                      setRunChatErr(null);
                      setRunChatAnswer(null);
                      try {
                        const a = await askGeminiAboutRun(run.runId, q);
                        setRunChatAnswer(a);
                      } catch (ex) {
                        setRunChatErr(ex instanceof Error ? ex.message : String(ex));
                      } finally {
                        setRunChatLoading(false);
                      }
                    })();
                  }
                }}
                placeholder="e.g. Worst mobile Lighthouse pages? Any broken links?"
                disabled={runChatLoading}
                style={{
                  flex: "1 1 220px",
                  minWidth: 0,
                  padding: "8px 12px",
                  fontSize: "0.875rem",
                }}
              />
              <motion.button
                type="button"
                className="qa-btn-primary"
                disabled={runChatLoading || !runChatQuestion.trim()}
                whileTap={{ scale: runChatLoading ? 1 : 0.98 }}
                onClick={() => {
                  void (async () => {
                    const q = runChatQuestion.trim();
                    if (!q) return;
                    setRunChatLoading(true);
                    setRunChatErr(null);
                    setRunChatAnswer(null);
                    try {
                      const a = await askGeminiAboutRun(run.runId, q);
                      setRunChatAnswer(a);
                    } catch (ex) {
                      setRunChatErr(ex instanceof Error ? ex.message : String(ex));
                    } finally {
                      setRunChatLoading(false);
                    }
                  })();
                }}
                style={{
                  minWidth: 72,
                  cursor: runChatLoading || !runChatQuestion.trim() ? "not-allowed" : "pointer",
                }}
              >
                {runChatLoading ? "…" : "Ask"}
              </motion.button>
            </div>
            {runChatErr ? (
              <p style={{ color: "var(--bad)", marginTop: 14, marginBottom: 0, fontSize: "0.88rem" }}>{runChatErr}</p>
            ) : null}
            {runChatAnswer ? (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: "0.92rem" }}>
                  <MarkdownBody markdown={runChatAnswer} />
                </div>
              </div>
            ) : null}
          </motion.section>
        </motion.div>
      ) : null}
    </div>
  );
}
