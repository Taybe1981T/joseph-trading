// Popular TradingView symbols database for search suggestions
export interface SuggestedSymbol {
  symbol: string;      // short display: TSLA
  tv: string;          // full TradingView: NASDAQ:TSLA
  name: string;        // Tesla Inc
  cat: 'forex' | 'crypto' | 'stocks' | 'metals' | 'indices';
}

const S = (symbol: string, tv: string, name: string, cat: SuggestedSymbol['cat']): SuggestedSymbol =>
  ({ symbol, tv, name, cat });

export const SYMBOL_DB: SuggestedSymbol[] = [
  // ---------- Crypto ----------
  S('BTCUSD', 'BINANCE:BTCUSDT', 'Bitcoin / Dollar', 'crypto'),
  S('ETHUSD', 'BINANCE:ETHUSDT', 'Ethereum / Dollar', 'crypto'),
  S('SOLUSD', 'BINANCE:SOLUSDT', 'Solana / Dollar', 'crypto'),
  S('BNBUSD', 'BINANCE:BNBUSDT', 'BNB / Dollar', 'crypto'),
  S('XRPUSD', 'BINANCE:XRPUSDT', 'Ripple / Dollar', 'crypto'),
  S('ADAUSD', 'BINANCE:ADAUSDT', 'Cardano / Dollar', 'crypto'),
  S('DOGEUSD', 'BINANCE:DOGEUSDT', 'Dogecoin / Dollar', 'crypto'),
  S('AVAXUSD', 'BINANCE:AVAXUSDT', 'Avalanche / Dollar', 'crypto'),
  S('DOTUSD', 'BINANCE:DOTUSDT', 'Polkadot / Dollar', 'crypto'),
  S('LINKUSD', 'BINANCE:LINKUSDT', 'Chainlink / Dollar', 'crypto'),
  S('MATICUSD', 'BINANCE:MATICUSDT', 'Polygon / Dollar', 'crypto'),
  S('TONUSD', 'BINANCE:TONUSDT', 'Toncoin / Dollar', 'crypto'),
  S('SHIBUSD', 'BINANCE:SHIBUSDT', 'Shiba Inu / Dollar', 'crypto'),
  S('LTCUSD', 'BINANCE:LTCUSDT', 'Litecoin / Dollar', 'crypto'),
  S('BCHUSD', 'BINANCE:BCHUSDT', 'Bitcoin Cash / Dollar', 'crypto'),
  S('UNIUSD', 'BINANCE:UNIUSDT', 'Uniswap / Dollar', 'crypto'),
  S('ATOMUSD', 'BINANCE:ATOMUSDT', 'Cosmos / Dollar', 'crypto'),
  S('NEARUSD', 'BINANCE:NEARUSDT', 'NEAR Protocol / Dollar', 'crypto'),
  S('APTUSD', 'BINANCE:APTUSDT', 'Aptos / Dollar', 'crypto'),
  S('ARBUSD', 'BINANCE:ARBUSDT', 'Arbitrum / Dollar', 'crypto'),
  S('OPUSD', 'BINANCE:OPUSDT', 'Optimism / Dollar', 'crypto'),
  S('SUIUSD', 'BINANCE:SUIUSDT', 'Sui / Dollar', 'crypto'),
  S('PEPEUSD', 'BINANCE:PEPEUSDT', 'Pepe / Dollar', 'crypto'),
  S('WIFUSD', 'BINANCE:WIFUSDT', 'dogwifhat / Dollar', 'crypto'),
  S('TRXUSD', 'BINANCE:TRXUSDT', 'Tron / Dollar', 'crypto'),

  // ---------- Forex ----------
  S('EURUSD', 'FX:EURUSD', 'Euro / US Dollar', 'forex'),
  S('GBPUSD', 'FX:GBPUSD', 'British Pound / US Dollar', 'forex'),
  S('USDJPY', 'FX:USDJPY', 'US Dollar / Japanese Yen', 'forex'),
  S('USDCHF', 'FX:USDCHF', 'US Dollar / Swiss Franc', 'forex'),
  S('USDCAD', 'FX:USDCAD', 'US Dollar / Canadian Dollar', 'forex'),
  S('AUDUSD', 'FX:AUDUSD', 'Australian Dollar / US Dollar', 'forex'),
  S('NZDUSD', 'FX:NZDUSD', 'New Zealand Dollar / US Dollar', 'forex'),
  S('EURJPY', 'FX:EURJPY', 'Euro / Japanese Yen', 'forex'),
  S('GBPJPY', 'FX:GBPJPY', 'British Pound / Japanese Yen', 'forex'),
  S('EURGBP', 'FX:EURGBP', 'Euro / British Pound', 'forex'),
  S('AUDJPY', 'FX:AUDJPY', 'Australian Dollar / Japanese Yen', 'forex'),
  S('CADJPY', 'FX:CADJPY', 'Canadian Dollar / Japanese Yen', 'forex'),
  S('CHFJPY', 'FX:CHFJPY', 'Swiss Franc / Japanese Yen', 'forex'),
  S('NZDJPY', 'FX:NZDJPY', 'New Zealand Dollar / Japanese Yen', 'forex'),
  S('EURAUD', 'FX:EURAUD', 'Euro / Australian Dollar', 'forex'),
  S('EURCAD', 'FX:EURCAD', 'Euro / Canadian Dollar', 'forex'),
  S('EURCHF', 'FX:EURCHF', 'Euro / Swiss Franc', 'forex'),
  S('GBPAUD', 'FX:GBPAUD', 'British Pound / Australian Dollar', 'forex'),
  S('GBPCAD', 'FX:GBPCAD', 'British Pound / Canadian Dollar', 'forex'),
  S('GBPCHF', 'FX:GBPCHF', 'British Pound / Swiss Franc', 'forex'),
  S('AUDCAD', 'FX:AUDCAD', 'Australian Dollar / Canadian Dollar', 'forex'),
  S('AUDCHF', 'FX:AUDCHF', 'Australian Dollar / Swiss Franc', 'forex'),
  S('CADCHF', 'FX:CADCHF', 'Canadian Dollar / Swiss Franc', 'forex'),
  S('USDMXN', 'FX_IDC:USDMXN', 'US Dollar / Mexican Peso', 'forex'),
  S('USDTRY', 'FX_IDC:USDTRY', 'US Dollar / Turkish Lira', 'forex'),
  S('USDZAR', 'FX_IDC:USDZAR', 'US Dollar / South African Rand', 'forex'),

  // ---------- Metals & Commodities ----------
  S('XAUUSD', 'OANDA:XAUUSD', 'Gold Spot / US Dollar', 'metals'),
  S('XAGUSD', 'OANDA:XAGUSD', 'Silver Spot / US Dollar', 'metals'),
  S('XPTUSD', 'OANDA:XPTUSD', 'Platinum Spot / US Dollar', 'metals'),
  S('XPDUSD', 'OANDA:XPDUSD', 'Palladium Spot / US Dollar', 'metals'),
  S('XCUUSD', 'COMEX:HG1!', 'Copper Futures', 'metals'),
  S('XALUSD', 'COMEX:ALI1!', 'Aluminum Futures', 'metals'),
  S('WTIUSD', 'TVC:USOIL', 'Crude Oil WTI', 'metals'),
  S('BRENTUSD', 'TVC:UKOIL', 'Brent Oil', 'metals'),
  S('NATGAS', 'NYMEX:NG1!', 'Natural Gas Futures', 'metals'),

  // ---------- Indices ----------
  S('US500', 'SP:SPX', 'S&P 500 Index', 'indices'),
  S('US30', 'DJ:DJI', 'Dow Jones Industrial Average', 'indices'),
  S('US100', 'NASDAQ:NDX', 'Nasdaq 100 Index', 'indices'),
  S('NAS100', 'NASDAQ:NDX', 'Nasdaq 100 Index', 'indices'),
  S('DE40', 'XETR:DAX', 'DAX Index (Germany)', 'indices'),
  S('UK100', 'FTSE:UKX', 'FTSE 100 Index (UK)', 'indices'),
  S('JP225', 'TVC:NI225', 'Nikkei 225 (Japan)', 'indices'),
  S('VIX', 'TVC:VIX', 'Volatility Index', 'indices'),

  // ---------- Stocks: Tech ----------
  S('AAPL', 'NASDAQ:AAPL', 'Apple Inc.', 'stocks'),
  S('MSFT', 'NASDAQ:MSFT', 'Microsoft Corporation', 'stocks'),
  S('GOOGL', 'NASDAQ:GOOGL', 'Alphabet Inc. (Google)', 'stocks'),
  S('AMZN', 'NASDAQ:AMZN', 'Amazon.com Inc.', 'stocks'),
  S('NVDA', 'NASDAQ:NVDA', 'NVIDIA Corporation', 'stocks'),
  S('META', 'NASDAQ:META', 'Meta Platforms (Facebook)', 'stocks'),
  S('TSLA', 'NASDAQ:TSLA', 'Tesla Inc.', 'stocks'),
  S('NFLX', 'NASDAQ:NFLX', 'Netflix Inc.', 'stocks'),
  S('AMD', 'NASDAQ:AMD', 'Advanced Micro Devices', 'stocks'),
  S('INTC', 'NASDAQ:INTC', 'Intel Corporation', 'stocks'),
  S('CRM', 'NYSE:CRM', 'Salesforce Inc.', 'stocks'),
  S('ORCL', 'NYSE:ORCL', 'Oracle Corporation', 'stocks'),
  S('PLTR', 'NASDAQ:PLTR', 'Palantir Technologies', 'stocks'),
  S('COIN', 'NASDAQ:COIN', 'Coinbase Global', 'stocks'),
  S('SMCI', 'NASDAQ:SMCI', 'Super Micro Computer', 'stocks'),
  S('ARM', 'NASDAQ:ARM', 'Arm Holdings', 'stocks'),
  S('ASML', 'NASDAQ:ASML', 'ASML Holding', 'stocks'),
  S('TSM', 'NYSE:TSM', 'Taiwan Semiconductor', 'stocks'),

  // ---------- Stocks: Finance ----------
  S('JPM', 'NYSE:JPM', 'JPMorgan Chase & Co.', 'stocks'),
  S('BAC', 'NYSE:BAC', 'Bank of America', 'stocks'),
  S('V', 'NYSE:V', 'Visa Inc.', 'stocks'),
  S('MA', 'NYSE:MA', 'Mastercard Inc.', 'stocks'),
  S('GS', 'NYSE:GS', 'Goldman Sachs Group', 'stocks'),
  S('BRK.B', 'NYSE:BRK.B', 'Berkshire Hathaway', 'stocks'),

  // ---------- Stocks: Consumer ----------
  S('WMT', 'NYSE:WMT', 'Walmart Inc.', 'stocks'),
  S('MCD', 'NYSE:MCD', 'McDonald\u2019s Corporation', 'stocks'),
  S('NKE', 'NYSE:NKE', 'Nike Inc.', 'stocks'),
  S('DIS', 'NYSE:DIS', 'Walt Disney Company', 'stocks'),
  S('KO', 'NYSE:KO', 'Coca-Cola Company', 'stocks'),
  S('PEP', 'NASDAQ:PEP', 'PepsiCo Inc.', 'stocks'),
  S('SBUX', 'NASDAQ:SBUX', 'Starbucks Corporation', 'stocks'),

  // ---------- Stocks: Energy / Industrial ----------
  S('XOM', 'NYSE:XOM', 'Exxon Mobil Corporation', 'stocks'),
  S('CVX', 'NYSE:CVX', 'Chevron Corporation', 'stocks'),
  S('BA', 'NYSE:BA', 'Boeing Company', 'stocks'),
  S('CAT', 'NYSE:CAT', 'Caterpillar Inc.', 'stocks'),
  S('GE', 'NYSE:GE', 'General Electric', 'stocks'),

  // ---------- Stocks: Health ----------
  S('JNJ', 'NYSE:JNJ', 'Johnson & Johnson', 'stocks'),
  S('PFE', 'NYSE:PFE', 'Pfizer Inc.', 'stocks'),
  S('LLY', 'NYSE:LLY', 'Eli Lilly and Company', 'stocks'),
  S('UNH', 'NYSE:UNH', 'UnitedHealth Group', 'stocks'),

  // ---------- Stocks: China / EV ----------
  S('BABA', 'NYSE:BABA', 'Alibaba Group', 'stocks'),
  S('NIO', 'NYSE:NIO', 'NIO Inc.', 'stocks'),
];

