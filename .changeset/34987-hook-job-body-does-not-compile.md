---
'@objectstack/lint': minor
'@objectstack/runtime': minor
'@objectstack/spec': minor
---

fix(lint)!: a hook body or job body that does not compile in the wrapper the runtime runs it in is refused

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-data/references/data-hooks.md (its "Sandbox restrictions" section teaches what a body may contain and names no compile check)

<!-- adr-0087: registered hook-job-body-does-not-compile-refused -->

**BREAKING** only for a hook or job body that never ran. The runtime runs an L2 hook body and an L2 job body (`body.language: 'js'`) as the body of `(async (ctx) => { … })`. A source that does not compile there, such as `const ctx = ctx.input || {}` (the parameter declared again) or `let x = 1; let x = 2;`, raised a SyntaxError before its first statement on every run, yet passed `os validate`, `os build`, `os lint` and the runtime publish door: the hook parse check reads the source with a parser, which reports no redeclaration, and a job body had no check at all.

What moves (FROM → TO):

- New gating rule `validateHookAndJobBodyCompiles` (`@objectstack/lint`), rule ids `hook-body-does-not-compile` and `job-body-does-not-compile`: FROM no finding TO `error` at `os validate`, `os build`, `os lint`, and at the runtime publish door for `hook` writes (`422 INVALID_METADATA`). No door publishes a job, so a job body is refused by the three commands. A hook lowered from an inline `handler` is located at `hooks[N].handler`. The severity split is `action-body-does-not-compile`'s, read through the same `judgeBodyCompile`: a regular-expression pattern the host engine refuses is a `warning`, and every other compile failure is an `error`.
- `hookBodyFunctionExpression` and `HOOK_BODY_PARAMETERS` (`@objectstack/lint`, the first also on `@objectstack/lint/runtime`): the one spelling of the `(ctx)` wrapper. The runtime's QuickJS runner now builds the hook and job wrapper from it, byte for byte the wrapper it built before, so the check and the run cannot disagree about it.
- `judgeBodyCompile`, `BodyCompileVerdict` and `BodyCompileShape` (`@objectstack/lint`): the compile-and-classify core both rules share. `action-body-does-not-compile` reads it with unchanged findings.
- `os explain hook-body-does-not-compile` and `os explain job-body-does-not-compile` explain both rules.

The fix: use `ctx` as it is, or give the local another name (`const input = ctx.input || {}` in a hook, `const api = ctx.api` in a job); declare each name once; fix any other compile error at the line of `body.source` the finding names.

No conversion is made (ADR-0087 D3, entry `hook-job-body-does-not-compile-refused`): which name the author meant for the local is a judgement. Measured first-party exposure: zero.
