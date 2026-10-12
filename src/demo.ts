import { analyzeSnapshots } from './analyzer.js';
import type { Report } from './model.js';

export function createDemo(): Report {
  const base: Record<string, string> = {
    'tsconfig.json': '{"compilerOptions":{"strict":true,"target":"ES2022"}}\n',
    'src/checkout.ts': `import { createOrder } from './order.js';
import { priceOrder } from './pricing.js';

export function submitOrder(amount: number, region: string) {
  if (amount <= 0) throw new Error('Order amount must be positive');
  return createOrder(amount, region);
}

export function previewOrder(amount: number, region: string) {
  return priceOrder(amount, region);
}
`,
    'src/order.ts': `import { priceOrder } from './pricing.js';
import { saveOrder } from './store.js';

export function createOrder(amount: number, region: string) {
  const total = priceOrder(amount, region);
  return saveOrder(total, region);
}
`,
    'src/pricing.ts': `import { validateRegion } from './region.js';

export function priceOrder(amount: number, region: string) {
  validateRegion(region);
  const discount = amount >= 100 ? 10 : 0;
  return amount - discount;
}
`,
    'src/region.ts': `export function validateRegion(region: string) {
  if (!['CA', 'US'].includes(region)) throw new Error('Unsupported region');
}
`,
    'src/store.ts': `const orders: { total: number; region: string }[] = [];

export function saveOrder(total: number, region: string) {
  const order = { total, region };
  orders.push(order);
  return order;
}
`,
    'src/pricing.test.ts': `import { priceOrder } from './pricing.js';

export function discountExample() {
  return priceOrder(120, 'CA') === 110;
}
`,
    'policies.json': '{"discountThreshold":100,"supportedRegions":["CA","US"]}\n',
    'README.md': '# Checkout service\n\nDiscounts start at 100 dollars.\n',
  };
  const head = {
    ...base,
    'src/checkout.ts': `import { createOrder } from './order.js';
import { priceOrder } from './pricing.js';

export function submitOrder(amount: number, region: string) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Order amount must be positive');
  return createOrder(amount, region);
}

export function previewOrder(amount: number, region: string) {
  return { total: priceOrder(amount, region), currency: 'CAD' };
}

export function notifyOrder(total: number, notify: (value: number) => void) {
  notify(total);
}
`,
    'src/pricing.ts': `export function priceOrder(amount: number, region: string) {
  const discount = region === 'CA' && amount >= 150 ? 15 : 0;
  return Math.max(0, amount - discount);
}
`,
    'src/store.ts': `const orders: { total: number; region: string; createdAt: string }[] = [];

export function saveOrder(total: number, region: string) {
  const order = { total, region, createdAt: new Date().toISOString() };
  orders.push(order);
  return order;
}
`,
    'src/pricing.test.ts': `import { priceOrder } from './pricing.js';

export function discountExample() {
  return priceOrder(150, 'CA') === 135;
}

export function outsideCanadaExample() {
  return priceOrder(150, 'US') === 150;
}
`,
    'policies.json': '{"discountThreshold":150,"supportedRegions":["CA","US"],"discountRegion":"CA"}\n',
    'README.md': '# Checkout service\n\nCanadian orders receive a 15 dollar discount from 150 dollars.\n',
  };
  return analyzeSnapshots(base, head, {
    title: 'Checkout · Canadian discount eligibility',
    repository: { name: 'Checkout demo · illustrative source', base: 'demo-before', head: 'demo-after', mergeBase: 'demo-before' },
  });
}
