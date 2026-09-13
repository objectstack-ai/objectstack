---
"@objectstack/spec": minor
---

feat(spec): `IScopedObjectRepository.updateById` declares its answer — the record or `null`, not `any` (#16786)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (the one PR #15280 used for `SqlDriver.update()` and the `TursoDriver.update()` override, PR #14434 before it on `@objectstack/driver-memory`, and PR #17255 for this card's `objectql` half, which was re-graded from `patch` to `minor` mid-round for exactly this reason).

`updateById(id, data)` declared `Promise<any>` — the last wide member of a contract whose siblings answer what they mean. It now declares `Promise<Record<string, any> | null>`: the written record, or `null` when the id matched nothing.

The declaration is what every layer under it already says, measured rather than inherited:

- the engine door it forwards to, `IDataEngine.update`, declares `Promise<Record<string, any> | number | null>`;
- that door's by-id exit calls `IDataDriver.update(object, id, data)`, which declares exactly `Promise<Record<string, unknown> | null>`;
- `packages/objectql`'s `ObjectRepository.updateById` declared `Promise<any>` to MATCH this member rather than independently of it, and PR #17255 said so in its own docblock when it deliberately left this half open.

The `number` limb `update` carries — the affected-row COUNT a predicate write resolves — is **not** declared here, and that is a measurement too: the implementation binds both the payload id and a pure-id `where` and never declares `multi`, so the shared update dispatch answers `by-id` for every call this signature admits. A falsy id (`0`, `''`) is a REFUSAL, not a `null`: it identifies no row, so the dispatch rejects and the call throws.

Ruling A on #16231 settled the rule — #15823's `find()` narrowing extends to the sibling doors — and enumerated `scoped-context.ts:148` / `:164`, not this member. It is narrowed because the measurement says the declaration was wider than every implementation and wider than the door it forwards to, ⛔ not because a ruling named it.

A hook or service that assigned the result into a record slot, or read a field off it, through an `IScopedObjectRepository`-typed door now separates the `null` arm first. No runtime behaviour changes. The in-repo census through the interface-typed door is the contract's own suites, which already answer the narrow shape.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves. No metadata key, no authored property, no config field, no accepted request shape and no stored artifact changes spelling or shape: the edit is one declared RETURN TYPE on a TypeScript interface plus its docblock, so `objectstack migrate meta` has nothing to rewrite, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. What the change asks for is addressed to a TYPESCRIPT CONSUMER and delivered by the compiler at their own call site, which is the audience the ADR-0087 ledger explicitly does not serve.
     `type-surface-only` is the category built for this class of change and it is NOT claimed here, because it is unavailable — measured, not assumed. Its predicate 2 (`no-spec-diff`) is false by construction: the narrowed symbol LIVES in `packages/spec`, so any diff that moves it touches that package. Its predicate 3 (`no-metadata-surface-diff`) is false for the same file, `packages/spec/src/contracts/**` being an ADR-0087 shape surface by the gate's own classifier. Two of the four predicates cannot hold for any edit to this symbol, so the category is out of reach on the merits rather than on a resolution defect. The **BREAKING** banner above is carried rather than dropped — that erosion is what #13080 was filed about. -->
