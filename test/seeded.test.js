import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/index.js';

function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function make(seed, changed) {
  const r = rng(seed), n = 1 + Math.floor(r() * 7), vars = Array.from({ length: n }, (_, i) => ({ name: `v${i}`, ...(i % 2 ? {} : { default: `d${i}😀` }) }));
  const messages = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 3 === 0 ? 'system' : 'user', template: `line ${i} {{v${i}}}` }));
  const b = { formatVersion: 1, id: `b${seed}`, variables: vars, messages, metadata: { seed, tag: '<hostile>' } };
  if (!changed) return b;
  const a = structuredClone(b); a.id = `a${seed}`;
  switch (seed % 5) {
    case 0: a.variables[0].default = 'changed'; break;
    case 1: a.variables.push({ name: 'newVar', default: 'x' }); a.messages[0].template += ' {{newVar}}'; break;
    case 2: a.messages[0].role = 'developer'; break;
    case 3: a.messages.reverse(); break;
    default: a.metadata.seed += 1; a.messages[0].template += '\\nchanged';
  }
  return a;
}
// Independent oracle: it deliberately counts only semantic field differences, not comparator internals.
function oracle(b, a) {
  const out = []; const bv = new Map(b.variables.map(x => [x.name, x])), av = new Map(a.variables.map(x => [x.name, x]));
  for (const k of new Set([...bv.keys(), ...av.keys()])) { if (!bv.has(k)) out.push('variable-added'); else if (!av.has(k)) out.push('variable-removed'); else if ((bv.get(k).default ?? null) !== (av.get(k).default ?? null)) out.push('variable-default-changed'); }
  const bm = new Map(b.messages.map(x => [x.id, x])), am = new Map(a.messages.map(x => [x.id, x]));
  for (const k of new Set([...bm.keys(), ...am.keys()])) { if (!bm.has(k)) out.push('message-added'); else if (!am.has(k)) out.push('message-removed'); else { const x=bm.get(k), y=am.get(k); if(x.role!==y.role)out.push('message-role-changed'); if(x.template!==y.template)out.push('message-template-changed'); if(b.messages.indexOf(x)!==a.messages.indexOf(y))out.push('message-moved'); } }
  for (const k of new Set([...Object.keys(b.metadata),...Object.keys(a.metadata)])) if(b.metadata[k]!==a.metadata[k])out.push('metadata-changed'); return out.sort();
}
test('200 seeded pairs agree with an independent reference oracle', () => {
  for (let seed = 1; seed <= 200; seed++) { const before = make(seed, false), after = make(seed, true); assert.deepEqual(compare(before, after).changes.map(x => x.type).sort(), oracle(before, after), `seed ${seed}`); }
});
