---
"@objectstack/rest": patch
---

fix(rest): the direct-mount package door carries a producer-marked `userMessage` (#12502)

`GET /api/v1/packages`, `GET /api/v1/packages/:id`, `POST /api/v1/packages/publish`
and `DELETE /api/v1/packages/:id` now put a producer's user-facing refusal text on
the wire's `error.userMessage` when the throw carried one. Previously that text was
resolved and then dropped: `sendThrownError` (`packages/rest/src/package-routes.ts`)
asked `resolveThrownHttpError` for the answer — which returns `userMessage` exactly
when the producer marked a non-empty string at throw time (#9934) — and then
forwarded only `details` and `declaredCode` to the shared envelope writer.

Nothing invalid shipped, which is what made the loss silent: `code`, `status` and
`message` were all correct, so every body parsed, while an author's deliberate,
end-user-addressed sentence vanished and a consumer told by ADR-0112 to render
`userMessage` verbatim found nothing there and fell back to its generic
substitution — the #3821 behaviour this channel exists to override.

This completes the pair the sibling change left open. That one threaded
`declaredCode` and said `userMessage` was "tracked separately"; this is it, and the
`extra` it spreads into has admitted the field since #12404.

⛔ The idiom is the INVERSE of the sibling's, deliberately. `declaredCode` must be
read through `demotedDeclaredCode` because its raw field carries a second meaning —
it is also set when the producer's spelling IS the registered member, so forwarding
it raw would put two spellings of one fact on every registered refusal.
`userMessage` has no second meaning: `declaredUserMessage` already decided what
counts as marked (a non-empty string, or nothing), so the caller passes
`thrown.userMessage` straight through, byte for byte what the dispatcher twin
serving this same path does (`errorFromThrown`,
`packages/runtime/src/http-dispatcher.ts`). Consumers must not read presence as
anything but "the producer opted in".

Additive and shape-preserving. An unmarked refusal still carries no `userMessage`,
and the three shapes `declaredUserMessage` rejects — `''`, whitespace-only, a
non-string — still carry none, so nothing invents a marked message for a producer
that never wrote one. `details`, `declaredCode`, `code`, `status` and `message` are
byte-identical to before on every existing path.

The 5xx message withhold is unchanged and does NOT suppress the mark: that withhold
rewrites a local `message` const and `looksLikeInternalErrorLeak` is only ever handed
`thrown.message`, so the marked channel is never an input to it. The two are
answering different questions — leaked diagnostic prose is withheld, while the
producer's own sentence to the end user discloses only what it chose to — and the
ruling that created the channel made it status-agnostic on purpose.

⚠️ Stated because it is the honest cost, and so the next channel added here does not
have to rediscover which bar applies: the IN-TREE producer set at this door is empty,
for this channel and for `declaredCode` alike. This door is judged live because it is
**composed rather than closed** — `resolvePackageService()` and the `protocol` slice
are open composition points whose throws all four handlers forward verbatim, and
ADR-0112's federation amendment exists precisely because the producer set is not
enumerable in-tree. The live population is the injected/federated limb, which is the
population the new pins in `packages/rest/src/package-door-user-message.test.ts`
drive.
