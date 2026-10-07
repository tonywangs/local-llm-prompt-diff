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

Each input is limited to 1 MiB; bundles to 500 messages and 500 variables; templates to 64 KiB; metadata to 100 keys; reports to 5,000 changes and 4 MiB. File outputs are written through a same-directory temporary file and rename, so an error does not partially replace the destination. The comparator has a 5-second internal elapsed-time guard (normal bounded inputs finish much faster).

## Validation and reproduction

`npm test` runs core semantics, hostile-markup HTML escaping/self-contained checks, malformed-input checks, and 200 deterministic seeded bundle-pair comparisons against an independent reference oracle. The generated cases include Unicode, hostile markup metadata, reordered messages, added variables, role/template/default changes, and simultaneous changes. Run the command above to exercise the installed-equivalent CLI path offline.

## Limitations

This tool is intentionally syntax- and structure-aware rather than template-language-aware: it recognizes only `{{identifier}}` references, does not parse conditionals or other templating dialects, and does not judge semantic equivalence. Metadata cannot represent nested values. The included HTML check is static and does not substitute for manual testing in every browser; no Chromium binary is vendored or required.
