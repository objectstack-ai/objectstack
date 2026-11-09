---
'@object-ui/app-shell': patch
---

fix: a language picked on the sign-in page is kept when the person who signs in is not the browser's last user (#30338)

Clause-②: no
Metadata-protocol: none

On a shared browser, signing in as someone other than the last user clears the previous user's saved state, and that sweep also removed the language just picked in the sign-in page's menu, so the person landed in the browser's language. The pick is now remembered for that page-load and put back after the sweep, so the next page opens in the chosen language. What the previous user left is still cleared when nothing was picked. A pick followed by a reload of the sign-in page, or by an identity provider's redirect, is still lost. Saving the pick as the person's own language is a separate change.
