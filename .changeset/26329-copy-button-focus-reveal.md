---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): reveal the read-only field's copy button on keyboard focus

Clause-②: no
Metadata-protocol: none

On a record page in desktop read mode, the copy-to-clipboard button beside a read-only, copyable field was shown on hover only. It is a real button, so a keyboard user's Tab stop landed on a control they could not see. It is now also shown while it has keyboard focus, or while anything else in its field has focus (for example the field's own click-to-copy row), in the same way as the inline-edit pencil beside it. Hover, click-to-copy and the button's accessible name are unchanged.

What to do: nothing.
