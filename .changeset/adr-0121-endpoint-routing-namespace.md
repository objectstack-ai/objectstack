---
---

docs(adr-0121): record the 2026-08-04 maintainer ruling on declarative endpoint routing — namespace-scoped paths, the actions/apis channel split, and keeping `type: flow` (#5060).

Three decisions, drafted onto the zero-cost window #4936 opened. v17 hard-rejects a non-empty `apis:` (the loud-reject route ruled on 2026-08-04 00:20Z), so no stack can carry a declarative endpoint into 17.x — which makes this the one moment the path shape can be tightened with no migration to pay.

**Namespace, not arbitrary routes.** `ApiEndpointSchema.path` constrains nothing today but a leading slash, so app metadata can legally claim `/api/v1/data/…` or collide with another installed package. The path narrows to `<prefix>/apps/<namespace>/<subpath>`: `apps` is the platform's one reserved cut-out segment (verified free — it is in neither the domain registry's prefix set nor `LEGACY_CHAIN_PREFIXES`), the namespace segment derives from `manifest.namespace` (the only stack identity key that is URL-safe by charset, carries an instance-uniqueness contract, and is already enforced as every object name's prefix), and the author names only the subpath. Endpoint-vs-builtin and cross-app collisions become structurally impossible rather than list-checked, which retires #5040 design §1's reserved-prefix pin list and its spec/runtime consistency test — a mechanism that needed a test to keep it from rotting.

**actions vs apis, by where the caller is.** Caller inside the platform (session, platform dialect — UI buttons, AI/MCP, SDK) → `actions`; caller outside (third-party webhooks, partner systems) → `apis`. actions is the mature command channel (ADR-0104 params, ADR-0066 D4 gates, #3962 HTTP-semantic failures, `ActionAiSchema`), but structurally cannot serve the three hard traits of an outside caller: the payload shape is theirs (`inputMapping`), there is no platform session (`authRequired: false` + endpoint `rateLimit`), and the URL is a contract written into their system (stable + OpenAPI).

**`type: flow` stays**, with three disciplines: the split criterion goes into both schemas' `describe()` (spec-lane item), flow endpoints purely delegate to the automation service so picking the wrong channel is a style question and never a behavior question, and `authRequired: false` must declare `rateLimit` or publish rejects. Signature verification is named a future vocabulary candidate and deliberately not promised — adding keys no executor consumes is the ADR-0078 shape this ADR exists to avoid.

Alternatives recorded with the two-axis analysis: O1 (free paths + a reserved-prefix gate) is rejected because it compensates at the consumer for a producer-side problem and forces every author to learn which prefixes the platform happens to occupy; O3 (actions replaces apis / the Dataverse single-channel model) is rejected because it drives third-party webhook reception out of metadata and into ungoverned handler code.

Documentation only; releases nothing. The executable half lands via #5040's E-series (E7 carries the publish gates).
