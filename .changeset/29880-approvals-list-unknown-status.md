---
'@objectstack/rest': patch
---

fix(rest)!: the approvals request list refuses a status value no approval request can have, and reads a comma list of statuses as a list

Clause-②: yes (narrowing) — `GET /api/v1/approvals/requests` (and its environment-scoped twin) refuses a `status` value outside the set `sys_approval_request.status` declares (`pending`, `approved`, `rejected`, `recalled`, `returned`, `cancelled`) with `400 VALIDATION_ERROR`, where it answered `200 {"data":[]}`. An empty value or an empty comma entry is refused too. The widening half: a comma list of declared statuses now filters on all of them, where it matched no row.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: the route keeps its parameter names and the approval service contract keeps its shape. What moves is the answer to a query-string value, and nothing at rest records that answer, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the approvals request list (`@objectstack/rest`): a `status` value that is not a declared approval status is refused instead of answering an empty list.

- **Before.** `?status=bogus`, `?status=Pending` or `?status=waiting` answered `200 {"data":[]}`, which reads the same as "no request is in that status", so an integration polling the inbox with a misspelt status skipped every pending approval in silence. `?status=pending,returned`, the spelling `@objectstack/client`'s `approvals.listRequests({ status: [...] })` sends for an array, was read as one status and answered the same empty list. `?status=` filtered on nothing and answered every status.
- **Now.** Each comma-separated entry must be a declared status, spelt exactly. Otherwise the request is refused with `400` and the nested `{ "error": { "code": "VALIDATION_ERROR", "message" } }` body the route already answers for an unknown or repeated parameter name; the message names the bad value and the allowed values, and the approval service is not asked. One declared status filters as before. Several filter on any of them (the service's `$in` push-down), and `total` counts on the same filter. A declared status with no rows still answers `200 {"data":[]}`.
- **Who moves.** The console and the client SDK send declared statuses only. A script that sends another spelling, or an empty `status=`, gets the 400.

**The remedy.** Send one of `pending`, `approved`, `rejected`, `recalled`, `returned`, `cancelled` (lower case), or several separated by commas. To list every status, leave `status` out.
