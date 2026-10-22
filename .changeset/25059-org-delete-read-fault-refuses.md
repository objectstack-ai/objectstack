---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an organization delete whose admission cannot read what it decides on is refused with 503 `SERVICE_UNAVAILABLE`, before better-auth's first write

Clause-②: no (the refusal replaces an outcome only a failed store read produces, and the typed 503 replaces a bare 500 fault; no request a caller can make is answered differently)
Metadata-protocol: none

The `POST /organization/delete` admission counts the records an organization still owns before better-auth's handler runs, so a refused delete writes nothing on any driver.

- **A read the admission decides on that fails now refuses.** When its read of the caller's membership or of the organization row failed, the admission handed the request to better-auth, which could then clear the caller's active organization and delete the members and invitations with nothing counted. On a driver without transactions those deletes stayed while the organization row survived. The admission now answers `503` with the standard `SERVICE_UNAVAILABLE` code, before better-auth's first write. The body names the table it could not read; the driver's own message is not relayed.
- **A failed Default Organization decision answers the same `503`.** It already refused before any write, but as a bare error, which better-auth answers with an untyped `500`.
- **Unchanged.** What better-auth answers itself still goes to it: no session, no membership, no permission, no organization row, and a member row whose role the vendor's own permission check cannot evaluate (its identical check runs before its first write). The `409 DELETE_RESTRICTED` refusal and the Default Organization's `403` are unchanged.

**What a client does.** Treat `503 SERVICE_UNAVAILABLE` from an organization delete as "retry later": nothing was deleted.
