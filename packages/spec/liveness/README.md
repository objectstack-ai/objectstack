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

**A path in another repo must say so**, or the gate will report it as rot:

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

**Registered but unbound.** A proof with no authorable property to ratchet is
still registered — otherwise its `@proof:` tag reads as an orphan — and records
*why* rather than faking a binding:

| Proof | Why unbound |
|---|---|
| `form-widget-resolution` | no proof written yet (ADR-0054 Phase 2); `view.form.*` is governed and can carry it |
| `permission-set-projection` | a storage invariant (ADR-0094), not an authorable property |
| `flow-runas-schedule` | guards `flow.runAs`, already bound to `flow-runas-identity` — one entry carries one `proof` |
| `showcase-scope-depth-fallback` | guards `permission.objects.readScope`, already bound — this is the CLI-wiring sibling |
| `me-apps-and-everyone-baseline` | enforces `app.requiredPermissions` / `app.tabPermissions`; `app` is not governed yet |
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
or `flow.errorHandling.fallbackNodeId` (dead) vs the rest (live). Drill only where the
audit gives divergent sub-statuses; otherwise the top-level entry covers the whole subtree.

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

## Files & usage

- `<type>.json` — the ledger for a governed metadata type.
- `../scripts/liveness/check-liveness.mts` — the gate (tsx; imports the registry).

```bash
pnpm --filter @objectstack/spec check:liveness               # run the gate
tsx packages/spec/scripts/liveness/check-liveness.mts --dump field   # inventory a type (seeding aid)
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

## Current state — 16 governed types

Counts include drilled `children` entries; regenerate with the snippet below rather
than hand-editing (this table drifted badly once — field was listed 34/39 while the
ledger actually said 54/6).

```bash
python3 - <<'EOF'
import json, glob, os
from collections import Counter
for f in sorted(glob.glob('packages/spec/liveness/*.json')):
    d = json.load(open(f)); c = Counter()
    def walk(ps):
        for v in ps.values():
            if 'status' in v: c[v['status']] += 1
            walk(v.get('children') or {})
    walk(d.get('props', {}))
    print(os.path.basename(f)[:-5], dict(c))
