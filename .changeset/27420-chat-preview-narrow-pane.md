---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): the assistant's draft preview is no longer cut off in a narrow chat pane

Clause-②: no
Metadata-protocol: none

The chat and the draft preview open side by side, and each keeps a minimum width (360 px for the chat, 420 px for the preview). In a pane narrower than the two together, such as the in-app assistant dock at a 1024 px window, the chat kept its minimum and pushed the preview past the pane's edge, so only a sliver of it showed.

Below 780 px the pane now previews the way it already does on a phone: the chat keeps the full width, a Preview button above the composer offers the preview, and opening it shows the preview over the whole pane, with its close button returning to the chat. At 780 px and wider nothing changes: the preview opens beside the chat with the draggable divider. The width is the pane's own, so the full-page assistant at a desktop width keeps its split.

What to do: nothing.
