import type { PageFetchRecord } from "./types.js";

/**
 * File extensions that indicate a non-HTML resource (Lighthouse / PageSpeed returns NOT_HTML for these).
 */
const NON_HTML_PATH_RE =
  /\.(jpe?g|png|gif|webp|avif|bmp|svgz?|ico|pdf|zip|gz|tgz|mp4|webm|mov|mp3|ogg|wav|woff2?|ttf|otf|eot|css|js|mjs|cjs|map|json|csv|ts|tsx)(\?|#|$)/i;

/**
 * Whether this successfully fetched crawl row is an HTML document suitable for PageSpeed / viewport lab.
 * Skips images, PDFs, media, fonts, etc. to avoid NOT_HTML and wasted API time.
 */
export function isCrawlPageEligibleForLighthouseLab(p: PageFetchRecord): boolean {
  if (!p.ok || p.status !== 200) return false;

  const mime = (p.contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";

  if (mime.includes("text/html") || mime.includes("application/xhtml")) {
    return true;
  }

  if (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    mime === "application/pdf" ||
    mime === "text/css" ||
    mime === "application/javascript" ||
    mime === "text/javascript" ||
    mime === "application/json" ||
    mime.startsWith("font/")
  ) {
    return false;
  }

  let pathLower = "";
  try {
    pathLower = new URL(p.url).pathname.toLowerCase();
  } catch {
    return false;
  }

  if (NON_HTML_PATH_RE.test(pathLower)) return false;

  if (mime === "" || mime === "application/octet-stream") {
    return true;
  }

  if (mime.startsWith("text/") || mime.includes("xml")) {
    return false;
  }

  return false;
}
