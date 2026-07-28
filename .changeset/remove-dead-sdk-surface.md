---
"@objectstack/client": major
---

feat(client)!: remove the dead SDK surface — the `ai` namespace and `projects.listTemplates` (#3718, #3702)

Four public methods are gone. Every one of them built a URL that **no server in
any repo has ever mounted**, so every call 404ed from the release that shipped
them:

| Removed | Built | Why it never worked |
|---|---|---|
| `client.ai.nlq` | `POST /api/v1/ai/nlq` | declared in `DEFAULT_AI_ROUTES`, which has no runtime consumer; `aiNlq?` is an optional protocol method nothing implements |
| `client.ai.suggest` | `POST /api/v1/ai/suggest` | same |
| `client.ai.insights` | `POST /api/v1/ai/insights` | same |
| `client.projects.listTemplates` | `GET /api/v1/cloud/templates` | never mounted by the control plane; templates are a filtered `sys_package` view, not a route |

All four were found by the #3563 route audit's cross-repo guards, which match
the URL each SDK method *builds* against the routes each surface *mounts* —
`projects.listTemplates` by the control-plane ledger (#3655) and the three
`ai.*` by the AI ledger (#3718), both in `cloud`.

**Removed rather than deprecated.** A typed method that always throws is worse
than no method: it costs a runtime round-trip to discover, where absence is a
compile error. Nothing can depend on the old behaviour, because there was none
— no working code breaks.

This lands in the v17 major that `@objectstack/client` is already taking, which
is the right window for removing public API rather than a reason to defer it.

**What the AI surface actually is.** `service-ai` (Cloud/EE) serves 12 routes —
`chat`, `chat/stream`, `complete`, `models`, `status`, `effective-model`, and
six `conversations` routes. The SDK expressed none of them, so its `ai`
namespace and the real AI surface were disjoint sets. Expressing the real one
is tracked on #3718 as **new** API, not as a rename of what was removed. For
chat, `useChat()` (`@ai-sdk/react`) already speaks the Data Stream Protocol
`POST /api/v1/ai/chat` serves.

`Ai{Nlq,Suggest,Insights}{Request,Response}` are still re-exported from
`@objectstack/spec/api`, so anyone holding those types keeps them while the
spec still declares them; retiring the spec-side declarations is a separate
change.

Docs corrected in the same pass — `client-sdk.mdx` carried three
copy-pasteable examples that 404ed, and `plugin-endpoints.mdx` had the AI
surface inverted (it tabled the three phantom routes and explicitly denied
`/ai/chat`, which is mounted).
