import { getAudioContext } from './audioEngine';

function ctx(): AudioContext | null {
  return getAudioContext();
}

export function playOpenSound() {
  try {
    const c = ctx();
    if (!c) return;
    // Pop: two-tone ascending beep
    const o1 = c.createOscillator();
    const g1 = c.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(600, c.currentTime);
    o1.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.08);
    g1.gain.setValueAtTime(0.35, c.currentTime);
    g1.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.12);
    o1.connect(g1);
    g1.connect(c.destination);
    o1.start(c.currentTime);
    o1.stop(c.currentTime + 0.12);

    // Second pop slightly delayed
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(900, c.currentTime + 0.06);
    o2.frequency.exponentialRampToValueAtTime(1600, c.currentTime + 0.14);
    g2.gain.setValueAtTime(0, c.currentTime);
    g2.gain.setValueAtTime(0.25, c.currentTime + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.18);
    o2.connect(g2);
    g2.connect(c.destination);
    o2.start(c.currentTime + 0.06);
    o2.stop(c.currentTime + 0.18);
  } catch {}
}

export function playChampagnePop(volume: number = 0.7) {
  // تنبيه فتح صفقة — جرس ناعم صاعد (E5 → A5 → لمسة C6 مع صدى خفيف).
  // بديل ناعم وجميل عن فرقعة الشمبانيا القديمة، مُصنَّع بالكامل عبر Web Audio.
  try {
    const c = ctx();
    if (!c) return;
    const v = Math.max(0.05, Math.min(1, volume));
    const now = c.currentTime;

    // نغمة (bell tone): sine + أُحرف نصفية خفيفة + هجوم ناعم + تلاشٍ طويل.
    const ring = (freq: number, at: number, gain: number, decay: number) => {
      const o = c.createOscillator();
      const o2 = c.createOscillator(); // الأُحدة الثانية تعطي إحساس "جرس"
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o2.type = 'sine';
      o2.frequency.value = freq * 2.76; // أُحدة غير صوتية (طابع الجرس)
      o.connect(g);
      const g2 = c.createGain();
      o2.connect(g2);
      g2.connect(g);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      g2.gain.value = 0.12; // أُحدة الجرس أهدأ من الأساس
      g.connect(c.destination); // التوصيل بمخرج الصوت (بدونه يبقى الصوت صامتًا)
      o.start(at);
      o.stop(at + decay + 0.05);
      o2.start(at);
      o2.stop(at + decay + 0.05);
    };

    // النغمة الأولى: E5 — بداية دافئة.
    ring(659.25, now, v * 0.5, 0.55);
    // النغمة الثانية: A5 صاعدة بعد 0.12ث — إحساس "انطلقت الصفقة".
    ring(880.0, now + 0.12, v * 0.55, 0.7);
    // لمسة sparkle خفيفة: C6 قصيرة بعد 0.26ث.
    ring(1046.5, now + 0.26, v * 0.28, 0.35);
    // صدى هادئ: A5 مرة أخيرة أهدأ بعد 0.42ث (إحساس ممتد نظيف).
    ring(880.0, now + 0.42, v * 0.18, 0.9);
  } catch {}
}

export function playCloseSound() {
  try {
    const c = ctx();
    if (!c) return;
    // Click: short sharp tick
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1200, c.currentTime);
    g.gain.setValueAtTime(0.2, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.04);
    o.connect(g);
    g.connect(c.destination);
    o.start(c.currentTime);
    o.stop(c.currentTime + 0.04);
  } catch {}
}

export function playClickSound() {
  try {
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1000, c.currentTime);
    g.gain.setValueAtTime(0.18, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.05);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime); o.stop(c.currentTime + 0.05);
  } catch {}
}

export function playDragTick() {
  try {
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(700, c.currentTime);
    g.gain.setValueAtTime(0.12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.04);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime); o.stop(c.currentTime + 0.04);
  } catch {}
}
