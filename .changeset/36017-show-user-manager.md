---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Setup → Users shows who a user's manager is, who reports to them, and can remove a manager

Clause-②: no
Metadata-protocol: none

An administrator who set a user's manager could not read it back anywhere in Setup: the record page's Details tab named no section holding `manager_id`, no list showed the people reporting to a user, and the Set Manager dialog opened on an empty picker. The value was stored correctly; only the reading back was missing.

- **Details → Reporting Line** shows the user's manager (`sys_user.manager_id`, still read-only on the record; it is written only through the admin endpoint).
- **Details → Direct Reports** lists the users whose manager is this user. It is read-only: a report's manager is changed on that report's record.
- **Set Manager** now opens on the current manager (the param is field-backed on `manager_id` with `defaultFromRow`), so an admin sees what a re-point replaces. The request body is unchanged: `{ userId, managerId }`.
- **Remove Manager** (new `sys_user` action `remove_user_manager`, on the row menu and the record header) clears the link by posting `managerId: null` to `POST /api/v1/auth/admin/set-user-manager`. It carries the same platform-admin gate as Set Manager, is offered only while the user has a manager, asks for confirmation, and is not exposed to AI agents. The endpoint's refusals are unchanged and apply to the clear too: an identity a SCIM directory holds is refused there.
