---
"@objectstack/cli": minor
---

fix(cli)!: `objectstack build` refuses to lower a hook body that reaches `ctx.dispatch.scope` or `ctx.submitted` (#22810)

Clause-②: no (narrowing)

The sandboxed body face does not carry either member, and the spec says so: `HookContextSchema.dispatch` gives a body `{ mode, index }` "and not `scope`", and `submitted` is "NOT marshalled into the sandboxed `body` face". The build lowered such a handler anyway, at exit 0, with no warning. Measured through `bootStack`'s artifact door: a body writing `ctx.dispatch.scope.<key>` threw `TypeError: cannot set property … of undefined` on every insert, so REST answered `500 INTERNAL_ERROR` and stored nothing, while the same handler in-process answered `201`. A body reading `ctx.submitted` saw `undefined` on an update, where the in-process handler sees the caller's submission, so a guard written on it evaluated differently with no error at all.

The hook body extractor (`extractHookBody`) now refuses both members as forbidden tokens, the way it already refuses `.sudo(` and `.create(`. `os lint` calls the same extractor, so it reports them too.

**BREAKING — what moves for consumers.**

- **`objectstack build`.** A handler that writes or reads `ctx.dispatch.scope`, or reads `ctx.submitted`, was lowered to a `body` that fails in the sandbox. It is now bundled into the runtime module (`objectstack-runtime.*.mjs`) instead, with a warning naming the hook and the member, and the build still exits 0. Where that module is served beside the artifact the handler runs in-process, so `scope` and `submitted` are real again: measured, the same insert answers `201` and stashes. A deployment that serves `objectstack.json` alone has no function to bind the hook to, so it logs the hook as refused at boot and the hook does not fire.
- **`objectstack build --strict-body`.** Such a handler built at exit 0. It now fails the build (exit 1), naming the hook and the member.
- **`os lint`.** It said nothing. It now reports a `hook-body/bundled-fallback` warning at `hooks[i].handler`.
- **The spellings refused.** Direct and optional (`ctx.dispatch.scope`, `ctx?.submitted`), bracket (`ctx.dispatch['scope']`), through an alias (`const d = ctx.dispatch; d.scope`, `const c = ctx; c.submitted`), and destructured (`const { scope } = ctx.dispatch`, `const { submitted } = ctx`). For `scope` the body must also name `dispatch` somewhere, because `scope` is an ordinary field name.
- **Not refused.** `ctx.dispatch.mode` and `ctx.dispatch.index`, and a field that happens to be named `scope` or `submitted` read through `ctx.input` or `ctx.previous` (`ctx.input.scope`). A body reading such a field off a local row variable (`row.submitted`), or spelling `x.submitted` inside a string, is refused too. That is the over-refusal side: the handler is bundled and keeps working.

**The one-line fix**, for a handler you want shipped as a body: do the cross-dispatch work once at `ctx.dispatch.index === 0`, or keep the state in the record through `ctx.api`, instead of stashing on `ctx.dispatch.scope`; read the stored row on `ctx.previous` instead of `ctx.submitted`. A handler you are content to run bundled needs no change.

**Unchanged.** No spec key, export, type or stored shape moves. The sandbox still marshals exactly what it did: `{ mode, index }` for `ctx.dispatch`, no `ctx.submitted`. An in-process handler, a top-level `functions:` entry referenced by name, and a hook that carries an explicit `body` are not lowered here and are not judged.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at build time of handler code the sandbox already could not run: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. The refused handler keeps running bundled, so no consumer has to edit anything for its build to succeed, and the edit that makes it a body again is a change to handler code, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers the lowering (not already-registered); and the change is a build verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
