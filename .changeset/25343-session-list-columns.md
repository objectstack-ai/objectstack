---
'@objectstack/platform-objects': patch
---

fix: Setup → Sessions shows each session's user agent and last activity, so two sessions of one user can be told apart

Clause-②: no
Metadata-protocol: none

Two sessions of one user read the same in the `sys_session` list: same user, organization and creation minute, with no device or activity column. An administrator who wanted to end one of them could not tell which, and revoked both.

The two views that list live sessions, `all_sessions` (Setup's Sessions page) and `mine` (the Account app), now show `user_agent` and `last_activity_at` next to the IP address. Both fields already existed on `sys_session`. The `revoked` audit view is unchanged.

`user_agent` is the raw string better-auth records. `last_activity_at` is written only while an idle timeout is configured (`session_idle_timeout_minutes` above 0). With the default of 0 the column is empty.
