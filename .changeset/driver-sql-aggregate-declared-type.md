---
'@objectstack/driver-sql': minor
---

feat(driver-sql): `aggregate()` publishes its declared return type — the contract's own, not `any` (#17277)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (the one PR #14434 set for this class of change on `@objectstack/driver-memory`, and PRs #15280 and #15267 followed on this very class). `SqlDriver.aggregate()` carried an EXPLICIT `Promise<any>` over a door `IDataDriver` had already declared narrower: `aggregate?(object, query, options?): Promise<Record<string, unknown>[]>`. An explicit `any` satisfies that structurally, so `tsc` said nothing while the emitted `.d.ts` told every consumer that an aggregate row is whatever they like.

The door is now declared as the contract declares it. A caller that read a cell straight off an aggregate row through the `any` now types what it reads — an aggregate cell arrives as `unknown` — and a caller that indexed the result array, or took `.find()` on it, now narrows the absent arm first. No runtime behaviour changes.

`aggregate()` is OPTIONAL on the contract (`aggregate?`) where the five doors #15267 moved are required. That governs whether the member EXISTS, not what it returns once it does: a consumer that has already guarded `typeof driver.aggregate === 'function'` — the engine's own dispatch — holds a function whose published return was `any` and is now the contract's record array. The narrowing reaches it either way.

`@objectstack/driver-sqlite-wasm` does not override this door and re-declares no member of its own, so it carries no entry: the narrowing reaches its consumers through this package's `.d.ts`. `@objectstack/driver-turso` overrides it and carries its own entry.

<!-- adr-0087: not-required (type-surface-only packages/drivers/driver-sql/src/sql-driver.ts#aggregate) A published driver method's declared return moves off an explicit `any` onto the contract's own shape. No metadata key is removed, renamed or re-shaped, `packages/spec` is untouched, and nothing exists for `objectstack migrate meta`, `spec-changes.json` or the upgrade guide to rewrite; the obligation is a TypeScript narrowing at the consumer's own call site, delivered by the compiler. -->
