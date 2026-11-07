---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a correct-password sign-in that an organization's allowed IP ranges refuse no longer counts toward the account lockout

Clause-②: no
Metadata-protocol: none

The ADR-0069 D2 lockout counter read every refused `/sign-in/email` as a wrong password. An organization's own IP list is judged when the new session is scoped to it, which happens only after the password verified, so a member signing in from outside that list with the right password raised their own count and, at the threshold, locked their account: their next sign-in from inside the list was refused `ACCOUNT_LOCKED`. That refusal (`403 IP_NOT_ALLOWED`) now leaves the counter as it stands, neither counting nor clearing it. A wrong password still counts from either side of the list, and a successful sign-in still clears the count. The `403 IP_NOT_ALLOWED` answer and its `login_failed` audit row are unchanged.
