---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-audit': patch
---

feat(plugin-auth, plugin-audit): a sign-in the IP allow-list refuses leaves one `login_failed` row in the audit log, bounded per client address

Clause-②: yes (widening)
Metadata-protocol: none

A sign-in refused by the ADR-0069 D5 IP allow-list used to leave nothing in `sys_audit_log`: the deployment's list answered `403 IP_NOT_ALLOWED` with only a once-per-process operator line, and an organization's own list refused the session silently. Both now write a `login_failed` row with `metadata.reason: "IP_NOT_ALLOWED"`, `metadata.rule: "ip_allow_list"`, `metadata.endpoint` and `metadata.attempts`, and the client address and user agent in `ip_address` / `user_agent`:

- **The deployment's list** refuses before any account is resolved. Its row names the account when the request's `email` resolves to one (the password sign-in's own account lookup), and is written with no account otherwise. Only `/sign-in/*` endpoints are recorded; a refused session read or sign-out is not a sign-in. The row is written off the response path, so the refusal's status, body and timing do not depend on whether the address names an account.
- **An organization's own list** refuses when the session is created. Its row names the account and the organization (`tenant_id`). A refused switch of the active organization is not a sign-in and writes no row.

The rows are bounded so a scanner cannot flood the table: per client address, in a 10-minute window from its first refusal, only the 1st, 10th and 100th refusal write a row (`attempts` 1, 10, 100); across all addresses, at most 1000 rows per 10-minute window, with one operator `warn` line in a window once the cap drops a row. The bound is held in each server process, so N replicas write up to N times as many rows. No row carries the submitted identifier or the password.

`@objectstack/plugin-audit`'s `AuthSessionAuditEvent.userId` and `@objectstack/plugin-auth`'s `AuthEventAuditSurface` event `userId` are now optional: a `login_failed` with no `userId` is written with `user_id` and `record_id` null (a row about no record, read under the ledger's own grant, platform administrators only when it names no organization). Any other event without a `userId` still writes nothing. `AuthManager.resolveRefusedSignInAccountId(email)` is new: the account a refused sign-in names, used only for that row.
