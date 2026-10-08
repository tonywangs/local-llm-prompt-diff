import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LIMITS } from './index.js';

// A pair is rollback-on-error, not a filesystem-wide atomic transaction.
export function publishReports(entries, { signal, io = fs } = {}) {
  const check = () => { if (signal?.aborted) throw new Error('publication cancelled'); };
  const prepared = entries.map(({ file, content }) => {
    check();
    if (typeof content !== 'string') throw new TypeError('report content must be serialized text');
    if (Buffer.byteLength(content) > LIMITS.outputBytes) throw new Error('output exceeds byte limit');
    return { target: path.resolve(file), content };
  });
  if (new Set(prepared.map(x => x.target)).size !== prepared.length) throw new Error('duplicate output destination');
  const staged = [], linked = [];
  let failure;
  try {
    for (const item of prepared) {
      check();
      try { io.lstatSync(item.target); throw new Error(`destination exists: ${item.target}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temp = path.join(path.dirname(item.target), `.prompt-diff-${randomUUID()}.tmp`);
      const fd = io.openSync(temp, 'wx', 0o600);
      staged.push({ ...item, temp });
      try { io.writeFileSync(fd, item.content); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    }
    for (const item of staged) { check(); io.linkSync(item.temp, item.target); linked.push(item); }
    check();
  } catch (error) { failure = error; }
  const cleanupErrors = [];
  if (failure) for (const item of linked.reverse()) {
    try {
      const original = io.lstatSync(item.temp), current = io.lstatSync(item.target);
      if (original.ino === current.ino && original.dev === current.dev) io.unlinkSync(item.target);
    } catch (error) { if (error.code !== 'ENOENT') cleanupErrors.push(error); }
  }
  for (const item of staged) try { io.unlinkSync(item.temp); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'publication cleanup failed; inspect destinations and .prompt-diff-*.tmp files');
  if (failure) throw failure;
}
export function writeAtomic(file, content, options) { publishReports([{ file, content }], options); }
