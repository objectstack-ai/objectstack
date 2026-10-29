---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): the form designer and the publish review no longer misreport an order-only field change

Clause-②: no
Metadata-protocol: none

- **Publish review.** Expanding an object whose draft only reorders its fields used to read "No differences detected", although publishing does save the new order. The drill-in now lists a **Field order changed** row, and the entry keeps its Update badge. Only the fields both versions declare are compared, and the columns the platform injects on every read (an untouched `owner_id`, the audit columns, the search companion) are left out, because their place is the platform's, not the author's. Only an `object`'s fields are compared this way, matching the publish door.
- **Form designer.** An ungrouped field whose definition is exactly the platform's own, `owner_id` among them, now stays first in the ungrouped section. A field dropped above it lands below it, and the drop announcement names that place, so the canvas shows the order a reload shows. Moving such a field into a section, or editing it, makes it the author's field, and it then keeps the place it is given.
