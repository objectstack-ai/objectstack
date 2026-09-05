---
'@objectstack/driver-memory': minor
---

fix(driver-memory): `find()`, `findOne()` and `create()` publish their declared types (#14435)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, the same shape #13878 landed on `update()` / `upsert()` one door over, shipped as `minor` under the launch-window convention (`major` is refused by `check-changeset-no-major`, so the BREAKING banner and the ADR-0087 disposition are the carriers, not the level).

`IDataDriver` has always declared `Promise<Record<string, unknown>[]>`, `Promise<Record<string, unknown> | null>` and `Promise<Record<string, unknown>>` on these three doors. The emitted `.d.ts` published `Promise<any[]>`, `Promise<any>` and `Promise<Record<string, any>>`: the return types of `find` and `findOne` were INFERRED through the backing store's `any[]` rows (`private db: Record<string, any[]>` to `getTable()`), and `create` carried an explicit annotation that itself spelled `Record<string, any>`. They are now declared as the contract declares them.

What this asks of a consumer holding a concrete `InMemoryDriver`: a caller that reads fields off a `findOne()` result narrows the `null` arm first — the arm the driver has always been able to answer with (`results[0] || null`) and that no caller was ever asked to handle; and a caller that leaned on `any` to read a member off a `find()` row or a `create()` result now types it, since the rows are `Record<string, unknown>`. A consumer whose receiver is typed as `IDataDriver` sees no change at all — that declaration already said this.

The parameters are deliberately untouched: `create(data: Record<string, any>)` stays as it is, because narrowing an INPUT would be a second, unrelated break, and method parameters compare bivariantly against the contract's `Record<string, unknown>`. No runtime behaviour changes; the store keeps its `any[]` rows, which the card measured to cascade if re-typed.

<!-- adr-0087: not-required (no-migration-prescription) A published return type moves off `any` onto the contract's own shape: no metadata key is removed, renamed or re-shaped, no spec schema changes (this diff touches `packages/drivers/driver-memory/**` only), and nothing exists for `objectstack migrate meta` to rewrite. The obligation is a TypeScript narrowing at the consumer's call site, delivered by the compiler. -->
