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
| `router` | plugin manifest `contributes.routes` (HttpDispatcher prefix routing) + app-authored declarative `apis:` (`ApiEndpoint`, executed by `handleApiEndpoint`) + imperative `http.server` mounts |
| `function` | `defineStack({ functions })` code values (hook-binder & flow `script` body runners) + plugin `contributes.functions` (QL query functions) |
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
