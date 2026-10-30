// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-sharing
 *
 * Record-level sharing for ObjectStack. Implements `ISharingService`
 * and installs an engine middleware that enforces
 * `object.sharingModel` (`private` / `read`) against the
 * authenticated execution context.
 */

export {
  SysRecordShare,
  SysSharingRule,
  SysShareLink,
  SysQueue,
  SysQueueMember,
  SysAssignmentCursor,
} from './objects/index.js';
export { SysBusinessUnit, SysBusinessUnitMember } from '@objectstack/platform-objects/identity';
export {
  SharingService,
  effectiveSharingModel,
  PHANTOM_ANCHOR_WRITE_DENY_NOTICE,
  UNSERVED_OWNER_WRITE_DENY_NOTICE,
  type SharingEngine,
  type SharingServiceOptions,
  type OrphanShareSweepOptions,
  type OrphanShareSweepResult,
} from './sharing-service.js';
export {
  SharingRuleService,
  type SharingRuleServiceOptions,
  // [#14754, #14969] The spec's `SharingRuleEvaluationResult` with its OPTIONAL
  // `grantsRefused` NARROWED to REQUIRED — this implementation always counts
  // refusals, so a caller holding this type never has to read an absent key as
  // "no grant was refused". The narrowing is covariant, so consumers typed
  // against the spec contract are unaffected: for them the key stays optional.
  type SharingRuleReconcilePassResult,
} from './sharing-rule-service.js';
export {
  ShareLinkService,
  type ShareLinkServiceOptions,
} from './share-link-service.js';
export {
  registerShareLinkRoutes,
  type ShareLinkRoutesOptions,
} from './share-link-routes.js';
export { TeamGraphService, expandPrincipal, type TeamGraphOptions } from './team-graph.js';
export { BusinessUnitGraphService, type BusinessUnitGraphOptions } from './business-unit-graph.js';
export {
  bindRuleHooks,
  unbindAllRuleHooks,
  bindRuleCriteriaGuard,
  ruleRegrantQueue,
  SHARING_RULE_HOOK_PACKAGE,
  RULE_CRITERIA_GUARD_PACKAGE,
} from './rule-hooks.js';
export {
  RULE_RECOMPUTE_ROW_CAP,
  RuleRegrantQueue,
  resolveAffectedRows,
  idsFromHookInput,
  stashAffectedRows,
  readAffectedRows,
  AFFECTED_ROWS_STASH_KEY,
  type AffectedRows,
  type UnboundedReason,
  type RecomputeEngine,
} from './bulk-recompute.js';
export {
  bindBusinessUnitTreeRecompute,
  unbindBusinessUnitTreeRecompute,
  writeCanChangeExpansion,
  pendingBuTreeRegrants,
  BU_TREE_RECOMPUTE_PACKAGE,
  BU_TREE_RECIPIENT_TYPES,
  BU_GRAPH_OBJECTS,
  type BuTreeRecomputeRuleService,
} from './bu-tree-recompute.js';
export {
  bindRecordShareCascade,
  unbindRecordShareCascade,
  objectCanCarryRecordShares,
  objectCanCarryShareLinks,
  orphanShareSweepQueue,
  RECORD_SHARE_CASCADE_PACKAGE,
  type CascadeEngine,
  type ShareLinkCascade,
} from './record-share-cascade.js';
export {
  deleteRowsForDeletedRecords,
  sweepOrphanedRowsByRecordExistence,
  ORPHAN_SWEEP_PAGE_SIZE,
  ORPHAN_SWEEP_MAX_ROWS,
  RECORD_SCOPED_DELETE_CHUNK,
  type OrphanCleanupEngine,
  type OrphanSweepSubject,
} from './record-orphan-cleanup.js';
export {
  parseCriteria,
  isMatchAllCriteria,
  MATCH_ALL_CRITERIA_MESSAGE,
  SharingCriteriaValidationError,
} from './rule-criteria.js';
export {
  bindRuleProvenanceStamp,
  unbindRuleProvenanceStamp,
  SHARING_RULE_PROVENANCE_PACKAGE,
} from './sharing-rule-provenance.js';
export {
  // [ADR-0131 C3 stage 9] The one translation enforcement serves a declared
  // rule through: the ownership ceremony asks it which declared names are
  // SERVED before it renames a mirror's grants onto one.
  translateDeclaredSharingRule,
  type DeclaredSharingRule,
  type DeclaredSharingRuleSkip,
} from './declared-sharing-rules.js';
export {
  // [ADR-0142 D1/D2] The ownership-queue service, registered under
  // `OWNERSHIP_QUEUE_SERVICE` (never `queue` — that name is the job queue's).
  OwnershipQueueService,
  specsReadBusinessUnits,
  QUEUE_OBJECT,
  QUEUE_MEMBER_OBJECT,
  QUEUE_ACTIVATION_TYPE,
  type OwnershipQueueServiceOptions,
  type OwnershipQueueEngine,
} from './ownership-queue-service.js';
export {
  bindQueueGuards,
  bindQueueRecipientRecompute,
  reportShadowedAuthoredQueues,
  recomputeQueueRecipientRules,
  pendingQueueRecipientRegrants,
  QueueValidationError,
  QUEUE_GUARD_PACKAGE,
  QUEUE_RECIPIENT_RECOMPUTE_PACKAGE,
} from './queue-hooks.js';
export {
  SharingServicePlugin,
  buildSharingMiddleware,
  backfillRuleGrants,
  backfillRetiredAccessLevels,
  type SharingPluginOptions,
} from './sharing-plugin.js';
export {
  ACCESS_LEVELS,
  WRITE_ACCESS_LEVELS,
  isKnownAccessLevel,
  normalizeAccessLevel,
  normalizeStoredAccessLevel,
} from './access-level.js';
export type {
  ISharingService,
  ISharingRuleService,
  ITeamGraphService,
  IBusinessUnitGraphService,
  RecordShare,
  GrantShareInput,
  ShareAccessLevel,
  RecordShareRecipientType,
  ShareSource,
  SharingRuleRow,
  DefineSharingRuleInput,
  SharingRuleEvaluationResult,
  SharingRuleRecipientType,
  IShareLinkService,
  ShareLink,
  CreateShareLinkInput,
  ListShareLinksFilter,
  ResolveShareLinkResult,
  ShareLinkExecutionContext,
  ShareLinkPermission,
  ShareLinkAudience,
} from '@objectstack/spec/contracts';
export type { IOwnershipQueueService, ResolvedQueue, QueueMemberSpec } from '@objectstack/spec/contracts';
export { SHARE_LINK_SERVICE, OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
