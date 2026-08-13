// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'external-lookup-message-queue-families-retired',
  surface:
    'data.externalLookup / data.externalDataSource / data.externalFieldMapping '
    + '(the whole of data/external-lookup.zod.ts — 3 defs, 8 exported names) and '
    + 'system.messageQueue (the whole of system/message-queue.zod.ts — '
    + 'MessageQueueConfig, MessageQueueProvider, TopicConfig, ConsumerConfig, '
    + 'DeadLetterQueue — 5 defs, 14 exported names)',
  replacement:
    '(removed — there is no replacement key, because there was never a key: neither '
    + 'family was reachable from any metadata-type binding, stack collection or /meta '
    + 'door, so no document could carry either. For external data: `object.external` '
    + '(`ObjectExternalBindingSchema`, ADR-0015/0062) names a datasource by reference '
    + 'and connection credentials live in the datasource config — never inline in '
    + 'object metadata; `data/external-catalog.zod.ts` is that federated path\'s '
    + 'catalog surface and is untouched. For message queues: the LIVE surface is '
    + '`kernel/events/integrations.zod.ts`\'s `EventMessageQueueConfig` '
    + '(`EventBusConfig.messageQueue`), which deliberately carries NO credential '
    + 'field — broker connection and SASL credentials are runtime deployment '
    + 'configuration, not authorable metadata. Either capability returns via the '
    + 'ENFORCE route of ADR-0049 through a new ADR — the executor / broker admin '
    + 'service first, the vocabulary second)',
  reason:
    'Both families are the #8075 census verdict (fork (b), accepted 2026-08-12): '
    + 'security-shaped declared surface with inline-credential sinks and ZERO '
    + 'consumers. `ExternalDataSourceSchema.authentication.config` is a record of '
    + 'unknown whose own docblock example wrote `"clientSecret": "..."` inline, and '
    + '`MessageQueueConfigSchema.sasl.password` was a required inline broker '
    + 'credential — the #7990 class (cleartext-at-rest credential sinks), except '
    + 'that unlike #7990\'s two measured surfaces nothing ever persisted these: no '
    + 'metadata-type binding (kernel/metadata-type-schemas.ts imports neither '
    + 'module), no stack collection, no object/field embedding (`object.external` '
    + 'binds `ObjectExternalBindingSchema` — remoteName/remoteSchema/writable/'
    + 'columnMap, no authentication), and zero imports outside packages/spec '
    + 'repo-wide, with the corpus-reach control (`DatasourceSchema` under identical '
    + 'exclusions) returning hits in the same run. The consumed MQ near-namesake '
    + '`kernel/EventMessageQueueConfig` deliberately has no credential key, so the '
    + 'consumed shape had no credential and the credential-bearing shape had no '
    + 'consumer. A dead schema minus one field is still a dead schema, so the whole '
    + 'declarations go, not just the credential faces (#3950: an exported schema '
    + 'with no consumer reads as a capability to whoever finds it — here it read as '
    + 'an invitation to author secrets in cleartext). With no carrier key there is '
    + 'nothing to tombstone and no source or `sys_metadata` row for a D2 conversion '
    + 'to rewrite: route 3, the #4834 / #4988 / #5055 / #6486 shape — '
    + 'RETIRED_DEFS_BY_MAJOR plus this entry ARE the declaration. '
    + '⚠️ The #5552 `data/ExternalFieldMapping:transform` tombstone (one of that '
    + 'retirement\'s three spellings) is SUBSUMED by the def retirement, the '
    + 'WidgetManifest.performance way: it goes with the shape that carried it. The '
    + 'base `shared/FieldMapping` tombstone and the `integration/'
    + 'ConnectorFieldMapping` spelling are untouched and still reject `transform` '
    + 'with the #5552 prescription. '
    + '⚠️ The #7990 Option-B reopen trigger ("a third measured artefact-type '
    + 'surface") is NOT met by this census — that ruling\'s parked class-level '
    + 'write-boundary guard stays parked; this is the ADR-0049 leg of the fork the '
    + 'triage pre-agreed.',
  acceptanceCriteria:
    'No code imports `ExternalLookup(Schema|Parsed)`, `ExternalDataSource(Schema)`, '
    + '`ExternalFieldMapping(Schema|Parsed)`, `MessageQueueConfig(Schema|Parsed)`, '
    + '`MessageQueueProvider(Schema)`, `TopicConfig(Schema|Parsed)`, '
    + '`ConsumerConfig(Schema|Parsed)` or `DeadLetterQueue(Schema|Parsed)` from '
    + '`@objectstack/spec`, `@objectstack/spec/data` or `@objectstack/spec/system` — '
    + 'every one is TS2305 after upgrade, on every public entry (pinned by resolved '
    + 'symbol identity in `data/external-lookup-retirement.test.ts` and '
    + '`system/message-queue-retirement.test.ts`). No metadata document needs '
    + 'editing, because none could ever carry one of these shapes. '
    + '`kernel/EventMessageQueueConfig` (with its inline provider enum and no '
    + 'credential key), `data/external-catalog.zod.ts`, `object.external` and '
    + '`kernel/DeadLetterQueueEntry` survive unchanged.',
};
