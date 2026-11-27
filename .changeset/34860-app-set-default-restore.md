---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a refused "Set as default" on Setup › Apps no longer leaves the deployment with no default app

Clause-②: no
Metadata-protocol: none

Setting an app as the default first un-sets the current default, then sets the new one. When the second write was refused (for example, the app belongs to a read-only package and the server answers 403), the first write stayed and no app was the default any more. The page now puts each un-set default back, in the package it came from, before it shows the refusal, so a refused set-default leaves the default where it was. If putting it back is refused too, a second error names the app that is no longer the default (new key `appManagement.toast.restoreDefaultFailed`, in all eleven console locales). The order of the writes is unchanged, so a failure never leaves two defaults.

Nothing to migrate.
