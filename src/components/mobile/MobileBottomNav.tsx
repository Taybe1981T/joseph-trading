import React from 'react';
import { Home, Briefcase, Settings, Zap, Package, Receipt, TrendingUp, Hand } from 'lucide-react';

export type MobileTab = 'home' | 'quotes' | 'positions' | 'trade' | 'settings' | 'analysis' | 'manual' | 'store' | 'clients' | 'transactions';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  isDeveloper: boolean;
  lang: 'en' | 'ar';
}

export function MobileBottomNav({ activeTab, onTabChange, isDeveloper: isDev, lang }: MobileBottomNavProps) {
  const isAr = lang === 'ar';
  // Order requested by clients (exact copy of the original site's sections):
  // Home → Auto Analysis (+settings) → Manual Analysis (+settings) → Store (+settings)
  // → Transactions → Trading Platform → Open Positions → General Settings
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