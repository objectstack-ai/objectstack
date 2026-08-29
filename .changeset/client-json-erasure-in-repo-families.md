---
"@objectstack/client": minor
---

fix(client): bind the five in-repo `return res.json()` methods, whose published type was `Promise< any >` (part of #12104)

**Return-type narrowing on a published SDK (clause-②).** No runtime change: the
value each method resolves to is byte-identical before and after. Only the
DECLARED type moved, off `any` — which is exactly why a runtime test cannot
observe it and the pins for it are type-level.

> ⓘ Angle brackets are spaced throughout (`Promise< any >`) on purpose —
> GitHub's body sanitizer strips tag-shaped spans, backticks and fenced code
> included.

Each of the five carried no return annotation and ended `return res.json()`, so
its published type was `Promise< any >`, inherited from `lib.dom`'s
`Response.json(): Promise< any >`. The method text names neither `any` nor
`Promise` nor `unwrapResponse`, which is why the class was invisible to the
greps two earlier censuses used.

## What each method declares now

| method | declared before | declares now | why |
|---|---|---|---|
| `client.analytics.query` | `any` | `BaseResponse & { data: AnalyticsResult }` | dispatcher-served; `deps.success(v)` wraps and `res.json()` strips nothing |
| `client.analytics.meta` | `any` | `AnalyticsMetadataResponse` | same envelope; `data` is the bare `CubeMeta[]` projection |
| `client.analytics.explain` | `any` | `AnalyticsSqlResponse` | same envelope; `data` is `{ sql, params }` |
| `client.automation.trigger` | `any` | `BaseResponse & { data: AutomationResult }` | same envelope, over the payload its sibling `automation.execute` unwraps |
| `client.analytics.queryDataset` | `any` | `AnalyticsResult` | served by `@objectstack/rest`, which ends `res.json(result)` — no envelope |

`any` is assignable to everything and admits every property read, so a
consumer's code can stop compiling where it previously did not. Concretely:

- **Reading a payload key off one of the four ENVELOPED results.**
  `(await client.analytics.query(q)).rows` compiled and was `undefined` at
  runtime; the read the wire always required is `.data.rows`. Same for
  `.data` on `meta` / `explain`, and `.data.runId` / `.data.screen` on
  `automation.trigger`.
- **Reading `.data` off `queryDataset`**, which is served bare — likewise
  `undefined` today, likewise refused now.
- Assigning any of the five results to an unrelated annotation, or forwarding
  one to a differently-typed parameter.

That break is the point: those call sites are already wrong at runtime and the
`any` is what hid it. The compiler is the channel that reaches every affected
consumer, and it is strictly more precise than a release note.

## How the shapes were established

By DRIVING the real producers — a real `AnalyticsService`, a real
`AutomationEngine`, the real `HttpDispatcher` and the real `RestServer`, with
only the socket stood in for — not by reading source and not by asserting
against a mock. Two spec response types that look like the right binding are
NARROWER than the contract their route relays
(`AnalyticsResultResponseSchema.data.fields` and
`TriggerFlowResponseSchema.data`), so those two annotations bind the producer's
contract instead; the near-miss is pinned so a later sweep cannot retarget them.

## Scope

The five families whose producers live in this repo. The 38 better-auth-backed
`auth.*` / `organizations.*` / `oauth.*` methods of the same class are untouched
and keep their erased `any` — they are exactly as permissive as before, and no
consumer loses anything by that.

No ADR-0087 ledger entry: nothing here is a metadata surface. No Zod schema, no
`packages/spec` declaration and no stored representation changed — the erasure
lived only in a TypeScript return annotation — so `objectstack migrate meta` has
nothing to rewrite and an entry would have no artifact to project into. This is
the disposition #8140, #11925 and #12034 recorded for the same class of SDK
return-type narrowing.
