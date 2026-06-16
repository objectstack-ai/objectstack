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
   that doesn't exist (`enable.feeds`, `field.columnName`, `versioning`). Benign display/doc
   metadata that's "dead" (no runtime reader) — `description`, `tags`, `icon` — must NOT be
   marked; an author isn't misled by them.
2. **Booleans: only mark `default(false)` flags.** The lint warns on a boolean only when set
   `true`, and it can't tell author-set-`true` from a schema default. A `default(true)` flag
   (`enable.trash`/`mru`, `enable.searchable`) would then warn on *every* object that has an
   `enable` block — so leave those unmarked (see `enable.searchable`'s `_authorWarnSkipped`).
   Object/string/array props warn when merely present, so this caveat is boolean-only.

The lint is ledger-driven: coverage grows by marking more entries `authorWarn`, not by
touching the lint code. Today it covers `object` (incl. `enable.*`) and `field`.

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
3. Add the type to `GOVERNED`; confirm the gate is green.

## Current state — 10 governed types (~295 properties)

| Type | live | exp | dead | Notes |
|---|---|---|---|---|
| object | 31 | – | 17 | `enable`/ObjectCapabilities + versioning/partitioning/cdc tier dead; `apiEnabled` unenforced |
| field | 34 | – | 39 | ~half dead — aspirational enhanced-type + governance config; naming-drift props server-live/client-snake |
| flow | 29 | 1 | 7 | `runAs` experimental (unenforced identity switch); status/active gate nothing; FlowNodeAction enum out of sync |
| action | 26 | – | 5 | `disabled` CEL ignored (renderers read non-spec `enabled`); type:'form'/shortcut/bulkEnabled dead |
| hook | 11 | – | 2 | model-healthy — near-total liveness; only label/description dead |
| permission | 23 | 3 | 2 | CRUD/FLS/RLS live; allow{Transfer,Restore,Purge} experimental; isProfile/contextVariables dead |
| role | 3 | – | 1 | `parent` dead (org hierarchy uses sys_department) |
| agent | 18 | 4 | 5 | access/permissions/visibility dead (chat route hardcodes perms); autonomy experimental |
| tool | 13 | 1 | 5 | write-only metadata; runtime uses a parallel AIToolDefinition |
| skill | 15 | – | 2 | triggerPhrases dead (no matcher); permissions dead |

The `dead` set across types is the enforce-or-remove worklist (ADR-0049). Not yet governed
(rollout): view, page, dashboard, app, report, dataset, job, datasource, translation,
email_template, doc, book, validation, seed.
