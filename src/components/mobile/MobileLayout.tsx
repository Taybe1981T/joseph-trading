import React, { useState, useEffect } from 'react';
import { Activity, Monitor, Clock, History, Settings, Search, Menu, User, Bell } from 'lucide-react';
import { MobileHeader } from './MobileHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileSymbolList } from './MobileSymbolList';
import { MobileTradeDialog } from './MobileTradeDialog';

interface MobileLayoutProps {
  children?: React.ReactNode;
}

export function MobileLayout({ children }: MobileLayoutProps) {
  const [activeTab, setActiveTab] = useState<'quotes' | 'trade' | 'history' | 'news' | 'settings'>('quotes');
  const [tradeDialog, setTradeDialog] = useState<{ symbol: string; bid: number; ask: number } | null>(null);
  const [signalAlert, setSignalAlert] = useState<{ symbol: string; type: string } | null>(null);

  const [symbols] = useState<{ symbol: string; category: string; bid: number; ask: number; change: number; changePercent: number }[]>([
    { symbol: 'BTCUSD', category: 'Crypto', bid: 67240.50, ask: 67245.20, change: 1250.30, changePercent: 1.89 },
    { symbol: 'ETHUSD', category: 'Crypto', bid: 3450.20, ask: 3451.40, change: -45.20, changePercent: -1.29 },
    { symbol: 'XAUUSD', category: 'Metals', bid: 2650.15, ask: 2650.45, change: 8.75, changePercent: 0.33 },
    { symbol: 'EURUSD', category: 'Forex', bid: 1.0852, ask: 1.0854, change: -0.0012, changePercent: -0.11 },
    { symbol: 'GBPUSD', category: 'Forex', bid: 1.2654, ask: 1.2657, change: 0.0023, changePercent: 0.18 },
    { symbol: 'USDJPY', category: 'Forex', bid: 149.85, ask: 149.88, change: -0.12, changePercent: -0.08 },
  ]);

  const handleSymbolSelect = (symbol: string) => {
    const s = symbols.find(x => x.symbol === symbol);
    if (s) {
      setTradeDialog({ symbol: s.symbol, bid: s.bid, ask: s.ask });
    }
  };

  const handleOpenTrade = (type: 'buy' | 'sell', volume: number) => {
    const d = tradeDialog;
    if (!d) return;
    console.log(`[MobileTrade] Opening ${type} ${d.symbol} volume ${volume} at ${type === 'buy' ? d.ask : d.bid}`);
    setSignalAlert({ symbol: d.symbol, type: type === 'buy' ? 'strong_buy' : 'strong_sell' });
    setTradeDialog(null);
  };

  const handleCloseDialog = () => setTradeDialog(null);

  const handleNewSignal = (symbol: string, type: string) => {
    setSignalAlert({ symbol, type });
    setTimeout(() => setSignalAlert(null), 8000);
  };

  useEffect(() => {
    const t = setTimeout(() => handleNewSignal('BTCUSD', 'strong_buy'), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mobile-only" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <MobileHeader
        onMenuClick={() => setActiveTab('settings')}
        onSearchClick={() => {}}
        onProfileClick={() => setActiveTab('settings')}
        onNotificationsClick={() => {}}
      />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'quotes' && (
          <div className="mt5-page-container">
            {children}
            <MobileSymbolList symbols={symbols} onSelect={handleSymbolSelect} />
          </div>
        )}
        {activeTab === 'trade' && (
          <div className="mt5-page-container">
            <div className="mt5-empty-state">
              <div className="mt5-empty-icon">💱</div>
              <div>Select a symbol from Quotes to open a trade</div>
            </div>
          </div>
        )}
        {activeTab === 'history' && (
          <div className="mt5-page-container">
            <div className="mt5-empty-state">
              <div className="mt5-empty-icon">📜</div>
              <div>No previous trades</div>
            </div>
          </div>
        )}
        {activeTab === 'news' && (
          <div className="mt5-page-container">
            <div className="mt5-empty-state">
              <div className="mt5-empty-icon">📰</div>
              <div>No news available</div>
            </div>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="mt5-page-container">
            <div className="mt5-empty-state">
              <div className="mt5-empty-icon">⚙️</div>
              <div>App settings</div>
            </div>
          </div>
        )}
      </div>

      <MobileBottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      {tradeDialog && (
        <MobileTradeDialog
          symbol={tradeDialog.symbol}
          bid={tradeDialog.bid}
          ask={tradeDialog.ask}
          onOpen={handleOpenTrade}
          onClose={handleCloseDialog}
        />
      )}

      {signalAlert && (
        <div className="mt5-signal-alert">
          🚀 New signal: {signalAlert.symbol} — {signalAlert.type}
        </div>
      )}
    </div>
  );
}