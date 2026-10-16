import React from 'react';
import { Home, List, Briefcase, PlusCircle, Settings } from 'lucide-react';

export type MobileTab = 'home' | 'quotes' | 'positions' | 'trade' | 'settings';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const NAV_ITEMS: { id: MobileTab; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'quotes', label: 'Quotes', icon: List },
  { id: 'positions', label: 'Trade', icon: Briefcase },
  { id: 'trade', label: 'New', icon: PlusCircle },
  { id: 'settings', label: 'Setup', icon: Settings },
];

export function MobileBottomNav({ activeTab, onTabChange }: MobileBottomNavProps) {
  return (
    <nav className="mt5-bottom-nav" role="navigation" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`mt5-nav-item ${activeTab === item.id ? 'active' : ''}`}
          onClick={() => onTabChange(item.id)}
          aria-pressed={activeTab === item.id}
        >
          <item.icon className="mt5-nav-icon" size={24} />
          <span className="mt5-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}