# #8038 handover — os-dev → PM (`domain:metadata`, #6367)

**No code on this branch.** Handover text only. The code for #8038 is on
`claude/issue-8038-search-companion-route-divergence` (commit `92d8d5e`, merged
with `origin/main` at `7c21fb2` in `bec8a73`), now open as **PR #8255**.

Container was 403 on every GitHub API call (issue read, PR create, PR comment),
and has no `gh` CLI and no browser — so I never read the card in the web UI
either. Everything below is measured in-container.

---

# 1. UNFILED FINDING — full issue text, ready to file

> ⭐ This is the item at risk. It exists nowhere else. Please file it verbatim.

## Title

`GET /meta/object/:name` drops `nameField` for artifact-ingested objects — the same seam as #8038, one stamp over

## Labels (suggested)

`domain:metadata`, `type:defect`, related: #8038, #7556, #8027, #6562, #8037

## Symptom

For an object whose by-name read is answered from the `metadata` service (an
artifact-booted deployment), `GET /meta/object/:name` serves

```
nameField: undefined
```

while `GET /meta/object` and the `SchemaRegistry`'s own resolved schema serve

```
nameField: 'name'
```

for the same object, at the same moment, on the same host. Nothing in the
response tells a caller which of the two answers they got.

`nameField` is the ADR-0079 display/title designation. A consumer reading the
by-name answer concludes the object has no designated title field, and every
title-rendering decision derived from that read (forms, record headers, lookup
labels, `resolveDisplayField` consumers that trust the served document) is made
against a document the platform itself does not agree with.

## The measurement that established it

Found incidentally while measuring #8038, on the reproduction host built for it:
a real `SchemaRegistry`, a real `ObjectStackProtocolImplementation`, a real
`RestServer`, with the `metadata` service holding the artifact's raw
declaration (`serviceMode: 'artifact'` — what `MetadataPlugin` registers when a
deployment ingests a compiled artifact, where `objects` and `objectExtensions`
are separate collections).

I diffed the two served bodies **key by key** rather than comparing only the
fields map, precisely so a second divergence could not hide behind the one I was
sent for. Serialised-value comparison over the union of top-level keys:

```
### artifact host
 listed   : __search,created_at,created_by,industry,name,organization_id,
            owner_id,owning_business_unit_id,updated_at,updated_by
 byName   : created_at,created_by,industry,name,organization_id,
            owner_id,owning_business_unit_id,updated_at,updated_by
 registry : __search,created_at,created_by,industry,name,organization_id,
            owner_id,owning_business_unit_id,updated_at,updated_by

 byName vs listed   diverge on keys: fields,nameField
 byName vs registry diverge on keys: _diagnostics,fields,nameField
 byName.nameField = undefined     registry.nameField = 'name'
```

Two keys diverged. `fields` was #8038 (`__search`). **`nameField` is this
issue.** (`_diagnostics` is a read decoration present on served bodies and
absent from registry bodies — benign, not a divergence between the two routes.)

Control, same run, same probe: on the `bridged` host (in-process boot, where
`bridgeObjectsToMetadataService` seeds the service from
`registry.getAllObjects()` — already-materialized bodies) and the `absent` host
(no `metadata` service, read falls through to the registry), the same comparison
printed `byName vs listed diverge on keys: (none)` and
`byName.nameField = name`. So the probe can see agreement when agreement
exists, and the divergence tracks the service copy specifically.

## Root cause

Identical to #8038. The by-name read resolves `sys_metadata` overlay →
MetadataService → SchemaRegistry, and only the last link has been through the
registry's object-materialization seam. `nameField` is written by
`provisionPrimary(schema, { synthesize: false })` — the line **immediately
above** `provisionSearchCompanion` inside `SchemaRegistry.registerObject`, under
the same base-layer gate (`ownership === 'own' || ownership === 'overlay'`). The
artifact copy is the author's declaration captured before that seam runs, so it
carries neither stamp.

## Where (anchored on function names, not line numbers)

- `packages/objectql/src/registry.ts` — `SchemaRegistry.registerObject`, the
  ADR-0079 materialization block that calls `provisionPrimary` and then
  `provisionSearchCompanion`. This is the producer of the correct answer.
