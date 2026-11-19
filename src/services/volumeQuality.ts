/**
 * Pure volume-quality scorer used by the signal engine.
 * Kept in its own module so it can be unit-tested without booting the engine.
 */
export function computeVolumeQuality(
  closes: number[], highs: number[], lows: number[], volumes: number[], opens: number[], direction: string,
  ignoreZeroVolume = false,
  useCompletedVolume = false
): { score: number; detected: boolean; absorbed: boolean; absorptionLevel: number; reasons: string[] } {
  const len = closes.length;
  const v = volumes || [];
  const base = { score: 0, detected: false, absorbed: false, absorptionLevel: 0, reasons: [] as string[] };
  // No volume data (some feeds return OHLC only) → neutral pass, do not interfere.
  // FX daily bars carry an all-zero placeholder volume; those zeros must not be
  // scored as real volume because a 27-46 score suppresses every FX signal.
  if (!v.length || v.length < 8 || len < 10 || (ignoreZeroVolume && v.every((x) => !x))) return base;

  // The feed's last candle is still forming, so its volume is partial. Comparing
  // a partial day against completed days always yields volRatio < 0.6 → a fixed
  // ~23/100 that silently blocks every signal. For categories whose feed behaves
  // this way (crypto), score volume from the last COMPLETED candle instead.
  // Price/OHLC still come from the live candle — only the volume sample shifts.
  const volIdx = useCompletedVolume && len >= 2 ? len - 2 : len - 1;
  const lastVol = v[volIdx] || 0;
  const prevVols = v.slice(Math.max(0, volIdx - 5), volIdx).filter((x: any) => x != null);
  const avgPrevVol = prevVols.length ? prevVols.reduce((a: number, b: number) => a + b, 0) / prevVols.length : 1;
  const volRatio = avgPrevVol > 0 ? lastVol / avgPrevVol : 1;

  // ── Module 1: Relative volume (0-25) ──
  const relScore = Math.max(0, Math.min(25, ((volRatio - 0.8) / 1.7) * 25));

  // ── Module 2: Effort vs Result (0-25) ──
  const body = Math.abs((closes[len - 1] || 0) - (opens[len - 1] || closes[len - 1] || 0));
  const range = ((highs[len - 1] || 0) - (lows[len - 1] || 0)) || 1;
  const bodyRatio = Math.max(0, Math.min(1, body / range));
  let effortScore = 12.5;
  if (volRatio > 1.2) {
    if (bodyRatio >= 0.6) effortScore = 25;
    else if (bodyRatio >= 0.4) effortScore = 18;
    else if (bodyRatio >= 0.25) effortScore = 8;
    else effortScore = 2;
  } else {
    effortScore = bodyRatio >= 0.5 ? 15 : 10;
  }

  // ── Module 3: Volume trend (0-20) ──
  const window = Math.max(3, Math.min(5, Math.floor(len / 2)));
  const recentV = v.slice(-window);
  const earlierV = v.slice(-window * 2, -window);
  const recentAvg = recentV.length ? recentV.reduce((a: number, b: number) => a + b, 0) / recentV.length : 1;
  const earlierAvg = earlierV.length ? earlierV.reduce((a: number, b: number) => a + b, 0) / earlierV.length : 1;
  const volRising = recentAvg > earlierAvg * 1.1;
  const priceChange = (closes[len - 1] || 0) - (closes[len - 1 - window] || closes[len - 1] || 0);
  const priceUp = priceChange > 0;
  let trendScore = 10;
  if (direction === 'uptrend') trendScore = volRising ? 20 : (priceUp ? 14 : 8);
  else if (direction === 'downtrend') trendScore = volRising ? 20 : (priceUp ? 6 : 12);
  else trendScore = 10;

  // ── Module 4: S/R pivot interaction (0-20) ──
  const back = Math.max(4, Math.min(10, len - 2));
  let swingHigh = -Infinity, swingLow = Infinity;
  for (let i = len - back; i < len - 1; i++) {
    if (highs[i] > swingHigh) swingHigh = highs[i];
    if (lows[i] < swingLow) swingLow = lows[i];
  }
  const lastClose = closes[len - 1] || 0;
  const lastHigh = highs[len - 1] || lastClose;
  const lastLow = lows[len - 1] || lastClose;
  let srScore = 12;
  const brokeHigh = isFinite(swingHigh) && lastClose > swingHigh;
  const brokeLow = isFinite(swingLow) && lastClose < swingLow;
  const wickAbove = isFinite(swingHigh) && lastHigh > swingHigh && lastClose <= swingHigh;
  const wickBelow = isFinite(swingLow) && lastLow < swingLow && lastClose >= swingLow;
  if (brokeHigh || brokeLow) srScore = volRatio > 1.3 ? 20 : 14;
  else if (wickAbove || wickBelow) srScore = volRatio > 1.3 ? 4 : 8;
  else srScore = 12;

  // ── Module 5: Absorption penalty (-30..0) ──
  let absorptionLevel = 0;
  if (volRatio > 1.6 && bodyRatio < 0.3) {
    absorptionLevel = Math.max(absorptionLevel, 2);
    base.reasons.push('high volume + small body = absorption/climax');
  }
  if (volRatio > 1.4 && ((wickAbove && direction === 'uptrend') || (wickBelow && direction === 'downtrend'))) {
    absorptionLevel = Math.max(absorptionLevel, 2);
    base.reasons.push('rejection at pivot against direction on elevated volume');
  }
  if (volRatio > 2.5 && len >= 20) {
    const follow = closes.slice(-3, -1).filter((c: any) => c != null);
    const flatFollow = follow.length > 0 && follow.every((c: number) => lastClose > 0 && Math.abs(c - lastClose) / lastClose < 0.002);
    if (flatFollow) { absorptionLevel = Math.max(absorptionLevel, 2); base.reasons.push('huge volume spike, no price follow-through'); }
  }
  if (volRatio < 0.6 && len >= 20) {
    absorptionLevel = Math.max(absorptionLevel, 1);
    base.reasons.push('very low volume — weak conviction');
  }
  const absorptionPenalty = absorptionLevel >= 2 ? -30 : absorptionLevel === 1 ? -10 : 0;

  const score = Math.max(0, Math.min(100, Math.round(relScore + effortScore + trendScore + srScore + absorptionPenalty)));
  return { score, detected: true, absorbed: absorptionLevel >= 2, absorptionLevel, reasons: base.reasons };
}
