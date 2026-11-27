// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0161 K4 and K6 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `knowledge-source-inert-keys-removed` family: four authorable keys nothing
// read (`ai/KnowledgeSource:embedding`, `ai/KnowledgeSource:vectorStore`,
// `ai/KnowledgeSource:adapterConfig`, `ai/KnowledgeRefreshPolicy:cron`) and the
// shapes that leave with the first two — `ai/EmbeddingModel`, `ai/VectorStore`
// and `ai/VectorStoreProvider` in RETIRED_DEFS_BY_MAJOR[19]. One D3 entry per
// retirement family, even when D2 is lossless.
export const entry: SemanticMigration = {
  id: 'knowledge-source-inert-keys-retired',
  surface:
    'A knowledge source\'s `embedding`, `vectorStore`, `adapterConfig` and `refresh.cron`, in a '
    + '`knowledgeSources` entry and in a source registered in code; and the exported schemas '
    + '`EmbeddingModelSchema`, `VectorStoreSchema` and `VectorStoreProviderSchema` with their types',
  replacement:
    '(removed — none of the four was read.) The embedder is configured once for the deployment, in the '
    + 'knowledge settings; the store is the adapter the deployment installs, named by the source\'s `adapter`; '
    + 'an adapter\'s own options are its plugin\'s options. To rebuild an index on a schedule, call '
    + '`reindexSource` from a flow or a job. `refresh.onRecordChange` is unchanged.',
  reason:
    'The D2 conversion deletes the four keys from every `knowledgeSources` entry, one notice per key, and the '
    + 'delete is lossless: the knowledge service embedded with the deployment\'s one embedder whatever a '
    + 'source\'s `embedding` said, wrote to the store of the adapter the source names whatever `vectorStore` '
    + 'said, handed `adapterConfig` to no adapter in the repository once the one that read it left, and '
    + 'started no scheduler from `refresh.cron`. The judgment is what each was written to achieve. A source '
    + 'that named a model expected its vectors to come from that model; one that named a store expected its '
    + 'documents there; one with a cron expression expected a periodic rebuild that never ran. Whether the '
    + 'deployment\'s embedder and adapter are the intended ones, and whether a schedule is still wanted, is '
    + 'known only to the deployment\'s owner.',
  acceptanceCriteria:
    'No knowledge source carries `embedding`, `vectorStore`, `adapterConfig` or `refresh.cron`; the parse '
    + 'refuses each, and no code imports EmbeddingModelSchema, VectorStoreSchema or VectorStoreProviderSchema. '
    + 'Searches answer exactly as before the upgrade. For every source whose removed key stated an intent that '
    + 'still matters: the deployment\'s knowledge settings name the embedder it expected, its `adapter` names '
    + 'the store it expected, and a flow or job calls `reindexSource` on the schedule its cron expression '
    + 'described.',
  conversionIds: ['knowledge-source-inert-keys-removed'],
};
