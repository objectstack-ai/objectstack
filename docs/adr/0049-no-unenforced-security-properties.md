# ADR-0049: Spec must not declare security properties the runtime does not enforce (enforce-or-remove gate)

**Status**: Accepted (2026-06-15) — implemented: fail-closed `DESTRUCTIVE_OPERATIONS` (`packages/plugins/plugin-security/src/permission-evaluator.ts#DESTRUCTIVE_OPERATIONS`), lifecycle bits RBAC-gated, `apiEnabled` enforced (`runtime/src/api-exposure.ts`), `PolicySchema` removed, EXPERIMENTAL tag convention live. Two gate-valid disposition deviations: agent access-control shipped experimental-tagged (not enforced), `flow.runAs` kept + enforced (not removed). `action.disabled` CEL enforcement to confirm in objectui. **Amended 2026-09-04** (#14402) — recording that an author-written validation rule's `message` became translatable in 17.3.0 (#14381) under the object-scoped bundle key `objects.<object_name>._validations.<rule_name>.message`. That is this gate being **enforced, not reversed**: the 17.0.0 retirement of the top-level `validationMessages` group stands, and the two are not the same route. See **"Amendment (2026-09-04): validation-rule messages are translatable again — enforced, not reversed"** at the end.
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
(`packages/plugins/plugin-security/src/permission-evaluator.ts#permKey`, `if (!permKey) return true`). Any future
destructive operation added without registering it in `OPERATION_TO_PERMISSION`
is silently ungated. The evaluator must **fail closed** for the destructive
operation class.

---

## Context

- Evidence: `docs/audits/2026-06-security-identity-property-liveness.md` and the
  cross-type synthesis in `docs/audits/README.md` (cluster #1).
- The CRUD path *is* enforced: `SecurityPlugin` (`packages/plugins/plugin-security/src/security-plugin.ts#SecurityPlugin`)
  resolves permission sets and calls `PermissionEvaluator.checkObjectPermission`,
  which maps the ObjectQL operation to an `ObjectPermission` key via
  `OPERATION_TO_PERMISSION` (`packages/plugins/plugin-security/src/permission-evaluator.ts#OPERATION_TO_PERMISSION`).
- That map covers only `find/findOne/count/aggregate/insert/update/delete`. The
  three destructive permission bits in the spec
  (`packages/spec/src/security/permission.zod.ts#allowTransfer` — `allowTransfer`/`allowRestore`/`allowPurge`)
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

---

## Amendment (2026-09-04): validation-rule messages are translatable again — enforced, not reversed

**This records a fact, it does not change the decision.** As of **17.3.0**
(#14381, merged 2026-09-02 — `@objectstack/spec@17.3.0`,
`@objectstack/objectql@17.3.0`), an author-written validation rule's `message`
is translatable through the object-scoped bundle key
`objects.<object_name>._validations.<rule_name>.message`. **The 17.0.0
retirement of the top-level `validationMessages` group (#4667) stands, and the
two are not the same route.**

It is recorded because Prime Directive #13 makes reversing a recorded decision a
decision in its own right, and until now the 17.0.0 retirement lived only in a
retired-key tombstone (the ADR-0087 conversion
`translation-validation-messages-removed`) and a changeset — precisely the shape
#13 warns is easy to miss. It is recorded *here*, as an amendment rather than a
new ADR, because the reader who would be misled is the one already reading this
gate.

### Why this is the gate being enforced, not reversed

- **The policy is enforce-or-remove.** `validationMessages` was removed because
  **nothing read it** — a translated rule message was stored and never shown.
  Removal was the correct disposition then and is not revisited now.
- **The new key ships with its reader in the same change** — the other half of
  the same policy, not an exception to it.
  `packages/objectql/src/validation/rule-validator.ts#authoredRuleMessage`
  resolves the key as the violation is built, over the existing
  `ValidationMessageContext.translate` hook (#3957) that already localizes
  built-in messages and field labels. No second i18n path into objectql.
- **It is not the same key.** The retired group was keyed by rule name at the
  **top level** and so could not tell two objects' rules apart. The new one is
  **object-scoped**, spelled by
  `packages/spec/src/system/i18n-resolver.ts#objectValidationMessageKey`, and
  sits beside `_views` / `_actions` / `_tabs`.
- **The ADR-0087 conversion is untouched.** The stored-bundle rehydration seam
  still strips the old key. Nothing migrates from the retired group into the new
  one; an author who wants the new route writes it.

### Scope note

`validationMessages` is a translation key, not a security property, so its
retirement was never part of this ADR's original P0 cluster — the Non-goals
above place the non-security clusters elsewhere. The record lands here because
the repo cites this ADR as the enforce-or-remove policy for spec-property
retirement generally, including in the prescription an author sees on writing
the retired key
(`packages/spec/src/system/translation.zod.ts#TRANSLATION_KEY_GUIDANCE`). **No
new scope is claimed for this ADR by this amendment**; the decision above is
unchanged in every respect.
