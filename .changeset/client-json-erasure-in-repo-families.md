---
"@objectstack/client": minor
---

fix(client): bind the five in-repo `return res.json()` methods, whose published type was `Promise< any >` (part of #12104)

**BREAKING** return-type narrowing on five already-published SDK methods,
shipped as `minor` under the repo's launch-window convention for breaking
changes. No runtime behaviour changes — the values these methods resolve to are
byte-identical before and after; only their DECLARED types move off `any`.

> ⓘ Angle brackets are spaced throughout (`Promise< any >`) on purpose —
> GitHub's body sanitizer strips tag-shaped spans, backticks and fenced code
> included.

Each of the five carried no return annotation and ended `return res.json()`, so
its published type was `Promise< any >`, inherited from `lib.dom`'s
`Response.json(): Promise< any >`. The method text names neither `any` nor
`Promise` nor `unwrapResponse`, which is why the class was invisible to the
greps two earlier censuses used.

FROM (all five): `Promise< any >`

TO:

| method | now returns | why |
|---|---|---|
| `analytics.query` | `BaseResponse & { data: AnalyticsResult }` | dispatcher-served; `deps.success(v)` wraps, `res.json()` strips nothing |
| `analytics.meta` | `AnalyticsMetadataResponse` | same envelope; `data` is the bare `CubeMeta[]` projection |
| `analytics.explain` | `AnalyticsSqlResponse` | same envelope; `data` is `{ sql, params }` |
| `automation.trigger` | `BaseResponse & { data: AutomationResult }` | same envelope; the payload its sibling `automation.execute` unwraps |
| `analytics.queryDataset` | `AnalyticsResult` | served by `@objectstack/rest`, which answers `res.json(result)` — no envelope |

**What breaks.** Nothing that was already reading these correctly. `any`
accepted every read, so code that treated `analytics.query(...)` as if it were
the payload — `(await client.analytics.query(q)).rows` — compiled and was
`undefined` at runtime; it is now a compile error naming the envelope. The
remedy is the read the wire always required: `.data.rows`. The one method that
moves the other way is `queryDataset`, which is served BARE — a caller reading
`.data` off it was likewise reading `undefined`, and that read is now refused
too.

Every shape above was measured by driving the real producers (a real
`AnalyticsService`, a real `AutomationEngine`, the real `HttpDispatcher` and the
real `RestServer`, with only the socket stood in for), not by reading source or
asserting against a mock.

Scope: the five families whose producers live in this repo. The 38
better-auth-backed `auth.*` / `organizations.*` / `oauth.*` methods of the same
class are untouched and remain ledgered.
