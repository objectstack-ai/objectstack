---
'@objectstack/types': patch
'@objectstack/plugin-security': patch
---

feat: under a walled posture, `OS_PLATFORM_OWNER_ORGANIZATION` raises the access upgrade report in-app in the platform operators' own organization, beside the operator log line

Clause-②: yes (widening: a new optional environment variable, `PLATFORM_OWNER_ORGANIZATION_ENV` and `resolvePlatformOwnerOrganization()` exported from `@objectstack/types`; unset, every posture behaves as before)
Metadata-protocol: none

Under `group` and `isolated` the boot access upgrade report reached the operator only as one `error` line in the server log. The notification family is organization-owned, a walled system write that names no organization is refused (ADR-0131 D9), and the operator belongs to no organization by default.

- **New setting:** `OS_PLATFORM_OWNER_ORGANIZATION`, the id or slug of the operators' own organization, beside `OS_PLATFORM_OWNER_EMAIL`. It is read only under a walled posture.
- **What it does:** with it set, the report emits the same `security.access_upgrade` notification, with the same `dedupKey` per finding set, stamped with that organization and addressed to the `OS_PLATFORM_OWNER_EMAIL` operators. It lands in that organization's Notification Events and the operators' inbox, and in no other organization. The operator line stays beside it.
- **Use a dedicated organization that holds the operators only.** Every administrator of it can read the notification in Setup, and the findings can name other organizations' ids and rule names. Boot logs a `warn` for a configured operator who is not a verified member of it. It logs another `warn` for an administrator of it who is not a configured operator: an `owner` or `admin` member, or an `admin_full_access` or organization-admin grant scoped to it.
- **A value naming no organization** logs one `error` naming the value and the fix, and raises nothing in-app. It never falls back to another organization.
- **Unchanged:** unset, the operator line is the only channel, worded as before. Under `single` the setting is ignored, and the Default Organization's administrators are told as before.

The walled and `single` delivery now lives in one helper, `upgrade-report-delivery.ts`, so the non-access upgrade report (#24447) can raise its findings the same way.
