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
        className="qa-page-title"
      >
        Import URL lists
      </motion.h1>
      <p className="qa-page-desc">
        Upload a <strong>.txt</strong> (one URL per line) or a <strong>.pdf</strong> that contains links. Bare hostnames like{" "}
        <code>nwface.com</code> are normalized to <code>https://nwface.com/</code>.
      </p>
      <label
        className="qa-btn-default"
        style={{
          display: "inline-flex",
          marginTop: 20,
          cursor: "pointer",
          borderStyle: "dashed",
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
        <p className="qa-footnote" style={{ marginTop: 16 }}>
          {status}
        </p>
      ) : null}
      {urls.length > 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 24 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <motion.button
              type="button"
              className="qa-btn-default"
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                void navigator.clipboard.writeText(urls.join("\n"));
              }}
            >
              Copy all
            </motion.button>
            <motion.button
              type="button"
              className="qa-btn-primary"
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/", { state: { urlsText: urls.join("\n") } })}
            >
              Send to dashboard
            </motion.button>
          </div>
          <textarea
            className="qa-textarea"
            readOnly
            value={urls.join("\n")}
            rows={Math.min(16, urls.length + 2)}
            style={{
              width: "100%",
              padding: "12px 14px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.8125rem",
            }}
          />
        </motion.div>
      ) : null}
    </div>
  );
}
