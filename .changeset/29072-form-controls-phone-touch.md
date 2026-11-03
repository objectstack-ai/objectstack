---
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
---

fix(fields, plugin-form): the create and edit form's controls reach a 44 px touch target at phone width

Clause-②: no
Metadata-protocol: none

Below the `sm` breakpoint (640 px) the field widgets a create or edit form draws now carry the same `min-h-[44px] sm:min-h-0` touch floor the form renderer's built-in controls already did. That covers the text, email, phone, URL, number, currency and percent inputs, the percent slider's hit area, the select trigger and its options, the lookup trigger with its clear, browse-all, search and quick-create controls, the record picker's search and filter buttons, the date picker's input, clear and calendar buttons, a 44 px calendar day, and the line-item grid's cells, row buttons and add-line button, and the file field's take-photo and per-file remove buttons. The modal, drawer and master-detail form footers' buttons do the same. From `sm` up every control keeps its previous height. No prop, export or metadata key changes.
