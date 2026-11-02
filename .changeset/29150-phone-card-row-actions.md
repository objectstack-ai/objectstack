---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): on a phone, each list card offers its row's actions through one 44 px "⋮" control

Clause-②: no
Metadata-protocol: none

Below the 768 px card breakpoint, `ObjectGrid` draws its rows as cards, and a card had no way to reach the row's actions: a phone reader had to open each record to edit, delete or run a declared row action, and an action offered only on the list could not be reached at all. Each card whose row offers an action now ends with the row's own "⋮" menu, 44 px on a phone. The menu reads the same resolver, handlers and confirm steps as the desktop row, and lists every action in one menu in the order the desktop row's context menu lists them: Edit, Delete, the primary actions, the other actions. A tap on the card still opens the record. A card whose row offers nothing draws no control. The desktop table and the metadata are unchanged.

What to do: nothing.
