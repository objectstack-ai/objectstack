---
'@objectstack/plugin-audit': minor
'@objectstack/plugin-auth': patch
---

fix(plugin-audit,plugin-auth): a refused sign-in and an account lockout each write a `sys_audit_log` row, as a successful sign-in already does

Clause-②: no

- **Two new ledger actions, each with its writer.** `sys_audit_log.action` gains `login_failed` and `account_locked`. A refused `/sign-in/email` that names an existing account writes one `login_failed` row. The refused sign-in that stamps the account lockout (`lockoutThreshold`, ADR-0069 D2) also writes one `account_locked` row. A sign-in refused while the account is locked writes `login_failed` with the reason `ACCOUNT_LOCKED`. A successful sign-in still writes `login`, unchanged.
- **What each row records.** `user_id` is the account the sign-in named, and the row names `sys_user` and that account's id as its target. The outcome is the action, plus the refusal's machine code in `metadata` (`INVALID_EMAIL_OR_PASSWORD`, `ACCOUNT_LOCKED`, …), and the lock's `locked_until` and `threshold` on an `account_locked` row. `created_at` is the time. `ip_address` and `user_agent` are resolved by the rule better-auth applies to a session row, which is where a `login` row's values come from. `actor` is null, because a refused attempt authenticated nobody. A row never carries the attempted credential, and an identifier that resolves to no account writes no row.
- **Where they show.** Setup → Audit Log's *Auth* preset (the `auth_events` list view) now lists `login`, `logout`, `login_failed` and `account_locked`. Each row is about the account it names, so the ledger's record read gate judges it by that `sys_user` record, as for any row about a user. It carries no `tenant_id`: a refused attempt has no session to take an organization from, so it is a deployment-level row under the ledger's organization scope.
- **Recorded with or without a lockout.** A refused sign-in writes its row whether or not `lockoutThreshold` is set.
- **`@objectstack/plugin-audit` types.** `AuthSessionAuditEvent.action` widens to `AuthEventAuditAction` (`'login' | 'logout' | 'login_failed' | 'account_locked'`). `AuthEventAuditAction` and `AuthAccountAuditAction` are new exported types, and `AuthSessionAuditAction` is unchanged.
