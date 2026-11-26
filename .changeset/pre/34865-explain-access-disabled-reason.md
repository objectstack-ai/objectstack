---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio's "Explain access" says why Explain and Pick are disabled, on hover, on keyboard focus and to assistive technology

Clause-②: no
Metadata-protocol: none

With no object chosen, the Explain button and the record Pick button were bare disabled buttons: no tooltip on hover, skipped by Tab, and nothing in the accessibility tree (Pick's only title was its own label, "Pick"). Both now sit in the shared `DisabledControlReason` wrapper the Studio form designer, create dialog and metadata Save already use: a focusable wrapper that opens a tooltip with the reason "Choose an object first", and both the wrapper and the button point `aria-describedby` at it. Each button keeps its own name; once an object is chosen both are plain enabled buttons, and a running Explain gives no reason because its label already says "Explaining…". The new string is in the Studio namespace catalogues (`en`, `zh`) of `@object-ui/i18n`.
