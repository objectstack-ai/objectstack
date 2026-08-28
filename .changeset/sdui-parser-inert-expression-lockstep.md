---
'@objectstack/sdui-parser': minor
---

html tier: a braced attribute value that is not strict JSON now draws an `inert-expression` warning instead of vanishing silently

`interpretBrace` materializes strict-JSON values only; anything else — the
single-quoted array every JSX author writes (`columns={['name','amount']}`),
unquoted object keys, any JS expression — compiles to the deferred `{ $expr }`
marker, and nothing downstream evaluates that marker: this tier parses, never
executes (ADR-0080), and no renderer consumes `$expr`. The value reached the
renderer as an opaque object, defensive non-array/non-object reads degraded it
to "not declared", and the author's binding vanished with zero diagnostics
anywhere — a production page's `list-view` rendered its row count and toolbar
with no data columns, through eight `columns` spellings (objectui#6598). That
is ADR-0078's prohibited parsed-but-silently-inert state.

`validateTree` now emits a warning-severity `inert-expression` diagnostic when a
declared input's value is the `$expr` marker, with the fix in the message: write
the value as JSON (double-quoted strings and keys).

This is the lockstep port of objectui PR #6613 into this repo's hoisted copy of
the parser. There are two copies, and the invariant is that both agree on the
accepted grammar **and** on diagnostic codes — if they drift, the save gate and
the renderer speak different dialects, and a page can save clean and render
inert. The emitted diagnostic is byte-equal to objectui's.

Warning, not error, per the objectui#5709 posture for inert authored keys: this
reports an **already**-inert state, so the accept/reject set does not move.
Pages that compiled before still compile, and a warning is non-gating on every
consuming surface in this repo (`runtime-gate` files warnings as advisories, not
as write refusals; `os lint` exits non-zero on error-severity findings only).
The silence is what changed. Escalating the severity, widening the accepted
literal grammar (single-quoted strings, unquoted keys), and wiring the registry
manifest into `validate-jsx-pages` — without which this warning is recorded in
compile output but displayed by no production surface — are separate decisions
tracked on objectui#6614 and its follow-ups.
