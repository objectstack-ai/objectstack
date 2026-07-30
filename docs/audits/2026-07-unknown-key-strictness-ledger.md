# Unknown-key strictness ledger — the authorable / wire / open triage (#4001)

**Date**: 2026-07-30 · **Issue**: [#4001](https://github.com/objectstack-ai/objectstack/issues/4001) · **Builds on**: #3405 / #3746 (the `ActionParamSchema` template), #1535 (`ObjectSchema.create` unknown-key error), ADR-0089 D3a (view/page strict), ADR-0078 (no-silently-inert-metadata), ADR-0049 (enforce-or-remove), ADR-0054 (ratchet idiom)

Zod's default is `.strip`: a key the schema does not declare is **silently
discarded** and the instance goes on parsing. On an authorable surface that is
the worst failure mode — the author (human or AI) gets a success envelope and
ships metadata that quietly ignores their config. This ledger is #4001 step 1:
the persisted classification of *which* `z.object` sites that default is wrong
for, so the `.strict()` ratchet advances on evidence instead of a one-shot
sweep. **1885 sites was never the target number** — a large share of the spec
is wire/response shape where strictness would be a forward-compat bug.

## Classification rule

One question decides the class: **who writes this schema's input?**

| Class | Input written by | Unknown-key policy |
|---|---|---|
| **authorable** | A human or AI author, into `*.object.ts` / `defineStack` config / Studio / MCP | `.strict()` + fixable error (the ratchet target) |
| **wire** | Another machine: server responses, connector payloads, runtime envelopes, persisted runtime state | stay tolerant (`.strip` / `.passthrough`); strictness here turns an upstream *addition* into our parse crash |
| **open** | Deliberately schemaless user data (record bodies, per-node-type `config`, React props) | stay open; a *sibling* contract validates it (e.g. a node executor's `configSchema`, #4027/#4040) |

Mixed files carry both — classify per schema, not per file. A **response-side
extension of an authoring schema** (e.g. `EffectiveObjectPermissionSchema`)
must explicitly `.strip()` back, because `.extend()` inherits `.strict()`.

## Standard wiring

`strictUnknownKeyError` in `shared/suggestions.zod.ts` (generalized from the
#3746 hand-rolled map) is the one factory every strict authoring schema wires:

```ts
z.object({ ... }, { error: strictUnknownKeyError({ surface, knownKeys, aliases, guidance, history }) }).strict()
```

- `aliases` — semantic near-misses edit distance cannot reach (`visibleWhen` →
  `visible`, `from` → `source`, `read` → `allowRead`).
- `guidance` — exact-key prescriptions: **tombstones for retired keys** (the
  rejection carries the upgrade — AGENTS.md Post-Task Checklist #3) and
  wrong-layer pointers (`apiOperations` is response-side; `objectName` belongs
  on the start node).
- Key lists live beside the schema and are **drift-guarded by tests** (an
  "accepts every declared key" probe), because the schema body is lazy.

Every ratchet step ships only with the empirical zero-breakage pass: full
`@objectstack/spec` suite + `tsc`, downstream consumer suites, and
`objectstack validate` on all three example apps. Inference is not evidence —
the first application of this gate (below) caught a real spec gap.

## Ratchet state

### Already strict before #4001 (for reference)

| Surface | Since |
|---|---|
| `data/object.zod.ts` — `ObjectSchema.create()` unknown-key error + `UNKNOWN_KEY_GUIDANCE` tombstones; strict capabilities / tenancy / CRUD-override blocks | #1535, #2377, #2763 |
| `ui/view.zod.ts` / `ui/page.zod.ts` — form/page component schemas | ADR-0089 D3a |
| `ui/dashboard.zod.ts`, `data/field.zod.ts` (blocks), `ai/agent.zod.ts`, `ai/tool.zod.ts` (blocks) | various |
| `ui/action.zod.ts` — `ActionParamSchema` (the template) | #3405 / #3746 |

### This step (#4001 Tier-A slice)

| Schema | File | Evidence class |
|---|---|---|
| `PermissionSetSchema`, `ObjectPermissionSchema`, `FieldPermissionSchema`, `AdminScopeSchema` | `security/permission.zod.ts` | A silently dropped key on the capability container is the ADR-0049 asymmetry itself; retired `contextVariables` (ADR-0105 D11) / `isProfile` (ADR-0090 D2) get tombstones |
| `FlowSchema`, `FlowNodeSchema`, `FlowEdgeSchema`, `FlowVariableSchema` | `automation/flow.zod.ts` | Most AI-authored surface; cloud#688 / #2419 class. Node `config` stays **open** (executor `configSchema` owns it, #4027/#4040) |
| `ActionParamSchema` re-homed onto the shared factory | `ui/action.zod.ts` | #3746 template, byte-identical messages |

**Findings log** (what the gate caught the day it was turned on):
`PermissionSetSchema` could not represent `description` — yet the built-in
default sets author it and `plugin-security`'s Setup projection reads it
(`permission-set-projection.ts`). It had been silently stripped at every parse
(the ADR-0078 §3 inverse-drift class). Fixed contract-first: `description` is
now a declared key. This is the empirical argument for the ratchet: the
inference "no metadata in the repo carries unknown keys" was **false**, and
only the strict gate could prove it.

## File-level triage — the five authorable directories

Site counts are `z.object(` occurrences per file (2026-07-30, this branch).
Classification is per the rule above; **(p)** marks a provisional call made
from the file's exports/JSDoc rather than a full read — verify before
tightening (the #4001 "sharing-rule lesson": candidates, not verdicts).

### `ui/` — 192 sites

| File | Sites | Class | Note / next action |
|---|---|---|---|
| `action.zod.ts` | 8 | authorable | param schema strict (#3746); remaining blocks ride later steps |
| `view.zod.ts` | 51 | authorable | partially strict (ADR-0089); long tail of sub-blocks |
| `component.zod.ts` | 29 | authorable | **next candidate** — SDUI component defs; check React-prop open slots first (p) |
| `theme.zod.ts` | 14 | authorable (p) | authored themes |
| `app.zod.ts` | 11 | authorable | **next verified step** — `AppSchema` + nav-item union; recursive `NavigationItemSchema` needs union-error care |
| `dashboard.zod.ts` | 11 | authorable | partially strict |
| `widget.zod.ts` | 9 | authorable (p) | |
| `page.zod.ts` | 7 | authorable | partially strict (ADR-0089) |
| `chart.zod.ts` / `i18n.zod.ts` / `responsive.zod.ts` | 6+6+6 | authorable (p) | i18n label shapes are wide-open records by design — verify |
| `dataset.zod.ts` / `animation.zod.ts` / `dnd.zod.ts` / `keyboard.zod.ts` / `touch.zod.ts` | 4 ea | authorable (p) | interaction configs |
| `notification.zod.ts` / `offline.zod.ts` / `report.zod.ts` | 3 ea | authorable (p) | |
| `sharing.zod.ts` | 2 | authorable (p) | public-sharing config |

### `data/` — 163 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `object.zod.ts` | 20 | authorable | top-level already guarded (#1535); inner blocks partially strict |
| `data-engine.zod.ts` | 14 | wire (p) | engine contract shapes |
| `external-lookup.zod.ts` | 12 | mixed (p) | authored config + wire results |
| `seed-loader.zod.ts` | 12 | mixed (p) | seed file shapes are authored; loader state is runtime |
| `field.zod.ts` | 11 | authorable | partially strict |
| `filter.zod.ts` / `query.zod.ts` | 11+10 | open | query dialect — user data flows through; validated semantically elsewhere |
| `driver-nosql.zod.ts` / `driver.zod.ts` / `driver-sql.zod.ts` | 10+9+2 | wire | driver capability contracts |
| `datasource.zod.ts` | 9 | authorable (p) | stack-authored config — **candidate** |
| `analytics.zod.ts` | 8 | mixed (p) | |
| `document.zod.ts` | 8 | wire (p) | |
| `hook.zod.ts` / `hook-body.zod.ts` | 6+2 | authorable (p) | `defineHook` — **candidate** |
| `mapping.zod.ts` | 3 | authorable (p) | |
| `external-catalog.zod.ts` | 4 | wire (p) | |
| `field-value.zod.ts` / `seed.zod.ts` / `validation.zod.ts` | 1 ea | mixed (p) | |

### `automation/` — 80 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `flow.zod.ts` | 12 | authorable | **strict as of #4001** (4 schemas; `FlowVersionHistorySchema` is runtime — stays tolerant) |
| `sync.zod.ts` / `etl.zod.ts` | 12+10 | authorable (p) | authored pipelines — **candidates** |
| `trigger-registry.zod.ts` | 11 | mixed | descriptors are code-registered (wire-ish); bindings authored |
| `execution.zod.ts` | 8 | wire | run-state envelopes — never strict |
| `state-machine.zod.ts` | 7 | authorable (p) | |
| `control-flow.zod.ts` | 6 | authorable (p) | validated structurally by `validateControlFlow` |
| `bpmn-interop.zod.ts` | 5 | wire (p) | interop import shapes |
| `approval.zod.ts` | 4 | authorable | **next candidate** — v17 approval nodes are new authoring surface |
| `node-executor.zod.ts` | 4 | wire | executor contract |
| `webhook.zod.ts` | 1 | authorable (p) | spec-only (#3461) |

### `security/` — 20 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `explain.zod.ts` | 11 | wire | permission-explain responses — never strict |
| `permission.zod.ts` | 4 | authorable | **strict as of #4001**; `EffectiveObjectPermissionSchema` explicitly `.strip()`s (wire) |
| `rls.zod.ts` | 3 | authorable | **next candidate** — a stripped RLS key is a silent policy hole |
| `sharing.zod.ts` | 2 | authorable | **next candidate** — same class |

### `studio/` — 27 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `object-designer.zod.ts` | 12 | authorable (p) | Studio-written JSON — machine-authored but *our* machine; strict protects the builder itself |
| `plugin.zod.ts` | 8 | mixed (p) | |
| `flow-builder.zod.ts` | 7 | authorable (p) | independent of `FlowSchema` shapes |

## Other directories (coarse; classify per schema before touching)

| Dir | Sites | Dominant class | Rationale |
|---|---|---|---|
| `api/` | 426 | wire | REST/GraphQL request/response contracts — tolerant by design |
| `system/` | 383 | mixed | manifest/datasource blocks are authored; runtime envelopes are wire |
| `kernel/` | 351 | wire | plugin/kernel contracts, code-to-code |
| `cloud/` | 83 | wire | multi-tenant runtime |
| `ai/` | 75 | mixed | agent/tool/skill definitions authored (partially strict already); model/provider payloads wire |
| `integration/` | 64 | wire | connector payloads — upstream adds fields freely |
| `identity/` | 34 | mixed | position/user shapes authored; auth payloads wire |
| `shared/` | 25 | n/a | utilities and building blocks; strictness decided at the consuming schema |
| `qa/` | 6 | n/a | test fixtures |

## Next steps (verify-then-enforce, one shape at a time)

1. `ui/app.zod.ts` — `AppSchema` + navigation union (highest-traffic remaining
   authorable type; needs union-error design so the strict error is readable).
2. `security/rls.zod.ts` + `security/sharing.zod.ts` — small, security-class.
3. `automation/approval.zod.ts` — new v17 authoring surface, tighten while young.
4. `data/hook.zod.ts`, `data/datasource.zod.ts` — `defineHook` / stack config.
5. Promote this ledger to a machine-checked gate (pattern of
   `packages/spec/liveness/` + `check:liveness`) once enough of the surface is
   classified that the table above is enforceable rather than descriptive.

Long tail stays gated on a verification pass per shape — never a one-shot
"make all ~453 sites strict" (ADR-0054 ratchet; #4001's own recommendation).
