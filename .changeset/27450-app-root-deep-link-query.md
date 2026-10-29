---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): an app-root or console-root deep link keeps its query and hash when it redirects to the landing page

Clause-②: no
Metadata-protocol: none

Opening `/apps/APP?palette=1` on an app whose root redirects to its first navigation entry landed on that page with no query string, so the command palette never opened; the same held for every URL overlay param (`?recordId=`, `?form=`) and for the hash, and for `/?palette=1` at the console root. Both redirects now carry search and hash across. When the landing entry has a query of its own (a `page` entry's `params`, an object entry's `filters` or `runAction`), the two merge: a key the link names replaces the landing's value for that key instead of doubling it.
