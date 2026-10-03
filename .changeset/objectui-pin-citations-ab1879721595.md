---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `ab1879721595`.

Clause-②: no

Several records were corrected rather than moved, because objectui changed what they describe on this hop.

- **`object-grid` `keyboardNavigation`.** The grid now reads the key (objectui#11068), so its describe drops the `[EXPERIMENTAL — not enforced]` marker and the sentence that said no renderer reads it and authoring it changes nothing. The describe now says what the grid does: the data cells become one Tab stop that the arrow keys, Home / End and Ctrl+Home / Ctrl+End move between. It is on by default when the grid renders editable, `true` turns it on for a read-only grid, and `false` turns it off on an editable one.
- **`object-grid` `emptyState`.** Its record now says the grid resolves `title` and `message` against the display locale (objectui#11227), so an inline locale map draws.
- **`ActionSchema.outcomeMessages`.** The console reader landed (objectui#11344). The key's liveness row is now `live`, and authoring it no longer draws the "the console does not show outcome copy yet" author warning. The `successMessage` row records that `${result.*}` is interpolated.
- **The four `action:*` rows.** The action renderers forward `outcomeMessages` to the action runner. The `action:button` and `action:icon` rows record it as a key the renderer forwards and the row does not declare. The `action:group` and `action:menu` rows record that each member's own `outcomeMessages` rides the member forward.

Every other anchor either held on a byte-identical file or moved with its cited text byte-identical. The corpus counts in the six migration entries were re-taken with the method that reproduces the previous pin's numbers. No key, default, enum member or export moves.
