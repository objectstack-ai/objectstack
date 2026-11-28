// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { KnowledgeService, documentIdFor, recordToDocument } from './knowledge-service.js';
export type {
  KnowledgeLogger,
  KnowledgeSearchRefusal,
  KnowledgeSearchReport,
  KnowledgeServiceOptions,
  KnowledgeSourceDescription,
} from './knowledge-service.js';
export { KNOWLEDGE_SOURCE_TYPE, indexKeyOf } from './knowledge-source-registry.js';
export type { KnowledgeSourceDoor, KnowledgeSourceEntry, KnowledgeSourceHolder } from './knowledge-source-registry.js';
export {
  ASSEMBLY_RULE_VERSION,
  INDEX_FINGERPRINT_VERSION,
  RECIPE_HASH_VERSION,
  TITLE_RULE_VERSION,
  computeIndexFingerprint,
  computeRecipeHash,
  indexExpectation,
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
export {
  BUILD_LEASE_MS,
  BUILD_PROGRESS_LOG_INTERVAL_MS,
  buildLockKey,
  RECONCILE_DEFAULT_CRON,
  RECONCILE_JOB,
  RECONCILE_MAX_WAIT_MS,
  RECONCILE_QUIET_MS,
} from './knowledge-build.js';
export type {
  KnowledgeBuildLock,
  KnowledgeBuildLockHandle,
  KnowledgeBuildProgress,
  KnowledgeBuildRecord,
  KnowledgeBuildTrigger,
  KnowledgeIndexReading,
  KnowledgeIndexState,
  KnowledgeReconcileEntry,
  KnowledgeReconcileReport,
  KnowledgeReconcileRequest,
} from './knowledge-build.js';
export {
  KNOWLEDGE_INDEX_STATUS_ACTION,
  KNOWLEDGE_REBUILD_ACTION,
  knowledgeIndexStatusActionHandler,
  knowledgeRebuildActionHandler,
} from './knowledge-build-actions.js';
export type { KnowledgeIndexStatusEntry, KnowledgeIndexStatusQueue } from './knowledge-build-actions.js';
export { KNOWLEDGE_SYNC_STATE_OBJECT, ObjectStoreKnowledgeSyncState } from './knowledge-sync-state.js';
export type {
  KnowledgeStoredBuild,
  KnowledgeStoredBuildStatus,
  KnowledgeSyncFailures,
  KnowledgeSyncState,
  KnowledgeSyncStateStore,
} from './knowledge-sync-state.js';
export type { KnowledgeRecordSyncQueueView } from './knowledge-service.js';
export {
  KnowledgeServicePlugin,
  KNOWLEDGE_SYNC_STATE_BUNDLE_ID,
  knowledgeSyncStateNavItem,
} from './knowledge-service-plugin.js';
export type { KnowledgeServicePluginOptions } from './knowledge-service-plugin.js';
export {
  contributeKnowledgeSettings,
  knowledgeSetupNavItem,
  KNOWLEDGE_SETUP_NAV_BUNDLE_ID,
} from './knowledge-settings-contribution.js';
export type {
  KnowledgeSettingsContribution,
  KnowledgeSettingsContributionOptions,
} from './knowledge-settings-contribution.js';
export { KNOWLEDGE_RECORD_SYNC_QUEUE, RECORD_SYNC_RETRY_DEFAULTS } from './knowledge-record-sync-queue.js';
export type {
  KnowledgeRecordSyncMessage,
  KnowledgeRecordSyncOutcome,
  KnowledgeRecordSyncReason,
  KnowledgeRecordSyncRetry,
} from './knowledge-record-sync-queue.js';
