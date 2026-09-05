---
"@objectstack/rest": patch
---

The admin "Used by" panel no longer clears a delete when the caller's own organization is using the item.

`GET /api/v1/meta/:type/:name/references` backs that panel, whose empty case reads "Nothing in the metadata graph points at this item. Safe to delete." — advice given to an operator about to delete something. The door supplied no organization, so the reference sweep read the environment partition only: an organization-scoped `view` (or `dashboard`, `report`, `translation`, `email_template`) pointing straight at the object being deleted was invisible, and the panel issued a false clearance. It now passes the caller's organization, and those references are returned.

The organization is passed RAW, deliberately, and that is the whole of the change — no new parameter, response field or contract surface. `req.params.type` is the reference TARGET, while the sweep spends the organization on the SOURCES it reads per type; `getMetaItems` applies the `allowOrgOverride` read gate to its own request type, so each source is scoped on its own registry flag. A non-overridable source (`object`, `flow`, `app`, …) is still read environment-wide and no pre-#6190 organization-scoped row is resurrected into a delete clearance. An anonymous or organization-less caller reads exactly what it read before, and no status code or response shape moves.
