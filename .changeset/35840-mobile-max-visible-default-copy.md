---
'@object-ui/components': patch
---

fix(ui): the designer and docs text for `page:header` `mobileMaxVisible` states the real default

Clause-②: no
Metadata-protocol: none

The Max Inline Actions (mobile) input description, and the `page.mdx` reference generated from it, said the budget defaults to 1. Unset, it is 2 in a record page's bottom action bar on a phone (the host's Edit counts) and 1 on any other header. The description now says so, matching the spec text from #35660, and the stale 3 / 1 comments on the header actions row are corrected. Text only: no value, fallback or rendering changes.
