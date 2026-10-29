---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's list-view filter offers a picklist field's options and stores the option value

Clause-②: no
Metadata-protocol: none

In Studio, **Interfaces → a list view → Filter → Add filter**, a picklist field's value was a plain text box. An author typed the label they see (`New Request`), the view saved `value: 'New Request'`, the draft still read valid, and the runtime list showed "No records match this view's filter", because the stored value is the option's `value` (`new`).

The panel mounts the runtime list filter's `FilterBuilder`, which draws a picklist column's value as a picker over the field's options; the field catalog handed to it had dropped `options` on the way. They now travel with the field, so the value control lists the field's options (by label) and stores the option's `value`, the same control and the same stored shape as the runtime list filter. Other field types keep their value controls.
