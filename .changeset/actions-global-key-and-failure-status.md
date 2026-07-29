---
"@objectstack/runtime": minor
"@objectstack/client": minor
---

fix(actions): reach global actions at their real registration key, and 404 an action that never dispatched (#3913)

**1 — the registration key and the lookup key disagreed.** Both writers
register an objectName-less action under the literal `'global'`: `AppPlugin`
(`action.object || 'global'`) and `ObjectQLPlugin.actionObjectKey`. The REST
route's fallback probed `'*'`, and `engine.executeAction` is an exact-string
`Map` lookup with no wildcard semantics — so the probe could only ever miss:

```
Action 'log_call' on object '*' not found
```

`POST /api/v1/actions/global/log_call` worked by **accident** (the path segment
happened to spell the registration key); `POST /api/v1/actions//log_call` never
worked at all, and neither did falling back from an object-scoped route to a
global handler. `'global'` is now the canonical key
(`GLOBAL_ACTION_OBJECT_KEY`), the probe order is
`[<routed object>, 'global', '*']` for both the REST route and the MCP
`run_action` bridge (`actionHandlerObjectKeys` — one list, two surfaces), and a
single-segment path (`/actions//:action`) routes at `'global'` instead of
400-ing. A handler registered directly under `'*'` still resolves; the doc
comments that called `'global'` a "wildcard" are corrected at every site.

**2 — "no such action" was reported as a success.** The not-found exit called
`deps.success(...)`, which always emits `{status: 200, body: {success: true,
data}}`, so a request naming an action that does not exist came back as:

```json
{"success":true,"data":{"success":false,"error":"Action 'log_call' on object '*' not found"}}
```

Every caller that did not hand-unwrap the INNER envelope read the outer
`success: true` and reported a success that never happened — including the
shipped console, which showed a green toast (fixed on that side in
objectui#2963). Nothing **dispatched** there, so it is a **404** now, joining
the answers this route already gives a status: 403 denied, 400 wrong action
type, 503 unavailable. The miss also names the **routed** object rather than
whichever probe ran last (the old fallback said `on object '*'`, an object the
caller never asked for).

A handler that **ran and rejected** is unchanged: HTTP 200 with
`data: {success: false, error, code?, fields?}`. That is a business outcome,
not a transport error, and #3937 pins it. The line is "did a handler run" —
below it the payload, above it the status.

`client.actions.invoke` / `invokeGlobal` still do **not** throw. `client.fetch`
throws on every non-2xx, so `invoke` now catches and folds a dispatch failure
into the same `{ success, data?, error? }` result with `error` as a plain
string — otherwise the routes that just gained a status would have started
propagating exceptions into callers that only ever checked `result.success`.
