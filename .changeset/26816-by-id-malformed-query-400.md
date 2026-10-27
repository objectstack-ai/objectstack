---
'@objectstack/rest': patch
---

fix(rest): `GET /api/v1/data/:object/:id` answers a malformed query `400`, not `404`

Clause-②: no
Metadata-protocol: none

The by-id route answered every refusal in the `400` band as `404`, so a malformed query on a record that exists read as "no such record": `?select=nope` and `?expand=nope` answered `404 INVALID_FIELD`, and a blank `?select=` (or `?select=,`) answered `404 VALIDATION_ERROR`. A client, or an AI agent, told `404` concludes the record is missing and stops, when the fault is its own query string. The runtime dispatcher's twin route already answered the same requests `400`.

The route now answers the mapped status, as every other Data API route does. The body is unchanged: the same `code`, `error`, `field` and `object` the `404` carried.

What still answers `404 RECORD_NOT_FOUND`, unchanged: an id that names no record, and a record the caller's row scope hides. Those two are the same answer by construction (a read that returns no row), and neither ever went through the rewrite. A `400` does not reveal whether a record exists: each one is raised before the record is read, so it is the same for any id.
