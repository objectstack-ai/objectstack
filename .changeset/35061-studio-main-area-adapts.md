---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the main area adapts when the Studio right slot opens

Clause-②: no
Metadata-protocol: none

- **Right slot width.** The slot is resized from its left edge within 320–560 px, and the properties pane and the AI copilot each remember their own width in the browser (360 px and 420 px by default). A width both panes shared before this release is not carried over: each pane starts from its default once. The in-place widen of the copilot and the phone overlay keep their own widths.
- **Left rails narrow.** While the right slot shows beside the Studio pillars and the content column next to the 240 px list would be under 900 px, the Data, Automations, Interfaces and Access lists draw 52 px wide: each row shows the first character of its name, with the full name on hover. The 「»」 button at the top shows the whole list over the content until a row is picked, Escape or a click outside. Closing the slot or a wider window brings the full list back. Phones are unchanged. New `studio` namespace strings: `engine.studio.rail.expand`, `engine.studio.rail.collapse`.
