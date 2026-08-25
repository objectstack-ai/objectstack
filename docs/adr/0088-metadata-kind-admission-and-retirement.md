# ADR-0088: Metadata-kind admission test; retire `trigger`, `router`, `function`, `service`

**Status**: Accepted (2026-07-05)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0085](./0085-object-semantic-roles-over-surface-hint-blocks.md) (§2 authored-key admission test — this ADR is its kind-level analogue), [ADR-0018](./0018-unified-node-action-registry.md) / [ADR-0020](./0020-state-machine-converge-and-enforce.md) (prior kind retirements: `workflow`, `approval`), [ADR-0062](./0062-external-datasource-runtime.md) (`external_catalog` lifecycle)
**Closes**: framework#2613

**Premise**: pre-launch, no back-compat debt — remove wrong entries outright rather than deprecate them.

---

## TL;DR

`DEFAULT_METADATA_TYPE_REGISTRY` is the contract AI and human authors read to learn *what can be authored*. Four of its kinds — `trigger`, `router`, `function`, `service` — have **no authoring surface, no loader, no schema, and no (or a dead) consumer**: every governance flag on their entries is already "no". They are Salesforce-inventory legacy slots, and keeping them violates the same principle that keeps rejected keys out of object schemas (ADR-0085 §2) and that retired `workflow`/`approval` (ADR-0019/0020): **never declare what the platform does not deliver** (Prime Directive #10, at the kind level).

This ADR states the admission test a kind must pass, retires the four kinds (30 → 26), and documents `external_catalog` as **runtime-created** — a kind whose *lack* of an authoring surface is correct design.

## The admission test

A metadata kind earns a registry entry only if ALL three hold:

1. **Independent lifecycle** — it is created, versioned, and invalidated as its own artifact (not merely a facet of another kind).
2. **Declarative governability** — it can live in the metadata repository with meaningful versioning/overlay/audit semantics; at least one of `allowRuntimeCreate` / `supportsOverlay` / a file loader is genuinely true.
3. **A real consumer** — runtime, Studio, or build reads artifacts of this kind and changes behavior.

A kind failing the test is removed, not annotated. If a future capability needs it, it returns with a full design (schema + loader + consumer + example), never as a placeholder — an empty kind actively misleads AI authors that enumerate the registry.

## Decisions

### 1. `trigger` — retired

"Data change → reaction" already has two delivered mechanisms with a clean seam: **`hook`** (synchronous, data-layer, in-transaction — 24 lifecycle events) and **`record_change` flows** (asynchronous, business-layer, observable/pausable — ADR-0018/0020). `trigger` had no stack collection, no `defineTrigger`, no FS loader consuming `**/*.trigger.ts`, no executor — and its enum comment referenced a `TriggerSchema` that never existed. Keeping the slot invites a third overlapping mechanism (the Apex-Trigger inheritance). *Authors: use `hook` for sync data-layer logic, a `record_change` flow for async automation.* (The `triggers` **capability token** in `requires:` — the FlowTrigger plugin family — is a different namespace and is unaffected.)

### 2. `router` / `function` / `service` — retired

Their real, consumed forms already live elsewhere, and all are **code contributions**, not declarative artifacts:

| Retired kind | Delivered form |
|---|---|
| `router` | imperative `http.server` mounts (resolve the service from the plugin context and mount on `kernel:ready`) + declarative `apis:` since #5040. ⚠️ **Correction (#4936, 2026-08-04):** this row originally also credited app-authored declarative `apis:` as "executed by `handleApiEndpoint`". That was never true — no route was mounted for a declared path and `matchEndpoint` had no implementation anywhere, so the branch was dead code; it has been deleted and a non-empty `apis:` is now rejected at publish/validate. The retirement decision for the `router` KIND is unaffected; the endpoint executor is being built under #5040, after which declarative `apis:` becomes a real delivered form. ⚠️ **Correction (2026-08-22 ruling):** this row also credited plugin manifest `contributes.routes` (HttpDispatcher prefix routing) as a delivered form. That was never true either — the key has zero readers monorepo-wide, so an entry parses cleanly and serves nothing. The key is being removed and every author-facing material that recommended it is corrected to point at the imperative mount; the delivered forms are the two now named above, and the `router` KIND's retirement is unaffected. |
| `function` | `defineStack({ functions })` code values (hook-binder & flow `script` body runners). ⚠️ **Correction (#10724, 2026-08-25):** this row originally also credited plugin `contributes.functions` (QL query functions) as a delivered form. That was never true — the #10627 census measured zero readers of the key monorepo-wide, so a function declared there was never registered; the key is retired with the other dead `contributes` members (#10724), and `defineStack({ functions })` remains the one way in, as the paragraph below already records. The retirement decision for the `function` KIND is unaffected. |
| `service` | the plugin/service registry itself (`registerService`) |

Their registry entries had `allowRuntimeCreate: false`, no overlay, no loader — a kind whose every governance flag is "no" is declaring it does not belong in the registry. Studio visibility into registered routes/functions/services, if wanted, is **runtime introspection** (a read-only endpoint), not metadata. The dormant objectql load path that registered QL functions from `type: 'function'` metadata items (nothing ever produced them) is removed with this ADR; `defineStack({ functions })` remains the one way in.

### 3. `external_catalog` — kept; runtime-created by design

The cached remote-schema snapshot of a federated datasource (ADR-0062) has a real lifecycle (Sync refresh, mismatch policy) and a real consumer — it stays. But it is a **derived** artifact: a package shipping one would be stale on arrival, like shipping a build output as source. Its registry entry is annotated `runtime-created`; the absence of an authoring surface is the point, permanently.

## Consequences

- `MetadataTypeSchema` and `DEFAULT_METADATA_TYPE_REGISTRY` shrink 30 → 26; every remaining entry is authorable, loadable, and consumed.
- `/api/v1/meta/types*` (dynamic over the registry) shrinks automatically. Persisted `sys_metadata` rows are unaffected — no production read path re-parses stored `type` values through the enum (verified; the metadata-core lockstep enum is edited in the same change).
- `OPS_FILE_SUFFIX_REGEX` drops the four suffixes: `*.trigger.ts` / `*.router.ts` / `*.function.ts` / `*.service.ts` are no longer valid OPS metadata file names.
- The showcase's registry-driven `KIND_COVERAGE` shrinks in lockstep (its coverage test enforces exact registry membership); the four waivers disappear and `external_catalog`'s waiver becomes a permanent, documented exclusion.
- ADR-0005 / ADR-0010 prose tables no longer list the retired kinds.

## Addendum (2026-08): `validation` retired — the admission test's first clause

`validation` was registered as a kind with `allowRuntimeCreate: true`, a
`*.validation.ts` loader, and a Studio form. On the admission test above it
nonetheless fails the **first** clause — independent lifecycle — and the failure
is not cosmetic:

- **No independent lifecycle.** A rule only means something against an object,
  and the only shape the engine evaluates is `object.validations[]`
  (`evaluateValidationRules` on insert and on every matched update row).
- **No way to bind.** `ValidationRuleSchema` carries no `object` / `objectName`
  key, and all six variants are `strictObject`, so an author could not supply
  one either — the parse would reject it. There was no merge step, and the only
  code that expected such a key was a reference-tracker row scanning a field
  that could never exist.

So the standalone door led nowhere: an item authored through it — including a
`state_machine` rule, which ADR-0020 explicitly routes through this same
vocabulary — saved cleanly, reported success, and intercepted no write. That is
the ADR-0049 false-compliance shape, on a surface authors reasonably expect to
gate their data.

The kind is removed (registry entry, `MetadataTypeSchema` member, metadata-core
lockstep enum, schema map entry, Studio nav item and hand-crafted form, create
seed, and the dangling reference row). `ValidationRuleSchema` itself is
**unchanged and fully live** — it is the kind that was inert, not the
vocabulary. The liveness ledger keeps governing the schema through the gate's
`SPEC_ONLY_SCHEMAS` override, alongside `webhook` and `query`, precisely because
an ungoverned live schema is how the next drift would hide.

Note the contrast with the sibling disconnects closed in the same batch (#4509).
`email_template` had a real feature with missing wiring, so enforce-or-remove
resolved it by **enforcing** — a materializer bridge. `validation` had a shape
that could not carry the feature at all, so it resolves by **removing**. The
test is not "is this dead?" but "can this be made to work as declared?".

- `MetadataTypeSchema` and `DEFAULT_METADATA_TYPE_REGISTRY` shrink 26 → 25.
- `*.validation.ts` / `*.validation.yml` are no longer metadata file patterns.
  (`OPS_FILE_SUFFIX_REGEX` never listed them — no change there.)
- Persisted standalone `sys_metadata` rows are left alone. They were never
  evaluated, so nothing changes behaviorally; `migrateStoredMetadata` declines
  them like any unregistered type.
- **Migration for authors:** move the rule into the object's `validations:`
  array. The rule body is unchanged — same schema, same six variants.
