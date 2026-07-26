// Static compatibility gate for the target digiboard.
//
// Its browser reports a spoofed "Chrome 22 / Windows 7" user agent, but
// navigator.platform says Linux aarch64 and the feature fingerprint (has
// ResizeObserver and dynamic import, lacks clamp(), optional chaining,
// aspect-ratio and Wake Lock) places it in the Chromium 64-78 range.
//
// This scans dist/ for syntax and features newer than that, so a regression
// fails the build instead of showing up as a blank screen on the wall.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

const JS_RULES = [
  // `?.` must not be followed by a digit: minifiers emit ternaries like
  // `cond ? .16 : .38`, which is not optional chaining.
  [/\?\.[^0-9]/, 'optional chaining (?.) — Chromium 80+'],
  [/\?\?/, 'nullish coalescing (??) — Chromium 80+'],
  [/\breplaceChildren\s*\(/, 'Element.replaceChildren() — Chromium 86+'],
  [/\.flatMap\s*\(/, 'Array.prototype.flatMap() — Chromium 69+'],
  [/\bstructuredClone\s*\(/, 'structuredClone() — Chromium 98+'],
  [/\.at\s*\(\s*-?\d/, 'Array.prototype.at() — Chromium 92+'],
  [/Object\.hasOwn\s*\(/, 'Object.hasOwn() — Chromium 93+'],
  [/\bctx\.roundRect\s*\(/, 'CanvasRenderingContext2D.roundRect() — Chromium 99+'],
  [/catch\s*\{/, 'optional catch binding — Chromium 66+'],
];

const CSS_RULES = [
  [/\bclamp\(/, 'CSS clamp() — Chromium 79+'],
  [/[^-\w]min\(/, 'CSS min() — Chromium 79+'],
  [/[^-\w]max\(/, 'CSS max() — Chromium 79+'],
  [/aspect-ratio\s*:/, 'CSS aspect-ratio — Chromium 88+'],
  [/[^-\w]inset\s*:/, 'CSS inset shorthand — Chromium 87+'],
  [/:where\(/, 'CSS :where() — Chromium 88+'],
  [/:is\(/, 'CSS :is() — Chromium 88+'],
  [/\bhas\(/, 'CSS :has() — Chromium 105+'],
  [/color-mix\(/, 'CSS color-mix() — Chromium 111+'],
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const problems = [];
let scanned = 0;

for (const file of walk(DIST)) {
  // check.html is hand-written ES5, but it carries modern syntax *inside
  // strings* as feature-detection probes (and names clamp() in a comment),
  // which this scanner cannot distinguish from real code. It is reviewed by
  // hand instead.
  if (file.endsWith('check.html')) continue;

  const isJs = file.endsWith('.js');
  const isCss = file.endsWith('.css');
  const isHtml = file.endsWith('.html');
  if (!isJs && !isCss && !isHtml) continue;

  const src = readFileSync(file, 'utf8');
  scanned++;

  const rules = isCss ? CSS_RULES : isJs ? JS_RULES : [...JS_RULES, ...CSS_RULES];
  for (const [re, label] of rules) {
    const m = src.match(re);
    if (m) {
      const idx = src.indexOf(m[0]);
      const snippet = src.slice(Math.max(0, idx - 40), idx + 60).replace(/\s+/g, ' ');
      problems.push({ file, label, snippet });
    }
  }
}

console.log(`Scanned ${scanned} built files in ${DIST}/`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} incompatibility/ies for Chromium 64-78:\n`);
  for (const p of problems) {
    console.error(`  ${p.file}`);
    console.error(`    ${p.label}`);
    console.error(`    …${p.snippet}…\n`);
  }
  process.exit(1);
}

console.log('✓ No constructs newer than Chromium 64 found.');
