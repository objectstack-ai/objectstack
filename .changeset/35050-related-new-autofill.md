---
'@object-ui/fields': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(fields): a create form that opens with a lookup value runs that lookup's `lookupAutofill`, and a picker's "+ New" seeds the `dependsOn` parent it filters by

Clause-②: no
Metadata-protocol: none

- **Opening value.** A create form can open with a lookup already set: a related list's New links the parent, a URL prefill sets it, or a form view default does. That lookup now fills the targets its `lookupAutofill` declares from that record, the same way a pick does. Example: from an opportunity, Related → Quotes → New opens a quote with Account filled from the opportunity. Only empty targets fill. A value the form opened with is explicit, so `overwrite: true` does not replace it. The fill uses the record the lookup already reads for its label, so no second request is made. The filled values count as opening values: a form nobody has touched closes without the discard prompt. A later pick replaces what the opening fill wrote, as it replaces what an earlier pick wrote. An edit form fills nothing from the stored record.
- **"+ New" in a dependent picker.** When a lookup's picker is filtered by `dependsOn`, its "+ New" now opens the create form with those values already set, under the field name the filter uses (`param`). The new record is then one the picker lists. The one-field inline create, used when no modal host is present, sends the same values. A picker with no `dependsOn` seeds nothing.
- **Hosts.** The form renderer passes a lookup the value it opened with (`openingValue`, create forms only). `onAutofill` now takes `{ opening: true }` for a fill made from that value. The console's `useActionModal` opens an object create form with the `initialValues` the descriptor carries.

No metadata key is added or changed.
