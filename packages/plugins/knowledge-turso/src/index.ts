// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

export {
  KNOWLEDGE_REBUILD_REQUIRED,
  TursoKnowledgeAdapter,
  type TursoKnowledgeAdapterOptions,
} from './turso-adapter.js';
export {
  DEFAULT_KNOWLEDGE_FILE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  KnowledgeTursoPlugin,
  PLATFORM_DATABASE_FILES,
  dataDirectoryOf,
  defaultStoreUrl,
  requestBoundFor,
  resolveSettingsStoreUrl,
  resolveStoreUrl,
  type KnowledgeTursoPluginOptions,
} from './plugin.js';
export {
  KNOWLEDGE_SETTINGS_NAMESPACE,
  contributeKnowledgeTursoSettings,
  knowledgeTursoSettingsSpecifiers,
  knowledgeTursoSettingsTranslations,
  withKnowledgeTursoSection,
} from './settings-contribution.js';
export { GENERATION_TABLE, SAFE_SOURCE_ID, generationTable, legacyTable } from './sql.js';
