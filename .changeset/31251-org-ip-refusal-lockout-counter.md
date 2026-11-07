---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a correct-password sign-in refused afterwards, by an organization's allowed IP ranges, a ban or an unverified address, no longer counts toward the account lockout

Clause-②: no
Metadata-protocol: none

The ADR-0069 D2 lockout counter read every refused `/sign-in/email` as a wrong password. Three refusals come only after the password verified: an organization's own IP list (`403 IP_NOT_ALLOWED`, judged when the new session is scoped to it), a ban (`403 BANNED_USER`, judged when the session is created) and an address the deployment requires verified (`403 EMAIL_NOT_VERIFIED`). Each raised the count, so an account holder with the right password could lock their own account: a member signing in from outside the organization's network was then refused `ACCOUNT_LOCKED` from inside it, a lifted ban left a lock behind, and a person waiting for their verification mail was locked out once it arrived. These three refusals now leave the counter as it stands, neither counting nor clearing it. A wrong password still counts in every case, and a successful sign-in still clears the count. The refusals' status, code and message and their `login_failed` audit rows are unchanged.
