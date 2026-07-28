---
"@objectstack/spec": minor
"@objectstack/client": minor
---

feat(client,spec): `ai.agents.*` and `ai.pendingActions.*` — the AI routes the SDK could not reach (#3718)

#3718 deleted three `client.ai.*` methods whose URLs no route had ever mounted,
then expressed the surface that does exist. It expressed **one** builder's worth
of it. `service-ai` mounts seven; the audit that widened its ledger
(objectstack-ai/cloud#903) counted **ten** routes the SDK cannot reach, nine of
which had simply never been counted.

This closes the six with the strongest evidence: `objectui` already ships
product on them, over URLs it builds by hand because there was nothing to call.

**`ai.agents`** — `/ai/chat` talks to the environment's default agent; these
talk to one you name.

- `agents.list()` — the agents this CALLER may chat with. The route filters by
  the caller's permissions (ADR-0049), so an empty list is a legitimate answer
  for a seat-less user, not an error to retry.
- `agents.chat(name, request)` / `agents.chatStream(name, request)` — one route,
  two methods, mirroring `ai.chat` / `ai.chatStream` rather than inventing a
  third shape for the same endpoint. `chat` forces `stream: false` for the same
  reason `ai.chat` does: the route streams by default, so leaving the flag to
  the caller means the JSON path is the one you have to remember.

**`ai.pendingActions`** — the human-in-the-loop approval queue. When a tool call
needs a human decision the turn parks an action instead of executing it, and an
app embedding the chat has to render and resolve that queue.

- `pendingActions.list(options?)` — `status`, `conversationId` and `limit` only.
  `AIService.listPendingActions` also accepts `objectName`, but the route never
  forwards it; typing it here would offer a filter that silently does nothing.
- `pendingActions.get(id)`
- `pendingActions.approve(id)` — approves **and executes**. Check the returned
  `status`: a tool that fails after approval comes back
  `{ status: 'failed', error }` with HTTP 200, because the approval succeeded
  even though the execution did not. Code that reads only `res.ok` reports a
  failed write as a success.
- `pendingActions.reject(id, reason?)` — executes nothing.

Reads and decisions are separately permissioned server-side (`ai:read` vs
`ai:approve`), so a caller that can list the queue may still be refused on
approve. Handle the 403; one does not imply the other.

**Typed from what the routes return**, not from what a client might like them
to — the failure #3718 exists to punish. The pending-action shape is the
persisted row, `snake_case` on the wire because that is what it is. Agent rows
require `capabilities`, because that object is what tells a UI which
affordances to render.

The capstone (#3642) exempts `/api/v1/ai/` by prefix and says the evidence lives
on the other side of the repo boundary. It does: cloud's ledger drives every
`ai.*` method against the tables its builders really return — and since #903
that means all seven builders, which is what makes these six routes checkable
at all. Their routes come from `buildAgentRoutes()` and
`buildPendingActionRoutes()`, neither of which the ledger could see when the
exemption was written.
