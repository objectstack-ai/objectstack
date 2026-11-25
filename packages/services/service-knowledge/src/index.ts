// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { KnowledgeService, documentIdFor, recordToDocument } from './knowledge-service.js';
export type {
  KnowledgeLogger,
  KnowledgeServiceOptions,
} from './knowledge-service.js';
export {
  SEARCH_KNOWLEDGE_DEFAULT_TOP_K,
  SEARCH_KNOWLEDGE_MAX_TOP_K,
  SEARCH_KNOWLEDGE_TOOL_NAME,
  createKnowledgeTools,
  getKnowledgeToolDefinitions,
} from './knowledge-tools.js';
export type {
  KnowledgeTools,
  SearchKnowledgeHit,
  SearchKnowledgeInput,
  SearchKnowledgeOutput,
  SearchKnowledgeSourceSummary,
} from './knowledge-tools.js';
export type { KnowledgeFieldSecurity } from './knowledge-source-admission.js';
export { KnowledgeServicePlugin } from './knowledge-service-plugin.js';
export type { KnowledgeServicePluginOptions } from './knowledge-service-plugin.js';
export {
  contributeKnowledgeSettings,
  knowledgeSetupNavItem,
  KNOWLEDGE_SETUP_NAV_BUNDLE_ID,
} from './knowledge-settings-contribution.js';
export type { KnowledgeSettingsContribution } from './knowledge-settings-contribution.js';
