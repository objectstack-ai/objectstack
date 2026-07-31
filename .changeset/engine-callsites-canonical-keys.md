---
"@objectstack/plugin-sharing": patch
"@objectstack/runtime": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-reports": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/spec": patch
---

fix(sharing,runtime): a `sort` passed straight to the engine never ordered anything; migrate every in-repo engine call to canonical QueryAST keys (#4346)

Two changes with different weights, from one sweep of every in-repo engine
call site that still speaks a deprecated alias.

**The bug — three dropped sorts.** #4346 made the engine fold `filter`→`where`
and `top`→`limit` on all six methods. The other four pairs in
`RPC_QUERY_ALIAS_SLOTS` (`select`, `sort`, `skip`, `populate`) are folded at
the RPC/wire layer only — their values need shape lowering that belongs to
those layers — and a **direct `engine.find()` never crosses that layer**. Three
call sites passed `sort` there, so it rode onto the AST untouched, every
driver's `Array.isArray(query.orderBy)` guard declined to emit an ORDER BY, and
the query returned an ordinary-looking, arbitrarily-ordered result:

| call site | asked for | actually got |
|---|---|---|
| `share-link-routes.ts` | shared AI conversation messages, `created_at asc` | messages in arbitrary order |
| `runtime/domains/share-links.ts` | same route, runtime-domain copy | same |
| `share-link-service.ts` `listLinks` | the 200 most recent share links | an arbitrary 200 |

All three combine the dropped sort with a `limit` — the "latest N" shape whose
failure #4226 spelled out: an unapplied sort returns rows in arbitrary order,
which `limit` then slices into an arbitrary page. #4226 fixed that in the wire
normalizer; these calls sit one layer below it. `listLinks` had no test at all,
which is why it went unnoticed. Now pinned — on the option bag the engine
receives, not on row order, because the failure is that the key never becomes
`orderBy` and a fake engine honouring either spelling would pass either way.

**The cleanup — 27 no-op renames.** Every remaining in-repo engine call passing
`filter` now passes `where` (approvals 5, auth 2, reports 6, sharing 11,
webhooks 2, plus the one `filters` in a spec doc example). These are strict
no-ops since #4346 folds the alias — the point is that the framework stops
depending on a spelling it asks users to migrate off, which is a prerequisite
for ever retiring the aliases. Service-level `filter` PARAMETERS (each
service's own public API, e.g. `listRequests(filter)`) are deliberately
untouched — those are not engine option bags.

Two of the renamed calls were live victims of the #4346 bug rather than
cosmetic: `auth-manager`'s `stampIdentitySource` read the table's first row via
`findOne({filter})` and counted the whole table via `count({filter})`, so a
federated sign-in never stamped `source: 'idp_provisioned'`. #4346 already
corrected the behaviour; this makes the call say what it means.
