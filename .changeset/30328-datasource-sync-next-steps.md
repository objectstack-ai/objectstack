---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): after Setup → Datasources syncs objects, the dialog links each new object and names the two steps left: add it to an app, and grant access

Clause-②: yes (widening)
Metadata-protocol: none

- **The result.** When a Sync run creates at least one object, the dialog stays open on the result instead of closing behind a toast: the count line, one link per created object (label, with the name beside it when they differ) that opens the object under the app the page is in, and the two steps left before people can use it, adding it to an app and granting access in a permission set. A run that creates nothing closes the dialog as before. Refused tables are still reported in the error toast.
- **The widening.** Four new `studio` namespace rows in `@object-ui/i18n` (en and zh): `engine.datasource.syncNextStepsOne`, `engine.datasource.syncNextSteps`, `engine.datasource.syncNextStepApp` and `engine.datasource.syncNextStepAccess`.
