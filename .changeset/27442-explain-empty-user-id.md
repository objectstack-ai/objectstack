---
'@objectstack/rest': patch
'@objectstack/plugin-security': patch
---

fix(rest)!: `security/explain` refuses an explicit empty `userId` with 400 instead of explaining the caller (#27442)

Clause-②: no (narrowing) — `GET`/`POST /api/v1/security/explain` refuses a request whose `userId` is the empty string, which it answered before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the explain door refuses one request value, an empty userId, that it used to drop and answer as the caller. There is no authored or stored shape for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the access-explanation door (`@objectstack/rest`), held by the engine too (`@objectstack/plugin-security`).

- **Before.** `POST /api/v1/security/explain` with `"userId": ""` (or `GET …?userId=`) dropped the empty id and answered `200` with an explanation of the CALLER. A client that lost the selected user (an empty picker) got a confident answer about a principal nobody asked about.
- **Now.** The door answers `400 VALIDATION_FAILED`, in the same envelope as its other request refusals, and no explanation is computed. On `GET`, `?userId=` names the key, so it counts as explicit and is refused the same way.
- **Unchanged.** An omitted `userId` still explains the caller; a `userId` naming another user is explained, refused `403`, or refused `404 RECORD_NOT_FOUND` exactly as before.
- **Engine.** `explainAccessForCaller` no longer reads an empty `userId` as "the caller": it goes through the other-user arm, so a direct caller gets the `403` (no right to explain others) or the `404 RECORD_NOT_FOUND` an unknown id gets.

**The remedy.** Omit `userId` to explain your own access, or send the id of the user to explain.
