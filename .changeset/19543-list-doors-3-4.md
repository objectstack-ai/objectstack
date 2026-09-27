---
'@objectstack/spec': minor
'@objectstack/client': minor
'@objectstack/runtime': minor
---

feat!: retire the `GET /api/v1/automation` flow list in favour of `GET /api/v1/meta/flow`; `ListAiConversationsResponse` declares `hasMore` (#19543)

**BREAKING** — two sibling list doors that declared paging nobody honoured.

**The flow list is retired, with no alias and no transition window** (maintainer
ruling: 「退役，统一走 /meta/flow」). Its contract described a capability no build
ever delivered: the request declared `status`, `type`, `limit` (default 50) and
`cursor`, and the route read none of them; the response declared `FlowSummary`
rows with `total`, `nextCursor` and `hasMore`, and the route answered bare flow
names beside a literal `hasMore: false`. Measured before removal on the main branch
of this repository and cloud, and on objectui at its pinned commit and at main:
zero callers of the route or of `client.automation.list` outside their own tests,
while the Console flow-runs page and the Setup packaged-automation page already
read `GET /api/v1/meta/flow`.

FROM → TO, per surface:

- `GET /api/v1/automation` (and its environment-scoped twin) → no longer mounted
  for `GET`. `POST /api/v1/automation` (create a flow) still lives at that path, so
  on the default Hono host a `GET` there answers the host's standard method
  mismatch — `405 METHOD_NOT_ALLOWED` with `Allow: POST` — the same answer any
  POST-only path gets. A transport that forwards every automation path to the
  dispatcher answers `404 ROUTE_NOT_FOUND`. Fix: read `GET /api/v1/meta/flow`;
  flows are metadata (ADR-0106), and it answers full definitions, so map each item
  to its `name` if you only need names. Per-flow runtime enablement and trigger
  binding is `GET /api/v1/automation/_status`, unchanged.
- `client.automation.list` (`@objectstack/client`) → removed; calling it is a
  compile error. Fix: `client.meta.getItems('flow')`, or
  `client.automation.getRuntimeStatus()` for the enabled/bound state.
- `ListFlowsRequestSchema`, `ListFlowsResponseSchema`, `FlowSummarySchema` and the
  types `ListFlowsRequest`, `ListFlowsRequestParsed`, `ListFlowsResponse`,
  `ListFlowsResponseParsed`, `FlowSummary` (`@objectstack/spec/api`) → removed,
  no replacement export (TS2305 on import). Fix: delete the import; the flow
  definition type is `Flow` from `@objectstack/spec/automation`.
- `AutomationApiContracts.listFlows` → removed; the map has eight entries, none of
  them a `GET` at the bare path. Every other automation route is unchanged.

**`ListAiConversationsResponseSchema` gains a required `hasMore`** (the spec half
of the same card; the server half is objectstack-ai/cloud#2426). The list is
declared **newest first** and pages by keyset: `cursor` is the `id` of the last
conversation the caller already holds, and `hasMore` says whether another page
follows. `hasMore` is required rather than optional so a server that does not
compute it is off-contract instead of silently spec-valid; no `nextCursor` is
declared, because the next cursor is the last conversation's id, already on the
page. Who notices: code that constructs a `ListAiConversationsResponse` must now
set `hasMore`, and a response parsed with the schema is refused without it.
`client.ai.conversations.list()` is unchanged — it still resolves to the
conversation array.

Breaking ships as `minor` per the launch-window convention
(`scripts/check-changeset-no-major.mjs`).

**Clause-②: yes (narrowing)** — the conversation list's response surface gains a
declared `hasMore`; a route, an SDK method, three published schemas with their five
types and a contract entry are removed, and a conversation-list response without
`hasMore` is now refused.

<!-- adr-0087: registered automation-flow-list-route-retired -->
