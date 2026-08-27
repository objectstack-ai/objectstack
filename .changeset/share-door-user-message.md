---
"@objectstack/rest": patch
---

fix(rest): the record-share family carries a producer-marked `userMessage` (#12669, fork (a))

`GET`/`POST /api/v1/data/:object/:id/shares` and `DELETE …/shares/:shareId` now
put a producer's own caller-facing refusal text on the wire's
`error.userMessage`. Previously that sentence was classified and then dropped at
the re-dress: `respondSharingError` (`packages/rest/src/rest-server.ts`) asks
`classifiedRefusalAnswer` — the flat `/data` door's own classification, which
attaches the mark in `withDeclaredUserMessage` (#9934) — and forwarded only
`status`, `code`, the message and, since #12510, `declaredCode` into the nested
ADR-0112 D5 envelope.

Nothing invalid shipped, which is what made the loss silent and one-directional:
every body parsed as `ApiErrorSchema`, while a console told by ADR-0112 to render
`userMessage` verbatim found nothing at this door and fell back to its generic
substitution — for the same throw the twin door rendered. Measured before the
repair, one producer through both real routes: a thrown `{ code:
'CLOSE_PERIOD_LOCKED', status: 409, userMessage: 'Ask finance to reopen the
period.' }` answered `409 RESOURCE_CONFLICT` at both doors, with the sentence at
`/data` and nothing at the share door.

The population is wider than its `declaredCode` neighbour's and the two are
deliberately not symmetric. `declaredCode` is read from the classification
because presence there MEANS demotion, an invariant a caller would otherwise
re-derive (#12510). `userMessage` has no such invariant: `declaredUserMessage`
already decided presence — a non-empty string, or nothing — and
`truncateClientMessage` already applied #5423's bound, so the classification's
own field is carried straight through. A REGISTERED code demotes nothing and so
carries no `declaredCode`, and still carries its author's sentence.

Additive and shape-preserving. An unmarked refusal, an empty or whitespace-only
mark and a non-string one still carry no key; `status`, `code` and `message` are
byte-identical to before on every existing path; the five-prefix ADR-0111 idiom
and the family's own `SHARES_LIST_FAILED` / `SHARE_GRANT_FAILED` /
`SHARE_REVOKE_FAILED` 500 terminal are untouched. `ApiErrorSchema` has declared
the field as optional since #9934, so the contract's accept set does not move.

Fork (b) of #12669 — mapping the flat dialect's top-level `issues` onto the
nested envelope's `ApiError.details` — is a shape decision on a contract field
and is deliberately not shipped here; #12669 stays open on it.
