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
  // صوت "فتح قارورة شمبانيا" لتنبيه فتح الصفقات التلقائية:
  // فرقعة الفلين (pop) + فوران قصير (fizz) — مُصنّع بالكامل عبر Web Audio.
  try {
    const c = ctx();
    if (!c) return;
    const v = Math.max(0.05, Math.min(1, volume));
    const now = c.currentTime;

    // 1) فرقعة الفلين: sine ينخفض 900→140 هرتز في 0.12ث مع هجوم فوري.
    const pop = c.createOscillator();
    const popGain = c.createGain();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(900, now);
    pop.frequency.exponentialRampToValueAtTime(140, now + 0.12);
    popGain.gain.setValueAtTime(0.0001, now);
    popGain.gain.exponentialRampToValueAtTime(v, now + 0.008);
    popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    pop.connect(popGain);
    popGain.connect(c.destination);
    pop.start(now);
    pop.stop(now + 0.18);

    // نقرة حادة مرافقة للفرقعة (تُبرز الإحساس الاحتفالي).
    const snap = c.createOscillator();
    const snapGain = c.createGain();
    snap.type = 'square';
    snap.frequency.setValueAtTime(2400, now);
    snapGain.gain.setValueAtTime(v * 0.25, now);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    snap.connect(snapGain);
    snapGain.connect(c.destination);
    snap.start(now);
    snap.stop(now + 0.04);

    // 2) الفوران: ضجيج أبيض بفلتر highpass يتضاءل خلال ~0.9ث.
    const len = Math.floor(c.sampleRate * 0.9);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const fizz = c.createBufferSource();
    fizz.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4000, now + 0.1);
    hp.frequency.exponentialRampToValueAtTime(7000, now + 0.9);
    const fizzGain = c.createGain();
    fizzGain.gain.setValueAtTime(0.0001, now + 0.1);
    fizzGain.gain.exponentialRampToValueAtTime(v * 0.3, now + 0.14);
    fizzGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
    fizz.connect(hp);
    hp.connect(fizzGain);
    fizzGain.connect(c.destination);
    fizz.start(now + 0.1);

    // 3) رنين احتفالي خفيف: ثلاث نغمات صاعدة (C6–E6–G6) تُتوَّج الفرقعة.
    const notes: Array<[number, number]> = [[1046.5, 0.12], [1318.5, 0.22], [1568, 0.32]];
    for (const [freq, delay] of notes) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + delay);
      g.gain.exponentialRampToValueAtTime(v * 0.3, now + delay + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.35);
      o.connect(g);
      g.connect(c.destination);
      o.start(now + delay);
      o.stop(now + delay + 0.4);
    }
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
