---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): an app's AI inquiry page — the `ai:chat` menu entry opens a home for asking, and the drawer stays closed there

Clause-②: no
Metadata-protocol: none

An app can now put the platform's AI inquiry page on its menu, as ui ADR-0057 Amendment A4 records: a `type: 'component'` navigation entry with `componentRef: 'ai:chat'`. Placed first, it is the app's home. Before, that entry drew "Component not registered".

- **Home state.** The entry's `params` (`AiChatNavParamsSchema`, `@objectstack/spec/ui`) give the welcome title and subtitle, the question box's placeholder and up to four suggested questions; a key the entry omits falls back to neutral platform copy, and nothing is read from the URL. A static badge says answers prefer this app's data. Clicking a suggestion asks it.
- **Conversation.** The first question turns the same page into the conversation, with the platform `ask` agent (a maker gets `ask` here too), bound to the app's package (`context.activeApp`) under the conversation key `app:PKG:ask`. The conversation create sends `metadata: { activePackageId: PKG }`, and the page's address carries `?c=ID` from then on, so a reload restores it. A `?c=` that names a conversation that is not the caller's, or that this app's page did not create, opens the home state: no error, and nothing of it is shown. "New conversation" returns to the home state.
- **No second conversation on the page.** While the page is the active route the assistant drawer is closed, the top-bar robot is not drawn, and Ctrl/Cmd+Shift+I opens nothing; a build hand-off from the page still opens the drawer. On every other page the drawer is as the user left it.
- **No AI for this person** (no AI on the deployment, or no seat): the page shows the existing "AI assistant unavailable" state.
- `useChatConversation` takes an optional `createMetadata`, the `metadata` its first-send create carries; every other caller still sends an empty body.
- `@object-ui/i18n`: one new string, `console.ai.askPage.scopeBadge`, in every locale.

Nothing to migrate.
