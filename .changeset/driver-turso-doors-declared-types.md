---
'@objectstack/driver-turso': minor
---

feat(driver-turso): the overridden `IDataDriver` doors publish their honest types, not `any` (#15267)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention. `TursoDriver` does not merely inherit these doors from `SqlDriver` — it OVERRIDES `findOne()`, `create()`, `bulkCreate()` and `execute()`, and each override was written out with its own explicit `Promise<any>`. So this package's emitted `.d.ts` re-declared four of the five doors as `any` on its own and would NOT have picked up the `@objectstack/driver-sql` narrowing — the same shape PR #15280 had to fix separately for `update()`.

Both branches of every one of the four already answered the contract's type: the local branch forwards to `SqlDriver`'s door (narrowed alongside, #15267) and the remote branch passes `RemoteTransport`'s result — already declared `Record<string, unknown> | null`, `Record<string, unknown>`, `Record<string, unknown>[]` and `unknown` respectively — through the generic `formatRemoteRow` / `formatRemoteRows`. Each override now declares what it has always answered. A caller that read fields off `findOne()` through the `any` now narrows the `null` arm first. No runtime behaviour changes.

`explain()` is not overridden here and reaches these consumers through `@objectstack/driver-sql`. Out of scope and deliberately unmoved: `upsert()`, `aggregate()` and `beginTransaction()` keep their annotations.

<!-- adr-0087: not-required (type-surface-only packages/drivers/driver-turso/src/turso-driver.ts#findOne, packages/drivers/driver-turso/src/turso-driver.ts#create, packages/drivers/driver-turso/src/turso-driver.ts#bulkCreate) Published driver method overrides' declared returns move off an explicit `any` onto the contract's own shapes; no metadata key moves, `packages/spec` is untouched, and the obligation is a TypeScript narrowing at the consumer's own call site, delivered by the compiler. The same change to `execute` is not named above because its destination is the contract's own `unknown`, which `isErasedType` counts as erased (TSO-U6), so predicate 4 cannot read it as narrowed-from-erased; it carries the identical disposition and the body states it in full. -->
