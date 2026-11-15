---
'@object-ui/console': patch
---

perf(console): the first load no longer downloads the Studio designer strings and the metadata form strings

Clause-②: no
Metadata-protocol: none

Every Console route, a dashboard included, used to download the Studio designer's English strings (64 KB gzipped) and the metadata form strings before the app asked for any data, though only Studio and Setup screens draw them. They were held there by five components the Console registers or mounts at load: the Studio canvas's default object grid, the Setup datasources page, the position list's holder and permission-set cells, a list's "Create view" dialog and the preview bar's "Pending changes" sheet. Each now loads the first time it is drawn, and the Studio strings' loader gets its own chunk. English stays the strings' synchronous fallback once a Studio or Setup screen has loaded. The Console's eager closure (`dist/eager-closure.json`) goes from 2,165,707 to 2,058,468 bytes gzipped (−107,239), measured on two builds of the same tree. What each screen draws is unchanged; the datasources page shows a one-line loading notice while its code arrives.