const CAT_EMOJI: Record<SuggestedSymbol['cat'], string> = {
  forex: '\uD83D\uDCB1',
  crypto: '\uD83E\uDDF1',
  stocks: '\uD83D\uDCC8',
  metals: '\uD83D\uDC8E',
  indices: '\uD83D\uDCCA',
};

export function searchSymbols(queryStr: string, limit = 8): SuggestedSymbol[] {
  const q = queryStr.trim().toUpperCase();
  if (!q) return [];
  const startsWith: SuggestedSymbol[] = [];
  const includesName: SuggestedSymbol[] = [];
  const includesSym: SuggestedSymbol[] = [];

  for (const s of SYMBOL_DB) {
    if (s.symbol === q) return [s];
    if (s.symbol.startsWith(q)) startsWith.push(s);
    else if (s.name.toUpperCase().startsWith(q) || s.name.toUpperCase().includes(` ${q}`)) includesName.push(s);
    else if (s.symbol.includes(q)) includesSym.push(s);
  }

  const dbResults = [...startsWith, ...includesName, ...includesSym].slice(0, limit);

  // If query looks like a full TV symbol (e.g., NYSE:JNJ) or no results, allow adding directly
  if (q.includes(':') || (dbResults.length === 0 && q.length >= 2)) {
    const shortSym = q.includes(':') ? q.split(':')[1] : q;
    const tvSym = q.includes(':') ? q : `NYSE:${q}`;
    const exists = dbResults.some((s) => s.symbol === shortSym);
    if (!exists) {
      dbResults.unshift({
        symbol: shortSym,
        tv: tvSym,
        name: q.includes(':') ? `${q.split(':')[0]} Exchange` : 'TradingView Symbol',
        cat: 'stocks' as const,
      });
    }
  }

  return dbResults.slice(0, limit);
}

export function catEmoji(cat: SuggestedSymbol['cat']): string {
  return CAT_EMOJI[cat] || '\uD83D\uDCC8';
}
