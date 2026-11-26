---
'@object-ui/fields': patch
---

fix(fields): on a phone a lookup's candidates open in a bottom drawer that scrolls by touch

Clause-②: no
Metadata-protocol: none

On a phone a create or edit form fills the screen as a modal dialog, and a lookup's candidate list opened in a small dropdown rendered outside that dialog. The dialog's scroll lock cancelled every touch move on it, so the list could not be scrolled by touch, and with the keyboard up the dropdown flipped above the field and showed only three or four rows.

Below the phone breakpoint (the width at which the search-first people picker already switches to a sheet) the candidate list now opens in a bottom drawer titled with the field's label: the search box at the top, the candidates scrolling by touch in the middle, and quick-create and "show all results" pinned at the bottom. The drawer follows the on-screen keyboard, and the search box is not focused when it opens, so the keyboard comes up only when the user taps it. Quick-create shows under the same rule as on the desktop: only when the field offers it and the user may create the target record. Picking a candidate fills the field and closes the drawer. The desktop dropdown and the list cell's editor are unchanged.
