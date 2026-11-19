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

const passed = before.score < 45 && after.score > before.score;
console.log(passed ? 'PASS: partial-volume bug removed' : 'FAIL');
