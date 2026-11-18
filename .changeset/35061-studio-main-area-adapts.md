---
'@object-ui/app-shell': patch
---

feat(studio): the main area adapts when the Studio right slot opens

Clause-②: no
Metadata-protocol: none

- **Right slot width.** The slot is resized from its left edge within 320–560 px, and the properties pane and the AI copilot each remember their own width in the browser (360 px and 420 px by default). A width both panes shared before this release is not carried over: each pane starts from its default once. The in-place widen of the copilot and the phone overlay keep their own widths.
