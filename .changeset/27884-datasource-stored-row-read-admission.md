---
'@objectstack/metadata-core': patch
'@objectstack/objectql': patch
'@objectstack/rest': patch
---

fix(objectql,rest,metadata-core)!: a datasource definition's stored row is served only to datasource administrators, whichever exit reads it (#27884)

Clause-②: no (narrowing for readers below datasource administration)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no metadata an author writes changes meaning: a stored datasource definition is written, stored and served to its administrators exactly as before. What narrows is which readers a stored row of a capability-gated type is served to. There is nothing for a migration to rewrite and no tombstone; a reader who needs the definition is granted the capability. -->

**BREAKING** read-set narrowing for callers below datasource administration. The metadata read door already served a `datasource` or `external_catalog` definition only to holders of `manage_platform_settings`, the capability the datasource family's own door requires. The stored row each definition lives in now admits the same readers, so one document admits one set of callers at every exit.

- **One row.** The type-to-capability table moves to `@objectstack/metadata-core` as `STORED_METADATA_TYPE_READ_CAPABILITIES`, with `storedMetadataTypesWithheldFrom(caller)` and `isCapabilityGatedStoredMetadataType(type)`. `@objectstack/rest` keeps exporting `META_TYPE_READ_CAPABILITIES`, now that same frozen object, and the metadata read door answers exactly as before.
- **Now.** A caller-context read of a stored metadata row of a listed type, by a caller without the type's capability, is served no row: a list or count leaves it out, and a read of its id answers as a read of a row that does not exist. Holders of the capability, platform administrators among them, are served everything as before. System reads are unchanged.
- **Events.** A record-change event of such a row carries no metadata body to any subscriber; the row's other columns are unchanged.
- **Who sees it.** A reader below datasource administration is no longer served stored datasource or federation-catalog rows.

**The remedy.** Grant `manage_platform_settings` to a caller that needs a datasource definition, or read it through the datasource admin door (`GET /api/v1/datasources/:name`) as such a caller.
