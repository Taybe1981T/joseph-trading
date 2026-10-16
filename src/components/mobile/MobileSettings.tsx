import React from 'react';
import { Bell, Volume2, Globe, Shield, LogOut, RefreshCw } from 'lucide-react';

interface MobileSettingsProps {
  autoTradeEnabled: boolean;
  soundEnabled: boolean;
  language: 'en' | 'ar';
  onAutoTradeToggle: (v: boolean) => void;
  onSoundToggle: (v: boolean) => void;
  onLanguageChange: (v: 'en' | 'ar') => void;
  onClearCache: () => void;
  version: string;
}

export function MobileSettings({
  autoTradeEnabled,
  soundEnabled,
  language,
  onAutoTradeToggle,
  onSoundToggle,
  onLanguageChange,
  onClearCache,
  version,
}: MobileSettingsProps) {
  const Row = ({
    icon: Icon,
    title,
    subtitle,
    control,
  }: {
    icon: React.ElementType;
    title: string;
    subtitle: string;
    control: React.ReactNode;
  }) => (
    <div className="mt5-signal-card">
      <Icon size={20} style={{ color: '#888', flexShrink: 0 }} />
      <div className="mt5-signal-info">
        <div className="mt5-card-title">{title}</div>
        <div className="mt5-card-subtitle">{subtitle}</div>
      </div>
      {control}
    </div>
  );

  const Toggle = ({ on, onFlip }: { on: boolean; onFlip: () => void }) => (
    <button
      className={`mt5-btn ${on ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
      style={{ padding: '8px 18px', fontSize: 13, minWidth: 70 }}
      onClick={onFlip}
    >
      {on ? 'ON' : 'OFF'}
    </button>
  );

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        <Shield size={16} /> Settings
      </div>

      <Row
        icon={RefreshCw}
        title="Auto Mirror Trading"
        subtitle="Copy developer trades instantly"
        control={
          <Toggle on={autoTradeEnabled} onFlip={() => onAutoTradeToggle(!autoTradeEnabled)} />
        }
      />

      <Row
        icon={Volume2}
        title="Trade Sounds"
        subtitle="Alert on new position"
        control={
          <Toggle on={soundEnabled} onFlip={() => onSoundToggle(!soundEnabled)} />
        }
      />

      <Row
        icon={Bell}
        title="Push Notifications"
        subtitle="New signal alerts"
        control={<Toggle on={true} onFlip={() => {}} />}
      />

      <Row
        icon={Globe}
        title="Language"
        subtitle="App interface language"
        control={
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`mt5-btn ${language === 'en' ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
              style={{ padding: '8px 14px', fontSize: 12 }}
              onClick={() => onLanguageChange('en')}
            >
              EN
            </button>
            <button
              className={`mt5-btn ${language === 'ar' ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
              style={{ padding: '8px 14px', fontSize: 12 }}
              onClick={() => onLanguageChange('ar')}
            >
              AR
            </button>
          </div>
        }
      />

      <button className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={onClearCache}>
        Clear Cache
      </button>

      <button className="mt5-btn mt5-btn-danger mt5-btn-block">
        <LogOut size={16} /> Logout
      </button>

      <div className="mt5-empty-subtitle" style={{ textAlign: 'center', marginTop: 12 }}>
        Joseph.Trading v{version} — MT5 Mobile Edition
      </div>
    </div>
  );
}