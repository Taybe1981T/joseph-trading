/** The client mirror must copy only entry settings and only real changes. */
import { applySharedValues, KeyValueStore } from '../src/lib/sharedSettingsApply';

const data = new Map<string, string>();
const storage: KeyValueStore = {
  getItem: (k) => (data.has(k) ? data.get(k)! : null),
  setItem: (k, v) => { data.set(k, v); },
};
const keys = ['strategy_settings'];
const devValue = JSON.stringify({ entryMode: 'pullback', retraceCandlesForex: 2 });
let ok = true;
const check = (label: string, got: unknown, expected: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
};

check('copies developer strategy settings', applySharedValues({ strategy_settings: devValue }, keys, storage), ['strategy_settings']);
check('local value now matches developer', storage.getItem('strategy_settings'), devValue);
check('no duplicate event for same value', applySharedValues({ strategy_settings: devValue }, keys, storage), []);
check('ignores unknown keys', applySharedValues({ auto_settings: '{"isEnabled":true}', finalyze_dev_email: 'x@y.z' }, keys, storage), []);
check('ignores non-string values', applySharedValues({ strategy_settings: null }, keys, storage), []);

console.log(ok ? '\nPASS: client entry settings mirror' : '\nFAIL: client entry settings mirror');
process.exit(ok ? 0 : 1);
