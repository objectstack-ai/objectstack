---
'@objectstack/spec': major
---

The per-provider connector "template" cluster is removed (#4480, ADR-0049)

`@objectstack/spec/integration` no longer exports the six per-provider
connector schemas and their sub-schema/type/example clusters (~110 exports,
2,672 lines):

- `DatabaseConnectorSchema` (+ `DatabaseProviderSchema`, `DatabasePoolConfigSchema`,
  `SslConfigSchema`, `CdcConfigSchema`, `DatabaseTableSchema`, the three
  `*ConnectorExample` constants)
- `FileStorageConnectorSchema` (+ bucket/versioning/multipart/filter configs, examples)
- `GitHubConnectorSchema` (+ repository/commit/PR/actions/release/issue configs, examples)
- `MessageQueueConnectorSchema` (+ its queue/topic/consumer configs, examples)
- `SaasConnectorSchema` (+ examples)
- `VercelConnectorSchema` (+ its deployment/domain/env configs, examples)

The six generated reference pages under `docs/references/integration/` go with
them.

**Why removal, not completion.** These files were the losing side of an
architecture decision the same module's live half already records. ADR-0023
rejected hand-modelling each external system's shape inside the spec —
"re-inventing OpenAPI inside this schema" — and ADR-0097's connector protocol
does the opposite: one `ConnectorSchema`, with provider shapes coming from the
provider itself (`connector-openapi` materializes instances from an OpenAPI
document, `connector-mcp` from an MCP server). The templates hardcoded
Postgres/S3/GitHub/RabbitMQ/Vercel shapes into spec files nothing ever read:

- `engine.registerConnector()` validates against `ConnectorSchema` from
  `connector.zod.ts` — never the templates
- the `connectors:` stack collection parses `DeclarativeConnectorEntrySchema` —
  never the templates
- nothing else in the monorepo, objectui included, imported any of the six

They were also semantically wrong where they overlapped the live platform:
`DatabaseConnectorSchema` modelled "tables to sync", CDC, and `readReplicaConfig`
— a second, independent declaration of read-replica routing (the first,
`datasource.readReplicas`, was removed in #4468), complete with a `weight`
field for a load balancer that does not exist. External-database access is
datasource federation (ADR-0015), which is live and is not a connector.

**Migration.** There is nothing to migrate: these schemas validated no stored
metadata (the `connectors:` collection never used them) and no runtime read
their output. If you imported one as a TypeScript type for your own code,
model your provider config yourself, or — the supported path — declare a
provider-bound connector instance and let connector-openapi / connector-mcp
derive the shape:

```ts
// before (typed against a dead spec export)
import { DatabaseConnector } from '@objectstack/spec/integration';

// after (the live protocol)
import { Connector, DeclarativeConnectorEntry } from '@objectstack/spec/integration';
```

The base protocol — `ConnectorSchema`, `DeclarativeConnectorEntrySchema`, the
ADR-0097 provider contract, connector-descriptor, connector auth — is
unchanged.
