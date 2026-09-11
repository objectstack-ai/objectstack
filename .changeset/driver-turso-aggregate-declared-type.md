---
'@objectstack/driver-turso': minor
---

feat(driver-turso): the `aggregate()` override publishes its declared return type, not `any` (#17277)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention. `TursoDriver` does not merely inherit this door from `SqlDriver` — it OVERRIDES `aggregate()`, and the override was written out with its own explicit `Promise<any>`. So this package's emitted `.d.ts` re-declared the door as `any` on its own and would NOT have picked up the `@objectstack/driver-sql` narrowing — the same shape PR #15280 had to fix separately for `update()` and PR #15267 for four more doors.

Both branches already answered the contract's type: the remote branch passes `RemoteTransport.aggregate()`, already declared `Promise<Record<string, unknown>[]>`, and the local branch forwards to `SqlDriver.aggregate()`, narrowed alongside (#17277). The override now declares what it has always answered. A caller that read a cell straight off an aggregate row through the `any` now types what it reads. No runtime behaviour changes.

Out of scope and deliberately unmoved: `upsert()` and `beginTransaction()` keep their annotations.

<!-- adr-0087: not-required (type-surface-only packages/drivers/driver-turso/src/turso-driver.ts#aggregate) A published driver method override's declared return moves off an explicit `any` onto the contract's own shape; no metadata key moves, `packages/spec` is untouched, and the obligation is a TypeScript narrowing at the consumer's own call site, delivered by the compiler. -->
