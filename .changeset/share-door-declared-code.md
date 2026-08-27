---
"@objectstack/rest": patch
---

fix(rest): the record-share family carries a demoted producer code on `declaredCode` (#12510)

`GET`/`POST /api/v1/data/:object/:id/shares` and `DELETE …/shares/:shareId` now
put a producer's own error-code spelling on the wire's `error.declaredCode` when
the closed ADR-0112 vocabulary did not admit it. Previously that spelling was
resolved and then dropped at the re-dress: `respondSharingError`
(`packages/rest/src/rest-server.ts`) asks `classifiedRefusalAnswer` — the flat
`/data` door's own classification, which already carries the demoted string —
and forwarded only `status`, `code` and the message into the nested ADR-0112 D5
envelope.

Nothing invalid shipped, which is what made the loss silent and one-directional:
the closed `code` still carried the member the HTTP status derives, so every
body parsed, while an author's spelling vanished and a consumer told by ADR-0112
to read `declaredCode` found nothing there. Measured before the repair, one
producer through both doors: a thrown `{ code: 'CLOSE_PERIOD_LOCKED', status:
409 }` answered `409 RESOURCE_CONFLICT` at both, with `declaredCode:
'CLOSE_PERIOD_LOCKED'` at `/data` and nothing at the share door.

This ADOPTS the rule the sibling doors already apply rather than inventing one.
The demote is `demotedDeclaredCode`'s answer — the single definition of
"presence means demotion" — reached here through the classification's own
`declaredCode`, which the flat door computes with exactly that function
(`thrownCodeFields`, `packages/rest/src/error-response.ts`, #9232). The pair is
carried, not recomputed: this door asks the classification once and re-dresses
that one answer, as it already does for `status`, `code` and the message.

Additive and shape-preserving. A REGISTERED producer code still carries no
`declaredCode` (repeating it would put two spellings of one fact on every
refusal), a producer that declared no code still carries none, a non-string
`code` is still context rather than a wire spelling, and `status`, `code` and
`message` are byte-identical to before on every existing path. The five-prefix
ADR-0111 idiom and the family's own `SHARES_LIST_FAILED` /
`SHARE_GRANT_FAILED` / `SHARE_REVOKE_FAILED` 500 terminal are untouched.
`ApiErrorSchema` has declared the field as optional since #9106, so the
contract's accept set does not move.
