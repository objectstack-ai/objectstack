---
'@object-ui/app-shell': patch
---

fix(app-shell): a server error at an RLS clause's path holds the permission-set autosave

Clause-②: no
Metadata-protocol: none

In Studio's permission-set editor, an RLS `using` or `check` clause that the publish will refuse (for example a `using` that reads a formula field, refused as `rls-predicate-unenforceable`) showed the server's message on the field but kept autosaving: the message was displayed, and the save gate never counted it. Now the server's errors at the clause's own path hold the autosave, the same way a CEL syntax error does, while the clause still shows the text that verdict judged.

The verdict describes the stored draft and nothing else, and no door judges a text without saving it. So an edit that changes the clause's text is not held: it saves, and that save's re-read brings the next verdict, which holds or releases from there. The editor decides nothing itself: it takes the server's errors as served and restates no publish rule.
