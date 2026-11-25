---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): a dashboard or a report opened from a Studio list opens in its app's edit state, and × goes back to the list

Clause-②: no
Metadata-protocol: none

Studio redesign (epic #36890), decisions 3, 6, 13 and 15.

- **Opening a dashboard or a report from a Studio list** opens its page in an app, with the dashboard's edit state or the report's builder already open, as the page's own Edit opens them. The app is the one the author came from, when that app is one of the package's published apps or its menu opens the item; otherwise it is the package's first published app. With no published app, on the cross-package list, or when the address asks the item page for a tab or the draft review, the item keeps opening Studio's generic item page.
- **× back to Studio.** The app page's address carries the Studio list it was opened from (`?studio=`, a new reserved console param, `STUDIO_RETURN_PARAM`). While it does, the dashboard page and the report page draw a × that goes back to that list with its filters and sort, after a reload too. The report builder's own × does the same. Leaving unsaved edits asks first.
- **New report from Studio's report list** opens the app's `/apps/APP/reports/new`. Closing it goes back to the Studio list, and the saved report's page keeps the way back. With no app to open, the list creates as before.
- **No dashboard edit on a phone.** The dashboard edit state is no longer offered on a window narrower than Tailwind's `sm` (640 px). A landing that asks for it, from Studio or the design mode, is cleared there and the page stays a viewer. The Edit button was already hidden below that width.
- New console strings under `studioReturn` in every bundled locale.
