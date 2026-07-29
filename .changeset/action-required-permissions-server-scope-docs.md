---
"@objectstack/spec": patch
---

docs(spec): state what the action `requiredPermissions` server gate does NOT cover (#3923)

`ActionSchema.requiredPermissions` documented itself as a dual-surface gate whose
server half is "the source of truth": declare once, get a 403 on the server and a
hidden button in the UI. An app author reasonably read that as "any action I
declare this on is enforced somewhere", and it isn't.

Server enforcement lives on the PLATFORM ACTION ROUTE — `POST
/api/v1/actions/<object>/<action>` and the MCP/AI path — which is where `type:
'script' | 'flow' | 'modal'` actions execute. A `type: 'api'` action pointed at a
self-authored endpoint is fetched by the browser directly; that request never
reaches the platform, so nothing checks the declaration server-side and the
endpoint has to re-check the capability itself. The doc comment, the `describe()`
string (which is what surfaces in generated schema docs and editor tooltips), and
ADR-0066 D4 now say so.

Behaviour is unchanged — this is the contract being honest about its edges. The
UI half's gaps were separate and are fixed in objectui.
