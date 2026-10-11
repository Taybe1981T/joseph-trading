"""
============================================================================
 Joseph.Trading — MT5 Bridge (جسر مجاني بين موقعك ومنصة MetaTrader 5)
============================================================================
 • يعمل على جهازك (ويندوز) الذي يعمل عليه MT5 سطح المكتب.
 • يستخدم الحزمة الرسمية المجانية من MetaQuotes: MetaTrader5
 • يفتح منافذ REST محلية؛ ترفعها للإنترنت عبر Cloudflare Tunnel (مجاني).
 • كل نداء يجب أن يحمل ترويسة السر:  x-bridge-secret: <BRIDGE_SECRET>

 التشغيل:
   1) pip install -r requirements.txt
   2) عرّف المفتاح:   set BRIDGE_SECRET=اكتب_مفتاحا_طويلا_عشوائيا   (CMD)
   3) python bridge.py
   4) cloudflared tunnel --url http://localhost:8799
      => انسخ الرابط الدائم وضعه في موقعك.

 الأمان: كلمة مرور الوسيط تُستقبل من موقعك (HTTPS) وتُستخدم للجلسة فقط،
 لا تُخزَّن هنا. الحساب الحقيقي = مسؤوليتك؛ ابدأ بديمو.
============================================================================
"""
import os
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from typing import Optional

try:
    import MetaTrader5 as mt5
except Exception as e:  # pragma: no cover
    mt5 = None
    _IMPORT_ERR = str(e)

BRIDGE_SECRET = os.environ.get("BRIDGE_SECRET", "change-me-please")
app = FastAPI(title="Joseph.Trading MT5 Bridge")


def _auth(secret):
    if secret != BRIDGE_SECRET:
        raise HTTPException(status_code=401, detail="invalid bridge secret")


class Creds(BaseModel):
    login: int
    password: str
    server: str

class OrderReq(Creds):
    symbol: str
    side: str            # 'buy' | 'sell'
    volume: float
    sl: Optional[float] = None
    tp: Optional[float] = None
    deviation: int = 20
    magic: int = 123456
    comment: str = "joseph-trading"

class TicketReq(Creds):
    ticket: int
    sl: Optional[float] = None
    tp: Optional[float] = None

class CloseReq(Creds):
    ticket: int


def _ensure_mt5():
    if mt5 is None:
        raise HTTPException(status_code=500, detail="MetaTrader5 not installed: " + str(_IMPORT_ERR))
    if not mt5.initialize():
        raise HTTPException(status_code=500, detail="MT5 initialize failed: " + str(mt5.last_error()))

def _login(c):
    _ensure_mt5()
    if not mt5.login(int(c.login), password=c.password, server=c.server):
        code, desc = mt5.last_error()
        raise HTTPException(status_code=401, detail="MT5 login failed: %s %s" % (code, desc))

def _resolve_symbol(name):
    for cand in (name, name + "m", name + ".a", name + "pro", name + "c", name + "_"):
        info = mt5.symbol_info(cand)
        if info is not None:
            if not info.visible:
                mt5.symbol_select(cand, True)
            return cand
    return name

def _norm_volume(symbol, volume):
    info = mt5.symbol_info(symbol)
    if not info:
        return round(volume, 2)
    vmin, vstep, vmax = info.volume_min, info.volume_step, info.volume_max
    v = max(vmin, min(vmax, volume))
    v = round(round(v / vstep) * vstep, 4)
    return max(v, vmin)

def _filling_mode(symbol):
    info = mt5.symbol_info(symbol)
    if not info:
        return mt5.ORDER_FILLING_IOC
    fm = info.filling_mode
    if fm & 1:
        return mt5.ORDER_FILLING_IOC
    if fm & 2:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


@app.get("/health")
def health():
    ok = mt5 is not None and mt5.initialize() and mt5.version() is not None
    term = bool(mt5.terminal_info()) if mt5 else False
    return {"ok": bool(ok), "terminal_connected": term, "mt5_installed": mt5 is not None}


@app.post("/account")
def account(c: Creds, x_bridge_secret: Optional[str] = Header(None)):
    _auth(x_bridge_secret)
    _login(c)
    ai = mt5.account_info()
    if ai is None:
        raise HTTPException(status_code=502, detail="no account info")
    return {"login": ai.login, "balance": ai.balance, "equity": ai.equity,
            "margin": ai.margin, "free_margin": ai.margin_free,
            "currency": ai.currency, "leverage": ai.leverage,
            "name": ai.name, "server": ai.server, "company": ai.company}


