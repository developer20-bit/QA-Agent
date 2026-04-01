import { motion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseUrlsFile } from "../api";

export default function Upload() {
  const [status, setStatus] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const navigate = useNavigate();

  const onFile = async (f: File | null) => {
    if (!f) return;
    setStatus("Parsing…");
    try {
      const list = await parseUrlsFile(f);
      setUrls(list);
      setStatus(`Found ${list.length} URL(s). Copy them to the dashboard or run via CLI.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      setUrls([]);
    }
  };

  return (
    <div>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em" }}
      >
        Import URL lists
      </motion.h1>
      <p style={{ color: "var(--muted)", maxWidth: 640, lineHeight: 1.55 }}>
        Upload a <strong>.txt</strong> (one URL per line) or <strong>.pdf</strong> containing links. Bare hostnames like{" "}
        <code>nwface.com</code> are normalized to <code>https://nwface.com/</code>.
      </p>
      <label
        style={{
          display: "inline-block",
          marginTop: 24,
          padding: "14px 22px",
          borderRadius: 999,
          border: "1px dashed var(--border)",
          cursor: "pointer",
          background: "var(--glass)",
        }}
      >
        <input
          type="file"
          accept=".txt,.pdf,text/plain,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        Choose .txt or .pdf
      </label>
      {status ? (
        <p style={{ marginTop: 18, color: "var(--muted)" }}>{status}</p>
      ) : null}
      {urls.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ marginTop: 28 }}
        >
          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                void navigator.clipboard.writeText(urls.join("\n"));
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              Copy all
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/", { state: { urlsText: urls.join("\n") } })}
              style={{
                padding: "10px 18px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: "linear-gradient(120deg, var(--accent), var(--accent2))",
                color: "#061018",
                fontWeight: 600,
              }}
            >
              Send to dashboard
            </motion.button>
          </div>
          <textarea
            readOnly
            value={urls.join("\n")}
            rows={Math.min(16, urls.length + 2)}
            style={{
              width: "100%",
              padding: 16,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "rgba(0,0,0,0.35)",
              color: "var(--text)",
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: "0.85rem",
            }}
          />
        </motion.div>
      ) : null}
    </div>
  );
}
