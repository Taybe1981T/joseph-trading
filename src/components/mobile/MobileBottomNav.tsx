import React from 'react';
import { Activity, Monitor, Clock, History, Settings } from 'lucide-react';

interface MobileBottomNavProps {
  activeTab: 'quotes' | 'trade' | 'history' | 'news' | 'settings';
  onTabChange: (tab: 'quotes' | 'trade' | 'history' | 'news' | 'settings') => void;
}

const NAV_ITEMS: { id: 'quotes' | 'trade' | 'history' | 'news' | 'settings'; label: string; icon: React.ElementType }[] = [
  { id: 'quotes', label: 'Quotes', icon: Activity },
  { id: 'trade', label: 'Trade', icon: Monitor },
  { id: 'history', label: 'History', icon: History },
  { id: 'news', label: 'News', icon: Clock },
  { id: 'settings', label: 'Settings', icon: Settings },
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
          <item.icon className="mt5-nav-icon" />
          <span className="mt5-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}