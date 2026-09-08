---
"@objectstack/runtime": patch
---

An action whose caller-scope record load was DENIED is now refused at every action door, not at one of the three.

`loadActionSubjectRecord` computes one verdict — `recordLoadDenied` — for every door, and exactly one door consumed it as a refusal: the declarative update. The flow door and the script/body door spread the same verdict into the context as a field and proceeded. So MCP `run_action` on a `type: 'flow'` action answered `ok: true` and started a persisted run for a `recordId` the caller cannot read — and, identically, for an id that names nothing at all — while `get_record` answered "not found" and `update_record` answered "no access" for that same id in the same session. Nothing in the response told the calling agent the row had not been delivered.

Both remaining doors now consume the verdict, on both surfaces (the REST `/actions` route and the MCP `run_action` bridge), through one shared refusal:

- **What is refused.** A row-scoped invocation whose caller-scope load was attempted and did not deliver the row. The refusal lands before the automation run is created and before a trusted, RLS/FLS-bypassing action body is entered — not after, which would answer an error with the run already persisted.
- **The envelope is the shared not-found one** — `RECORD_NOT_FOUND`, 404, the same `recordNotFoundError` the read path and the declarative door already answer. Not a 403 and not a new "denied" code: the read path collapses "filtered out by row-level security" and "this id names nothing" on purpose, so answering the two differently would make this door disclose existence where every other door declines to.
- **Record-less and new-record actions are unchanged.** The verdict can only be `true` when a load was actually attempted — a `recordId` was supplied and the action key is not object-less — so an object-less ("global") action and an invocation with no `recordId` never reach the refusal, and both still receive the `recordId` stamp on `ctx.record` exactly as before. The predicate is the load's own verdict, deliberately not the `locations`-derived `requiresRecord` of an action listing, which an author may omit entirely.

`AutomationContext.recordLoadDenied` and the handler-side `ctx.recordLoadDenied` are untouched and still populated by the same producer; an author guard written against either keeps working. What changed is that the platform no longer depends on that guard being written.
