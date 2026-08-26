---
"@objectstack/rest": patch
---

fix(rest): the direct-mount package door carries a demoted producer code on `declaredCode` (#12405)

`GET /api/v1/packages`, `GET /api/v1/packages/:id`, `POST /api/v1/packages/publish`
and `DELETE /api/v1/packages/:id` now put a producer's own error-code spelling on
the wire's `error.declaredCode` when the closed ADR-0112 vocabulary did not admit
it. Previously that spelling was resolved and then dropped: `sendThrownError`
(`packages/rest/src/package-routes.ts`) asked `resolveThrownHttpError` for the
answer — which returns `declaredCode` exactly when the demote happened — and then
forwarded only `details` to the shared envelope writer.

Nothing invalid shipped, which is what made the loss silent and one-directional:
the closed `code` still carried the member the HTTP status derives, so every body
parsed, while an author's spelling vanished and a consumer told by ADR-0112 to read
`declaredCode` found nothing there.

This ADOPTS the rule two sibling doors already apply rather than inventing one — the
demote is read through `demotedDeclaredCode`, the single definition of "presence
means demotion", exactly as the dispatcher's `errorFromThrown`
(`packages/runtime/src/http-dispatcher.ts`, #9106) and the flat `/data` door's
`thrownCodeFields` (`packages/rest/src/error-response.ts`, #9232) do. That matters
here specifically: the runtime dispatcher domain is the TWIN transport for
`/api/v1/packages`, and it has emitted this channel all along, while this
direct-mount registrar — which registers first and is therefore the one production
serves for the three routes both declare — dropped it. One path, two doors,
disagreeing on a declared channel.

Additive and shape-preserving. A REGISTERED producer code still carries no
`declaredCode` (repeating it would put two spellings of one fact on every refusal),
a producer that declared no code still carries none, `details` is untouched, and
`code`/`status`/`message` are byte-identical to before on every existing path. The
5xx message withhold is unchanged and does NOT suppress the demote: that withhold is
scoped to the prose by its own contract (`status`, `code` and `details` untouched),
`declaredCode` is a code channel, and the twin applies no status condition to it
either.

⛔ `userMessage` is deliberately NOT threaded here — the shared `sendError`'s `extra`
has admitted it since #12404, and that channel is threaded separately, in #12502.
