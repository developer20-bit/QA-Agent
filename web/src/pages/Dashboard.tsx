import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { startRun, streamUrl } from "../api";
import type { HealthSsePayload } from "../types/healthSse";
import OptionWithTooltip from "../components/OptionWithTooltip";
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
        style={{ marginBottom: 24 }}
      >
        <h1 className="qa-page-title">New run</h1>
        <p className="qa-page-desc">
          Queue a crawl from root URLs. Optional Lighthouse, viewport checks, and Gemini run after the crawl. See{" "}
          <Link to="/history">run history</Link> for past jobs and <Link to="/reports">reports</Link> for exports.
        </p>
      </motion.div>

      <RunProgressBanner state={runBanner} />

      <motion.section
        className="qa-panel"
        initial={{ opacity: 0, y: 12 }}
        animate={{
          opacity: formDimmed ? 0.75 : 1,
          y: 0,
        }}
        transition={{ duration: 0.35 }}
        style={{ padding: 24, overflow: "hidden" }}
      >
        <div className="qa-panel-head">
          <h2 className="qa-panel-title">Start a crawl</h2>
          <p className="qa-panel-subtitle">
            Paste root URLs (one per line). The crawler discovers same-site pages, checks links, then optionally runs PageSpeed, viewport smoke loads, and Gemini.
          </p>
        </div>
        <label className="qa-label-field">Root URLs (one per line)</label>
        <textarea
          className="qa-textarea"
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder={"https://www.example.com\nwww.another.org"}
          rows={6}
          disabled={runInFlight}
          style={{
            width: "100%",
            resize: "vertical",
            padding: "12px 14px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.8125rem",
            lineHeight: 1.45,
            opacity: runInFlight ? 0.85 : 1,
          }}
        />
        <hr className="qa-divider" />
        <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
          Optional post-crawl steps
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", rowGap: 10 }}>
          <OptionWithTooltip
            hint="Calls Google PageSpeed Insights (Lighthouse lab) for each crawled HTML page, twice: mobile and desktop. Adds performance, a11y, best-practices, and SEO scores to reports. Requires PAGESPEED_API_KEY (or GOOGLE_PAGESPEED_API_KEY) on the server. Slower and API-metered—turn off for large crawls."
          >
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: runInFlight ? "default" : "pointer", color: "var(--muted)" }}>
              <input type="checkbox" checked={pageSpeedBoth} disabled={runInFlight} onChange={(e) => setPageSpeedBoth(e.target.checked)} />
              PageSpeed mobile + desktop
            </label>
          </OptionWithTooltip>
          <OptionWithTooltip hint="Opens each URL in local headless Chromium at a phone-sized and a desktop-sized viewport to check that the page loads without hard failures. Lightweight smoke test—not a full Lighthouse audit. Adds a few seconds per URL.">
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: runInFlight ? "default" : "pointer", color: "var(--muted)" }}>
              <input type="checkbox" checked={viewportCheck} disabled={runInFlight} onChange={(e) => setViewportCheck(e.target.checked)} />
              Viewport loads (Chromium)
            </label>
          </OptionWithTooltip>
          <OptionWithTooltip hint="After the crawl finishes, sends a compact JSON summary of the run to Google Gemini and saves a short Markdown executive summary (gemini-summary.md) for the run workspace and dashboard. Requires GEMINI_API_KEY or GOOGLE_AI_API_KEY. Does not run PageSpeed for you—it only narrates results.">
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: runInFlight ? "default" : "pointer", color: "var(--muted)" }}>
              <input type="checkbox" checked={gemini} disabled={runInFlight} onChange={(e) => setGemini(e.target.checked)} />
              Gemini summary
            </label>
          </OptionWithTooltip>
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <motion.button
            type="button"
            className="qa-btn-primary"
            whileTap={{ scale: runInFlight ? 1 : 0.98 }}
            onClick={() => void onStart()}
            disabled={runInFlight || !urlsText.trim()}
            style={{
              padding: "8px 20px",
              minHeight: 36,
              cursor: runInFlight || !urlsText.trim() ? "not-allowed" : "pointer",
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
        <p className="qa-footnote" style={{ marginTop: 18 }}>
          Large sites: disable PageSpeed, viewport, or Gemini for faster runs. Tune <code>QA_AGENT_FETCH_CONCURRENCY</code> in <code>.env</code> for heavier parallel HTTP.
        </p>
      </motion.section>

      {err ? <div className="qa-alert qa-alert--error">{err}</div> : null}
    </div>
  );
}