@app.post("/positions")
def positions(c: Creds, x_bridge_secret: Optional[str] = Header(None)):
    _auth(x_bridge_secret)
    _login(c)
    out = []
    for p in mt5.positions_get() or []:
        out.append({"ticket": p.ticket, "symbol": p.symbol, "volume": p.volume,
                    "type": "buy" if p.type == 0 else "sell",
                    "open_price": p.price_open, "sl": p.sl, "tp": p.tp,
                    "profit": p.profit, "swap": p.swap, "magic": p.magic})
    return {"positions": out}


@app.post("/trade")
def trade(o: OrderReq, x_bridge_secret: Optional[str] = Header(None)):
    _auth(x_bridge_secret)
    _login(o)
    sym = _resolve_symbol(o.symbol)
    tick = mt5.symbol_info_tick(sym)
    if tick is None:
        raise HTTPException(status_code=400, detail="no tick for " + sym)
    is_buy = o.side.lower() == "buy"
    price = tick.ask if is_buy else tick.bid
    order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
    request = {
        "action": mt5.TRADE_ACTION_DEAL, "symbol": sym,
        "volume": _norm_volume(sym, o.volume), "type": order_type, "price": price,
        "sl": float(o.sl) if o.sl else 0.0, "tp": float(o.tp) if o.tp else 0.0,
        "deviation": o.deviation, "magic": o.magic, "comment": o.comment,
        "type_time": mt5.ORDER_TIME_GTC, "type_filling": _filling_mode(sym),
    }
    result = mt5.order_send(request)
    if result is None:
        raise HTTPException(status_code=502, detail="order_send none: " + str(mt5.last_error()))
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return {"ok": False, "retcode": result.retcode, "comment": result.comment}
    return {"ok": True, "ticket": result.order, "deal": result.deal,
            "price": result.price, "volume": result.volume, "symbol": sym}


@app.post("/modify")
def modify(r: TicketReq, x_bridge_secret: Optional[str] = Header(None)):
    _auth(x_bridge_secret)
    _login(r)
    pos = mt5.positions_get(ticket=r.ticket)
    if not pos:
        raise HTTPException(status_code=404, detail="position not found")
    p = pos[0]
    request = {"action": mt5.TRADE_ACTION_SLTP, "symbol": p.symbol, "position": r.ticket,
               "sl": float(r.sl) if r.sl is not None else p.sl,
               "tp": float(r.tp) if r.tp is not None else p.tp}
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        return {"ok": False, "retcode": getattr(result, "retcode", None),
                "comment": getattr(result, "comment", str(mt5.last_error()))}
    return {"ok": True}


@app.post("/close")
def close(r: CloseReq, x_bridge_secret: Optional[str] = Header(None)):
    _auth(x_bridge_secret)
    _login(r)
    pos = mt5.positions_get(ticket=r.ticket)
    if not pos:
        raise HTTPException(status_code=404, detail="position not found")
    p = pos[0]
    sym = _resolve_symbol(p.symbol)
    tick = mt5.symbol_info_tick(sym)
    is_buy = (p.type == 0)
    price = tick.bid if is_buy else tick.ask
    request = {"action": mt5.TRADE_ACTION_DEAL, "symbol": sym, "volume": p.volume,
               "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
               "position": r.ticket, "price": price, "deviation": 20, "magic": p.magic,
               "comment": "close", "type_time": mt5.ORDER_TIME_GTC,
               "type_filling": _filling_mode(sym)}
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        return {"ok": False, "retcode": getattr(result, "retcode", None),
                "comment": getattr(result, "comment", str(mt5.last_error()))}
    return {"ok": True}


@app.post("/close_all")
def close_all(c: Creds, x_bridge_secret: Optional[str] = Header(None)):
    _auth(x_bridge_secret)
    _login(c)
    closed, failed = [], []
    for p in mt5.positions_get() or []:
        sym = _resolve_symbol(p.symbol)
        tick = mt5.symbol_info_tick(sym)
        is_buy = (p.type == 0)
        price = tick.bid if is_buy else tick.ask
        req = {"action": mt5.TRADE_ACTION_DEAL, "symbol": sym, "volume": p.volume,
               "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
               "position": p.ticket, "price": price, "deviation": 20, "magic": p.magic,
               "comment": "kill-switch", "type_time": mt5.ORDER_TIME_GTC,
               "type_filling": _filling_mode(sym)}
        res = mt5.order_send(req)
        (closed if (res and res.retcode == mt5.TRADE_RETCODE_DONE) else failed).append(p.ticket)
    return {"closed": closed, "failed": failed}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8799)

