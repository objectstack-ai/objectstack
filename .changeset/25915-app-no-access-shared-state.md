---
'@object-ui/app-shell': patch
---

fix(app-shell): the "nothing in this app is available to you" screen is drawn by the shared `DataEmptyState`

Clause-②: no (one block swaps its own markup for the shared components; no exported type change. If a shared component needs a new prop, the thread reports first and the seat amends this line)
Metadata-protocol: none

The screen an app's root shows when the app serves the caller no navigation, or names only objects the caller may not read (`AppNoAccessEmptyState`), now uses `DataEmptyState` from `@object-ui/components` instead of the `Empty` primitive with a hand-copied icon square. It is announced to assistive technology as `role="status"`. The text, the Open Setup link, the test ids and the `data-reason` attribute (now on the status node) are unchanged; the title takes the shared component's smaller size.
