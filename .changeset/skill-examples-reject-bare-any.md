---
---

ci(spec): `check:skill-examples` rejects a bare `any` inside an `os:check` block (#5943)

An `os:check` marker is the author's claim that the block below it compiles. A bare
`any` inside that block makes the claim vacuous: every property access on the `any`
goes unchecked, so `tsc` runs clean while proving nothing about the lines a reader
copies. #5720 is the measured specimen — two marked hook examples written
`export async function beforeUpdate(ctx: any)` read a `ctx.services` that no hook
context has (the engine builds nine keys by name, the sandbox ten, neither of them
`services`), so the copied hook short-circuits and throws `PERMISSION_DENIED` on every
write; the gate was green throughout, and the same `any` had already hidden #5605's
`ctx.session?.positions`.

The gate now parses each marked block and fails on an annotation that **is** `any` —
parameter, variable, property, return type, type alias, or an `as any` / `satisfies any`
/ angle-bracket assertion — reporting `page:line:col` plus the two remedies (annotate the
real type, or drop the marker). Casts and locals are in scope because a parameter-only
rule is defeated by exactly the edit a red parameter invites: move the `any` one line
down or into the access. `any` nested in a larger type (`Record<string, any>`, `any[]`,
`Promise<any>`) is deliberately not flagged, the same zero-false-positive line
`check-exported-any.ts` draws.

Baseline was three annotations in one block — `content/docs/protocol/kernel/lifecycle.mdx`'s
generated-migration sample, which reproduces `os generate migration`'s Knex output
verbatim (`packages/cli/src/commands/generate.ts` emits `up(db: any)` / `(table: any)`)
and imports nothing from `@objectstack/spec`. Typing it would make the page lie about
what the CLI writes, so its marker is dropped instead; 207 marked blocks remain and all
type-check. A `--self-test` pins the detector in both directions, including the page-line
arithmetic. Dev scripts and one doc comment only; releases nothing.
