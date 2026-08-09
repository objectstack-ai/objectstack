---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol): refuse an org-scoped write of a type that has no per-org channel (#6190)

`allowOrgOverride` and `allowRuntimeCreate` are orthogonal tiers, and the
runtime-create tier never consulted the ORG dimension:
`SysMetadataRepository.put` stamps `organization_id` on the row whatever the
type is. So a Studio-authored item of an `allowOrgOverride: false` type
persisted a per-org row the platform can never read back — `loadMetaFromDb`
loads env-wide rows only. The write path was strictly more permissive than the
read path, and the row was lost at the next restart with no log line.

Measured consequences, both silent before this change:

- **`flow`** binds its triggers for the life of the process that wrote it, then
  stops firing after the next restart.
- **`object`** is worse and fails CLOSED: absent from the registry after boot
  while its physical table still holds the data, so every record in it answers
  404 `OBJECT_NOT_FOUND`.

`saveMetaItem` (draft and publish modes) and the draft→active promotion
(`publishMetaItem`, `publishPackageDrafts`) now refuse such a write with 403
`NOT_OVERRIDABLE` before anything is persisted, naming the organization, the
flag that produced the verdict, the consequence, and the two legitimate
alternatives (save it env-wide, or ship the per-org variant as its own
deployment — ADR-0005: "Per-org variants are a deployment, not an overlay").

**Which types change behaviour.** The predicate is derived from
`DEFAULT_METADATA_TYPE_REGISTRY`, never a hand-written list: 18 of its 27
entries declare `allowOrgOverride: false` with `allowRuntimeCreate: true` —
`object`, `field`, `hook`, `seed`, `mapping`, `page`, `app`, `action`,
`dataset`, `flow`, `datasource`, `external_catalog`, `doc`, `book`,
`permission`, `position`, `tool`, `skill`. (`api` was the 19th when the ruling
was made; #5488 has since withdrawn its runtime-create door entirely, so it is
refused as code-only before this gate is consulted.) Unaffected: `view`,
`dashboard`, `report`, `translation`, `email_template` (they have a per-org
channel and their org rows are read back on demand), plus plugin types with no
static registry entry, which keep today's behaviour. Env-wide writes of every
type are unchanged.

`OS_METADATA_WRITABLE` deliberately does **not** unlock the org dimension: it
unlocks the write, not the read, so honouring it here would re-open the phantom
in exactly the deployments most likely to have one.

**No data migration is included.** Per the maintainer ruling, rows written
before this gate are residue handled non-destructively — made audible by the
cold-boot warning and disposed of operationally. They are not rewritten or
deleted, and `migrateStoredMetadata` now reports them instead of rewriting
them, which makes that pass a second residue detector.
