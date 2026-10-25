import React, { useState, useEffect, useRef } from 'react';
import { Bell, Volume2, Globe, Shield, LogOut, LogIn, Loader2, RefreshCw, User, Camera } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { useMobileMode } from '../../lib/mobileMode';

interface MobileSettingsProps {
  autoTradeEnabled: boolean;
  soundEnabled: boolean;
  language: Language;
  onAutoTradeToggle: (v: boolean) => void;
  onSoundToggle: (v: boolean) => void;
  onLanguageChange: (v: Language) => void;
  onClearCache: () => void;
  onDeveloperLogin?: () => void;
  devLoginBusy?: boolean;
  devLoginError?: string | null;
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
  onDeveloperLogin,
  devLoginBusy,
  devLoginError,
  version,
