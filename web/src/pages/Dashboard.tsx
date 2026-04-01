import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { startRun, streamUrl } from "../api";
import type { HealthSsePayload } from "../types/healthSse";
import RunProgressBanner, { type RunBannerState } from "../components/RunProgressBanner";

export default function Dashboard({ initialUrls }: { initialUrls?: string }) {
  const [urlsText, setUrlsText] = useState(initialUrls ?? "");
  const [runBanner, setRunBanner] = useState<RunBannerState>({ kind: "idle" });
  const [pageSpeedBoth, setPageSpeedBoth] = useState(true);
  const [viewportCheck, setViewportCheck] = useState(true);
  const [gemini, setGemini] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialUrls) setUrlsText(initialUrls);
  }, [initialUrls]);

  useEffect(() => {
    if (runBanner.kind !== "success" && runBanner.kind !== "error") return;
    const ms = runBanner.kind === "success" ? 3200 : 9000;
    const t = window.setTimeout(() => setRunBanner({ kind: "idle" }), ms);
    return () => window.clearTimeout(t);
  }, [runBanner]);

  useEffect(() => {
    const es = new EventSource(streamUrl());
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as HealthSsePayload;
        switch (data.type) {
          case "run_start": {
            const firstHost = data.sites?.[0]?.hostname ?? "…";
            setRunBanner({
              kind: "live",
              runId: data.runId,
              startedAt: data.startedAt ?? new Date().toISOString(),
              totalSites: data.totalSites,
              sitesDone: 0,
              currentIndex: 1,
              currentHostname: firstHost,
              lastDetail: `Queued ${data.totalSites} site(s) — starting…`,
            });
            break;
          }
          case "site_start":
            setRunBanner((prev) => {
              if (prev.kind !== "live" || prev.runId !== data.runId) return prev;
              return {
                ...prev,
                currentIndex: data.index,
                currentHostname: data.hostname,
                lastDetail: `Crawling ${data.hostname}…`,
              };
            });
            break;
          case "site_complete":
            setRunBanner((prev) => {
              if (prev.kind !== "live" || prev.runId !== data.runId) return prev;
              return {
                ...prev,
                sitesDone: prev.sitesDone + 1,
                currentIndex: data.index,
                currentHostname: data.hostname,
                lastDetail: `Finished ${data.hostname}: ${data.pagesVisited} pages crawled · ${data.brokenLinks} broken link rows`,
              };
            });
            break;
          case "site_error":
            setRunBanner((prev) => {
              if (prev.kind !== "live" || prev.runId !== data.runId) return prev;
              return {
                ...prev,
                lastDetail: `Error on ${data.hostname}: ${data.message}`,
              };
            });
            break;
          case "run_complete":
            setRunBanner({
              kind: "success",
              runId: data.runId,
              siteFailures: data.siteFailures,
              totalSites: data.totalSites,
              endedAt: data.endedAt,
              durationMs: data.durationMs,
            });
            break;
          case "run_error":
            setErr(data.message);
            setRunBanner({ kind: "error", message: data.message });
            break;
          default:
            break;
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  const runInFlight =
    runBanner.kind === "posting" || runBanner.kind === "queued" || runBanner.kind === "live";

  const onStart = async () => {
    setErr(null);
    setRunBanner({ kind: "posting" });
    try {
      await startRun({
        urlsText,
        pageSpeedBoth,
        viewportCheck,
        gemini,
      });
      setRunBanner((b) => {
        if (b.kind === "live") return b;
        return { kind: "queued" };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setRunBanner({ kind: "error", message: msg });
    }
  };

  const formDimmed = runBanner.kind === "live";

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        style={{ marginBottom: 28 }}
      >
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, letterSpacing: "-0.04em", margin: "0 0 10px" }}>
          New run
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: 640, lineHeight: 1.55, margin: 0, fontSize: "0.98rem" }}>
          Queue a crawl from root URLs. Optional Lighthouse, viewport checks, and Gemini run after the crawl. See{" "}
          <Link to="/history">run history</Link> for past jobs and <Link to="/reports">reports</Link> for exports.
        </p>
      </motion.div>

      <RunProgressBanner state={runBanner} />

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{
          opacity: formDimmed ? 0.72 : 1,
          y: 0,
          scale: formDimmed ? 0.995 : 1,
        }}
        transition={{ duration: 0.35 }}
        style={{
          padding: 26,
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background: "var(--glass)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "var(--muted)",
            marginBottom: 10,
          }}
        >
          ROOT URLS (ONE PER LINE)
        </label>
        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder={"https://www.example.com\nwww.another.org"}
          rows={6}
          disabled={runInFlight}
          style={{
            width: "100%",
            resize: "vertical",
            padding: 16,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "rgba(0,0,0,0.35)",
            color: "var(--text)",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: "0.85rem",
            lineHeight: 1.45,
            opacity: runInFlight ? 0.85 : 1,
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 16, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: runInFlight ? "default" : "pointer", color: "var(--muted)" }}>
            <input type="checkbox" checked={pageSpeedBoth} disabled={runInFlight} onChange={(e) => setPageSpeedBoth(e.target.checked)} />
            PageSpeed mobile + desktop
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: runInFlight ? "default" : "pointer", color: "var(--muted)" }}>
            <input type="checkbox" checked={viewportCheck} disabled={runInFlight} onChange={(e) => setViewportCheck(e.target.checked)} />
            Viewport loads (Chromium)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: runInFlight ? "default" : "pointer", color: "var(--muted)" }}>
            <input type="checkbox" checked={gemini} disabled={runInFlight} onChange={(e) => setGemini(e.target.checked)} />
            Gemini summary
          </label>
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <motion.button
            type="button"
            whileTap={{ scale: runInFlight ? 1 : 0.98 }}
            onClick={() => void onStart()}
            disabled={runInFlight || !urlsText.trim()}
            style={{
              padding: "12px 28px",
              borderRadius: 999,
              border: "none",
              fontWeight: 600,
              cursor: runInFlight || !urlsText.trim() ? "not-allowed" : "pointer",
              opacity: runInFlight || !urlsText.trim() ? 0.45 : 1,
              background: "linear-gradient(120deg, var(--accent), var(--accent2))",
              color: "#061018",
            }}
          >
            {runBanner.kind === "posting"
              ? "Sending…"
              : runBanner.kind === "queued"
                ? "Starting…"
                : runBanner.kind === "live"
                  ? "Run in progress…"
                  : "Start run"}
          </motion.button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 16, marginBottom: 0 }}>
          Large sites: turn off PageSpeed / viewport / Gemini for speed. Set <code>QA_AGENT_FETCH_CONCURRENCY</code> in <code>.env</code> for more parallel HTTP.
        </p>
      </motion.section>

      {err ? (
        <p style={{ color: "var(--bad)", marginTop: 20 }}>{err}</p>
      ) : null}
    </div>
  );
}
