// @ts-nocheck — page.evaluate callback runs in Chromium (DOM APIs).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

export const SITE_STATUS_OVERRIDES_FILE = "site-status-overrides.json";

export type SiteStatusValue = "open" | "ok" | "working" | "resolved";

export type SiteStatusEntry = {
  status: SiteStatusValue;
  editedAt?: string;
};

export type SiteStatusOverridesFile = {
  runId: string;
  savedAt?: string;
  sites: Record<string, SiteStatusEntry>;
};

export async function loadSiteStatusOverrides(runRoot: string): Promise<SiteStatusOverridesFile | null> {
  const p = path.join(runRoot, SITE_STATUS_OVERRIDES_FILE);
  try {
    const raw = await readFile(p, "utf8");
    const j = JSON.parse(raw) as SiteStatusOverridesFile;
    if (!j || typeof j !== "object" || !j.sites || typeof j.sites !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * After loading the report HTML in Playwright, adjust the DOM so PDFs reflect manual site status
 * (working section + edited labels). Serialized data is passed into the page (no file access in browser).
 */
export async function applySiteStatusForPdf(
  page: Page,
  file: SiteStatusOverridesFile | null,
  _absHtmlPath: string,
): Promise<void> {
  if (!file?.sites || Object.keys(file.sites).length === 0) return;
  const sites = file.sites;
  await page.evaluate((payload) => {
    const siteMap = payload.sites as Record<string, { status?: string; editedAt?: string }>;
    const workingSet = new Set(["ok", "working", "resolved"]);

    function findOverride(hostname: string): { status: string; editedAt?: string } | null {
      const h = hostname.trim().toLowerCase();
      for (const k of Object.keys(siteMap)) {
        if (k.toLowerCase() === h) {
          const e = siteMap[k];
          if (e && typeof e.status === "string") return { status: e.status, editedAt: e.editedAt };
        }
      }
      return null;
    }

    function labelFor(status: string): string {
      return status.length ? status.charAt(0).toUpperCase() + status.slice(1) : status;
    }

    const h1 = document.querySelector("h1")?.textContent ?? "";
    const isMaster = h1.includes("All sites");
    const isRunSummary = document.body?.getAttribute("data-run-summary") === "1";
    const hostAttr = document.body?.getAttribute("data-site-hostname")?.trim();

    if (hostAttr && !isMaster) {
      const o = findOverride(hostAttr);
      if (!o) return;
      const header = document.querySelector(".report-header");
      if (!header) return;
      const badge = document.createElement("div");
      badge.style.cssText =
        "margin:0 0 22px;padding:18px 20px;border:2px solid #34c759;border-radius:12px;background:rgba(52,199,89,0.1);font-size:15px;line-height:1.45;";
      const lab = labelFor(o.status);
      const when = o.editedAt
        ? ` <span style="color:#64748b;font-size:0.9em">· Edited ${new Date(o.editedAt).toLocaleString()}</span>`
        : "";
      badge.innerHTML =
        `<strong>Manual site status:</strong> <span style="color:#166534;font-weight:700">${lab}</span>${when}` +
        `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:6px;background:#dcfce7;font-size:0.72rem;font-weight:700;color:#14532d;vertical-align:middle">EDITED</span>` +
        `<p style="margin:10px 0 0;color:#64748b;font-size:0.9em">Original crawl data appears below; this label is what you signed off for exports.</p>`;
      header.insertAdjacentElement("afterend", badge);
      return;
    }

    if (isRunSummary && isMaster) {
      const articles = [...document.querySelectorAll("article.site-summary-sheet[data-site-hostname]")];
      const moved: { art: HTMLElement; o: { status: string; editedAt?: string }; host: string }[] = [];
      for (const art of articles) {
        const host = art.getAttribute("data-site-hostname")?.trim();
        if (!host) continue;
        const o = findOverride(host);
        if (!o || !workingSet.has(o.status)) continue;
        moved.push({ art: art as HTMLElement, o, host });
      }
      moved.sort((a, b) => a.host.localeCompare(b.host));
      if (moved.length === 0) return;

      const header = document.querySelector(".report-header");
      if (!header) return;

      const newSection = document.createElement("section");
      newSection.className = "report-section";
      newSection.id = "qa-manual-site-triage";
      newSection.style.cssText =
        "border:2px solid #34c759;border-radius:12px;margin-bottom:22px;background:rgba(52,199,89,0.06);padding:26px 28px 28px;";
      newSection.innerHTML = `<h2>Working websites (manual triage)</h2>
<p class="section-desc">Sites you marked as <strong>OK</strong>, <strong>Working</strong>, or <strong>Resolved</strong> in the dashboard. Crawl status shows your label and an <strong>EDITED</strong> tag.</p>
<div id="qa-run-summary-moved"></div>`;
      const slot = newSection.querySelector("#qa-run-summary-moved");
      if (!slot) return;
      header.insertAdjacentElement("afterend", newSection);

      for (const { art, o } of moved) {
        const dts = [...art.querySelectorAll("dt")];
        const crawlDt = dts.find((dt) => (dt.textContent ?? "").trim() === "Crawl status");
        const dd = crawlDt?.nextElementSibling;
        if (dd) {
          const lab = labelFor(o.status);
          const when = o.editedAt
            ? `<span style="color:#64748b;font-size:0.85em;margin-left:6px">${new Date(o.editedAt).toLocaleString()}</span>`
            : "";
          dd.innerHTML =
            `<span class="summary-crawl-status cell-ok">${lab}</span>${when} ` +
            `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:6px;background:#dcfce7;font-size:0.72rem;font-weight:700;color:#14532d">EDITED</span>`;
        }
        slot.appendChild(art);
      }

      const note = document.createElement("p");
      note.className = "section-desc";
      note.style.cssText = "margin:12px 0 0;color:#64748b;font-size:0.9em";
      note.textContent = `${moved.length} site(s) appear in “Working websites” above; they were removed from the list below.`;
      newSection.appendChild(note);
      return;
    }

    if (!isMaster) return;

    const summaryH2 = [...document.querySelectorAll("section.report-section h2")].find((h) =>
      (h.textContent ?? "").trim().startsWith("Summary by site"),
    );
    if (!summaryH2) return;
    const summarySection = summaryH2.closest("section.report-section");
    if (!summarySection) return;
    const tb = summarySection.querySelector("tbody");
    if (!tb) return;

    const moved: { tr: HTMLTableRowElement; o: { status: string; editedAt?: string }; host: string }[] = [];
    for (const tr of tb.querySelectorAll("tr")) {
      let host = tr.getAttribute("data-site-hostname")?.trim();
      if (!host) host = tr.querySelector("td")?.textContent?.trim() ?? "";
      if (!host) continue;
      const o = findOverride(host);
      if (!o || !workingSet.has(o.status)) continue;
      moved.push({ tr: tr as HTMLTableRowElement, o, host });
    }
    moved.sort((a, b) => a.host.localeCompare(b.host));

    if (moved.length === 0) return;

    const header = document.querySelector(".report-header");
    if (!header) return;

    const newSection = document.createElement("section");
    newSection.className = "report-section";
    newSection.id = "qa-manual-site-triage";
    newSection.style.cssText =
      "border:2px solid #34c759;border-radius:12px;margin-bottom:22px;background:rgba(52,199,89,0.06);padding:26px 28px 28px;";

    const thead = `<thead><tr>
  <th>Site</th><th>Start page</th><th>Start URL</th><th class="num">Pages</th><th class="num">Broken</th>
  <th class="num">Avg ms</th><th class="num">OK %</th><th class="num">HTML size</th><th>Status (edited)</th><th>Finished</th>
</tr></thead>`;
    newSection.innerHTML = `<h2>Working websites (manual triage)</h2>
<p class="section-desc">Sites you marked as <strong>OK</strong>, <strong>Working</strong>, or <strong>Resolved</strong> in the dashboard. The Status column shows your label and an <strong>EDITED</strong> tag.</p>
<div class="table-wrap"><table class="data-table">${thead}<tbody></tbody></table></div>`;
    const newTbody = newSection.querySelector("tbody");
    if (!newTbody) return;
    header.insertAdjacentElement("afterend", newSection);

    for (const { tr, o } of moved) {
      const statusTd = tr.querySelector("td:nth-child(9)");
      if (statusTd) {
        const lab = labelFor(o.status);
        const when = o.editedAt
          ? `<span style="color:#64748b;font-size:0.85em;margin-left:6px">${new Date(o.editedAt).toLocaleString()}</span>`
          : "";
        statusTd.innerHTML =
          `<span style="color:#166534;font-weight:700">${lab}</span>${when} ` +
          `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:6px;background:#dcfce7;font-size:0.72rem;font-weight:700;color:#14532d">EDITED</span>`;
      }
      newTbody.appendChild(tr);
    }

    const note = document.createElement("p");
    note.className = "section-desc";
    note.style.cssText = "margin-top:12px;color:#64748b;font-size:0.9em";
    note.textContent = `${moved.length} site(s) appear in “Working websites” above; they were removed from the summary table below.`;
    const tableWrap = summarySection.querySelector(".table-wrap");
    if (tableWrap) summarySection.insertBefore(note, tableWrap);
  }, { sites });
}
