---
'@object-ui/app-shell': patch
---

fix(app-shell): in Studio, selecting an element while the right panel is hidden unfolds the panel on its properties

Clause-②: no
Metadata-protocol: none

With the right panel hidden from the top bar, selecting a flow node in Automations (or a block in Interfaces, or a field in Data) showed its configuration nowhere on a desktop-width screen: only a phone reopened the panel. A builder had to find the toggle again before they could edit the selected step.

What changes:

- A new selection now unfolds a hidden panel at every width, on the selected element's properties, the way `⌘.` unfolds it. The panel's shown state is remembered as when you show it from the toggle.
- Hiding the panel again while the same element stays selected keeps it hidden. Only another selection unfolds it.

What to do: nothing. Nothing a flow, page or object declares changes.
