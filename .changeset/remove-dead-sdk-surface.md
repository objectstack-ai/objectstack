---
"@objectstack/client": major
---

feat(client)!: remove the `ai` namespace — three methods, none of which ever worked (#3718)

`client.ai` held exactly three methods, and **no server in any repo has ever
mounted the URLs they build**:

| Removed | Built | Why it 404ed |
|---|---|---|
| `client.ai.nlq` | `POST /api/v1/ai/nlq` | declared in `DEFAULT_AI_ROUTES`, which has no runtime consumer — only the spec's own test reads it; `aiNlq?` is an optional protocol method nothing implements |
| `client.ai.suggest` | `POST /api/v1/ai/suggest` | same |
| `client.ai.insights` | `POST /api/v1/ai/insights` | same |

Found by the AI route ledger (#3718, in `cloud`, where `service-ai` lives),
which enumerates the table `buildAIRoutes()` returns and matches the SDK's URLs
against it. The two sets are **disjoint**: the real AI surface is 12 routes —
`chat`, `chat/stream`, `complete`, `models`, `status`, `effective-model` and six
`conversations` routes — and the SDK expressed none of them.

**Removed, not deprecated.** A typed method that always throws is worse than no
method: it costs a runtime round-trip to discover, where absence is a compile
error. No working code can break, because there was no working behaviour. This
lands in the v17 major `@objectstack/client` is already taking, which is the
right window for a breaking removal rather than a reason to defer one.

Expressing the real surface is tracked on #3718 as **new** API, not a rename of
what was removed. For chat, `useChat()` (`@ai-sdk/react`) already speaks the
Data Stream Protocol `POST /api/v1/ai/chat` serves.

Also removed: the `AI_PLANE` exemption added to the capstone hours earlier
(#3727). With no method targeting `/api/v1/ai/`, an exemption there is a hole
with nothing to cover — the wildcard-only bound stays `0` and now reaches 0
with nothing exempted to get there.

The four AI tests in `client.test.ts` are **replaced, not deleted**. They were
the exact shape this audit keeps finding behind green suites: mock `fetch`,
assert the URL the client *built*, never assert that anything answered it. They
passed for years against three endpoints that did not exist. The replacement
asserts the one thing worth defending — the namespace is gone and must not
return without a route behind it.

`Ai{Nlq,Suggest,Insights}{Request,Response}` are still re-exported straight
from `@objectstack/spec/api`, so anyone holding those types keeps them.
Retiring the spec-side declarations is a separate change.

Docs corrected: `client-sdk.mdx` carried three copy-pasteable examples that
404ed, and `plugin-endpoints.mdx` had the AI surface **inverted** — it tabled
the three phantom routes and explicitly denied `/ai/chat`, which is mounted. It
now lists the 12 real ones.
