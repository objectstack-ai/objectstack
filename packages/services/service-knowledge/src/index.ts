// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { KnowledgeService, documentIdFor, recordToDocument } from './knowledge-service.js';
export type {
  KnowledgeLogger,
  KnowledgeSearchRefusal,
  KnowledgeSearchReport,
  KnowledgeServiceOptions,
} from './knowledge-service.js';
export {
  ASSEMBLY_RULE_VERSION,
  INDEX_FINGERPRINT_VERSION,
  RECIPE_HASH_VERSION,
  TITLE_RULE_VERSION,
  computeIndexFingerprint,
  computeRecipeHash,
} from './knowledge-index-fingerprint.js';
export type { IndexFingerprintInput, RecipeHashInput } from './knowledge-index-fingerprint.js';
export { SPLIT_ALGORITHM_VERSION } from './split/index.js';
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
  SearchKnowledgeRefusedSource,
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
