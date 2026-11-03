---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

fix(metadata-protocol)!: an object saved back from a translated `/meta` read stores its source labels, and an object the registry would refuse is refused at save and at publish, never reported published (#29673)

Clause-②: no (narrowing) — the object save door (`saveMetaItem`, draft and live) refuses `422 INVALID_METADATA` an object declaring its own `queue` field on a user-owned object (ADR-0142 D3), which it stored before and the registry then refused to register; the publish promote refuses such a draft the same way. A label equal to what the `/meta` read serves for its source in some locale is stored as the source text. Nothing is widened.
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-data/SKILL.md` (Ownership queues) already teaches that an object declaring its own `queue` field is refused, which stays true and is now said at save; no file under `skills/**` teaches saving a translated read back.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The refusal at save is the registry's own, moved forward to the door that stores the body; a row stored before this rule already never registered. A stored row carrying a translated injected column is repaired by `os migrate meta --stored`, which re-saves it through the same door: no ledger entry and no tombstone. -->

**BREAKING** accept-set narrowing at the object save door (`@objectstack/metadata-protocol`), served by `PUT /api/v1/meta/object/:name` (draft and live) and `POST /api/v1/packages/:id/publish-drafts`.

- **Before.** A `/meta` read in a non-English locale serves each injected system column with a translated label (`queue` → `队列`, `owner_id` → `负责人`). Studio saves the whole body it read, so the save stored those columns back as the author's own fields. For `queue` the registry then refused the object at publish, the refusal went to a log line, and `publish-drafts` answered `outcome: 'published'` while the object's data door answered 404. For `owner_id` and the other columns, every other locale was served the Chinese label.
- **Now.**
  - The save door puts a slot back to its source text when the incoming value differs from the source and equals what the read's translator makes of that source in some locale, translating with the read's own options (a packaged object's overlay slot that diverged from the packaged text is served untranslated, so it is no translation's source). The source is the stored row the save overwrites, then the platform's own definition of an injected column. The strip that follows then removes the platform's columns as it always did. Slots: an object's `label`, `pluralLabel` and `description`; a field's `label`, `description`, `inlineHelpText` and `inlineTitle`; an option's `label`.
  - The save door asks the registry whether it would register the object, judging the body alone, and refuses what it would not, in both modes. The publish promote asks again, before anything is promoted, so a draft stored before this rule is refused and not reported published. The only refusal this makes new at the door is an author's own `queue`; a field `type` the registry refuses was already refused at save by the object schema. The record-currency `summary` door is left to the registration, since it judges the body against the other objects as they stand and a sibling in the same batch can change that answer either way.
  - `os migrate meta --stored` reports a stored object row carrying a translated label as `translated-label-echo` and, with `--apply`, re-saves it through the save door.
- **Unchanged.** A label that is not a translation of its source is the author's edit and is kept. A field the source does not declare is not compared. An English body is stored as before.
- **The edge.** An author who types exactly the translation of a label's source in some locale gets the source back; a reader in that locale is served the translation anyway.
- **New export.** `BUILTIN_SYSTEM_FIELD_LABEL_LOCALES` (`@objectstack/spec/system`): the locales the built-in system-field label table answers in, with no bundle. `SchemaRegistry.objectRegistrationRefusal` (`@objectstack/objectql`) answers the refusal `registerObject` would throw, without registering anything.
