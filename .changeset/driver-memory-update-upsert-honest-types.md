---
'@objectstack/driver-memory': minor
---

feat(driver-memory): `update()` and `upsert()` publish their honest types (#13878)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, the shape ADR-0087's 2026-08-30 addendum names (a published SDK method whose declared return moves off `any` onto the contract it always answered) — shipped as `minor` under the launch-window convention. The emitted `.d.ts` read `Promise<any>` for both doors: the return types were inferred through the backing store's `any[]` rows, so the union collapsed and no caller was asked to narrow. They are now declared as the contract declares them — `update()` returns `Promise<Record<string, unknown> | null>` (the `null` arm is the non-`strictMode` miss the driver has always answered with), `upsert()` returns `Promise<Record<string, unknown>>`. A caller that read fields off `update()`'s result through the `any` now narrows the `null` arm first; a caller that leaned on `any` to read undeclared members of either result now types them.

`upsert()` now asserts — throws on — the `null` arm of `update()` on a path it cannot reach (the row it updates was found in the same table a moment earlier, with nothing yielding in between), instead of widening its own declared return to carry an arm it can never produce. No reachable runtime behaviour changes.

<!-- adr-0087: not-required (no-migration-prescription) A published return type moves off `any` onto the contract's own shape: no metadata key is removed, renamed or re-shaped and nothing exists for `objectstack migrate meta` to rewrite; the obligation is a TypeScript narrowing at the consumer's call site, delivered by the compiler. `type-surface-only` is not claimable here because the same diff touches `packages/spec/**` (the contract declaration itself). -->
