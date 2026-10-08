#!/usr/bin/env node
import { compareFiles, renderHtml, stableJson, publishReports } from '../src/index.js';

const usage = `Usage: prompt-diff compare BEFORE.json AFTER.json [--json FILE] [--html FILE]\n\nCompares local prompt-template bundles only; no templates are evaluated or transmitted.`;
function die(message) { process.stderr.write(`error: ${message}\n`); process.exitCode = 2; }
const args = process.argv.slice(2);
if (args[0] !== 'compare' || args.length < 3) { die(usage); }
else {
  const [, before, after, ...options] = args;
  let jsonPath, htmlPath;
  for (let i = 0; i < options.length; i += 2) {
    if ((options[i] !== '--json' && options[i] !== '--html') || !options[i + 1]) { die(usage); break; }
    if ((options[i] === '--json' && jsonPath) || (options[i] === '--html' && htmlPath)) { die('duplicate output option'); break; }
    if (options[i] === '--json') jsonPath = options[i + 1]; else htmlPath = options[i + 1];
  }
  if (!process.exitCode) {
    try {
      const report = compareFiles(before, after);
      const json = stableJson(report) + '\n';
      const entries = [];
      if (jsonPath) entries.push({ file: jsonPath, content: json });
      if (htmlPath) entries.push({ file: htmlPath, content: renderHtml(report) });
      publishReports(entries);
      if (!jsonPath) process.stdout.write(json);
    } catch (error) { die(error.message); }
  }
}
