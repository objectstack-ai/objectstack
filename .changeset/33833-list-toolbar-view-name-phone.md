---
'@object-ui/plugin-list': patch
---

fix(plugin-list): on a phone the list toolbar keeps the view name readable

Clause-②: no
Metadata-protocol: none

Below `sm`, the Console draws the list's view switcher at the start of the list toolbar (`toolbarLeading`). On one line with the filter chips, the 「In a queue」 toggle and the tool icons (44 px touch targets on a phone), the view name was cut to about one character: 「全部客户」 showed as 「全.」 at 375 px. With a leading node, the toolbar row now wraps below `sm`. The name keeps the row's width, and the chips, the toggle and the tools move to a second line when they no longer fit beside it, with the tools at the right edge. A name wider than the row ends in an ellipsis. Nothing scrolls the page sideways. From `sm` up, and in a list without a leading node, the toolbar is unchanged.
