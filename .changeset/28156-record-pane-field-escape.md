---
'@object-ui/components': patch
---

fix(components): in the record drawer, an `Esc` a field takes stays the field's — below the stack's root it no longer steps the pane back, and maximized it no longer restores the pane

Clause-②: no
Metadata-protocol: none

The drawer's dialog layer hears `Esc` on the document in the capture phase, before any field in the record does, and its handler stepped back one level (below the root) or restored the pane (maximized) on every `Esc`. So closing a mention list in the composer, cancelling a cell edit, or leaving an enlarged face also lost the reader's level or the maximized width.

- The drawer now asks what the split pane beside a list already asks: an `Esc` already marked handled, or pressed in a text field, an editable region, or an open menu, list box or dialog inside the record, is not the pane's. The pane stays where it is and the field gets the key.
- A bare `Esc`, or one pressed on a control that owns no key (a button in the record), still steps back below the root and still restores from maximized; at the root it still closes the drawer.
- With focus in a text field, `Esc` never steps the pane back, as in the split pane: move focus out of the field, or use `←`.
