// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-sharing
 *
 * Record-level sharing for ObjectStack. Implements `ISharingService`
 * and installs an engine middleware that enforces
 * `object.sharingModel` (`private` / `read`) against the
 * authenticated execution context.
 */

export { SysRecordShare, SysSharingRule, SysShareLink } from './objects/index.js';
export { SysBusinessUnit, SysBusinessUnitMember } from '@objectstack/platform-objects/identity';
export {
  SharingService,
  effectiveSharingModel,
  type SharingEngine,
  type SharingServiceOptions,
  type OrphanShareSweepOptions,
  type OrphanShareSweepResult,
} from './sharing-service.js';
export {
  SharingRuleService,
  type SharingRuleServiceOptions,
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
export { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
