---
"@objectstack/core": patch
"@objectstack/service-cluster": patch
---

docs(core,service-cluster): retire the two docblocks left stale by `IPubSub`'s corrected delivery guarantee (#12836)

#12651 corrected `IPubSub`'s contract docblock: delivery is whatever the
configured driver declares, no shipped driver exceeds at-most-once, a missed
message is EXPECTED, and handlers must be idempotent **and** tolerate loss.
Two docblocks elsewhere still described the world before that correction.

**`@objectstack/core` — `security/authz-invalidation-channel.ts`.** It carried a
paragraph asserting, in the present tense, that the interface docblock "still
says" *At-least-once delivery*, and that repairing it was a `packages/spec`
change filed separately. That filing was #12651 and it has landed, so the
paragraph is now false rather than merely stale — it sends the next reader
looking for a live disagreement between the interface and the drivers that no
longer exists. Replaced with a plain pointer to the interface docblock.
Everything else in that docblock is unchanged: the at-most-once reasoning, the
TTL-is-the-bound rule, and the best-effort-at-the-publish-site note all still
hold.

**`@objectstack/service-cluster` — `memory/pubsub.ts`.** The line "At-least-once
semantics held vacuously (a single in-process delivery)" was wrong on its own
terms even before #12651: the same docblock states that handler errors are
swallowed and logged via `onError`, so a handler that throws loses the message
with no retry and no persistence. That is not at-least-once in any sense, and
"vacuously" does not save it. Replaced with the honest statement — one
synchronous in-process delivery attempt per subscriber, no persistence, no
retry, no replay.

Prose only. No behaviour change, and no test changed.
