import React from 'react';
import { Home, List, Briefcase, PlusCircle, Settings, Zap, Users } from 'lucide-react';

export type MobileTab = 'home' | 'quotes' | 'positions' | 'trade' | 'settings' | 'analysis' | 'clients';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  isDeveloper: boolean;
  lang: 'en' | 'ar';
}

export function MobileBottomNav({ activeTab, onTabChange, isDeveloper, lang }: MobileBottomNavProps) {
  const isAr = lang === 'ar';
  const items: { id: MobileTab; label: string; icon: React.ElementType; dev?: boolean }[] = [
    { id: 'home', label: isAr ? 'الرئيسية' : 'Home', icon: Home },
    { id: 'quotes', label: isAr ? 'الرموز' : 'Quotes', icon: List },
    ...(isDeveloper ? [{ id: 'analysis' as MobileTab, label: isAr ? 'التحليل' : 'AI', icon: Zap, dev: true }] : []),
    ...(isDeveloper ? [{ id: 'clients' as MobileTab, label: isAr ? 'العملاء' : 'Clients', icon: Users, dev: true }] : []),
    { id: 'positions', label: isAr ? 'صفقات' : 'Trade', icon: Briefcase },
    { id: 'trade', label: isAr ? 'جديد' : 'New', icon: PlusCircle },
    { id: 'settings', label: isAr ? 'إعداد' : 'Setup', icon: Settings },
  ];
  return (
    <nav className="mt5-bottom-nav" role="navigation" aria-label="Main navigation">
      {items.map((item) => (
        <button
          key={item.id}
          className={`mt5-nav-item ${activeTab === item.id ? 'active' : ''}`}
          onClick={() => onTabChange(item.id)}
          aria-pressed={activeTab === item.id}
          style={item.dev ? { color: activeTab === item.id ? '#F59E0B' : '#a16207' } : undefined}
        >
          <item.icon className="mt5-nav-icon" size={24} />
          <span className="mt5-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}