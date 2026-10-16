import React from 'react';
import { Menu, Search, User, Bell } from 'lucide-react';

interface MobileHeaderProps {
  title: string;
  onMenuClick?: () => void;
  onSearchClick?: () => void;
  onProfileClick?: () => void;
  onNotificationsClick?: () => void;
}

export function MobileHeader({
  title,
  onMenuClick,
  onSearchClick,
  onProfileClick,
  onNotificationsClick,
}: MobileHeaderProps) {
  return (
    <header className="mt5-header">
      <div className="mt5-header-title">{title}</div>
      <div className="mt5-header-actions">
        {onNotificationsClick && (
          <button className="mt5-icon-btn" onClick={onNotificationsClick} aria-label="Notifications">
            <Bell size={18} />
          </button>
        )}
        {onSearchClick && (
          <button className="mt5-icon-btn" onClick={onSearchClick} aria-label="Search">
            <Search size={18} />
          </button>
        )}
        {onProfileClick && (
          <button className="mt5-icon-btn" onClick={onProfileClick} aria-label="Profile">
            <User size={18} />
          </button>
        )}
        {onMenuClick && (
          <button className="mt5-icon-btn" onClick={onMenuClick} aria-label="Menu">
            <Menu size={20} />
          </button>
        )}
      </div>
    </header>
  );
}