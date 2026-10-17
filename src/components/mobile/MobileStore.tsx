import React, { useState } from 'react';
import { Crown, Package, ArrowLeft, ShoppingCart } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { useMobileMode } from '../../lib/mobileMode';

interface MobileStoreProps {
  lang: Language;
  onClose?: () => void;
  autoTradeEnabled?: boolean;
}

const PLANS = [
  {
    key: 'monthly',
    label: 'Monthly',
    en: 'Monthly',
    ar: 'شهري',
    price: 15,
    period: '30 days',
    popular: true,
  },
  {
    key: 'yearly',
    label: 'Yearly',
    en: 'Yearly',
    ar: 'سنوي',
    price: 120,
    period: '365 days',
    popular: false,
  },
];

export function MobileStore({ lang, onClose }: MobileStoreProps) {
  const isAr = lang === 'ar';
  const { isDev } = useMobileMode();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isDev) {
    return (
      <div className="mt5-page-container">
        <div className="mt5-empty-state">
          <Crown size={56} className="text-yellow-400" />
          <h2 className="mt5-empty-title">{mobileT(lang, 'Developer Only', 'للمطورين فقط')}</h2>
          <p className="mt5-empty-subtitle">
            {mobileT(lang, 'This section is accessible for developers only.', 'هذا القسم متاح للمطورين فقط.')}
          </p>
        </div>
      </div>
    );
  }

  const handleSelectPlan = (planKey: string) => {
    setSelectedPlan(planKey);
  };

  const handlePay = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      onClose?.();
    }, 2000);
  };

  const getPlan = () => PLANS.find(p => p.key === selectedPlan);

  if (selectedPlan) {
    const plan = getPlan();
    if (!plan) return null;

    return (
      <div className="mt5-page-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, justifyContent: 'space-between' }}>
          <button
            onClick={() => setSelectedPlan(null)}
            className="mt5-icon-btn"
            aria-label="Back to Plans"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="mt5-section-title" style={{ margin: 0, flex: 1, textAlign: 'left' }}>
            {mobileT(lang, 'Store', 'المتجر')}
          </h1>
          <div style={{ width: 36 }} />
        </div>

        <div className="mt5-card" style={{ border: '2px solid #F59E0B' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'rgba(245,158,11,0.15)', padding: 12, borderRadius: 10 }}>
              <Crown size={28} color="#F59E0B" />
            </div>
            <div style={{ flex: 1 }}>
              <div className="mt5-card-title">{plan.label}</div>
              <div className="mt5-card-subtitle">
                {plan.period} — ${plan.price}
              </div>
            </div>
          </div>

          <button
            onClick={handlePay}
            disabled={isProcessing}
            className="mt5-btn mt5-btn-block"
            style={{ background: '#F59E0B', color: '#000' }}
          >
            <ShoppingCart size={18} /> {isProcessing ? (isAr ? 'معالجة...' : 'Processing...') : (isAr ? 'الشراء' : 'Pay')} ${plan.price}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt5-page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Crown size={28} style={{ color: '#F59E0B' }} />
        <h1 className="mt5-section-title" style={{ margin: 0 }}>{mobileT(lang, 'Store', 'المتجر')}</h1>
      </div>

      <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Package size={18} style={{ color: '#F59E0B' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#F59E0B' }}>
            Joseph.Trading Pro
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#e0e0e0', marginBottom: 8 }}>
          Active with a plan for full access to all features, bots, and live support.
        </div>
      </div>

      {PLANS.map((plan) => (
        <div key={plan.key} style={{ marginBottom: 16 }}>
          <div className="mt5-card" style={plan.popular ? { borderColor: '#F59E0B', boxShadow: '0 0 20px rgba(245,158,11,0.3)' } : undefined }}>
            {plan.popular && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <span style={{ background: '#F59E0B', color: '#000', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                  Most Popular
                </span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ background: 'rgba(245,158,11,0.15)', padding: 10, borderRadius: 10 }}>
                <Crown size={24} color="#F59E0B" />
              </div>
              <div style={{ flex: 1 }}>
                <div className="mt5-card-title">{plan.label}</div>
                <div className="mt5-card-subtitle">
                  {plan.period} — ${plan.price}
                </div>
              </div>
              <button
                onClick={() => handleSelectPlan(plan.key)}
                className="mt5-btn"
                style={{ background: '#F59E0B', color: '#000' }}
              >
                Select
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="mt5-empty-subtitle" style={{ textAlign: 'center', marginTop: 24, fontSize: 12 }}>
        Plans include access to all bots, indicators, and live support.
      </div>
    </div>
  );
}