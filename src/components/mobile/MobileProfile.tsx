import React, { useState } from 'react';
import { User, Shield, Camera, Image, LogOut, LogIn, Check, X } from 'lucide-react';
import { Language } from '../../lib/i18n';

interface MobileProfileProps {
  language: Language;
  userEmail?: string | null;
  avatarUrl?: string | null;
  isLoggedIn?: boolean;
  onLoginClick?: () => void;
  onLogoutClick?: () => void;
  onProfileImageChange?: (url: string) => void;
  onLogoChange?: (url: string) => void;
  isFollowing?: boolean;
  onFollowToggle?: () => void;
}

export function MobileProfile({
  language, userEmail, avatarUrl, isLoggedIn = false, onLoginClick, onLogoutClick,
  onProfileImageChange, onLogoChange, isFollowing = false, onFollowToggle,
}: MobileProfileProps) {
  const isAr = language === 'ar';
  const [customAvatar, setCustomAvatar] = useState(() => localStorage.getItem('finalyze_custom_avatar') || null);
  const [customLogo, setCustomLogo] = useState(() => localStorage.getItem('finalyze_custom_logo') || null);

  const handleAvatarChange = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setCustomAvatar(dataUrl);
      try { localStorage.setItem('finalyze_custom_avatar', dataUrl); } catch {}
      onProfileImageChange?.(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleLogoChange = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setCustomLogo(dataUrl);
      try { localStorage.setItem('finalyze_custom_logo', dataUrl); } catch {}
      onLogoChange?.(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const displayName = userEmail ? String(userEmail).split('@')[0] : (isAr ? 'مستخدم' : 'User');

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        <User size={18} /> {isAr ? 'الملف الشخصي' : 'Personal Profile'}
      </div>

      {/* Profile info card */}
      <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16, padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative', width: 110, height: 110 }}>
            {avatarUrl || customAvatar ? (
              <img src={avatarUrl || customAvatar} alt="Profile" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', border: '3px solid #10B981' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: '#2a2a2a', border: '3px dashed rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={36} style={{ color: '#888' }} />
              </div>
            )}
            <label style={{ position: 'absolute', bottom: 2, right: 2, background: '#10B981', borderRadius: '50%', padding: 8, cursor: 'pointer', border: '3px solid #1a1a1a', zIndex: 10 }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
              <Camera size={16} style={{ color: '#fff' }} />
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%' }}>
            <div className="mt5-card-title" style={{ textAlign: 'center', fontSize: 20, fontWeight: 800 }}>{displayName}</div>
            <div className="mt5-card-subtitle" style={{ textAlign: 'center', color: '#888' }}>{userEmail || (isAr ? 'غير مسجل الدخول' : 'Not signed in')}</div>
          </div>
        </div>

        {/* App Logo (small / thumbnail) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {customLogo ? (
              <img src={customLogo} alt="Logo" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
            ) : (
              <Shield size={18} style={{ color: '#888' }} />
            )}
          </div>
          <div className="mt5-signal-info" style={{ flex: 1 }}>
            <div className="mt5-card-title" style={{ fontSize: 15 }}>{isAr ? 'شعار التطبيق (مصغر)' : 'App Logo (Thumbnail)'}</div>
            <div className="mt5-card-subtitle">{isAr ? 'الشعار الظاهر في شريط الرأس أعلى التطبيق' : 'Logo shown in the header bar at the top'}</div>
          </div>
          <button className="mt5-btn mt5-btn-secondary" onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = handleLogoChange;
        {/* Follow / Tracking toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <User size={18} style={{ color: '#888' }} />
          </div>
          <div className="mt5-signal-info" style={{ flex: 1 }}>
            <div className="mt5-card-title" style={{ fontSize: 15 }}>{isAr ? '?????? ??????' : 'Follow Account'}</div>
            <div className="mt5-card-subtitle">{isAr ? '???? ???? ??? ?????? ??????????' : 'Track account activity and notifications'}</div>
          </div>
          <button
            className={mt5-btn }
            style={{ padding: '8px 18px', minWidth: 100 }}
            onClick={() => onFollowToggle?.()}
          >
            {isFollowing ? (isAr ? '????? ????????' : 'Unfollow') : (isAr ? '??????' : 'Follow')}
            {isFollowing ? <Check size={14} style={{ marginLeft: 6 }} /> : <X size={14} style={{ marginLeft: 6 }} />}
          </button>
        </div>

        {/* Account login/logout at bottom of profile */}
        <div style={{ marginTop: 20 }}>
          {isLoggedIn ? (
            <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {avatarUrl || customAvatar ? (
                  <img src={avatarUrl || customAvatar} alt="Avatar" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <User size={20} style={{ color: '#888' }} />
                )}
                <div className="mt5-signal-info" style={{ flex: 1 }}>
                  <div className="mt5-card-title">{userEmail || (isAr ? '??????' : 'User')}</div>
                  <div className="mt5-card-subtitle">{isAr ? '????' : 'Signed in'}</div>
                </div>
              </div>
              <button className="mt5-btn mt5-btn-danger mt5-btn-block" onClick={() => onLogoutClick?.()}>
                <LogOut size={16} /> {isAr ? '????? ??????' : 'Sign out'}
              </button>
            </div>
          ) : (
            <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <LogIn size={20} style={{ color: '#F59E0B', flexShrink: 0 }} />
                <div className="mt5-signal-info" style={{ flex: 1 }}>
                  <div className="mt5-card-title">{isAr ? '????? ??????' : 'Sign in'}</div>
                  <div className="mt5-card-subtitle">{isAr ? '???? ?????? ???????? ????? ??????' : 'Sign in to use account features'}</div>
                </div>
              </div>
              <button className="mt5-btn mt5-btn-primary mt5-btn-block" onClick={() => onLoginClick?.()}>
                <LogIn size={16} /> {isAr ? '????? ?????? ????? Google' : 'Sign in with Google'}
              </button>
            </div>
          </div>
