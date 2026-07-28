---
"@objectstack/client": major
"@objectstack/spec": major
---

feat(client,spec)!: the SDK's `ai` namespace now expresses the AI surface that exists (#3718)

`client.ai` and the AI service were **disjoint sets**. The namespace held three
methods — `nlq`, `suggest`, `insights` — whose URLs no repo has ever mounted
(removed in v17), while `service-ai` mounted 12 routes the SDK could not reach
at all. v17 closed the first half by deleting the dead methods. This closes the
second: the SDK now reaches every route that is meant to be tenant API surface.

| SDK | Route |
|---|---|
| `ai.chat(request)` | `POST /api/v1/ai/chat` — forces `stream: false`, so the JSON mode is what you get |
| `ai.chatStream(request)` | `POST /api/v1/ai/chat` — `AsyncIterable` of UI Message Stream frames |
| `ai.complete(request)` | `POST /api/v1/ai/complete` |
| `ai.models()` | `GET /api/v1/ai/models` — the ADR-0028 plan-filtered picker list |
| `ai.conversations.create/list/get/update/delete/addMessage` | the six `/api/v1/ai/conversations` routes |

`ai.chatStream` returns a promise for an async iterable rather than being an
async generator, so the request is issued — and an HTTP error thrown — when you
call it, not when you first iterate.

**Where the server is.** `service-ai` is a Cloud/EE package in the `cloud`
repo; this repo only proxies `/api/v1/ai/**` and 404s `AI service is not
configured` without it. Check `discovery.services` before calling, exactly as
for any other plugin-provided namespace. For a React chat UI, `useChat()`
(`@ai-sdk/react`) is still the better client — it speaks the same protocol
`ai.chatStream` parses and owns message state; these methods are for callers
that are not components.

**Breaking — the spec's dead AI declarations are retired.** All three had no
implementation anywhere and no runtime consumer:

- `Ai{Nlq,Suggest,Insights}{Request,Response}[Schema]` → replaced by the wire
  shapes of the real routes: `AiChat{Request,Response}`, `AiStreamChunk`,
  `AiCompleteRequest`, `AiModelsResponse`, `AiConversation`, `AiMessage`,
  `{Create,List,Update}AiConversation*`. The six retired JSON Schemas are
  dropped from `json-schema.manifest.json` (deliberate retirement, #2978).
- `DEFAULT_AI_ROUTES` → deleted, and `getDefaultRouteRegistrations()` returns 8
  groups instead of 9. It declared the three phantom endpoints and had no
  runtime consumer; re-declaring the real ones here would recreate the same
  illusion, since they are mounted from another repo.
- `AiProtocol` (`aiNlq?` / `aiSuggest?` / `aiInsights?`) → deleted. Nothing
  implemented it and nothing dispatched through it. The real server contract is
  `IAIService` + `IAIConversationService` in `@objectstack/spec/contracts`.

**The guard.** `/api/v1/ai/` becomes a bounded prefix exemption in the capstone
(#3642) alongside the control plane — bounded from both ends: only `ai.*` may
use it, and the namespace must still be reaching it. That is not a
wave-through. The reachability check lives where the routes are:
`cloud`'s `packages/service-ai/src/ai-route-ledger.conformance.test.ts` reads
the table `buildAIRoutes()` returns and drives this SDK against it, so an
`ai.*` URL that stops resolving fails a test in the repo that mounts it. The
wildcard-only bound stays **0** — these URLs never touch the `* /ai/**` row,
which is what certified three dead methods for years.

The four replaced client tests are worth naming: they mocked `fetch` and
asserted the URL the client *built*, never that anything answered it, and
passed for years against endpoints that did not exist. The new ones assert only
what this repo can honestly know — verb, path, and the body decisions the SDK
makes for you (`stream: false` on `chat`, the 204 on `delete`, SSE frame
parsing) — and leave "does it resolve" to the ledger next to the routes.
