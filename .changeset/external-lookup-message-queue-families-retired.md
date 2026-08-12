---
"@objectstack/spec": major
---

refactor(spec)!: retire the external-lookup and message-queue config families — two dead declarations whose only distinctive feature was an inline-credential sink (#8075)

`ExternalDataSource(Schema)`, `ExternalFieldMapping(Schema|Parsed)`,
`ExternalLookup(Schema|Parsed)` (the whole of `data/external-lookup.zod.ts`) and
`MessageQueueConfig(Schema|Parsed)`, `MessageQueueProvider(Schema)`,
`TopicConfig(Schema|Parsed)`, `ConsumerConfig(Schema|Parsed)`,
`DeadLetterQueue(Schema|Parsed)` (the whole of `system/message-queue.zod.ts`) are
REMOVED under ADR-0049 enforce-or-remove — 8 defs, 22 exported names, reference docs
with them.

Both families are the #8075 census verdict (fork (b), accepted 2026-08-12):
security-shaped declared surface with inline-credential sinks and **zero consumers**.
`ExternalDataSourceSchema.authentication.config` was a record whose own docblock
example wrote `"clientSecret": "..."` inline; `MessageQueueConfigSchema.sasl` required
an inline `password` whenever present. Neither schema was reachable from any
metadata-type binding, stack collection or `/meta` door, and neither had a single
import outside `packages/spec` repo-wide (corpus-reach control passing in the same
run). The consumed near-namesake `kernel/EventMessageQueueConfig` deliberately carries
NO credential field — so the consumed MQ shape had no credential key and the
credential-bearing MQ shape had no consumer. A dead schema minus one field is still a
dead schema, so the whole declarations go, not just the credential faces (#3950).

The #7990 Option-B reopen trigger ("a third measured artefact-type surface") is NOT
met — nothing ever persisted these; this is the ADR-0049 leg of the triage-agreed
fork.

FROM → TO:

| removed | use instead |
|---|---|
| `ExternalLookup` / `ExternalDataSource` (+ `authentication.config` inline secrets) | `object.external` (`ObjectExternalBindingSchema`, ADR-0015/0062) names a datasource by reference; connection credentials live in datasource config (`data/datasource.zod.ts`, `data/driver/`), never inline in object metadata. `data/external-catalog.zod.ts` is that path's catalog surface and is untouched |
| `ExternalFieldMapping` | **nothing** — it existed only to serve `ExternalLookup.fieldMappings`. The base `shared/FieldMapping` and `integration/ConnectorFieldMapping` are untouched |
| `MessageQueueConfig` (+ `sasl.username`/`sasl.password`) / `MessageQueueProvider` / `TopicConfig` / `ConsumerConfig` / `DeadLetterQueue` | the live MQ surface is `kernel/EventMessageQueueConfig` (`EventBusConfig.messageQueue`) — topic, pattern, format, batching; **no credential field by design**. Broker connection + SASL credentials are runtime deployment configuration, not authorable metadata. `kernel/DeadLetterQueueEntry` (the event bus's per-event DLQ record) is untouched |

**The fix:** delete the import. Nothing was ever deployed under either family — that
is the finding, not a consolation — so there is no data migration; `tsc` reports
TS2305 at every import of a retired name. Either capability returns via the ENFORCE
route of ADR-0049 through a new ADR: the executor / broker admin service first, the
vocabulary second.

**Subsumed:** the #5552 `data/ExternalFieldMapping:transform` `retiredKey()` tombstone
and its `RETIRED_KEYS_BY_MAJOR[17]` entry — both land in the unreleased protocol 17,
so composed, the key retirement is absorbed by the def retirement (the
`WidgetManifest.performance` way): there is no longer a mapping shape to author the
key INTO. The `shared/FieldMapping` tombstone and the
`integration/ConnectorFieldMapping` spelling still reject `transform` with the #5552
prescription; the `field-mapping-transform-removed` D2 conversion still rewrites
`connectors[].fieldMappings[].transform`.

The retirement kit — route 3: no tombstone, no D2 conversion.
`RETIRED_DEFS_BY_MAJOR[17]` (8 defs) plus the D3 `SemanticMigration`
`external-lookup-message-queue-families-retired` are the declaration.

<!-- adr-0087: registered external-lookup-message-queue-families-retired -->
