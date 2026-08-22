---
'@objectstack/plugin-auth': patch
---

Run the break-glass last-local-credential guard after authentication

The guard that refuses removal of the last local-password login was registered
as a better-auth `before` hook, which runs ahead of the endpoint middleware that
establishes identity. It therefore decided — and answered — a question about a
named user for a caller who had not been authenticated, while every neighbouring
route on the same lane answers with the ordinary "please log in" refusal.

The guard now runs only once the acting user is resolved. An unauthenticated
caller falls through to the ordinary refusal and learns nothing about the named
user. For an authenticated caller nothing changes: the same lookup runs and the
same `LAST_LOCAL_CREDENTIAL` conflict is returned, so the lockout protection is
unaffected.
