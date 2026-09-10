---
"@objectstack/objectql": minor
---

feat(engine): `ObjectRepository.findOne` / `.update` publish their honest types — the contract's shapes, not `any` (#16786)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (the one PR #15280 used for `SqlDriver.update()` and the `TursoDriver.update()` override, and PR #14434 before it on `@objectstack/driver-memory`).

`ObjectRepository.findOne()` and `.update()` were written out with an explicit `Promise<any>` while they have always answered what the contract declares — each one forwards, one line down, to an `IDataEngine` door that already declares the shape:

- `findOne` → `Promise<Record<string, any> | null>`
- `update` → `Promise<Record<string, any> | number | null>`

`IScopedObjectRepository` — the contract this class carries an `implements` clause for — declares both, and has since ruling A on #16231 landed (PR #16783). An explicit `any` satisfies that structurally, because a **wider** declared return always satisfies a narrower one: `class ObjectRepository implements IScopedObjectRepository` compiled green the whole time while the emitted `.d.ts` read `Promise<any>`, so no caller holding an `ObjectRepository` — or reaching one through `ScopedContext` or `ObjectQL.createContext()`, both exported from this package's index — was ever asked to narrow. They are now declared as the contract declares them. No runtime behaviour changes.

A caller that read fields off `findOne()`'s result through the `any` now narrows the `null` arm first; a caller that read `update()`'s result now separates the by-id record from the predicate-form count. The in-repo census for this change was one file, repaired alongside.

`updateById` is deliberately untouched: `IScopedObjectRepository.updateById` itself declares `Promise<any>`, so the class already matches its contract and there is no drift to repair on this side. That half stays open on #16786.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves. No metadata key, no spec key, no authored property, no config field, no accepted request shape and no stored artifact changes spelling or shape; `packages/spec` is untouched, so `objectstack migrate meta` has nothing to rewrite, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. What moves is the declared RETURN TYPE of two TypeScript methods, and the rewrite this ships -- narrow the `null` arm -- is addressed to a TYPESCRIPT CONSUMER and delivered by the compiler at their own call site, which is the audience the ADR-0087 ledger explicitly does not serve.
     `type-surface-only` is the category built for exactly this class and it is NOT claimed here, because its predicate 4 cannot be made to name this change's symbols -- measured, not assumed. The bare form `engine.ts#findOne` resolves to the FIRST same-named member in the file, `ObjectQL.findOne` (line 9761), which #16783 already narrowed, so predicate 4 reads `narrowed-from-erased is FALSE: at the merge base ... was already CONCRETE` -- a true statement about a member this diff never touched. The documented fallback, a dotted member path, is walked only through OBJECT-LITERAL nesting and refuses a class member: `ObjectRepository.findOne does not resolve: no ObjectRepository object literal is declared`. Both narrowed members are class members whose names repeat in the file, so neither spelling can address them. The gap is reported on the card rather than worked around, and the **BREAKING** banner above is carried rather than dropped -- which is the erosion #13080 was filed about. -->