EOF
```

| Type | live | exp | dead | planned | Notes |
|---|---|---|---|---|---|
| object | 40 | – | 0 | 1 | aspirational tier (versioning/softDelete/search/recordName/keyPrefix) + tags/active/abstract REMOVED (#2377) — tombstoned in UNKNOWN_KEY_GUIDANCE; `enable.trash`/`mru` REMOVED (#2377 close-out) — tombstoned in the now-`.strict()` ObjectCapabilities; `isSystem` + `enable.searchable` CORRECTED to live (#2377 — sharing default-model + global-search opt-out; 2026-06 audit missed both readers); `tenancy.strategy`/`crossTenantAccess` REMOVED post-15.0 (#2763) |
| field | 55 | – | 0 | – | healthy — full dead set (vectorConfig/fileAttachmentConfig/dependencies, then referenceFilters/columnName/index) REMOVED (#2377); columnName also dropped the ADR-0062 D7 lint + StorageNameMapping column helpers |
| flow | 26 | – | 5 | – | dead = description/template/nodes.outputSchema/errorHandling.fallbackNodeId (engine uses fault edges) + `active` CORRECTED to dead 2026-07 (deprecated no-op — `status` is what gates binding/execution since 497bda853; the file `_note` claiming otherwise is fixed) |
| action | 34 | 0 | 2 | – | `type:'form'` CORRECTED to live (objectui ActionRunner.executeForm, #2377); dead `timeout` REMOVED (#2377); `disabled` live for real since objectui#2863 (six surfaces); `shortcut` + `bulkEnabled` CORRECTED to dead 2026-07 — registered into ActionEngine but their accessors have no non-test caller (#3686 sweep); `undoable` CORRECTED to live 2026-07 — understated, two objectui readers gate the toast's Undo and the record restore (#3714) |
| hook | 11 | – | 2 | – | model-healthy; only label/description dead (benign) |
| permission | 32 | – | 0 | – | CRUD/FLS/RLS live; dead `contextVariables` REMOVED (ADR-0105 D11 — RLS resolves only the `current_user.*` built-ins plus runtime-staged `rlsMembership` sets) |
| position | 4 | – | – | – | (role's ADR-0090 successor) fully live |
| agent | 13 | 5 | 1 | – | dead `tenantId` + `planning.strategy`/`allowReplan` REMOVED (#2377) — only `planning.maxIterations` live; autonomy tier experimental; `knowledge` CORRECTED to dead 2026-07 — `search_knowledge` takes `sourceIds` from the LLM's tool-call args, never from the agent record (#1878 §3 recheck) |
| tool | 5 | 1 | 5 | – | the whole authoring surface is inert: `permissions` (not permission-gated), plus `category`/`requiresConfirmation`/`active`/`builtIn` CORRECTED to dead 2026-07 (#3686 sweep). ⚠️ `requiresConfirmation` is SAFETY-shaped and unenforced on every path — ADR-0033 already resolved to delete it |
| skill | 8 | – | 1 | – | `permissions` REMOVED 2026-07 (never gated anything — owner call was prune, #3704); `triggerPhrases` CORRECTED to dead — phrases are never matched against user messages; activation is `triggerConditions` + the agent's `skills[]` + explicit /skill-name pinning (#3686 sweep) |
| dataset | 19 | – | 0 | – | `measures.certified` (declared-but-unenforced governance flag) REMOVED in 16.0 (#2377) |
| page | 16 | – | – | 1 | fully live + one planned |
| view | 70 | 0 | 5 | – | list/form drilled via `children` (#2998 Track B); dead = list.{responsive,performance} + form.{data,defaultSort,aria}, all but aria authorWarn'd; form.{buttons,defaults} now live — objectui ObjectForm folds them onto its flat props (framework#1894 / #2998); audit-era DEAD lines superseded by re-verification (submitBehavior, sharing.lockedBy, list ViewData providers, and the ADR-0021 chart shape — all live now); level-2 dead residue (userActions.buttons, addRecord.mode/formView, tabs[].order) noted on parents — one drill level only |

| report | 20 | 0 | 2 | – | dataset-bound (ADR-0021); dead = aria + performance (perf authorWarn'd); audit-era `chart` DEAD superseded — DatasetReportChart plots `chart.xAxis`/`yAxis` via useDatasetRows (framework#1890 / #3441), `groupBy` stays experimental (describe marker) |
| dashboard | 18 | 0 | 2 | – | ADR-0021 dataset widgets (WidgetConfigPanel + DashboardRenderer migrated #3251; DashboardWidgetSchema `.strict()`); dead = aria + performance (perf authorWarn'd); audit-era `globalFilters`/`dateRange` DEAD superseded — LIVE via framework#2501; `title`↔`label` fixed (objectui#2806) |
| webhook | 0 | 1 | 16 | – | **not a registered metadata type** — governed via the gate's spec-only schema override (`SPEC_ONLY_SCHEMAS`), not `getMetadataTypeSchema` (#3461/#3462). The ENTIRE authoring surface is dead: nothing materializes an authored `webhooks:` entry into a `sys_webhook` dispatcher row (#3461, enforce-or-remove pending). `url` carries the single per-webhook `authorWarn` (one no-op heads-up per artifact, not per-prop); `authentication` experimental (HMAC-`secret`-only); `isActive` unmarked (default(true)). Notes cite the sys_webhook column map as the future materializer's mapping table |

The `dead` set across types is the enforce-or-remove worklist (ADR-0049); every
misleading entry carries `authorWarn` so authors hear about it at compile time.
Not yet governed (rollout): app, job, datasource,
translation, email_template, doc, book, validation, seed.
