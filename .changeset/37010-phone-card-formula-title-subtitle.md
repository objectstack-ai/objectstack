---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a phone list card never repeats a formula title in its subtitle

Clause-②: no
Metadata-protocol: none

On a phone, a list card whose object names its records with a `formula` name field (a case's `display_title` = `case_number - subject`) showed the title's parts again in the subtitle when the view showed them as its leading columns, so the subtitle had no room for anything else. The subtitle now skips every shown column whose field the name field's formula reads (a read through a lookup, `record.account.name`, skips the lookup's column) and takes the next shown columns instead: `CASE-00037 - Demo case 29 — critical problem` over `紧急 · Polar Cargo`. A name field that is not a formula keeps the subtitle it had.
