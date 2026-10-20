---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the account lockout resolves the account the sign-in credential check resolves

Clause-②: no

- **One account per sign-in.** The ADR-0069 D2 lock gate, its failed sign-in counter and the `login_failed` / `account_locked` account events now share one resolver. It looks the account up exactly as better-auth's `/sign-in/email` credential check does, so all four name the same account for every identifier the credential check resolves to it.
- **What that guarantees.** Every refused sign-in that resolves to an account counts toward that account's one lock. An existing lock refuses every sign-in that resolves to the account, including one with the correct password. A successful sign-in clears the counter, as before. An identifier that resolves to no account changes no account and writes no account event.
- **Nothing to migrate.** The lockout state stays on the account's own `sys_user` row (`failed_login_count`, `locked_until`), written by its id, and `lockoutThreshold` / `lockoutDurationMinutes` keep their meaning.
