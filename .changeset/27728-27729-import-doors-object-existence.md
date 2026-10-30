---
'@objectstack/rest': patch
---

fix(rest)!: both import doors answer for the object as the data door does — the synchronous import refuses an unregistered object 404, and a legacy short name is the object behind it at every door (#27728, #27729)

Clause-②: no (narrowing) — `POST /data/:object/import` no longer answers 200 for an unregistered object or an object of a disabled package; it answers the data door's 404. No value, key or shape is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: two already-published refusals (404 OBJECT_NOT_FOUND, 404 OBJECT_PACKAGE_DISABLED) are now answered up front by one more door, and the exposure gate judges the object a short name resolves to. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** the synchronous import door refuses what it used to accept with a 200 (`@objectstack/rest`), per triage 6509235875 (#27728) and 6509225810 (#27729).

- **Before.** `POST /data/:object/import` ran no existence check. For a name with no object behind it, it answered 200 and repeated `OBJECT_NOT_FOUND` inside every row's result; for an object of a disabled package it did the same with `OBJECT_PACKAGE_DISABLED`. An importer that reads the status saw success.
- **Now.** It answers the data door's own refusal for the name, status and body: 404 `OBJECT_NOT_FOUND`, or 404 `OBJECT_PACKAGE_DISABLED`. It is asked after the API-exposure gate (so a hidden object keeps its 404 and the door is no existence oracle) and before the body is parsed, so nothing is written, dry run included. The async job door (`POST /data/:object/import/jobs`) already refused both; its disabled-package refusal is now pinned with zero job rows.
- **One read for existence and exposure.** A legacy `ns__short` object addressed by its short name is the object behind that name at every door, as `registry.getObject` resolves it for the data door. The async job door used to refuse such a name `OBJECT_NOT_FOUND` while the data door served it; it now creates the job. The API-exposure gate used to treat such a name as "no object" and pass it on, so an `ns__short` object with `enable.apiEnabled: false` or an `enable.apiMethods` list was served under its short name; the gate now judges that object's `enable` and refuses the same way it refuses the full name. No shipped object carries a `__` name.
- **Who sees it.** A client that imports into a misspelled or unregistered object name, or into an object of a disabled package, now gets a 404 instead of a 200 with per-row errors.

**The remedy.** Import into a registered object name (or re-enable the package). A client that already read the per-row `OBJECT_NOT_FOUND` should read the response status and `code` instead.
