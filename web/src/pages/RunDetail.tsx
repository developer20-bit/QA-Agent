import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchGeminiSummary, fetchHistory, pdfUrl, reportIndexUrl, type HealthRunMeta } from "../api";
import { formatDeviceDateTime, formatDurationMs } from "../lib/time";

export default function RunDetail() {
  const { runId: raw } = useParams();
  const runId = raw ? decodeURIComponent(raw) : "";
  const [run, setRun] = useState<HealthRunMeta | null>(null);
  const [gemini, setGemini] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const h = await fetchHistory();
        const flat = h.days.flatMap((d) => d.runs);
        const found = flat.find((r) => r.runId === runId) ?? null;
        if (!cancelled) setRun(found);
        if (found?.geminiSummaryHref) {
          const g = await fetchGeminiSummary(runId);
          if (!cancelled) setGemini(g);
        } else {
          setGemini(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const title = useMemo(() => run?.runId ?? runId, [run, runId]);

  const wall =
    run?.durationMsTotal != null
      ? formatDurationMs(run.durationMsTotal)
      : run?.startedAt
        ? formatDurationMs(new Date(run.generatedAt).getTime() - new Date(run.startedAt).getTime())
        : null;

  return (
    <div>
      <Link to="/history" style={{ fontSize: "0.88rem" }}>
        ← Run history
      </Link>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: 16, letterSpacing: "-0.03em" }}
      >
        {title}
      </motion.h1>
      {err ? <p style={{ color: "var(--bad)" }}>{err}</p> : null}
      {!run && !err ? <p style={{ color: "var(--muted)" }}>Loading…</p> : null}
      {run ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 20 }}>
          <div
            style={{
              marginBottom: 24,
              padding: 18,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "rgba(0,0,0,0.2)",
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: "0.85rem",
              color: "var(--muted)",
              lineHeight: 1.7,
            }}
          >
            <div>
              <strong style={{ color: "var(--text)" }}>START</strong> {run.startedAt ? formatDeviceDateTime(run.startedAt) : "—"}
            </div>
            <div>
              <strong style={{ color: "var(--text)" }}>END</strong> {formatDeviceDateTime(run.generatedAt)}
            </div>
            <div>
              <strong style={{ color: "var(--text)" }}>WALL</strong>{" "}
              <span style={{ color: "var(--ok)", fontWeight: 600 }}>{wall ?? "—"}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 28 }}>
            <a href={reportIndexUrl(run.runId)} target="_blank" rel="noreferrer">
              Open HTML run index
            </a>
            <a href={`/reports/${encodeURIComponent(run.runId)}/master.html`} target="_blank" rel="noreferrer">
              Combined report
            </a>
            <a href={pdfUrl(run.runId, "index.html")} target="_blank" rel="noreferrer">
              Download PDF (index)
            </a>
          </div>
          {run.aiSummary?.skippedReason ? (
            <p style={{ color: "var(--bad)" }}>Gemini: {run.aiSummary.skippedReason}</p>
          ) : null}
          {gemini ? (
            <motion.article
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
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
            <p style={{ color: "var(--muted)" }}>Loading AI summary…</p>
          ) : (
            <p style={{ color: "var(--muted)" }}>No AI summary for this run.</p>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
