# `loadMany` consumer census — #14423 step 1

**Date:** 2026-09-03 · **Base:** `origin/main` `77a532d67` · **Scope:** measurement only —
ships nothing, changes no shipped package's behaviour. This is step 1 of the maintainer
ruling on #14423 (comment
[5528592646](https://github.com/objectstack-ai/objectstack/issues/14423#issuecomment-5528592646)):
the census the ruling's step 2 (the identity fix) reads before it picks a shape.

> **The ruling, verbatim (comment 5528592646):** "The governance audit's third source and
> the router's third rung read the same identity: the key the store holds an item under
> (#14205's rule), never `body.name`. Concretely, the audit's metadata-plane source moves
> off the unkeyed `loadMany('action')` onto a keyed read — `listNames('action')` plus
> by-name `load` / `loadDiagnosed`, or `loadManyKeyed` where a loader offers it — so the
> C2 / C6 divergence … cannot occur. … Census first (S, measurement): every `loadMany`
> consumer in the tree, and per shipped loader whether `listNames` / `loadManyKeyed` is
> available and what it costs … C3 … and C4 … are re-measured against the chosen shape in
> the same census; if keying alone does not close them, the census says which mechanism
> does."

---

## Answer in one line

**Keying alone (via `listNames()` + by-name `load`/`loadDiagnosed`) closes C2 and C6 but
does NOT close C3 or C4** — both survive the swap, for two different reasons, confirmed by
running the real production code against the shape. **Zero of today's four production
`loadMany` consumers already key by the store key** — all four read `body.name` — so a
`loadMany` return-shape change is the more invasive of the two shapes the ruling names.
**Recommendation for step 2: fix the audit's OWN source (switch its declaration-discovery
strategy to a by-name probe of already-known registered handlers), not `loadMany`'s
published return shape** — this is the only shape, of the ones measured here, that closes
C3 and C4 as well as C2/C6, and it touches none of the four production consumers.
**Clause-②: `no`**, provisionally, under that recommendation; `yes` if step 2 instead
widens `loadMany`'s return shape (mechanical floor). **`unboundDeclarations` BEFORE count:
0** for the population the fix can move, reproducibly.

---

## 1. Every `loadMany` consumer in the tree

**Method:** `grep -rn '\.loadMany(' --exclude-dir=node_modules .` (repo-wide, no path
restriction) enumerated 13 files; each was read to classify as production, internal
(package-private fallback), test, or documentation/changelog prose. This is exhaustive —
`loadMany` is not a common word, and the pattern requires the method-call spelling — so
there is no sampling error here, only the reading-effort of triaging what matched.

### Production consumers of the PUBLISHED `IMetadataService.loadMany()` — 4, in 2 files

| # | File:line | What it does with the items | Depends on `body.name` for identity? |
|---|---|---|---|
| 1 | `packages/objectql/src/plugin.ts:2193` (`resyncAuthoredHooksNow`) | `serviceHooks = await metadataService.loadMany('hook')`, then `for (const h of serviceHooks) if (typeof h.name === 'string') byName.set(h.name, h)` — keys a `Map` by `h.name`, unions with DB-authored hooks, rebinds the whole `'metadata-service'` hook set. | **YES.** A nameless body is silently excluded from the `Map` (the `typeof h.name === 'string'` guard), so it never gets (re-)bound — same drop shape as C2/C6, one call site over. |
| 2 | `packages/objectql/src/plugin.ts:2586` (`resyncAuthoredActionsNow`) | `serviceActions = await metadataService.loadMany('action')`, then `for (const a of serviceActions) if (typeof a.name === 'string') byKey.set(\`${standaloneActionOwnerKey(a)}:${a.name}\`, a)` — keys by `<object>:<name>`, unions with DB-authored actions, re-registers the whole `'metadata-service'` action set on the engine. | **YES**, identically to #1 — a nameless standalone action is invisible to this consumer too, in addition to being invisible to the governance audit two call sites below. |
| 3 | `packages/objectql/src/plugin.ts:2675` (`loadMetadataFromService`, boot-time sync for `['object','view','app','flow','hook']`) | `const items = await metadataService.loadMany(type)`, then per item `const keyField = item.id ? 'id' : 'name'; this.ql.registry.registerItem(type, item, keyField, item._packageId)`. | **YES** — falls back to `'name'` whenever `item.id` is absent, i.e. exactly the register key a nameless-and-idless body would need and does not have; such an item registers under the JS property access `item['name']` = `undefined`. |
| 4 | `packages/metadata/src/plugin.ts:1274` (`MetadataPlugin._loadFromFileSystem`, boot-time load from `DEFAULT_METADATA_TYPE_REGISTRY`) | `const items = await this.manager.loadMany(entry.type, {...}); for (const item of items) if (meta?.name) { applyProtection(meta, ...); await this.manager.register(entry.type, meta.name, item, {notify:false}); }` | **YES, and the sharpest of the four** — a nameless item is not merely mis-keyed, it is **never registered at all** (the `if (meta?.name)` guard skips the whole block). This is a THIRD, independent manifestation of the C2/C6 identity gap, upstream of both the governance audit and the two ObjectQL resync paths above: an item this loader can find by `load()`/`listNames()` can still fail to reach the in-memory registry at boot. |

**Finding that bears directly on Clause-② and blast radius: 0 of 4 already key by the
store key.** Every production consumer reads `body.name` (or `body.id`) to build its own
map/registration key. A `loadMany` return-shape change (e.g. `Promise<T[]>` →
`Promise<MetadataKeyedItem<T>[]>`, nesting the body under `.data`) is therefore a breaking
change to all four call sites' item-shape assumptions, not just to the audit's — every one
of them would need `item.name` rewritten to `entry.name` (the sibling key) and `item`
rewritten to `entry.data`. A fix that instead changes ONLY the audit's own source (as
recommended below) touches none of these four.

