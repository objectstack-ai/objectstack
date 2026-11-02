---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the uncoded refusals on `POST /change-email` and `POST /update-user` now carry an ADR-0112 code

Clause-②: no
Metadata-protocol: none

Three refusals on the account self-service doors answered a 400 with a message and no `code`, while every other refusal on the same doors carried one, so a client could only tell them apart by matching English text. Each now answers the same 400 with the same message, plus a code that is already in the ledger:

- `POST /change-email` to the caller's own address (`Email is the same`, any letter case) → `code: "VALIDATION_ERROR"`, the code this door already answers for a malformed address.
- `POST /change-email` on a deployment with no email transport (`Verification email isn't enabled`) → `code: "EMAIL_SERVICE_REQUIRED"`.
- `POST /update-user` with nothing it can update (`No fields to update`) → `code: "VALIDATION_ERROR"`.

Which requests are refused is unchanged, and the body keeps the doors' flat `{ "message", "code" }` shape. A client that branched on the message text keeps working; it can now branch on `code` instead.
