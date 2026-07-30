---
---

chore(tooling): enumerate namespace-claiming wildcard mounts and require each to be classified (#4116)

Release-nothing: adds `scripts/check-wildcard-fallthrough.mjs` plus its CI step.
No package code changes.

A handler mounted on `<prefix>/*` claims an entire namespace, and Hono runs
handlers matching a path in registration order with the first Response winning.
So a TERMINAL wildcard — one that always answers and never yields — makes every
other route under that prefix reachable only when it happens to register first.
That shape has cost four fixes (#2567, #4018, #4088/#4092, cloud#923) and every
one was found by hand, after the fact, by someone reading the code for an
unrelated reason.

The two driven tests #4092 and cloud#923 shipped each pin one catch-all, and are
structurally unable to cover the next wildcard someone mounts. What never existed
is the enumeration. This scan is it: three states (`yields`, verified from the AST
so the entry cannot rot; `exempt` with a reason; `ratchet` naming the issue), and
a mount the scan finds but the ledger does not declare is an error, never a
default — the same shape as `check-route-envelope.mjs` (#3843).

It found 13 namespace-claiming mounts where a manual grep had found 3, including
two real, previously untracked instances of the #4088 defect in
`packages/adapters/hono` (`${prefix}/auth/*` and `${prefix}/storage/*`), now
ratcheted under #4117.
