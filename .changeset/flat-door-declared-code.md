---
'@objectstack/rest': minor
---

fix(rest): the flat error responder narrows a thrown `code` to the declared ADR-0112 vocabulary, demoting an unregistered spelling to `declaredCode` (#9232)

**If you read `error.code` off a `packages/rest` flat error body today, read this.**

`packages/rest` answers errors in the flat dialect — `{ error: 'message', code: 'X' }`,
with `code` at the body's top level. Until now, when that body came from a *caught*
error, whatever string the producer had put on `.code` was copied to the wire verbatim,
including spellings that are not members of the ADR-0112 error vocabulary
(`StandardErrorCode` plus the registered ledger). Every other HTTP door in the platform
had already stopped doing that.

It stops here too. A thrown `code` is now resolved exactly as the dispatcher door
resolves it, by the same shared `resolveThrownHttpError` / `demotedDeclaredCode` pair:

- **A registered code is unchanged.** It still arrives in `code`, verbatim, with nothing
  added beside it. If your branches read registered codes — and every consumer branch
  measured in this repo, the SDK and the console does — nothing about your code changes.
- **An unregistered code is demoted.** `code` now carries the vocabulary member the HTTP
  status derives (a 403 gives `PERMISSION_DENIED`, a 409 `RESOURCE_CONFLICT`, and so on),
  and the producer's own spelling moves, unchanged, to a new top-level `declaredCode`
  field beside it. Nothing is lost — but a branch written against an *unregistered*
  spelling in `code` will stop matching, and must read `declaredCode` instead.
  Presence of `declaredCode` means demotion: it is absent whenever the producer's code
  was recognised.
- **A throw that declared no code still carries none.** Narrowing the vocabulary does not
  start inventing codes for bodies that had none.
- **A non-string `code` no longer reaches the body at all.** A numeric driver errno could
  previously land in `code`; it was never a legal value there and is now treated as
  context, as it already was at every other door.

The observable case in this repo: the object-posture gate's `403 owd_widening_forbidden`
now answers `{ code: 'PERMISSION_DENIED', declaredCode: 'owd_widening_forbidden' }`. That
body could not previously satisfy the schema it claimed to satisfy.

The error body's **position** is unchanged — this dialect still puts `code` at the top
level rather than in `error.code`. Converging the position is a separate, still-open line
held by the `check:route-envelope` ratchet, and was explicitly not a precondition here.
