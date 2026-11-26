---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): 「Edit app」 turns on a design mode in the running app instead of opening Studio

Clause-②: yes (widening)
Metadata-protocol: none

An administrator who may design the app (a workspace admin holding `manage_metadata`, on a writable package: the gate 「Edit app」 always had) now presses 「Edit app」 in the page header to turn on the app's design mode, in place. A bar across the top of the window says 「Design mode」 and offers 「Cancel」 and 「Save」, and nothing else. The mode stays on from page to page of the app and goes off when the app changes; it is never on a phone. While it is on, the sidebar shows the app's own menu without the person's Favorites.

The mode is the extension point the next design-mode surfaces (menu editing, the page header's pinned actions) stage their changes through: 「Save」 writes every staged change and leaves the mode, 「Cancel」 drops them all. 「Save」 is off while nothing is staged. While a change is staged, closing or reloading the tab, a link out of the app and the app switcher ask first; a link to another page of the app does not. This release stages nothing yet.

A read-only package's app keeps its 「Open APP in Studio」 entry unchanged. New `@object-ui/i18n` keys: `designMode.title`, `designMode.leaveUnsaved`, `designMode.saveFailed`.
