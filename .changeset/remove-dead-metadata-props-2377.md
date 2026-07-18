---
"@objectstack/spec": minor
---

feat(spec)!: remove dead author-facing metadata properties (#2377, ADR-0049 enforce-or-remove)

Breaking spec-surface removal, versioned as `minor` per the launch-window changeset
policy (a `major` would promote the whole fixed-group monorepo; breaking cleanups ride
the minor line, as with #2402 → 11.1.0).

Removes a batch of spec properties that parsed but had **no runtime consumer** —
authoring them was a false affordance (especially dangerous for AI-authored
metadata). Verified dead against the liveness ledger (`packages/spec/liveness/*.json`)
and a repo-wide grep of readers. This is the follow-up slice to #2402.

## Removed (each was `dead` + no reader anywhere)

- **field** (`field.zod.ts`): `vectorConfig` (+ `VectorConfigSchema` + types),
  `fileAttachmentConfig` (+ `FileAttachmentConfigSchema` + types), `dependencies`.
  Vector fields keep the live flat `dimensions` prop; file/image fields keep the
  live flat `multiple`/`accept`/`maxSize` siblings.
- **object** (`object.zod.ts`): `versioning` (+ `VersioningConfigSchema`),
  `softDelete` (+ `SoftDeleteConfigSchema`), `search` (+ `SearchConfigSchema`),
  `recordName`, `keyPrefix`. Each is now a **rejecting tombstone** in
  `UNKNOWN_KEY_GUIDANCE` carrying the upgrade prescription.
- **action** (`action.zod.ts`): `timeout` (server uses `body.timeoutMs`; no
  action-level timeout is enforced).
- **agent** (`agent.zod.ts`): `planning.strategy`, `planning.allowReplan`
  (only `planning.maxIterations` is read by the runtime).
- **dataset** (`dataset.zod.ts`): `measures.certified` (declared-but-unenforced
  governance flag — never compiled into the Cube).

Liveness ledgers, the ledger README table, and `api-surface.json` are updated;
the removed sub-schema keys are dropped from `json-schema.manifest.json`.

## Migration

- **field/agent/dataset/action props**: authoring them is now silently stripped
  (they never did anything). Remove them. Vector → set flat `dimensions`;
  file/image → set flat `multiple`/`accept`/`maxSize`.
- **object props**: `ObjectSchema.create()` now throws a located error naming the
  replacement — `versioning`/`softDelete` → hard deletes + `Field.trackHistory` /
  `lifecycle`; `search` → `searchableFields`; `recordName` → an `autonumber`
  `Field` designated as `nameField`; `keyPrefix` → remove (never had an effect).

## Deliberately NOT removed (dead, but entangled — a scoped follow-up)

`field.index`/`columnName`/`referenceFilters` and object
`tags`/`active`/`isSystem`/`abstract`/`enable.searchable`/`enable.trash`/`enable.mru`
and `agent.tenantId` are surfaced in the Studio metadata-authoring forms
(`*.form.ts`) — removing them cascades into i18n bundle regeneration, so they are
deferred. `action.type:'form'` has a dedicated build-time lint (`lint-view-refs.ts`)
and a first-party showcase usage, so it needs a UX decision. `field.columnName`
additionally has an ADR-0062 D7 lint. These stay `dead` + `authorWarn` in the
ledgers.
