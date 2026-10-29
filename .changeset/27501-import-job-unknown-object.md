---
'@objectstack/rest': patch
---

fix(rest)!: an async import job for an unregistered object is refused with 404 `OBJECT_NOT_FOUND` before any job is created (#27501)

Clause-②: no (narrowing) — `POST /data/:object/import/jobs` now refuses an object name the runtime does not register, where it used to answer `201` and persist a job. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: one REST door now refuses, up front, an object name that every row of its job was already refused for. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at one REST data door (`@objectstack/rest`).

- **Before.** `POST /data/no_such_object/import/jobs` answered `201` with a job id and persisted a `sys_import_job` row. The job then ran, every row failed with `OBJECT_NOT_FOUND`, and the job read `succeeded`.
- **Now.** The door answers `404` with `error.code: 'OBJECT_NOT_FOUND'`, the same envelope `POST /data/no_such_object` answers, before the body is parsed. No job row is written and no worker runs.
- **Unchanged.** A registered object gets `201` and a job exactly as before. A job whose rows partly fail still ends `succeeded`, as before.
- **Who sees it.** An import client that sends an object name nothing is behind, for example a typo. Such a request used to look accepted while it could import nothing.
- **Also refused up front.** An object of a disabled package now gets the data door's `404 OBJECT_PACKAGE_DISABLED` instead of a job (re-enable the package). A legacy `ns__short` object addressed by its short name alone gets `404 OBJECT_NOT_FOUND`, because the door counts an object only under its own name, as the API-exposure gate does (send the full registered name).

**The remedy.** Send the object's registered name, the one `POST /data/:object` accepts.
