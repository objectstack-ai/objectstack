---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): favourite conversations open in the assistant drawer in place, from the sidebar's Favorites

Clause-②: no
Metadata-protocol: none

- **A conversation can be a favourite.** `FavoriteItem` gains the `conversation` type, id `conversation:ID`, with the conversation's id and agent (`conversationId`, `agent`); its `href` is the conversation's `/ai…` address. `conversationFavoriteItem` builds the entry. Conversation favourites count against the same cap of 20 as the other content favourites.
- **The sidebar row opens the drawer in place.** A favourite conversation is a row of the sidebar's Favorites section, with the chat-bubble icon. Clicking it opens the assistant drawer on that conversation, the way its history row does, and the page stays where it is. The address is followed only where no drawer can take it: a page without the drawer, the app's AI inquiry page, or a click that opens a new tab.
- **The label follows the conversation.** The sidebar reads each favourite conversation once and keeps the label its history row shows (the server's title, else the latest message the user wrote).
- **A deleted conversation is marked.** A conversation the server answers is gone, or is not this user's, is drawn struck through as unavailable (`sidebar.conversationUnavailable`, new in every pack), opens nothing, and is still removed from its ⋯ menu. A failed read of any other kind marks nothing.
