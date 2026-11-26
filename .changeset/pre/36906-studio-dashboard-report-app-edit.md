---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): a dashboard or a report opened from a Studio list opens in its app's edit state, and × goes back to the list

Clause-②: no
Metadata-protocol: none

Studio redesign (epic #36890), decisions 3, 6, 13 and 15.

- **Opening a dashboard or a report from a Studio list** opens its page in an app, with the dashboard's edit state or the report's builder already open, as the page's own Edit opens them. The app is the one the author came from, when that app is one of the package's published apps or its menu opens the item; otherwise it is the package's first published app. The item keeps opening Studio's own item page when the package has no published app, on the list of every package, when the item has no published version yet (a draft only), or when the link asks for one of the item page's tabs or its draft review.
- **× back to Studio.** The page's address remembers the Studio list it was opened from, so the dashboard page and the report page draw a × that goes back to that list with its filters and sort, after a reload too. The report builder's own × does the same. Leaving unsaved edits asks first.
- **New report from Studio's report list** opens the app's New report page. The report is saved in the package the list shows, or, for an installed app, in its customization package, so it appears in the list × goes back to. Where the installed app's customization package cannot be used, New goes back to the list, as before. If that package becomes unusable between opening the page and saving, the report is saved outside any package, and a notice says the Studio list does not show it. Closing the page goes back to the Studio list, and the saved report's page keeps the way back. With no app to open, the list creates as before.
- **A dashboard made in Studio** opens in its app once saved, and the browser's Back from there goes to the list, not to an empty New page.
- **The report builder's ×, and the New report page's ×,** now ask before dropping unsaved edits everywhere, not only when Studio opened them.
- **No dashboard edit on a phone.** The dashboard edit state is no longer offered in a phone-width window (narrower than 640 px). A link that asks for it, from Studio or the design mode, is ignored there and the page stays a viewer. The Edit button was already hidden at that width.
- New console strings under `studioReturn`, and `report.builder.savedOutsideApp`, in every bundled locale.
