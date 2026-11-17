---
'@objectstack/lint': patch
'@objectstack/runtime': patch
---

fix(lint, runtime)!: an action body that cannot compile in its `(async (input, ctx) => { … })` wrapper is refused at validate, build and publish, and at run time answers naming the action and the compile error

Clause-②: no (narrowing) — an L2 action body (`type: 'script'`, `body.language: 'js'`) that does not compile as the body of `(async (input, ctx) => { … })` passed `os validate`, `os build`, `os lint`, `os verify` and the runtime publish door (`action` and `object` writes); it is now refused there as `action-body-does-not-compile` at `error`, except a regular-expression literal the host engine refuses, which is a `warning`. Such a body never ran: every run failed with a SyntaxError before its first statement. `@objectstack/lint` also gains the exports `validateActionBodyCompiles`, `hostCompileFailure`, `ACTION_BODY_DOES_NOT_COMPILE`, `ACTION_BODY_PARAMETERS`, `actionBodyFunctionExpression` and two finding types on `.`, and `actionBodyFunctionExpression` on `./runtime`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what is refused is a body.source string that never compiled in the runtime, so no run of it ever succeeded and there is nothing for a migration to rewrite -->

**BREAKING** for a stack carrying an action body that does not compile in the runtime's wrapper, most often one that declares a wrapper parameter again (`const input = ctx.input || {}`, `let ctx = …`): `os validate`, `os build` and the publish door now refuse it, naming the action, the compile error and its line. The fix: read the params as `input` (they are also `ctx.input`), or give the local another name (`const params = ctx.input || {}`); `var input = …` compiles.

The rule compiles the body inside the expression the runtime builds, from the same function (`actionBodyFunctionExpression`, which the QuickJS runner now builds its wrapper from), with the host's JavaScript engine and without running it. Run `os explain action-body-does-not-compile` for what it judges and where the host's engine and the runtime's QuickJS differ.

At run time, an action whose body still does not compile (one deployed before this release, or syntax the host engine accepts and QuickJS does not) answers `500 INTERNAL_ERROR` on the `/actions` door and MCP `run_action` with the sentence `Action 'NAME' cannot run: its body does not compile (SyntaxError: …). The action's author must fix its body.source and publish it again.`, where it answered `500 INTERNAL_ERROR "Internal server error"`. The server log line reads `action 'NAME' does not compile: SyntaxError: …`. A body that crashes while running (a `TypeError`, a `SyntaxError` thrown by `JSON.parse`) still answers the sanitised `500`. Hook and job bodies are unchanged.
