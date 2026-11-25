---
'@object-ui/console': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the first-run checklist asks for the organization's basics in one form, leaves the rest optional, and follows the administrator as a 「Get started n/m」 pill in the sidebar

Clause-②: yes (widening)
Metadata-protocol: none

The administrator's first-run checklist had five setup rows that each saved on their own (the organization's name, language and country, timezone, currency) and counted every row, so it only went away once mail, invitations and AI were set up too. Following the maintainer's ruling on objectstack#36739:

- **One form, one save.** A single 「Organization basics」 row opens one form with the organization's name, default language, country, timezone and currency. Values the server does not hold yet are suggested from the browser, and a setting with neither a value nor a suggestion must be filled in like the name; nothing is written until Save, which renames the organization (when the name changed) and writes the four settings in one call. A refused rename or a refused setting shows on its field, as before. The row is done once the organization has a real name and all four settings are set.
- **Only the basics are required.** Mail, invitations, the built-in AI provider and connecting an outside assistant become optional rows (marked 「Optional」); they still tick themselves when the server says they are done. On the hosted profile, 「Put in your first app」 stays required. The checklist is complete, and stands aside on Home, once the required rows are done; its progress (n/m) still counts every row.
- **A pill in every app.** For the administrator only, a 「Get started n/m」 pill sits at the bottom of every app's sidebar (on the folded icon rail it keeps its icon, with the count in its accessible name and tooltip). A press opens the checklist in place in a popover; the popover's X only closes it, and 「Hide on this device」 under the list hides the pill and Home's card. On a phone, which has no resident sidebar, the pill sits after the app's menu on the app's home page. It disappears once the required rows are done, or once the administrator hides it on this device.
- **Setup's first page keeps the full list**, done rows included, even after the checklist is complete or hidden; a completed list folds to one line with 「Show list」.

`@object-ui/app-shell` exports a product-neutral `SidebarFooterSlotProvider` (with its `SidebarFooterSlot` and `SidebarFooterSlotPlace` types; places `'sidebar' | 'phoneAppHome'`) that the console fills; the shell names no checklist. `@object-ui/i18n` replaces the per-setting checklist strings in all eleven packs. Added under `console.firstRunChecklist`: `showList`, `hideHere`, `organizationBasics.{title,todo,name,nameRequired,prefilled,save,saved}`, `pill.{label,count,aria}`. Removed from `console.firstRunChecklist` (no reader is left in the console; a consumer that indexed them reads the new keys instead): `showDoneSplit`, `confirm`, `prefilled`, `organizationName.{title,todo,action}`, `languageCountry.{title,todo,saved}`, `timezone.{title,todo,saved}`, `currency.{title,todo,saved}`.
