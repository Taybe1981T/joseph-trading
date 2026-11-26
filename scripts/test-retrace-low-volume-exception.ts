/**
 * Regression: a completed Retrace must not be punished for the quiet volume
 * that IS the pullback. High-volume absorption / climax guards stay intact.
 */
import { computeVolumeQuality } from '../src/services/volumeQuality';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function uptrendSeries(volumeAtCompleted: number) {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5);
  const opens = closes.map((c) => c - 0.2); // small bullish body everywhere
  const highs = closes.map((c) => c + 0.8);
  const lows = closes.map((c) => c - 0.8);
  const volumes = Array.from({ length: 20 }, () => 1000);
  // useCompletedVolume=true scores index 18 against indices 13..17.
  volumes[18] = volumeAtCompleted;
  volumes[19] = volumeAtCompleted;
  return { closes, opens, highs, lows, volumes };
}

// 1) Quiet completed pullback bar: blocked before, accepted after.
const quiet = uptrendSeries(500);
const blocked = computeVolumeQuality(
  quiet.closes, quiet.highs, quiet.lows, quiet.volumes, quiet.opens,
  'uptrend', false, true, false,
);
const accepted = computeVolumeQuality(
  quiet.closes, quiet.highs, quiet.lows, quiet.volumes, quiet.opens,
  'uptrend', false, true, true,
);
check('quiet pullback fails the old threshold', blocked.score < 45, true);
check('old reason names weak conviction', blocked.reasons.some((r) => r.includes('weak conviction')), true);
check('retrace exception lifts it over the threshold', accepted.score >= 45, true);
check('exception reason is explicit', accepted.reasons.some((r) => r.includes('confirmed retrace')), true);

// 2) High-volume absorption must STILL block even when Retrace is confirmed.
const trap = uptrendSeries(2000);
trap.opens[19] = trap.closes[19]; // tiny body on the live candle
trap.highs[19] = trap.closes[19] + 1.2;
trap.lows[19] = trap.closes[19] - 1.2;
const trapNormal = computeVolumeQuality(
  trap.closes, trap.highs, trap.lows, trap.volumes, trap.opens,
  'uptrend', false, true, false,
);
const trapException = computeVolumeQuality(
  trap.closes, trap.highs, trap.lows, trap.volumes, trap.opens,
  'uptrend', false, true, true,
);
check('absorption detected normally', trapNormal.absorbed, true);
check('absorption still detected with retrace exception', trapException.absorbed, true);

console.log(ok ? '\nPASS: retrace low-volume exception' : '\nFAIL: retrace low-volume exception');
if (!ok) process.exit(1);
