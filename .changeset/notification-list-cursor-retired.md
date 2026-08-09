---
"@objectstack/spec": major
"@objectstack/client": major
---

refactor(spec,client)!: retire the `cursor` half of `GET /api/v1/notifications` and stop declaring a `limit` default nothing applied (#6361, ADR-0049)

`GET /api/v1/notifications` declared `cursor` on **both** halves of its contract
and honoured it on neither. The dispatcher domain reads `read` / `type` / `limit`
and nothing else, and no emit site has ever written the response key — so a
caller paginating by the published contract re-read the first window forever,
with no error and no 400. Measured over a real boot with 60 unread before the
removal: `page2 === page1`, and **both pages parsed green** against the response
schema, which is why no conformance gate could see it.

It was worse than inert, because it had a shipped **producer**: the SDK appended
`cursor` to the query string, so the dead parameter was reachable from ordinary
typed code. That is `data.query.cursor` (#4286, `query-cursor-retired`) one layer
up, with the same verdict for the same reason — down to deleting the SDK
producer alongside the key.

Ruled jointly with #6363 (maintainer ruling 2026-08-07, Option A): one
capability's two halves are never half-deleted. #6363 made its declaration
**true** (`unreadCount` really is the total); this one removes a declaration
there was no implementation to make true **about**. Opposite repairs, one rule.

### Migration: FROM → TO

| FROM | TO |
| :--- | :--- |
| `client.notifications.list({ cursor })` | `client.notifications.list({ limit })` — ask for a bigger window |
| reading `response.cursor` | nothing; it was never emitted, so it always read `undefined` |
| relying on the declared `limit` default of `20` | send `limit: 20` explicitly, or omit `limit` and take the server's window |

**One-line fix:** delete the `cursor` argument. This route is **not paginated** —
it answers the newest `limit` notifications and stops, so a larger `limit` is the
only way to see further back. There is no continuation token to carry over, and
nothing ever minted one, so no caller holds a value that needs migrating.

`cursor` is **tombstoned rather than deleted** on both schemas: neither is
`.strict()`, so a bare deletion would have made Zod silently strip whatever a
caller kept sending — a clean parse and a parameter that never takes effect,
which is this very defect re-created one layer down (#3733, ADR-0104). Writing
it is now a `tsc` error (TS2353) and a parse-time rejection carrying the fix.

### `limit`: the default is dropped, not re-spelled

The ruling allowed either declaring the real server default (50) or dropping it
and describing the window as server-decided. The **second** is taken, because the
fiction was the *mechanism* and not the number: nothing parses this query string
through the schema (#3899 wired the route catalog's `requestSchema` to the real
entry for **bodies** only), so `.default(20)` never stamped anything onto
anything. Re-spelling it `50` would have kept a declaration that does not execute
and merely made it coincide with the implementation until someone moved the
clamp. `limit` is now plainly `.optional()`, with the server's behaviour
described as the server's: the platform inbox answers **50** and clamps any
requested value into **1..200**.

No `.int()`, `.positive()` or `.max(200)` constraint is declared either — the
service *clamps* an out-of-range limit rather than refusing it, and declaring a
rejection the wire does not perform is the same declared-not-enforced defect
mirrored.

### Behaviour on the wire is UNCHANGED

Deliberately, and worth stating because a removal invites the opposite
assumption: a request still carrying `?cursor=` is **ignored, not refused**. The
route reads three named query keys and validates no query against a schema, so an
unknown key never produced a 400 and does not start now. A caller that omitted
`limit` receives the same 50 rows it always received. What changed is the
contract, which stopped promising what the wire never delivered. `unreadCount` is
#6363's landed business and is untouched.

<!-- adr-0087: registered notification-list-cursor-retired -->
