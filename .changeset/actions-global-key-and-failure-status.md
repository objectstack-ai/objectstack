---
"@objectstack/runtime": minor
"@objectstack/client": minor
---

fix(actions): reach global actions at their real registration key, and stop serving handler failures as HTTP 200 (#3913)

Two independent defects that compounded into "global actions are unreachable,
and when one fails you are told it succeeded".

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

**2 — every handler failure was wrapped as transport success.** Both the
success and the failure exit called `deps.success(...)`, which always emits
`{status: 200, body: {success: true, data}}`. So any failure — a denial, a
missing action, a deliberate `throw` in an action body — went out as:

```json
{"success":true,"data":{"success":false,"error":"Action 'log_call' on object '*' not found"}}
```

Every caller that did not hand-unwrap the INNER envelope read the outer
`success: true` and reported a success that never happened. Failures now exit
through the dispatcher's error path with a real status:

| Failure | Status |
|:---|:---|
| No handler registered under any key | **404**, naming the routed object rather than whichever probe ran last |
| Deliberate `throw` from an action body (`SandboxError`) | **400** with the business message — the mapping `@objectstack/rest`'s `mapDataError` has always used for the identical error |
| A `flow` action whose flow ran and rejected | **400**, `code: FLOW_FAILED` |
| Error carrying its own `.status` (e.g. a `FORBIDDEN`) | that status |
| Record `ValidationError` | **400** with `fields[]` (#3918 parity) |
| Anything else | **500** |

The **success** envelope is unchanged (`{success: true, data: {success: true,
data}}`), and `client.actions.invoke` / `invokeGlobal` still do **not** throw —
they fold the new non-2xx shape back into the same `{ success, data?, error? }`
result, with `error` as a plain string, and keep honouring the pre-#3913
`200 + inner success:false` shape so a current SDK can still talk to an older
server.

**Migration:** anything reading `response.data.success` off a raw HTTP call
should read the HTTP status (or the top-level `success`) instead — a failed
action is no longer a 200. Callers going through `@objectstack/client` need no
change.
