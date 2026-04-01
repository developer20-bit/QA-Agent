import type { PageFetchRecord, PageSpeedInsightRecord, PageSpeedInsightsBundle } from "./types.js";

export function isInsightsBundle(
  i: PageSpeedInsightRecord | PageSpeedInsightsBundle | undefined,
): i is PageSpeedInsightsBundle {
  if (!i || typeof i !== "object") return false;
  return "mobile" in i || "desktop" in i;
}

/** One or two Lighthouse cards per crawled page (legacy single + dual strategies). */
export function flattenInsights(
  insights: PageFetchRecord["insights"],
): PageSpeedInsightRecord[] {
  if (!insights) return [];
  if (isInsightsBundle(insights)) {
    const out: PageSpeedInsightRecord[] = [];
    if (insights.mobile) out.push(insights.mobile);
    if (insights.desktop) out.push(insights.desktop);
    return out;
  }
  return [insights];
}

export function bestPerformanceScore(p: PageFetchRecord): number {
  let best = 999;
  for (const i of flattenInsights(p.insights)) {
    if (i.error) {
      best = Math.min(best, 1000);
      continue;
    }
    const perf = i.scores?.performance;
    if (perf != null) best = Math.min(best, perf);
  }
  return best;
}

export function hasPageSpeedInsights(p: PageFetchRecord): boolean {
  return flattenInsights(p.insights).length > 0;
}
