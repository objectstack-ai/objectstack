---
'@objectstack/spec': minor
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/client': patch
'@object-ui/permissions': patch
'@object-ui/plugin-list': patch
---

feat: the list toolbar offers the "In a queue" toggle only on objects that actually use queues

Clause-②: yes (widening)
Metadata-protocol: added

Until now the toggle appeared on every list of an object with a user owner as soon as the organization had a single queue, although on most of those objects no record ever sits in a queue, so it could only return an empty list. It now appears only on an object where a queue can hold something:

- a record of the object sits in a queue now (no owner, a queue set), or
- an active assignment rule routes the object's new records into a queue: one of the organization's own rules, or a rule an installed package declares that is not switched off.

Nothing is authored for this. The server works it out from the rules and the records.

`GET /auth/me/permissions` carries the answer as a new field beside `hasAnyQueue`: `objectsUsingQueues`, a list of object names, declared in `MePermissionsAuthenticatedResponseSchema`. It names only objects the caller may read, and never a queue name or a count. It is empty when the organization has no queue, when no ownership-queue service is registered, and on the closed body. The ownership-queue service contract gains the optional method `objectsUsingQueues(organizationId)`, implemented by `@objectstack/plugin-sharing`. The method checks each owned object for one sitting record (`limit 1`) and reads the routing rules once. The route asks only when `hasAnyQueue` is true, so an organization with no queue pays nothing extra.

**Migration.** `objectsUsingQueues` is required on the strict `MePermissionsAuthenticatedResponseSchema`. Code that builds a `MePermissionsAuthenticatedResponse` (a test fixture, a stub server) adds `objectsUsingQueues: []` beside `hasAnyQueue`. Code that parses a body from a server older than this release with the schema gets a parse failure for the missing key: parse with `.partial({ objectsUsingQueues: true })` or default it to `[]` until the server is upgraded. The console does not parse; it reads the field and treats its absence as "no object".

The console reads the field from the payload it already loads once per session. A record that starts sitting in a queue on an object not listed yet shows the toggle from the next time the permissions are read. An answer without the field is treated as "no", the same way an unknown `hasAnyQueue` is.
