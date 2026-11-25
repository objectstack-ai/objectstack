// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

export {
  KNOWLEDGE_REBUILD_REQUIRED,
  PgvectorKnowledgeAdapter,
  type PgClientLike,
  type PgPoolLike,
  type PgQueryResult,
  type PgvectorKnowledgeAdapterOptions,
} from './pgvector-adapter.js';
export {
  KnowledgePgvectorPlugin,
  poolFromPg,
  resolveStoreUrl,
  type KnowledgePgvectorPluginOptions,
} from './plugin.js';
export { DEFAULT_KNOWLEDGE_SCHEMA, GENERATION_TABLE, vectorTable } from './sql.js';
