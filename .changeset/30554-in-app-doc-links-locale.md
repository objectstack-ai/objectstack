---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a link inside an app's doc keeps the app shell, and the docs chrome reads the session language

Clause-②: no
Metadata-protocol: none

A doc read inside an app (`/apps/APP/docs/BOOK/DOC`) rewrote its body cross-references to the portal's `/docs/NAME`, so following one left the app: no top bar, no app navigation. They now resolve under the app's own docs route, as the book sidebar already did, and the header's home link goes to the app's docs index. The header's "Documentation" label, the portal heading and the book sidebar's synthetic "Uncategorized" group title now read the new `help.documentation` and `help.uncategorized` keys, present in all ten locale packs; the group is titled by its key, and authored group labels keep the server's translation.