### Internal, package-private fallback — 1

| File:line | Role |
|---|---|
| `packages/metadata/src/metadata-manager.ts:1131` (`admitLoaderItems`, private) | Calls the **loader-level** `loader.loadMany(type)` — not the service-level method above — and ONLY when `loader.loadManyKeyed` is absent (line 1121's `if (typeof loader.loadManyKeyed === 'function')` branch is preferred and returns early). Feeds `readListUncached()`, i.e. `MetadataManager.list()` / `listDiagnosed()`. This is #14205's already-landed repair: `list()` already prefers the keyed loader method wherever one exists, and only degrades to the pre-#14205, `body.name`-keyed behaviour for a loader that cannot produce keys (today, only `RemoteLoader` — see §2). **Not in the blast radius of a `loadMany` return-shape change** — it calls the *loader* interface, which already has the keyed member; it is evidence that the "audit reads keyed" repair has precedent elsewhere in the same file. |

### The function under discussion itself, and its published contract

| Location | What it is |
|---|---|
| `packages/metadata/src/metadata-manager.ts:2660` (`MetadataManager.loadMany`) | The definition. Iterates loaders, calls each `loader.loadMany()` (never `loadManyKeyed`), dedupes by `r.name === itemAny.name` — a dedupe guard, not an identity source (the prior PR's changeset says so explicitly: *"`MetadataManager.loadMany()` is deliberately untouched: its `body.name` test is a DEDUPE guard, not an admission gate"*, `.changeset/loader-item-row-key-identity.md:44`). |
| `packages/spec/src/contracts/metadata-service.ts:675` (`IMetadataService.loadMany?`) | The **published** contract member: `loadMany?<T = unknown>(type: string, options?: Record<string, unknown>): Promise<T[]>`. `MetadataManager` is the sole shipped implementer (`implements IMetadataService`, confirmed by `grep -rn 'implements IMetadataService'` — one hit). Any change to this signature or to what its `Promise<T[]>` elements look like is, by the mechanical floor in the dispatch, a `yes` for Clause-②. |

### Test-only consumers (not production; listed for completeness of the blast-radius accounting a shape change would need)

`packages/runtime/src/action-governance-scope-divergence.test.ts` (the pinned C1-C6
fixture, PR #14741 — explicitly NOT touched this round), `packages/objectql/src/action-governance.test.ts`,
`packages/metadata/src/metadata.test.ts`, `metadata-manager-loader-item-row-key-identity.test.ts`,
`metadata-manager-views-by-object-container.test.ts`, `loaders/database-loader.test.ts`,
`loaders/filesystem-loader-keyed-items.test.ts`. None of these ship; they are the tests a
return-shape change would also have to update, alongside the four production call sites.

**Totals:** 4 production consumers (2 files), all four `body.name`-dependent; 1 internal
fallback (already keyed-preferring); 1 definition; 1 published contract member; 7 test
files that assert today's unkeyed shape.

---

## 2. Per shipped loader — keyed-read inventory and measured cost

**Method:** `grep -rn 'implements MetadataLoader'` (repo-wide) — 4 shipped classes plus 6
test-only fixture doubles (`*.test.ts`, not loaders anyone ships). Each shipped loader's
`list()`, `loadMany()` and `loadManyKeyed()` were read at the cited lines, then the cost
claim was **measured**, not guessed — either by counting the calls a fake engine/fs sees,
or by timing the real implementation. Scripts are committed under `scripts/audits/` (see
§5) so every number below is re-runnable.

| Loader | `listNames` (via `list()`) | `loadManyKeyed` | Cost of `listNames()` + N × by-name `load`/`loadDiagnosed`, vs `loadMany()` |
|---|---|---|---|
| `FilesystemLoader` (`packages/metadata/src/loaders/filesystem-loader.ts`) | Yes, `:366` — a SEPARATE glob, names only, no file bodies read. | Yes, `:220` — shares the same `loadManyEntries()` walk as `loadMany` (`:159-164`), so the two never disagree on which bodies exist. | **Measured, not guessed: ratio 0.99-1.88 across 5 repeated runs of 50 items** (`scripts/audits/14423-filesystemloader-cost-probe.mjs`) — sub-2x, millisecond-scale, dominated by shared-box scheduling noise (this container runs several parallel agents), qualitatively different from `DatabaseLoader`'s exactly-reproducible, linearly-growing N+1 below. One extra name-only glob, then per name up to `resolvableExtensions().length` (today: `json`/`yaml`/`yml`/`ts`/`js`, so ≤5) `fs.access` stats via `findFile()` (`:568-584`) plus one `fs.readFile` — all **local** I/O, no network round trip. |
| `DatabaseLoader` (`packages/metadata/src/loaders/database-loader.ts`) | Yes, `:1062` — its OWN separate query (`_find(..., {fields:['name']})`, its own `listCache`). | Yes, `:988` — shares `readTypeRows()` (`:936`) **and its cache** (`loadManyCache`) with `loadMany` (`:970`): **empirically confirmed 1 query for `loadMany` alone, 1 query for `loadManyKeyed` alone — identical** (`scripts/audits/14423-databaseloader-cost-probe.mjs`). | **Measured: real N+1.** `listNames()` (1 `find`) + N × by-name `load`/`loadDiagnosed` (each its own `findOne`) = **1 + N round trips**, vs `loadMany`/`loadManyKeyed`'s constant **1**, for the SAME 5-item fixture: `{"find":1,"findOne":5}`. This is the loader where "listNames + per-name load" is genuinely, measurably costlier than the alternative — `loadManyKeyed` reuses the exact query `loadMany` already issues, at zero extra cost, where "listNames + load" does not. |
| `MemoryLoader` (`packages/metadata/src/loaders/memory-loader.ts`) | Yes, `:97` — `Map.keys()`. | Yes, `:73` — `Map` iteration, same backing store as `loadMany` (`:55-62`). | **Zero, by construction** — every method here is a synchronous in-memory `Map` operation; there is no I/O of any kind to save or spend. |
| `RemoteLoader` (`packages/metadata/src/loaders/remote-loader.ts`) | Yes, `:113` — but `list(type)` is implemented as `(await this.loadMany(type)).map(i => i.name)`, i.e. it is **already exactly as expensive as `loadMany`** (one full HTTP `GET` of every body), plus mapping. | **No** — the only shipped loader without it (matches the loader-interface's own docblock: *"a loader that cannot produce keys — `RemoteLoader`, whose wire format carries bodies only — simply does not declare it"*, `loader-interface.ts:85-86`). | **Measured by reading the two implementations together, not timed (no live remote fixture in-repo): worst of the four.** `listNames()` costs one full `loadMany`-equivalent fetch (via its own `list()`), THEN a `load()` HTTP `GET` per name — **1 + N HTTP round trips**, strictly worse than plain `loadMany`'s **1**. And because `list()` reads `i.name` off the body, a nameless item pollutes the names array with `undefined` rather than being cleanly dropped or keyed — see the out-of-scope finding below. |

**Only shipped loader without `loadManyKeyed`: `RemoteLoader`.** A `MetadataManager`-level
change that PREFERS `loadManyKeyed` and falls back to `loadMany` keyed by `body.name` (the
same pattern `admitLoaderItems` already uses, §1) would therefore cost **nothing extra**
for `FilesystemLoader`/`DatabaseLoader`/`MemoryLoader` and would leave `RemoteLoader`
exactly where it is today (unkeyed, `body.name`-dependent) — a fix shape worth naming even
though it was not the one recommended below, because it is the cheapest of the three
shapes measured here for 3 of 4 loaders.

---

## 3. C3 and C4 re-measured against the keyed shape

**Method:** the exact doubles the pinned fixture (`packages/runtime/src/action-governance-scope-divergence.test.ts`,
PR #14741 — read in full before measuring, per its own instruction) uses for C3
(`readEngine`/`listDownEngine`) and C4 (a `SCOPED` `metadata` factory on a real
`ObjectKernel`), transcribed (not imported — the fixture is a `.test.ts` with no export
surface) into `scripts/audits/14423-c3-c4-keyed-mechanism-probe.mjs`, driven against the
REAL, built `@objectstack/metadata` and `@objectstack/core`. This file is **not** touched;
the probe is a new, separate script that answers a different question than the fixture
does (does the CANDIDATE mechanism close the gap, not does the CURRENT code diverge).

### C3 — plural read throws, by-name read answers: **NOT closed by keying alone**

```json
"listNames": {
  "threwInsideListNames": true,
  "errorMessage": "connect ECONNREFUSED 10.0.0.5:5432",
  "standaloneLengthAfterOuterSwallow": 0
}
```

`MetadataManager.listNames()` (`metadata-manager.ts:1571-1591`) has **no per-loader
try/catch** — unlike `loadMany()`/`list()`, which catch a loader's failure, log it via
`reportLoaderReadFailure`, and continue with a `degraded` flag. So under the same
`listDownEngine` double the fixture uses, `listNames('action')` **throws**, exactly as
measured. The audit's OWN outer swallow (`collectEngineActionDeclarations`'s
`try { standalone = await loadStandaloneActions?.() } catch { standalone = []; }`,
`action-governance.ts:247-251`) catches it — so the externally-visible OUTCOME is
identical to today's `loadMany`-based behaviour: `standalone = []`, the audit still
accuses the handler. **Swapping the read method relocates where the same failure is
swallowed; it does not change whether it is swallowed.** This is confirmed, not inferred
— `loadMany` alone: `{"threw": false, "standaloneLength": 0}` (matches the pinned fixture's
`enumerated` = `[]`); `listNames` alone: throws internally, same net zero after the outer
catch.

**The mechanism that WOULD close C3** (measured in the same script,
`perRegisteredHandlerProbe`): skip enumeration entirely. `meta.loadDiagnosed('action', ACTION)`
— probing the ALREADY-KNOWN registered-handler name directly, exactly as the router does
and exactly as `dropHandlersDeclaredInRegistry` already does for the registry rung
(`action-governance.ts:287-305`) — succeeds (`wouldCoverTheHandler: true`), because it
never calls `list()`/`loadMany()` on ANY loader; it only ever calls `_findOne`, which
`listDownEngine` leaves untouched. This requires redesigning the audit's declaration-source
contract from "give me everything of this type" to "give me the declaration for THIS name",
which is a bigger, but narrower and more effective, change than a read-method swap — and it
is exactly what step 2's "change the audit's source" option (named in the ruling) can mean
if read this way, rather than as a literal `listNames()`-then-loop.

### C4 — audit's own service lookup throws before any read method runs: **NOT closed by keying alone, for a different reason**

```json
"auditServiceLookup": { "threw": true, "error": "Service 'metadata' is async - use await" },
"routerServiceLookup": { "resolvedAnInstance": true, "byNameAnswers": true }
```

The failure here is entirely upstream of `loadMany`: `ctx.getService('metadata')` throws
on a `SCOPED` registration before ANY of `loadMany`/`listNames`/`load`/`loadDiagnosed` is
even called (`ObjectKernel.getService` refuses a scoped-only service synchronously — the
real error text differs slightly from what the original fixture's own commentary
anticipated, `"Service 'metadata' is async - use await"`, but the outcome, a thrown
exception before any read, is the same). **No choice of read method changes this** — it is
a service-accessor scoping problem, not an identity-shape problem, and the census's own
mandate is honest about that: "if keying alone does not close them, the census says which
mechanism does." **The mechanism that would close C4 is a different accessor** — reaching
the SCOPED instance somehow (e.g. iterating known `scopeId`s at inventory time, or running
governance once per environment instead of once per boot) — which is a materially larger
change than the identity fix and, per the prior measurement round's own finding, describes
a shape (`ServiceLifecycle.SCOPED` on `metadata`) **no in-repo composition actually uses
today** (`packages/metadata/src/plugin.ts:374` registers a static instance). C4 is real and
reproducible, but its remedy is out of both this census's and step 2's stated scope.

---

## 4. `unboundDeclarations` — the BEFORE count

**Command:** `node scripts/audits/14423-unbound-declarations-before-count.mjs` (script
committed; requires `pnpm --filter '@objectstack/objectql^...' build` first, already done
for this census).

**Result: 0**, for the population the identity fix can move — reproducibly, not by
observation of a live environment (see the caveat below on why a live-environment number
would not be more informative here).

```json
{
  "namelessOrphansSubmitted": 5,
  "namedOrphanSubmitted": 1,
  "unboundDeclarationsReported": 1,
  "unboundDeclarationsList": ["global:named_orphan_action"],
  "declarationsAdmitted": 1
}
```

**Why 0 is a structural fact, not a sampling accident:** `collectEngineActionDeclarations`
(`action-governance.ts:231-261`) filters `typeof action.name !== 'string'` **before**
`reconcileActionRegistrations` (`:173-215`, which computes `unboundDeclarations`) ever sees
the item. A nameless standalone `script` action with no handler is dropped at the FIRST
gate, so it structurally cannot reach the SECOND gate that would report it as
`unboundDeclarations`. The 5-item control above demonstrates it directly: 5 nameless
orphans submitted, 0 reported; a 6th, named, orphan submitted alongside them IS correctly
reported (`declarationsAdmitted: 1`, matching only the named one), confirming the harness
finds orphans in general and specifically drops the nameless ones — not that orphans are
never found at all.

**What this means for step 2's before/after diff:** if the identity fix admits
previously-dropped nameless-body standalone `script` actions into `declarations` (whether
via a keyed `loadMany` or a keyed audit source), any such action that is *also* orphaned
(no handler, no `body`) becomes **NET NEW** to `unboundDeclarations` — there is no
"before" entry it replaces, because none could exist. The before/after count the ruling
asks for is therefore `0 → (however many real, deployed, nameless, orphaned standalone
actions exist)` — a population this census did not attempt to survey live (see the note
in §2.2 on why a live count was not pursued: none of the repo's example apps declare
standalone metadata-plane `action` items at all — `examples/app-crm`'s and
`examples/app-showcase`'s actions are `defineAction`-in-TS-source, object-embedded at the
bundle level, not metadata-plane rows — so a live count today would read 0 for a reason
unrelated to the identity gap, and would not be the number step 2 needs).

---

## 5. Clause-② — does the recommended fix change `loadMany`'s published return shape?

**Recommendation: no fix to `loadMany`'s shape at all.** Per §1, zero of the four
production consumers already key by the store key, so any widening of
`IMetadataService.loadMany`'s return type is a breaking change to every one of them, on top
of being, by the dispatch's own mechanical floor, an unconditional Clause-② `yes`. Per §3,
a return-shape change closes C2/C6 (the identity gap) exactly as well as a keyed
`listNames()`/`loadManyKeyed()` read would, but closes **neither** C3 nor C4 — the same
ceiling every keyed-read shape hits. Given a shape that closes C2/C6 and NOT C3/C4 either
way, the shape with the smaller, more contained blast radius is the one recommended: fix
the audit's OWN declaration-discovery strategy (probe already-known registered-handler
names directly, per §3's "mechanism that would close C3"), entirely inside
`packages/objectql/src/action-governance.ts` / `plugin.ts`, using ALREADY-PUBLISHED
`IMetadataService` members (`load` / `loadDiagnosed`, both already optional members of the
contract at `metadata-service.ts:838` / `:861`) — no new exported symbol, no new key on
any published payload, no change to the four production consumers in §1.

**Under that recommendation: Clause-② = `no`.** Under the mechanical floor, this
determination is provisional and reverses automatically if step 2's own reading concludes
differently (e.g. it decides the `loadManyKeyed`-preferring path in §2's closing note is
worth the RemoteLoader carve-out, which WOULD add a new optional `IMetadataService` member
and IS Clause-② `yes`).

---

## In-scope findings that are not this card's to fix

Two additional production call sites (§1, rows 3 and 4) drop or mis-key nameless standalone
items in ways that mirror C2/C6 but sit at different points in the boot sequence than the
governance audit — `loadMetadataFromService` (registers under key `undefined` when both
`id` and `name` are absent) and `MetadataPlugin._loadFromFileSystem` (skips registration
entirely). These are reported here because §1 asks for them; whether they are fixed
alongside the audit, left as a documented ceiling, or ticketed separately is step 2's or
the maintainer's call, not this census's.

## Out-of-scope finding (unrelated defect, noticed while surveying loaders for §2)

**`RemoteLoader.list()` can return `undefined` as a "name."** `list()` is implemented as
`(await this.loadMany(type)).map(i => i.name)` (`remote-loader.ts:113-116`) — a body with no
`name` maps to `undefined`, which is pushed into the `Promise<string[]>` this method
declares. `MetadataManager.listNames()` (`metadata-manager.ts:1571-1591`) would then add
that `undefined` into its returned name `Set` for any type served by a `RemoteLoader`. This
is a distinct, pre-existing defect, unrelated to #14423's identity question (RemoteLoader
cannot produce keys at all, so it is out of scope for the C2/C6/C3/C4 fix either way) —
found incidentally while building the loader table in §2. **Filing status:** a targeted
`search_issues` dedup check hit the fleet's shared GraphQL rate limit twice in a row
(`API rate limit already exceeded for user ID 323835826`) rather than a real answer,
so per the no-blind-filing rule this is reported here, unfiled, for the PM to file (or to
direct a re-check once the rate limit clears) rather than risk a duplicate.

---

## Commands to re-run every measurement in this census

```bash
# Build the dependency closures this census's scripts import from (dist, not src):
pnpm --filter '@objectstack/objectql^...' build && pnpm --filter @objectstack/objectql build

# §2.1 / §2.2 enumeration (the raw grep this census's tables are built from):
grep -rn '\.loadMany(' --exclude-dir=node_modules .
grep -rn 'implements MetadataLoader' --exclude-dir=node_modules packages/

# §2.2 loader cost — measured, not guessed:
node scripts/audits/14423-databaseloader-cost-probe.mjs
node scripts/audits/14423-filesystemloader-cost-probe.mjs

# §3 — C3/C4 against the keyed shape:
node scripts/audits/14423-c3-c4-keyed-mechanism-probe.mjs

# §4 — unboundDeclarations BEFORE count:
node scripts/audits/14423-unbound-declarations-before-count.mjs
```

All four scripts print a JSON line to stdout (machine-readable) and a human-readable
summary to stderr; all exit 0 (measurements, not gates) and ship nothing — no shipped
package's `src/` changed on this branch.
