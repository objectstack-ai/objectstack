---
"@objectstack/runtime": patch
---

fix(runtime): toggling an unknown automation flow answers 404, not 500 (#7535)

`POST /api/v1/automation/:name/toggle` against a flow name the registry does not
hold answered **500 `INTERNAL_ERROR`**. It now answers **404
`RESOURCE_NOT_FOUND`**, naming the flow it could not find.

The class was the defect, not the wording. Clients and retry layers branch on
it: 5xx means "the server broke, try again", 4xx means "your request was wrong,
don't". A typo'd flow name presented as a transient server fault, so any
retry-on-5xx caller re-sent — repeatedly — a request that can never succeed.

The cause is that `toggleFlow` on an unregistered name throws a plain
`Error("Flow '<name>' not found")`. It carries no `.status`, so both dispatcher
error exits fell back to their 500 default. The fix is at the domain handler,
which now runs the **same existence probe `GET /automation/:name` already
uses** before touching the service — deciding which HTTP status a plain domain
error means is the serving boundary's job, and sharing one probe keeps the two
routes from disagreeing about which flows exist.

This brings the missing-flow arm up to the standard the endpoint's *body* arm
already met (#3899), where `{"enable": false}` — one letter off — is a located
400 naming the offending key rather than a silent enable. The refusals compose
in that order: a malformed body is still rejected without the registry being
consulted at all.

Unchanged: toggling a real flow in either direction, the documented bodyless
enable, the strict `{ enabled?: boolean }` validation, and any
`IAutomationService` implementation that omits the optional `getFlow` — it
cannot be asked whether a flow exists, so its toggle proceeds exactly as before
rather than inventing a 404.
