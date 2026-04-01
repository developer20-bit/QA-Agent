/**
 * Turn loose hostnames / partial URLs into canonical https URLs for crawling.
 * Accepts: `nwface.com`, `www.nwface.com`, `https://www.nwface.com`, `http://x/path`.
 */
export function normalizeRootUrl(raw: string): string | null {
  let t = raw.trim();
  if (!t || t.startsWith("#")) return null;
  t = t.replace(/^\s+|\s+$/g, "");
  if (!/^https?:\/\//i.test(t)) {
    t = `https://${t}`;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    if (u.pathname === "") u.pathname = "/";
    return u.href;
  } catch {
    return null;
  }
}
