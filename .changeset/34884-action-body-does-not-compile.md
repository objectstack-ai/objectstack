---
'@objectstack/lint': minor
'@objectstack/spec': minor
'@objectstack/runtime': patch
---

fix(lint, runtime)!: an action body that cannot compile in its `(async (input, ctx) => { … })` wrapper is refused at validate, build and publish, and at run time answers naming the action and the compile error

Clause-②: no (narrowing) — an L2 action body (`type: 'script'`, `body.language: 'js'`) that does not compile as the body of `(async (input, ctx) => { … })` passed `os validate`, `os build`, `os lint`, `os verify` and the runtime publish door (`action` and `object` writes); it is now refused there as `action-body-does-not-compile` at `error`, except a regular-expression literal the host engine refuses, which is a `warning`. Such a body never ran: every run failed with a SyntaxError before its first statement. `@objectstack/lint` also gains the exports `validateActionBodyCompiles`, `hostCompileFailure`, `ACTION_BODY_DOES_NOT_COMPILE`, `ACTION_BODY_PARAMETERS`, `actionBodyFunctionExpression` and two finding types on `.`, and `actionBodyFunctionExpression` on `./runtime`.
Metadata-protocol: narrowed
Skills-docs: follow-up owed — `skills/objectstack-data/references/data-hooks.md` teaches the action wrap `(async (input, ctx) => { … })` without saying a body must not declare `input` / `ctx` again; this change teaches it in `content/docs/ui/actions.mdx` and `content/docs/automation/hook-bodies.mdx`.

<!-- adr-0087: registered action-body-does-not-compile-refused -->

**BREAKING** only for an action body that never ran. The runtime compiles an L2 action's `body.source` as the statements of `(async (input, ctx) => { SOURCE })`, so a body that declares a wrapper parameter again (`const input = ctx.input || {}`, `let ctx = …`), or fails to compile there for any other reason, raises a SyntaxError before its first statement. Every authoring door accepted it: the parse check (`action-body-source-unparseable`) reads the source inside a different wrapper, and a parser reports no redeclaration. It deployed clean, and then every run of the action answered `500 INTERNAL_ERROR "Internal server error"` on the `/actions` door and MCP `run_action`. `action-body-does-not-compile` now refuses it at `os validate`, `os build`, `os lint` and the runtime publish door (`422 INVALID_METADATA`), naming the action, the compile error and its line of `body.source`. The publish door runs the rule on `object` writes too, so an object write cannot republish a refused body inline in `actions[]`. Hook and job bodies (`(async (ctx) => { … })`) are not judged. Measured first-party exposure: zero — `os validate` over the example apps reports no finding, and no skill or docs sample carries an action body that redeclares `input` or `ctx`.

**FROM → TO.** FROM `body: { language: 'js', source: 'const input = ctx.input || {}; return input.amount;' }` (accepted at every door, failing every run) TO `source: 'const params = ctx.input || {}; return params.amount;'` (or `return input.amount;`).

**Fix:** read the params as `input` (they are also `ctx.input`), or give the local another name (`const params = ctx.input || {}`); `var input = …` compiles. Fix any other compile error the finding names at the line it names. The semantic entry `action-body-does-not-compile-refused` carries the same notice into the upgrade guide and `os migrate meta`. `os explain action-body-does-not-compile` says what the rule judges and where the host's engine and the runtime's QuickJS differ.

The rule compiles the body inside the expression the runtime builds, from the same function (`actionBodyFunctionExpression`, which the QuickJS runner now builds its wrapper from, byte for byte as before), with the host's JavaScript engine and without running it.

At run time, an action whose body still does not compile (one deployed before this release, or syntax the host engine accepts and QuickJS does not) answers `500 INTERNAL_ERROR` on the `/actions` door and MCP `run_action` with the sentence `Action 'NAME' cannot run: its body does not compile (SyntaxError: …). The action's author must fix its body.source and publish it again.`, where it answered `500 INTERNAL_ERROR "Internal server error"`. The server log line reads `action 'NAME' does not compile: SyntaxError: …`. A body that crashes while running (a `TypeError`, a `SyntaxError` thrown by `JSON.parse`) still answers the sanitised `500`.
