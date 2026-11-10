---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the AI service account register door answers a licence refusal with its own status and code, not 500 (ADR-0151 D7)

Clause-②: yes
Metadata-protocol: none

`POST /api/v1/auth/service-account/register` writes a `sys_user` row and its `sys_member` row in one unit of work. A hook or engine middleware that refuses either write by throwing a declared error (a numeric `statusCode` or `status` in 400-599 and a non-empty string `code`, such as a licence plugin's AI-seat cap: 402 `ai_seat_limit_reached`) is now answered with that status, and nothing is written. Before, the user-row refusal answered `500 INTERNAL_ERROR`, and the membership refusal kept its status but answered `code: INTERNAL_ERROR`.

The body follows ADR-0112 D4, as every other door does for the same throw: `error.code` is the closed vocabulary (a registered code verbatim, otherwise the code the status derives, `VALIDATION_ERROR` for a 402), and the producer's own spelling rides `error.declaredCode`. A client branches on `error.declaredCode ?? error.code`. A 4xx message travels; a 5xx message travels only when the producer set `refusal: true`, and is withheld otherwise.

Unchanged: a throw without both halves still answers `500 INTERNAL_ERROR`; `VALIDATION_FAILED` refusals, the vendor's own membership refusals (`body.code`), and the `503` answer for an unreadable authorization store keep their answers.
