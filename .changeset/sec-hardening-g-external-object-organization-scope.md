---
'@objectstack/plugin-security': minor
'@objectstack/core': minor
'@objectstack/spec': minor
---

feat(plugin-security)!: under a walled tenancy posture every external object states its organization scope

Clause-②: no (narrowing) — under the `isolated` and `group` postures an external object (an `external` block) that states no organization scope is refused by name when the boot completes, and one registered after the boot is denied at Layer 0; nothing is widened, and the `single` posture is unchanged.
Metadata-protocol: narrowed

<!-- adr-0087: registered external-object-organization-scope-declared -->

**BREAKING** for a deployment running the `isolated` or `group` tenancy posture (`OS_TENANCY_POSTURE`) with an external object that states nothing about its organization scope.

- **The rule (ADR-0015 §10 as amended, ADR-0095 D1).** The platform provisions no storage for an external object, so the `organization_id` it injects into the registered schema is a column the remote may not carry. Whose rows an external object serves — one organization's or every organization's — is a fact only its author knows, and under a walled posture the object states it, in one of three ways: its own `organization_id` field (the remote rows carry the organization column and the driver returns it; a remote column of another name is mapped onto it with `external.columnMap: { <remote column>: 'organization_id' }`); `tenancy: { enabled: false }` (shared by every organization); or `systemFields: { tenant: false }` (the same opt-out on the system fields; `systemFields: false` includes it).
- **Before.** An external object stating nothing was read as shared under a walled posture: the Layer 0 wall contributed no predicate and the engine handed the driver no organization scope.
- **Now.** `SecurityPlugin` refuses the boot from its `kernel:ready` handler, beside the ADR-0131 D5 refusal, naming every external object that states nothing and the three ways out (`ExternalObjectOrganizationScopeUndeclaredError`). An external object registered after the boot — a Studio import, a runtime datasource — that states nothing is DENIED by the Layer 0 verdict (`computeTenantLayer0Verdict` answers `deny`: zero rows on every read, every write refused) and the plugin says so once, in a warning naming the object and the three ways out. An object declaring its own `organization_id` is walled: a member of organization A reads only A's rows, through a driver that honours `where` and through one that ignores it (the engine's floor re-applies the predicate), and a row missing the column reads to no one. An object declaring `tenancy: { enabled: false }` or `systemFields: { tenant: false }` is shared.
- **`tenancy.tenantField` on an external object is closed the same way.** The organization wall keys on `organization_id` alone, and a declared tenant field is read only by storage the platform provisions, which an external object has none of; so on an external object a `tenantField` naming another column is refused at boot and denied after it, with the remedy spelled out (`external.columnMap` onto `organization_id`, or `tenancy: { enabled: false }`). Local objects are unchanged.
- **Who moves.** Every walled deployment with an external object stating nothing: declare one of the three and restart. The showcase's two federated analytics objects now declare `tenancy: { enabled: false }`. A `single`-posture deployment owes no declaration and behaves exactly as before.
- **`@objectstack/core`.** `TenantLayer0Input` gains the optional `externalOrganizationScopeUndeclared`; set, the verdict is `deny` under a walled posture, ahead of the platform-admin crossing. Omitted, every existing caller reads as before.
- **`@objectstack/spec`.** The ADR-0087 D3 entry `external-object-organization-scope-declared` tells an upgrading operator what to declare.

Skills-docs: follow-up #29866 — `content/docs/data-modeling/virtual-objects.mdx` (a multi-organization section), `skills/objectstack-data/rules/datasources.md` (the three declarations), `docs/adr/0015-external-datasource-federation.md` (the §10 and D7 amendment); the sibling docs PR on `claude/sec-hardening-g-docs`, governed (Tier H), landed by the maintainer's hand.
