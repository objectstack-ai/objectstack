# ADR-0049: Spec must not declare security properties the runtime does not enforce (enforce-or-remove gate)

**Status**: Accepted (2026-06-15) — implemented: fail-closed `DESTRUCTIVE_OPERATIONS` (`permission-evaluator.ts:37,122`), lifecycle bits RBAC-gated, `apiEnabled` enforced (`runtime/src/api-exposure.ts`), `PolicySchema` removed, EXPERIMENTAL tag convention live. Two gate-valid disposition deviations: agent access-control shipped experimental-tagged (not enforced), `flow.runAs` kept + enforced (not removed). `action.disabled` CEL enforcement to confirm in objectui.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (artifact vs runtime overlay), [ADR-0010](./0010-metadata-protection-model.md) (package provenance), [ADR-0027](./0027-metadata-authoring-lifecycle.md) (authoring lifecycle)
**Consumers**: `@objectstack/spec` (security/identity schemas), `@objectstack/plugin-security` (`PermissionEvaluator`, `SecurityPlugin`), spec authors, the metadata-property liveness audit follow-ups (#1878 P0 cluster).
**Surfaced by**: the metadata property liveness audit (#1878, `docs/audits/`) — which found that **roughly half of all spec properties are dead**, and that a cluster of *security* properties is **parsed but unenforced**.

---

## TL;DR

A protocol-level audit cross-referenced every spec property against its actual
runtime consumers. The most serious finding is a cluster of **security
properties that imply an access-control boundary but enforce nothing**:
`PolicySchema` (100% dead — password/session/MFA/IP/audit), permission
lifecycle bits (`allowTransfer`/`allowRestore`/`allowPurge`), `agent`
access-control, flow `runAs`, object `apiEnabled`/`apiMethods`, action
`disabled`, role `parent`, and `SharingRuleSchema`.

A security property that parses but does nothing is **worse than absent**: it
produces a *false sense of compliance*. An admin who sets `allowPurge: false`
or authors a strict password policy believes a boundary exists where none does.

**Decision.** A spec property that names a security/access-control boundary
**must be in exactly one of three states**:

1. **Enforced** — a runtime consumer reads it and changes a decision (`file:line`).
2. **`experimental`** — explicitly marked and documented as *not yet enforced*,
   so authoring it is a known no-op (roadmapped, not a promise).
3. **Absent** — removed from the spec.

Shipping a security property in a fourth state — *parsed, unmarked, unenforced*
— is prohibited. This is the **enforce-or-remove gate**.

A second, roadmap-independent defect compounds the first: `PermissionEvaluator`
**fails open** for operations it doesn't recognise
(`permission-evaluator.ts:35`, `if (!permKey) return true`). Any future
destructive operation added without registering it in `OPERATION_TO_PERMISSION`
is silently ungated. The evaluator must **fail closed** for the destructive
operation class.

---

## Context

- Evidence: `docs/audits/2026-06-security-identity-property-liveness.md` and the
  cross-type synthesis in `docs/audits/README.md` (cluster #1).
- The CRUD path *is* enforced: `SecurityPlugin` (`security-plugin.ts:326`)
  resolves permission sets and calls `PermissionEvaluator.checkObjectPermission`,
  which maps the ObjectQL operation to an `ObjectPermission` key via
  `OPERATION_TO_PERMISSION` (`permission-evaluator.ts:8-16`).
- That map covers only `find/findOne/count/aggregate/insert/update/delete`. The
  three destructive permission bits in the spec
  (`permission.zod.ts:28-30` — `allowTransfer`/`allowRestore`/`allowPurge`)
  have **no operation pointing at them**, and the operations they describe
  (`transfer`/`restore`/`purge`) **do not yet exist** as ObjectQL operations.
  So the bits are dangling, and the `if (!permKey) return true` default means
  that *if* such an operation were added without a map entry, it would be
  allowed for everyone.

## Decision — staged by the platform's current (pre-MVP) phase

The audit's instinct was "enforce every unenforced security prop." At the
current milestone that is the **wrong default**: building enforcement for
features that do not exist yet is speculative. The real, shippable liability is
the *false promise*, not the missing feature. So we split the P0 cluster by
**whether the feature already exists**:

| Situation | Items | Phase action |
|---|---|---|
| **Feature does not exist; spec bit is a dangling promise** | `PolicySchema` (#1882), permission lifecycle bits (#1883), `SharingRuleSchema` spec form (#1887), flow `runAs` (#1888) | **Remove or mark `experimental`** now. Re-introduce *with* the feature + enforcement at M2/production. |
| **Feature is live; the gate is missing or bypassed** | agent access-control (#1884), object `apiEnabled`/`apiMethods` (#1889), action `disabled` CEL (#1885) | **Enforce** now — these are real, exploitable gaps and the fix is a localized check at the route/renderer. |

Plus one **no-regret correctness fix**, independent of roadmap:

- `PermissionEvaluator` fails **closed** for the destructive operation class:
  introduce an explicit set of sensitive/destructive operations; an unrecognised
  operation in that class is **denied**, not allowed. (Non-destructive unknown
  operations may retain default-allow to avoid breaking custom read-side ops.)

### `experimental` convention for the "mark, don't remove" path

For a roadmapped property we keep but cannot yet enforce, annotate it so the
no-op is explicit to authors and tooling, rather than silently parsing:

- prefix the Zod `.describe()` with **`[EXPERIMENTAL — not enforced]`**, and
- where the surrounding schema already carries a status/stability enum (e.g.
  `model-registry.zod.ts`, `plugin-capability.zod.ts`), prefer that enum.

Removal is preferred over marking when there is no committed roadmap for the
property — a smaller spec surface is the stronger default pre-MVP.

## Consequences

- **Positive.** No spec property silently misleads an admin about a security
  boundary. The evaluator can no longer be made to fail open by adding a
  destructive operation. The P0 cluster splits into a cheap no-regret PR
  (evaluator fail-closed + mark/remove dangling bits) and a small enforcement
  PR (live-but-ungated features), deferring the heavy work (policy registration,
  sharing-rule engine reconciliation) to when the feature lands.
- **Negative / cost.** Removing or `experimental`-tagging spec bits is a
  spec-surface change; seeds/fixtures that author the removed bits must be
  updated (low risk pre-MVP). The fail-closed change requires enumerating the
  destructive operation class so legitimate custom operations are not denied.
- **Follow-up.** This ADR is the umbrella decision for the #1878 P0 cluster;
  each sub-issue records its enforce/experimental/remove disposition against the
  table above.

## Non-goals

- Building the transfer/restore/purge, policy-enforcement, or sharing-rule
  engines themselves — those are feature work for M2/production, tracked by
  their respective issues.
- The P1 (ADR-0021 analytics migration) and P2 (spec hygiene) clusters of
  #1878 — non-security, governed separately.
