---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Setup no longer opens on Packaged Actions for a member who may not read the activation ledger

Clause-②: no — the served `GET /meta/app/setup` tree is unchanged for every caller except that `nav_packaged_actions` now carries `visible: current_user.can('sys_metadata_activation', 'read')`, which the console asks with the member's `/auth/me/permissions` map. A member who may read the ledger is shown the entry and lands as before (the platform administrator still lands on System Overview). A member who may not read it stops being shown an entry whose page rendered only `activation ledger HTTP 403`; nothing they could use is withdrawn.
Metadata-protocol: none

Packaged Actions was the first entry Setup serves, and the console's object-read prune judges `type: 'object'` entries only, so every member landed on it, including a separation-of-duties officer (for example an auditor holding `view_all_audit_log`) whose read of `sys_metadata_activation` answers 403. Such a member now lands on the first entry they can open, for example People & Org › Users. The entry still declares no `requiredPermissions` and no `requiresService`; the activation write doors keep their server-side gates. (#33224)
