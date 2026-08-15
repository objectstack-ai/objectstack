---
"@objectstack/runtime": patch
---

fix(runtime): `publish-drafts` no longer discloses driver or subscriber text on `unhideError` / `rebindError` (#8516)

`POST /api/v1/packages/:id/publish-drafts` answered, on a **200**:

```json
{ "success": true, "data": {
  "unhideError": "SQLITE_ERROR: no such table: sys_metadata",
  "rebindError": "TypeError: Cannot read properties of undefined (reading 'triggers') at AutomationPlugin.rebind (/srv/objectstack/packages/services/service-automation/dist/index.js:412:31)" } }
```

These are the two remaining producers on the response whose `seedApplied` field
#8443 converted — the ADR-0045 visibility flip and the `metadata:reloaded`
announce. Both ride a success body as **data**, so no HTTP boundary's 5xx
message withhold can reach them; the disclosure had to be closed at the
producer. Both were driven for real before being changed, and both reproduced.

Both now follow the rule already in force next door: a caught sentence is
quoted only when the error **declared** itself a client-facing refusal (4xx
`status`, ADR-0112); anything else gets the stable sentence the field could
already carry, and the original goes to the server log. The rule is imported
from `@objectstack/metadata-protocol` (`clientFacingFailureText`), not restated
locally.

**Both halves of the rule, because the two sites started in different states.**
The flip already logged its cause in full at `error` with an operator remedy, so
only its payload changed. The announce had **no log line at all** — withholding
alone would have converted an over-disclosure into a silent failure, so it gains
one at `warn`, naming the cause, the concrete consequence (a newly published
record-triggered flow does not bind its trigger until the process restarts) and
the fix (re-run the idempotent publish, or restart). `warn` rather than `error`
because nothing that claimed to persist failed to: the drafts are published and
the flip is stored, and an unbound trigger is AGENTS.md's own worked example of
a functional degradation — the level the sibling announce of this same event
already uses.

**Authoring feedback is preserved, not blanked.** The flip's authored refusals
all declare 4xx (`ITEM_LOCKED`, `NOT_OVERRIDABLE`,
`OBJECT_OVERLAY_PACKAGE_MISMATCH`, …), so a locked or non-overridable app still
tells its publisher which app and why, verbatim — and the `unhiddenApps`
half-flip report beside it is untouched. A subscriber that declares a 4xx
refusal is quoted by the same positive list.
