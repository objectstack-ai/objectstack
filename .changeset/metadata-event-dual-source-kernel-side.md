---
"@objectstack/spec": major
---

feat(spec)!: `@objectstack/spec/kernel` no longer exports `MetadataEvent(Schema)` / `MetadataBulkRegisterRequest(Schema)` — the bare names belong to `./api` alone (#4587)

The names `MetadataEvent` / `MetadataEventSchema` /
`MetadataBulkRegisterRequestSchema` resolved to **two different declarations**
depending on the import path (`./api` vs `./kernel`) — the #4411 dual-source
trap. Resolution (three-repo, import-statement-level consumer scan: framework,
cloud, objectui — the `./kernel` copies had zero importers outside their own
unit test):

- **Removed** `MetadataEventSchema` / `MetadataEvent` from
  `@objectstack/spec/kernel`. This was a lifecycle-event envelope
  (`event: 'metadata.registered' | … | 'metadata.exported'`, plus
  `actor`/`payload`/`namespace`) that **nothing ever emitted or consumed** —
  the vocabulary appears in no producer in any of the three repos. The live
  contract is `./api`'s `MetadataEvent(Schema)`
  (`type: 'metadata.{type}.{created|updated|deleted}'`, with `id` / `definition`
  / `userId`): `MetadataManager` publishes those events to the realtime
  service and `@objectstack/client` / `@objectstack/client-react` subscribe to
  them.
  - FROM `import { MetadataEvent } from '@objectstack/spec/kernel'` →
    TO `import type { MetadataEvent } from '@objectstack/spec/api'`.
    **Shape change**: the api event has `id` (uuid), `type`
    (`metadata.{type}.{created|updated|deleted}`), `definition`, `userId`; the
    removed kernel shape's `event` / `actor` / `payload` / `namespace` fields
    do not exist there. If you needed runtime *watch* events, that contract is
    `MetadataWatchEvent` in `@objectstack/spec/system`; repository change-log
    events are `MetadataEvent` from `@objectstack/metadata-core` (ADR-0008) —
    a third, unrelated declaration that is not part of `@objectstack/spec`.
- **Removed** `MetadataBulkRegisterRequestSchema` /
  `MetadataBulkRegisterRequest` from `@objectstack/spec/kernel`. It was a dead
  near-duplicate of the REST contract that also diverged from the enforced
  write path: its per-item `namespace` field exists neither in
  `IMetadataService.bulkRegister` (contracts) nor in
  `MetadataManager.bulkRegister`, and `namespace` is deprecated platform-wide.
  - FROM `import { MetadataBulkRegisterRequestSchema, MetadataBulkRegisterRequest } from '@objectstack/spec/kernel'` →
    TO `import { MetadataBulkRegisterRequestSchema, type MetadataBulkRegisterRequest } from '@objectstack/spec/api'`
    (the `POST /api/meta/bulk/register` contract; the type export is new on
    `./api` in this release). **Shape change**: items are strictly
    `{ type, name, data }` — a per-item `namespace` no longer parses into the
    accepted shape. `MetadataBulkRegisterRequest` is the authoring-side type
    (`z.input`): `continueOnError` / `validate` stay optional and carry
    defaults, as before.
- `@objectstack/spec/api`'s `MetadataEvent(Schema)` and
  `MetadataBulkRegisterRequestSchema` are **unchanged** and are now the sole
  owners of the bare names. Imports from `./api` need no migration.
- `@objectstack/spec/kernel`'s `MetadataBulkResultSchema` /
  `MetadataBulkResult` are **unchanged** — only the bulk *register request*
  pair moved.

`dual-source-exports.baseline.json` shrinks by exactly these 3 rows (31 → 28,
#4535 C2).
