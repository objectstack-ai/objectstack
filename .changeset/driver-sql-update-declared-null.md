---
'@objectstack/driver-sql': minor
---

feat(driver-sql): `update()` publishes its honest type — the contract's `Record<string, unknown> | null`, not `any` (#14438)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (the one PR #14434 used for the same door on `@objectstack/driver-memory`). `SqlDriver.update()` was written out with an explicit `Promise<any>` while it has always answered a missing id with `null` (`formatOutput(...) || null` on the un-rotated path, `null` once every rotation shard has been probed). `IDataDriver.update()` declares `Promise<Record<string, unknown> | null>`, and an explicit `any` satisfies that structurally — so the emitted `.d.ts` read `Promise<any>` and no caller holding a `SqlDriver`, or a `SqliteWasmDriver` (which inherits the door unchanged), was ever asked to narrow. It is now declared as the contract declares it, and the protected rotation-path producer `rotatedUpdateById()` carries the same type. A caller that read fields off `update()`'s result through the `any` now narrows the `null` arm first; a caller that leaned on `any` to read undeclared members now types them. No runtime behaviour changes.

`@objectstack/driver-sqlite-wasm` re-declares no `update` member of its own (measured on its emitted `.d.ts`), so it carries no entry: the narrowing reaches its consumers through this package's `.d.ts`. `@objectstack/driver-turso` overrides the door and carries its own entry.

<!-- adr-0087: not-required (type-surface-only packages/drivers/driver-sql/src/sql-driver.ts#update) A published driver method's declared return moves off an explicit `any` onto the contract's own shape. No metadata key is removed, renamed or re-shaped, `packages/spec` is untouched, and nothing exists for `objectstack migrate meta`, `spec-changes.json` or the upgrade guide to rewrite; the obligation is a TypeScript narrowing at the consumer's own call site, delivered by the compiler. -->
