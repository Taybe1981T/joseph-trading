import React, { useState, useMemo } from 'react';
import { Calculator, Minus, Plus } from 'lucide-react';
import { getInstrumentConfig } from '../../lib/positionMath';
import { Language } from '../../lib/i18n';

interface Props {
  symbol: string;
  stopLoss: number;
  takeProfit: number;
  entryPrice?: number;
  lang: Language;
  balance: number;
  onPickLot: (lot: number) => void;
}

export function MobileLotCalc({ symbol, stopLoss, takeProfit, entryPrice, lang, balance, onPickLot }: Props) {
  const isAr = lang === 'ar';
  const cfg = getInstrumentConfig(symbol);
  const entry = entryPrice || (stopLoss + takeProfit) / 2;
  const [lot, setLot] = useState(0.01);
  const step = lot >= 1 ? 0.1 : lot >= 0.1 ? 0.05 : 0.01;
  const calc = useMemo(() => {
    const slD = Math.abs(entry - stopLoss);
    const tpD = Math.abs(entry - takeProfit);
    const slP = slD / cfg.pipSize;
    const tpP = tpD / cfg.pipSize;
    const pv = cfg.pipValuePerLotUSD * lot;
    const slU = slP * pv;
    const tpU = tpP * pv;
    const risk = balance > 0 ? (slU / balance) * 100 : 0;
    const lvl = risk <= 1 ? 'safe' : risk <= 3 ? 'ok' : risk <= 5 ? 'warn' : 'danger';
    return { slP, tpP, slU, tpU, risk, lvl, rr: slU > 0 ? tpU / slU : 0 };
  }, [entry, stopLoss, takeProfit, lot, balance, cfg]);
  const lvlColor = calc.lvl === 'safe' ? '#00ff88' : calc.lvl === 'ok' ? '#a3e635' : calc.lvl === 'warn' ? '#F59E0B' : '#ff5555';
  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
        <Calculator size={15} style={{ color: '#F59E0B' }} />
        {isAr ? 'حاسبة اللوت' : 'Lot Calculator'}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>{cfg.pipLabel} {cfg.pipSize}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={() => setLot((v) => Math.max(0.01, +(v - step).toFixed(2)))}
          style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #2a2a2a', background: '#1a1a1a', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Minus size={15} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 900 }}>{lot.toFixed(2)}</div>
        <button onClick={() => setLot((v) => Math.min(100, +(v + step).toFixed(2)))}
          style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #2a2a2a', background: '#1a1a1a', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Plus size={15} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: 12, fontWeight: 700 }}>
        <span style={{ color: '#ff5555' }}>SL ${calc.slU.toFixed(2)}</span>
        <span style={{ color: '#00ff88' }}>TP ${calc.tpU.toFixed(2)}</span>
        <span style={{ marginLeft: 'auto' }}>R:R <b>{calc.rr.toFixed(1)}</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, fontWeight: 700 }}>
        <span style={{ color: '#aaa' }}>{isAr ? 'المخاطرة' : 'Risk'} {calc.risk.toFixed(2)}%</span>
        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, background: lvlColor + '22', color: lvlColor, border: '1px solid ' + lvlColor + '55' }}>
          {calc.lvl === 'safe' ? (isAr ? 'آمن' : 'Safe') : calc.lvl === 'ok' ? 'OK' : calc.lvl === 'warn' ? (isAr ? 'حذر' : 'Caution') : (isAr ? 'خطير' : 'Danger')}
        </span>
        <button onClick={() => onPickLot(lot)}
          style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: 'none', background: '#F59E0B', color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          {isAr ? 'استخدام' : 'Use'}
        </button>
      </div>
    </div>
  );
}