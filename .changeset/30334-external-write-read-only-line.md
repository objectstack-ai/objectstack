---
'@object-ui/core': patch
'@object-ui/react': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/components': patch
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-detail': patch
'@object-ui/console': patch
---

fix(core,react,i18n,components,app-shell,console): a write refused because the object's external datasource does not accept writes says the table is read-only, not "you don't have permission"

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/core`: `isExternalWriteRefusal(err)`**, re-exported from `@object-ui/react` beside the other write-refusal readers. True when the server refused a write with `EXTERNAL_WRITE_FORBIDDEN`, the ADR-0015 write gate's code for an object bound to an external datasource that does not admit writes (`datasource.external.allowWrites` and `object.external.writable` must both be true). Read from `code`, then `details.code`, like `isPermissionError`. The refusal is a 403, so `isPermissionError` answers true for it too: a caller asks this first.
- **`@object-ui/i18n`: `form.readOnlyExternalSource`**, in all ten packs: "This table is read-only. Its records come from an external data source that does not accept changes."
- **Every surface that met this refusal now says the table is read-only:** the console record form page and the record dialog (`@object-ui/components` form), which said "you don't have permission to save this record"; the record page delete, the list row delete and the record page inline edit, which showed the gate's raw diagnostic; and the calendar's drag-to-reschedule and the record path's stage change. A permission line sent an administrator through permission sets for a grant that cannot exist.
