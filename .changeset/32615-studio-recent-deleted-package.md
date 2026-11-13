---
'@object-ui/app-shell': patch
---

fix(studio): a deleted package leaves Studio's "Recently viewed" row, and no copilot opens beside a package that is not there

Clause-②: yes (widening) — `useRecentItems()` from `@object-ui/app-shell` gains `removeRecentItem(id)`; no `@object-ui/i18n` pack key is added.
Metadata-protocol: none

- The Studio landing lists a recent package only while the package list it already loads (`GET /api/v1/packages`, the same request, kernel packages included) still names it. A package deleted since the visit used to keep its card, labelled by its id, and opened an empty builder. The stored entry is kept: the list is the active organization's and the recent store is the user's, so a package that is only missing from this organization's list comes back when its organization is active again.
- Deleting a package from Studio's package sheet now also removes its entry from the recent store, once the refreshed package list comes back without it. A failed refresh still removes nothing, as it still navigates nothing.
- Opening the address of a package that is not installed already showed the "Package not found" state with a way back to the Studio landing. Its copilot was still mounted beside it and offered to edit the app. Neither the built-in copilot slot nor an injected `aiSlot` copilot is drawn there now.
