# Spec liveness ledger

For a metadata-driven platform, **the spec is the product surface**: authors write
metadata against these schemas. A property that is parsed but has no runtime consumer
is a silent no-op — and for a *security* property, a silent no-op is **false
compliance** (e.g. `forceMfa: true` accepted and ignored). The metadata-liveness audits
(`docs/audits/2026-06-*-property-liveness.md`) found that large swaths of the declared
surface are DEAD.

This ledger makes that classification **explicit and regression-proof**: every property
of a governed metadata type must declare a liveness status with evidence, or CI fails
(the ratchet — you can't add new undeclared surface).

The gate checks **both directions**, and it took a while to notice the second one was
missing. Schema → ledger catches a property with no row (`UNCLASSIFIED`). Ledger →
schema catches a **row that outlived its property** (`ORPHAN`): when a key is removed
from a `.strict()` schema it leaves the walked shape, so the forward pass simply stops
asking about it and a stale `dead`/`live` claim rots in place — which is exactly what
the report `aria`/`performance` rows did for a full release, deleted by hand only
because someone happened to read the file. Note the asymmetry that makes this
error-prone: a `retiredKey()` tombstone **keeps** the key in the walked shape, so a
tombstoned key's row must **stay**, while a strict-removed key's row must **go**. The
route decides the disposition — see `scripts/liveness/orphans.mts` and
`.claude/skills/spec-property-retirement/SKILL.md` §2.

## Source of truth = the metadata-type registry

The gate reads `BUILTIN_METADATA_TYPE_SCHEMAS` (`packages/spec/src/kernel/metadata-type-schemas.ts`)
via `listMetadataTypeSchemaTypes()` / `getMetadataTypeSchema()` — **the same registry the
runtime `/api/v1/meta/types/:type` endpoint and the Studio metadata-admin forms use**,
i.e. exactly the set of *authorable* metadata types. It walks each type's Zod schema
directly (not `z.toJSONSchema`, which throws on `object`/`action`).

This matters: the older gate read the generated `json-schema/` directory, which omits
most top-level authorable types (object/field/flow/action/...) — so it was blind to the
core surface. The registry is complete.

**Spec-only exception (`SPEC_ONLY_SCHEMAS`).** A type can be authorable yet deliberately
*not* registered — `webhook` is the case: its schema is authored on a Stack/connector but
registering it as a metadata type would switch on Studio webhook CRUD, `saveMetaItem`
overlay acceptance, and diagnostics sweeping, which is wrong while the surface is still
disconnected from the `sys_webhook` dispatcher (#3461). Since being off the registry is
*itself* how such a drift hides, the gate resolves these through a small
`SPEC_ONLY_SCHEMAS` override in `check-liveness.mts` (consulted before
`getMetadataTypeSchema`) — it only needs to **walk** the schema, not register it. When a
disconnect like `webhook`'s is resolved (materializer built or surface retired), fold the
type back onto the registry and drop the override.

`query` is the second override, and a permanent one (#4286): `QuerySchema` is not
metadata at all but the **request surface** — the client SDK QueryBuilder's output and
the `POST /data/:object/query` body. It is authorable by every API caller yet never
stored as stack metadata, which is exactly why 12 declared-but-inert members survived
every other gate: this ledger governed what authors write into metadata files, and
nothing governed what callers write into a query. Unlike `webhook`, there is no
registry to fold it back onto — the override *is* its governance.

## Status vocabulary

| Status | Meaning |
|---|---|
| `live` | Has a runtime consumer. Cite it in `evidence` as `file:line`; for another repo's path, prefix the realm — `objectui: packages/app-shell/…` (see below). |
| `experimental` / `planned` | Declared, intentionally not enforced yet. Also read from a spec `.describe()` marker like `[EXPERIMENTAL — not enforced]`. |
| `dead` | Parsed, no consumer. Tracked for **enforce-or-remove** (ADR-0049). |

Resolution per property: **ledger entry → spec `.describe()` marker → UNCLASSIFIED**.
Framework provenance/lock fields (`_lock*`, `_provenance`, `_packageId/Version`,
`protection` — ADR-0010) are auto-classified `live`.

### Writing `evidence` so the gate can check it

The gate extracts every **repo-rooted** path from an `evidence` string (one
starting with `packages/`, `apps/`, `content/`, …) and resolves it against this
checkout. Prose around the paths is fine and encouraged — `packages/spec/src/stack.zod.ts
(mergeActionsIntoObjects stable-sorts each group)` resolves the path and ignores
the parenthetical.

**A repo-local path that does not resolve FAILS CI** (`✗`, exit 1 — since #5623;
it was a non-failing `⚠` before, calibrated for the parser bug described in the
note below rather than for the parser we have). A `live` verdict *is* its
evidence pointer, so a pointer into thin air is a claim nothing can falsify — and
a directory move or a rename is the whole cost of getting there. Repair it, or,
if the consumer is genuinely gone, re-classify the property under ADR-0049
enforce-or-remove instead of repointing at a plausible survivor.

**A path in another repo must say so**, or the gate will report it as rot —
attributed paths are counted and never resolved, so they cannot fail this check
(that boundary is deliberate: ~101 entries cite the renderer repo or the closed
cloud runtime, whose files are legitimately absent here):

```jsonc
"evidence": "objectui: packages/app-shell/src/views/RecordDetailView.tsx:573"
"evidence": "registered into ActionEngine (objectui packages/core/…/ActionEngine.ts:150) but no caller"
```

A realm marker (`objectui`, `cloud`, `ee`) attributes the paths that follow it,
up to the next clause boundary (`;` or `)`), so a string can cite both repos —
`framework` switches back explicitly. `packages/services/service-ai/…` is always
treated as foreign: that is the closed cloud runtime, and `packages/services/`
here ships every sibling service except it. A path that is not repo-rooted
(`app-shell/MetadataProvider.tsx`, `action-button/-group`) reads as prose and is
neither resolved nor reported.

> This replaces the old advice to write objectui paths "as prose to avoid false
> stale-flags." That was a workaround for a parser bug — the check took
> `evidence.split(':')[0]` as the filename, so any prose made it fail. It flagged
> **48 of 227 entries and every one was a false positive**, which buried the one
> real rotted pointer in the list (`object.enable.clone`, whose consumer had
> moved from `@objectstack/objectql` to `@objectstack/metadata-protocol`). A
> permanently-noisy check is a check nobody reads — the same way a stale ledger
> entry is a claim nobody re-tests.

### `verifiedAt` — the re-verification clock

An entry may carry `"verifiedAt": "YYYY-MM-DD"`: the date a human last closed the
call graph for that property. It exists because **twice** an entry has been
falsified by code moving under it — `flow.status` (#3711) and `action.undoable`
(#3714), both *understated*, both found only because a sweep aimed at the
opposite failure happened to walk past them. Nothing in the gate previously
asked how old a claim was, so a stale entry stayed invisible until someone
tripped over it.

```jsonc
"undoable": {
  "status": "live",
  "verifiedAt": "2026-07-28",
  "evidence": "objectui @732b1bf — CALL GRAPH CLOSED BY HAND: …"
}
```

Two rules, and the asymmetry between them is the point:

- **Age never fails CI.** Re-verification is a worklist, not a merge gate. Every
  run prints one summary line; `pnpm check:liveness --stale-verification[=days]`
  prints the worklist (stale oldest-first, then the undated ones). Default
  threshold 180 days.
- **A malformed or future-dated `verifiedAt` DOES fail CI.** A date the parser
  can't read would silently exempt that entry from every staleness window —
  which is the same silent-no-op shape this whole ledger exists to catch. Fail
  loudly instead.

Most entries predate the field and are simply undated; date them as you
re-verify rather than back-filling guesses. **For objectui-side evidence, pin
the commit** (`objectui @732b1bf`) — `action.undoable`'s reader line numbers had
already drifted by 28 lines one day after the issue citing them was filed.

### `producer` — a consumer is only HALF the call graph (#4837)

`live` means **authoring the property changes runtime behaviour**. A cited
consumer proves something *reads* the key. It does not prove the read has an
effect, because a read can depend on a second input that nobody supplies.

`seed.json` marked `Seed.env` **live**, evidence `seed-loader.ts` line 91, note
*"filterByEnv drops datasets whose env list excludes the running
environment."* Every word of that was checkable against the file, and the
verdict was still false:

> Line 91 really did call `filterByEnv(request.seeds, config.env)`. But none of
> the **six** call sites that build a `SeedLoaderRequest` — app boot, per-org
> replay, hot reload, package apply, draft publish, marketplace install — ever
> passed `env`. So `config.env` was permanently `undefined`, `filterByEnv`
> returned its input on its first line, and `dataset.env` was **never read at
> all**. The evidence pointed at the consumer; the property was dead at the
> **producer**.

The unit test made it worse rather than better: `seed-loader.test.ts` has always
had a passing `should handle environment filtering` case — because the test
supplies `config.env` itself. The mechanism was correct throughout; only the
wiring was missing, and the ledger and the test both looked exclusively at the
mechanism. This is the shape Prime Directive #10 already names in another
context: **a `case` label is not enforcement; check the call site** (#3106).

Hence the criterion:

> When a property's runtime effect depends on a **second input that some
> producer must supply**, a `live` verdict requires evidence on the producer
> side too. Cite it in `producer`.

```jsonc
"env": {
  "status": "live",
  "evidence": "packages/metadata-protocol/src/seed-loader.ts:191 (filterByEnv drops …)",
  "producer": "packages/metadata-protocol/src/seed-loader.ts:174 — load() resolves the comparison environment itself (resolveEnvConfig), rather than trusting a caller to pass it"
}
```

`producer` resolves through **the same resolver as `evidence`** — repo-rooted
paths must exist or CI fails; cross-repo paths are attributed and counted. A
call-site claim nothing can falsify is precisely what this field exists to
remove, so it does not get a weaker standard than the pointer it completes.

Which entries need one. The risk is highest for **optional config with a
default**: those always "have a value" in the type system and can still be
`undefined` at runtime.

| Shape | Needs `producer`? |
|---|---|
| The consumer reads the authored value directly (`hook.priority` orders hooks) | no — the author IS the producer |
| The consumer compares the authored value against something a caller supplies (`seed.env`) | **yes** — cite who supplies it |
| The consumer reads it out of an options/config object built elsewhere (`job.timeout`) | **yes** — cite the threading site |
| The property is `dead` | no — there is nothing to produce |

Absence never fails CI (most of the ledger predates the field, and back-filling
guesses is the sin this records). `pnpm check:liveness --producer-gap` prints
every `live` entry citing a consumer only — an upper bound on the debt, to be
triaged with the table above rather than read as a defect list. A **malformed**
value does fail.

### `evidenceScope` — how wide the last look actually was (#4895)

Four measured verdicts were reached by searching **this repo only**, and
published as though they covered every consumer:

| # | Verdict | What the search missed |
|---|---|---|
| 1 | `app.homePageId` tombstoned "no shell ever read it" | objectui's `AppContent.resolveLandingRoute()` had been reading it all along (corrected in #4709) |
| 2 | `flow.nodes.children.position` marked live, "designer canvas layout" | the designer wrote its own `ui:{x,y}` and **nothing** read `position` — a false *live*, the opposite direction |
| 3 | `HttpMethod` reported unused | the scan matched only `import … from` |
| 4 | `Notification` / `NotificationConfig` removed on "zero importers" | objectui re-exported them with `export … from`, and the real consumers imported from `@object-ui/types` — **two hops**, so even a scan covering `export … from` misses it while it matches on the spec specifier |

Case 4 is the one that decides the method: **no amount of text or specifier
matching is sufficient**. A negative cross-repo claim has to follow the resolved
symbol graph through re-export chains, or it is a guess with a citation. Every
barrel package adds a blind spot, and the renderer repo is all barrels.

`evidenceScope` records what was actually done, as data:

| Value | Means |
|---|---|
| `in-repo` | the call graph was closed inside this repo only |
| `cross-repo` | a named foreign realm was walked too — say **which**, in the evidence, and **pin the commit** (`objectui @c2fd1223`): `action.undoable`'s reader line numbers drifted 28 lines in one day (#3714) |

Absent = scope undeclared, a worklist row rather than a failure; the field is
younger than nearly every entry. A value outside the vocabulary FAILS, the same
asymmetry as `verifiedAt` — a value the parser cannot read would silently exempt
that entry from every future sweep.

⚠️ Neither `cross-repo` value in the tree today covers **`cloud`**: the closed
runtime is not reachable from an open-source checkout, so a `cross-repo` claim
means "the realms named in the evidence", never "everywhere".

### ⚠️ An authoring/preview renderer is NOT a runtime consumer

`live` means **authoring the property changes runtime behaviour**. A Studio
`*.form.ts` input or a `metadata-admin/previews/*Preview.tsx` panel merely
*echoes back what the author typed* — it proves the property round-trips, never
that anything acts on it. A 2026-06 sweep that "missed objectui" over-corrected
and marked **13 properties `live` citing only a preview renderer**; of those,
three were re-verified in 2026-07 and **all three were wrong or misleading**:

- `skill.permissions` — no gate anywhere (corrected → `dead` + `authorWarn`)
- `agent.knowledge` — retrieval scope comes from the LLM's tool args (corrected → `dead`)
- `action.disabled` — enforced on **one of six** rendering surfaces at the time;
  the verdict was right for the wrong reason and hid a five-surface silent
  no-op (evidence corrected; the gap itself fixed in objectui#2863)

**All thirteen have now been re-verified (2026-07, #3686). Final tally: 3 stand
as `live`, 10 were wrong** — a 77% error rate for the preview-renderer standard:

| Verdict | Properties |
|---|---|
| `live`, evidence corrected to the real reader | `action.execute` (the spec transform's parse-time lowering — the second reader, objectui's ActionRunner, resolved the `target`/`execute` pair in the *opposite* direction; aligned and the alias dropped from the parsed output in #3713), `action.disabled` (six render surfaces), `flow.status` (engine gates binding + execution since `497bda853`) |
| corrected to `dead` + `authorWarn` | `action.shortcut`, `action.bulkEnabled`, `flow.active`, `skill.triggerPhrases`, `tool.category`, `tool.requiresConfirmation`, `tool.active`, `tool.builtIn`, `skill.permissions`*, `agent.knowledge` |

\* `skill.permissions` was subsequently pruned outright — it was never enforced.

Note the two failure directions the sweep exposed. Most entries **overstated**
liveness. But `flow.status` was *understated*: the file-level note still said
"status/active gate nothing", true when written and falsified a month later by
`497bda853`. `action.undoable` was the same shape (#3714): marked `experimental`
on a #1992-era "no runtime reader yet" note that objectui falsified with two
readers. **A ledger entry is a claim with a timestamp; code moves under it
in both directions.** An entry is worth re-verifying, not trusting indefinitely
— see the methodology below.

When in doubt, the honest status is `dead` + `authorWarn`: an author who gets a
warning for a property that turns out to work loses nothing *at runtime*; an
author who gets silence for a property that does nothing ships a bug. But the
ledger is also read as a capability catalogue — by authors and by AI — so an
understated entry does have a cost: `undoable` sat behind a "declared but NOT
enforced" warning for a month while it worked, which is an invitation to skip a
shipped feature. Erring toward `dead` is the right default *and* a debt to
re-verify.

### How to verify a claim without fooling yourself

Three false conclusions were published during this sweep, all from the same
mistake: **a strong negative claim ("nothing reads X") resting on a search whose
result set was silently truncated or filtered.** Concretely:

1. `… | head -3` hid the real hit further down the list.
2. A pathspec glob `packages/*/src` never matched the nested
   `packages/app-shell/src/layout/…`.
3. **On macOS, `git grep -E` silently does not honour `\b`** — `git grep -cE
   "\.active\b" flow.zod.ts` returns *nothing* on a file that provably contains
   three `.active` occurrences (`git grep -cw active` finds them). Any absence
   conclusion drawn from a `\b` pattern on this platform is a false negative.

So: a grep can only prove **presence**. To prove absence, either close the call
graph by hand (declaration → registration → accessor → *caller*, which is how
`action.shortcut` and `tool.active` were settled) or — cheapest and most
decisive for this ledger — **author the property, boot the app and look**. That
is how the `app.badge`/`separator` question was finally settled after two wrong
grep-based rounds.

## Runtime proofs — prove-it-runs (ADR-0054)

`live` today means only *a static pointer to a consumer* — proof that something
*reads* the property. That is necessary but not sufficient: a property can be live
at every layer yet **broken end-to-end** (the break lives in the integration —
engine ↔ driver ↔ service ↔ HTTP). [ADR-0054](../../../docs/adr/0054-runtime-proof-for-authorable-surface.md)
adds the third leg: for a defined class of **high-risk** authorable properties, a
`live` entry must carry a **`proof`** — a reference to a `@objectstack/dogfood` test
that authors the property against the real in-process stack and asserts the runtime
outcome.

```jsonc
"type": {
  "status": "live",
  "evidence": "packages/objectql/src/engine.ts",
  "proof": "packages/qa/dogfood/test/field-zoo-roundtrip.dogfood.test.ts#field-type-roundtrip"
}
```

**The contract.** A `proof` is `"<repo-relative-file>#<proof-id>"`. The dogfood test
self-declares the id with a greppable tag near its top:

```ts
// @proof: field-type-roundtrip
```

The gate validates **statically** (it never runs the test — that's the dogfood
gate's job, keeping this gate seconds-cheap): the file must exist **and** declare the
`@proof: <id>` tag. A bound entry must point at *its own class's* proof. The reverse
is also checked: a `@proof:` tag under `packages/qa/dogfood/test/**` that isn't
registered in `../scripts/liveness/proof-registry.mts` is flagged (warning) so a new
proof gets wired in.

**The ratchet (the authoritative high-risk-class list).** Defined in
`../scripts/liveness/proof-registry.mts`. A class is **CI-enforced** (`bound`) only
once it has *both* a runtime proof *and* a governed ledger entry to carry it — the
binding lands one class at a time (ADR-0054 §3), never as a big-bang backfill.

`proof-registry.mts` is the source of truth; the tables below mirror it.

**Bound — a `live` classification on these entries REQUIRES its proof:**

| High-risk class | Ledger binding | Proof (`packages/qa/dogfood/test/…`) |
|---|---|---|
| Field types | `field.type` | `field-zoo-roundtrip#field-type-roundtrip` |
| RLS / sharing (pre-image) | `permission.rowLevelSecurity.using` | `rls-fixture#rls-by-id-write` |
| RLS `check` (post-image) | `permission.rowLevelSecurity.check` | `showcase-d3-d4-capabilities` |
| Master-detail controlled-by-parent | `object.sharingModel` | `controlled-by-parent#cbp-controlled-by-parent` |
| Scope-depth read grants | `permission.objects.readScope` | `showcase-scope-depth` |
| Scope-depth write grants | `permission.objects.writeScope` | `showcase-scope-depth-write#showcase-scope-depth-write` |
| Ownership anchor + bulk writes | `permission.objects.modifyAllRecords` | `owner-anchor-and-bulk-writes` |
| Delegation of duty | `position.delegatable` | `delegation-of-duty#delegation-of-duty` |
| Static readonly write | `field.readonly` | `showcase-static-readonly#readonly-static-write` |
| Attachments capability gate | `object.enable.files` | `attachments-permission-matrix` |
| Analytics dims/measures | `dataset.dimensions.dateGranularity` | `analytics-timezone#analytics-tz-bucketing` |
| Flow nodes | `flow.nodes.type` | `flow-node#flow-node-execution` |
| Flow runAs identity | `flow.runAs` | `flow-runas#flow-runas-identity` |
| Data lifecycle (ADR-0057) | `object.lifecycle` | `storage-growth#adr0057-lifecycle-bounded-growth` |
| Webhook materialization | `webhook.object` | `webhook-materialization#webhook-materialization` |
| Object semantic roles (ADR-0085) | `object.highlightFields`, `.stageField`, `.fieldGroups` | `semantic-roles#semantic-roles-served` |
| Tab visibility | `permission.tabPermissions` | `me-apps-and-everyone-baseline#me-apps-and-everyone-baseline` |

**Registered but unbound.** A proof with no authorable property to ratchet is
still registered — otherwise its `@proof:` tag reads as an orphan — and records
*why* rather than faking a binding:

| Proof | Why unbound |
|---|---|
| `form-widget-resolution` | no proof written yet (ADR-0054 Phase 2); `view.form.*` is governed and can carry it |
| `permission-set-projection` | a storage invariant (ADR-0094), not an authorable property |
| `flow-runas-schedule` | guards `flow.runAs`, already bound to `flow-runas-identity` — one entry carries one `proof` |
| `showcase-scope-depth-fallback` | guards `permission.objects.readScope`, already bound — this is the CLI-wiring sibling |
| `showcase-agent-intersection` | a runtime principal-resolution invariant (`onBehalfOf`), not authorable |
| `showcase-agent-scope-ceiling` | the OAuth-scope → ceiling-set mapping lives in the runtime resolver |
| `showcase-bu-hierarchy-sharing` | stack-level `sharingRules`, not a governed per-type property |
| `showcase-declarative-rbac-seeding` | stack-level `roles`/`sharingRules` seeding, same shape |
| `showcase-permission-zoo` | a breadth guard over the whole ADR-0090 surface, not a single-property gate |

Two habits this table is meant to enforce. **Register every proof**, so the
orphan warning stays empty and means something. **Bind only what the proof
actually authors** — `owner-anchor-and-bulk-writes` binds `modifyAllRecords`,
which it exercises in both directions, and *not* the sibling `allowTransfer`,
which it only mentions in a comment. Binding a property a proof does not
exercise is the same false comfort as a preview renderer standing in for a
runtime consumer.

To bind a pending class: add its dogfood proof + `@proof:` tag, set `bound: true` and
its `ledgerBindings` in `proof-registry.mts`, add the `proof` to the ledger entry, and
confirm the gate is green. Because the gate also triggers on `packages/qa/dogfood/**`,
deleting or renaming a proof re-runs this check and the dangling reference is caught.

## Author warnings — closing the loop (`authorWarn`)

Classification is also fed back to the *author* at build time. The CLI `compile`
lint (`packages/cli/src/utils/lint-liveness-properties.ts`) reads these ledgers and
emits an advisory **warning** when an authored object/field sets a property that is
misleading — "you set this expecting it to do something; at runtime it does nothing /
isn't enforced" — with a corrective hint. Never fails the build.

Signal over noise is the whole point, so warnings are **opt-in per entry**:

| Field | Effect |
|---|---|
| `"authorWarn": true` | warn when this property is authored (in addition, any `experimental` entry warns by default — it's a declared-but-unenforced guarantee). |
| `"authorHint": "…"` | the corrective one-liner shown under the warning (falls back to `note`). |

Two rules keep it false-positive-free, **both of which the marker author must respect**:

1. **Only mark genuinely *misleading* dead props** — ones that imply a capability/behavior
   that doesn't exist (`versioning`, `field.columnName`, `softDelete`). Benign display/doc
   metadata that's "dead" (no runtime reader) — `description`, `tags`, `icon` — must NOT be
   marked; an author isn't misled by them.
2. **Booleans: only mark `default(false)` flags.** The lint warns on a boolean only when set
   `true`, and it can't tell author-set-`true` from a schema default. A `default(true)` flag
   (`enable.searchable`) would then warn on *every* object that has an
   `enable` block — so leave those unmarked (see `enable.searchable`'s `_authorWarnSkipped`).
   Object/string/array props warn when merely present, so this caveat is boolean-only.

The lint is ledger-driven: coverage grows by marking more entries `authorWarn`, not by
touching the lint code. It covers **every governed type**: objects (incl. `enable.*`)
and their fields walk bespoke nesting; flows/actions/agents/tools/skills/datasets/
permissions/hooks/pages are checked as flat stack collections, and container
properties fan out over arrays (each flow node, each dataset measure).

## Granularity — drill one level

A property is classified at the top level by default. A **container** property (object /
record / array-of-object) may be drilled one level via `"children"` to keep sub-properties
distinguishable — e.g. `permission.objects.allowCreate` (live) vs `allowTransfer` (experimental),
or `flow.errorHandling.fallbackNodeId` (dead) vs the rest (live). Drill where the
audit gives divergent sub-statuses; otherwise the top-level entry covers the whole subtree —
but that inheritance must now be **declared**, not assumed (below).

```jsonc
// packages/spec/liveness/permission.json
{ "type": "permission", "props": {
  "name":  { "status": "live", "evidence": "packages/plugins/plugin-security/src/permission-evaluator.ts" },
  "objects": { "children": {
    "allowCreate": { "status": "live", "evidence": "permission-evaluator.ts:8" }
    // allowTransfer/Restore/Purge omitted → resolved 'experimental' via spec marker
  } }
} }
```

### Undrilled containers must be DECLARED (#4956)

"The top-level entry covers the whole subtree" is a real granularity, and forcing every
container to drill would mean inventing hundreds of per-key verdicts with no evidence —
worse than an honest coarse one. What is *not* acceptable is inheriting that coverage
**silently**, because silence is indistinguishable from having looked:

> `dashboard.widgets` carried `{"status": "live"}` and a `note` saying the per-widget
> props were *"classified in the DashboardWidgetSchema subtree"*. **No such subtree has
> ever existed** — `DashboardWidget` appeared in exactly two files, this README and that
> claim. The walk drills one level and only through an explicit `children`, so all 22 keys
> of the strict `DashboardWidgetSchema` were never asked about, the `unclassified` count
> never mentioned them, and the run printed *"all governed-type properties are
> classified"*. That is how `widgets[].responsive` survived the #3896 sweep that removed
> its own sibling `widgets[].performance` **and its literal namesake `view.responsive`** —
> `view` is drilled through `children`, so `list.responsive` got a verdict and went out.
> The ledger could not say why it kept the key, because it had never had an opinion.
> Retired four days late in #4876 / PR #4995, by hand.

So the gate now asks a **third** question, alongside schema → ledger and ledger → schema:
*is every blanket container verdict a declared one?* Exactly three dispositions are legal,
all of them data:

| Disposition | Meaning |
|---|---|
| **drilled** — `children` on the entry | per-key verdicts, as before |
| **deferred** — a `{ container, to }` row in `../scripts/liveness/undrilled-containers.baseline.json` | the subtree is classified at another coordinate, and the gate **resolves** the reference |
| **recorded** — a coordinate in that file's `containers` list | genuinely classified nowhere; a counted, shrink-only debt |

A container in **none** of the three fails, printing the child keys its verdict silently
covers. A baseline row whose container **now drills** also fails — the same rot as an orphan
row, opposite direction (an overstated debt misleads as much as an unrecorded one). Every
run prints both populations, the success line no longer claims a completeness it does not
have, and `check:liveness --undrilled` prints the worklist.

**Why `deferred` exists, and why it is resolved rather than believed.** "Classified
elsewhere" is the exact sentence that caused #4956 — but it is sometimes *true*:
`object.fields[]` really is `FieldSchema`, which the `field` ledger classifies in full, and
`object.listViews[]` is the same ListView surface `view.list` already drills. Six containers
(248 child keys, nearly half the population) are in that position, so recording them as
"classified nowhere" would have been this file's own false claim. What separates a legal
deferral from the #4956 defect is not the claim but **who checks it**: a deferral names its
target as data, and the gate requires that target to exist (a governed type root, or a
drilled `type/prop` coordinate) and to classify **exactly** this container's child keys.
A dangling target fails; so does a drifted one — equality, not subset, because a container
that grows a key its target never classifies is #4956 one level down. Pointing a deferral at
`DashboardWidgetSchema` today produces:

```
✗ 1 broken deferral(s) — a "classified elsewhere" claim that does not resolve:
    object/fields defers to 'DashboardWidgetSchema', which does not exist — no governed
    type and no drilled ledger coordinate of that name
```

At landing: **58 containers / 292 child keys classified nowhere**, plus 6 resolved
deferrals covering 248. Adding a row is a visible edit to a file named for the debt it
records — the point, since the thing it replaced (a reassuring sentence in a `note`) cost
nothing to write and could not be checked. Logic and rationale live in
`../scripts/liveness/drill.mts`; it is pure and unit-tested, because a tree that is fully
reconciled by construction would otherwise prove only that the check is quiet.

**Drilling a container is EVIDENCE work, not bookkeeping.** The 22 widget keys took a
call-graph pass across both repos and produced six dead verdicts and one one-path-only
`live` — and `requiresService`, which every objectui measurement calls dead, is enforced
server-side (`filterDashboardForUser`, ADR-0057 D10). Do not drill by fanning a parent's
status out over its children; that manufactures verdicts, which is worse than the gap.

## Empty-state semantics — the sibling gate (#3896)

This ledger asks **"does the property do anything?"** A second, smaller gate asks
the question it does not: **"what does its EMPTY value mean?"**

`sys_sharing_rule.criteria_json` was live by any standard — parsed, stored, read
by an evaluator. It was also optional, and its absence evaluated to
`find(object, { filter: {} })`: every record of the object, granted to the
recipient. The field description said so out loud — *"leave empty to share every
record"* — and that sentence sat in the spec being read as the contract, because
for an agent-authored platform **a field description is not documentation about
the contract, it is the contract**.

Three properties, same syntactic shape (an optional list or predicate that
"restricts" something), opposite meanings when empty:

| Property | Empty means |
|---|---|
| `object.apiMethods` | `undefined` = unrestricted, **`[]` = deny-all** |
| `sys_user_permission_set.organization_id` | NULL = the grant applies in **every** org — and is what derives `platform_admin` |
| `plugin-runtime.allowedSources` | was *"empty = all allowed"* — schema since removed (#3950) |
| sharing `condition` | nothing is shared (#3929) |

Nothing marked which was which. A maintainer knows by memory; a model authoring
metadata cannot, and guessing wrong is silent and permissive. So the gate scans
the authorable surface for statements declaring an empty state to be permissive,
and requires each to be classified in
`../scripts/liveness/empty-state-registry.mts`:

| `semantics` | Meaning |
|---|---|
| `scope` | Selects a range of work (which objects to replicate, which events to replay). Empty = all is correct, often the safe direction. Not an access decision. |
| `closed` | An access gate whose empty state DENIES — the required posture for new gates. Carries no permissive prose to scan, so it is exempt from the staleness check and exists as the catalogue answer. |
| `open` | An access gate default-OPEN on purpose. Legitimate — an object with no API whitelist is exposed, because exposure is the CRUD default — but mandatory rationale, since it is the shape that produced #3896. |
| `output` | Not authorable: a computed projection (an explain trace, a server-resolved effective set). Its empty-state prose describes a result, not a policy. |

`closed` and `open` must cite where the posture is enforced; the path resolves
like `evidence` above, so a pointer that rots is reported rather than trusted.

**The lesson `apiMethods` already encodes**, and the one worth copying: the empty
ARRAY is closed, only ABSENCE is open. Collapsing the two produces a *vacuous
allow-list* — where the one value an author reaches by mistake is also the widest
grant. Better still is the shape `storage.zod.ts` uses: an explicit
`mode: 'whitelist'` discriminator plus `.min(1)`, which makes an empty whitelist
unrepresentable.

```bash
pnpm --filter @objectstack/spec check:empty-state              # run the gate
tsx packages/spec/scripts/liveness/check-empty-state.mts --dump  # inventory (seeding aid)
```

Detection matches the **statement**, not field names. Names would be a guess, and
this README is blunt about where a guessy check ends up: a permanently-noisy
check is a check nobody reads. A statement that resolves to no property is
narrative — a file header explaining a past bug — and is reported as a
non-failing note.

### What it scans, and why it is not just `packages/spec`

Two surfaces:

- `packages/spec/src/**/*.zod.ts` — the schema surface.
- `**/*.object.ts` anywhere under `packages/` — platform-object definitions, in
  plugins, `platform-objects`, `metadata-core`, and the `create-objectstack`
  templates (a starter file is the highest-leverage thing a model copies from).

**The second one is the point.** The sentence that shipped #3896 — *"leave empty
to share every record"* — was the `description` of
`sys_sharing_rule.criteria_json`, which lives in `plugin-sharing`. A gate scoped
to `packages/spec` could not see the crime scene. Extending the scan immediately
surfaced one unclassified access-control default-open that no sweep of the schema
surface would ever have reached (`sys_user_permission_set.organization_id`).

Two things the two surfaces do NOT share, both learned by getting them wrong:

- **The property-search window.** A `.zod.ts` statement sits on or beside its
  property; a platform-object field is a nested call whose `description:` can be
  15+ lines below the name. The window is therefore per-surface — widening it
  globally would let `.zod.ts` narrative be mis-attributed to a distant property,
  turning a correct note into a wrong failure.
- **How the owning property is found.** Not by a list of key names. Skipping
  `description:` is not enough — the next key up from it is `required:`, equally
  not the field. What separates a field from its own config is *nesting*, so the
  resolver takes the nearest key at a **shallower indent**.

Finally, a match whose permissive claim is **negated or explicitly disowned** is
dropped, in both directions: `[]` = `deny-all` is the opposite of the hazard, and
so is #3929's own comment saying *Deliberately NOT "leave empty to share
everything"*. The escape is narrow on purpose — the negator has to be attached to
the phrase, not merely nearby, because a false negative here is a missed
over-share.

## Files & usage

- `<type>.json` — the ledger for a governed metadata type.
- `../scripts/liveness/check-liveness.mts` — the gate (tsx; imports the registry).
- `../scripts/liveness/orphans.mts` — the reverse (ledger → schema) scan: rows whose
  property is gone. Pure + unit-tested, because the tree was orphan-free when it
  landed, so a green gate proves nothing about whether the scan can fire.
- `../scripts/liveness/drill.mts` + `undrilled-containers.baseline.json` — the third
  direction (#4956): a container entry may not inherit coverage for its subtree
  silently. Same "pure + unit-tested" reasoning as `orphans.mts`, for the same reason.
- `../scripts/liveness/check-empty-state.mts` — the empty-state gate (above);
  `empty-state-registry.mts` is its source of truth.
- `../scripts/liveness/producer.mts` — the `producer` / `evidenceScope` fold
  (#4837 / #4895). Pure + unit-tested for the same reason as `orphans.mts`: on
  the shipped ledgers these checks are almost entirely quiet, so a green gate
  proves nothing about whether they can fire.

```bash
pnpm --filter @objectstack/spec check:liveness               # run the gate
tsx packages/spec/scripts/liveness/check-liveness.mts --dump field   # inventory a type (seeding aid)
tsx packages/spec/scripts/liveness/check-liveness.mts --producer-gap # live entries citing a consumer only
```

CI: `.github/workflows/spec-liveness-check.yml` runs on PRs touching `packages/spec/**`.

## Adding a type

The governed set is `GOVERNED` at the top of `check-liveness.mts`. To add a type:

1. `--dump <type>` to inventory its properties (containers auto-expand so you can see
   drill-down candidates).
2. Seed `<type>.json` from that type's liveness audit (file:line evidence) + targeted
   greps. **Classify only with evidence** — `live` needs a cited consumer; `dead` needs a
   confirmed absence.
3. **Confirmed absence means BOTH repos.** The renderer layer is a legitimate consumer
   (`live` with objectui evidence as prose), so grep `../objectui` before writing `dead`.
   Precedent: `enable.trackHistory` was misclassified dead for a month while
   RecordDetailView had been gating the History tab on it the whole time (#2707).
4. Add the type to `GOVERNED`; confirm the gate is green.

## Current state — 30 governed types (complete registry coverage)

> The table below carries 28 of the 30. `api` and `capability` are governed
> (they are in `GOVERNED`, they have ledgers, the gate counts them) and were
> added without a row here — the table fell behind its own registry, which is
> the shape this file keeps warning about one level down. Filed rather than
> back-filled from a guess: writing two Notes cells for changes somebody else
> measured is exactly the fabrication the drill section forbids.

**The counting method for this table is the gate's own report** —
`check-liveness.mts --json`, `types.<type>.byStatus` — decided in #4488 after
two methods spent a release disagreeing. The alternative (a python snippet that
counted ledger JSON rows) systematically undercounted: it missed statuses
resolved from `describe()` markers, the ADR-0010 framework overlay fields the
gate auto-classifies `live`, and `childrenDefault` fan-outs — and a mechanical
rewrite with it produced two regressions while #4487 was being written. The
gate's numbers are what CI actually enforces, so they are what the table
mirrors. Two corollaries: counts are at the gate's **one-level walk
granularity** (a Notes cell may annotate finer detail, e.g. `query`'s
marker-experimental search sub-keys, without the counts reflecting it), and the
count columns are **never hand-edited** — regenerate:

```bash
cd packages/spec && npx tsx scripts/liveness/check-liveness.mts --json | python3 -c "
import json,sys
r = json.load(sys.stdin)
for t, v in r['types'].items():
    b = v['byStatus']
    print(f\"| {t} | {b.get('live',0)} | {b.get('experimental',0)} | {b.get('dead',0)} | {b.get('planned',0)} |\")"
```

| Type | live | exp | dead | planned | Notes |
|---|---|---|---|---|---|
| object | 49 | – | 0 | 1 | aspirational tier (versioning/softDelete/search/recordName/keyPrefix) + tags/active/abstract REMOVED (#2377) — tombstoned in UNKNOWN_KEY_GUIDANCE; `enable.trash`/`mru` REMOVED (#2377 close-out) — tombstoned in the now-`.strict()` ObjectCapabilities; `isSystem` + `enable.searchable` CORRECTED to live (#2377 — sharing default-model + global-search opt-out; 2026-06 audit missed both readers); `tenancy.strategy`/`crossTenantAccess` REMOVED post-15.0 (#2763) |
| field | 59 | – | 0 | – | healthy — full dead set (vectorConfig/fileAttachmentConfig/dependencies, then referenceFilters/columnName/index) REMOVED (#2377); columnName also dropped the ADR-0062 D7 lint + StorageNameMapping column helpers |
| flow | 34 | – | 5 | – | dead count = 4 tombstone entries + the kept docs field: `active`/`template`/nodes.`outputSchema`/errorHandling.`fallbackNodeId` REMOVED 2026-07-30 (#3896 close-out sweep — `active: false` never stopped a flow, `status` is the enforced lifecycle; faults route via per-node fault edges); remaining dead = `description`, KEPT deliberately: docs-shaped, exempt from enforce-or-remove |
| action | 34 | 0 | 2 | – | `type:'form'` CORRECTED to live (objectui ActionRunner.executeForm, #2377); dead `timeout` REMOVED (#2377); `disabled` live since objectui#2863; `undoable` CORRECTED to live (#3714); `shortcut` + `bulkEnabled` REMOVED 2026-07-30 (#3896 close-out sweep — no keydown path dispatches shortcuts; the multi-select toolbar reads the view's bulkActions) |
| hook | 11 | – | 2 | – | model-healthy; label/description dead but KEPT deliberately (2026-07-30 sweep) — docs-shaped annotation fields, exempt from enforce-or-remove |
| permission | 38 | – | 4 | – | CRUD/FLS/RLS live; dead `contextVariables` REMOVED (ADR-0105 D11 — RLS resolves only the `current_user.*` built-ins plus runtime-staged `rlsMembership` sets). 2026-07-30 security-subset re-verification (all 33 entries `verifiedAt`-stamped): `rowLevelSecurity.enabled` was live-with-wrong-evidence and UNREAD — a disabled policy kept contributing its OR-branch grant; ENFORCED same day in rls-compiler (`getApplicablePolicies`), the `positions` ADR-0049 resolution repeated. `rowLevelSecurity.priority` CORRECTED to dead+authorWarn — semantically void under OR-combination (no conflict exists to order), a REMOVE candidate. `rls.label`/`description`/`tags` CORRECTED to dead (benign display, no consumer in either repo). `tabPermissions` was UNDERSTATED ("only hidden read" → the rank merge reads all four values; me-apps dogfood test exercises it). `allowExport` re-verified TRUE end-to-end (server-side 403 gate, not just the /me projection) |
| position | 12 | – | – | – | (role's ADR-0090 successor) fully live; all 4 `verifiedAt`-stamped 2026-07-30 |
| agent | 21 | 4 | 1 | – | dead `tenantId` + `planning.strategy`/`allowReplan` REMOVED (#2377); autonomy tier experimental; `knowledge` REMOVED 2026-07-30 (#3896 close-out sweep — declaring sources never scoped retrieval; AIKnowledgeSchema removed with it, the topics→sources rename absorbed pre-release) |
| tool | 13 | 1 | 0 | – | the inert authoring surface is now REMOVED, not merely marked: `category`/`permissions`/`active`/`builtIn` retired 2026-07-30 (#3896 close-out) after `requiresConfirmation` set the precedent (#3715, ADR-0033 §2). `permissions` promised an invocation gate nothing enforced and `active:false` withdrew nothing — false compliance, same shape as rls.enabled. The `.strict()` ToolSchema rejects each retired key with its prescription; the `tool-inert-authoring-keys-removed` conversion strips them from authored sources |
| skill | 16 | – | 1 | – | `permissions` REMOVED 2026-07 (#3704); `triggerPhrases` REMOVED 2026-07-30 (#3896 close-out sweep — phrases were never matched; activation is `triggerConditions` + the agent's `skills[]` + /skill-name pinning) |
| dataset | 27 | – | 0 | – | `measures.certified` (declared-but-unenforced governance flag) REMOVED in 16.0 (#2377) |
| page | 16 | – | – | 1 | fully live + one planned |
| view | 79 | 0 | 4 | – | list/form drilled via `children` (#2998 Track B); list.{responsive,performance} + form.{defaultSort,aria} REMOVED 2026-07-30 (#3896 close-out sweep — list aria/data stay live); **form.data was that sweep's one CORRECTION** — the removal attempt broke the build (`defineForm` writes `data.provider='schema'` onto every metadata form, `metadata-protocol` serves it), so it stands `live` with re-verified evidence; form.{buttons,defaults} live (framework#1894 / #2998); audit-era DEAD lines superseded by re-verification; level-2 dead residue (userActions.buttons, addRecord.mode/formView, tabs[].order) noted on parents — one drill level only |

| report | 21 | 0 | 0 | – | dataset-bound (ADR-0021); the aria/performance LEDGER entries were stale — the keys left the schema in the report-liveness close-out; deleted 2026-07-30 as hygiene. Audit-era `chart` DEAD superseded (framework#1890 / #3441) |
| dashboard | 34 | 0 | 7 | – | ADR-0021 dataset widgets (#3251; DashboardWidgetSchema `.strict()`); `aria`/`performance` (and widget `performance` + PerformanceConfigSchema) REMOVED 2026-07-30 (#3896 close-out sweep — no renderer applied any of them); audit-era `globalFilters`/`dateRange` DEAD superseded (framework#2501) | **#4956**: `widgets` DRILLED — the row jumps 20 → 41 classified because all 22 widget-level keys enter the count at once. They had never been classified at all: the entry carried one blanket `live` plus a `note` asserting they were classified "in the DashboardWidgetSchema subtree", and no such subtree existed in any of the 28 ledger files. That gap, not any evidence, is what carried `widgets[].responsive` through the #3896 sweep that removed both its sibling `widgets[].performance` and its literal namesake `view.responsive` — `view` is drilled, so `list.responsive` got asked and went out. New dead 6 = `responsive` (retired #4876/#4995, tombstone keeps the row) + `colorVariant` + `actionUrl`/`actionType`/`actionIcon` + `aria`. The action trio is the sharpest: no renderer draws a per-widget action button at all (every `actionUrl` read in DashboardRenderer is scoped to `header.actions[]`), yet `validate-dashboard-action-refs.ts` enforces reference integrity on it and its docblock calls it "the per-widget button" — a lint guarding an affordance that does not exist. `requiresService` is the counter-example worth remembering: dead by every objectui measurement, and LIVE server-side (`filterDashboardForUser`, ADR-0057 D10) — judging a widget key from the renderer repo alone would have retired an enforced gate. `compareTo` is `live` on ONE path only (inline object-provider charts); on the ADR-0021 dataset path the string arms are dropped and `{ offset }` throws in the executor. **#6774** moves the row 33/8 → 34/7: `colorVariant` CORRECTED dead → live 2026-08-09, the enforce leg of #5010 ruling B landing from the renderer side (objectui#3359 / PR objectui#3799, absorbed by pin `09987b68`). Worth reading beside `requiresService` above, because it is the same lesson from the other end — that row warns against judging a widget key from the renderer repo alone, and this one is a `dead` verdict that was correct in this repo AND correct in the renderer repo on the day it was measured, and stopped being either when a cross-repo decision was implemented. A ledger row is a claim with a timestamp; `verifiedAt` is what makes the claim re-askable. It also empties the dashboard warn set, so the author-side lint now says nothing about any widget key — `dashboard` stays in the lint's TYPE_COLLECTIONS all the same (the `webhook`/`email_template` resolved state) |
| query | 15 | 1 | 5 | 0 | **not a metadata type** — the REQUEST surface (`QuerySchema`: client SDK QueryBuilder output; the `POST /data/:object/query` body), governed via `SPEC_ONLY_SCHEMAS` (#4286). The gate's one-level walk resolves 1 experimental; the 7 marker-experimental search affordances sit one level deeper, below the walk — resolved from `[EXPERIMENTAL — not enforced]` describe markers, not ledger entries (search `fuzzy`/`operator`/`boost`/`minScore`/`language`/`highlight` + `aggregations[].filter` — declared engine affordances no executor receives). The #4286 sweep closed out same-release: `having` ENFORCED 2026-07-31 (engine-side post-aggregation filter, both paths; was finding 1); dead 4 = the tombstoned removals `joins`/`windowFunctions`/`cursor`/`distinct` — REMOVED 2026-07-31 (retiredKey keeps each in the walked shape so the rows stay; protocol-17 semantic migrations; the JoinNode + WindowFunctionNode clusters and the `QueryBuilder.cursor()`/`.distinct()` producers deleted with their keys; `distinct`'s mis-wired REST count suppression deleted too — finding 2). **#6815** adds the 5th dead: `aggregations[].distinct` REMOVED 2026-08-09 (live → dead, `-1` live). It is the one member of this ledger the #4286 sweep could not have caught with the question it asked — that sweep looked for keys NO executor reads, and this one had a reader: the objectql in-memory fallback deduplicated before applying the function while all five other faces (driver-sql, driver-turso, driver-mongodb, driver-memory, service-analytics' `AGGREGATE_SQL`) ignored it, so one query answered two plausible NUMBERS depending on which backend served it. The lesson for the next audit is the question, not the key: a per-key `live` verdict is only as good as the count of faces it was measured across, and this row's 2026-07-31 evidence (`in-memory-aggregation.ts:167,204-206`) was TRUE and still the wrong verdict. `count_distinct` is the surviving spelling (enforce leg, #6409) |
| datasource | 30 | 0 | 0 | 0 | seeded 2026-08-01 (#4487) — the **highest dead ratio of any governed type** (20 of 43), and it was ungoverned until now, which is not a coincidence: #4410/#4465/#4481 found six inert keys here by hand, two security-shaped (`schemaMode` left an external DB constructible as `managed` with DDL ungated; `ssl` configured nothing while looking configured). Dead set = `capabilities.*` (all 11 — the engine gates pushdown on the runtime driver's `supports.*` object, a non-overlapping vocabulary), `healthCheck.*` (3 — nothing schedules a datasource probe; the 20 `healthCheck` hits in the repo all belong to the PLUGIN health monitor and other surfaces), `retryPolicy.*` (4 — `retryPolicy` IS enforced on `hook` and `job`, which is what makes this one read alive; the shapes differ), `external.label`, `external.requirePermission`. **`capabilities.readOnly` is the one to know**: it reads as a safety switch, gates nothing, and two shipped prescriptions pointed authors at it until #4487 — `external.allowWrites: false` is the enforced write gate. `config` is a `z.record`, so its per-driver keys sit outside the walk (recorded in the entry's note, not silently skipped) **批 A CLOSED 2026-08-02 (#4583)**: the `capabilities` block — 11 flags, every one dead and authorWarn'd — was REMOVED rather than bridged; pushdown comes from the runtime driver's own `supports.*`, so there was nothing to connect it to. Its rows are deleted (strict-removal route), which is why dead falls 20 → 9. `readOnly` was the reason the audit was worth doing: it read as a safety switch, gated nothing, and had already been MOVED twice toward somewhere it might be enforced (#4410, #4465) — the shipped CRM example called a datasource a read replica on the strength of it while the datasource took writes. Removing it does NOT hand the author a working alternative: `external.allowWrites` only gates FEDERATED datasources, so a managed one has no read-only gate at all (#4584). Remaining 9 = healthCheck ×3 + retryPolicy ×4 + external ×2, batches B/C/D of #4583 **BATCHES B/C/D CLOSED 2026-08-02 — datasource now has ZERO dead properties**, down from the 20 it was seeded with (the highest dead ratio of any governed type). `retryPolicy` ×4 and `healthCheck` ×3 went as whole blocks, `external.label` / `external.requirePermission` as keys. None was bridgeable: each already had a different LIVE mechanism doing the job — the boot policy, the driver handle's on-demand `ping()`/`checkHealth()`, the top-level `label`, and ordinary permission sets + RLS. The `retryPolicy` rejection deliberately refuses to offer a rename: `hook`/`job` retryPolicy ARE enforced but spell the delay `backoffMs`, and that inconsistency is itself the evidence nothing read the datasource one (#4488's sharpest trap) |
| webhook | 11 | 0 | 0 | – | **not a registered metadata type** — governed via the gate's spec-only schema override (`SPEC_ONLY_SCHEMAS`), not `getMetadataTypeSchema`; folding it onto the registry is the #3490 reassessment. This row once read 0/1/16 ("the ENTIRE authoring surface is dead", #3461) and both halves of that were CLOSED same-quarter: #3489 built the materializer bridge (authored `webhooks:` entries now land as `sys_webhook` dispatcher rows) and #3494 pruned the aspirational props outright — so the surviving surface is fully live. Kept in the table as the worked example that a dead verdict is a worklist entry, not a tombstone: enforce-or-remove resolved this one by ENFORCING |
| app | 45 | – | 9 | – | seeded 2026-08-01 (#4488). Dead 9 = the seven #4142 `retiredKey` tombstones (version/aria/objects/apis/sharing/embed/mobileNavigation — rows stay while the tombstones hold the keys in the walked shape) + `homePageId` (#4667 tombstone — the landing IS the first nav item; root landing follows `isDefault` routing) + `areas.description` (benign, docs-shaped, kept and not warned). RETIRED 17.0.0 (#4509, rows deleted — the selector schema is strict): selector `includeAll` (deliberately DISOBEYED, not merely unread — selectors are mandatory-scope and an "All" row would clear the scope, leaking system metadata through Studio's package filter; STUDIO_APP authored it against a renderer that ignored it) and `placement` (no renderer read it; "topbar" placed nothing). Nav walk covers the union's `object` variant; other variants hand-verified live, and the `actionDef` dispatch gap closed in #4509 | **#4651**: the **fail-open area gates** `areas.visible` / `areas.requiredPermissions` — this ledger's most important app finding — are REMOVED, rows DELETED (strict removal; retained rows would report ORPHAN). They were not merely unread: `filterAppForUser` never reads `item.areas` at all and the shell renders every area, so a "hidden" or permission-gated area was served to everyone, while the identically named per-ITEM and per-APP keys ARE enforced. Route B (remove) over route A (enforce): enforcing needs semantics decided first (does filtering an area remove its items everywhere? does the server bind `user` for area CEL?), which the 17.0.0 window could not hold. Boundary unchanged and still recorded on `areas.navigation`: per-item gating inside an area is shell-side only. **#4667**: `homePageId` TOMBSTONED (row stays — retiredKey keeps it in the walked shape) and `areas.order` row DELETED (strict removal); `areas.order` read alive because the per-ITEM `order` really is sorted (NavigationRenderer.tsx:1154) while no renderer ever sorted areas. |
| book | 20 | – | 1 | – | seeded 2026-08-01 (#4488). ADR-0046 §6 spine; `audience` is ENFORCED and fail-closed (tree 401/403 + per-doc effective-audience union on both list and tree). Dead 2 = BOTH inline `translations` maps (book-level and per-group): no resolver reads them and the bundle translator doesn't cover `book` — the trap is that `doc.translations` two files over works on every read path. Also recorded: the `include: { tag }` rule variant can never match (DocSchema declares no `tags`) | **#4667**: both inline translation maps retired — book-level row DELETED (BookSchema is strictObject), group-level row KEPT as a tombstone (BookGroupSchema is a plain z.object with no .strict(), so a bare delete would have zod silently strip it). No resolver read either; the trap was proximity to `doc.translations`, which is live on every doc render path. |
| doc | 15 | – | 0 | – | seeded 2026-08-01 (#4488). Fully live: the kernel stores `content` unparsed, but the REST read layer localizes (resolveDocLocale), audience-gates, list-strips `content`, and the book resolver consumes name/label/description/order/group — plus the objectui console portal renders it all. The schema's own "docs are inert data" header describes the kernel, not the type. **`tags` DECLARED in 17.0.0 (#4509)** — the enforce half of enforce-or-remove: the book resolver's `include: { tag }` matcher, the REST transport and `ResolverDoc.tags` all already existed, but DocSchema is strict and had no `tags` key, so authoring one was a parse error and the variant could never match. Live on arrival |
| email_template | 21 | 0 | 0 | 0 | this row read 8/–/13/– for one day (seeded 2026-08-01, #4488: "every authorable property is dead", the webhook shape on AUTH mail) and #4509 CLOSED it by ENFORCING — the second worked example, after `webhook`, that a dead verdict is a worklist entry rather than a tombstone. `bootstrapDeclaredEmailTemplates` materializes declared items into the `sys_email_template` rows `sendTemplate` reads, sharing `mapTemplateToRow` with the built-in seeder so the two doors cannot drift, and re-materializes on live metadata writes (`email_template` is `allowRuntimeCreate: true`, so boot-only would have left Studio saves inert). Three breaks had to close, not one: the engine never registered `emailTemplates:` into the registry, built-in seeds masqueraded as `managed_by: admin` and outranked declared templates, and nothing materialized. ADR-0054 proof bound on `subject` (`email-template-materialization`) |
| job | 13 | 0 | 2 | 0 | seeded 2026-08-01 (#4488). The file-authored path is fully enforced: all three schedule shapes honored by the adapters, `retryPolicy`/`timeout` enforced since #3494 (this is the retryPolicy the datasource ledger warns about confusing with its dead namesake), `enabled: false` skips scheduling. Dead 3 = `id` (authorWarn — `name` is the identity everywhere) + label/description (docs-kept). The type-level gap CLOSED 2026-08-02 (#4509) by closing the door rather than bridging it: `handler` names a function in the compiled bundle's function table, which a runtime writer cannot name, so `allowRuntimeCreate` **and** `allowOrgOverride` are now false and `*.job.ts` / `defineStack({ jobs })` are the supported doors. The kind stays registered — its file loader is genuinely consumed (ADR-0088 admission test) | **#4667**: `id` REMOVED (row deleted, strict removal) — nothing read it and its own describe() ("defaults to `name` when omitted") advertised an identity override that never existed; `name` is the scheduling key, the sys_job row key and the JobExecution.jobId stamp, so two jobs differing only in `id` were one job. Remaining dead = label/description, KEPT deliberately (docs-shaped, ADR-0033). |
| mapping | 14 | – | 0 | – | seeded 2026-08-01 (#4488) at 8/11 live; **0 dead since #4509** retired the three that were not. The import half (#2611) is loudly enforced — unsupported transforms/formats are 400s, `mode`/`upsertKey` default the request, the wizard picker renders `label`. RETIRED 17.0.0: `extractQuery` (authorWarn — "for export only" promised an export path no exporter implements) + `errorPolicy`/`batchSize`, which were dead AND **unwarnable** (schema defaults materialize at parse, so presence ≠ authored — `_authorWarnSkipped`, the non-boolean instance of the default(true) rule). That unwarnability is why they went out in the 17.0.0 window rather than after a deprecation cycle: removal was the only channel that could ever reach the author. Rows DELETED, not tombstoned — MappingSchema is strict, so the keys left the walked shape |
| seed | 5 | – | 0 | – | seeded 2026-08-01 (#4488). Fully live via SeedLoaderService on both doors (boot/per-org replay + runtime-draft publish). `records` is the z.record walk boundary: the keys an author writes are the target object's fields, governed by that object's own definitions — recorded in the entry, not silently skipped |
| translation | 17 | – | 2 | – | seeded 2026-08-01 (#4488) — after fixing the walker: the registered schema is a z.preprocess pipe (#3778 retired-dialect guard) whose transform side the unwrap always took, so the type was literally unwalkable. 10 of 11 groups live across spec resolvers, REST localization, objectui client resolvers and plugin-audit (whose composed-key `t()` calls make `messages` easy to mis-verify as dead). Dead 1 = `validationMessages` (authorWarn): nothing resolves it, and #3778's own legacy-key migration table steers `errors:` authors into it — a shipped false signpost, the capabilities.readOnly shape | **#4667**: `validationMessages` REMOVED (row deleted) — removed from the shared translationDataShape(), so it retired at BOTH doors at once, closing the item-only asymmetry #3778's original guard had. #3778's own `errors` guidance was rewritten in the same change: it had been steering authors INTO this dead group. |
| qa | 4 | – | 5 | – | seeded 2026-08-10 (#6247) — **not a metadata type**: `TestSuiteSchema` is the FILE surface of the shipped `os test` command (`qa/*.test.json`), governed through the same `SPEC_ONLY_SCHEMAS` override as `query`/`webhook`/`validation`. It is in the table as the clearest worked example of a **false `dead` measurement**: #6247 reported the whole domain declared-but-inert on a grep that scanned only `*Schema` identifiers, and every consumer here reads the **type** names (`QA.TestSuite`, `QA.TestStep`, `QA.TestAction`) — so an entire execution chain (core's `TestRunner` + `HttpTestAdapter`, published via `export * as QA`, driven by a documented CLI command) read as zero consumers, and a retire ruling was issued on it before being withdrawn. The `evidenceScope` table one section up says no amount of specifier matching is sufficient for a negative claim; this is the same lesson for **identifier** matching. What was really wrong was narrower and real: the type was the contract and the schema had no `parse` site, so the CLI's `JSON.parse(content) as QA.TestSuite` cast admitted anything — ENFORCED in the same change (`TestSuiteSchema.safeParse` at the load site, pinned). Dead 5 = `name` (the file name is the suite identity; the CLI prints `path.basename`), `scenarios.name` (describe() says "for test reports"; every report carries `scenarioId` instead), `scenarios.description` (docs-shaped, kept), and the two on the enforce-or-remove worklist — `scenarios.tags` promises filtering that `os test`'s two flags cannot express, and `scenarios.requires` declares param/plugin preconditions nothing checks, so a suite naming a missing plugin runs anyway and fails as an unexplained HTTP error. Neither carries `authorWarn` and the omission is deliberate (`_authorWarnSkipped`): the lint walks stack **collections**, a QA suite is a loose file in no stack, so a warn flag here would emit nothing — a silent no-op inside the mechanism built to catch silent no-ops |
| validation | 15 | 0 | 3 | 0 | seeded 2026-08-01 (#4488). The ADR-0020 carrier: the evaluator honors active/events/priority/severity/type/condition/message (the zod header's "only reads type/condition/…" prose is STALE — trust the ledger). Dead 3 = label/description/tags, declared governance metadata, kept unmarked. Union walk boundary recorded: only base + `script` keys walked; per-variant keys are governed by the evaluator's tests, not ledger rows. **No longer a registered metadata kind** — #4509 retired it under ADR-0088 (a standalone rule had no object-binding key and every variant is `.strict()`, so it bound to nothing and gated no write; a state machine authored that way saved cleanly and did nothing). The rule VOCABULARY is untouched and fully live via `object.validations[]`, so the ledger keeps governing it through the gate's spec-only override, alongside `webhook` and `query`. The contrast with the two bridges in the same batch is the point: enforce-or-remove picked ENFORCE where the feature existed and only the wiring was missing, and REMOVE where the shape itself could not carry the feature |

The `dead` set across types is the enforce-or-remove worklist (ADR-0049); every
misleading entry carries `authorWarn` so authors hear about it at compile time
(governed types with warn entries must also be registered in the CLI lint's
`TYPE_COLLECTIONS` — see lint-liveness-properties.ts).

**Coverage is complete as of #4488**: every type in the metadata-type registry
is governed, and `PENDING_GOVERNANCE` in `check-liveness.mts` is empty. The map
itself stays, because the ratchet is the point — registering a new type without
a ledger fails CI with instructions to govern it or record the debt (reason +
issue number). The paragraph that used to sit here, listing nine ungoverned
types as prose, is precisely how the gap survived for a year: prose cannot fail
a build. Now the gate compares `GOVERNED` against the registry in both
directions (an ungoverned registered type fails; so does a stale pending row
whose debt is already paid).
