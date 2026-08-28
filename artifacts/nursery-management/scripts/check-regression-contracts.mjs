import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const sources = {
  app: await readFile(join(root, 'src/App.tsx'), 'utf8'),
  finance: await readFile(join(root, 'src/pages/admin/FinanceExpanded.tsx'), 'utf8'),
};
const contracts = [
  ['application default is locale-independent', sources.app, "const DEFAULT_ACADEMIC_LEVEL = 'تمهيدي';"],
  ['application editor uses canonical default', sources.app, "level: application?.level || DEFAULT_ACADEMIC_LEVEL"],
  ['child editor uses canonical default', sources.app, "level: child?.level || DEFAULT_ACADEMIC_LEVEL"],
  ['stable preparatory value', sources.app, "{ value: DEFAULT_ACADEMIC_LEVEL, label: 'application.level' }"],
  ['stable KG1 value', sources.app, "{ value: 'KG1', label: 'application.kg1' }"],
  ['stable KG2 value', sources.app, "{ value: 'KG2', label: 'application.kg2' }"],
  ...['row-invoice', 'button-pay', 'button-remind', 'button-close-payment-options', 'button-payment-link', 'button-payment-knet', 'button-payment-cash', 'input-cash-note']
    .map((id) => [`finance test id ${id}`, sources.finance, `data-testid={\`${id}-\${invoice.id}\`}`]),
];
const failures = contracts.filter(([, source, expected]) => !source.includes(expected)).map(([name]) => name);
if (failures.length) throw new Error(`Regression contract check failed: ${failures.join(', ')}`);
console.log('Regression contracts passed.');