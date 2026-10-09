---
'@objectstack/rest': minor
---

fix(rest)!: an anonymous public-form submit answers the created record's id, and nothing the insert stored

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime response narrowing at one REST door, not a metadata change: the anonymous public-form submit's `201` answer drops `object`, `record` and `droppedFields` and keeps `id`. No spec key, export, option, stored shape or authorable metadata is removed, renamed or re-shaped. The door's answer has no spec declaration: its route-ledger row names no response schema, and `CreateDataResponseSchema` types the protocol's `createData`, whose answer this diff leaves unchanged. So there is no tombstone, and nothing for `objectstack migrate meta` to rewrite. What a host that read the echo does instead is a runtime call, an authenticated read of the record by the answered id, which the body states. The other categories are closed on facts: `@objectstack/rest` publishes (not unpublished); no ADR-0087 id covers this door and this diff adds none (not registered / already-registered); and no published TypeScript interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (a response narrowing): this ships as `minor` under the launch-window convention for breaking changes.

`POST /api/v1/forms/:slug/submit` used to answer `201` with the protocol's whole create answer, `{ object, id, record, droppedFields? }`. The `record` was the row as stored after the insert pipeline. So the anonymous caller was shown every field it never sent: a `defaultValue`, a field a `beforeInsert` or `afterInsert` hook stamped, and a value a hook running elevated (`runAs: 'system'`) derived from existing records the caller's grant may never read. The form's field whitelist filtered what the caller could write. Nothing filtered what it was then shown.

The answer is now the created id alone:

```json
{ "id": "r7p8cUZoBJbFWudt" }
```

- **Still `201`**, as a bare JSON object with no envelope. The created id stays at the top-level `id`, where the console's public form page reads it, so its confirmation and `redirect` behaviors keep working.
- **What the submitter typed is not echoed back either.** The caller already holds it. On the console's `redirect` behavior, a `{{record.field_name}}` token over a submitted field still resolves from the submitted values, and `{{record.id}}` from the answer. A token over a field only the server fills in now resolves empty. That value is exactly what this change stops serving.
- **The write is unchanged**: the same whitelist, the same server-managed anchors stripped, the same grant, the same hooks. Only the answer shrank.

**If your host read the record off this answer**, read it through an authenticated read instead: `GET /api/v1/data/:object/:id` with the id from the answer, as a principal allowed to see that record.
