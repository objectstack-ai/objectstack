---
'@objectstack/spec': major
---

The `trigger-registry.zod.ts` Connector cluster is removed (#4499)

`@objectstack/spec/automation` no longer exports the third declaration of the
connector vocabulary: `ConnectorSchema`, `ConnectorInstanceSchema`,
`ConnectorOperationSchema`, `ConnectorTriggerSchema`, `ConnectorCategorySchema`,
`AuthenticationSchema` / `AuthenticationTypeSchema` / `AuthFieldSchema` /
`OAuth2ConfigSchema`, `OperationTypeSchema` / `OperationParameterSchema`, their
inferred types, and the `Connector.apiKey()` / `Connector.oauth2()` factory
helpers — 630 lines, all of `automation/trigger-registry.zod.ts`.

Despite the filename, the file contained no trigger registry. Every export was
connector vocabulary, self-contained and read by nothing:

- the automation engine registers and validates connectors against
  `ConnectorSchema` from `integration/connector.zod.ts` (ADR-0097) — it never
  imported this one;
- the stack `connectors:` collection parses `DeclarativeConnectorEntrySchema`;
- outside the spec package, the only references anywhere in the monorepo were
  the two documentation generators that published it.

This closes the connector triple-declaration: `integration/connector.zod.ts`
is the one live contract (ADR-0097), the six per-provider "templates" fell in
#4480, and this cluster is the last copy (Prime Directive #12 — one
capability, one contract).

**Migration.** If you imported any of these names from
`@objectstack/spec/automation`, there is nothing to migrate *to* on that
module: nothing ever consumed what you built against them. Declare real
connector instances with `defineConnector` / the stack `connectors:` collection
(`DeclarativeConnectorEntrySchema`), or materialize them from a provider
document via connector-openapi / connector-mcp. Note the name collision when
migrating types: the live `integration/connector.zod.ts` also exports a
`ConnectorTriggerSchema` and a `Connector` type with *different shapes* — a
find-and-replace of the import path is not a migration.

The removal also deletes the "When to use Integration Connector vs. Trigger
Registry?" comparison from `integration/connector.zod.ts`'s header, which
steered "lightweight" cases to the dead file with the platform's authority —
the same defect class as the `capabilities.readOnly` prescription #4487
corrected. No D2 conversion: none of this was storable stack metadata, so
there is no source for `os migrate meta` to rewrite.
