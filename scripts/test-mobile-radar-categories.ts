import { toggleRadarCategory } from '../src/lib/mobileRadarCategories';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const four = ['forex', 'crypto', 'stocks', 'metals'];
const five = [...four, 'custom'];

check('4 groups: deselect crypto', toggleRadarCategory('all', four, 'crypto'), 'forex,stocks,metals');
check('4 groups: reselect crypto → all', toggleRadarCategory('forex,stocks,metals', four, 'crypto'), 'all');
check('5 groups incl. custom: deselect crypto is not frozen', toggleRadarCategory('all', five, 'crypto'), 'forex,stocks,metals,custom');
check('5 groups incl. custom: reselect crypto → all', toggleRadarCategory('forex,stocks,metals,custom', five, 'crypto'), 'all');
check('5 groups: deselect custom', toggleRadarCategory('all', five, 'custom'), 'forex,crypto,stocks,metals');
check('last selected category is kept', toggleRadarCategory('forex', four, 'forex'), 'forex');
check('unknown stored value starts from the clicked group', toggleRadarCategory('garbage', four, 'crypto'), 'crypto');
check('stable fixed order', toggleRadarCategory('metals,forex', four, 'crypto'), 'forex,crypto,metals');

console.log(ok ? '\nPASS: mobile radar category toggles' : '\nFAIL: mobile radar category toggles');
if (!ok) process.exit(1);
