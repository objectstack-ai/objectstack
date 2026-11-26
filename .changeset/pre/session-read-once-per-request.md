---
'@objectstack/runtime': patch
---

fix(runtime): a signed-in request reads its session once when an authentication policy is on

Clause-②: no
Metadata-protocol: none

With an ADR-0069 authentication policy active (password expiry, required MFA, an administrator-issued password change), every signed-in request served by the runtime dispatcher, and every request to an app's declared endpoint, now makes one fewer pair of database round trips: the session and its user are read once and shared between identity resolution and the authentication-policy gate, where the gate used to read them again. Which requests are admitted or refused, and with which status, does not change.
