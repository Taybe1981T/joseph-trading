/**
 * Analysis-data symbol aliases.
 *
 * The UI/chart layer keeps the symbols users recognise (e.g. ROG.SW is mapped
 * to TradingView's SWX:ROG), but the OHLC/quote providers do not all know those
 * tickers. Yahoo, for example, returns 404 for ROG.SW while the valid Roche
 * ticker is ROP.SW. A 404 used to send the engine through every retry/proxy
 * chain and made the 7th EU stock appear to hang for minutes.
 *
 * These aliases apply ONLY to data fetching. Displayed symbols, saved signals,
 * trade tickets and chart widgets are untouched.
 */
export const ANALYSIS_SYMBOL_ALIASES: Record<string, string> = {
  'ROG.SW': 'ROP.SW',     // Roche Holding AG (SIX)
  'LVMH.PA': 'MC.PA',     // LVMH (Euronext Paris)
  'SBAB': 'SBB-B.ST',     // Swedish listed real-estate group (unlisted "SBAB" returned 404)
};

/** Raised when a provider confirms the ticker itself does not exist. */
export class AnalysisSymbolNotFoundError extends Error {
  constructor(symbol: string) {
    super(`Symbol not found: ${symbol}`);
    this.name = 'AnalysisSymbolNotFoundError';
  }
}

/** Resolve a user-facing symbol to the ticker the data providers understand. */
export function resolveAnalysisSymbol(symbol: string): string {
  const key = String(symbol || '').trim().toUpperCase();
  return ANALYSIS_SYMBOL_ALIASES[key] || key;
}

/** EU-listed stocks use their local YAHOO suffix. Fast-fail scope only. */
export function isEuropeanStockSymbol(symbol: string): boolean {
  return /\.(AS|PA|SW|DE|L|CO|MI|ST|HE)$/i.test(String(symbol || '').trim());
}
