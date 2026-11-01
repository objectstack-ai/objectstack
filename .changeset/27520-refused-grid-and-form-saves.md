---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
---

fix(ui): a refused inline-grid save marks its cells and says every reason; a refused form save is said once

Clause-②: no
Metadata-protocol: none

- **Inline grid edit, Save All.** When the server refused a row, the save bar showed one shortened line, with the rest only in a tooltip, and no cell showed which value was wrong. Now every reason is shown in full on its own line under the toolbar, and each cell the refusal names gets a red outline with its reason on hover. Editing a marked cell removes its outline.
- **Field rules before sending.** The grid's built-in saves now check an edited value against the field's own rules (required, min / max, length, email / URL pattern) before sending, and refuse a row that breaks one in the same way the server would. That row is not sent; the other rows still save.
- **Save All placement.** The grid toolbar is padded, so the Save All / Cancel All buttons no longer sit against the right edge of the grid.
- **Refused form save.** When the server refused a form save, such as one blocked by a validation rule on a Studio-authored object, the form showed a banner and an identical error toast. It now shows the banner only, scrolled into view, and a retry still replaces that banner instead of adding another. This reverses the earlier one-error-toast behaviour.
