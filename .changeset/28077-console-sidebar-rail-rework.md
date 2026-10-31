---
'@object-ui/app-shell': patch
---

fix(console): the narrow-window sidebar rail draws no expanded first frame, folds on one Esc, and keeps the wide-window choice apart

Clause-②: no
Metadata-protocol: none

Three fixes to the console sidebar's icon rail below 1416 px:

- **No expanded first frame.** A load on a narrow window drew the expanded sidebar once and then folded it, because the sidebar started from the state the last page saved. The console now hands the sidebar the rail before it first draws, so every frame from the first one is the rail. At 1416 px and above nothing changes.
- **One Esc folds the overlay.** With the pointer on an entry, or focus on an entry or on "Keep sidebar open", the first Esc went to the entry's hidden tooltip and the overlay stayed open until a second Esc. One Esc now folds it; an entry's open menu still takes the Esc first.
- **The wide-window choice is kept apart.** Turning "Keep sidebar open" on and off on a narrow window no longer changes the expanded or collapsed sidebar the reader chose on a wide window, across a resize and a reload. Only an open or close on a wide window is kept as that choice.
