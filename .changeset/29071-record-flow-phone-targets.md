---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
'@object-ui/components': patch
---

fix(plugin-detail, app-shell, components): the record page's controls are 44 px touch targets at phone width, the inline-edit pencil shows on a touch screen, and the phone's back link leaves no copy of the record behind it

Clause-②: no
Metadata-protocol: none

The mobile app hosts the Console in a WebView, so a phone user gets the record page at 375 or 390 px wide. Driven there on the CRM and showcase examples, the page did not scroll sideways, its dialogs and menus fit the screen and the keyboard left the focused field in view, but most of its own controls were smaller than a finger: the record tabs and their `+N` menu (36 px), the related card's header controls (24 px) and rows (32 px), the related list's toolbar, filter and paging, the timeline's chips and "Write a note…" box, the comment toolbar (28 px), "Show N empty fields", the inline save bar (36 px), the bottom action bar (40 px), the phone's back link (28 px) and the top bar's next and previous buttons (28 px), the copy-record-ID button (20 px), the attachments Upload button, the declared action buttons and their parameter dialog's Cancel and Confirm. The inline-edit pencil, in the details body and in the header strip, was drawn at opacity 0 until hover, and a touch screen has no hover, so a phone showed no way into inline edit. The back link 「‹」 pushed the list as a new history entry, so the browser's Back after it opened the record again.

Below `sm` each of them is now at least 44 px, through the spellings the code already uses for its phone faces (`h-11 sm:h-N`, `min-h-[44px] sm:min-h-0`), and the pencil is always drawn on a coarse pointer. The back link replaces the record's history entry instead of pushing a new one, so Back after it leaves the record; a page pushed from a parent record still goes back in the history as before. From `sm` up every control keeps its size, and a mouse still reveals the pencil on hover. No key, prop, export or breakpoint is added.

What to do: nothing.
