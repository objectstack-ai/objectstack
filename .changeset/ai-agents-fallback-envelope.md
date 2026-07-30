---
"@objectstack/runtime": patch
---

fix(runtime): the `/ai/agents` degraded fallback answers in the declared envelope (#4053)

`GET /ai/agents` was the last unenveloped SDK-addressable route. The framework's
degraded fallback — what an open-source runtime with no `service-ai` answers —
now returns `{ success: true, data: { agents: [] } }` via `deps.success`, and the
route-envelope guard's last ratchet retires with it: **0 ratcheted on both
surfaces.**

## Why `data: { agents }` and not `data: []`

#3983 set the precedent that `data` carries the payload directly, and following it
here would have looked consistent. It would also have been wrong, and silently so.

`AiAgentsResponseSchema` is a **declared** payload schema; share-links' `{ links }`
was an ad-hoc wrapper with none. So this is the #3843 relocation — the declared
payload moves under `data` unchanged, the way `SettingsNamespacePayload` did —
rather than a reshape.

That distinction decides the blast radius. `unwrapResponse` returns `body.data`
when a body has a boolean `success` **and** a `data` key, so:

| conversion | `client.ai.agents.list()` |
|---|---|
| `data: { agents }` (this one) | reads `.agents` off it — **works** |
| `data: [...]` (flattened) | `.agents` is `undefined` → **`[]`** |

An empty list is not a visible failure on this route. `useAiSurfaceEnabled` gates
the entire AI surface on `agents.length > 0`, and an empty catalog is the *correct*
answer for a seat-less user (ADR-0068) or a Community-Edition deployment. The
broken state and the legitimate one are indistinguishable — no error, no 403, no
log.

## Consequence: no lockstep

Because the SDK reads both shapes identically, **each surface converts on its own
schedule**. Cloud's `service-ai` still answers unenveloped and keeps working
unchanged; objectui already reads all four shapes (objectui#2992). The
"three repos in one batch" framing #4053 opened with does not apply to this
variant.

Five tests in `@objectstack/client` pin it, including the road not taken: the
flattened body asserts `[]`, so the cost of choosing it is recorded rather than
rediscovered.
