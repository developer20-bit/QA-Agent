import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSiteStatusOverrides,
  saveSiteStatusOverrides,
  sitePdfUrl,
  siteReportHtmlUrl,
  type HealthRunMeta,
  type SiteStatusValue,
} from "../api";
import { formatDeviceDateTime } from "../lib/time";

const OPTIONS: { value: SiteStatusValue; label: string; hint: string }[] = [
  { value: "open", label: "Open", hint: "Still under review" },
  { value: "ok", label: "OK", hint: "Signed off" },
  { value: "working", label: "Working", hint: "In progress / acceptable" },
  { value: "resolved", label: "Resolved", hint: "Issue addressed" },
];

export default function SiteStatusEditor({ run, onSaved }: { run: HealthRunMeta; onSaved?: () => void }) {
  const [sites, setSites] = useState<Record<string, SiteStatusValue>>({});
  const [editedAt, setEditedAt] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "err">("idle");
  const [err, setErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const ov = await fetchSiteStatusOverrides(run.runId);
        const next: Record<string, SiteStatusValue> = {};
        const ea: Record<string, string | undefined> = {};
        for (const s of run.sites) {
          const row = ov?.sites?.[s.hostname];
          next[s.hostname] = row?.status ?? "open";
          ea[s.hostname] = row?.editedAt;
        }
        if (!cancelled) {
          setSites(next);
          setEditedAt(ea);
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
  }, [run.runId]);

  const persist = useCallback(
    async (map: Record<string, SiteStatusValue>) => {
      setSaveState("saving");
      setErr(null);
      try {
        const payload = await saveSiteStatusOverrides(run.runId, map);
        const ea: Record<string, string | undefined> = {};
        for (const [h, row] of Object.entries(payload.sites ?? {})) {
          ea[h] = row?.editedAt;
        }
        setEditedAt(ea);
        setSaveState("saved");
        onSaved?.();
        window.setTimeout(() => setSaveState("idle"), 2200);
      } catch (e) {
        setSaveState("err");
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [run.runId, onSaved],
  );

  const scheduleSave = useCallback(
    (map: Record<string, SiteStatusValue>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void persist(map);
      }, 480);
    },
    [persist],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <motion.section
      className="qa-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        marginTop: 24,
        padding: 20,
      }}
    >
      <h2 className="qa-panel-title" style={{ margin: "0 0 8px" }}>
        Sites
      </h2>
      <p style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
        <strong style={{ color: "var(--text)" }}>Status</strong> feeds the combined PDF (&quot;Working websites&quot; + EDITED).{" "}
        <strong style={{ color: "var(--text)" }}>Open HTML</strong> is the full crawl with issue triage. Saves to{" "}
        <code style={{ fontSize: "0.85em" }}>site-status-overrides.json</code>.
      </p>
      {err ? <p style={{ color: "var(--bad)", marginBottom: 12 }}>{err}</p> : null}
      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading triage…</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved." : saveState === "err" ? "Save failed." : " "}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {run.sites.map((s) => {
              const st = sites[s.hostname] ?? "open";
              const when = editedAt[s.hostname];
              const htmlUrl = siteReportHtmlUrl(run.runId, s.reportHtmlHref);
              const pdfUrl = sitePdfUrl(run.runId, s.reportHtmlHref, { download: true });
              return (
                <div
                  key={s.hostname + s.startUrl}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--glass2)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                    <a
                      href={htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--accent2)", wordBreak: "break-all" }}
                    >
                      {s.hostname}
                    </a>
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 6, fontFamily: "ui-monospace, Menlo, monospace" }}>
                      {s.pagesVisited} pages · {s.brokenLinks} broken · {s.durationMs} ms ·{" "}
                      <span style={{ color: s.failed ? "var(--bad)" : "var(--ok)" }}>{s.failed ? "Issues" : "OK"}</span>
                      {when ? (
                        <span style={{ marginLeft: 8 }}>
                          · PDF status saved {formatDeviceDateTime(when)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="visually-hidden">PDF status for {s.hostname}</span>
                      <select
                        className="qa-select"
                        value={st}
                        onChange={(e) => {
                          const v = e.target.value as SiteStatusValue;
                          setSites((prev) => {
                            const next = { ...prev, [s.hostname]: v };
                            scheduleSave(next);
                            return next;
                          });
                        }}
                        aria-label={`PDF site status for ${s.hostname}`}
                        style={{
                          fontSize: "0.8125rem",
                          padding: "6px 10px",
                          minWidth: 200,
                        }}
                      >
                        {OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label} — {o.hint}
                          </option>
                        ))}
                      </select>
                    </label>
                    <a href={htmlUrl} target="_blank" rel="noreferrer" className="qa-btn-default" style={{ whiteSpace: "nowrap" }}>
                      Open HTML
                    </a>
                    <a href={pdfUrl} className="qa-btn-primary" style={{ whiteSpace: "nowrap" }}>
                      Download PDF
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </motion.section>
  );
}
