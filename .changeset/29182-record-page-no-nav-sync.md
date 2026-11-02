---
'@object-ui/app-shell': patch
---

fix(app-shell): creating a record page no longer adds it to every app's navigation, and no navigation write goes to a sealed managed app

Clause-②: no
Metadata-protocol: none

- **A page that needs a record joins no app.** When a page is published for the first time, the Console adds it to app navigation only if it renders without a record. A `record` page (and a page body that leaves `type` out, which `PageSchema` defaults to `record`) gets no navigation entry, because a page entry opens the page with no record id. `home`, `app`, `utility` and `list` pages are still added to every app that can take them. When the publishing screen holds no page body (Publish all), the page is read by name once to learn its type; if that read fails, the page is left out of navigation and the error toast says navigation was not updated.
- **A sealed managed app is not written.** An app a managed package ships (`_provenance: 'package'` on the app read, as the stock showcase serves `showcase_app`) is sealed: the server refuses a package-less write with `403 NOT_OVERRIDABLE`. Navigation writes now skip such an app, so publishing a page no longer shows a red "Failed to update navigation" toast for it. Apps stored at runtime, including apps of a package authored at runtime, are written as before. Any other failure of an app write still shows the error toast.
