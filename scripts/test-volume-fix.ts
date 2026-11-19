import { computeVolumeQuality } from '../src/services/volumeQuality';

// 20 completed candles at 1000 volume + one still-forming candle at 40% volume.
// Mirrors what Binance returns for the current daily bar mid-session.
const closes = Array.from({ length: 20 }, (_, i) => 100 - i * 0.5);
const opens = closes.map((c) => c + 0.2);
const highs = closes.map((c) => c + 0.8);
const lows = closes.map((c) => c - 0.8);
const volumes = Array.from({ length: 20 }, () => 1000);
volumes[19] = 400; // partial forming candle

const before = computeVolumeQuality(closes, highs, lows, volumes, opens, 'downtrend', false, false);
const after = computeVolumeQuality(closes, highs, lows, volumes, opens, 'downtrend', false, true);

console.log('forming candle used  :', before.score, before.reasons.join('; '));
console.log('completed candle used:', after.score, after.reasons.join(';'));

// ── Module 3 regression ──
// Rising completed volume (indices 15-18) + tiny forming candle (index 19).
// With the completed-volume flag ON, changing ONLY the forming candle's volume
// must not change the score: all five modules now ignore that bar.
const m3Closes = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5); // uptrend
const m3Opens = m3Closes.map((c) => c - 0.2);
const m3Highs = m3Closes.map((c) => c + 0.8);
const m3Lows = m3Closes.map((c) => c - 0.8);
const m3Volumes = Array.from({ length: 20 }, () => 1000);
for (let i = 15; i <= 18; i++) m3Volumes[i] = 1400;
m3Volumes[19] = 400;

const m3FullVolumes = [...m3Volumes];
m3FullVolumes[19] = 1400;

const m3Partial = computeVolumeQuality(m3Closes, m3Highs, m3Lows, m3Volumes, m3Opens, 'uptrend', false, true);
const m3Full = computeVolumeQuality(m3Closes, m3Highs, m3Lows, m3FullVolumes, m3Opens, 'uptrend', false, true);

console.log('module3 partial forming vol:', m3Partial.score);
console.log('module3 full forming vol   :', m3Full.score);

const module3Passed = m3Partial.score === m3Full.score;
console.log(module3Passed ? 'PASS: Module 3 ignores forming volume' : 'FAIL: Module 3 still reads forming volume');

const passed = before.score < 45 && after.score > before.score && module3Passed;
console.log(passed ? 'PASS: partial-volume bug removed (all modules)' : 'FAIL');
