---
"@objectstack/rest": patch
---

fix(rest): `/analytics/dataset/query` carries a producer-marked `userMessage` on its three hand-built terminals (#12710)

`POST /api/v1/analytics/dataset/query` (and its environment-scoped twin) builds
its error envelopes by hand and shares no exit with the `/data` door, so #9934's
producer-marked `userMessage` — a channel that door applies once at its exit,
branch-agnostically, through `withDeclaredUserMessage` — was applied at none of
them. A producer's caller-facing sentence reached the client on
`POST /data/:object` and vanished here for the identical throw.

**Scope is by ARM.** Four terminals live in that route's catch; three dropped
the mark and one did not:

| arm | envelope | before |
| :-- | :--- | :--- |
| ① declared 4xx ADR-0112 passthrough | hand-built `{ code, message }` | ⛔ no mark |
| ①b `classifiedRefusalAnswer` re-dress | `{ ...refusalFields, message }` | ✅ carried it |
| ③a declared 5xx relay | `declaredServerFaultAnswer`'s body, sent verbatim | ⛔ no mark |
| ③b generic `500 ANALYTICS_QUERY_FAILED` | hand-built `{ code, error }` | ⛔ no mark |

①b already carried it because its body comes from `resolveErrorResponse`, whose
arms ride the mark already. The other three hold no classification to ride on.

Measured on `4af6c4419` before the repair, one marked producer per arm, driven
through the real route against the flat `/data` door for the identical throw:

```text
throw { code: 'INVALID_FILTER', status: 400, userMessage: 'Check the filter…' }
  ① analytics : 400 {"code":"INVALID_FILTER","message":"…"}          — no mark
  /data door  : 400 {"error":"…","code":"INVALID_FILTER",
                     "userMessage":"Check the filter…"}              — mark carried

throw { code: 'READ_SCOPE_COMPILE_FAILED', status: 500, userMessage: '…' }
  ③a analytics: 500 {"error":"Internal server error",
                     "code":"READ_SCOPE_COMPILE_FAILED"}             — no mark
  /data door  : 500 {…, "userMessage":"…"}                           — mark carried

throw Error('[Analytics] no strategy can handle query …') + userMessage
  ③b analytics: 500 {"code":"ANALYTICS_QUERY_FAILED","error":"…"}    — no mark
  /data door  : 500 {"code":"INTERNAL_ERROR","userMessage":"…"}      — mark carried
```

Nothing invalid shipped — every body parsed as `ApiErrorSchema`, which already
declares the optional field — and that is what made the loss silent and
one-directional: a console told by ADR-0112 to render `userMessage` verbatim
found nothing at these three arms and fell back to its generic substitution, for
the same throw the twin door rendered.

**What callers see change:** exactly one optional key is ADDED, and only when
the producer marked one. No existing key moves or changes value, at any of the
four arms — pinned as an explicit key-order assertion per arm for an unmarked
producer.

The value comes from `boundedDeclaredUserMessage` (exported by #12693) —
`declaredUserMessage`'s presence answer with #5423's bound applied — resolved
once for the whole catch rather than at each terminal, so this door has one
answer to "is there a mark, and how long may it be" and shares it with `/data`
rather than copying it. ①b is deliberately untouched: a second application there
would be one rule applied twice.

**Unchanged:** the prose withhold (#5367/#5437/#5811) — a declared server fault's
message is still replaced by the generic sentence and still reaches the operator
in full through the `logError` line that runs before every arm; the statuses and
`code`s all four arms answer; and #5667's tiering, which leaves a self-authored
undeclared fault readable.

**Not reachable from in-repo producers today.** Censused at claim: no package
under `packages/services/**` sets a `userMessage` of any kind, and
`service-analytics` dispatches no sandbox hook, so the QuickJS side-channel — the
other in-repo carrier — does not reach this door either. This wires up a declared
channel the published contract already promises on this route's envelope; the
intended producer is an app author's analytics datasource or strategy.
