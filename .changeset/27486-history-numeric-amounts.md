---
'@object-ui/app-shell': patch
'@object-ui/fields': patch
---

fix(app-shell): the record history "Changes" entry formats a currency, number or percent value the way the record page formats that field, instead of printing the raw stored number

Clause-②: no
Metadata-protocol: none

- **Before.** Editing a currency field to `4321000` showed `$4,321,000.00` on the record but `— → 4321000` in Activity › Timeline. Number and percent fields printed their raw stored value the same way (`1234.5`, `0.25`).
- **Now.** The History tab formats these three types through the record page's own formatters in `@object-ui/fields`: `formatCurrency` with the code `resolveFieldCurrency` resolves, `formatNumberFieldValue` (declared `scale`, grouping hint) and `formatPercent` at the field's declared storage and width, in the viewer's display locale. A fixed-currency field reads `$4,321,000.00`.
- **Currency modes.** A `fixed` field shows its declared code. A `dynamic` field shows the tenant default when the History tab's caller passes one (`tenantCurrency` on the format context), and a plain grouped number when it does not. A `record`-mode field shows a plain grouped number: its code lives in a sibling field of the row, which a per-value format call is not handed, and the tenant default is never substituted for it.
- **`@object-ui/fields`.** `formatNumberFieldValue` is now exported from the package entry (it was module-internal), and its `locale` parameter is optional like its siblings `formatCurrency` and `formatPercent`. No rendering changes.
