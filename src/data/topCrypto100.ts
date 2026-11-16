// 100 best-known / most-traded crypto pairs (USDT quoted on Binance).
//
// This is the ONLY curated crypto list. It feeds the manual trader, both
// analysis engines and both platforms, so a symbol can never appear in one
// place and be missing in another. Any other Binance pair (or any TradingView
// symbol) can still be added manually — see `lib/customSymbols.ts`.
//
// Curated for recognition + liquidity: the majors first, then the most famous
// large/alt coins that are actively traded on Binance spot. Delisted or
// renamed tickers (e.g. EOS → A, FTM → S) are intentionally excluded.

export interface TopCryptoSymbol {
  symbol: string; // app symbol, e.g. BTCUSD
  name: string;   // display name
}

export const TOP_CRYPTO_100: TopCryptoSymbol[] = [
  // ── Majors ──
  { symbol: 'BTCUSD', name: 'Bitcoin' },
  { symbol: 'ETHUSD', name: 'Ethereum' },
  { symbol: 'SOLUSD', name: 'Solana' },
  { symbol: 'XRPUSD', name: 'XRP' },
  { symbol: 'BNBUSD', name: 'BNB' },
  { symbol: 'DOGEUSD', name: 'Dogecoin' },
  { symbol: 'ADAUSD', name: 'Cardano' },
  { symbol: 'TRXUSD', name: 'TRON' },
  { symbol: 'LINKUSD', name: 'ChainLink' },
  { symbol: 'AVAXUSD', name: 'Avalanche' },
  // ── Large caps ──
  { symbol: 'SUIUSD', name: 'Sui' },
  { symbol: 'LTCUSD', name: 'Litecoin' },
  { symbol: 'BCHUSD', name: 'Bitcoin Cash' },
  { symbol: 'XLMUSD', name: 'Stellar Lumens' },
  { symbol: 'DOTUSD', name: 'Polkadot' },
  { symbol: 'TONUSD', name: 'Toncoin' },
  { symbol: 'SHIBUSD', name: 'SHIBA INU' },
  { symbol: 'UNIUSD', name: 'Uniswap' },
  { symbol: 'PEPEUSD', name: 'Pepe' },
  { symbol: 'NEARUSD', name: 'NEAR Protocol' },
  // ── Smart-contract / layer 1 ──
  { symbol: 'APTUSD', name: 'Aptos' },
  { symbol: 'ICPUSD', name: 'Internet Computer' },
  { symbol: 'HBARUSD', name: 'Hedera Hashgraph' },
  { symbol: 'FILUSD', name: 'Filecoin' },
  { symbol: 'ARBUSD', name: 'Arbitrum' },
  { symbol: 'OPUSD', name: 'Optimism' },
  { symbol: 'ATOMUSD', name: 'Cosmos' },
  { symbol: 'ETCUSD', name: 'Ethereum Classic' },
  { symbol: 'INJUSD', name: 'Injective' },
  { symbol: 'STXUSD', name: 'Stacks' },
  // ── Infrastructure / DeFi ──
  { symbol: 'IMXUSD', name: 'Immutable' },
  { symbol: 'RENDERUSD', name: 'Render' },
  { symbol: 'GRTUSD', name: 'The Graph' },
  { symbol: 'AAVEUSD', name: 'Aave' },
  { symbol: 'ALGOUSD', name: 'Algorand' },
  { symbol: 'VETUSD', name: 'VeChain' },
  { symbol: 'SANDUSD', name: 'The Sandbox' },
  { symbol: 'MANAUSD', name: 'Decentraland' },
  { symbol: 'AXSUSD', name: 'Axie Infinity' },
  { symbol: 'SUSHIUSD', name: 'SushiSwap' },
  // ── Established alts ──
  { symbol: 'THETAUSD', name: 'Theta Network' },
  { symbol: 'KAVAUSD', name: 'Kava' },
  { symbol: 'RUNEUSD', name: 'THORChain' },
  { symbol: 'CAKEUSD', name: 'PancakeSwap' },
  { symbol: 'CRVUSD', name: 'Curve' },
  { symbol: 'LDOUSD', name: 'Lido DAO' },
  { symbol: 'SNXUSD', name: 'Synthetix' },
  { symbol: 'COMPUSD', name: 'Compound' },
  { symbol: 'ZECUSD', name: 'Zcash' },
  { symbol: 'DASHUSD', name: 'Dash' },
  // ── Payments / legacy ──
  { symbol: 'NEOUSD', name: 'Neo' },
  { symbol: 'IOTAUSD', name: 'IOTA' },
  { symbol: 'EGLDUSD', name: 'MultiversX' },
  { symbol: 'FLOWUSD', name: 'Flow' },
  { symbol: 'ONEUSD', name: 'Harmony' },
  { symbol: 'ZILUSD', name: 'Zilliqa' },
  { symbol: 'HOTUSD', name: 'Holo' },
  { symbol: 'BATUSD', name: 'Basic Attention Token' },
  { symbol: 'ENJUSD', name: 'Enjin' },
  { symbol: 'CHZUSD', name: 'Chiliz' },
  // ── Gaming / metaverse ──
  { symbol: 'APEUSD', name: 'ApeCoin' },
  { symbol: 'GALAUSD', name: 'Gala' },
  { symbol: 'SUSD', name: 'Sonic' },
  { symbol: 'SEIUSD', name: 'Sei' },
  { symbol: 'TIAUSD', name: 'Celestia' },
  { symbol: 'JUPUSD', name: 'Jupiter' },
  { symbol: 'PYTHUSD', name: 'Pyth Network' },
  { symbol: 'WLDUSD', name: 'Worldcoin' },
  { symbol: 'FETUSD', name: 'Artificial Superintelligence Alliance' },
  { symbol: 'TAOUSD', name: 'Bittensor' },
  // ── Real-world / newer majors ──
  { symbol: 'ONDOUSD', name: 'Ondo' },
  { symbol: 'ENAUSD', name: 'Ethena' },
  { symbol: 'PENDLEUSD', name: 'Pendle' },
  { symbol: 'JTOUSD', name: 'JITO' },
  { symbol: 'STRKUSD', name: 'Starknet Token' },
  { symbol: 'ZKUSD', name: 'zkSync' },
  { symbol: 'EIGENUSD', name: 'EigenLayer' },
  { symbol: 'WUSD', name: 'Wormhole' },
  { symbol: 'BONKUSD', name: 'Bonk' },
  { symbol: 'WIFUSD', name: 'Dogwifhat' },
  // ── Meme / community ──
  { symbol: 'FLOKIUSD', name: 'Floki' },
  { symbol: 'ORDIUSD', name: 'ORDI' },
  { symbol: 'NOTUSD', name: 'Notcoin' },
  { symbol: 'DOGSUSD', name: 'Dogs' },
  { symbol: 'BOMEUSD', name: 'BOOK OF MEME' },
  { symbol: 'PENGUUSD', name: 'Pudgy Penguins' },
  { symbol: 'TRUMPUSD', name: 'OFFICIAL TRUMP' },
  { symbol: 'VIRTUALUSD', name: 'Virtuals Protocol' },
  { symbol: 'AEROUSD', name: 'Aerodrome' },
  { symbol: 'RAYUSD', name: 'Raydium' },
  // ── High-volume recent listings ──
  { symbol: 'MORPHOUSD', name: 'Morpho Token' },
  { symbol: 'MEGAUSD', name: 'MEGA' },
  { symbol: 'HYPEUSD', name: 'Hyperliquid' },
  { symbol: 'ASTERUSD', name: 'Aster' },
  { symbol: 'XPLUSD', name: 'Plasma' },
  { symbol: 'PUMPUSD', name: 'Pump.Fun' },
  { symbol: 'WBTCUSD', name: 'Wrapped Bitcoin' },
  { symbol: 'ETHFIUSD', name: 'ether.fi' },
  { symbol: 'WLFIUSD', name: 'World Liberty Financial' },
  { symbol: 'LUNCUSD', name: 'Terra Classic' },
];

/** Flat app-symbol list used by pickers, groups and the DB. */
export const TOP_CRYPTO_SYMBOLS: string[] = TOP_CRYPTO_100.map((s) => s.symbol);

/** Backwards-compatible alias (older code imported TOP_CRYPTO_150). */
export const TOP_CRYPTO_150 = TOP_CRYPTO_100;
