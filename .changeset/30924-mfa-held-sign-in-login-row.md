---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a sign-in that enforced MFA holds records the hold on its own `login` row

Clause-②: no
Metadata-protocol: none

A sign-in held by the ADR-0069 D3 enforced-MFA requirement (the requirement is on, the account never enrolled, its grace window has lapsed) used to leave the compliance ledger nothing to say about the hold: the sign-in succeeds, a session is minted and its `login` row is written exactly like any other, while every request on that session is answered `MFA_REQUIRED`. The `login` row of such a sign-in now carries `reason: "MFA_REQUIRED"` and `rule: "mfa_required"` in its `metadata`, beside `endpoint`, so an enforcement report can list who was held by the MFA policy, from which address and when.

The hold is asked once, when the session is created, of the same posture computation the session gate asks. It is not asked on every session read, so a held sign-in has exactly one row, and no `login_failed` row is written for it: the session exists. A posture read that fails records no hold, which is the gate's own fail-open direction. A deployment without the audit plugin makes no extra read. Every other `login`, `logout`, `login_failed` and `account_locked` row is unchanged, and no row carries the attempted credential.
