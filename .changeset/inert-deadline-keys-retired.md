---
"@objectstack/spec": minor
---

feat(spec): retire the fourteen inert deadline keys of the incident-response, training and change-management schemas (#14477, ADR-0049)

<!-- adr-0087: registered incident-response-deadline-keys-retired, training-deadline-keys-retired, change-management-duration-keys-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescriptions are
registered under protocol major 18, where `os migrate meta` users will look).
Maintainer ruling 2026-09-02 on the census card (ruled A: retire per family):
ADR-0049 enforce-or-remove decides it — declared-but-unenforced deadline
surface with zero measured readers comes off.

Fourteen hour/minute/day-shaped deadline, SLA and duration key sites — twelve
distinct names, because `durationMinutes` and `estimatedMinutes` each occur at
two sites — sat on the exported incident-response, training and
change-management schemas and in the generated reference docs, and **nothing
read them**: the schemas are exported from `@objectstack/spec/system`, mounted
by no stack key, registered as no metadata type, absent from the 2026-06
liveness ledgers, and the reader census over every package outside
`packages/spec` (tests and changelogs excluded) and over objectui at the
pinned sha returned zero hits for every key. An author could write
`triageDeadlineHours: 4`, `validityDays: 365` or `regulatorDeadlineHours: 72`
and reasonably expect the platform to escalate, expire or notify — it never
did, and it never said so. Six of the keys carried defaults (30 minutes,
1 hour, 2555 days; 365, 30 and 14 days) that were materialized into every
parsed document without ever being consulted. A compliance-shaped deadline
that fails silently is the worst form of the shape ADR-0049 names.

**What is refused:** authoring any of the keys below, with any value, on the
base schema and through every carrier that nests it (`Incident.responsePhases[]`,
`IncidentResponsePolicy.notificationMatrix`, `TrainingPlan.courses[]`,
`ChangeRequest.impact` / `.rollbackPlan` / `.implementation`). None of the
schemas is `.strict()`, so each key is a `retiredKey()` tombstone rather than a
bare deletion (a deletion would have stripped it in silence): authoring it is a
`tsc` error (`never`) and a parse error carrying the prescription
(`invalid_type` at the path of the key).

| schema | retired keys |
|:--|:--|
| `IncidentResponsePhase` | `targetHours` |
| `IncidentNotificationRule` | `withinMinutes`, `regulatorDeadlineHours` |
| `IncidentNotificationMatrix` | `escalationTimeoutMinutes` (default 30) |
| `IncidentResponsePolicy` | `triageDeadlineHours` (default 1), `retentionDays` (default 2555) |
| `TrainingCourse` | `durationMinutes`, `validityDays` |
| `TrainingPlan` | `recertificationIntervalDays` (default 365), `gracePeriodDays` (default 30), `reminderDaysBefore` (default 14) |
| `ChangeImpact` | `downtime.durationMinutes` |
| `RollbackPlan` | `steps[].estimatedMinutes` |
| `ChangeRequest` | `implementation.steps[].estimatedMinutes` |

**What stays, byte-identical:** every other key of the three families with its
default and its (absent) readers, and every export — no def leaves the public
surface. Parsed documents no longer carry the six former defaults.

**Held, not touched:** the `ESignatureConfig` pair (`expirationDays`,
`reminderDays` in `data/document.zod.ts`) — the ruling left that branch open
pending the e-signature roadmap answer; it stays on the card.

## FROM → TO

```ts
// before — parsed green; no engine ever read a single one of these numbers
const policy: IncidentResponsePolicy = {
  notificationMatrix: {
    rules: [{ severity: 'critical', channels: ['pagerduty'], recipients: ['security_team'],
              withinMinutes: 15, notifyRegulators: true, regulatorDeadlineHours: 72 }],
    escalationTimeoutMinutes: 45,
  },
  defaultResponseTeam: 'security_team',
  triageDeadlineHours: 2,
  retentionDays: 3650,
};
const course: TrainingCourse = {
  id: 'COURSE-SEC-001', title: 'Security Fundamentals', description: '…',
  category: 'security_awareness', targetRoles: ['all_employees'],
  durationMinutes: 60, validityDays: 365,
};
const rollback: RollbackPlan = {
  description: 'Restore from backup',
  steps: [{ order: 1, description: 'Restore backup', estimatedMinutes: 15 }],
};

// after — delete the keys; there is no replacement because no incident-response,
// training-management or change-management engine exists to keep a deadline.
// Record retention is the object-level `lifecycle` block (ADR-0057), declared on
// the object that stores the records.
const policy: IncidentResponsePolicy = {
  notificationMatrix: {
    rules: [{ severity: 'critical', channels: ['pagerduty'], recipients: ['security_team'],
              notifyRegulators: true }],
  },
  defaultResponseTeam: 'security_team',
};
const course: TrainingCourse = {
  id: 'COURSE-SEC-001', title: 'Security Fundamentals', description: '…',
  category: 'security_awareness', targetRoles: ['all_employees'],
};
const rollback: RollbackPlan = {
  description: 'Restore from backup',
  steps: [{ order: 1, description: 'Restore backup' }],
};
```

One-line fix: delete the key wherever it is authored. There is no
`os migrate meta` edit list for these keys — none of the schemas is a stack
collection member, so the conversion chain has no seam to walk (the
`MetadataPluginConfig.additionalTypes` precedent); the tombstone prescription
and the protocol-18 upgrade guide are the channels.

The retirement kit:

- `retiredKey()` tombstones at all fourteen sites (`packages/spec/src/system/
  incident-response.zod.ts`, `training.zod.ts`, `change-management.zod.ts`;
  each file's section comment records what the shape was and why no D2
  conversion exists)
- ADR-0087 registration: fourteen `RETIRED_KEYS_BY_MAJOR[18]` entries (the
  three nested change-management sites spelled `ChangeImpact:downtime.durationMinutes`,
  `RollbackPlan:steps.estimatedMinutes`, `ChangeRequest:implementation.steps.estimatedMinutes`)
  and three D3 semantic entries, one per family
- no liveness-ledger row: none of the three families is an enrolled ledger
  type, so there is no row to keep or drop
- pin tests (`deadline-keys-retirement.test.ts`): a refusal pin per site
  asserting the issue path, code and prescription on the base schema and
  through the nesting carriers; the tsc `never` channel; no-materialize pins
  for the six former defaults; the ADR-0087 registration; and a tree-scoped
  absence pin over every authored source in the repo
- generated baselines and docs follow the schema: `authorable-surface/` gains
  eleven `[RETIRED]` rows, `authorable-defaults/` loses six rows, the three
  system reference pages are regenerated, and the gitignored `json-schema/`
  output is re-emitted on the next build
- `json-schema.manifest/` is unchanged, and correctly so: it ratchets def
  *names*, and retiring keys removes no def from the published surface
- `spec-changes.json` and the protocol upgrade guide are unchanged too: both
  project the migration chain at the current protocol major (17), so these
  protocol-18 registrations reach them at the 18 cut
- zero authored occurrences in this repo's examples, skills and hand-written
  docs, and zero hits in objectui at the pinned sha, so no in-repo source
  changes ride along beyond the three families' own unit tests
