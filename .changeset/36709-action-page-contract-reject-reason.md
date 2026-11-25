---
'@objectstack/spec': patch
---

docs(spec): the `IApprovalService.handleActionPage` contract names the reason a reject link's POST now carries

Clause-②: no
Metadata-protocol: none

Documentation only; no type, schema or export changes. The docblock shipped in `@objectstack/spec`'s contract types now matches what the ADR-0043 action page does since the reject-reason change in `@objectstack/plugin-approvals`:

- The confirm page for a reject link carries a required reason field, and the `POST` reads it from the form's `comment` field beside `token` (the last of each when a field repeats).
- A reject whose `comment` is missing, blank or not a string is answered the same confirm page again with status `400` (redemption outcome `reason_required`): nothing is decided and the token is not consumed. A dead link is still told on its result page with `200`.
- An approve link reads no `comment` and records the fixed comment "Via action link".
