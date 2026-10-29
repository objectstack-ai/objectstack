---
'@object-ui/i18n': patch
---

fix(i18n): the Studio `trackHistory` switch describes the v3 record page, not a History tab

Clause-②: no
Metadata-protocol: none

The object settings' `trackHistory` switch was still labelled "History tab" and said it shows a read-only History tab on record pages. The v3 record page has no History tab: field changes join the record's one timeline stream, under its Changes filter, as the spec's `enable.trackHistory` text says. The label and description now say that, in English and Chinese (the two languages the Studio catalogue carries). Copy only: the flag and what it does are unchanged.
