---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a refused "Set as default" on Setup › Apps no longer leaves the deployment with no default app

Clause-②: no
Metadata-protocol: none

Setting an app as the default first un-sets the current default, then sets the new one. When the second write was refused (for example, the app belongs to a read-only package and the server answers 403), the first write stayed and no app was the default any more. Now, when the server refuses the write (a 4xx answer) or the write fails before it is sent, the page puts each un-set default back, in the package it came from, before it shows the refusal. So a refused set-default leaves the default where it was. If putting it back fails too, a second error names the app that is no longer the default (new key `appManagement.toast.restoreDefaultFailed`, in all eleven console locales). A failure the server did not answer, or a 5xx, may have been written, so it is not undone: the page shows the failure and re-reads the list, which shows the result.

Nothing to migrate.
