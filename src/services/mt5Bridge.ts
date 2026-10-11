// ── MT5 Bridge client ──────────────────────────────────────────────────────
// Talks to the self-hosted Python bridge (bridge/bridge.py) that runs on your
// own machine (or a VPS) and executes real orders on MetaTrader 5.
// Default is OFF: the site keeps its paper trading until the user connects a
// bridge and explicitly switches execution to "Real MT5".
//
// Security: the broker password is sent only to YOUR bridge over HTTPS, per
// request, and is never stored in Firestore or any cloud database.

export interface MT5Connection {
  bridgeUrl: string;      // e.g. https://abc-def-123.trycloudflare.com
  bridgeSecret: string;   // must match BRIDGE_SECRET on the bridge
  login: number;          // MT5 account number
  password: string;       // broker password (kept in this browser only)
  server: string;         // e.g. XMGlobal-Demo, ICMarketsSC-Demo
  mode: 'demo' | 'live';
}

const LS_KEY = 'finalyze_mt5_conn';

export function loadConnection(): MT5Connection | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && o.bridgeUrl && o.bridgeSecret && o.login && o.server) return o as MT5Connection;
    return null;
  } catch { return null; }
}

export function saveConnection(c: MT5Connection): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}

export function clearConnection(): void {
  try { localStorage.removeItem(LS_KEY); } catch {}
}

async function post(conn: MT5Connection, path: string, body: any) {
  const url = conn.bridgeUrl.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bridge-secret': conn.bridgeSecret,
    },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function creds(conn: MT5Connection) {
  return { login: conn.login, password: conn.password, server: conn.server };
}

export interface BridgeAccount {
  login: number; balance: number; equity: number; margin: number;
  free_margin: number; currency: string; leverage: number;
  name: string; server: string; company: string;
}

export interface BridgePosition {
  ticket: number; symbol: string; volume: number; type: 'buy' | 'sell';
  open_price: number; sl: number; tp: number; profit: number;
  swap: number; magic: number;
}

export const mt5Bridge = {
  async health(conn: MT5Connection): Promise<{ ok: boolean; terminal_connected: boolean }> {
    const url = conn.bridgeUrl.replace(/\/$/, '') + '/health';
    const res = await fetch(url);
    return res.json();
  },

  async account(conn: MT5Connection): Promise<BridgeAccount> {
    return post(conn, '/account', creds(conn));
  },

  async positions(conn: MT5Connection): Promise<BridgePosition[]> {
    const r = await post(conn, '/positions', creds(conn));
    return r.positions || [];
  },

  async buy(conn: MT5Connection, o: { symbol: string; volume: number; sl?: number | null; tp?: number | null }) {
    return post(conn, '/trade', { ...creds(conn), side: 'buy', ...o });
  },

  async sell(conn: MT5Connection, o: { symbol: string; volume: number; sl?: number | null; tp?: number | null }) {
    return post(conn, '/trade', { ...creds(conn), side: 'sell', ...o });
  },

  async modify(conn: MT5Connection, ticket: number, o: { sl?: number | null; tp?: number | null }) {
    return post(conn, '/modify', { ...creds(conn), ticket, ...o });
  },

  async close(conn: MT5Connection, ticket: number) {
    return post(conn, '/close', { ...creds(conn), ticket });
  },

  async closeAll(conn: MT5Connection) {
    return post(conn, '/close_all', creds(conn));
  },
};
