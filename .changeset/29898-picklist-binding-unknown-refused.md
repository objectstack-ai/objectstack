---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
---

fix(metadata-protocol)!: the metadata save and publish doors refuse a select field bound to a picklist no loaded package declares, instead of storing it and then refusing every write to the field (#29898)

Clause-②: no (narrowing) — the metadata save door (draft and live), the per-item and package publish, and the restore doors refuse an `object` or `object_extension` whose field names a picklist no loaded package declares, a body they accepted before. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: no move — `skills/**` teaches no picklist reference verdict and `content/docs/**` carries no severity table for it; the prescription ships in the refusal text, the FROM → TO below and the upgrade-guide entry.

<!-- adr-0087: registered picklist-binding-unknown-refused -->

**BREAKING** accept-set narrowing at the metadata save and publish doors: `PUT /api/v1/meta/object/NAME` and `PUT /api/v1/meta/object_extension/NAME` (draft and live), `POST /api/v1/packages/PKG/publish-drafts`, the per-item publish, and the rollback / revert restore doors.

- **Before.** A select (or multiselect) field with `picklist: 'nope_list'`, a name no loaded package declares, saved `200` with its draft reading `_diagnostics.valid: true`, and `publish-drafts` answered `outcome: published`. The field was then served with no options, and every create or update that set it answered `400 VALIDATION_FAILED` ("takes its values from picklist \"nope_list\", which no loaded package declares"). The boot and a late install already refuse the same shape for a package's own objects, and `os validate` / `os build` refuse it for a stack's own fields.
- **Now.** The doors refuse it `422 INVALID_METADATA`, one finding per unknown binding at `fields.FIELD.picklist`, naming the field and the list. A list is declared when the engine's registry resolves it, the same read that serves the field's options: the package's own, a dependency's, the base package's of a `.custom` pair, or any other package installed here.
- **Unchanged.** A binding the object already holds is not judged again on a re-save, so an object published before this release keeps saving; the stored-metadata healing pass (`os migrate meta --stored`) is not judged. A draft stored before this release is judged when it is published.
- **`@objectstack/spec`.** The upgrade guide entry `picklist-binding-unknown-refused` (a semantic migration: no automatic rewrite, because whether the author meant another list, one still to be declared or inline options is a judgement about the field).
- **`@objectstack/cli`.** A source comment in the `os validate` picklist judge no longer says the runtime write path is unjudged.

**FROM → TO.** `fields.t: { type: 'select', picklist: 'nope_list' }` → `picklist: 'NAME'` of a list a package installed here declares, or declare `nope_list` in a code package (a `*.picklist.ts` file, or `defineStack({ picklists })`), or `options: [...]` in place of `picklist`.
