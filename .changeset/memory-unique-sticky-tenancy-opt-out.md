---
"@objectstack/driver-memory": minor
"@objectstack/driver-sql": patch
"@objectstack/objectql": patch
---

fix(driver-memory,driver-sql): an explicit `tenancy.enabled: false` opt-out is sticky, so a partial `syncSchema` re-registration no longer flips a platform-global object's UNIQUE partition (#16729)

## What was wrong

`InMemoryDriver.syncSchema` recomputed its uniqueness constraints from whatever
schema THAT call happened to carry. A second registration without a `tenancy`
block — the `{ name, fields }` shape — fell through to the implicit
`organization_id` heuristic, so a `unique` field moved from **one row per
install** (`scopeField: null`, which is what `tenancy.enabled: false` declares)
to **one row per organization**. A duplicate the declaration refuses then
landed. Measured at the driver door on `origin/main` `d61139f1ba`:

| sequence | second `key: 'K'`, different organization |
|:--|:--|
| register with `tenancy.enabled: false` | `REFUSED` — `UNIQUE_VIOLATION` / 409 |
| …then re-register with `{ name, fields }` | **`LANDED`** |

`SqlDriver` running the same sequence refuses in **both** cases: it has kept a
sticky `tenantOptOutByTable` since #3249. `driver-memory` had mirrored the inner
`computeTenantField` and not the wrapper that consults the record, so "mirrors
`computeTenantField` arm for arm" stayed literally true while the pair diverged.

It is silent in both directions — nothing logs the flip, and the refusal names
the field, never the partition. That is the declared-vs-enforced shape Prime
Directive #10 forbids, reached by a state change rather than by a missing check.

## What it does now

- **`@objectstack/driver-memory`** gains `computeAndRecordTenantField`, the
  sticky resolver, and the `TenantOptOutRecord` type for the per-instance record
  a driver owns. `InMemoryDriver` holds one and resolves through it, handing
  BOTH declaration surfaces — field-level `unique` and declared `indexes[]` —
  the same resolved column. `uniqueConstraintsFromFields` and
  `uniqueConstraintsFromDeclaredIndexes` accept that column as an optional
  second argument; called with one argument they answer exactly as before.
  `tenantFieldOf` is unchanged and still a pure function of its argument.
- **`@objectstack/driver-sql`**: the shard leaf resolved its tenant column with
  the BARE `computeTenantField`, so a `rotateShards` sweep carrying no `tenancy`
  block gave a shard an organization key part the base table's index does not
  have — one object, two partitions, decided by which physical table a row
  landed in. It now resolves through the record, keyed by the base table.
- **`@objectstack/objectql`**: `LifecycleObjectLike` declares `tenancy`. The
  Archiver hands that object straight to `cold.syncSchema`, and the published
  type refused the key while the driver below read it — so an author writing a
  fresh literal was pushed into producing exactly the partial re-registration
  above. Same correction #16711 made where the shard leaf narrowed the key off
  the object it was handed.

The record is deliberately narrow. Only the explicit OPT-OUT is sticky: a
declared `tenancy.tenantField` is not recorded, matching `SqlDriver`. An object
that never declared the opt-out never enters the record, so a genuinely
org-scoped object keeps its `organization_id` partition across a partial
re-registration — an implementation answering `null` more often would not be
stickier, it would be tenant isolation switched off. A carried `tenancy` block
stays authoritative in both directions and CLEARS a recorded opt-out.

`@objectstack/driver-memory` is `minor` for the two new public-entry exports.
The behaviour repairs themselves are `patch`: each restores an implementation to
the `tenancy.enabled: false` contract (`isTenancyDisabled`, ADR-0066) it was
already declaring, rather than replacing one legal published answer with
another. The `objectql` entry is a published type WIDENING — a key the interface
refused is now accepted, and nothing that compiled before stops compiling.
