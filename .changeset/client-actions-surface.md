---
"@objectstack/client": minor
"@objectstack/runtime": patch
---

feat(client): `actions` surface — the SDK path to server-registered actions (#3563 PR-2)

`client.actions.invoke(object, action, { recordId, params })` and
`client.actions.invokeGlobal(action, opts)` dispatch handlers registered via
`engine.registerAction` (`POST /api/v1/actions/...`). This closes the largest
gap in the #3563 route audit: the whole `/actions` domain — the documented way
to expose custom server-side operations — was unreachable from the SDK, and
every console hand-rolled `fetch` for it. The record id travels in the body,
which both server URL shapes honor; the handler's own business failure comes
back as `{ success: false, error }` rather than a thrown exception.

The route ledger flips all three `/actions` rows to `sdk` and the gap ratchet
drops 27 → 24. Also takes the documentation-drift findings from the audit:
the client README no longer documents six methods that do not exist,
`CLIENT_SPEC_COMPLIANCE.md` is retired to a tombstone pointing at the
CI-enforced ledger (its "FULLY COMPLIANT" verdict was measured against a
route table nothing consumes), and the docs-site SDK page documents the new
surface.
