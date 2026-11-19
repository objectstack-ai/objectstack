---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a seed record that leaves a key field blank is refused at load instead of being inserted again on every load

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-data/references/seeds.md (:48 the externalId row, :68 the composite key, :93 `externalId` selection: none says a record must carry every key field or is refused at load)

<!-- adr-0087: registered seed-key-blank-record-refused -->

**BREAKING** for a seed record whose `externalId` value is blank. A seed is replayed on every single-tenant boot, every package install or upgrade and every publish, and each replay matches records to the rows earlier loads wrote by the dataset's `externalId`. A record that left a key field blank (no value, `null` or `''`): any component of a composite key such as `['team', 'project']`, or the one field of a single-field key (`name` when the dataset names none), matched no row and was written again by every `ignore` or `upsert` load, with nothing said. Measured over three loads of one such record beside a keyed one: 2, then 3, then 4 rows. An `update` load skipped it, also in silence.

- FROM: the record was written as a new row on every load (`ignore`, `upsert`) or skipped (`update`); when every record of a dataset keyed empty, the load logged one dataset-level `warn` and still wrote each record again.
- TO: in the keyed modes (`ignore`, `upsert`, `update`) the load refuses the record before anything of it is written: the load result carries one error for it naming the object, the record index, the blank field(s) and the fix, the boot log says it once per dataset at `error`, and every other record and dataset loads. A dry run (`validate`) reports the same error. A dataset whose every record keys empty is the same refusal for each record; the dataset-level `warn` is gone, since it would report the same records twice.
- The fix for an author: give the record a value for the blank key field, or key the dataset on fields every record carries: a field the object declares, a list of fields when no single field names a row, or `'id'` when the records carry their own ids.

**Not moved.** The check reads the key as authored, after the record's expressions resolve and before any reference resolves. A reference the load defers or cannot resolve yet (a person who has not signed up) is authored, so it is not blank and its row lands and holds one row across loads, as before. A whitespace-only value is a value, as before. Rows earlier loads duplicated are data and stay; remove the extra copies yourself if they matter. A request built without the parse's defaults (no `mode` on the dataset, no `defaultMode` on the config) is not keyed and is unchanged.

**Also: the duplicate-fallback refusal names the cause that still arises.** When the datasets being seeded mark more than one set of one object `fallback: true`, the refusal and the seed-data page no longer name "an upgrade within this process" as a cause: an upgrade now replaces a package's datasets on the replay list, so the cause left is two packages marking the same object. Wording only; what is refused is unchanged.
