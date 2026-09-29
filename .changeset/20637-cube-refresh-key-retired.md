---
'@objectstack/spec': minor
---

feat(spec)!: retire an analytics cube's `refreshKey` — the refresh cadence and data-change probe nothing read (#20637)

**BREAKING** — `refreshKey` on an analytics cube (`CubeSchema`), with its `every` and `sql`, is now refused at parse: nothing ever read it, and no analytics result is cached, so a declared refresh cadence refreshed nothing. Delete the key. Every analytics query is computed when it is asked, as it always was. A refresh cadence is declared again when a result cache exists.

Clause-②: no (narrowing)

Measured before removal: `git grep refreshKey` over the non-test sources of `packages/services`, `packages/drivers` and `packages/rest` answered 0 lines (4 for the neighbouring `.public` in the same pathspec). `@objectstack/service-analytics` references no cache or job service; its one cache is request-scoped (dimension labels). The one in-repo author was the showcase app (`every: '1 hour'`), which no longer writes it.

**Removed rather than enforced** (ADR-0049 enforce-or-remove; the maintainer's ruling on the card, letter C): a result cache keyed by cube, query, read scope and tenant is a subsystem with its own design, and a key that does nothing until then is the residue ADR-0049 removes. `sql` also had no safe seam: raw SQL on a schedule, outside the read scope every other cube `sql` goes through.

## FROM → TO

| you wrote (17.5 and earlier) | write instead |
| --- | --- |
| `refreshKey: { every: '1 hour' }` | nothing — delete the key |
| `refreshKey: { sql: 'SELECT MAX(updated_at) FROM orders' }` | nothing — delete the key |
| `refreshKey: { every: '1 hour', sql: '…' }` | nothing — delete the key |

**The one-line fix:** delete `refreshKey` from every cube.

**What an author who still writes it sees.** `tsc` fails at the authoring site (`Cube` types the key `never`), and the parse — `defineCube()`, `defineStack({ analyticsCubes })`, `PUT /api/v1/meta/analytics_cube/:name` — refuses it at `refreshKey` with the prescription:

> `analytics_cube.refreshKey` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — nothing read it: no analytics result is cached, so neither `every` nor `sql` ever refreshed anything. Delete the key; every analytics query is computed when it is asked. A refresh cadence is declared again when a result cache exists. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

## The retirement kit

- **A `retiredKey()` tombstone** on `CubeSchema`, a `strictObject` — so the refusal carries the prescription rather than a bare unknown-key report, and `tsc` fails first. The nested `every` / `sql` shape is gone with it. `RETIRED_KEYS_BY_MAJOR[18]`: `data/Cube:refreshKey`. The key had no default, so no retired-default residue is owed.
- **The D2 conversion `cube-refresh-key-removed`** (protocol 18, retired from the load path) deletes the whole block from every `analyticsCubes[]` entry, one notice per cube, as a lossless delete. A built artifact or a stored `analytics_cube` row that carries it loads through the rehydration seams, which replay it.
- **The D3 entry `cube-refresh-key-retired`** asks the author whether anything they built assumed cube results were cached or refreshed on a schedule. They never were.
- **Ledger:** the `refreshKey.every` / `refreshKey.sql` rows collapse into one `dead` tombstone row.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered cube-refresh-key-removed, cube-refresh-key-retired -->
