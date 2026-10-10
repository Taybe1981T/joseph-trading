import { StrategySettings, MarketType, TradingStyle } from "./types";

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  momentumThreshold: 70,
  supplyDemandStrength: 80,
  useHigherTimeframe: true,
  useVolumeAnalysis: true,
  useNewsGuard: true,
  useIndicators: true,
  minConfidence: 45,
  minStrongConfidence: 70,
  minTrendAge: 2,
  minInfantAge: 10,
  minMatureAge: 25,
  maxMatureAge: 50,
  minPrePullbackAge: 15,
  maxPrePullbackAge: 50,
  primaryBBWeight: 15,
  primarySDWeight: 15,
  primaryAgeWeight: 10,
  primaryPrePullbackAgeWeight: 10,
  primaryNewsWeight: 10,
  supportRSIWeight: 5,
  supportEMAWeight: 5,
  supportDirWeight: 3,
  supportVolWeight: 2,
  supportMicroBBWeight: 3,
  supportMicroAlignWeight: 2,
  baseConfidence: 30,
  strongThreshold: 70,
  buyThreshold: 50,
  minStrongSupport: 50,
  minPullbackCandles: 2,
  pullbackVolConfirm: false,
  pullbackCandleConfirm: false,
  useFilterSideways: true,
  useCandleMatch: true,
  candleDirectionFilter: true,
  candleMatchDailyEnabled: true,
  candleMatchWeeklyEnabled: true,
  candleMatchMonthlyEnabled: true,
  useVolumeGuard: true,
  volumeGuardThreshold: 45,
  volumeGuardMaxThreshold: 85,
  // ── Pullback-entry system (defaults: minimize post-entry reversal) ──
  entryMode: 'pullback',   // 'pullback' waits for a retrace instead of chasing price
  stopAtrMultiplier: 3,    // wider, breathable stop (crypto always 3×)
  minPullbackAtr: 0.5,     // entry zone depth in ATR
  pullbackRsiConfirm: true, // deepen the zone to 1 ATR when RSI is stretched
  // ── Golden confidence window (surface only the best-timed entries) ──
  goldenRangeEnabled: true, // only show signals whose confidence is inside the golden window
  goldenConfMin: 70,        // below this → neutral (too weak)
  goldenConfMax: 85,        // above this → neutral (late-entry / chasing risk)
  // ── Trailing stop (dynamic, scales with lot size) ──
  trailingEnabled: true,    // master on/off (each TradeNowPage tick checks it)
  trailingBaseActivationUSD: 5,  // $ profit that arms the trail at the base lot 0.01
  trailingBaseStepUSD: 2,        // locked-profit step ($) at the base lot 0.01
  trailingActivationLotStep: 2,  // +$ activation for each extra 0.01 lot above 0.01
  trailingStepLotStep: 1,        // +$ step for each extra 0.01 lot above 0.01
};

export const DEFAULT_AUTO_SETTINGS = {
  isEnabled: false,
  interval: 15,
  timeframe: '1d',
  category: 'all',
  tradingStyle: TradingStyle.DAY_TRADING,
  volume: 0.8,
  showAllSignals: false,
};

