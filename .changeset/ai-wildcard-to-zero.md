---
"@objectstack/runtime": patch
---

test(client,runtime): the last wildcard was wrong evidence, not weak — AI ratchet 3 → 0 (#3718)

The capstone (#3642) ratcheted "matched only by a `**` family" as weaker
evidence, to be driven down by enumerating each dynamic family. 60 → 3 after
#3656. The last 3 were `ai.nlq` / `ai.suggest` / `ai.insights` on `* /ai/**`.

Enumerating that family (in `cloud`, where `service-ai` lives) showed the
wildcard had not been weak evidence but **wrong** evidence. `buildAIRoutes()`
mounts 12 routes — `chat`, `chat/stream`, `complete`, `models`, `status`,
`effective-model`, six `conversations` — and **none** is `/nlq`, `/suggest` or
`/insights`. The SDK's entire AI namespace is dead, the entire real AI surface
is unexpressed by the SDK, and the two sets are disjoint (#3718).

The old row's note even claimed the client "expresses nlq/suggest/insights
against the REST AI routes". That was never verified and is false:
`DEFAULT_AI_ROUTES` declares them but has no runtime consumer (only the spec's
own test reads it), and `aiNlq?`/`aiSuggest?`/`aiInsights?` are optional
protocol methods nothing implements.

`/api/v1/ai/` becomes a bounded prefix exemption alongside the control plane —
two cross-repo surfaces, both ledgered in `cloud` — and the wildcard-only
assertion becomes `toBe(0)`, not a ratchet: every matched call now rests on an
exact enumerated route. Mutation-checked in both directions (removing the
exemption re-exposes exactly the 3, and the pre-change count was verified to be
exactly those 3 and nothing else).

Test-and-comment changes only; no runtime behaviour is affected.
