---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/objectql': minor
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@object-ui/types': minor
---

feat(spec)!: one-way sync-in, the spec half: a datasource source, paging and delete policy keys, the refusals a pull needs, and the `managedBy: 'synced'` bucket with every guard that enforces it (ADR-0153)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered sourced-mapping-upserts-into-synced-object, sync-field-prefix-reserved -->

**BREAKING** accept-set narrowing on `data.Mapping` and `data.Object`, beside four new mapping keys the pull engine reads in a later release.

- **New keys, declared ahead of the engine that reads them.** `datasourceSource: { object, watermark: { field, start }, full?, deletePolicy?, deletedField? }`, a sibling of `connectorSource` that names a federated object of the stack to copy from; and on `connectorSource`, `paging: { style: 'page' | 'cursor' | 'offset' | 'none', param?, nextPath? }`, `deletePolicy: 'mark' | 'ignore'` and `deletedField`. `deletePolicy` has no schema default: its absence reads as `mark`. Each is a `planned` row of the liveness ledger that warns its author until the pull reads it. `job.pull` accepts a mapping with either source.
- **A sourced mapping is refused unless it can be pulled honestly.** At parse: one source at most; `mode: 'upsert'` with a non-empty `upsertKey`; `paging` states the parameter its style needs (and `none` states none). At `defineStack`: the `targetObject` is declared `managedBy: 'synced'`; a `datasourceSource.object` is an object of the stack with an `external` binding; its `external.columnMap` maps a remote column onto `id` (`source_key_missing`); that key is a string or an integer of at most 15 digits of precision (`source_key_not_exact`); `watermark.field` is a `datetime`, `date` or integer field (`watermark_not_exact` when an integer one is not exact); and a `fieldMapping` entry copies it unchanged onto a target field of its type (`watermark_field_unmapped`).
- **`managedBy: 'synced'`.** The bucket of a pulled copy: the `engine-owned` affordance row (reads and CSV export only), and `userActions` cannot open a write verb on it, a named exception to ADR-0103 D1, refused at parse and closed by `resolveCrudAffordances`. The engine write guard refuses a member's generic write (403), the `apiMethods` reconciliation strips every write method, the `/me/permissions` clamp answers the closed row, both platform-internal bucket mirrors take it, and the UI bucket union names it. `ObjectQL.outlivesOrganization` does not take it: an organization that still owns synced rows is refused deletion as before.
- **`_sync_` is reserved.** A field key starting with `_sync_` is refused on any object and in an object extension; `fieldPatches` is unchanged.
- **Lint.** `security-owd-unset` on a synced object recommends `sharingModel: 'public_read'` (a pulled row has no person owner), or `'private'` with a sharing rule that grants read.
- **Guidance.** A connector-side `deleteMode` is pointed at `deletePolicy`.

## Before and after

```ts
// before: parsed green; now refused at mode, upsertKey and (at defineStack) targetObject
mappings: [{ name: 'orders_pull', targetObject: 'order',
  fieldMapping: [{ source: 'id', target: 'external_id' }],
  connectorSource: { connector: 'orders_api', action: 'request' } }],
objects: [{ name: 'order', label: 'Order', fields: { external_id: { type: 'text' } } }],

// after
mappings: [{ name: 'orders_pull', targetObject: 'order', mode: 'upsert', upsertKey: ['external_id'],
  fieldMapping: [{ source: 'id', target: 'external_id' }],
  connectorSource: { connector: 'orders_api', action: 'request' } }],
objects: [{ name: 'order', label: 'Order', managedBy: 'synced', sharingModel: 'public_read',
  fields: { external_id: { type: 'text' } } }],
```

A field named `_sync_…` is renamed outside the prefix (`synced_at`, `source_id`), its stored column with it; a `userActions` entry opening a write on a synced object is removed. There is no automatic rewrite: the key column and the field names are the author's choice. The upgrade guide entries are `sourced-mapping-upserts-into-synced-object` and `sync-field-prefix-reserved`.
