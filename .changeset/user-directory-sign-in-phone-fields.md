---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the user directory no longer returns another user's sign-in phone number to non-admin readers

Clause-②: no
Metadata-protocol: none

`sys_user.phone_number` and `sys_user.phone_number_verified` are the better-auth phone sign-in identifier and its verified flag — account administration data, not directory data. Both are now declared in the identity object's `Admin` field group, which the shipped permission sets already treat as field-level security: the non-admin sets (`member_default`, `viewer_readonly`, `external_default`) mark every field of that group `readable: false`, and the admin sets (`admin_full_access`, `organization_admin` and its no-bypass variant) keep it.

- **Org members** reading the user directory (`GET /api/v1/data/sys_user`, a record read, the Setup → Users list) are served each colleague's name, email, image and deactivation flag as before, without the two phone fields. A user picker's `$search` stops scanning the phone column for them; a filter or sort a member writes on either field is refused like any other withheld field.
- **Platform admins and organization admins** read and manage both fields exactly as before.
- **A member's own row.** Field-level read security is row-blind, so the generic data API withholds the member's own phone fields too. The signed-in user's own number is read from the auth session (better-auth's session user carries both phone fields when the phone-number sign-in plugin is enabled); system-context readers (sign-in, SMS delivery, the admin import) are unaffected.
- **Field group.** Wherever a form lays fields out by their declared group, the two fields now sit in `Admin` instead of `Account`.

No configuration change is needed. A deployment that wants members to keep reading colleagues' phone numbers grants a permission set naming `sys_user.phone_number` (and `sys_user.phone_number_verified`) with `readable: true`.
