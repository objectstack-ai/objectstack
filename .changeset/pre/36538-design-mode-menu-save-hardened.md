---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): the design mode's menu save refuses an unreadable stored app, pins its publish, and keeps own entries out of another package's group

Clause-②: no
Metadata-protocol: none

The menu editor of the console's design mode, and its 「Save」, are hardened in eight places:

- Two id-less menu entries of one group with the same type and target (two separators, say) are matched to their own served copies: an entry the reader was not shown (other `requiredPermissions`) no longer takes the key of the one shown, so removing the shown entry removes it, not the hidden twin. Twins equal in every key are matched by their place.
- A stored read that holds no app (the layered read answers a 404 as an empty view) refuses the save, and the bar says why, instead of writing an app of the menu additions alone. On entry such a read no longer marks every entry as another package's.
- The publish is pinned to the published row the save was composed over (the `/layers` read's `overlayVersion`, sent as `If-Match`, or `If-None-Match: *` where no row is stored), read at the address the publish writes. A publish somebody lands in between is refused, the draft is discarded and the bar says so; saving again applies the edits over it. A server that serves no `overlayVersion` is published unpinned, as before.
- A group another package contributes is not offered by 「Move to group」, has no 「Add menu item」, takes no drop, and offers no 「Add an item before / after」 on its entries.
- An entry added at a group's end while the stored read is still pending is drawn before another package's entries once the read lands, where the save puts it.
- Space starts a keyboard move and Enter opens the entry's page; the editor's help line and its screen-reader instructions say so.
- A drop outside the menu moves nothing.
- The click that ends a pointer drag opens nothing however long the button was held after an Escape, and no click opens a link while a keyboard move is held.

`AppMenuSaveTexts` gains two optional sentences, `storedUnread` and `publishedMoved`; a caller that states neither is told the package sentence for the first and the server's refusal for the second. Nothing to migrate.
