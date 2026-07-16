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

## Status vocabulary

| Status | Meaning |
|---|---|
| `live` | Has a runtime consumer. Cite it in `evidence` (`file:line`; objectui-repo paths as prose to avoid false stale-flags). |
| `experimental` / `planned` | Declared, intentionally not enforced yet. Also read from a spec `.describe()` marker like `[EXPERIMENTAL — not enforced]`. |
| `dead` | Parsed, no consumer. Tracked for **enforce-or-remove** (ADR-0049). |

Resolution per property: **ledger entry → spec `.describe()` marker → UNCLASSIFIED**.
Framework provenance/lock fields (`_lock*`, `_provenance`, `_packageId/Version`,
`protection` — ADR-0010) are auto-classified `live`.

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
  "proof": "packages/dogfood/test/field-zoo-roundtrip.dogfood.test.ts#field-type-roundtrip"
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
is also checked: a `@proof:` tag under `packages/dogfood/test/**` that isn't
registered in `../scripts/liveness/proof-registry.mts` is flagged (warning) so a new
proof gets wired in.

**The ratchet (the authoritative high-risk-class list).** Defined in
`../scripts/liveness/proof-registry.mts`. A class is **CI-enforced** (`bound`) only
once it has *both* a runtime proof *and* a governed ledger entry to carry it — the
binding lands one class at a time (ADR-0054 §3), never as a big-bang backfill.

| High-risk class | Bound? | Ledger binding | Proof |
|---|---|---|---|
| Field types | ✅ enforced | `field.type` | `field-zoo-roundtrip.dogfood.test.ts#field-type-roundtrip` |
| RLS / sharing | ✅ enforced | `permission.rowLevelSecurity.using` | `rls-fixture.dogfood.test.ts#rls-by-id-write` |
| Master-detail controlled-by-parent | ✅ enforced | `object.sharingModel` | `controlled-by-parent.dogfood.test.ts#cbp-controlled-by-parent` |
| Flow nodes | ✅ enforced | `flow.nodes.type` | `flow-node.dogfood.test.ts#flow-node-execution` |
| Analytics dims/measures | ✅ enforced | `dataset.dimensions.dateGranularity` | `analytics-timezone.dogfood.test.ts#analytics-tz-bucketing` |
| Form layout/section/widget | ⛔ pending | — | none yet (`view` is governed as of #2998 Track B, so `view.form.*` can carry the binding — the dogfood proof is the missing half) |

To bind a pending class: add its dogfood proof + `@proof:` tag, set `bound: true` and
its `ledgerBindings` in `proof-registry.mts`, add the `proof` to the ledger entry, and
confirm the gate is green. Because the gate also triggers on `packages/dogfood/**`,
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
   (`enable.trash`/`mru`, `enable.searchable`) would then warn on *every* object that has an
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

## Current state — 13 governed types

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
| object | 37 | – | 12 | 1 | versioning/partitioning/cdc tier dead; ObjectCapabilities fully live post-#2707/#2727; `tenancy.strategy`/`crossTenantAccess` REMOVED post-15.0 (#2763) — tenancy block is now strict with tombstone guidance |
| field | 55 | – | 6 | – | near-healthy; dead = referenceFilters/columnName/index/vectorConfig/fileAttachmentConfig/dependencies, all authorWarn'd |
| flow | 27 | – | 4 | – | dead = description/template/nodes.outputSchema/errorHandling.fallbackNodeId (engine uses fault edges) |
| action | 34 | 1 | 1 | – | `disabled` went LIVE via metadata-admin authoring UI (2026-06 audit missed objectui); only `timeout` dead |
| hook | 11 | – | 2 | – | model-healthy; only label/description dead (benign) |
| permission | 32 | – | 1 | – | CRUD/FLS/RLS live; `contextVariables` dead (RLS uses current_user.* built-ins only) |
| position | 4 | – | – | – | (role's ADR-0090 successor) fully live |
| agent | 14 | 5 | 1 | – | `tenantId` dead (tenancy comes from request context); autonomy tier experimental |
| tool | 9 | 1 | 1 | – | `permissions` dead — tool invocation not permission-gated by it |
| skill | 10 | – | – | – | fully live |
| dataset | 19 | – | 1 | – | `measures.certified` declared-but-unenforced governance flag |
| page | 16 | – | – | 1 | fully live + one planned |
| view | 68 | 2 | 5 | – | list/form drilled via `children` (#2998 Track B); dead = list.{responsive,performance} + form.{data,defaultSort,aria}, all but aria authorWarn'd; exp = form.{buttons,defaults} awaiting objectui#2545; audit-era DEAD lines superseded by re-verification (submitBehavior, sharing.lockedBy, list ViewData providers, and the ADR-0021 chart shape — all live now); level-2 dead residue (userActions.buttons, addRecord.mode/formView, tabs[].order) noted on parents — one drill level only |

The `dead` set across types is the enforce-or-remove worklist (ADR-0049); every
misleading entry carries `authorWarn` so authors hear about it at compile time.
Not yet governed (rollout): dashboard, app, report, job, datasource,
translation, email_template, doc, book, validation, seed.
