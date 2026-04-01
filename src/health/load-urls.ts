import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRootUrl } from "./normalize-url.js";

/**
 * One root URL per line. Empty lines and lines starting with # are ignored.
 */
export async function loadUrlsFromTxt(filePath: string): Promise<string[]> {
  const absolute = path.resolve(filePath);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      throw new Error(
        `URLs file not found: ${absolute}\n` +
          `Create it (e.g. copy config/urls.example.txt to config/urls.txt) or pass --urls <path> to an existing file.`,
      );
    }
    throw e;
  }
  return parseUrlsFromText(raw);
}

/** Parse one URL per line (same rules as the URLs file). Bare hostnames get `https://`. */
export function parseUrlsFromText(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const norm = normalizeRootUrl(t);
    if (!norm) continue;
    const key = canonicalUrlKey(norm);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(norm);
  }
  return urls;
}

/** Normalize URL string for deduplication (same origin+path as `URL.href` after normalizeRootUrl). */
function canonicalUrlKey(normalizedHref: string): string {
  try {
    return new URL(normalizedHref).href;
  } catch {
    return normalizedHref;
  }
}

/**
 * Drop duplicate roots (same normalized href). Use for inline URL lists from the dashboard API.
 */
export function dedupeNormalizedUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const norm = normalizeRootUrl(raw.trim());
    if (!norm) continue;
    const key = canonicalUrlKey(norm);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

export function siteIdFromUrl(url: string): string {
  const h = new URL(url).hostname;
  return h.replace(/[^a-z0-9.-]+/gi, "_");
}

/**
 * Unique directory name per line in urls.txt (1-based index + hostname).
 * Prevents two lines with the same hostname from overwriting the same folder.
 */
export function healthSiteOutputDirName(lineIndex: number, startUrl: string): string {
  const id = siteIdFromUrl(startUrl);
  const n = String(lineIndex + 1).padStart(3, "0");
  return `${n}-${id}`;
}
