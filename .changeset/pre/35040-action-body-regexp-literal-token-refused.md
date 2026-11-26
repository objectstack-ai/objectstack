---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint)!: an action body whose regular-expression literal never closes, or whose flags are not a flag set, is refused, not only warned about

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no published skill teaches the action-body compile check or regular-expression literals in an action body

<!-- adr-0087: registered action-body-regexp-literal-token-refused -->

**BREAKING** only for an action body that never ran. `action-body-does-not-compile` compiles an L2 action's `body.source` inside `(async (input, ctx) => { … })` with the host's JavaScript engine, and reported every failure whose sentence opens `Invalid regular expression` at `warning`, because the host's V8 and the runtime's QuickJS differ on some patterns. That sentence also opens V8's two token errors: a literal that never closes on its line (`return /abc;`, `return /[/;`, a literal broken by a line terminator: `Invalid regular expression: missing /`) and a flag set that is not one (`/a/gg`, `/a/zz`, `/a/uv`: `Invalid regular expression flags`). QuickJS refuses every one of them, so such a body passed `os validate`, `os build`, `os lint` and the runtime publish door, and every run of the action failed with the coded `500` that names the action and the compile error.

What moves (FROM → TO):

- `action-body-does-not-compile` on an unterminated regular-expression literal or an invalid flag set (`validateActionBodyCompiles`, `@objectstack/lint`): FROM `warning` TO `error` at `os validate`, `os build`, `os lint` and the runtime publish door (`action` and `object` writes, `422 INVALID_METADATA`), with a hint that names the fix. A failure in the literal's pattern (a duplicate named capture group, a modifier group: syntax QuickJS accepts and runs) is still a `warning`.
- `os explain action-body-does-not-compile` and the ADR-0087 entry `action-body-does-not-compile-refused` now say that only a pattern the host refuses is a warning.

The fix: close the literal with `/`, write a `/` inside it as `\/`, or, when the `/` is a division, give it a left-hand operand; write the flags as letters from `dgimsuvy`, each at most once, never `u` with `v`.

No conversion is made (ADR-0087 D3, entry `action-body-regexp-literal-token-refused`): whether a `/` opened a literal or meant a division is the author's choice. Measured first-party exposure: zero.
