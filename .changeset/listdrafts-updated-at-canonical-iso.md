---
'@objectstack/metadata-protocol': patch
---

`SysMetadataRepository.listDrafts` emits the ISO-8601 string its own signature declares for `updatedAt`

`listDrafts` declares `updatedAt: string | null` on an inline TypeScript return type and reached the field through `row.updated_at ?? row.created_at ?? null`. `??` fires only on nullish, so the JS `Date` that Postgres and MySQL materialise for the builtin audit columns walked straight past it into a field the declaration calls a string. Driven through the published door, the pre-fix build answered `typeof "object"` and the visible text `Wed Mar 04 2026 05:06:07 GMT+0000 (Coordinated Universal Time)` where the same build's `dist/index.d.ts` promised `string | null`; it now answers `2026-03-04T05:06:07.089Z`.

`updated_at` / `created_at` are builtin audit columns: `SqlDriver#formatOutput` repairs them (and folds declared `datetime` columns) only inside its `if (this.isSqlite)` arm, and `withPostgresCalendarDayAsText` leaves `timestamptz` / `timestamp` deliberately untouched because those are instants. Nothing reported the mismatch — the declaration is an inline return type rather than a Zod schema, so a schema search finds nothing, and `rows` is cast `as any[]` one line above the map, so tsc saw a `string` assignment that never happened.

Canonicalised at the producer through the same adapter boundary `rowToItem` already uses, with the terminal chosen per call site: `null` here, because the chain being replaced already ended in `?? null` and that is what "absent" already means to this projection's consumers. An Invalid `Date` — reachable on both live dialects — takes that same branch instead of raising. Already-canonical SQLite text passes through byte-identically, and `updatedBy` is unchanged: `updated_by` / `created_by` are `Field.lookup('sys_user')` string columns, which the dialect asymmetry never reaches.

No published declaration moves: `dist/index.d.ts` and `dist/index.d.cts` are byte-identical across the fix, which already declared `updatedAt: string | null` before it. A JavaScript consumer that read the raw value and called a `Date` method on it, or stringified it, sees the corrected shape.
