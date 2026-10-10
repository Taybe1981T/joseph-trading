export enum MarketType {
  FOREX = "forex",
  CRYPTO = "crypto",
  STOCKS = "stocks",
  METALS = "metals",
}

export enum TradingStyle {
  SCALPING = "scalping",
  DAY_TRADING = "day_trading",
  SWING_TRADING = "swing_trading",
}

export enum SignalType {
  STRONG_BUY = "strong_buy",
  BUY = "buy",
  NEUTRAL = "neutral",
  SELL = "sell",
  STRONG_SELL = "strong_sell",
  NO_ENTRY = "no_entry",
}

export interface AnalysisResult {
  id?: string;
  symbol: string;
  type: MarketType;
  timeframe: string;
  signal: SignalType;
  confidence: number; // New field for percentage
  summary: string;
  detailedReasons?: { check: string; value: string; status: string; impact: string; source?: string }[];
  newsSources?: string[];
  technicalScore: number;
  sentimentScore: number;
  historicalMatch?: string;
  trendMaturity?: 'infancy' | 'youth' | 'mature' | 'aging' | 'unknown';
  trendAge?: number; // Number of candles
  microTF?: string;
  microSignal?: 'pullback' | 'aligned' | 'unknown';
  microTrend?: string;
  timestamp: string;
  userId: string;
  stopLoss?: number;
  takeProfit?: number;
  primaryMetCount?: number;
  direction?: string;
  entryPrice?: number;
  entryMode?: 'market' | 'pullback';
  // Pullback-READY gate (backward confirmation): in 'pullback' entry mode the
  // signal is only surfaced to the box once the retrace has actually completed.
  pullbackReadyForEntry?: boolean;
  isSideways?: boolean;
  sidewaysDirection?: 'uptrend' | 'downtrend' | 'sideways';
  adx?: number;
  adxDirection?: string;
  maAlignment?: string;
  volumeQuality?: number;
  volumeQualityThreshold?: number;
  volumeQualityMaxThreshold?: number;
  volumeAbsorbed?: boolean;
}

export interface UserPreference {
  userId: string;
  watchlist: string[];
  theme: 'light' | 'dark';
}

export interface StrategySettings {
  momentumThreshold: number;
  supplyDemandStrength: number;
  useHigherTimeframe: boolean;
  useVolumeAnalysis: boolean;
  useNewsGuard: boolean;
  useIndicators: boolean;
  minConfidence: number;
  minStrongConfidence: number;
  minTrendAge: number;
  minInfantAge: number;
  minMatureAge: number;
  maxMatureAge: number;
  minPrePullbackAge: number;
  maxPrePullbackAge: number;
  primaryBBWeight: number;
  primarySDWeight: number;
  primaryAgeWeight: number;
  primaryPrePullbackAgeWeight: number;
  primaryNewsWeight: number;
  supportRSIWeight: number;
  supportEMAWeight: number;
  supportDirWeight: number;
  supportVolWeight: number;
  supportMicroBBWeight: number;
  supportMicroAlignWeight: number;
  baseConfidence: number;
  strongThreshold: number;
  buyThreshold: number;
  minStrongSupport: number;
  minPullbackCandles: number;
  pullbackVolConfirm: boolean;
  pullbackCandleConfirm: boolean;
  maxPrimaryWeight?: number;
  maxSupportingWeight?: number;
  microTimeframe?: string;
  useFilterSideways?: boolean;
  useCandleMatch?: boolean;
  candleDirectionFilter?: boolean;
  candleMatchDailyEnabled?: boolean;
  candleMatchWeeklyEnabled?: boolean;
  candleMatchMonthlyEnabled?: boolean;
  candleMatchDailyThreshold?: number;
  candleMatchWeeklyThreshold?: number;
  candleMatchMonthlyThreshold?: number;
  useVolumeGuard?: boolean;
  volumeGuardThreshold?: number;
  volumeGuardMaxThreshold?: number;
  // ── Pullback-entry system (minimize post-entry reversal) ──
  entryMode?: 'market' | 'pullback';   // 'pullback' enters below/above price instead of chasing
  stopAtrMultiplier?: number;          // ATR multiple for the stop-loss (default 3)
  minPullbackAtr?: number;             // pullback-zone depth in ATR (default 0.5)
  pullbackRsiConfirm?: boolean;        // deepen the zone to 1 ATR when RSI is stretched
  // ── Golden confidence window (surface only the best-timed entries) ──
  goldenRangeEnabled?: boolean;        // when true, only signals inside [goldenConfMin..goldenConfMax] are shown
  goldenConfMin?: number;              // lower edge of the golden window (default 70) — below → neutral
  goldenConfMax?: number;              // upper edge of the golden window (default 85) — above → neutral (chasing risk)
  // ── Trailing stop (dynamic, scales with lot size) ──
  trailingEnabled?: boolean;           // master on/off for the trailing stop (default true)
  trailingBaseActivationUSD?: number;  // profit ($) that activates the trail at lot 0.01 (default 5)
  trailingBaseStepUSD?: number;        // trailing step ($) at lot 0.01 (default 2)
  trailingActivationLotStep?: number;  // extra activation ($) per +0.01 lot above 0.01 (default 2)
  trailingStepLotStep?: number;        // extra step ($) per +0.01 lot above 0.01 (default 1)
}

export interface AutoAnalysisSettings {
  isEnabled: boolean;
  interval: number; // in minutes
  timeframe: string;
  category: string;
  tradingStyle: TradingStyle;
  volume: number; // 0 to 1
  showAllSignals: boolean;
  lastFinishedAt?: number;
  successSound?: string;
  failSound?: string;
  completionSound?: string;
  forceRestart?: boolean;
}

