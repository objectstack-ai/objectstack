---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a keyed seed whose `externalId` names no field of its object is refused at save and at publish, and the boot loader warns once for a keyed dataset whose every record keys empty (#28952)

Clause-②: no (narrowing) — the metadata save door (`saveMetaItem`, draft and publish mode), the publish promotion (`publishMetaItem`, `publishPackageDrafts`) and the restore doors refuse a `seed` in `upsert`, `update` or `ignore` mode whose `externalId` (each member of a composite; an undeclared one is the default `name`) is not a field of the seed's object, which they stored and published before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the save and publish doors now judge an existing key, `externalId`, against the seed's object. A seed that names a field its object has saves as before; the fix for a refused one is to name a field the object declares, which no migration can choose for the author. -->

**BREAKING** accept-set narrowing at the metadata save and publish doors (`@objectstack/metadata-protocol`).

- **Before.** A seed with `mode: 'upsert'` and `externalId: 'no_such_field'` was saved (`_diagnostics.valid: true`) and published. The loader keys every existing row and every incoming record on that field, which none of them carries, so every key was empty and nothing matched: each publish answered `seedApplied {"success":true,"inserted":1,"updated":0}` and inserted every record again, with no probe issue and no log line.
- **Now.** The save is refused with the save door's envelope for a body it judges (the one an object naming an unknown datasource gets), `422 INVALID_METADATA`, one finding per missing member at `externalId` (`externalId.N` for a composite member), naming the field and the object; nothing is stored. A seed draft stored before this change, or one whose object was still a draft at its save, is refused when it is published, before any seed row is written, and a package publish aborts on it. An object drafted in the same package batch is judged as it will be published.
- **What counts as a field.** The object's fields as the engine registers them (extension fields included) and the columns the registry injects (`id`, the audit and tenant columns).
- **Not judged.** `insert` and `replace` seeds, which never match by key; a draft seed whose object is itself still a draft (judged at its publish); a seed whose object is neither registered nor drafted (the load reports it); a `migrate-stored` re-save.
- **The boot loader never refuses.** For a keyed dataset whose every record has no value for the key, it now logs one `warn` naming the object and the key, and loads exactly as before: a replay of such a stored seed still inserts every record again (`upsert`, `ignore`) or skips it (`update`).
- **Who sees it.** A package author whose seed key names a field the object does not have (a typo, or a field since renamed). Measured: no seed shipped in this repository's examples or in hotcrm names such a key.

**The remedy.** Set `externalId` to a field the object declares, or use `mode: 'insert'` for rows with no natural key.
