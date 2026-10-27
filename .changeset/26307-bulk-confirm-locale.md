---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a bulk action's confirm sentence formats its numbers and dates in the viewer's display locale

Clause-②: no
Metadata-protocol: none

A bulk `confirmText` such as `Set the amount to {{ amount | currency:EUR }} on {{ count }} records?` formatted its numbers and dates in `en-US` for every viewer, while the same action's single-record confirm formats them in the viewer's language. `BulkActionDialog` now reads `useDisplayLocale()`, the locale every date, number and currency renderer and the console's action runners read, and `bulkConfirmText` takes it as an optional third argument, handed to `fillTemplateHoles`'s locale channel apart from the template roots. A German viewer reads `1.234.567,50 €`; with no locale handed, the sentence formats in `en-US` as before.

What to do: nothing.
