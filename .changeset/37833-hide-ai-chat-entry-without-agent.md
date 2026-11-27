---
'@object-ui/app-shell': patch
'@object-ui/plugin-chatbot': patch
---

feat(app-shell): the `ai:chat` menu entry is hidden from a member who cannot get an agent, and the app's home falls to the next entry

Clause-②: no
Metadata-protocol: none

An app's AI inquiry entry (`type: 'component'`, `componentRef: 'ai:chat'`) is now shown only to a member the access-filtered agent catalog (`GET /api/v1/ai/agents`) serves at least one agent. On a deployment with no AI, or for a member with no AI seat, the entry is left out of the sidebar, the phone's app menu, the command palette and the `nav:menu` block. If it was the app's home, the home is the next entry the member is shown.

- **A declared `landing`** still comes first. A landing entry whose `item` is the `ai:chat` entry is passed over for such a member, like any entry the member is not shown: the next declared entry that holds lands, and with none the first entry shown lands.
- **While the catalog is loading** the entry is not drawn, and the app root waits on its loading skeleton instead of opening the page or the next entry. It lands once the catalog answers, so the home never opens one page and then jumps to another.
- **A direct link to the page** is not redirected. The page draws its "AI assistant unavailable" state.
- The catalog is read only while an app in the list carries an `ai:chat` entry. Apps without one read nothing new.
- `useAiSurfaceEnabled` takes an optional `{ enabled }` and no longer reports loading for ever when the catalog is empty and is answered from the session cache. Before, a member with no seat who opened the `ai:chat` page after the console had read the catalog saw a blank loading page and never the unavailable state.
- `@object-ui/plugin-chatbot`: `useAgents` returns `settled`, true once a catalog read for the current `apiBase` has answered or failed. The fields it already returned are unchanged.

Nothing to migrate.
