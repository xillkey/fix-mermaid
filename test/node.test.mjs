/**
 * Node 端回归测试：用真实的 mermaid.parse（jsdom 提供 DOM）校验 test/cases.mjs 中的所有用例。
 *   npm test
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { default: mermaid } = await import('mermaid');
const { safeRepairMermaid, createMermaidParser } = await import('../src/fixMermaid.js');
const { cases } = await import('./cases.mjs');

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
const parse = createMermaidParser(mermaid);

let failed = 0;
for (const c of cases) {
  const before = await parse(c.src);
  const r = await safeRepairMermaid(c.src, parse);
  const expectOk = c.expectFixable !== false;
  const pass = r.ok === expectOk;
  if (!pass) failed++;
  const tag = pass ? 'PASS' : 'FAIL';
  const detail = before ? (r.ok ? 'repaired' : 'not repaired') : (r.fixes.length ? 'semantic fix' : 'untouched');
  console.log(`${tag}  ${c.id.padEnd(5)} ${detail.padEnd(13)} ${c.title}`);
  if (!pass) console.log('      error:', (r.error || '').split('\n')[0]);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
