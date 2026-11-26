---
'@object-ui/app-shell': patch
---

fix(record-page): an empty field in the synthesized "More details" section is counted and revealed by "Show N empty fields"

Clause-②: no
Metadata-protocol: none

On an object's default record page, a field the page moves to its synthesized "More details" section (a long-text field such as `notes`) no longer disappears from read mode when it is empty. Before, a "More details" section whose fields were all empty drew nothing, the field list's closing "Show N empty fields" row left the field out of its count, and pressing it did not draw the field; it appeared only in edit mode. The section now folds its empty rows the way every other group does: the row counts them, and showing empty fields draws them in place under the "More details" heading.

The default page's derived sections (the untitled primary section, "More details", and the "Other" section of fields no field group claims) now carry `hideEmpty: false`, the value the `record:details` section contract already declares for keeping an all-empty section. A record page Studio seeds from these sections saves the same value. Pages that authors write are unchanged: an authored section that omits `hideEmpty` still disappears when all its fields are empty.
