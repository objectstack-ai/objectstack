---
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

fix(plugin-list): the list toolbar shows a view's sharing type and lock owner as read-only text instead of a Share button that did nothing

Clause-②: no
Metadata-protocol: none

A list view declaring `sharing` drew a ghost "Share" button with no click handler: clicking it opened nothing and sent nothing, and `sharing.lockedBy` was never shown anywhere. No view-sharing control or endpoint exists for the button to open, so it is now a non-interactive indicator:

- **The sharing type**, localized: "Personal view" for `type: 'personal'`, "Shared view" for `type: 'collaborative'`.
- **The lock owner**, when `sharing.lockedBy` is set: a lock icon and "Locked by USER", with `lockedBy` rendered as written (the spec declares it a free string naming the user who locked the view configuration).
- The tooltip carries both, so the narrow toolbar, which hides the text, still says them.

New `list.*` keys `sharingPersonal`, `sharingCollaborative` and `sharingLockedBy` ship in all ten `@object-ui/i18n` locale packs and in the plugin's English defaults. The element keeps its `share-button` test id.
