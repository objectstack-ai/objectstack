---
"@objectstack/spec": patch
---

`App.defaultAgent` docblock: the agent route is the one chat door, and the console is what reads the key.

Clause-②: no

- The docblock no longer says the assistant chat endpoint (`POST /api/v1/ai/assistant/chat`) resolves this agent from `context.appName`. That route, with `GET /api/v1/ai/assistant` and `GET /api/v1/ai/assistant/skills`, was retired in the cloud AI runtime (objectstack-ai/cloud#2621, objectstack-ai/cloud#2651), and no server route reads `defaultAgent`.
- It now says who does read it. The console's chat dock hands the active app's `defaultAgent` to its one surface-to-agent resolver, which honours only `ask` or `build` (legacy aliases included) and otherwise falls back to the surface default. The resolved agent is then called by name on `POST /api/v1/ai/agents/:agentName/chat`, where the path segment, not this key, selects the agent.
- The ADR-0063 surface-binding paragraph and the rule that only the two platform agents resolve are unchanged, as is the note that the bare `POST /api/v1/ai/chat` resolves no agent.
- The docs page `ai/actions-as-tools` lists the agent route as the only in-product chat route.
- ⛔ No schema, parse, `.describe()`, export, type or accept-set change. The docblock ships in the published package, in the `dist/ui` and `dist/browser` JavaScript bundles and in the shipped `src/ui/app.zod.ts`, which is why this is a patch.
