---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the AI inquiry page keeps a conversation it could not check, reads it once, explains an app without a package, and reads previews only for the conversations it lists

Clause-②: no
Metadata-protocol: none

- Opening the page with `?c=` asks the server whose conversation that is. A failed answer (a network error, a 5xx) used to read as "not this app's", so the page dropped `?c=` and opened its home state. Now only a definite answer does that (a 403 or 404, or another app's conversation). A failed check keeps `?c=` and shows "Couldn't open this conversation" with Try again and New conversation.
- When the conversation is this app's, the check's read now also fills the thread, so opening it reads the history once instead of twice. `useChatConversation` takes `activeRecord`: the host's read of `activeId`, used by the first resolve of that id.
- An app with no package (`_packageId`) has nowhere to keep the page's conversations. The page now says so instead of drawing a question box that could not start one.
- The empty conversation keys its suggestions by position, so an entry that declares the same question twice draws both with no React key warning.
- `useConversationList` takes `selectBackfillRows`: the rows the caller shows, the only ones whose missing previews are read from each conversation's detail route. The page's recent conversations pass the rows they list (at most five), so returning to the home state reads at most five details, not up to twenty.
- `@object-ui/i18n`: five `console.ai.askPage` keys for the two new states, in every locale.
