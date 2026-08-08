---
'@objectstack/formula': patch
---

fix(formula): `classifyError` grades a CEL fault by error class + code, never by the message (#6223)

`EvalResult.error.kind` is author-facing — `@objectstack/objectql`'s `cel-fault`
puts it in front of the author as `` `${kind}: ${first line}` `` and
`packages/rest` re-emits it as the HTTP body's `reason`. cel-js embeds the
author's own **source line** in `message` (`formatErrorWithHighlight`), so a
classifier that regex-matches that text is matching text the author writes.
PR #6202 closed the `ParseError` arm this way and left `type` / `runtime` on the
keyword table pending a per-code audit. This is that audit, and its verdict is
that the table goes entirely.

Measured on cel-js 8.0.0 — one `no such overload` **evaluation** fault, four
field names, three wrong answers:

```text
record.status        > 1  ->  runtime   (right)
record.parse_status  > 1  ->  parse     (wrong)
record.syntax_mode   > 1  ->  parse     (wrong)
record.type_code     > 1  ->  type      (wrong)
```

`parse` is the inverse of the #6133 misdirection: the expression is
syntactically perfect and failed on the data, and the author was told to go fix
an expression that has nothing wrong with it.

`classifyError` now reads only structured contract:

- `ParseError` -> `bounds` when `code === 'limit_exceeded'`, else `parse`
  (unchanged, from #6202);
- `EvaluationError` -> `type` for the one declaration-class code
  (`unknown_variable`, the root identifier is not bound in this scope at all),
  else `runtime`;
- anything that is not a cel-js error -> `runtime`.

Two findings from the audit worth recording. First, the residual keyword arm was
**not** dormant: `matches()` is an ObjectStack stdlib binding over `new
RegExp(...)`, so an uncompilable pattern escapes as a native `SyntaxError` whose
message echoes the pattern — and the pattern can come off the row, not just out
of the source. `matches(record.name, record.re)` with `re = "type("` was
graded `type`; with `"Exceeded maxAstNodes("` it was graded `bounds`. A data
value was picking the error kind. Second, there is deliberately no `TypeError`
arm: cel-js raises that class only from its non-evaluating `TypeChecker`, which
runs only inside `Environment#check`, and that method catches it and *returns*
`{ valid: false, error }`. The check-time `TypeError -> type` mapping already
lives in `celEngine.compile`, which reads that object.

Six evaluate-time codes change verdict from `type` to `runtime`
(`int_conversion_error`, `uint_conversion_error`, `double_conversion_error`,
`invalid_index_type`, `heterogeneous_list_element`,
`invalid_comprehension_range`). Each is a fault decided against the row; every
one of them was graded `type` only because cel-js happens to use the word "type"
in its prose (`int() type error: cannot convert to int`). Every evaluate-time
code the engine can reach now has a fixture pinning its `kind`.
