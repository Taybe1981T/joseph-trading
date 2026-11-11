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

interface NavItem {
  id: MobileTab;
  label: string;
  icon: React.ElementType;
  /** New tool shown to a paid CLIENT (yellow so it stands out as newly unlocked). */
  highlight?: boolean;
  /** Store: enlarged, French-flag blue, always in the middle of the bar. */
  store?: boolean;
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
  // Yellow "NEW" highlight belongs to the CLIENT only: a developer account must
  // never change what clients see, so the developer keeps the normal colours.
  const highlightNewTools = !isDev && hasPlan;
  const baseItems: NavItem[] = [
    { id: 'home', label: isAr ? 'الرئيسية' : 'Home', icon: Home },
    ...(canAnalyze ? [{ id: 'analysis' as MobileTab, label: isAr ? 'تحليل تلقائي' : 'Auto AI', icon: Zap, highlight: highlightNewTools }] : []),
    ...(canAnalyze ? [{ id: 'manual' as MobileTab, label: isAr ? 'تحليل يدوي' : 'Manual', icon: Hand, highlight: highlightNewTools }] : []),
    { id: 'transactions', label: isAr ? 'معاملات' : 'Tx', icon: Receipt },
    { id: 'trade', label: isAr ? 'تداول' : 'Trade', icon: TrendingUp },
    { id: 'positions', label: isAr ? 'صفقات' : 'Positions', icon: Briefcase },
    { id: 'settings', label: isAr ? 'إعدادات' : 'Setup', icon: Settings },
  ];
  // Insert the Store exactly in the middle of the bar (large blue button).
  const storeItem: NavItem = { id: 'store', label: isAr ? 'المتجر' : 'Store', icon: Package, store: true };
  const mid = Math.ceil(baseItems.length / 2);
  const leftItems = baseItems.slice(0, mid);
  const rightItems = baseItems.slice(mid);

  const renderItem = (item: NavItem) => (
    <button
      key={item.id}
      type="button"
      className={`mt5-nav-item ${activeTab === item.id ? 'active' : ''} ${item.highlight ? 'mt5-nav-new' : ''} ${item.store ? 'mt5-nav-store' : ''}`}
      onClick={() => onTabChange(item.id)}
      aria-pressed={activeTab === item.id}
    >
      {item.store ? (
        <span className="mt5-nav-store-badge">
          <item.icon className="mt5-nav-icon" size={24} />
        </span>
      ) : (
        <span className="mt5-nav-icon-wrap">
          <item.icon className="mt5-nav-icon" size={item.highlight ? 24 : 22} />
          {item.highlight && <span className="mt5-nav-dot" aria-hidden="true" />}
        </span>
      )}
      <span className="mt5-nav-label">{item.label}</span>
    </button>
  );

  // Two equal sides around a fixed centre slot: the Store is always dead-centre
  // no matter how many tools the account has (guest / client / developer).
  return (
    <nav className="mt5-bottom-nav" role="navigation" aria-label="Main navigation">
      <div className="mt5-nav-side">{leftItems.map(renderItem)}</div>
      <div className="mt5-nav-center">{renderItem(storeItem)}</div>
      <div className="mt5-nav-side">{rightItems.map(renderItem)}</div>
    </nav>
  );
}