- `packages/spec/src/data/display-name.ts` — `provisionPrimary`, the transform
  itself (pure, `synthesize: false`, idempotent).
- `packages/metadata-protocol/src/protocol.ts` — `ObjectStackProtocolImplementation.getMetaItem`
  (step 2, the `readItemFromMetadataService` branch) is where the unmaterialized
  copy enters; `governServedObject` is the read exit where #8038's convergence
  now happens and where this one would go; `getMetaItemLayered` needs the same
  treatment on `effective` only.
- Seam added by #8038 that this would reuse:
  `SchemaRegistry.provisionSearchCompanionOnto` (public, applies the registry's
  own gated decision to a caller-supplied base) and its protocol-side caller
  `ObjectStackProtocolImplementation.provisionSearchCompanionFromRegistry`. A
  `provisionPrimaryOnto` sibling drops into exactly the same shape.

## Reproduction

On `main` (before or after #8038 — #8038 does not touch `nameField`):

1. Build a `SchemaRegistry`, register an object with a title-eligible field
   (e.g. `{ name: 'showcase_account', fields: { name: {type:'text'}, industry: {type:'text'} } }`)
   as `ownership: 'own'`.
2. Put the **raw declaration** (not `registry.getObject(name)`) into the
   `metadata` service under `get('object', name)` — this is the artifact-ingest
   shape.
3. Read both routes through a real `RestServer` over a real protocol.
4. `byName.item.nameField` is `undefined`; the matching entry from
   `GET /meta/object` and `registry.getObject(name).nameField` are both `'name'`.

The harness in
`packages/rest/src/meta-object-search-companion-agreement.test.ts` (added by
#8038) already builds exactly this host — its `measure({ serviceMode: 'artifact' })`
is a one-line extension away from asserting `nameField` agreement too.

## Why this is separate from #8038

#8038 is scoped to the `__search` companion column. `nameField` is a **different
stamp with a different gate**: `provisionSearchCompanion` is deployment-gated
(`OS_SEARCH_PINYIN_ENABLED` / the registry's `searchCompanion` option), while
`provisionPrimary` runs unconditionally on every base layer. They also land in
different parts of the document (`fields` vs a scalar prop), which matters
because — unlike `__search` — **`nameField` is a scalar property
`mergeObjectDefinitions` resolves last-writer-wins**, so it may already fall
inside **#8037**'s enumeration of every property that merge touches.

I deliberately did **not** fix it in #8038's PR for that reason: fixing it in
two places concurrently is worse than fixing it in one, and the PM asked to be
told rather than have both dispatches converge on the same lines. **Please
reconcile with #8037 before assigning.** If it is ruled mine, it is a one-line
addition to the seam #8038 already installed.

## Dedup search performed (GitHub search unavailable — 403)

Repo-side only, so this is not a guarantee that no GitHub issue exists.

| Search | Result |
|---|---|
| `grep -rn "nameField" packages/metadata-protocol/src packages/rest/src` | 7 hits, none about route agreement. Only `protocol.ts`'s `displayField: gate.schema?.nameField ?? gate.schema?.displayNameField` (a consumer, not a producer) and two unrelated test fixtures. |
| `grep -rn "provisionPrimary" packages/ --exclude tests` | Exactly **one** production call site: `SchemaRegistry.registerObject`. No read-exit convergence anywhere. |
| `grep -rln "provisionPrimary" **/*.test.ts` | `engine-write-not-found-gate.test.ts`, `stamped-system-fields-spec-conformance.test.ts`, `spec/src/data/display-name.test.ts` — all test the transform in isolation; none compares the two `/meta` routes. |
| `grep -rln "nameField" .changeset/*.md` | 7 changesets. Nearest neighbour reviewed below. |

**Nearest neighbour, reviewed and ruled NOT a twin:**
`.changeset/adr0029-d9-object-overlay-contributor-layer.md` says (translated)
*"the gate on `provisionPrimary` / `provisionSearchCompanion` changes from 'is
it `own`' to 'is it a BASE LAYER', otherwise the `nameField` of every overlaid
object would change."* That is the **registration-side gate** — which layers get
stamped at `registerObject` time. It does not address a read serving a copy that
never went through `registerObject` at all. Adjacent prior art worth citing in
the issue; not a duplicate.

**No twin found.**

## Suggested framing for the maintainer

Three materialization stamps have now been found diverging on this one path, one
at a time:

| # | Stamp | Ruling / status |
|---|---|---|
| #6562 | injected system columns (`created_at`, `owner_id`, `organization_id`, …) | ruled 2026-08-08, Option B — converge at read exits |
| #8038 | `__search` companion column | this PR, same shape |
| *this* | `nameField` (`provisionPrimary`) | unfiled |

Worth ruling on the **class** rather than the third instance: a single
"materialize this base the way the registry materializes its own" seam —
`provisionPrimary` + `provisionSearchCompanion` behind one registry method,
applied at the read exits — closes it and stops a fourth stamp arriving as a
fourth card. #8038 built half of that seam already.

---

# 2. Structured report for #8038

<!-- os-dev-report -->

```json
{
  "issue": 8038,
  "branch": "claude/issue-8038-search-companion-route-divergence",
  "commit": "92d8d5e",
  "merge_commit": "bec8a73",
  "merged_with_main_at": "7c21fb2",
  "pr": 8255,
  "premise_still_valid": true,
  "premise_notes": [
    "The card's framing — the by-name route is the one that is wrong — HOLDS. Established from the settled ruling on this exact seam, not from taste: #6562 asked the identical question about the platform's injected system columns and the maintainer ruled (2026-08-08, Option B) that a /meta object read serves the EFFECTIVE runtime schema and the minority path converges on the registry-backed majority.",
    "The 'both routes should drop it' alternative was considered and is NOT supported. #7642's stripSearchCompanion is scoped in its own docstring to record VALUES on the data path ('deliberately this one column, not hidden system columns as a class'). The schema surface is the opposite: #7561 exists precisely BECAUSE /meta re-parses the served object body and the companion's stamp had to be spec-valid there, which is only reachable if the companion travels on /meta.",
    "The card's 22 is EXACT. The card's 71 does NOT reproduce — I measure 46 platform objects (45 companion-bearing) on the showcase deployment, 69 objects total, not 93. The SHAPE of the claim is perfect (package objects dropped, platform objects kept, list keeps both); only the platform-side count differs, and that is deployment-composition dependent rather than a defect claim."
  ],
  "same_root_cause_as_fold_family": "YES, same family — but a different sub-seam than the sibling is enumerating. The by-name read resolves overlay -> MetadataService -> registry and only the last link is materialized. This is the #6562 sub-family (materialization stamps not converged at the read exit), NOT the #7556/#8027 fold sub-family. Decisive distinction for reconciliation: __search is PROVISIONED, not MERGED — it never passes through mergeObjectDefinitions — so #8037's enumeration of merged properties will not find it and the two dispatches do not overlap.",
  "root_cause": "The __search companion is provisioned at the SchemaRegistry's object-materialization seam (SchemaRegistry.registerObject). GET /meta/object composes from listItems('object'), so it serves a materialized body. GET /meta/object/:name consults the `metadata` SERVICE first, and on a deployment booted from a compiled artifact (artifactSource) that service holds the author's declaration captured BEFORE materialization. Platform objects are registered straight into the registry, so their by-name read never meets that copy — hence the clean provenance partition, not a per-object accident.",
  "fix_shape": "Convergence at the READ EXITS, from the registry that made the deployment-gated decision. Deliberately NOT a re-add at the route (the shape this lane rejected on #4432 and #7556).",
  "production_changes": [
    "packages/objectql/src/registry.ts — NEW public SchemaRegistry.provisionSearchCompanionOnto(base). Applies this registry's own gated provisioning decision to a caller-supplied base. Public API for the same reason foldObjectExtendersOnto (#7556) is. The gate is the registry's own `searchCompanion` FIELD, not a fresh resolveSearchPinyinEnabled() call — that field is `options.searchCompanion ?? resolveSearchPinyinEnabled()`, so re-deriving would let the pass and the decision disagree (the #6562 failure mode restated).",
    "packages/objectql/src/registry.ts — NEW public SchemaRegistry.stripProvisionedSearchCompanionFrom(base). Write-side counterpart. Exact: removes only an entry byte-identical to what provisionSearchCompanion would stamp, RECOMPUTED from that function rather than transcribed. Deliberately NOT gated on searchCompanion (read and write are different requests; the gate may flip in between).",
    "packages/metadata-protocol/src/protocol.ts — NEW private provisionSearchCompanionFromRegistry, governServedObject, stripSearchCompanionFromRegistry, stripServedObjectColumns. governServedObject composes the new pass AFTER governServedItem, matching the registry's own order (applySystemFields -> provisioning) so the companion's source field is resolved over the same post-injection field set.",
    "5 read exits rewired from the free governServedItem to this.governServedObject; 1 write site rewired from stripServedSystemColumns to this.stripServedObjectColumns. ?layers=true's `code` and `overlay` layers left byte-verbatim (#6562 ruling constraint 1, #7556's boundary)."
  ],
  "pins": [
    {
      "file": "packages/rest/src/meta-object-search-companion-agreement.test.ts",
      "asserts": "AGREEMENT, never presence. Both sides measured from the real producers in one test (real RestServer -> real ObjectStackProtocolImplementation -> real SchemaRegistry). A presence pin would pass again the day someone special-cases the route.",
      "hosts": [
        "artifact-ingested (service holds the raw declaration) — the 22",
        "registry-only, no metadata service — the platform side",
        "bridged in-process (service seeded from the materialized registry)",
        "overlay-row-backed sys_metadata (the third link; the ONLY host the list exit converges)"
      ],
      "guards_against_8045": "Every host also pins what the two routes agree ON — the registry's own materialized schema — so 'both routes agree on a wrong body' fails here rather than passing green.",
      "anti_vacuity": [
        "deployment gate OFF -> neither route serves the column, and they still agree",
        "object with NO title-eligible field -> neither route serves it, with the gate ON, so it is the OBJECT and not the gate that empties this case",
        "artifact host additionally asserts serviceBody does NOT contain __search (the host genuinely differs) and listed DOES (the list read has not quietly lost it too)"
      ]
    },
    {
      "file": "packages/objectql/src/meta-object-search-companion-roundtrip.test.ts",
      "asserts": "The #4326 byte-identical GET -> PUT invariant survives the convergence. Lives in objectql for the reason protocol-meta-effective-schema.test.ts does: only that package has the real registry AND the real protocol write (objectql depends on metadata-protocol, never the reverse).",
      "cases": [
        "GET -> edit label -> PUT stores fields:[name], byte-identical to the first save apart from the edited key",
        "round-trip with NO edit leaves the stored body byte-identical",
        "exactness: a body carrying a DIFFERENT definition under __search keeps it"
      ]
    }
  ],
  "reverse_verification_per_arm": [
    { "arm": "registry.provisionSearchCompanionOnto disabled", "red": ["artifact host", "overlay host"] },
    { "arm": "by-name read exit reverted", "red": ["artifact host (byName)", "overlay host (byName)"] },
    { "arm": "layered `effective` exit reverted", "red": ["artifact host only (layerEffective)"] },
    { "arm": "list read exit reverted", "red": ["overlay host only (listed)"] },
    { "arm": "write-side strip reverted", "red": ["2 of 3 round-trip cases; the exactness case correctly stays green"] }
  ],
  "reverse_verification_note": "The list exit was initially GREEN under revert — it looked like a spare change. That was a GAP IN MY PIN, not a spare change: an overlay-row-backed list entry is not materialized either, and my engine stub had no sys_metadata rows. I added an overlay host; the list exit then became load-bearing and is now attributed. Anti-vacuity cases stay green under every revert.",
  "end_to_end_measurement": {
    "harness": "packages/qa/dogfood — bootStack(showcaseStack) + MetadataPlugin with artifactSource from writeBuildShapedArtifact, the same boot #7556's dogfood pin uses and for the same stated reason (the shared in-process harness seeds the metadata service from already-materialized bodies, so the bug is invisible there).",
    "env": "OS_SEARCH_PINYIN_ENABLED=true",
    "objects_served": 69,
    "before": { "package_objects": 23, "pkg_listed_has": 22, "pkg_byname_has": 0, "platform_objects": 46, "plat_listed_has": 45, "plat_byname_has": 45, "routes_disagreeing": 22 },
    "after":  { "package_objects": 23, "pkg_listed_has": 22, "pkg_byname_has": 22, "platform_objects": 46, "plat_listed_has": 45, "plat_byname_has": 45, "routes_disagreeing": 0 },
    "objects_with_no_companion_on_either_route": ["showcase_project_membership", "sys_session"],
    "note": "Re-run after merging origin/main; identical readings."
  },
  "commands_and_readings": [
    "cd packages/rest && npx vitest run src/meta-object-search-companion-agreement.test.ts  ->  6 passed",
    "cd packages/objectql && npx vitest run src/meta-object-search-companion-roundtrip.test.ts  ->  3 passed",
    "cd packages/rest && npx vitest run src/meta-object-extension-agreement.test.ts src/meta-object-overlay-extension-fold.test.ts  ->  #8015 and #8045 pins green",
    "cd packages/objectql && npx vitest run  ->  193 files, 3403 passed",
    "cd packages/metadata-protocol && npx vitest run  ->  75 files, 1094 passed",
    "cd packages/rest && npx vitest run  ->  104 files, 1737 passed",
    "cd packages/runtime && npx vitest run  ->  145 files, 2195 passed",
    "cd packages/qa/dogfood && npx vitest run  ->  99 files passed / 1 skipped, 673 passed / 3 skipped",
    "pnpm check:type-check-debt  ->  EXIT 0 on a built closure; 'none above its recorded number'. No ledger entry raised, no --lower run.",
    "pnpm check:nul-bytes  ->  OK (7430 text files)",
    "pnpm check:empty-changeset  ->  OK, 1 declaring changeset added",
    "npx eslint <4 changed files> --no-inline-config  ->  exit 0",
    "cd packages/objectql && npx tsc --noEmit  ->  exit 0;  cd packages/rest && npx tsc --noEmit  ->  exit 0"
  ],
  "changeset": {
    "file": ".changeset/meta-object-search-companion-agreement.md",
    "level": "patch on @objectstack/objectql and @objectstack/metadata-protocol",
    "justification": "A payload change for every consumer of these routes: the by-name read on an artifact-booted deployment now carries one additional hidden field declaration (__search: hidden, system, readonly, searchable:false) where it previously did not, matching what the list read has always served. Nothing is removed. Patch rather than minor because it converges a minority path onto the majority path's existing, already-shipped answer rather than introducing a new contract."
  },
  "open_questions": [
    "nameField divergence — section 1 of this handover. Needs reconciling with #8037 before assignment.",
    "Whether the maintainer wants the general 'materialize this base like the registry does' seam (closing the class) rather than a third per-stamp fix. #8038 built half of it.",
    "The end-to-end probe's status-code gap — section 3 below. Stated, not hidden."
  ]
}
```

---

# 3. How the provenance split was measured, and the anti-vacuity control

## Method

Booted the showcase through `@objectstack/verify`'s `bootStack` with a
`MetadataPlugin` reading a **build-shaped artifact**
(`writeBuildShapedArtifact`, the real `objectstack build` lowering, not
`JSON.stringify(stack)`), `artifactSource: { mode: 'local-file' }`,
`OS_SEARCH_PINYIN_ENABLED=true`. This is the boot #7556's dogfood pin uses and
for the reason it documents: the *shared* in-process harness seeds the
`metadata` service from `registry.getAllObjects()` — already-materialized
bodies — so the defect is invisible there and a green on that harness means
nothing.

Then: `GET /meta/object` once; `GET /meta/object/:name` for **every** name it
returned; classify each object as "package" iff its name is in the artifact's
own `objects` collection; record `__search` presence on each side.

## Anti-vacuity controls that DID run

1. **The agreeing (platform) side is not empty.** `plat_listedHas = 45` and
   `plat_byNameHas = 45` — both non-zero. Agreement there is 45 objects
   genuinely carrying the column on both routes, not two empty reads matching.
2. **The probe discriminates within one population.** `sys_session` is a
   platform object reading `listed=false, byName=false`, sitting alongside 45
   platform objects reading `true/true`. A predicate that was always-true or
   always-false could not produce that split. Same on the package side:
   `showcase_project_membership` reads `false/false` among 22 reading
   `true/false` before the fix.
3. **Three distinct outcomes from one probe in one run** (22 true/false, 45
   true/true, 2 false/false) — the probe is not reading a dead path.
4. **The `absent`/`bridged` unit hosts print `diverge on keys: (none)`** while
   the `artifact` host prints `fields,nameField` — the comparison can see
   agreement where it exists.
5. **Directionality asserted, not assumed.** All 22 package disagreements were
   verified to be specifically `listed=true, byName=false` (checked
   programmatically over the saved rows), never the reverse.
6. **Before/after on the same harness**: disagreements 22 → 0 while the platform
   side stayed 45/45 and the two no-companion objects stayed at none. The fix
   moved exactly the population it was supposed to and nothing else.

## ⚠️ STATED GAP — the one control I did NOT run

The probe recorded the by-name read as:

```ts
const r = await stack.apiAs(token, 'GET', `/meta/object/${name}`);
const b: any = r.status === 200 ? await r.json() : undefined;
rows.push({ ..., byName: hasSearch(b?.item) });
```

**A non-200 collapses into `byName: false`, indistinguishable from "200 whose
body lacks the column".** I did not assert the status code per object, so the
*pre-fix* reading of "22 dropped" does not by itself exclude "some of those 22
were an error status rather than a 200 without the column".

What bounds that gap — stated so you can weigh it rather than take a clean:

- **Post-fix, all 67 companion-bearing objects read `byName: true`**, which
  requires a 200 *and* a parsed `item` envelope. So the probe's path, envelope
  key and predicate are all demonstrably correct on the same objects.
- The **unit pin** measures the by-name body directly off the handler and
  asserts the served field list *equals* the list read's — that establishes
  "200 with a body lacking the column", which is the claim the status gap
  leaves open at the HTTP layer.
- The pre-existing dogfood pin
  `showcase-object-extension-meta-read.dogfood.test.ts` asserts
  `expect(res.status).toBe(200)` for `GET /meta/object/showcase_account` — one
  of the 22 — so at least that member of the population was a 200 on `main`.

I judge the finding solid on those three, but the per-object status assertion is
a real hole in the end-to-end probe and I would rather you carry it stated. The
probe itself was scratch and is **not** committed; the committed pins do not
have this weakness.

---

# 4. Concurrency notes for other editors of `protocol.ts` / `registry.ts`

Both files had other claimed regions in this lane today. Everything I did is
**additive**; I renamed nothing and moved nothing.

## `packages/metadata-protocol/src/protocol.ts`

**Added** (all private, all adjacent to `foldObjectExtendersFromRegistry`):
`provisionSearchCompanionFromRegistry`, `governServedObject`,
`stripSearchCompanionFromRegistry`, `stripServedObjectColumns`.

**Changed — 6 one-line call-site rewires, no logic moved:**

| Where (function name) | Before | After |
|---|---|---|
| `getMetaItems` (list exit, inside the `items` map) | `governServedItem(...)` | `this.governServedObject(...)` |
| `getMetaItem` (draft preview return) | `governServedItem(...)` | `this.governServedObject(...)` |
| `getMetaItem` (strict draft return) | `governServedItem(...)` | `this.governServedObject(...)` |
| `getMetaItem` (main return) | `governServedItem(...)` | `this.governServedObject(...)` |
| `getMetaItemLayered` (`effective` only) | `governServedItem(...)` | `this.governServedObject(...)` |
| `saveMetaItem` (write strip) | `stripServedSystemColumns(...)` | `this.stripServedObjectColumns(...)` |

⚠️ **The free functions `governServedItem` and `stripServedSystemColumns` still
exist and are unchanged.** If you are adding a new `/meta` object READ EXIT,
call `this.governServedObject`, not the free function — the free function no
longer carries the whole contract. Same for a new write site and
`this.stripServedObjectColumns`.

⚠️ `getMetaItemLayered`'s `code` and `overlay` layers are still deliberately
**raw** — I did not touch them. **This is the boundary #8037 is working next
to** (its `label`-on-`?layers=true` finding). If #8037 changes the `code` layer
fold, our changes are adjacent but should not collide: mine is strictly the
`effective` line plus the four other exits.

## `packages/objectql/src/registry.ts`

**Added** two public methods immediately after `foldObjectExtendersOnto`:
`provisionSearchCompanionOnto`, `stripProvisionedSearchCompanionFrom`.
**Changed** one import line to add `SEARCH_COMPANION_FIELD` alongside the
existing `provisionSearchCompanion` from `./search-companion.js`.

⚠️ `SchemaRegistry.registerObject`'s materialization block is **untouched** —
I read it but changed nothing there. Anyone editing the `provisionPrimary` /
`provisionSearchCompanion` gate should know the read path now depends on
`provisionSearchCompanion` staying **pure and idempotent** (the strip
recomputes the canonical stamp by calling it), which it already documents
itself to be.

The merge with `origin/main` (9 commits, including `fix(rest): meta app by-name
answers a permission-denied envelope` which touches the by-name meta path, and
two objectql changes) was **clean, no conflicts**, and all five suites were
re-run green afterwards.

---

# 5. Other findings and lane bookkeeping

## 5.1 Write-side regression I introduced and closed inside the PR (not out of scope, but you should know it happened)

The read-side convergence alone **broke the #4326 byte-identical GET → PUT
invariant**, and I only found it because I measured instead of reasoning.
Measured on the runtime-created object path (the write door type `object` has
open by default — an artifact-backed object refuses the save outright with
`NOT_OVERRIDABLE`, and any deployment listing `object` in
`OS_METADATA_WRITABLE` reaches it too):

| | stored `fields` |
|---|---|
| baseline on `main` | `[name]` |
| read-half only (no strip) | `[__search, name]` after one GET → PUT |
| shipped (read + strip) | `[name]` |

#6562's `governServedItem` docstring states outright that the write path owes it
a counterpart; that debt applied to my change too. Closed inside the same PR
with `stripProvisionedSearchCompanionFrom` and pinned. **Nothing to file** —
recorded because the same trap is waiting for whoever converges the next stamp
(including the `nameField` one above).

## 5.2 Pre-existing type-check-debt surplus (not mine, not touched)

`pnpm check:type-check-debt` exits 0 but reports **271 raw errors across 9
entries sitting BELOW their recorded ceiling** — `@objectstack/metadata` (−3),
`service-automation` (−2), `service-storage` (−1), `plugin-approvals` (−199),
`plugin-auth` (−23), `mcp` (−10), `lint` (−22), `plugin-security` (−10),
`http-conformance` (−1). Per instruction I did **not** run `--lower` on any of
them and raised no ledger entry. Flagging only because that many regressions can
land in layers no other gate reads (the gate's own warning, ref #6376).

## 5.3 Lane bookkeeping — two dispatch details that were slightly off

- The dogfood package is **`@objectstack/dogfood`** at `packages/qa/dogfood`,
  not `@objectstack/qa-dogfood`. There is no package by the latter name; a
  repo-wide grep for `qa-dogfood` returns nothing. Worth correcting in the
  dispatch template so the next seat does not lose time on it.
- `packages/metadata-protocol` **does** have a `test` script (`vitest run`).
  The dispatch's TEST_DEBT note is right that it has no **`typecheck`** script
  of its own — only that half.
- The container had **no repo checked out at all** on start (`/home/user`
  empty); I had to `add_repo` + clone before any work. If that is not intended,
  the next seat loses the same ~10 minutes.

## 5.4 Benign, recorded so nobody re-finds it as a defect

`_diagnostics` appears on served bodies and not on `registry.getObject(...)`
bodies. That is `decorateMetadataItem` doing its job and `stripReadDecorations`
removing it on write — **not** a route divergence. It showed up in my key-by-key
diff and I checked it before discarding it.

---

*End of handover. Code for #8038 is on
`claude/issue-8038-search-companion-route-divergence` / PR #8255; this branch
carries text only and has no code changes.*
