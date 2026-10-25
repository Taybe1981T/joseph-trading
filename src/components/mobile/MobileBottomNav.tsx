import React from 'react';
import { Home, Briefcase, Settings, Zap, Package, Receipt, TrendingUp, Hand } from 'lucide-react';

export type MobileTab = 'home' | 'quotes' | 'positions' | 'trade' | 'settings' | 'profile' | 'analysis' | 'manual' | 'store' | 'clients' | 'transactions';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  isDeveloper: boolean;
  lang: 'en' | 'ar';
}

export function MobileBottomNav({ activeTab, onTabChange, isDeveloper: isDev, lang }: MobileBottomNavProps) {
  const isAr = lang === 'ar';
  // Desktop parity (App.tsx DEV_ONLY_PAGES + effectivePage):
  // - CLIENT sees ONLY: Home, Trade, Positions, Transactions, Settings.
  // - DEVELOPER sees everything: + Auto AI + Manual + Store + Clients.
  // Dev-only sections never render for clients (same guard as the site).
  const items: { id: MobileTab; label: string; icon: React.ElementType; dev?: boolean }[] = [
    { id: 'home', label: isAr ? 'الرئيسية' : 'Home', icon: Home },
    ...(isDev ? [{ id: 'analysis' as MobileTab, label: isAr ? 'تحليل تلقائي' : 'Auto AI', icon: Zap, dev: true }] : []),
    ...(isDev ? [{ id: 'manual' as MobileTab, label: isAr ? 'تحليل يدوي' : 'Manual', icon: Hand, dev: true }] : []),
    ...(isDev ? [{ id: 'store' as MobileTab, label: isAr ? 'المتجر' : 'Store', icon: Package, dev: true }] : []),
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