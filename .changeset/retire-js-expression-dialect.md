---
'@objectstack/spec': patch
'@objectstack/formula': patch
---

fix(formula): retire the `js` expression dialect and fix the `hasDialect` false-positive (#3278)

The `js` **expression** dialect was declared in `ExpressionDialect` but never
shipped — it existed only as a registry stub with no engine and no author helper
(`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron; nothing ever emitted
`js`). Per ADR-0049 (enforce-or-remove) it is removed from the enum; the set is
now `{cel, cron, template}`.

Procedural JavaScript is unaffected: it remains the **L2** authoring surface —
the sandboxed, capability-gated `ScriptBody { language: 'js' }` in hook/action
bodies — which is a separate enum (`hook-body.zod.ts`), not an expression
dialect.

Also fixes a latent bug in `hasDialect`: it detected stubs via
`dialect.startsWith('stub:')`, but stubs were registered under their real name,
so the check was dead code and `hasDialect('js')` returned a false-positive
`true`. With the stub removed, `hasDialect` reports only registered real
engines, and the registry test now asserts the negative case (`hasDialect('js')
=== false`) so the gate can actually go red.

No runtime behavior changes for any valid persisted artifact — no producer ever
emitted `dialect: 'js'`. See the ADR-0058 addendum.
