---
'@object-ui/react': patch
'@object-ui/i18n': patch
'@object-ui/components': patch
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-detail': patch
'@object-ui/console': patch
---

fix(react,i18n,components,console): a write refused because the object's external datasource does not accept writes says the table is read-only, not "you don't have permission"

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/react`: `isExternalWriteRefusal(err)`.** True when the server refused a write with `EXTERNAL_WRITE_FORBIDDEN`, the ADR-0015 write gate's code for an object bound to an external datasource that does not admit writes (`datasource.external.allowWrites` and `object.external.writable` must both be true). Read from `code`, then `details.code`, like `isPermissionError`. The refusal is a 403, so `isPermissionError` answers true for it too: a caller asks this first.
- **`@object-ui/i18n`: `form.readOnlyExternalSource`**, in all ten packs: "This table is read-only. Its records come from an external data source that does not accept changes."
- **The surfaces that turned this refusal into the permission line now say it is read-only:** the console record form page, the record dialog (`@object-ui/components` form), the calendar's drag-to-reschedule and the record path's stage change. Before, an administrator was told "you don't have permission to save this record" and went looking through permission sets for a grant that cannot exist.
