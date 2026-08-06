---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

feat(spec): declare the action-body `ctx.session` contract (#5697)

An action body reads `ctx.session` on every dispatch, and until now **nothing
declared it**. `actionContext` is a bare `any` at both dispatch sites
(`domains/actions.ts`, `action-execution.ts`), the sandbox seam types
`ScriptContext.session` as `unknown`, and the one spec-side mention was an
inline literal on `ActionHandlerContext` carrying a `[k: string]: unknown`
catch-all. Declared-nowhere, produced-anyway: no schema, no gate, no generated
reference page, and nothing the liveness ledger could reach.

That is how the surface drifted without anyone noticing. Its `roles` key carries
`ExecutionContext.positions` — the ADR-0090 D3 vocabulary handed to authors under
the one spelling that ADR forbids — while the hook side retired its own
`session.roles` at #5050. One platform, one key name, two opposite answers.

**`ActionSessionSchema` (`@objectstack/spec/ui`) declares that shape as built.**

```ts
{ userId?: string; organizationId?: string; roles?: string[] }
```

This release changes **nothing about what the runtime produces** — it is phase 1
of #5613's contract-first ruling, and declaring current reality is deliberately
not the same as endorsing it:

- `roles` is declared **deprecated** in its `.describe()` and its JSDoc. The
  rename to `positions`, with a deprecation window and an ADR-0087 semantic
  migration, is #5613 phase 2. There is deliberately **no `positions` key yet** —
  minting one before the migration would ship two live spellings of one value.
- The schema is **not strict**, matching `HookContextSchema`: this is a runtime
  shape the platform hands a body, never authored, and closing it would turn a
  future engine-side enrichment into a parse failure for whoever parses a context
  they were given.

Three facts the declaration now states, all of them previously discoverable only
by reading the builder:

- **Absent means the key is absent.** The builder uses conditional spreads, so
  `'organizationId' in ctx.session` answers `false` — not "present and
  `undefined`". The hook path's `input.id` on a bulk write is the opposite case
  (#5668); an `in` test does not port between them.
- **No identity envelope yields no session at all** — `undefined`, never `{}`, so
  a body can tell "no caller" from "an anonymous caller" (#3712). One consequence:
  `roles` never appears on its own.
- **`organizationId` is the blessed name** for the caller's active org; the
  v11-removed `session.tenantId` alias (#3280 / #3290) does not come back.

Type-only on the runtime side, no behaviour change: `buildActionSession()` now
declares `ActionSession | undefined` instead of `any | undefined`, and
`ActionHandlerContext.session` is the schema's inferred type rather than an
inline literal with a catch-all. A handler annotated with `ActionHandler` that
read an undeclared key off `ctx.session` now gets a compile error naming it —
that key was never produced. `ScriptContext.session` deliberately stays
`unknown`: it is one seam over both body kinds, and hook and action sessions are
different objects.

The declaration ships with the gate it needed —
`packages/runtime/src/action-session-shape-contract.test.ts` executes the real
producer and asserts a non-strict parse of the built object returns it
**unchanged**, so a key the builder starts producing without declaring here is
stripped and the pin goes red.
