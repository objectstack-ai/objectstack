---
"@objectstack/runtime": patch
---

fix(runtime): a refused `POST /automation/:name/toggle` is told what it attempted (#11666)

The enablement door refuses in its own words now. A caller without
`manage_metadata` that hit `POST /api/v1/automation/:name/toggle` was answered
with the refusal the three definition writes share:

```text
before: Authoring automation flows requires the `manage_metadata` capability.
after:  Enabling or disabling an automation flow requires the `manage_metadata` capability.
```

They were disabling a flow, not authoring one. The sentence was accurate about
the policy — #10243's ruling classified toggle into the `manage_metadata`
authoring write set — and it named a verb the caller did not use.

⛔ **Copy only; no policy moved.** The accept set is bit-identical: the same
callers are refused on the same four routes, `POST /` / `PUT /:name` /
`DELETE /:name` keep the shared sentence they read correctly with, and the
envelope is untouched — `PERMISSION_DENIED` / **403** on every arm, as #11660's
pins and the ADR-0112 vocabulary assert. Nothing becomes newly accepted or
newly rejected.

Shaped on this domain's own precedent (`SCREEN_READ_DENY_MESSAGE` beside
`RUN_READ_DENY_MESSAGE`, #7968): a second constant for a second question,
rather than a reworded shared one. Rewording the shared sentence to cover both
was considered and declined — it would degrade the message for the three
definition writes in order to fix one arm. Both sentences still satisfy #7450:
each names the capability that would admit any caller, and nothing about this
one.

A client branching on the human-readable prose of a 403 (rather than on
`error.code`) is the only thing that can notice.
