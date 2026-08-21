---
"@objectstack/client": minor
"@objectstack/rest": minor
"@objectstack/runtime": minor
---

The `/meta` FSM state route is singular: `meta.getLegalNextStates` moves, the plural registration is retired (#10077)

Step 2 of the #9180 ruling — the `/meta` type segment is always singular, no
exception and no tolerated plural alias. Maintainer re-weigh, 2026-08-17,
verbatim: 「② 照原样做；只需要修正 objectstack objectui cloud 中错误的写法。」

- `client.meta.getLegalNextStates(object, field, from?)` now requests
  `GET /api/v1/meta/object/:name/state/:field`. Same method, same arguments,
  same response body — only the path segment changes.
- `GET /api/v1/meta/objects/:name/state/:field` is **no longer registered**.
  The singular twin has been mounted alongside it since #7526, so the
  migration for a hand-rolled HTTP caller is to drop the `s`. A request to the
  retired spelling now gets the transport 404, which is the loud answer; the
  one shape that changes hands rather than 404ing is a field literally named
  `published`, which the compound `/:type/:section/:name/published` route
  picks up.
- The two route ledgers follow what is mounted and what the SDK calls: the
  plural row is deleted from `rest-route-ledger.ts` and the dispatcher ledger's
  mirror row is respelled.

**What this does not change.** The boundary fold `META_URL_TO_SINGULAR` is
untouched, so no `/meta/:type/...` spelling that is accepted today becomes
refused: the retired route matched a **literal** path segment and never
consulted the fold. The 2026-08-17 re-weigh (item 3) defers that break with no
scheduled window. The legacy dispatcher branch in `runtime/src/domains/meta.ts`
also still matches both literals; narrowing it is not part of this step.
