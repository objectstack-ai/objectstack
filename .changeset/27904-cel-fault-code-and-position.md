---
'@objectstack/formula': patch
---

feat(formula): a CEL syntax refusal keeps the engine's own fault code and the source range it points at, so an editor can say what is wrong and where in its own words (#27904)

Clause-②: no
Metadata-protocol: none

`validateExpression`'s catch-all CEL refusal, `invalid-cel`, now carries two optional params beside `role` and `detail`:

- `celCode` — cel-js's own code for the fault, read off its error object: the parser's for a syntax fault (`unexpected_token` when an operand or the end is missing, `expected_token` when a closing `)` / `]` / `}` is missing, `unexpected_character`, `unterminated_string`, …) or the checker's for a type fault (`no_such_overload`, …).
- `pos` — `{ start, end }`, the UTF-16 offsets into `source` that the engine points at (`end` exclusive). A missing `)` reads `start === end === source.length`.

Both are absent when the engine reported none, and `pos` is absent when the engine read a source the platform rewrote first (the null-guard ternary lowering), since a range into that text would point at characters the author never wrote. A guessed `0` is never written.

`EvalError.pos`, declared before and never filled, is now filled by `celEngine.compile` and `celEngine.evaluate` for a cel-js parse, check or evaluation fault that carries a range, on the same terms.

The refusal's `message` is unchanged, byte for byte, and so are the codes and the params of every other refusal.