export const SYMBOL_CATEGORIES = {
  forex: [
    'EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURNZD', 'EURCAD', 'EURCHF',
    'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'USDMXN',
    'GBPJPY', 'GBPAUD', 'GBPNZD', 'GBPCAD', 'GBPCHF',
    'AUDJPY', 'AUDNZD', 'AUDCAD', 'AUDCHF', 'NZDJPY', 'NZDCAD', 'NZDCHF',
    'CADJPY', 'CADCHF', 'CHFJPY'
  ],
  crypto: [
    'BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'XRPUSD', 'ADAUSD', 'AVAXUSD',
    'DOGEUSD', 'SHIBUSD', 'PEPEUSD', 'WIFUSD', 'BONKUSD',
    'DOTUSD', 'LINKUSD', 'MATICUSD', 'UNIUSD', 'LTCUSD', 'BCHUSD',
    'TONUSD', 'SUIUSD', 'NEARUSD', 'SEIUSD', 'OPUSD', 'ARBUSD'
  ],
  stocks: [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX',
    'AMD', 'INTC', 'TSM', 'ASML', 'ARM', 'SMCI',
    'CRM', 'PLTR', 'COIN', 'NOW',
    'JPM', 'BAC', 'V', 'MA',
    'JNJ', 'UNH', 'LLY', 'PFE',
    'WMT', 'MCD', 'NKE', 'DIS',
    'XOM', 'CVX', 'COP',
    'BA', 'CAT', 'GE',
    'BABA', 'NIO',
    'SPY', 'QQQ', 'US500', 'US30', 'US100',
    '7203.T', '6758.T', '8306.T', '9984.T', '7974.T',
    '7267.T', '9432.T', '6861.T', '6501.T', '8035.T',
    '7751.T', '6954.T', '6301.T', '5020.T', '9020.T',
    'ASML.AS', 'MC.PA', 'NESN.SW', 'SAP.DE', 'SHEL.L',
    'ULVR.L', 'ALV.DE', 'OR.PA', 'AZN.L', 'NVO',
    'ROG.SW', 'NOVO-B.CO', 'MBG.DE', 'BARC.L', 'BNP.PA',
  ],
  metals: [
    'XAUUSD', 'XAGUSD', 'XPTUSD', 'XCUUSD', 'XPDUSD', 'XALUSD',
  ]
};

// Regional symbol lookup used to auto-detect which exchange is currently open when
// analyzing the merged "stocks" category (radar scan + manual analysis).
export const STOCKS_BY_EXCHANGE: Record<string, string[]> = {
  us: [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX',
    'AMD', 'INTC', 'TSM', 'ASML', 'ARM', 'SMCI',
    'CRM', 'PLTR', 'COIN', 'NOW',
    'JPM', 'BAC', 'V', 'MA',
    'JNJ', 'UNH', 'LLY', 'PFE',
    'WMT', 'MCD', 'NKE', 'DIS',
    'XOM', 'CVX', 'COP',
    'BA', 'CAT', 'GE',
    'BABA', 'NIO',
    'SPY', 'QQQ', 'US500', 'US30', 'US100',
  ],
  jp: [
    '7203.T', '6758.T', '8306.T', '9984.T', '7974.T',
    '7267.T', '9432.T', '6861.T', '6501.T', '8035.T',
    '7751.T', '6954.T', '6301.T', '5020.T', '9020.T',
  ],
  eu: [
    'ASML.AS', 'MC.PA', 'NESN.SW', 'SAP.DE', 'SHEL.L',
    'ULVR.L', 'ALV.DE', 'OR.PA', 'AZN.L', 'NVO',
    'ROG.SW', 'NOVO-B.CO', 'MBG.DE', 'BARC.L', 'BNP.PA',
  ],
};

export const MARKET_CATEGORIES = [
  { id: MarketType.FOREX, icon: 'DollarSign' },
  { id: MarketType.CRYPTO, icon: 'Bitcoin' },
  { id: MarketType.STOCKS, icon: 'TrendingUp' },
  { id: MarketType.METALS, icon: 'Gem' }
];

