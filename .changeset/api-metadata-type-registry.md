---
"@objectstack/spec": minor
---

feat(spec): `api` is a declared metadata kind — `DEFAULT_METADATA_TYPE_REGISTRY` + `BUILTIN_METADATA_TYPE_SCHEMAS` (#5271, part of #5206)

`api` items were produced, indexed and executed while the spec declared the kind
nowhere. Artifact ingest maps `defineStack({ apis })` to `api` metadata
(`ARTIFACT_FIELD_TO_TYPE`), the endpoint matcher indexes them
(`buildEndpointIndex`), and #5040's executor serves them — but
`DEFAULT_METADATA_TYPE_REGISTRY` had no `{ type: 'api', … }` entry and
`BUILTIN_METADATA_TYPE_SCHEMAS` had no `api` binding. So
`getMetadataTypeSchema('api')` returned `undefined` and `saveMetaItem` took its
documented "unregistered type is stored without validation" branch:
`PUT /api/v1/meta/api/:name` accepted **any JSON** and answered 200. That is
`declared ≠ enforced` read backwards — enforced but **undeclared**.

Both halves are now declared, which is one fix with two faces:

- **A body is validated.** The existing 422 `invalid_metadata` path applies to
  `api` like every other kind, with structured Zod issues naming the offending
  key. An endpoint with no `target`, or no `type`, is refused instead of stored.
- **The type is describable.** `/meta/types` emits a real JSON Schema and a
  create seed for `api`, so the metadata-admin engine renders a form rather than
  a raw-JSON textarea, and the entry carries a real label, domain and file
  patterns instead of the synthesised `label: 'api'`, `filePatterns: []`
  placeholder a type with no registry row gets.

**The write door is unchanged.** `allowRuntimeCreate: true` records what the
runtime already did: with no static registry entry, both write gates
(`isRuntimeCreateAllowed`, `assertAllowed`) fall through to "runtime-creatable",
and both name `api` in that comment. `allowOrgOverride` stays `false`, also its
effective value today — an endpoint is the publishing package's outward URL
contract, and a per-org fork could move `path`, flip `authRequired` or drop
`rateLimit` on a URL third parties integrate against. Marking the type code-only
instead (`allowRuntimeCreate: false` + `allowOrgOverride: false`) was considered
and rejected: it would turn today's 200 into a 403 rather than validate it, and
#5086's refusal runs before persistence for drafts too, which would leave
#5206 step 2's `publishPackageDrafts` endpoint gate with no draft to gate.

**`ApiEndpointSchema` gains the ADR-0010 protection envelope, and stays open to
unknown keys.** Every registered kind must declare the envelope its loader
stamps (`_packageId` / `_provenance`), or it is dropped on every parse; that
spread is added. Closing the shape against unknown keys was attempted and
**measured to be unsafe**: the same schema parses stored rows as well as
authored declarations (`buildEndpointIndex`, `gateApiItemsForPublish`), and a
stored row carries the metadata layer's own bookkeeping (`packageId`, `state`),
so `strictObject` turned 10 tests in `packages/metadata` red — the load-time
backstop excluded endpoints and the publish gate reported a schema error in
place of its ADR-0121 D6 verdict. `api` therefore joins `view` on the #4001
campaign's `STILL_STRIP` list, with that measurement written into the list's own
note, and the real fix (separating the stored envelope from the body at the
metadata layer) is filed as #5309 rather than bought by teaching the authoring
vocabulary two storage keys.

**This is a shape check, not a second servability judge.** ADR-0121's rules —
the `apps/<namespace>` carve-out (D1/D2), anonymous-requires-an-armed-`rateLimit`
(D6), the supported target subset, mapping and policy — stay with
`validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure`, which run
at publish and again at load. A pin test asserts an anonymous unmetered endpoint
parses green here and is still refused by the gate, so the two never grow
competing opinions.

**Upgrade note (not purely additive).** A stored `api` row that does not satisfy
`ApiEndpointSchema` is refused with 422 on its **next write**; reads and the
existing load-time behaviour are unchanged (the matcher already excluded
unparseable rows loudly, #5189). Every `api` declaration reachable in this repo
— the two E8-migrated showcase endpoints and the two dogfood policy-fixture
endpoints — was parsed against `ApiEndpointSchema` before landing this: all four
clean. A live deployment's `sys_metadata` cannot be scanned from CI; an operator
holding hand-written `api` rows should run `GET /api/v1/meta/diagnostics?type=api`
(which now covers the type) before upgrading.

ADR-0088's admission test is satisfied on all three clauses: independent
lifecycle (the matcher indexes and invalidates one item at a time), declarative
governability (`allowRuntimeCreate` plus file patterns), and a real consumer
(#5040's executor, boot-proven by #5040 E8). This does not reverse the `router`
kind's retirement — `router`'s delivered forms are code contributions, whereas a
single `ApiEndpoint` is a declarative artifact, exactly the "third, real
delivered form" ADR-0088's own `router` row anticipated.
