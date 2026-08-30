---
'@objectstack/sdui-parser': minor
---

sdui-parser: `interpretBrace` materializes the JS literal subset, in lockstep with objectui

The html tier's braced attribute values accepted strict JSON only, so the spelling every
JSX author and every AI author writes — `columns={['name','amount']}` — compiled to the
deferred `{ $expr }` marker that nothing downstream evaluates, and the author's data
binding vanished at render. Under the maintainer's ruling on objectui#6614 (Q1-A,
2026-08-28) `interpretBrace` now materializes the JS **literal subset**: exactly two
widenings over JSON — single-quoted strings (value position and key position) and unquoted
identifier object keys.

Everything else JSON refuses is still refused and still becomes `{ $expr }`: trailing
commas, comments, array holes, spreads, `undefined` / `NaN` / `Infinity`, `+1` / `.5` /
`1.` / `0x1f`, template literals, and every genuine expression. `JSON.parse` still runs
first and untouched, so strict-JSON behaviour is invariant by construction, and the subset
contains no identifier lookup and no operator — the widening moves habitual spellings onto
the materialized side, it does not move the data/code boundary (ADR-0080: this tier parses,
never executes).

An authored `__proto__` key is written as an own data property, the way `JSON.parse` gives
it, never through the prototype setter — a plain assignment in the unquoted-key path would
hand untrusted page source a prototype-pollution lever the strict-JSON path never had.

The `inert-expression` diagnostic message is reworded to match: the old text advised
writing the value as JSON with double-quoted strings and keys, which now names a legal
spelling as the wrong one. Diagnostic **codes** are unchanged.
