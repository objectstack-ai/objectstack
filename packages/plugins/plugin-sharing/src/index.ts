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
  type SharingEngine,
  type SharingServiceOptions,
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
export { bindRuleHooks, unbindAllRuleHooks, SHARING_RULE_HOOK_PACKAGE } from './rule-hooks.js';
export {
  bindRuleProvenanceStamp,
  unbindRuleProvenanceStamp,
  SHARING_RULE_PROVENANCE_PACKAGE,
} from './sharing-rule-provenance.js';
export {
  SharingServicePlugin,
  buildSharingMiddleware,
  backfillRuleGrants,
  type SharingPluginOptions,
} from './sharing-plugin.js';
export type {
  ISharingService,
  ISharingRuleService,
  ITeamGraphService,
  IBusinessUnitGraphService,
  RecordShare,
  GrantShareInput,
  SharingExecutionContext,
  ShareAccessLevel,
  ShareRecipientType,
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
