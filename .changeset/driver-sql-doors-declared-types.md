---
'@objectstack/driver-sql': minor
---

feat(driver-sql): the five remaining `IDataDriver` doors publish their honest types — the contract's own, not `any` (#15267)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (the one PR #14434 set for the same class of change on `@objectstack/driver-memory`, and PR #15280 followed for `update()` on this very class). `SqlDriver` carried an EXPLICIT `Promise<any>` on five doors that `IDataDriver` had already declared narrower: `findOne()` (`Record<string, unknown> | null` — it has always answered `results[0] || null`), `create()` (`Record<string, unknown>`), `bulkCreate()` (`Record<string, unknown>[]`), `execute()` (`unknown`) and `explain()` (`unknown`). An explicit `any` satisfies all five structurally, so `tsc` said nothing while the emitted `.d.ts` told every consumer that `findOne()` never returns `null` and that `create()` returns whatever they like. #15280 un-masked `update()` and filed the census of what was left; this is that remainder.

Each door is now declared as the contract declares it. A caller that read fields off `findOne()` through the `any` now narrows the `null` arm first; a caller that leaned on `any` to read undeclared members off `create()` / `bulkCreate()`, or to dereference a raw `execute()` / `explain()` result, now types what it reads. No runtime behaviour changes.

`@objectstack/driver-sqlite-wasm` overrides none of these five and re-declares no member of its own, so it carries no entry: the narrowing reaches its consumers through this package's `.d.ts`. `@objectstack/driver-turso` overrides four of the five and carries its own entry.

Out of scope and deliberately unmoved: `analyzeQuery()` (not an `IDataDriver` member) and `aggregate()` keep their annotations.

<!-- adr-0087: not-required (type-surface-only packages/drivers/driver-sql/src/sql-driver.ts#findOne, packages/drivers/driver-sql/src/sql-driver.ts#create, packages/drivers/driver-sql/src/sql-driver.ts#bulkCreate, packages/drivers/driver-sql/src/sql-driver.ts#execute, packages/drivers/driver-sql/src/sql-driver.ts#explain) Five published driver methods' declared returns move off an explicit `any` onto the contract's own shapes. No metadata key is removed, renamed or re-shaped, `packages/spec` is untouched, and nothing exists for `objectstack migrate meta`, `spec-changes.json` or the upgrade guide to rewrite; the obligation is a TypeScript narrowing at the consumer's own call site, delivered by the compiler. -->
