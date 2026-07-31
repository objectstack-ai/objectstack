---
"@objectstack/runtime": patch
---

test(runtime): correct the #4073 evidence — the `registerStandardEndpoints` flip IS a no-op for a composed host

#4192 added a test concluding that turning the flag off makes `/api/v1/data/:object`
a 404, and blocked the #4073 retirement on it. That conclusion was wrong.

It mounted `createRestApiPlugin({})` against a STUB `objectql` service. REST
generates CRUD from the object registry, so it needs a real engine — driver plus
registered objects — and its own `api.api` config. Under-provisioned it serves
nothing, which says nothing about REST.

Provisioned the way `client.environment-scoping.test.ts` does it (that suite runs
`registerStandardEndpoints: false` and asserts `GET /api/v1/data/task` → 200 from
REST), `/data/:object`, `/discovery` and `/.well-known/objectstack` all return
byte-identical responses with the flag on and off.

The test now asserts that parity directly rather than a status code, because a
status was what misled it: `/data/task` answers 404 `OBJECT_NOT_FOUND` here — the
engine's answer, i.e. a route that WORKS — where a routing miss would be
`{"error":"Not found"}`. A separate assertion pins that the compared routes are
live, so parity cannot be satisfied by two identical misses.

No production code changes. The default is untouched: flipping it is still a real
change for a BARE host mounting neither REST nor the dispatcher, and that is an
API decision, not one this test makes.
