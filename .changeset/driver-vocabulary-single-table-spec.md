---
"@objectstack/spec": major
---

feat(spec)!: one driver vocabulary — `mongo` → `mongodb`, `turso` gets a config contract (#6345)

`packages/spec` has owned the driver alias table since #4410, for one reason
stated in its own module comment: two tables would let the id that SELECTS a
driver and the id that selects that driver's CONFIG CONTRACT disagree. That
argument was right and the table was right; it just never reached the two boot
hosts. Measured on `main` before this change, driving the real entry points:

| | `os start` | `os migrate` |
| :-- | :-- | :-- |
| `OS_DATABASE_DRIVER=pg` | accepted (`postgres`) | **refused by name** |
| `OS_DATABASE_DRIVER=libsql` | accepted (`turso`) | **refused by name** |

**10 of 21 spellings disagreed.** Three prior cards (#3276, #5820, #6265) each
fixed one spelling on one side, each with a green pin — and every pin drove
exactly one host, which is why the fork survived all three.

**What this changeset changes in `@objectstack/spec`.**

The flat `Record<string, BuiltinDriverId>` becomes one table with a row per
driver carrying `id`, `aliases`, `contractOnlyAliases` and `hasLocalDefault`.
`BUILTIN_DRIVER_IDS`, `DRIVER_ID_ALIASES` and `resolveDriverId` are projections
of it — `BUILTIN_DRIVER_IDS` keeps its exact tuple type, so the api-surface delta
for this PR is purely additive (10 new exports, nothing removed or renamed).

Three faces are new, and they are what the two hosts consume:
`resolveDatabaseDriverId()` (the selection face), `driverHasLocalDefault()` (does
this driver have anything to fall back on with no URL) and
`DATABASE_DRIVER_SELECTION_ALIASES` (what a refusal message enumerates).

**BREAKING — the canonical mongo id is `mongodb`.** `resolveDriverId('mongo')`
now returns `'mongodb'`; `BuiltinDriverId` no longer includes `'mongo'`;
`DRIVER_CONFIG_SCHEMAS` and `MongoDriverSpec.id` follow. The old canon was the
one string on the platform that said `mongo` while both hosts, the npm package
(`@objectstack/driver-mongodb`) and every URL scheme said `mongodb`, and the
maintainer's ruling renames it rather than adding a mapping layer, so that
selection canon and contract canon are one string.

`mongo` **stays an accepted alias**, deliberately: nothing that authored it
breaks, and a deployment that never replays the conversion still resolves the
same contract and builds the same driver. What needs migrating is the STORED
value, because the canonical id is published as `DRIVER_CATALOG.id` — what Studio
writes into `datasource.driver` — so after the rename the form emits `mongodb`
while older rows carry `mongo`, and a reader matching stored rows against the
catalog id silently misses them. The ADR-0087 D2 conversion
`datasource-driver-mongo-to-mongodb` converges them at every rehydration seam.

**`turso`/libSQL becomes a complete builtin.** It was the mirror image of the
mongo problem: both hosts dispatched it while spec shipped no contract, so
`validateDriverConfig('turso', …)` answered `{ known: false }` and a libSQL
`config` was the one connection block on the platform with no gate — `{ token }`
(the wrong key; it is `authToken`) was accepted in silence and the connection
attempted unauthenticated. `TursoConfigSchema` closes that. The keys are drawn
from what `TursoDriverConfig` actually READS, not from what libSQL supports, so
the fix does not open a new inert slot: `client` (a live object, unauthorable),
`pool` and `schemaMode`/`readOnly` (datasource-level) are deliberately absent.

**Consumers of the `{ known: false }` answer, and what the flip does to each** —
established before making it, since a consumer depending on the negative answer
would have been a stop condition:

1. `DatasourceSchema`'s `reportDriverConfigIssues` — was a no-op for turso, now
   parses. An authored turso `config` gains a real verdict.
2. `service-datasource`'s `assertValidConfig` (the Setup wizard's door) — same
   flip, same reason.
3. `DRIVER_CATALOG` — turso is deliberately NOT curated into the connection form,
   the same call `sqlite-wasm` has carried since #4410. No visible change.
4. `driverReadsDeclaredPool` — answers `true` for turso before AND after (via the
   unknown-id branch before, the not-rejected branch now). Verdict unchanged.

**`sql` and `wasm` join the selection face; `sqlite3`, `better-sqlite3`,
`mariadb` and `inmemory` do not.** The ruling fixes the selection face as the
union of what the two hosts accepted, and those four were accepted by neither —
so they stay `contractOnlyAliases`: they keep resolving a config contract
(dropping that would silently un-validate a stored `driver: 'sqlite3'` row) while
`resolveDatabaseDriverId` refuses them, because converging two hosts is not a
licence to widen a boot flag on no ruling. That distinction is the thing the flat
`Record` could not express and is why the table has two alias columns.

**Why `major` and not `minor`.** The alias widening alone would be `minor` — it
only accepts more. The rename is what forces `major`: `BuiltinDriverId` loses a
member, so every TypeScript consumer that switches on it or types a variable as
it fails to compile, and `DRIVER_CONFIG_SCHEMAS['mongo']` is gone. That is a
compile-time break even though the runtime behaviour is compatible, and pricing
it as `minor` because "nothing breaks at run time" would be exactly the
half-truth a consumer discovers at build time.

<!-- adr-0087: registered datasource-driver-mongo-to-mongodb -->
