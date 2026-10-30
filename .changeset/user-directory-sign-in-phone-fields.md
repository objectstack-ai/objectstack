---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the user directory no longer returns another user's sign-in phone number to non-admin readers

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the shipped non-admin permission sets' field read on two `sys_user` columns: the two fields change their declared field group, and the group is the declaration those sets already read. The remedy is a permission set's existing `fields` entry, never a rewrite of anyone's code or metadata. No exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only); the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered). -->

**BREAKING** (an accept-set narrowing), shipped as `patch`: a non-protocol narrowing takes `patch` and keeps this banner and its ADR-0087 disposition.

`sys_user.phone_number` and `sys_user.phone_number_verified` are the better-auth phone sign-in identifier and its verified flag — account administration data, not directory data. Both are now declared in the identity object's `Admin` field group, which the shipped permission sets already treat as field-level security: the non-admin sets (`member_default`, `viewer_readonly`, `external_default`) mark every field of that group `readable: false`, and the admin sets (`admin_full_access`, `organization_admin` and its no-bypass variant) keep it.

**FROM.** On `origin/main`, an org member holding only the non-admin sets could, on the generic data door (`GET /api/v1/data/sys_user`, `POST /api/v1/data/sys_user/query`, the record read and the activity stream):

- read both fields on every org peer's row and on their own;
- write a **filter** naming either field, and have it evaluated;
- **sort** by either field;
- **group by** either field, or name it as an **aggregate** operand;
- run a `$search` whose default field set scanned `phone_number` (it is `searchable: true`, one of the object's three searchable fields beside `name` and `email`).

**TO.** For the same member:

- **Row position.** Both fields are withheld from every `sys_user` row served — a colleague's direct read, the list read, a `fields=` projection naming them, and the activity stream's recorded changes. The member's **own row** is withheld them too: field-level read security does not distinguish rows (ADR-0066).
- **Filter, sort, group-by, aggregate.** A query naming either field in its filter (`where` / `having`), its sort, its group-by or an aggregation is refused `403 PERMISSION_DENIED` before the engine is asked, at every verb that carries a query — a bulk write's own predicate included.
- **`$search`.** The default search set is narrowed **silently**: `phone_number` is dropped from the fields a member's `$search` scans, so a user picker keeps answering on `name` and `email`, and a search for a colleague's number returns no row rather than a refusal.
- **Writes.** Both fields stay `readonly: true` and are written through better-auth only, so no reachable write changes.

**Unaffected.** Platform admins and organization admins read, filter, sort and search both fields exactly as before. System- and auth-context readers — sign-in by phone, SMS delivery, the admin import's match on `phone_number`, the better-auth adapter — read under a context no permission set reaches. The signed-in user's own number is read from the auth session: better-auth's session user carries both phone fields when the phone-number sign-in plugin is enabled.

**Field group.** Wherever a form lays fields out by their declared group, the two fields now sit in `Admin` instead of `Account`.

**Grant-back.** No configuration change is needed for shipped apps. A deployment that wants org members to keep reading, filtering on or searching colleagues' phone numbers grants a permission set naming `sys_user.phone_number` (and `sys_user.phone_number_verified`) with `readable: true` in its `fields` entries; field grants merge most-permissively, so that one set out-votes the baseline's withhold. A client that filtered or sorted members' `sys_user` queries on either field drops that predicate or runs it with an administrator's grant.
