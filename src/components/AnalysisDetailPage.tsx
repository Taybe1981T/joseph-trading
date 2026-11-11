import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, ShieldCheck, ShieldAlert, ShieldX, CheckCircle, XCircle, AlertTriangle, BarChart3, Target, Zap, CandlestickChart, Clipboard, Check, Waves } from 'lucide-react';
import { AnalysisResult, SignalType } from '../types';
import { Language } from '../lib/i18n';
import LotSizeCalculator from './LotSizeCalculator';

interface AnalysisDetailPageProps {
  result: AnalysisResult;
  onBack: () => void;
  lang: Language;
  isClient?: boolean;
  /**
   * Mobile embed: the page is opened from the phone layout, which has no desktop
   * header above it. Drops the 320px header spacer and lifts the overlay above
   * the mobile bottom navigation. Content and logic stay identical to desktop.
   */
  compact?: boolean;
}

function getSignalColor(signal: SignalType) {
  switch (signal) {
    case SignalType.STRONG_BUY: return { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500', glow: 'shadow-emerald-500/30' };
    case SignalType.BUY: return { bg: 'bg-emerald-600', text: 'text-emerald-400', border: 'border-emerald-600', glow: 'shadow-emerald-500/20' };
    case SignalType.STRONG_SELL: return { bg: 'bg-red-500', text: 'text-red-400', border: 'border-red-500', glow: 'shadow-red-500/30' };
    case SignalType.SELL: return { bg: 'bg-red-600', text: 'text-red-400', border: 'border-red-600', glow: 'shadow-red-500/20' };
    default: return { bg: 'bg-gray-500', text: 'text-gray-400', border: 'border-gray-500', glow: 'shadow-gray-500/20' };
  }
}

function getSignalLabel(signal: SignalType, lang: Language) {
  const isAr = lang === 'ar';
  switch (signal) {
    case SignalType.STRONG_BUY: return isAr ? 'شراء قوي' : 'STRONG BUY';
    case SignalType.BUY: return isAr ? 'شراء' : 'BUY';
    case SignalType.STRONG_SELL: return isAr ? 'بيع قوي' : 'STRONG SELL';
    case SignalType.SELL: return isAr ? 'بيع' : 'SELL';
    case SignalType.NEUTRAL: return isAr ? 'محايد' : 'NEUTRAL';
    default: return isAr ? 'لا إشارة' : 'NO ENTRY';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'positive': return <CheckCircle size={20} className="text-emerald-400" />;
    case 'negative': return <XCircle size={20} className="text-red-400" />;
    default: return <AlertTriangle size={20} className="text-yellow-400" />;
  }
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'positive': return 'border-emerald-500/30 bg-emerald-500/5';
    case 'negative': return 'border-red-500/30 bg-red-500/5';
    default: return 'border-yellow-500/30 bg-yellow-500/5';
  }
}

function parseCandleInfo(value: string) {
  // Reformatted: "1D: Bullish ↑ | 1W: Bearish ↓ | 1M: Bullish ↑" (no % ATR anymore)
  // Legacy formats kept for backwards-compatible parsing.
  const parts = value.split(/[|,]/).map((p: string) => p.trim());
  return parts.map((part: string) => {
    // New format: "1D: Bullish ↑" (no number)
    const revMatch = part.match(/^(\S+):\s*(Bullish|Bearish)\s*(↑|↓)/);
    if (revMatch) {
      const [, tf, dirName, dirChar] = revMatch;
      return { tf, body: '', dirChar, checkChar: undefined, isBullish: dirName === 'Bullish', isMatch: true };
    }
    // Previous format: "1d: 66.8 Bearish ↑ ✓"
    const newMatch = part.match(/^(\S+):\s*([\d.]+)\s+(Bullish|Bearish)\s+(↑|↓)\s*(✓|✗)?/);
    if (newMatch) {
      const [, tf, body, dirName, dirChar, checkChar] = newMatch;
      return { tf, body, dirChar, checkChar, isBullish: dirName === 'Bullish', isMatch: checkChar !== '✗' };
    }
    // Old format: "1d: 18.8 ↑ ✓"
    const oldMatch = part.match(/^(\S+):\s*([\d.]+)\s*\((.)\s*(.)?\)/);
    if (oldMatch) {
      const [, tf, body, dirChar, checkChar] = oldMatch;
      return { tf, body, dirChar, checkChar, isBullish: dirChar === '↑', isMatch: checkChar === '✓' };
    }
    return null;
  }).filter(Boolean);
}

