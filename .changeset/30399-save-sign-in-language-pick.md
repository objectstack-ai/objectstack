---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): a language picked on the sign-in page is saved as the person's own language when they have none (#30399)

Clause-②: yes (widening)
Metadata-protocol: none

A language picked in the sign-in page's menu used to apply on that browser only: after signing in, the person's saved language stayed empty, so another device, or the language their mail is written in, did not follow the pick. The sign-in page now saves the pick to the person's own language setting before it moves on, when they have not chosen one yet. A language they already chose is kept, nothing is saved when no language was picked on the page, and a save that fails does not hold up the sign-in (the pick still applies on that browser). `@object-ui/app-shell` gains `hasSignInLanguagePick`, `saveSignInLanguagePick` and the `SignInLanguagePickWriter` type for the sign-in page. A pick followed by a reload of the sign-in page, or by an identity provider's redirect, is still not saved.
