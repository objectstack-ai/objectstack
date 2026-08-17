---
"@objectstack/spec": minor
"@objectstack/types": minor
"@objectstack/runtime": minor
---

`error.code` is a closed vocabulary at every door (#9106, maintainer ruling
2026-08-16): the runtime dispatcher's thrown-error exits
(`HttpDispatcher.errorFromThrown`, `dispatcher-plugin`'s `errorResponseBase`,
`endpoint-executor`'s `endpointErrorAnswer` — the actions door among them) now
serve the narrowed `code` the shared resolver (`resolveThrownHttpError`,
`@objectstack/types`) has always computed, exactly as the REST door has since
#8016. A thrown code that is not a member of `StandardErrorCode ∪
ERROR_CODE_LEDGER` no longer reaches `error.code`.

It is not dropped: `ApiErrorSchema` declares a new optional `declaredCode`
field — the open, author-authored channel — and the demoted spelling rides
there. Presence means demotion: the field is absent whenever the producer's
code is a vocabulary member (it is already in `error.code`) or the producer
declared none. The #7867 sandbox passthrough capability is preserved — a
metadata app's own thrown `.code` still crosses the QuickJS boundary and still
reaches the wire.

For a metadata app that throws its own code (e.g.
`Object.assign(new Error('pick another'), { code: 'DUPLICATE' })` in an action
body) and reads it back from an actions-door failure:

- FROM: `error.code === 'DUPLICATE'`
- TO: `error.code` is the closed member the status derives (e.g.
  `VALIDATION_ERROR` on a 400) and `error.declaredCode === 'DUPLICATE'`.
  One-line fix: branch on `error.declaredCode` for app-specific spellings;
  branch on `error.code` for platform conditions.

Platform producers are unaffected: every registered code reaches `error.code`
verbatim, as before (post-#8846 the dispatcher-vocabulary gate holds that set
registered). Measured before landing (the ruling's binding precondition): no
existing consumer of the actions door branches on author-authored strings in
`error.code`.

`@objectstack/types` adds `demotedDeclaredCode(thrown)` — the one definition of
"which spelling a boundary surfaces beside the closed `code`".
