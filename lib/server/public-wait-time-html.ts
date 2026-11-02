import type { PublicWaitTime } from "@/lib/domain/public-wait-time";

export function renderPublicWaitTime(estimates: PublicWaitTime | null): string {
  const value = (minutes: number | null | undefined) =>
    typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
      ? `<p class="estimate"><strong>${Math.max(5, Math.round(minutes / 5) * 5)}</strong><span>分以上</span></p>`
      : '<p class="unavailable">現在、待ち時間を推定できません</p>';
  // Plain HTML deliberately bypasses the staff layout, React hydration, fonts,
  // login controls and realtime connections. Refresh always uses the clean URL.
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="120;url=/wait-time"><meta name="robots" content="noindex"><link rel="icon" href="data:,"><title>待ち時間 | KISSa</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f7;color:#122033;font-family:system-ui,sans-serif}main{max-width:36rem;margin:4rem auto;padding:0 1.5rem}h1{font-size:1.25rem;font-weight:600;margin:0 0 1.5rem}section{background:#fff;border:1px solid #dbe0e3;border-radius:1rem;padding:1.5rem 1.75rem;margin:1rem 0}h2{font-size:1.15rem;font-weight:600;margin:0 0 .75rem}.estimate{display:flex;align-items:baseline;gap:.5rem;margin:0;color:#0f766e}.estimate strong{font-size:4rem;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:-.04em}.estimate span{font-size:1.25rem;font-weight:600}.unavailable{font-size:1rem;color:#556275;line-height:1.7;margin:0}.caveat{font-size:.875rem;line-height:1.9;color:#556275;margin:1.5rem 0}@media(max-width:400px){main{margin-top:2.5rem}section{padding:1.25rem}}
</style></head><body><main><h1>ご注文からの待ち時間の目安</h1><section aria-labelledby="dine-in"><h2 id="dine-in">イートイン</h2>${value(estimates?.dineIn)}</section><section aria-labelledby="takeout"><h2 id="takeout">テイクアウト</h2>${value(estimates?.takeout)}</section><p class="caveat">お会計後の待ち時間の推定です。お並びになる時間は含んでおりません</p></main></body></html>`;
}
