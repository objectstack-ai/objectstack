---
'@objectstack/plugin-auth': patch
---

`/delete-user` no longer lets a body-supplied `userId` win over the resolved actor

`/delete-user` is the vendor's self-service delete: its contract names no
target, the subject IS the authenticated caller. The break-glass
last-local-credential guard's target resolution on that route still preferred
a body-supplied `userId` whenever one was present, so any authenticated
caller could steer the guard's own refusal at a user other than themselves.

The guard's target on `/delete-user` is now the resolved actor unconditionally
— `body.userId` is never consulted for that route, only as a prior fallback.
`/admin/remove-user` and `/admin/ban-user` are unaffected: target-naming is
their own contract and is untouched here. For every caller acting on
themselves, nothing changes — the same lookup runs and the same outcome
(refuse the last local credential, admit everything else) is returned.
