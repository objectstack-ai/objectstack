---
"@objectstack/spec": patch
---

docs(spec): state the transition-gate vs invariant boundary where each tool is declared

`Field.requiredWhen` and the field bounds (`min` / `max` / `minLength` /
`maxLength`) are **transition gates**; a `validations[]` `script` rule is a
**true invariant**. Both semantics are deliberate, and neither moves here — what
was missing is that no surface said so, while "required when X" reads to a human
and to an AI metadata author as an invariant. Measured downstream: three rules
written in prose as invariants were all implemented with the gate tool, with
nothing to signal the difference.

The contract text now says it at each declaration, in the copy that ships as the
JSON Schema `description` and as the generated reference page:

- `Field.requiredWhen` — the write is refused only when the merged record
  violates AND the pre-write record complied. So the write that flips the
  predicate TRUE, an INSERT born inside the gate, and a write that clears the
  cell are refused, while a row that was already missing the value keeps passing
  unrelated edits and state moves that stay inside the gate (ADR-0113
  non-regression: adding the rule to a deployed object never bricks existing
  rows).
- `min` / `max` / `minLength` / `maxLength` — checked on the WRITTEN value only,
  because an UPDATE validates just the fields the payload carries; a stored
  out-of-bound value is never re-read.
- `validations[]` `script` `condition` — re-evaluated against the merged record
  on every write with no exemption for a violation that was already stored, so a
  violating row is refused on any edit until a repairing write lands: frozen,
  not bricked.
- The inline-grid column `requiredWhen` — presentation only. Nothing on the
  write path reads it; the enforced contract is the child field's own
  `requiredWhen`.

Each half names the other tool, so a reader who picked the wrong one is
redirected rather than merely described to. No schema, accepted key set,
validator or runtime behaviour changes.
