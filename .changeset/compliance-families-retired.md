---
"@objectstack/spec": minor
---

feat(spec)!: retire the incident-response, training and change-management families whole — nineteen defs and every name they exported — and the `ESignatureConfig` deadline pair (#15513, #14477, ADR-0049)

<!-- adr-0087: registered incident-response-family-retired, training-family-retired, change-management-family-retired, esignature-config-deadline-keys-retired -->

**BREAKING** — published exported symbols leave `@objectstack/spec/system`, and
two authorable keys leave `data/ESignatureConfig` — landing after the v17.0.0
cut (the lockstep launch-window convention ships it as `minor`; the
registrations live under protocol major 18, where `os migrate meta` users will
look). Maintainer ruling 2026-09-05 on #15513 (decision batch #40, ruled A:
retire the three compliance-shaped families whole via `RETIRED_DEFS_BY_MAJOR`,
the `integration/ErrorMappingConfig` precedent; none of the three is
roadmapped) and, in the same stroke, the answer the 2026-09-02 ruling on #14477
had held open (no roadmapped e-signature consumer ⇒ the pair retires with the
rest). ADR-0049 enforce-or-remove decides it — declared-but-unenforced surface
with zero measured readers comes off.

## What leaves the public surface — the three families, whole

Nineteen defs (the card counted fifteen; the manifest counts nineteen — the
ruling names the families, the number is the files' reading), forty-five
exported names, roughly a hundred declared keys, and the generated reference
pages `references/system/incident-response`, `training` and
`change-management`:

| file | defs (`json-schema.manifest/system.json` spelling) |
|:--|:--|
| `system/incident-response.zod.ts` | `system/Incident`, `system/IncidentCategory`, `system/IncidentNotificationMatrix`, `system/IncidentNotificationRule`, `system/IncidentResponsePhase`, `system/IncidentResponsePolicy`, `system/IncidentSeverity`, `system/IncidentStatus` |
| `system/training.zod.ts` | `system/TrainingCategory`, `system/TrainingCompletionStatus`, `system/TrainingCourse`, `system/TrainingPlan`, `system/TrainingRecord` |
| `system/change-management.zod.ts` | `system/ChangeImpact`, `system/ChangePriority`, `system/ChangeRequest`, `system/ChangeStatus`, `system/ChangeType`, `system/RollbackPlan` |

With them: every `*Schema` const, every `z.input` alias (`Incident`,
`IncidentResponsePolicy`, `TrainingCourse`, `ChangeRequest`, …) and the six
`*Parsed` aliases (`IncidentNotificationRuleParsed`,
`IncidentNotificationMatrixParsed`, `IncidentResponsePolicyParsed`,
`TrainingCourseParsed`, `TrainingPlanParsed`, `ChangeRequestParsed`).

**Why.** The schemas were exported from `@objectstack/spec/system`, mounted by
no `stack.zod.ts` key, registered as no metadata type, absent from the 2026-06
liveness ledgers, and **read by nothing**: the reader census over every package
outside `packages/spec` (tests and changelogs excluded), over `examples/**` and
`skills/**`, and over objectui at the pinned sha (`a472b07`) returned zero hits
for every one of the forty-five names, with a lit control on the same pattern
(`ObjectSchema` / `FieldSchema`: 336, 200 and 342 hits per leg). Several keys
were boolean capability claims of exactly the shape ADR-0049 names —
`IncidentNotificationRule.notifyRegulators`,
`IncidentResponsePolicy.requirePostIncidentReview`, `TrainingCourse.mandatory`,
`TrainingPlan.trackCompletion` / `sendReminders`,
`ChangeRequest.approval.required`,
`ChangeRequest.securityImpact.requiresSecurityApproval` — so an author writing
`notifyRegulators: true` held a compliance promise the platform never kept,
with no error and no feedback, and the reference docs advertised a compliance
subsystem that does not exist. Tagging the families
`[EXPERIMENTAL — not enforced]` was the fallback the ruling did not take: it is
a human-only signal, and an AI generating from the schema still writes the key
and believes it.

**What happened to the fourteen #14477 deadline-key tombstones** (PR #15514,
merged 2026-09-04): they leave with their defs' source. Their fourteen
`RETIRED_KEYS_BY_MAJOR[18]` entries and three D3 entries stay as history — gate
(b2) of `build-schemas.ts` accepts an entry naming a key the build no longer
emits, and the 17→18 upgrade guide still owes the reader those prescriptions.
`deadline-keys-retirement.test.ts`, whose every pin needed the schemas to exist,
is replaced by `compliance-families-retirement.test.ts`.

## What is refused — the `ESignatureConfig` pair

