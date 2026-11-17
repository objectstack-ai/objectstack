---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): the list title no longer prints a record count beside the view name

Clause-②: no
Metadata-protocol: none

The Console list title, which is also the view switcher, read 「VIEW ▾ · COUNT」 (for example 「Open Deals ▾ · 10」). It now reads 「VIEW ▾」 on every width. The record count is still shown in the list's footer (「10 records」), on a phone too, so the number appears once and away from the view name. The footer's count and summaries are unchanged.
