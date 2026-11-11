import React from 'react';
import { Home, Briefcase, Settings, Zap, Package, Receipt, TrendingUp, Hand } from 'lucide-react';

export type MobileTab = 'home' | 'quotes' | 'positions' | 'trade' | 'settings' | 'profile' | 'analysis' | 'manual' | 'store' | 'clients' | 'transactions';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  isDeveloper: boolean;
  /** A paid-plan client (paid mode) may use the same analysis tools as a developer. */
  hasPlan?: boolean;
  lang: 'en' | 'ar';
}

export function MobileBottomNav({ activeTab, onTabChange, isDeveloper: isDev, hasPlan = false, lang }: MobileBottomNavProps) {
  const isAr = lang === 'ar';
  // Desktop parity (App.tsx DEV_ONLY_PAGES + effectivePage):
  // - CLIENT sees: Home, Trade, Positions, Transactions, Store, Settings.
  // - CLIENT WITH A PAID PLAN also gets Auto AI + Manual (isPlanClient).
  // - DEVELOPER sees everything: + Clients.
  // The Store is for EVERYONE (a client buys plans/products there, exactly like
  // on the desktop site).
  const canAnalyze = isDev || hasPlan;
  const items: { id: MobileTab; label: string; icon: React.ElementType; dev?: boolean }[] = [
    { id: 'home', label: isAr ? 'الرئيسية' : 'Home', icon: Home },
    ...(canAnalyze ? [{ id: 'analysis' as MobileTab, label: isAr ? 'تحليل تلقائي' : 'Auto AI', icon: Zap }] : []),
    ...(canAnalyze ? [{ id: 'manual' as MobileTab, label: isAr ? 'تحليل يدوي' : 'Manual', icon: Hand }] : []),
    { id: 'store', label: isAr ? 'المتجر' : 'Store', icon: Package },
    { id: 'transactions', label: isAr ? 'معاملات' : 'Tx', icon: Receipt },
    { id: 'trade', label: isAr ? 'تداول' : 'Trade', icon: TrendingUp },
    { id: 'positions', label: isAr ? 'صفقات' : 'Positions', icon: Briefcase },
    { id: 'settings', label: isAr ? 'إعدادات' : 'Setup', icon: Settings },
  ];
  return (
    <nav className="mt5-bottom-nav" role="navigation" aria-label="Main navigation">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mt5-nav-item ${activeTab === item.id ? 'active' : ''}`}
          onClick={() => onTabChange(item.id)}
          aria-pressed={activeTab === item.id}
          style={item.dev ? { color: activeTab === item.id ? '#F59E0B' : '#a16207' } : undefined}
        >
          <item.icon className="mt5-nav-icon" size={22} />
          <span className="mt5-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}