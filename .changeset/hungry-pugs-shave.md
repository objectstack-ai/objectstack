---
'@objectstack/plugin-security': patch
'@objectstack/metadata-protocol': patch
---

`DELETE /api/v1/data/sys_permission_set/{id}` stops reporting a deletion it did not perform.

A package-declared permission set cannot be deleted from an environment: its delete is an
ADR-0005 RESET — the overlay tombstones and the record re-projects to the declared body.
That behaviour is unchanged and deliberate. What was wrong is the answer: the door replied
`200 {"object":…,"id":…,"success":true}`, byte-identical to a real deletion, so a caller
that meant to revoke a permission set was told it was gone while it was still enforced, and
a UI fired a success toast and showed the row again on refresh.

The write-through's delete leg now reports how many of the addressed records actually went,
and `deleteData` maps that onto the already declared `success` key instead of hard-coding
`true`. No key is added to `DeleteDataResponseSchema`.

On the wire:

- packaged set — `200 {"success":false}`, the record still present with the same id (was
  `success: true`);
- environment-authored set — `200 {"success":true}`, the record really gone (unchanged);
- unknown id — `404 RECORD_NOT_FOUND` (unchanged: zero-removed is deliberately not read as
  not-found, because the record is still there to GET).

Clause-②: no
