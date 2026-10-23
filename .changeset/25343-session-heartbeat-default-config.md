---
'@objectstack/plugin-auth': patch
---

Clause-②: no
Metadata-protocol: none

The session activity heartbeat now runs on every deployment. `sys_session.last_activity_at` is "the last request on this session", and Setup → Sessions shows it so an administrator can tell two of one user's sessions apart. Until now it was written only while `sessionIdleTimeoutMinutes` was above 0, so on a default deployment (no idle or absolute limit) the Last Activity column stayed empty.

It is still written at most once a minute per session. When neither the idle nor the absolute limit is configured, the `sys_session` read that feeds it is throttled too: a per-process memo, per session and bounded in size, skips the read for 60 seconds after one. With a limit configured, every request still reads the session row, as enforcement needs.