export const DEFAULT_SUCCESS_SOUNDS = [
  { id: 'sharp_bell', url: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3', label: 'Sharp Bell' },
  { id: 'digital_ring', url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3', label: 'Digital Ring' },
  { id: 'digital_notice', url: 'https://assets.mixkit.co/active_storage/sfx/938/938-preview.mp3', label: 'Digital Notice' }
];

export const DEFAULT_FAIL_SOUNDS = [
  { id: 'clear_notice', url: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3', label: 'Clear Notice' },
  { id: 'soft_notice', url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', label: 'Soft Notice' },
  { id: 'alert', url: 'https://assets.mixkit.co/active_storage/sfx/431/431-preview.mp3', label: 'Alert' }
];

export const DEFAULT_COMPLETION_SOUNDS = [
  { id: 'completion_tone', url: 'https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3', label: 'Completion Tone' },
  { id: 'completion_bell', url: 'https://assets.mixkit.co/active_storage/sfx/270/270-preview.mp3', label: 'Soft Bell' },
  { id: 'completion_done', url: 'https://assets.mixkit.co/active_storage/sfx/1993/1993-preview.mp3', label: 'Done Chime' }
];

export const FREE_SYMBOLS: Record<string, string[]> = {
  forex: ['EURUSD', 'GBPUSD', 'USDJPY', 'EURJPY', 'GBPJPY'],
  crypto: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD'],
  stocks: [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA',
    '7203.T', '6758.T', '8306.T', '9984.T', '7974.T',
    'ASML.AS', 'MC.PA', 'SAP.DE', 'SHEL.L', 'NVO',
  ],
  metals: ['XAUUSD', 'XAGUSD', 'XPTUSD', 'XCUUSD', 'XPDUSD', 'XALUSD'],
};

export const TIMEFRAMES = [
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1h' },
  { id: '4h', label: '4h' },
  { id: '1d', label: '1d' },
  { id: '1w', label: '1w' },
  { id: '1M', label: '1M' },
  { id: '1Y', label: '1Y' },
];

export const TRADING_STYLES = [
  { id: 'scalping', label: 'scalping', icon: 'Zap' },
  { id: 'day_trading', label: 'day_trading', icon: 'Play' },
  { id: 'swing_trading', label: 'swing_trading', icon: 'Clock' },
];

export const SYMBOL_GROUPS: Record<string, { label: string, symbols: string[] }[]> = {
  forex: [
    { label: 'eurPairs', symbols: ['EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURNZD', 'EURCAD', 'EURCHF'] },
    { label: 'usdPairs', symbols: ['GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'USDMXN'] },
    { label: 'gbpPairs', symbols: ['GBPJPY', 'GBPAUD', 'GBPNZD', 'GBPCAD', 'GBPCHF'] },
    { label: 'audNzdPairs', symbols: ['AUDJPY', 'AUDNZD', 'AUDCAD', 'AUDCHF', 'NZDJPY', 'NZDCAD', 'NZDCHF'] },
    { label: 'chfCadPairs', symbols: ['CADJPY', 'CADCHF', 'CHFJPY'] },
  ],
  crypto: [
    { label: 'topCrypto', symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'XRPUSD', 'ADAUSD', 'AVAXUSD', 'TONUSD'] },
    { label: 'momentumCrypto', symbols: ['DOGEUSD', 'SHIBUSD', 'PEPEUSD', 'WIFUSD', 'BONKUSD'] },
    { label: 'altCrypto', symbols: ['DOTUSD', 'LINKUSD', 'MATICUSD', 'UNIUSD', 'LTCUSD', 'BCHUSD', 'SUIUSD', 'NEARUSD', 'SEIUSD'] },
    { label: 'layer2', symbols: ['OPUSD', 'ARBUSD', 'MATICUSD', 'IMXUSD'] },
  ],
  stocks: [
    { label: 'techStocks', symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX'] },
    { label: 'semiconductors', symbols: ['AMD', 'INTC', 'TSM', 'ASML', 'AVGO', 'QCOM', 'ARM', 'SMCI'] },
    { label: 'softwareCloud', symbols: ['CRM', 'PLTR', 'NOW', 'SNOW', 'COIN', 'DDOG', 'NET'] },
    { label: 'finance', symbols: ['JPM', 'BAC', 'V', 'MA', 'GS', 'MS', 'BLK'] },
    { label: 'healthcare', symbols: ['JNJ', 'UNH', 'LLY', 'PFE', 'ABBV', 'MRK'] },
    { label: 'consumer', symbols: ['WMT', 'MCD', 'NKE', 'DIS', 'COST', 'SBUX'] },
    { label: 'energy', symbols: ['XOM', 'CVX', 'COP', 'SLB'] },
    { label: 'chinese', symbols: ['BABA', 'NIO', 'JD', 'PDD'] },
    { label: 'indices', symbols: ['US500', 'US30', 'US100', 'UK100', 'DE40', 'JP225'] },
    { label: 'etfs', symbols: ['SPY', 'QQQ', 'DIA', 'GLD', 'SLV'] },
    { label: 'japaneseAuto', symbols: ['7203.T', '7267.T', '6758.T', '6902.T', '7201.T'] },
    { label: 'japaneseTech', symbols: ['9984.T', '6501.T', '6861.T', '8035.T', '6752.T'] },
    { label: 'japaneseFinance', symbols: ['8306.T', '8411.T', '8316.T', '7182.T'] },
    { label: 'japaneseConglomerate', symbols: ['8058.T', '8001.T', '8015.T', '9433.T'] },
    { label: 'europeanTech', symbols: ['ASML.AS', 'SAP.DE', 'NVO', 'SIE.DE', 'IFX.DE'] },
    { label: 'europeanLuxury', symbols: ['MC.PA', 'OR.PA', 'NESN.SW', 'ROG.SW', 'LVMH.PA'] },
    { label: 'ukStocks', symbols: ['SHEL.L', 'ULVR.L', 'AZN.L', 'BARC.L', 'BP.L', 'GSK.L', 'HSBA.L'] },
    { label: 'germanStocks', symbols: ['ALV.DE', 'MBG.DE', 'DBK.DE', 'ADS.DE', 'DHL.DE', 'BMW.DE'] },
    { label: 'frenchStocks', symbols: ['MC.PA', 'OR.PA', 'BNP.PA', 'TTE.PA', 'AIR.PA', 'SAN.PA'] },
    { label: 'scandinavian', symbols: ['NOVO-B.CO', 'NVO', 'ERIC-B.ST', 'VOLV-B.ST', 'SBAB'] },
  ],
  metals: [
    { label: 'preciousMetals', symbols: ['XAUUSD', 'XAGUSD', 'XPTUSD'] },
    { label: 'industrialMetals', symbols: ['XCUUSD', 'XPDUSD', 'XALUSD'] },
  ]
};

export const ALL_SYMBOLS_DB: Record<string, string[]> = {
  forex: [
    // Major Pairs
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
    // EUR Crosses
    'EURGBP', 'EURJPY', 'EURAUD', 'EURNZD', 'EURCAD', 'EURCHF',
    // GBP Crosses
    'GBPJPY', 'GBPAUD', 'GBPNZD', 'GBPCAD', 'GBPCHF',
    // AUD/NZD Crosses
    'AUDJPY', 'AUDNZD', 'AUDCAD', 'AUDCHF',
    'NZDJPY', 'NZDCAD', 'NZDCHF',
    // CAD/CHF Crosses
    'CADJPY', 'CADCHF', 'CHFJPY',
    // Exotics
    'USDMXN', 'USDZAR', 'USDTRY', 'USDSEK', 'USDNOK', 'USDDKK',
    'USDSGD', 'USDHKD', 'USDCNH', 'USDRUB', 'USDTHB', 'USDINR',
    'USDPLN', 'USDCZK', 'USDHUF', 'USDILS', 'USDKRW', 'USDTWD',
    'EURTRY', 'EURZAR', 'EURPLN', 'EURHUF', 'EURCZK', 'EURSEK', 'EURNOK', 'EURDKK',
    'GBPTRY', 'GBPZAR', 'GBPSEK', 'GBPNOK',
    'AUDSGD', 'NZDSGD', 'SGDJPY',
  ].sort(),
  crypto: [
    // Top 10 by Market Cap
    'BTCUSD', 'ETHUSD', 'BNBUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD', 'DOGEUSD', 'TRXUSD', 'AVAXUSD', 'DOTUSD',
    // DeFi
    'LINKUSD', 'UNIUSD', 'AAVEUSD', 'MKRUSD', 'SNXUSD', 'LDOUSD', 'COMPUSD', 'CRVUSD', 'SUSHIUSD', '1INCHUSD', 'PENDLEUSD',
    // Layer 2
    'MATICUSD', 'POLUSD', 'OPUSD', 'ARBUSD', 'IMXUSD', 'MANTUSD', 'STRKUSD', 'ZKUSD', 'STXUSD',
    // Layer 1
    'NEARUSD', 'ICPUSD', 'APTUSD', 'SUIUSD', 'INJUSD', 'SEIUSD', 'ATOMUSD', 'ALGOUSD', 'FTMUSD', 'HBARUSD', 'EOSUSD', 'TONUSD', 'KASUSD', 'KAVAUSD',
    // Meme
    'SHIBUSD', 'PEPEUSD', 'WIFUSD', 'BONKUSD', 'FLOKIUSD', 'MEMEUSD', 'JUPUSD',
    // Infrastructure & AI
    'RNDRUSD', 'FILUSD', 'THETAUSD', 'ARUSD', 'FETUSD', 'TAOUSD', 'OCEANUSD', 'WLDUSD',
    // Others
    'LTCUSD', 'BCHUSD', 'ETCUSD', 'XLMUSD', 'VETUSD', 'XMRUSD', 'ZECUSD', 'DASHUSD',
    'SANDUSD', 'MANAUSD', 'AXSUSD', 'GALAUSD', 'ENJUSD', 'CHZUSD',
  ].sort(),
  stocks: [
    // US Tech Giants (FAANG+)
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX',
    // US Semiconductors
    'AMD', 'INTC', 'QCOM', 'AVGO', 'MU', 'MRVL', 'LRCX', 'KLAC', 'AMAT', 'TSM', 'ASML', 'ARM', 'SMCI',
    // US Software & Cloud
    'CRM', 'ADBE', 'ORCL', 'NOW', 'SNOW', 'PLTR', 'UBER', 'SQ', 'SHOP', 'COIN', 'DDOG', 'NET', 'ZS',
    // US AI & Growth
    'APP', 'MSTR', 'CRWD', 'PANW', 'SOFI', 'DKNG', 'RBLX',
    // US Finance
    'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'BLK', 'SCHW', 'AXP', 'V', 'MA', 'PYPL',
    // US Healthcare
    'JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN', 'GILD', 'MRNA', 'ISRG',
    // US Consumer & Retail
    'WMT', 'COST', 'HD', 'LOW', 'TGT', 'SBUX', 'MCD', 'NKE', 'DIS', 'PG', 'KO', 'PEP', 'LULU',
    // US Energy
    'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'OXY', 'DVN',
    // US Industrial & Defense
    'BA', 'CAT', 'HON', 'GE', 'LMT', 'RTX', 'NOC', 'MMM', 'DE', 'UPS', 'FDX',
    // US Telecom
    'T', 'VZ', 'TMUS', 'CSCO',
    // US EV
    'RIVN', 'LCID',
    // Social Media
    'SNAP', 'PINS',
    // Chinese Tech
    'BABA', 'JD', 'PDD', 'BIDU', 'NIO', 'LI', 'XPEV',
    // European
    'SAP', 'NVO', 'SHEL', 'TTE', 'BP', 'AZN', 'LVMUY', 'SIEGY',
    // Japanese (local listings)
    '7203.T', '6758.T', '8306.T', '9984.T', '7974.T', '7267.T', '9432.T', '6861.T', '6501.T', '8035.T',
    '7751.T', '6954.T', '6301.T', '5020.T', '9020.T', 'JP225',
    'TM', 'SONY', 'NTDOY',
    // European (local listings)
    'ASML.AS', 'MC.PA', 'NESN.SW', 'SAP.DE', 'SHEL.L', 'ULVR.L', 'ALV.DE', 'OR.PA', 'AZN.L', 'NVO',
    'ROG.SW', 'NOVO-B.CO', 'MBG.DE', 'BARC.L', 'BNP.PA', 'TTE.PA', 'BP.L', 'DBK.DE', 'IFX.DE', 'ADS.DE',
    'UK100', 'DE40',
    // ETFs
    'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'ARKK', 'XLF', 'XLK', 'XLE', 'XLV', 'GLD', 'SLV', 'USO',
    // Indices (CFD)
    'US500', 'US30', 'US100', 'UK100', 'DE40', 'JP225', 'HK50', 'AU200',
  ].sort(),
  metals: [
    'XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD', 'XCUUSD', 'XALUSD',
  ].sort()
};
