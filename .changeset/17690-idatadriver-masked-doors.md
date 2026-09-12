---
"@objectstack/driver-sql": minor
"@objectstack/driver-turso": minor
---

fix(driver-sql,driver-turso): eight more `IDataDriver` doors publish their declared return type, not a nested `any` (#17690)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (PR #15280 for `SqlDriver.update()` and the `TursoDriver.update()` override, PR #14434 before it on `@objectstack/driver-memory`, PR #17258 for the five `SqlDriver` doors of #15267, PR #17689 for `aggregate()`). No runtime behaviour changes.

Eight doors published an annotation whose `any` sat **inside** a wider type, while `packages/spec/src/contracts/data-driver.ts` had already declared each one narrower. A consumer holding one of these classes got `any` back and the compiler stopped checking:

| class | door | published | now |
|---|---|---|---|
| `SqlDriver` | `find` | `Promise<any[]>` | `Promise<Record<string, unknown>[]>` |
| `SqlDriver` | `upsert` | `Promise<Record<string, any>>` | `Promise<Record<string, unknown>>` |
| `SqlDriver` | `bulkUpdate` | `Promise<Record<string, any>[]>` | `Promise<Record<string, unknown>[]>` |
| `SqlDriver` | `temporalFilterValue` | `any` | `unknown` |
| `TursoDriver` | `find` (override) | `Promise<any[]>` | `Promise<Record<string, unknown>[]>` |
| `TursoDriver` | `upsert` (override) | `Promise<Record<string, any>>` | `Promise<Record<string, unknown>>` |
| `TursoDriver` | `bulkUpdate` (override) | `Promise<Record<string, any>[]>` | `Promise<Record<string, unknown>[]>` |
| `RemoteTransport` | `beginTransaction` | `Promise<any>` | `Promise<unknown>` |

The `TursoDriver` rows are separate sites, not consequences: an override re-declares the door in that package's own `.d.ts`, so the `@objectstack/driver-sql` narrowing does not reach a consumer holding a `TursoDriver`.

**What a consumer does.** A cell read off a row now arrives as `unknown` and is typed before use (`String(row.name)`, `Number(cell)`, or a `typeof` narrowing); `Array.prototype.find` over a result set answers `… | undefined` and the absent arm is separated rather than asserted past. Measured across the whole consumer closure of both packages at this change's tree — 115 `typecheck` tasks — the repo-wide cost is **11 sites**, all inside `@objectstack/driver-sql` (9) and `@objectstack/driver-sqlite-wasm` (2), and **zero** outside the driver packages.

`TursoDriver.beginTransaction` is deliberately NOT narrowed here and stays `Promise<any>`. It overrides `SqlDriver.beginTransaction(): Promise<Knex.Transaction>` — narrower than the contract, the honest direction, and the binding declaration for an override — so the contract's `Promise<unknown>` does not compile there (TS2416). That `any` masks an LSP violation, not an un-narrowed door, and closing it is a separate decision.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves. No metadata key, no authored property, no config field, no accepted request shape and no stored artifact changes spelling or shape: the edit is eight declared RETURN TYPES on two driver classes and one transport class, plus their docblocks, so `objectstack migrate meta` has nothing to rewrite, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. The party this change addresses is a TYPESCRIPT CONSUMER and the delivery channel is the compiler at their own call site — the audience the ADR-0087 ledger explicitly does not serve. This changeset carries no FROM/TO rewrite block for stored metadata; the "what a consumer does" paragraph above is a source-code prescription, which is exactly the distinction #13080 records this refusal cannot make on its own.
     `type-surface-only` is the category built for this class of change, and it is NOT claimed here because it is UNAVAILABLE on six of these eight doors — measured, not assumed. Its predicate 4 (`narrowed-from-erased`) reads the base annotation through `isErasedType`, whose line is "the type IS `any`/`unknown`", never "the type CONTAINS `any`": `Promise<any[]>`, `Promise<Record<string, any>>` and `Promise<Record<string, any>[]>` all read as CONCRETE at the merge base, so naming `find`, `upsert` or `bulkUpdate` would make predicate 4 FALSE and red the gate on a change that is precisely this category's class. Only `SqlDriver.temporalFilterValue` (bare `any`) and `RemoteTransport.beginTransaction` (`Promise<any>`) satisfy it, and claiming the category on the two doors that happen to spell their erasure flatly, for a change whose other six do not, would be a claim about the diff that the diff does not support. The **BREAKING** banner is carried rather than dropped — that erosion is what #13080 was filed about. The gap itself is filed separately: it is the same failure this card is about, one layer up. An instrument's silence is only evidence if the instrument could have spoken. -->
