---
"@objectstack/spec": patch
---

docs(spec): state `IPubSub`'s real delivery guarantee on the interface docblock (#12651)

The `IPubSub` contract docblock claimed **"At-least-once delivery; handlers MUST
be idempotent"**. No shipped driver provides that, and the repo's own measured
statements said so elsewhere: `content/docs/kernel/cluster.mdx` §4.2 ("**No
shipped driver provides this yet.**"), `@objectstack/service-cluster-redis`'s
`publish` docblock (plain Redis pub/sub — at-most-once, fire-and-forget, no
persistence, "acceptable **only** for events that are pure cache-invalidation
hints, never the source of truth"), and the `authz.invalidated` channel module
in `@objectstack/core`, which recorded the contradiction inline rather than
resolving it in the wrong direction.

The interface docblock is the load-bearing one for the hazard it invites: it is
what a consumer's editor shows at the call site, before they write a subscriber.
"At-least-once" tells that author their only obligation is to tolerate
**duplicates**, while the transport's actual failure mode is the opposite — a
**lost** message, with no replay and no upper bound on how long a node that was
down at publish time stays wrong. An author who designs for duplicates and not
for loss has designed for the wrong hazard, and neither the type nor the tests
contradict them.

The docblock now states the shipped guarantee **driver-relatively** — delivery
is whatever the configured driver declares, and no shipped driver exceeds
at-most-once — so a future durable driver lands without rewriting the contract.
It says a missed message is expected, requires handlers to be idempotent **and**
loss-tolerant, puts the staleness bound outside the bus (a TTL, a reload, a
durable outbox of its own), and points at `deliverySemantics` as the per-channel
surface while naming what that surface is: what a channel *asks* for, not what
it gets. The existing driver-reach sentence (memory = synchronous in-process;
remote drivers cross nodes) is unchanged — it was never part of the false claim.

Prose only. No schema, no type, no accept/reject behaviour changes; the shipped
`.d.ts` carries the corrected text to consumers' editors, which is the whole
point of the repair.
