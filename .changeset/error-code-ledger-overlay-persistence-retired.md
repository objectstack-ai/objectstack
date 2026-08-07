---
"@objectstack/spec": patch
"@objectstack/rest": patch
---

fix(spec,rest): `OVERLAY_PERSISTENCE_FAILED` leaves the error-code ledger — it lost its only producer (#5783)

`ERROR_CODE_LEDGER` registered `OVERLAY_PERSISTENCE_FAILED` under
`@objectstack/metadata-protocol`, but nothing in the repository can emit it any
more. Its one emission point was the `catch` inside `saveMetaItem`'s legacy
raw-engine branch, and #5264 (PR #5782) deleted that branch. A registered code
with no producer is ADR-0112's "no silent fourth state" read backwards: the
vocabulary promises a client a code no response can carry, and the ledger's own
admission test cannot notice, because it checks casing, duplication and
shadowing — never whether anyone still throws the code.

Verified before removing: a declaration-and-emission search over `origin/main`
finds the name only in the ledger row itself, two generated reference pages, one
`rest-server.ts` comment, one historical changeset plus its CHANGELOG entry, and
two `packages/rest` tests that construct the error themselves. No producer, and
no consumer — including `objectui` and `cloud`, both searched at their
`origin/main` — reads the literal. Removal only shrinks a dead row: nothing
gates an emission on ledger membership, so no runtime or gate starts rejecting
anything it accepted before.

**Wire impact: none.** No response carried this code, so no client can lose one.
The narrowing is type-level: `ErrorCode` (`StandardErrorCode` ∪ the ledger, what
`ApiErrorSchema.code` validates) no longer admits the string, so TypeScript
would now reject `code: 'OVERLAY_PERSISTENCE_FAILED'` at a call site — and there
is no such call site left to reject.

Note for whoever compiles the release: #5437's changeset
(`rest-5xx-message-withheld.md`) names this code as one of two examples of a
`code` that "still rides on the response". That sentence was accurate when it
was written; the other example, `NOT_IMPLEMENTED`, is unaffected and still
demonstrates the same behaviour.

The two `packages/rest` tests that asserted `resolveErrorResponse`'s handling of
a declared 5xx keep their substance and switch to a producer that still exists —
`metadata-protocol`'s `batchData` atomic refusal (`501` / `NOT_IMPLEMENTED`) and
the surviving overlay-delete `500`. Three stale comments are corrected in the
same pass: the `agent` entry in `metadata-plugin.zod.ts` (which described a
routing mechanism replaced by #5086's 403 refusal), the reachability argument in
`rest-5xx-message-sanitization.test.ts`, and `resolveErrorResponse`'s own
docblock in `rest-server.ts`.
