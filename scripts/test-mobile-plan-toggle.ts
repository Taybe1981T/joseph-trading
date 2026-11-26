/** Regression: the mobile free/paid switch must start FREE and remember taps. */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};

import { mobilePaidMode, setMobilePaidMode, setMobileFreeModeChosen } from '../src/lib/mobileMode';

const email = 'paid.client@example.com';
let ok = true;
const check = (label: string, got: boolean, expected: boolean) => {
  const pass = got === expected;
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${got}, expected ${expected}`);
};

// A subscribed client who never tapped the icon opens in FREE mode (label `plan`).
check('default is free', mobilePaidMode(email), false);

// First tap activates the owned plan (label becomes `free`, blinking stops).
setMobilePaidMode(email, true);
setMobileFreeModeChosen(email, false);
check('first tap activates paid', mobilePaidMode(email), true);

// Second tap returns to free, and that choice survives a reload.
setMobilePaidMode(email, false);
setMobileFreeModeChosen(email, true);
check('second tap returns to free', mobilePaidMode(email), false);
check('free choice persists', mobilePaidMode(email), false);

console.log(ok ? '\nPASS: mobile plan toggle' : '\nFAIL: mobile plan toggle');
process.exit(ok ? 0 : 1);