export default function AnalysisDetailPage({ result, onBack, lang, isClient = false, compact = false }: AnalysisDetailPageProps) {
  const [copied, setCopied] = useState(false);
  const isAr = lang === 'ar';
  const colors = getSignalColor(result.signal);
  const allReasons = result.detailedReasons || [];

  const blockReasons = allReasons.filter(r => r.status === 'negative');
  const candleMatchReason = allReasons.find(r => r.check?.includes('Candle Match'));
  const remainingReasons = allReasons.filter(r => r.status !== 'negative' && !r.check?.includes('Candle Match'));
  const primaryReasons = remainingReasons.filter(r => ['BB Pullback', 'Micro BB', 'Supply/Demand', 'Trend Age', 'Pre-Pullback Age', 'News', 'Economic Events'].some(p => r.check?.includes(p)));
  const supportingReasons = remainingReasons.filter(r => !['BB Pullback', 'Micro BB', 'Supply/Demand', 'Trend Age', 'Pre-Pullback Age', 'News', 'Economic Events'].some(p => r.check?.includes(p)));

  const fmt = (v: number) => Number(v).toFixed(0);
  // Volume Quality badge — 4th top card
  const volScore = (result as any).volumeQuality as number | undefined;
  const volThreshold = ((result as any).volumeQualityThreshold as number | undefined) ?? 45;
  const volMaxThreshold = ((result as any).volumeQualityMaxThreshold as number | undefined) ?? 85;
  const volAbsorbed = (result as any).volumeAbsorbed as boolean | undefined;
  const hasVol = typeof volScore === 'number' && Number.isFinite(volScore);
  const volColor = !hasVol ? 'text-white/30' : volAbsorbed ? 'text-red-400' : (volScore! >= volThreshold && volScore! <= volMaxThreshold ? 'text-cyan-400' : 'text-red-400');
  const volDisplay = hasVol ? `${fmt(volScore!)}%` : '—';

  const generateAnalysisText = () => {
    const lines: string[] = [];
    lines.push(`📊 ${isAr ? 'تحليل' : 'ANALYSIS'}: ${result.symbol} - ${getSignalLabel(result.signal, lang)}`);
    lines.push(`${isAr ? 'الثقة' : 'CONFIDENCE'}: ${fmt(result.confidence)}%`);
    lines.push(`${isAr ? 'التقني' : 'TECHNICAL'}: ${fmt(result.technicalScore)}% | ${isAr ? 'المشاعر' : 'SENTIMENT'}: ${fmt(result.sentimentScore)}%`);
    lines.push('');
    if (primaryReasons.length > 0) {
      lines.push(`✅ ${isAr ? 'الشروط الأساسية' : 'PRIMARY CONDITIONS'}:`);
      primaryReasons.forEach(r => lines.push(`  • ${r.check}: ${r.value} (${r.impact})`));
      lines.push('');
    }
    if (blockReasons.length > 0) {
      lines.push(`🚫 ${isAr ? 'فلاتر المنع' : 'BLOCK FILTERS'}:`);
      blockReasons.forEach(r => lines.push(`  • ${r.check}: ${r.value} (${r.impact})`));
      lines.push('');
    }
    if (supportingReasons.length > 0) {
      lines.push(`📋 ${isAr ? 'الشروط الداعمة' : 'SUPPORTING'}:`);
      supportingReasons.forEach(r => lines.push(`  • ${r.check}: ${r.value}`));
      lines.push('');
    }
    if (result.summary) {
      lines.push(`📝 ${isAr ? 'الملخص' : 'SUMMARY'}: ${result.summary}`);
    }
    lines.push('');
    lines.push(`⏰ ${new Date().toLocaleString()}`);
    lines.push(`🔗 Joseph.Trading`);
    return lines.join('\n');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generateAnalysisText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const directionWord = result.direction === 'buy' || result.signal === SignalType.BUY || result.signal === SignalType.STRONG_BUY
    ? (isAr ? 'صعودي' : 'bullish')
    : (isAr ? 'هبوطي' : 'bearish');

  const narrativeParts: string[] = [];

  narrativeParts.push(isAr
    ? `تم اختيار الرمز ${result.symbol} كإشارة ${getSignalLabel(result.signal, lang)} بثقة ${fmt(result.confidence)}% نتيجة تظافر مجموعة من العوامل الفنية والاقتصادية والزخم السعري.`
    : `Symbol ${result.symbol} was selected as a ${getSignalLabel(result.signal, lang)} signal with ${fmt(result.confidence)}% confidence, driven by a combination of technical, economic, and price-momentum factors.`);

  narrativeParts.push(isAr
    ? `من الناحية الفنية، بلغت درجة المؤشرات ${fmt(result.technicalScore)}% حيث أظهرت مؤشرات الشارت مثل RSI وEMA وحجم التداول اتجاهاً ${directionWord} واضحاً، مع إشارات اختراق للأطر الزمنية المتعددة وسحب سعري صحي قبل التحرك.`
    : `Technically, the indicator score reached ${fmt(result.technicalScore)}% as chart indicators such as RSI, EMA, and volume showed a clear ${directionWord} trend, with breakouts across multiple timeframes and a healthy pullback before the move.`);

  narrativeParts.push(isAr
    ? `عزز ذلك زخم معنويات السوق الذي سجل ${fmt(result.sentimentScore)}%، حيث تدعم التدفقات المالية ونبرة الأخبار المالية اتجاه هذا الزوج، مما يرفع احتمالية استمرار الحركة نحو أهداف السعر المحددة.`
    : `This was reinforced by market sentiment momentum at ${fmt(result.sentimentScore)}%, where capital flows and the tone of financial news favour this pair, increasing the probability of continuation toward the defined price targets.`);

  narrativeParts.push(isAr
    ? `كما لعبت العوامل الاقتصادية دوراً محورياً، إذ تدعم بيانات التضخم وأسعار الفائدة وقرارات البنوك المركزية التوجه الحالي، بينما يظل أثر الأخبار القادمة محسوباً بحذر لتجنب المفاجآت التي قد تغير مسار الحركة.`
    : `Economic factors also played a pivotal role, as inflation data, interest rates, and central bank decisions support the current direction, while the impact of upcoming news remains carefully accounted for to avoid surprises.`);

  const generateClientNarrative = () => narrativeParts.join(' ');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={compact ? 'fixed inset-0 z-[60] overflow-y-auto bg-[#0a0f1a]' : 'fixed inset-0 z-50 overflow-y-auto bg-[#0a0f1a]'}
    >
      {/* Spacer for main header (desktop only — the phone layout has its own) */}
      {!compact && <div className="h-[320px]" />}
      
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0f1a]/95 backdrop-blur-xl border-b border-white/5" style={compact ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl bg-[#F59E0B] hover:bg-[#d97706] transition-all">
            <ArrowLeft size={20} className="text-black" />
          </button>
          <div className="flex-1">
            {!isClient && (
            <div className="flex items-center gap-2">
              <span className={`text-xl font-black ${colors.text}`}>{result.symbol}</span>
              <span className={`px-3 py-1 rounded-lg text-xs font-black text-white ${colors.bg} shadow-lg ${colors.glow}`}>
                {getSignalLabel(result.signal, lang)}
              </span>
              <span className={`text-2xl font-black ${colors.text}`}>{fmt(result.confidence)}%</span>
            </div>
            )}
          </div>
          {!isClient && (
          <button
            onClick={handleCopy}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all border border-white/10"
            title={isAr ? 'نسخ التحليل' : 'Copy Analysis'}
          >
            {copied ? <Check size={18} className="text-emerald-400" /> : <Clipboard size={18} className="text-white/70" />}
          </button>
          )}
        </div>
      </div>

      <div className={isClient ? "max-w-5xl mx-auto px-4 space-y-3 mt-4 pb-20" : "max-w-5xl mx-auto px-4 space-y-3 mt-4 pb-20"}>

        {isClient ? (
          <>
            {/* Client view: only scores + calculator + narrative */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
                <BarChart3 size={28} className="text-blue-400 mx-auto mb-2" />
                <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'تقني' : 'Technical'}</div>
                <div className="text-5xl font-black text-blue-400">{fmt(result.technicalScore)}%</div>
              </div>
              <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
                <Zap size={28} className="text-purple-400 mx-auto mb-2" />
                <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'مشاعر' : 'Sentiment'}</div>
                <div className="text-5xl font-black text-purple-400">{fmt(result.sentimentScore)}%</div>
              </div>
              <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
                <Target size={28} className="text-emerald-400 mx-auto mb-2" />
                <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'ثقة' : 'Confidence'}</div>
                <div className={`text-5xl font-black ${colors.text}`}>{fmt(result.confidence)}%</div>
              </div>
              <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
                <Waves size={28} className="text-cyan-400 mx-auto mb-2" />
                <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'الحجم' : 'Volume'}</div>
                <div className={`text-5xl font-black ${volColor}`}>{volDisplay}</div>
                {hasVol && <div className="text-xs text-white/30 mt-1 font-mono">{fmt(volScore!)} /100 (≥{volThreshold})</div>}
              </div>
            </div>

            {result.signal !== 'neutral' && result.signal !== 'no_entry' && (
              <div className="rounded-2xl border border-white/5 bg-[#111827] overflow-hidden">
                <LotSizeCalculator
                  symbol={result.symbol}
                  stopLoss={result.stopLoss || 0}
                  takeProfit={result.takeProfit || 0}
                  entryPrice={result.entryPrice}
                  signal={result.signal as any}
                  lang={lang}
                />
              </div>
            )}

            <div className="rounded-2xl p-6 border border-[#F59E0B]/40 bg-[#F59E0B]/5">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={22} className="text-[#F59E0B]" />
                <span className="text-lg font-black text-[#F59E0B] uppercase tracking-wider">
                  {isAr ? 'لماذا هذا التحليل؟' : 'Why this signal?'}
                </span>
              </div>
              <p className="text-lg leading-relaxed text-yellow-300 font-semibold" style={{ direction: isAr ? 'rtl' : 'ltr' }}>
                {generateClientNarrative()}
              </p>
            </div>
          </>
        ) : (
        <>
        {/* 1. Signal Scores - large (4 on one row — Volume Quality added) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
            <BarChart3 size={28} className="text-blue-400 mx-auto mb-2" />
            <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'تقني' : 'Technical'}</div>
            <div className="text-5xl font-black text-blue-400">{fmt(result.technicalScore)}%</div>
          </div>
          <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
            <Zap size={28} className="text-purple-400 mx-auto mb-2" />
            <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'مشاعر' : 'Sentiment'}</div>
            <div className="text-5xl font-black text-purple-400">{fmt(result.sentimentScore)}%</div>
          </div>
          <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
            <Target size={28} className="text-emerald-400 mx-auto mb-2" />
            <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'ثقة' : 'Confidence'}</div>
            <div className={`text-5xl font-black ${colors.text}`}>{fmt(result.confidence)}%</div>
          </div>
          <div className="bg-white/5 rounded-2xl p-6 border border-white/5 text-center">
            <Waves size={28} className="text-cyan-400 mx-auto mb-2" />
            <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'الحجم' : 'Volume'}</div>
            <div className={`text-5xl font-black ${volColor}`}>{volDisplay}</div>
            {hasVol && <div className="text-xs text-white/30 mt-1 font-mono">{fmt(volScore!)} /100 (≥{volThreshold})</div>}
          </div>
        </div>

        {/* 2. Lot Size Calculator */}
        {result.signal !== 'neutral' && result.signal !== 'no_entry' && (
          <div className="rounded-2xl border border-white/5 bg-[#111827] overflow-hidden">
            <LotSizeCalculator
              symbol={result.symbol}
              stopLoss={result.stopLoss || 0}
              takeProfit={result.takeProfit || 0}
              entryPrice={result.entryPrice}
              signal={result.signal as any}
              lang={lang}
            />
          </div>
        )}

        {/* 4. Trend Info */}
        <div className="grid grid-cols-2 gap-3">
          {result.trendMaturity && (
            <div className="bg-white/5 rounded-xl p-5 border border-white/5">
              <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'عمر الاتجاه' : 'Trend Age'}</div>
              <div className="text-lg font-black text-white capitalize">{result.trendMaturity} {result.trendAge ? `(${result.trendAge}c)` : ''}</div>
            </div>
          )}
          {result.microSignal && (
            <div className="bg-white/5 rounded-xl p-5 border border-white/5">
              <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'عمر ما بعد السحب' : 'Pre-Pullback Age'}</div>
              <div className="text-lg font-black text-white capitalize">{result.microSignal} {result.microTF ? `(${result.microTF})` : ''}</div>
            </div>
          )}
          {result.adx !== undefined && (
            <div className="bg-white/5 rounded-xl p-5 border border-white/5">
              <div className="text-sm text-white/40 uppercase tracking-wider mb-1">ADX</div>
              <div className="text-lg font-black text-white">{result.adx?.toFixed(1)} {result.adxDirection || ''}</div>
            </div>
          )}
          {result.direction && (
            <div className="bg-white/5 rounded-xl p-5 border border-white/5">
              <div className="text-sm text-white/40 uppercase tracking-wider mb-1">{isAr ? 'الاتجاه' : 'Direction'}</div>
              <div className="flex items-center gap-2">
                {result.direction === 'buy' ? <TrendingUp size={20} className="text-emerald-400" /> :
                 result.direction === 'sell' ? <TrendingDown size={20} className="text-red-400" /> :
                 <Minus size={20} className="text-gray-400" />}
                <span className="text-lg font-black text-white uppercase">{result.direction}</span>
              </div>
            </div>
          )}
        </div>

        {/* 5. Candle Match - always show */}
        <div className="rounded-2xl p-5 border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 mb-4">
            <CandlestickChart size={22} className="text-[#F59E0B]" />
            <span className="text-lg font-black text-white uppercase tracking-wider">{isAr ? 'تطابق الشموع' : 'CANDLE MATCH'}</span>
            {candleMatchReason ? (
              candleMatchReason.status === 'positive' ? (
                <span className="ml-auto px-3 py-1 rounded-lg text-sm font-black bg-emerald-500/10 text-emerald-400">{isAr ? 'متطابقة' : 'MATCHED'}</span>
              ) : (
                <span className="ml-auto px-3 py-1 rounded-lg text-sm font-black bg-red-500/10 text-red-400">{isAr ? 'غير متطابقة' : 'NOT MATCHED'}</span>
              )
            ) : (
              <span className="ml-auto px-3 py-1 rounded-lg text-sm font-black bg-white/10 text-white/40">{isAr ? 'غير مفعّل' : 'DISABLED'}</span>
            )}
          </div>
          {candleMatchReason ? (
            <>
              <div className="space-y-3">
                {parseCandleInfo(candleMatchReason.value).map((c, i) => c && (
                  <div key={i} className={`rounded-xl p-4 border ${c.isMatch ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-black text-white/60 uppercase bg-white/10 px-3 py-1 rounded-lg">{c.tf}</span>
                        <div className={`flex items-center gap-2 ${c.isBullish ? 'text-emerald-400' : 'text-red-400'}`}>
                          {c.isBullish ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
                          <span className="text-lg font-black">
                            {c.isBullish ? (isAr ? 'صاعد ▲' : 'Bullish ▲') : (isAr ? 'هابط ▼' : 'Bearish ▼')}
                          </span>
                        </div>
                        <span className={`text-sm font-bold px-2 py-0.5 rounded ${c.isBullish ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                          {c.isBullish ? (isAr ? 'شراء' : 'BUY') : (isAr ? 'بيع' : 'SELL')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {c.body ? (
                          <>
                            <span className="text-2xl font-black font-mono text-white">{c.body}</span>
                            <span className="text-sm text-white/40">{isAr ? '٪ ATR' : '% ATR'}</span>
                          </>
                        ) : (
                          <span className="text-sm text-white/40">{isAr ? '—' : '—'}</span>
                        )}
                        <span className={`text-2xl font-black ${c.isMatch ? 'text-emerald-400' : 'text-red-400'}`}>
                          {c.isMatch ? '✓' : '✗'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-white/40 mt-3 leading-relaxed">{candleMatchReason.impact}</p>
            </>
          ) : (
            <div className="text-sm text-white/30 italic py-2">{isAr ? 'لم يتم تفعيل فلتر تطابق الشموع أو لا توجد بيانات كافية' : 'Candle match filter not enabled or insufficient data'}</div>
          )}
        </div>

        {/* 6. Block Filters - always show */}
        <Section
          title={isAr ? 'فلاتر المنع' : 'BLOCK FILTERS'}
          icon={<ShieldX size={20} className="text-red-400" />}
          color="red"
          reasons={blockReasons}
          lang={lang}
          alwaysShow={true}
        />

        {/* 7. Primary Conditions */}
        {primaryReasons.length > 0 && (
          <Section
            title={isAr ? 'الشروط الأساسية' : 'PRIMARY CONDITIONS'}
            icon={<ShieldCheck size={20} className="text-[#F59E0B]" />}
            color="amber"
            reasons={primaryReasons}
            lang={lang}
          />
        )}

        {/* 8. Supporting Conditions */}
        {supportingReasons.length > 0 && (
          <Section
            title={isAr ? 'الشروط الداعمة' : 'SUPPORTING CONDITIONS'}
            icon={<ShieldAlert size={20} className="text-blue-400" />}
            color="blue"
            reasons={supportingReasons}
            lang={lang}
          />
        )}

        {/* Summary */}
        {result.summary && (
          <div className="bg-white/5 rounded-xl p-5 border border-white/5">
            <div className="text-sm text-white/40 uppercase tracking-wider mb-2">{isAr ? 'ملخص' : 'Summary'}</div>
            <p className="text-base text-white/70 leading-relaxed">{result.summary}</p>
          </div>
        )}
        </>
        )}
      </div>
    </motion.div>
  );
}

function Section({ title, icon, color, reasons, lang, alwaysShow }: {
  title: string;
  icon: React.ReactNode;
  color: 'amber' | 'blue' | 'red';
  reasons: { check: string; value: string; status: string; impact: string }[];
  lang: Language;
  alwaysShow?: boolean;
}) {
  const isAr = lang === 'ar';
  const colorMap = {
    amber: { header: 'border-[#F59E0B]/30', badge: 'bg-[#F59E0B]/10 text-[#F59E0B]' },
    blue: { header: 'border-blue-500/30', badge: 'bg-blue-500/10 text-blue-400' },
    red: { header: 'border-red-500/30', badge: 'bg-red-500/10 text-red-400' },
  };
  const c = colorMap[color];

  if (reasons.length === 0 && !alwaysShow) return null;

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 pb-2 border-b ${c.header}`}>
        {icon}
        <span className="text-lg font-black text-white uppercase tracking-wider">{title}</span>
        <span className={`ml-auto px-2 py-0.5 rounded-md text-sm font-black ${c.badge}`}>
          {reasons.length}
        </span>
      </div>
      <div className="space-y-3">
        {reasons.length > 0 ? reasons.map((r, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`rounded-xl p-5 border ${getStatusStyle(r.status)}`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{getStatusIcon(r.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg font-black text-white">{r.check}</span>
                  <span className="text-sm text-white/30 font-mono">|</span>
                  <span className="text-base text-white/60 font-mono">{r.value}</span>
                </div>
                <p className="text-sm text-white/50 leading-relaxed">{r.impact}</p>
              </div>
            </div>
          </motion.div>
        )) : (
          <div className="text-sm text-white/30 italic py-2">{isAr ? 'لا توجد فلاتر منع مُفعّلة' : 'No block filters triggered'}</div>
        )}
      </div>
    </div>
  );
}
