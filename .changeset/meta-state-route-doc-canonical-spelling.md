---
"@objectstack/rest": patch
---

docs: the two published sites that teach the state-machine introspection route
spell it the way the route ledgers do (#10178)

#9180 step ② retired the plural `/api/v1/meta/objects/:name/state/:field`
registration and moved the SDK to the singular `object` segment. Two published
prose sites were never swept and kept teaching a retired spelling:

- `content/docs/protocol/objectql/state-machine.mdx` taught
  `GET /api/v1/meta/objects/:name/state/:field` — the plural REST path, which a
  REST-fronted deployment now answers with a transport 404 because the
  registration is gone.
- `skills/objectstack-automation/SKILL.md` taught
  `GET /metadata/objects/:name/state/:field` — a **third** spelling, wrong on
  two axes at once (`metadata` rather than the `/meta` prefix the server
  actually serves, plus the plural), and therefore invisible to a sweep for
  `meta/objects`. Every other route in that file is already written as
  `/api/v1/…`.

Both now read `GET /api/v1/meta/object/:name/state/:field?from=:state`, taken
from the `REST_ROUTE_LEDGER` row for `meta.getLegalNextStates`
(`packages/rest/src/rest-route-ledger.ts`), whose note states the rule in one
line: the `/meta` type segment is singular, always.

**⛔ This is a canonical-spelling correction, not a "the plural is dead"
announcement, and the difference is load-bearing.** The legacy if-chain branch
in `packages/runtime/src/domains/meta.ts` still matches BOTH literals, so
`/meta/objects/:name/state/:field` is refused by a REST-fronted deployment and
**still answered** wherever `dispatch()` is the front door. That asymmetry is
deliberate — the maintainer re-weigh of the #9180 ruling, 2026-08-17 item 3,
keeps the tolerance for external callers with no new refusals — and it is
pinned by `packages/runtime/src/domains/meta-state-plural-tolerance.test.ts`.
Neither that branch, the ledger rows, nor that pin is touched here. It is also
**not** the `META_URL_TO_SINGULAR` fold, whose retirement was deferred
separately: the fold is a map consulted for `/meta/:type`, this is a literal
`||` no request reaches through the fold.

The prose had no mechanical link to the ledger, which is why the step-②
registration change could go in without either line moving. A new pin supplies
one: `packages/rest/src/meta-state-route-doc-spelling.test.ts` reads the
canonical path off the ledger row and asserts both teaching sites **contain**
it. Presence, not absence — "no doc mentions the plural" would pass on a page
that stopped documenting the route at all, the same silence the guard exists to
break. No runtime behaviour changes.
