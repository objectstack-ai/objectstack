---
'@object-ui/components': patch
---

fix(components): a record page's stuck tab strip is a solid bar, flush with the top of the page

Clause-②: no
Metadata-protocol: none

On a long record page the horizontal tab strip (Details / Related / Activity) sticks to the top as you scroll. Its fill was 60% transparent with a blur, so the cards scrolling under it showed through and overlapped the tab labels, worst in the dark theme. It also stopped short of the top: the page's scroll area is padded, and the browser sticks a `top: 0` box at the padding's inner edge, so a strip of scrolled content stayed visible above the tabs. The stuck strip now uses the solid page-background colour of the active theme and keeps its bottom rule, and it stops exactly at the visible top of its scroll area, whatever that area's padding at the current screen width. Vertical (sidebar) tab layouts, tab styles and tab order are unchanged.
