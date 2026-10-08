# local-llm-prompt-diff

An offline, dependency-free CLI for comparing two JSON prompt-template bundles. It never renders a template and makes no network or model/API calls.

## Quick start

Requires Node.js 20+. From this checkout:

```sh
npm test
node bin/prompt-diff.js compare examples/before.json examples/after.json --json /tmp/report.json --html /tmp/report.html
```

The package exposes the same command as `prompt-diff` after installation. Output JSON is canonical (object keys are sorted), while change ordering is stable: variables, messages, and metadata are each compared by identifier/key.

## Bundle format

```json
{
  "formatVersion": 1,
  "id": "support-prompt",
  "variables": [{"name": "customer", "default": "friend"}],
  "messages": [{"id": "policy", "role": "system", "template": "Hello {{customer}}"}],
  "metadata": {"revision": 1}
}
```

Identifiers use letters followed by letters, digits, `.`, `_`, or `-`. Each message has a unique ID and one of `system`, `developer`, `user`, `assistant`, or `tool` roles. Variables have unique names. `{{variable}}` references must name a declared variable; this is validation only, never interpolation. Metadata is a flat object with scalar values.

The report distinguishes variable additions/removals/default changes, message additions/removals, role and template changes, relative message index changes, and metadata value changes. Messages are matched by ID, so changing an ID is intentionally modeled as remove plus add. The self-contained HTML report escapes all content, has a type filter, focusable change records, and `/` focuses the filter. It contains no external resource URLs.

## Bounds and safety

Each input is limited to 1 MiB; bundles to 500 messages and 500 variables; templates to 64 KiB; metadata to 100 keys; reports to 5,000 changes and 4 MiB. File outputs require new destinations and use staged hard-link publication with rollback on handled errors; see the precise paired-output guarantees below. The comparator has a 5-second internal elapsed-time guard (normal bounded inputs finish much faster).

## Validation and reproduction

`npm test` runs core semantics, hostile-markup HTML escaping/self-contained checks, malformed-input checks, and 200 deterministic seeded bundle-pair comparisons against an independent reference oracle. The generated cases include Unicode, hostile markup metadata, reordered messages, added variables, role/template/default changes, and simultaneous changes. Run the command above to exercise the installed-equivalent CLI path offline.

## Limitations

This tool is intentionally syntax- and structure-aware rather than template-language-aware: it recognizes only `{{identifier}}` references, does not parse conditionals or other templating dialects, and does not judge semantic equivalence. Metadata cannot represent nested values. Chromium verification covers the bounded cases described below; it does not establish compatibility with every browser. No Chromium binary is vendored. The CLI itself does not require a browser.

## Review and publication guarantees

Review pages mount at most 40 findings, with Previous/Next buttons and a type filter. Every finding is reachable, including after filtering. Select Full finding, Before, or After; missing values display `(absent)`, and moves display their original/new indices. `/` focuses the filter. Tab reaches the controls and findings; Up/Down moves between findings and across pages. Content is inserted as text. A restrictive content security policy blocks external resources. JavaScript is required for interactive review; JSON remains available without it.

Output parent directories must already exist. Destinations must be new paths: existing files, directories, and symlinks are rejected, including input paths and identical JSON/HTML destinations. Both reports are serialized and size-checked before publication. Each is staged in its destination directory with exclusive creation and mode 0600, flushed, then published using a hard link that fails if the destination exists. No overwrite option is provided.

Handled errors and cooperative API cancellation roll back files created by that call, retaining preexisting files and cleaning staging files. Cleanup errors are reported explicitly. Filesystems must support hard links. This is **not an atomic two-file transaction**: concurrent readers can briefly see one output, and process termination (including CLI signals), power loss, or cleanup errors can leave a complete single report or staging files. Directory entries are not fsynced. Use fresh output directories and consume the pair only after successful CLI exit. The exported `publishReports(entries, {signal})` supports an already-aborted or synchronously observed AbortSignal; synchronous I/O does not service event-loop cancellation mid-call. A JSON stdout failure after HTML publication cannot roll back the HTML.

Input file reading allocates at most 1 MiB + 1 byte and rejects nonregular files. The library also caps canonical, pretty-printed bundle JSON at 1 MiB; compact files near 1 MiB may therefore be rejected after normalization. The aggregate comparison-work limit is 2,100 records across both bundles (messages + variables + metadata keys), in addition to the individual limits. Message index lookups use maps. The 5-second elapsed-time guard detects over-budget synchronous comparisons at completion; it is not a preemptive process deadline and excludes HTML generation and disk I/O. Each output is capped at 4 MiB; HTML escaping can make HTML larger than JSON. Paginated DOM size does not remove the bounded full report from browser memory.

## Full browser and installed-package verification

Install development tooling once (network required only for setup):

```sh
npm ci --cache /tmp/prompt-diff-npm
PLAYWRIGHT_BROWSERS_PATH=/tmp/prompt-diff-browsers node node_modules/playwright/cli.js install chromium
```

Then run one verification command:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/prompt-diff-browsers npm run verify
```

It runs the unit and independent comparator regressions, packs and installs the CLI into a fresh directory with npm offline and an empty cache, checks repeat output bytes and input hashes, and exercises installed output plus 200 seeded reports in Chromium. Findings and before/after values are checked against JSON, including hostile markup, Unicode, message reorder, variable changes, and simultaneous changes. A 2,050-finding case traverses all pages and type filters and checks keyboard page boundaries. Narrow (320 px) and wide viewports, visible focus, no-change output, and external request attempts are checked. Browser absence fails verification rather than skipping it. Use `CHROMIUM_EXECUTABLE` to select an existing compatible binary instead.

`npm run verify -- --record` updates `results/verification.json` with actual browser version, runtime, Node verifier peak RSS, report sizes, and DOM counts. Peak RSS excludes Chromium and child processes. Tests use browser offline mode, blocked service workers, and abort all non-file routes; this is page-level network isolation, not an OS-wide firewall. The CLI has no runtime dependencies or network API. Measurements vary by machine and are not performance guarantees.

## Design references and inspected gaps

The original implementation used sequential rename publication (overwriting destinations and allowing a JSON-only result if HTML failed), read whole inputs before size checks, and mounted all findings without before/after controls. Its independent seeded oracle is retained. This milestone applies established techniques and makes no novelty claim. Node's [filesystem API](https://nodejs.org/api/fs.html) documents exclusive creation, hard links, and rename behavior. Playwright's [network interception](https://playwright.dev/docs/network) and [BrowserContext](https://playwright.dev/docs/api/class-browsercontext) document route blocking, offline emulation, and service-worker limitations. The existing Playwright implementation supplies the browser driver; no browser engine is vendored.

The existing [npm/write-file-atomic](https://github.com/npm/write-file-atomic) implementation stages, flushes, and renames individual files and intentionally replaces existing destinations. That API does not provide this tool's no-overwrite paired-output policy; the small publisher here uses exclusive hard-link creation and explicit rollback instead. Use directories you control: inode checks avoid deleting an observed replacement during rollback, but this is not protection against an adversary continuously replacing directory entries.
