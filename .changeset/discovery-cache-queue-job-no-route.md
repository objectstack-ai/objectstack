---
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
---

fix(spec,metadata-protocol,runtime): discovery stops advertising routes for the kernel-internal cache/queue/job slots (#4318)

The metadata-protocol discovery builder declared `/api/v1/cache`, `/api/v1/queue`
and `/api/v1/jobs` — three paths that existed nowhere else in the repository: no
dispatcher domain, no adapter mount, no plugin registration, and the shipped
providers (`service-cache`/`-queue`/`-job`) are in-process contracts that will
never mount one. Every default boot therefore advertised a route inside the same
`ServiceInfo` whose `handlerReady: false` said the opposite — a single record
contradicting itself (ADR-0076 D12).

These slots are route-less now, like `realtime` — but unlike `realtime` an
unmarked real implementation stays `available`: the slot's contract is
in-process, so "no HTTP surface" is not reduced capability for it. `handlerReady`
is reported `false` on both discovery builders — for a route-less slot it is not
a proxy for anything, it is the fact itself (the dispatcher used to claim
`handlerReady: true` here for an unmarked occupant, a handler that does not
exist). The explanatory message is written once, as
`inProcessServiceMessage(slot)` in `@objectstack/spec/system`, so the two
builders cannot drift apart.
