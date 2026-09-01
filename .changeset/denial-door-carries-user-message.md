---
'@objectstack/runtime': patch
---

fix(runtime): carry the producer's `userMessage` at the dispatcher's PERMISSION_DENIED door (#13623)

`HttpDispatcher.dispatch`'s foot catch is not a pure rethrow: it recognises
`isPermissionDeniedError` — `name === 'PermissionDeniedError'`, **or**
`code === 'PERMISSION_DENIED'`, **or** a message starting `[Security] Access
denied` — and answers the refusal itself from
`packages/runtime/src/http-dispatcher.ts`. A marked denial therefore never
reached `dispatcher-plugin`'s throw-transparent exit, which is the door #13241
taught to carry the author-facing text channel, and lost the mark at this one
instead. `ApiErrorSchema.userMessage` has declared the slot all along and
`contract.zod.ts` states the invariant directly — *"`userMessage` on the thrown
error; the boundaries carry it to the wire"* — so this is `declared ≠ enforced`
at one more boundary, not a new field.

**Why this door matters more than its size.** #9934 made the mark
status-agnostic precisely so a 403 could carry it, and a 403 is the refusal
class most likely to carry deliberately-authored text ("You do not have access
to this report; ask an admin for the Reporting role"). The one door that
swallowed the mark was the one answering exactly those refusals.

**Transport parity, which the same ruling already asked for.**
`@objectstack/rest`'s `mapDataError` has carried the field on this identical
denial since #9934 (`withDeclaredUserMessage` over `classifyDataError`, whose
`PERMISSION_DENIED` branch is pinned in
`packages/rest/src/rest-user-facing-refusal-marking.test.ts`). The 2026-08-11
ruling on #7450 makes REST's shape the contract for both transports; until now
the dispatcher's 403 was the one that differed.

**⛔ #7450's disclosure withhold is untouched.** That ruling is about
`error.details` — the gate's `positions` / `permissionSets` and the cascade
child `object` the caller never addressed — and all of it is still dropped from
the wire and still logged server-side. `userMessage` is the opposite by
construction: it exists only because a producer wrote text *for* the caller,
platform and driver code never set it, and it rides as a declared top-level
sibling of `code`/`message`, never inside `details`. The read is
`declaredUserMessage` (`@objectstack/types`), the one rule every boundary
applies, so this door cannot fork its own answer to "what counts as marked".

**No behaviour change for an unmarked denial.** Its envelope is byte-identical
to before — key set `code` / `details` / `httpStatus` / `message`, pinned — and
the mark never moves the status or the `code`.