Authoring `expirationDays` or `reminderDays` on an `ESignatureConfig`, with any
value, on the base schema and through `Document.eSignature`. The schema is not
`.strict()`, so each key is a `retiredKey()` tombstone rather than a bare
deletion (a deletion would have stripped it in silence): authoring it is a `tsc`
error (`never`) and a parse error carrying the prescription (`invalid_type` at
the path of the key). Both carried defaults (30 days, 7 days) that were
materialized into every parsed configuration without ever being consulted;
parsed configurations no longer carry them. `provider`, `enabled` and `signers`
stay, byte-identical. Census for the pair: zero hits for `expirationDays`,
`reminderDays`, `eSignature` and the `ESignatureConfig` names on all three legs,
control lit inside `packages/spec` (`document.zod.ts` 9, `document.test.ts` 24).

**Unmeasured, verbatim:** `cloud` and real customer configurations are
UNMEASURED for both the families and the pair — this census covers this repo
and objectui at the pin.

## FROM → TO

```ts
// before — imported and parsed green; no engine ever read a single key
import { IncidentResponsePolicySchema, type IncidentResponsePolicy } from '@objectstack/spec/system';
const policy: IncidentResponsePolicy = {
  notificationMatrix: { rules: [{ severity: 'critical', channels: ['pagerduty'], recipients: ['security_team'], notifyRegulators: true }] },
  defaultResponseTeam: 'security_team',
  requirePostIncidentReview: true,
};
IncidentResponsePolicySchema.parse(policy);

const signing: ESignatureConfig = {
  provider: 'docusign',
  signers: [{ email: 'client@example.com', name: 'John Doe', role: 'Client', order: 1 }],
  expirationDays: 30,
  reminderDays: 7,
};

// after — the import is TS2305 and there is no replacement to point at, because
// no incident-response, training-management or change-management engine exists.
// A compliance record the organisation keeps is ordinary object data, declared
// as an object with its own fields and enforced by the object engine; an
// approval that must actually gate something is a flow (ADR-0018) with an
// approval node.
//
// The e-signature pair: delete the keys. `ESignatureConfig` itself stays.
const signing: ESignatureConfig = {
  provider: 'docusign',
  signers: [{ email: 'client@example.com', name: 'John Doe', role: 'Client', order: 1 }],
};
```

One-line fix: delete the import (families) or the key (pair) wherever it is
authored. There is no `os migrate meta` edit list — none of the schemas is a
stack collection member and `document` is no metadata type, so the conversion
chain has no seam to walk (the `MetadataPluginConfig.additionalTypes`
precedent); the tombstone prescriptions, the `tsc` refusals and the protocol-18
upgrade guide are the channels.

The retirement kit:

- the three schema files and their tests deleted whole; the survivor notes in
  `packages/spec/src/system/index.ts` record what each module declared and why
  nothing ever read it
- ADR-0087 registration: nineteen `RETIRED_DEFS_BY_MAJOR[18]` entries
  (`entries/retired-defs/18.system__*.ts`) and three D3 semantic entries, one
  per family; for the pair, `data/ESignatureConfig:expirationDays` and
  `data/ESignatureConfig:reminderDays` in `RETIRED_KEYS_BY_MAJOR[18]` plus the
  D3 entry `esignature-config-deadline-keys-retired`; the step-18 `rationale`
  extended
- no liveness-ledger row: none of the families and neither `document` nor
  `ESignatureConfig` is an enrolled ledger type, so there is no row to keep or
  drop
- pin tests: `compliance-families-retirement.test.ts` (zero holders of the
  forty-five names on every public entry via `export-origins/`, the deletion
  probe, the in-package importer walk, the runtime namespace, the shards'
  absence, the ADR-0087 registration, the #15514 history kept, and a
  tree-scoped absence leg whose walk radius is DECLARED in
  `scripts/cross-package-test-inputs.mjs` / `turbo.json` — the playbook rule
  #15566 added after PR #15514); `esignature-deadline-keys-retirement.test.ts`
  (refusal pins asserting issue path, code and prescription on the base schema
  and through `Document.eSignature`; the tsc `never` channel; no-materialize
  pins for the two former defaults; the ADR-0087 registration); the thirteen
  isomorphism pins the three modules held leave `type-alias-convention.pin.test.ts`
- generated baselines and docs follow the schema: `json-schema.manifest/`
  loses nineteen keys (the manifest-deletion gate adjudicates whole-def
  removals against the merge base), `api-surface/`, `declaration-map/`,
  `export-origins/`, `authorable-surface/` and `authorable-defaults/` lose the
  families' rows, `authorable-surface/data.json` gains two `[RETIRED]` rows and
  `authorable-defaults/data.json` loses two, the three system reference pages
  are removed and `references/system/index.mdx`, `references/index.mdx` and
  `references/data/document.mdx` regenerated, `spec-changes.json` and the
  upgrade guide carry the four new registrations at the 18 cut
- hand-written docs: the `Change Management` row leaves
  `getting-started/quick-reference.mdx`
- zero authored occurrences in this repo's examples, skills and hand-written
  docs beyond that row, and zero hits in objectui at `a472b07`, so no sibling
  change and no pin bump ride along
