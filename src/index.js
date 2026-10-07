import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = Object.freeze({ inputBytes: 1_048_576, messages: 500, variables: 500, metadataKeys: 100, templateBytes: 65_536, changes: 5_000, outputBytes: 4_194_304, runtimeMs: 5_000 });
const ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const ROLES = new Set(['system', 'user', 'assistant', 'tool', 'developer']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const bad = message => { throw new Error(`invalid bundle: ${message}`); };
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export const stableJson = value => JSON.stringify(stable(value), null, 2);
function scalar(value) { return value === null || ['string', 'number', 'boolean'].includes(typeof value); }
function text(value, label, max = LIMITS.templateBytes) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max) bad(`${label} must be a string of at most ${max} bytes`);
}
function key(value, label) { if (typeof value !== 'string' || !ID.test(value)) bad(`${label} must match ${ID}`); }
export function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) bad('top level must be an object');
  if (bundle.formatVersion !== 1) bad('formatVersion must be 1');
  key(bundle.id, 'id');
  if (!Array.isArray(bundle.variables) || !Array.isArray(bundle.messages)) bad('variables and messages must be arrays');
  if (bundle.variables.length > LIMITS.variables || bundle.messages.length > LIMITS.messages) bad('too many variables or messages');
  const variables = new Set();
  for (const variable of bundle.variables) {
    if (!variable || typeof variable !== 'object' || Array.isArray(variable)) bad('each variable must be an object');
    key(variable.name, 'variable name'); if (variables.has(variable.name)) bad(`duplicate variable ${variable.name}`); variables.add(variable.name);
    if (own(variable, 'default')) text(variable.default, `default for ${variable.name}`);
    if (Object.keys(variable).some(k => k !== 'name' && k !== 'default')) bad(`unknown variable property on ${variable.name}`);
  }
  const messages = new Set();
  for (const message of bundle.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) bad('each message must be an object');
    key(message.id, 'message id'); if (messages.has(message.id)) bad(`duplicate message ${message.id}`); messages.add(message.id);
    if (!ROLES.has(message.role)) bad(`unsupported role on ${message.id}`); text(message.template, `template for ${message.id}`);
    if (Object.keys(message).some(k => k !== 'id' && k !== 'role' && k !== 'template')) bad(`unknown message property on ${message.id}`);
  }
  const metadata = bundle.metadata ?? {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).length > LIMITS.metadataKeys) bad('metadata must be a small object');
  for (const [k, v] of Object.entries(metadata)) { key(k, 'metadata key'); if (!scalar(v)) bad(`metadata ${k} must be scalar`); }
  if (Object.keys(bundle).some(k => !['formatVersion', 'id', 'variables', 'messages', 'metadata'].includes(k))) bad('unknown top-level property');
  for (const message of bundle.messages) for (const match of message.template.matchAll(/{{\s*([A-Za-z][A-Za-z0-9_.-]{0,127})\s*}}/g)) if (!variables.has(match[1])) bad(`template ${message.id} references undeclared variable ${match[1]}`);
  return bundle;
}
export function readBundle(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > LIMITS.inputBytes) throw new Error(`input exceeds ${LIMITS.inputBytes} bytes: ${file}`);
  let value; try { value = JSON.parse(bytes); } catch { throw new Error(`invalid JSON: ${file}`); }
  return validateBundle(value);
}
function push(changes, change) { if (changes.length >= LIMITS.changes) throw new Error('comparison exceeds change limit'); changes.push(change); }
function maps(items, property) { return new Map(items.map(item => [item[property], item])); }
export function compare(before, after, now = () => Date.now()) {
  const began = now(); validateBundle(before); validateBundle(after);
  const changes = [], bv = maps(before.variables, 'name'), av = maps(after.variables, 'name'), bm = maps(before.messages, 'id'), am = maps(after.messages, 'id');
  for (const name of [...new Set([...bv.keys(), ...av.keys()])].sort()) {
    if (!bv.has(name)) push(changes, { type: 'variable-added', name, after: av.get(name) });
    else if (!av.has(name)) push(changes, { type: 'variable-removed', name, before: bv.get(name) });
    else if ((bv.get(name).default ?? null) !== (av.get(name).default ?? null)) push(changes, { type: 'variable-default-changed', name, before: bv.get(name).default ?? null, after: av.get(name).default ?? null });
  }
  for (const id of [...new Set([...bm.keys(), ...am.keys()])].sort()) {
    if (!bm.has(id)) push(changes, { type: 'message-added', id, after: am.get(id) });
    else if (!am.has(id)) push(changes, { type: 'message-removed', id, before: bm.get(id) });
    else {
      const b = bm.get(id), a = am.get(id);
      if (b.role !== a.role) push(changes, { type: 'message-role-changed', id, before: b.role, after: a.role });
      if (b.template !== a.template) push(changes, { type: 'message-template-changed', id, before: b.template, after: a.template });
      if (before.messages.indexOf(b) !== after.messages.indexOf(a)) push(changes, { type: 'message-moved', id, beforeIndex: before.messages.indexOf(b), afterIndex: after.messages.indexOf(a) });
    }
  }
  const keys = [...new Set([...Object.keys(before.metadata ?? {}), ...Object.keys(after.metadata ?? {})])].sort();
  for (const name of keys) if ((before.metadata ?? {})[name] !== (after.metadata ?? {})[name]) push(changes, { type: 'metadata-changed', name, before: (before.metadata ?? {})[name] ?? null, after: (after.metadata ?? {})[name] ?? null });
  if (now() - began > LIMITS.runtimeMs) throw new Error('comparison exceeded runtime limit');
  const counts = Object.fromEntries([...new Set(changes.map(c => c.type))].sort().map(type => [type, changes.filter(c => c.type === type).length]));
  return { schemaVersion: 1, comparator: 'local-llm-prompt-diff/0.1.0', before: { id: before.id }, after: { id: after.id }, limits: LIMITS, summary: { changed: changes.length, byType: counts }, changes };
}
export function compareFiles(beforeFile, afterFile) { return compare(readBundle(beforeFile), readBundle(afterFile)); }
export function writeAtomic(file, content) {
  if (Buffer.byteLength(content) > LIMITS.outputBytes) throw new Error(`output exceeds ${LIMITS.outputBytes} bytes`);
  const target = path.resolve(file), temp = `${target}.${process.pid}.tmp`; fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, target); } catch (e) { try { fs.unlinkSync(temp); } catch {} throw e; }
}
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export function renderHtml(report) {
  const rows = report.changes.map((change, i) => `<article tabindex="0" data-type="${esc(change.type)}"><h2>${i + 1}. ${esc(change.type)}</h2><pre>${esc(stableJson(change))}</pre></article>`).join('') || '<p>No semantic changes.</p>';
  const types = Object.keys(report.summary.byType).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prompt diff review</title><style>body{font:16px system-ui;margin:2rem;max-width:70rem}article{border:1px solid #999;padding:1rem;margin:.75rem 0}article:focus{outline:3px solid #06c}pre{white-space:pre-wrap;overflow-wrap:anywhere}label{display:block;margin-bottom:1rem}</style><main><h1>Prompt template comparison</h1><p>${esc(report.before.id)} → ${esc(report.after.id)}: ${report.summary.changed} changes</p><label>Filter change type <select id="filter"><option value="">All</option>${types}</select></label><section aria-live="polite">${rows}</section></main><script>const s=document.querySelector('#filter'),a=[...document.querySelectorAll('article')];s.onchange=()=>a.forEach(x=>x.hidden=!!s.value&&x.dataset.type!==s.value);document.onkeydown=e=>{if(e.key==='/'&&!/input|select/i.test(document.activeElement.tagName)){e.preventDefault();s.focus()}};</script></html>`;
  if (Buffer.byteLength(html) > LIMITS.outputBytes) throw new Error(`output exceeds ${LIMITS.outputBytes} bytes`); return html;
}
