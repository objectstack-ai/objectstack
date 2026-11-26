---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): the agent list, the model picker, the pending-approvals inbox and in-chat approvals send through the host's authenticated fetch, so a session held by its sign-in token alone sees its agents and can approve

Clause-②: no
Metadata-protocol: none

`useAgents`, `useAiModels`, `usePendingActions` and `useHitlInChat` asked the AI service with the session cookie only. A session held by its sign-in (bearer) token alone on the console's own origin (for example, a session cookie the browser blocked as third-party) was refused there: no agents, no models, an empty approvals inbox, and an in-chat approval that failed. They now send through the host's authenticated fetch, the `apiFetch` a host hands `SchemaRendererProvider` (the console's sends the stored token), as the renderers' own reads already do. The session cookie is still sent, a cookie session behaves exactly as before, and in the console a refused request now reaches its session-ended check. A host that mounts no provider keeps the plain `fetch`, as before. Where a host points these requests at another origin (an AI service or server URL configured off the page's origin), the host's fetch still sends them without the token; that layout is not fixed here. The hooks' options are unchanged in shape; in the console, a stored token now takes precedence over an `Authorization` passed in `headers`, and the host's tenant and language headers ride these requests too.
