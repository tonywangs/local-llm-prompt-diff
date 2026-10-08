import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, renderHtml, validateBundle } from '../src/index.js';

const bundle = (overrides = {}) => ({ formatVersion: 1, id: 'demo', variables: [{ name: 'name', default: 'Ada' }], messages: [{ id: 'one', role: 'system', template: 'Hi {{name}}' }], metadata: { revision: 1 }, ...overrides });
test('classifies all core changes deterministically', () => {
  const before = bundle();
  const after = bundle({ variables: [{ name: 'name', default: 'Lin' }, { name: 'topic' }], messages: [{ id: 'two', role: 'user', template: 'Ask {{topic}}' }, { id: 'one', role: 'developer', template: 'Hello {{name}}' }], metadata: { revision: 2 } });
  const report = compare(before, after);
  assert.deepEqual(report.changes.map(c => c.type), ['variable-default-changed', 'variable-added', 'message-role-changed', 'message-template-changed', 'message-moved', 'message-added', 'metadata-changed']);
  assert.equal(compare(before, after).changes.length, report.changes.length);
});
test('rejects dangerous ambiguity and undeclared references', () => {
  assert.throws(() => validateBundle(bundle({ messages: [{ id: 'one', role: 'system', template: '{{missing}}' }] })), /undeclared/);
  assert.throws(() => validateBundle(bundle({ messages: [{ id: 'one', role: 'system', template: 'x' }, { id: 'one', role: 'user', template: 'x' }] })), /duplicate/);
  assert.throws(() => validateBundle(bundle({ metadata: { nested: {} } })), /scalar/);
});
test('HTML is self contained, escaped, filterable, and keyboard accessible', () => {
  const report = compare(bundle({ id: 'before' }), bundle({ id: 'after', messages: [{ id: 'one', role: 'system', template: '<img src=x onerror=1>{{name}}' }] }));
  const html = renderHtml(report);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /<select id="filter">/); assert.match(html, /a.tabIndex=0/); assert.match(html, /document.onkeydown/);
  assert.doesNotMatch(html, /https?:\/\//);
});
