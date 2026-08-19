// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0122 pin — the aliases that deliberately carry NO `XParsed`.
//
// ## What this file is
//
// ADR-0122 makes the bare name `X` the AUTHOR state and `XParsed` the PARSED
// state. Phase 1 (#5551 / PR #6072) declared an `XParsed` for every alias whose
// schema actually HAS two shapes (`z.input` differs from `z.infer`); phase 2
// (#6083, protocol 17) flipped all 1384 bare aliases to `z.input` and retired
// the 102 `XInput` names the flip turned into synonyms. The complement —
// schemas whose two shapes coincide, so the flip changed nothing observable —
// deliberately gets no `XParsed`, because a permanent synonym is a name an
// author can only pick wrongly.
//
// "Deliberately" is the word that needs teeth. Isomorphism is not a property
// anyone declared; it is a fact about the schema tree, and it ROTS: the day a
// nested field gains a `.default()`, `.transform()`, `.catch()` or `.pipe()`,
// its alias silently gains a second shape that nothing names, and a consumer
// holding a parse result has no type to hold it in — the silent failure the
// pins exist to prevent.
//
// So the complement is pinned rather than merely documented. Each line below
// asserts `z.input === z.infer` for one schema. Add a default anywhere in its
// tree and this file goes RED with the alias named, and the fix is the one the
// ADR prescribes: declare `XParsed` next to the bare alias and delete the pin
// line. The list therefore moves in both directions, and it moves for the right
// reason — phase 2 grew it by 35 for a reason it records at the block itself.
//
// ## It is also the gate's registry
//
// `scripts/check-spec-parsed-alias.mjs` reads THIS file to decide which bare
// aliases are allowed to have no `XParsed`. One artifact, two jobs: the gate
// gets a machine-readable exemption list, and tsc proves every entry on it is
// true. An exemption nobody can state falsely is the only kind worth having.
//
// Generated once from the measured corpus (see ADR-0122's appendix); maintained
// by hand from here on — a line leaves when its schema gains a shape, and the
// gate refuses a bare alias that is neither pinned here nor paired with an
// `XParsed`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// The spot-check imports use this directory's extensionless style (every
// sibling `*.test.ts` does). The bulk `import type * as Mn` lines below carry a
// `.js` extension deliberately: they are erased at runtime, and the explicit
// extension is what lets `scripts/check-spec-parsed-alias.mjs` read this file
// as its exemption registry without guessing at module specifiers.
import { RetryPolicySchema } from './shared/retry-policy.zod';
import type { RetryPolicy, RetryPolicyParsed } from './shared/retry-policy.zod';
import {
  ConnectorSchema,
  DataSyncConfigSchema,
} from './integration/connector.zod';
import type {
  Connector,
  ConnectorParsed,
  DataSyncConfig,
  DataSyncConfigParsed,
} from './integration/connector.zod';
import { ViewFilterRuleSchema, ViewSchema } from './ui/view.zod';
import type { View, ViewFilterRule, ViewFilterRuleParsed, ViewParsed } from './ui/view.zod';
import { ObjectFieldGroupSchema } from './data/object.zod';
import type { ObjectFieldGroup, ObjectFieldGroupParsed } from './data/object.zod';

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;

import type * as M0 from './ai/agent.zod.js';
import type * as M1 from './ai/conversation.zod.js';
import type * as M2 from './ai/embedding.zod.js';
import type * as M3 from './ai/knowledge-document.zod.js';
import type * as M4 from './ai/knowledge-source.zod.js';
import type * as M5 from './ai/mcp.zod.js';
import type * as M6 from './ai/model-registry.zod.js';
import type * as M7 from './ai/skill.zod.js';
import type * as M8 from './ai/solution-blueprint.zod.js';
import type * as M9 from './ai/tool.zod.js';
import type * as M10 from './ai/usage.zod.js';
import type * as M11 from './api/analytics.zod.js';
import type * as M12 from './api/auth-endpoints.zod.js';
import type * as M13 from './api/auth.zod.js';
import type * as M14 from './api/automation-api.zod.js';
import type * as M15 from './api/batch.zod.js';
import type * as M16 from './api/contract.zod.js';
import type * as M17 from './api/discovery.zod.js';
import type * as M18 from './api/dispatcher.zod.js';
import type * as M19 from './api/documentation.zod.js';
import type * as M20 from './api/errors.zod.js';
import type * as M21 from './api/events.zod.js';
import type * as M22 from './api/export.zod.js';
import type * as M23 from './api/http-cache.zod.js';
import type * as M24 from './api/metadata.zod.js';
import type * as M25 from './api/odata.zod.js';
import type * as M26 from './api/package-api.zod.js';
import type * as M27 from './api/plugin-rest-api.zod.js';
import type * as M28 from './api/protocol.zod.js';
import type * as M29 from './api/query-adapter.zod.js';
import type * as M30 from './api/realtime-shared.zod.js';
import type * as M31 from './api/realtime.zod.js';
import type * as M32 from './api/rest-server.zod.js';
import type * as M33 from './api/router.zod.js';
import type * as M34 from './api/storage.zod.js';
import type * as M35 from './api/versioning.zod.js';
import type * as M36 from './api/websocket.zod.js';
import type * as M37 from './automation/approval.zod.js';
import type * as M38 from './automation/bpmn-interop.zod.js';
import type * as M39 from './automation/execution.zod.js';
import type * as M40 from './automation/flow-function.zod.js';
import type * as M41 from './automation/node-executor.zod.js';
import type * as M42 from './automation/state-machine.zod.js';
import type * as M43 from './automation/time-relative-trigger.zod.js';
import type * as M44 from './automation/webhook.zod.js';
import type * as M45 from './cloud/app-store.zod.js';
import type * as M46 from './cloud/developer-portal.zod.js';
import type * as M47 from './cloud/environment-package.zod.js';
import type * as M48 from './cloud/environment.zod.js';
import type * as M49 from './cloud/marketplace-admin.zod.js';
import type * as M50 from './cloud/marketplace.zod.js';
import type * as M51 from './cloud/package-version.zod.js';
import type * as M52 from './cloud/package.zod.js';
import type * as M53 from './cloud/template-manifest.zod.js';
import type * as M54 from './cloud/tenant.zod.js';
import type * as M55 from './data/analytics.zod.js';
import type * as M56 from './data/data-engine.zod.js';
import type * as M57 from './data/datasource.zod.js';
import type * as M58 from './data/driver-nosql.zod.js';
import type * as M59 from './data/driver-sql.zod.js';
import type * as M60 from './data/driver.zod.js';
import type * as M61 from './data/driver/common.zod.js';
import type * as M62 from './data/driver/memory.zod.js';
import type * as M63 from './data/driver/sqlite.zod.js';
import type * as M181 from './data/driver/turso.zod.js';
import type * as M182 from './api/error-code-ledger.zod.js';
import type * as M65 from './data/feed.zod.js';
import type * as M66 from './data/field.zod.js';
import type * as M67 from './data/filter.zod.js';
import type * as M68 from './data/hook-body.zod.js';
import type * as M69 from './data/hook.zod.js';
import type * as M70 from './data/object.zod.js';
import type * as M71 from './data/query.zod.js';
import type * as M72 from './data/seed-loader.zod.js';
import type * as M73 from './data/seed.zod.js';
import type * as M74 from './data/validation.zod.js';
import type * as M75 from './identity/identity.zod.js';
import type * as M76 from './identity/organization.zod.js';
import type * as M77 from './identity/scim.zod.js';
import type * as M78 from './integration/connector.zod.js';
import type * as M79 from './kernel/cli-extension.zod.js';
import type * as M80 from './kernel/cluster.zod.js';
import type * as M81 from './kernel/context.zod.js';
import type * as M82 from './kernel/dependency-resolution.zod.js';
import type * as M83 from './kernel/events/core.zod.js';
import type * as M84 from './kernel/events/handlers.zod.js';
import type * as M85 from './kernel/manifest.zod.js';
import type * as M86 from './kernel/metadata-customization.zod.js';
import type * as M87 from './kernel/metadata-loader.zod.js';
import type * as M88 from './kernel/metadata-plugin.zod.js';
import type * as M89 from './kernel/metadata-protection.zod.js';
import type * as M90 from './kernel/package-artifact.zod.js';
import type * as M91 from './kernel/package-registry.zod.js';
import type * as M92 from './kernel/package-upgrade.zod.js';
import type * as M93 from './kernel/plugin-capability.zod.js';
import type * as M94 from './kernel/plugin-lifecycle-advanced.zod.js';
import type * as M95 from './kernel/plugin-loading.zod.js';
import type * as M96 from './kernel/plugin-registry.zod.js';
import type * as M97 from './kernel/plugin-security-advanced.zod.js';
import type * as M98 from './kernel/plugin-security.zod.js';
import type * as M99 from './kernel/plugin-structure.zod.js';
import type * as M100 from './kernel/plugin-validator.zod.js';
import type * as M101 from './kernel/plugin-versioning.zod.js';
import type * as M102 from './kernel/plugin.zod.js';
import type * as M103 from './kernel/service-registry.zod.js';
import type * as M104 from './kernel/startup-orchestrator.zod.js';
import type * as M105 from './qa/testing.zod.js';
import type * as M106 from './security/explain.zod.js';
import type * as M107 from './security/permission.zod.js';
import type * as M108 from './security/rls.zod.js';
import type * as M109 from './shared/connector-auth.zod.js';
import type * as M110 from './shared/enums.zod.js';
import type * as M111 from './shared/expression.zod.js';
import type * as M112 from './shared/http.zod.js';
import type * as M113 from './shared/identifiers.zod.js';
import type * as M169 from './shared/mapping.zod.js';
import type * as M172 from './automation/builtin-node-config.zod.js';
import type * as M173 from './automation/schemaless-node-config.zod.js';
// #4593's seven: files that had no bare alias needing an exemption until the
// documented-schema backfill gave one to a schema they already published. Same
// next-free-index rule as M169/M170/M172/M173 above — positional identifiers, so
// a new module appends rather than renumbering.
import type * as M174 from './api/endpoint.zod.js';
import type * as M175 from './automation/flow.zod.js';
import type * as M176 from './data/context-tokens.zod.js';
import type * as M177 from './data/date-macros.zod.js';
import type * as M178 from './data/field-value.zod.js';
import type * as M179 from './data/mapping.zod.js';
import type * as M180 from './security/sharing.zod.js';
import type * as M114 from './shared/metadata-types.zod.js';
import type * as M115 from './shared/protection.zod.js';
import type * as M116 from './stack.zod.js';
import type * as M117 from './studio/flow-builder.zod.js';
import type * as M118 from './studio/object-designer.zod.js';
import type * as M119 from './studio/plugin.zod.js';
import type * as M120 from './system/auth-config.zod.js';
import type * as M121 from './system/cache.zod.js';
import type * as M122 from './system/change-management.zod.js';
import type * as M123 from './system/collaboration.zod.js';
import type * as M124 from './system/core-services.zod.js';
import type * as M125 from './system/deploy-bundle.zod.js';
import type * as M126 from './system/disaster-recovery.zod.js';
import type * as M127 from './system/doc.zod.js';
import type * as M128 from './system/email-config.zod.js';
import type * as M129 from './system/email-template.zod.js';
import type * as M130 from './system/encryption.zod.js';
import type * as M131 from './system/environment-artifact.zod.js';
import type * as M132 from './system/http-server.zod.js';
import type * as M133 from './system/incident-response.zod.js';
import type * as M134 from './system/job.zod.js';
import type * as M135 from './system/license.zod.js';
import type * as M136 from './system/logging.zod.js';
import type * as M138 from './system/metadata-persistence.zod.js';
import type * as M139 from './system/metrics.zod.js';
import type * as M140 from './system/migration.zod.js';
import type * as M141 from './system/notification.zod.js';
import type * as M142 from './system/object-storage.zod.js';
import type * as M143 from './system/registry-config.zod.js';
import type * as M144 from './system/search-engine.zod.js';
import type * as M145 from './system/security-context.zod.js';
import type * as M146 from './system/settings-client.zod.js';
import type * as M147 from './system/settings-manifest.zod.js';
import type * as M148 from './system/supplier-security.zod.js';
import type * as M149 from './system/tenant.zod.js';
import type * as M150 from './system/tracing.zod.js';
import type * as M151 from './system/training.zod.js';
import type * as M152 from './system/translation.zod.js';
import type * as M153 from './system/worker.zod.js';
import type * as M154 from './ui/action-params.zod.js';
import type * as M155 from './ui/action.zod.js';
import type * as M156 from './ui/app.zod.js';
import type * as M157 from './ui/bulk-action.zod.js';
import type * as M158 from './ui/chart.zod.js';
import type * as M159 from './ui/dashboard.zod.js';
import type * as M160 from './ui/dataset.zod.js';
import type * as M161 from './ui/i18n.zod.js';
import type * as M162 from './ui/notification.zod.js';
import type * as M163 from './ui/page.zod.js';
import type * as M164 from './ui/report.zod.js';
import type * as M165 from './ui/responsive.zod.js';
import type * as M166 from './ui/theme.zod.js';
import type * as M167 from './ui/view.zod.js';
// Appended out of alphabetical order deliberately: the M-indices are positional
// identifiers the pin lines below reference by number, so a new module takes the
// next free index rather than renumbering 169 imports and every pin that names
// one. #5775 is the first entry from this file — `component.zod.ts` had no bare
// `X = z.infer` alias until `PageContainerProps` arrived.
import type * as M170 from './ui/component.zod.js';

// ---------------------------------------------------------------------------
// 839 isomorphic aliases: `z.input` === `z.infer`, so no `XParsed` is declared.
//
// That number is machine-checked, not hand-kept. The runtime companion at the
// bottom of this file recomputes the pin count from the source and asserts that
// every sentence stating it — this header and that case's own title — agrees
// (#6605). Before the check existed this line had been left at 717 while the
// list grew past 800, because the counting assertion reads the `export type
// Iso...` declarations and never the prose sitting beside them.
// ---------------------------------------------------------------------------

// ai/agent.zod.ts
export type Iso0 = Assert<Eq< z.input< typeof M0.StructuredOutputFormatSchema >, z.infer< typeof M0.StructuredOutputFormatSchema > >>;
export type Iso1 = Assert<Eq< z.input< typeof M0.TransformPipelineStepSchema >, z.infer< typeof M0.TransformPipelineStepSchema > >>;

// ai/conversation.zod.ts
export type Iso2 = Assert<Eq< z.input< typeof M1.MessageRoleSchema >, z.infer< typeof M1.MessageRoleSchema > >>;
export type Iso3 = Assert<Eq< z.input< typeof M1.MessageContentTypeSchema >, z.infer< typeof M1.MessageContentTypeSchema > >>;
export type Iso4 = Assert<Eq< z.input< typeof M1.FunctionCallSchema >, z.infer< typeof M1.FunctionCallSchema > >>;
export type Iso5 = Assert<Eq< z.input< typeof M1.TokenBudgetStrategySchema >, z.infer< typeof M1.TokenBudgetStrategySchema > >>;
export type Iso6 = Assert<Eq< z.input< typeof M1.ConversationContextSchema >, z.infer< typeof M1.ConversationContextSchema > >>;
export type Iso7 = Assert<Eq< z.input< typeof M1.ConversationSummarySchema >, z.infer< typeof M1.ConversationSummarySchema > >>;
export type Iso8 = Assert<Eq< z.input< typeof M1.MessagePruningEventSchema >, z.infer< typeof M1.MessagePruningEventSchema > >>;

// ai/embedding.zod.ts
export type Iso9 = Assert<Eq< z.input< typeof M2.VectorStoreProviderSchema >, z.infer< typeof M2.VectorStoreProviderSchema > >>;
export type Iso10 = Assert<Eq< z.input< typeof M2.EmbeddingModelSchema >, z.infer< typeof M2.EmbeddingModelSchema > >>;
export type Iso11 = Assert<Eq< z.input< typeof M2.VectorStoreSchema >, z.infer< typeof M2.VectorStoreSchema > >>;

// ai/knowledge-document.zod.ts
export type Iso12 = Assert<Eq< z.input< typeof M3.KnowledgeDocumentSchema >, z.infer< typeof M3.KnowledgeDocumentSchema > >>;
export type Iso13 = Assert<Eq< z.input< typeof M3.KnowledgeChunkSchema >, z.infer< typeof M3.KnowledgeChunkSchema > >>;
export type Iso14 = Assert<Eq< z.input< typeof M3.KnowledgeHitSchema >, z.infer< typeof M3.KnowledgeHitSchema > >>;

// ai/knowledge-source.zod.ts
export type Iso15 = Assert<Eq< z.input< typeof M4.KnowledgeRefreshPolicySchema >, z.infer< typeof M4.KnowledgeRefreshPolicySchema > >>;
export type Iso16 = Assert<Eq< z.input< typeof M4.ObjectKnowledgeSourceSchema >, z.infer< typeof M4.ObjectKnowledgeSourceSchema > >>;
export type Iso17 = Assert<Eq< z.input< typeof M4.FileKnowledgeSourceSchema >, z.infer< typeof M4.FileKnowledgeSourceSchema > >>;
export type Iso18 = Assert<Eq< z.input< typeof M4.HttpKnowledgeSourceSchema >, z.infer< typeof M4.HttpKnowledgeSourceSchema > >>;
export type Iso19 = Assert<Eq< z.input< typeof M4.KnowledgeSourceKindSchema >, z.infer< typeof M4.KnowledgeSourceKindSchema > >>;
export type Iso20 = Assert<Eq< z.input< typeof M4.KnowledgeSourceSchema >, z.infer< typeof M4.KnowledgeSourceSchema > >>;

// ai/mcp.zod.ts
export type Iso21 = Assert<Eq< z.input< typeof M5.MCPTransportSchema >, z.infer< typeof M5.MCPTransportSchema > >>;
export type Iso22 = Assert<Eq< z.input< typeof M5.MCPApprovalPolicySchema >, z.infer< typeof M5.MCPApprovalPolicySchema > >>;

// ai/model-registry.zod.ts
export type Iso23 = Assert<Eq< z.input< typeof M6.ModelProviderSchema >, z.infer< typeof M6.ModelProviderSchema > >>;
export type Iso24 = Assert<Eq< z.input< typeof M6.ModelLimitsSchema >, z.infer< typeof M6.ModelLimitsSchema > >>;

// ai/skill.zod.ts
export type Iso25 = Assert<Eq< z.input< typeof M7.SkillTriggerConditionSchema >, z.infer< typeof M7.SkillTriggerConditionSchema > >>;

// ai/solution-blueprint.zod.ts
export type Iso26 = Assert<Eq< z.input< typeof M8.BlueprintConditionSchema >, z.infer< typeof M8.BlueprintConditionSchema > >>;
export type Iso27 = Assert<Eq< z.input< typeof M8.BlueprintSummaryOperationsSchema >, z.infer< typeof M8.BlueprintSummaryOperationsSchema > >>;
export type Iso28 = Assert<Eq< z.input< typeof M8.BlueprintFieldSchema >, z.infer< typeof M8.BlueprintFieldSchema > >>;
export type Iso29 = Assert<Eq< z.input< typeof M8.BlueprintObjectSchema >, z.infer< typeof M8.BlueprintObjectSchema > >>;
export type Iso30 = Assert<Eq< z.input< typeof M8.BlueprintWidgetConditionSchema >, z.infer< typeof M8.BlueprintWidgetConditionSchema > >>;
export type Iso31 = Assert<Eq< z.input< typeof M8.BlueprintDashboardSchema >, z.infer< typeof M8.BlueprintDashboardSchema > >>;
export type Iso32 = Assert<Eq< z.input< typeof M8.BlueprintSeedSchema >, z.infer< typeof M8.BlueprintSeedSchema > >>;
export type Iso33 = Assert<Eq< z.input< typeof M8.SolutionBlueprintStrictSchema >, z.infer< typeof M8.SolutionBlueprintStrictSchema > >>;

// ai/tool.zod.ts
export type Iso34 = Assert<Eq< z.input< typeof M9.ToolSchema >, z.infer< typeof M9.ToolSchema > >>;

// ai/usage.zod.ts
export type Iso35 = Assert<Eq< z.input< typeof M10.TokenUsageSchema >, z.infer< typeof M10.TokenUsageSchema > >>;
export type Iso36 = Assert<Eq< z.input< typeof M10.AIUsageRecordSchema >, z.infer< typeof M10.AIUsageRecordSchema > >>;

// api/analytics.zod.ts
export type Iso37 = Assert<Eq< z.input< typeof M11.AnalyticsEndpoint >, z.infer< typeof M11.AnalyticsEndpoint > >>;
export type Iso38 = Assert<Eq< z.input< typeof M11.AnalyticsQueryRequestSchema >, z.infer< typeof M11.AnalyticsQueryRequestSchema > >>;

// api/auth-endpoints.zod.ts
export type Iso39 = Assert<Eq< z.input< typeof M12.AuthEndpointSchema >, z.infer< typeof M12.AuthEndpointSchema > >>;
export type Iso40 = Assert<Eq< z.input< typeof M12.EmailPasswordConfigPublicSchema >, z.infer< typeof M12.EmailPasswordConfigPublicSchema > >>;
export type Iso41 = Assert<Eq< z.input< typeof M12.DeviceTokenResponseSchema >, z.infer< typeof M12.DeviceTokenResponseSchema > >>;

// api/auth.zod.ts
export type Iso42 = Assert<Eq< z.input< typeof M13.AuthProvider >, z.infer< typeof M13.AuthProvider > >>;
export type Iso43 = Assert<Eq< z.input< typeof M13.SessionSchema >, z.infer< typeof M13.SessionSchema > >>;
export type Iso44 = Assert<Eq< z.input< typeof M13.LoginType >, z.infer< typeof M13.LoginType > >>;
export type Iso45 = Assert<Eq< z.input< typeof M13.RegisterRequestSchema >, z.infer< typeof M13.RegisterRequestSchema > >>;
export type Iso46 = Assert<Eq< z.input< typeof M13.RefreshTokenRequestSchema >, z.infer< typeof M13.RefreshTokenRequestSchema > >>;

// api/automation-api.zod.ts
export type Iso47 = Assert<Eq< z.input< typeof M14.AutomationFlowPathParamsSchema >, z.infer< typeof M14.AutomationFlowPathParamsSchema > >>;
export type Iso48 = Assert<Eq< z.input< typeof M14.AutomationRunPathParamsSchema >, z.infer< typeof M14.AutomationRunPathParamsSchema > >>;
export type Iso49 = Assert<Eq< z.input< typeof M14.FlowSummarySchema >, z.infer< typeof M14.FlowSummarySchema > >>;
export type Iso50 = Assert<Eq< z.input< typeof M14.GetFlowRequestSchema >, z.infer< typeof M14.GetFlowRequestSchema > >>;
export type Iso51 = Assert<Eq< z.input< typeof M14.DeleteFlowRequestSchema >, z.infer< typeof M14.DeleteFlowRequestSchema > >>;
export type Iso52 = Assert<Eq< z.input< typeof M14.TriggerFlowRequestSchema >, z.infer< typeof M14.TriggerFlowRequestSchema > >>;
export type Iso53 = Assert<Eq< z.input< typeof M14.ToggleFlowRequestSchema >, z.infer< typeof M14.ToggleFlowRequestSchema > >>;
export type Iso54 = Assert<Eq< z.input< typeof M14.GetRunRequestSchema >, z.infer< typeof M14.GetRunRequestSchema > >>;
export type Iso55 = Assert<Eq< z.input< typeof M14.AutomationApiErrorCode >, z.infer< typeof M14.AutomationApiErrorCode > >>;

// api/batch.zod.ts
export type Iso56 = Assert<Eq< z.input< typeof M15.BatchOperationType >, z.infer< typeof M15.BatchOperationType > >>;
export type Iso57 = Assert<Eq< z.input< typeof M15.BatchRecordSchema >, z.infer< typeof M15.BatchRecordSchema > >>;
export type Iso58 = Assert<Eq< z.input< typeof M15.UpdateManyRecordSchema >, z.infer< typeof M15.UpdateManyRecordSchema > >>;
export type Iso59 = Assert<Eq< z.input< typeof M15.CrossObjectBatchDroppedFieldsSchema >, z.infer< typeof M15.CrossObjectBatchDroppedFieldsSchema > >>;
export type Iso60 = Assert<Eq< z.input< typeof M15.CrossObjectBatchResponseSchema >, z.infer< typeof M15.CrossObjectBatchResponseSchema > >>;

// api/contract.zod.ts
export type Iso61 = Assert<Eq< z.input< typeof M16.RecordDataSchema >, z.infer< typeof M16.RecordDataSchema > >>;
export type Iso62 = Assert<Eq< z.input< typeof M16.CreateRequestSchema >, z.infer< typeof M16.CreateRequestSchema > >>;
export type Iso63 = Assert<Eq< z.input< typeof M16.UpdateRequestSchema >, z.infer< typeof M16.UpdateRequestSchema > >>;
export type Iso64 = Assert<Eq< z.input< typeof M16.IdRequestSchema >, z.infer< typeof M16.IdRequestSchema > >>;

// api/discovery.zod.ts
export type Iso65 = Assert<Eq< z.input< typeof M17.ServiceStatus >, z.infer< typeof M17.ServiceStatus > >>;
export type Iso66 = Assert<Eq< z.input< typeof M17.ServiceSelfInfoSchema >, z.infer< typeof M17.ServiceSelfInfoSchema > >>;
export type Iso67 = Assert<Eq< z.input< typeof M17.DiscoveryEnvironmentSchema >, z.infer< typeof M17.DiscoveryEnvironmentSchema > >>;
export type Iso68 = Assert<Eq< z.input< typeof M17.WellKnownCapabilitiesSchema >, z.infer< typeof M17.WellKnownCapabilitiesSchema > >>;
export type Iso69 = Assert<Eq< z.input< typeof M17.CapabilityDescriptorSchema >, z.infer< typeof M17.CapabilityDescriptorSchema > >>;
export type Iso70 = Assert<Eq< z.input< typeof M17.DiscoverySchema >, z.infer< typeof M17.DiscoverySchema > >>;
export type Iso71 = Assert<Eq< z.input< typeof M17.ApiRoutesSchema >, z.infer< typeof M17.ApiRoutesSchema > >>;
export type Iso72 = Assert<Eq< z.input< typeof M17.ServiceInfoSchema >, z.infer< typeof M17.ServiceInfoSchema > >>;
export type Iso73 = Assert<Eq< z.input< typeof M17.RouteHealthEntrySchema >, z.infer< typeof M17.RouteHealthEntrySchema > >>;
export type Iso74 = Assert<Eq< z.input< typeof M17.RouteHealthReportSchema >, z.infer< typeof M17.RouteHealthReportSchema > >>;

// api/dispatcher.zod.ts
export type Iso75 = Assert<Eq< z.input< typeof M18.DispatcherErrorCode >, z.infer< typeof M18.DispatcherErrorCode > >>;
export type Iso76 = Assert<Eq< z.input< typeof M18.DispatcherErrorResponseSchema >, z.infer< typeof M18.DispatcherErrorResponseSchema > >>;

// api/documentation.zod.ts
export type Iso77 = Assert<Eq< z.input< typeof M19.OpenApiServerSchema >, z.infer< typeof M19.OpenApiServerSchema > >>;
export type Iso78 = Assert<Eq< z.input< typeof M19.OpenApiSecuritySchemeSchema >, z.infer< typeof M19.OpenApiSecuritySchemeSchema > >>;
export type Iso79 = Assert<Eq< z.input< typeof M19.ApiTestingUiType >, z.infer< typeof M19.ApiTestingUiType > >>;
export type Iso80 = Assert<Eq< z.input< typeof M19.CodeGenerationTemplateSchema >, z.infer< typeof M19.CodeGenerationTemplateSchema > >>;

// api/errors.zod.ts
export type Iso81 = Assert<Eq< z.input< typeof M20.ErrorCategory >, z.infer< typeof M20.ErrorCategory > >>;
export type Iso82 = Assert<Eq< z.input< typeof M20.StandardErrorCode >, z.infer< typeof M20.StandardErrorCode > >>;
export type Iso83 = Assert<Eq< z.input< typeof M20.RetryStrategy >, z.infer< typeof M20.RetryStrategy > >>;

// api/error-code-ledger.zod.ts
export type Iso838 = Assert<Eq< z.input< typeof M182.StandardSynonymWaiverSchema >, z.infer< typeof M182.StandardSynonymWaiverSchema > >>;
export type Iso84 = Assert<Eq< z.input< typeof M20.FieldErrorCode >, z.infer< typeof M20.FieldErrorCode > >>;
export type Iso85 = Assert<Eq< z.input< typeof M20.FieldErrorSchema >, z.infer< typeof M20.FieldErrorSchema > >>;

// api/events.zod.ts
export type Iso86 = Assert<Eq< z.input< typeof M21.MetadataEventType >, z.infer< typeof M21.MetadataEventType > >>;
export type Iso87 = Assert<Eq< z.input< typeof M21.DataEventType >, z.infer< typeof M21.DataEventType > >>;
export type Iso88 = Assert<Eq< z.input< typeof M21.BulkDataEventType >, z.infer< typeof M21.BulkDataEventType > >>;
export type Iso89 = Assert<Eq< z.input< typeof M21.MetadataEventSchema >, z.infer< typeof M21.MetadataEventSchema > >>;
export type Iso90 = Assert<Eq< z.input< typeof M21.DataEventSchema >, z.infer< typeof M21.DataEventSchema > >>;
export type Iso91 = Assert<Eq< z.input< typeof M21.BulkDataEventSchema >, z.infer< typeof M21.BulkDataEventSchema > >>;

// api/export.zod.ts
export type Iso92 = Assert<Eq< z.input< typeof M22.ExportFormat >, z.infer< typeof M22.ExportFormat > >>;
export type Iso93 = Assert<Eq< z.input< typeof M22.ExportJobStatus >, z.infer< typeof M22.ExportJobStatus > >>;
export type Iso94 = Assert<Eq< z.input< typeof M22.ImportValidationMode >, z.infer< typeof M22.ImportValidationMode > >>;
export type Iso95 = Assert<Eq< z.input< typeof M22.DeduplicationStrategy >, z.infer< typeof M22.DeduplicationStrategy > >>;
export type Iso96 = Assert<Eq< z.input< typeof M22.ImportWriteMode >, z.infer< typeof M22.ImportWriteMode > >>;
export type Iso97 = Assert<Eq< z.input< typeof M22.ImportRowResultSchema >, z.infer< typeof M22.ImportRowResultSchema > >>;
export type Iso98 = Assert<Eq< z.input< typeof M22.ImportResponseSchema >, z.infer< typeof M22.ImportResponseSchema > >>;
export type Iso99 = Assert<Eq< z.input< typeof M22.ImportJobStatus >, z.infer< typeof M22.ImportJobStatus > >>;
export type Iso100 = Assert<Eq< z.input< typeof M22.CreateImportJobResponseSchema >, z.infer< typeof M22.CreateImportJobResponseSchema > >>;
export type Iso101 = Assert<Eq< z.input< typeof M22.ImportJobProgressSchema >, z.infer< typeof M22.ImportJobProgressSchema > >>;
export type Iso102 = Assert<Eq< z.input< typeof M22.ImportJobResultsSchema >, z.infer< typeof M22.ImportJobResultsSchema > >>;
export type Iso103 = Assert<Eq< z.input< typeof M22.ImportJobSummarySchema >, z.infer< typeof M22.ImportJobSummarySchema > >>;
export type Iso104 = Assert<Eq< z.input< typeof M22.ListImportJobsResponseSchema >, z.infer< typeof M22.ListImportJobsResponseSchema > >>;
export type Iso105 = Assert<Eq< z.input< typeof M22.UndoImportJobResponseSchema >, z.infer< typeof M22.UndoImportJobResponseSchema > >>;
export type Iso106 = Assert<Eq< z.input< typeof M22.GetExportJobDownloadRequestSchema >, z.infer< typeof M22.GetExportJobDownloadRequestSchema > >>;
export type Iso107 = Assert<Eq< z.input< typeof M22.ExportJobSummarySchema >, z.infer< typeof M22.ExportJobSummarySchema > >>;

// api/http-cache.zod.ts
export type Iso108 = Assert<Eq< z.input< typeof M23.CacheDirective >, z.infer< typeof M23.CacheDirective > >>;
export type Iso109 = Assert<Eq< z.input< typeof M23.CacheControlSchema >, z.infer< typeof M23.CacheControlSchema > >>;
export type Iso110 = Assert<Eq< z.input< typeof M23.MetadataCacheRequestSchema >, z.infer< typeof M23.MetadataCacheRequestSchema > >>;
export type Iso111 = Assert<Eq< z.input< typeof M23.CacheInvalidationTarget >, z.infer< typeof M23.CacheInvalidationTarget > >>;
export type Iso112 = Assert<Eq< z.input< typeof M23.CacheInvalidationResponseSchema >, z.infer< typeof M23.CacheInvalidationResponseSchema > >>;

// api/metadata.zod.ts
export type Iso113 = Assert<Eq< z.input< typeof M24.MetadataRegisterRequestSchema >, z.infer< typeof M24.MetadataRegisterRequestSchema > >>;

// api/odata.zod.ts
export type Iso114 = Assert<Eq< z.input< typeof M25.ODataQuerySchema >, z.infer< typeof M25.ODataQuerySchema > >>;
export type Iso115 = Assert<Eq< z.input< typeof M25.ODataFilterFunctionSchema >, z.infer< typeof M25.ODataFilterFunctionSchema > >>;
export type Iso116 = Assert<Eq< z.input< typeof M25.ODataResponseSchema >, z.infer< typeof M25.ODataResponseSchema > >>;
export type Iso117 = Assert<Eq< z.input< typeof M25.ODataErrorSchema >, z.infer< typeof M25.ODataErrorSchema > >>;

// api/package-api.zod.ts
export type Iso118 = Assert<Eq< z.input< typeof M26.PackagePathParamsSchema >, z.infer< typeof M26.PackagePathParamsSchema > >>;
export type Iso119 = Assert<Eq< z.input< typeof M26.GetInstalledPackageRequestSchema >, z.infer< typeof M26.GetInstalledPackageRequestSchema > >>;
export type Iso120 = Assert<Eq< z.input< typeof M26.UninstallPackageApiRequestSchema >, z.infer< typeof M26.UninstallPackageApiRequestSchema > >>;
export type Iso121 = Assert<Eq< z.input< typeof M26.PackageApiErrorCode >, z.infer< typeof M26.PackageApiErrorCode > >>;

// api/plugin-rest-api.zod.ts
export type Iso122 = Assert<Eq< z.input< typeof M27.RestApiRouteCategory >, z.infer< typeof M27.RestApiRouteCategory > >>;
export type Iso123 = Assert<Eq< z.input< typeof M27.HandlerStatusSchema >, z.infer< typeof M27.HandlerStatusSchema > >>;
export type Iso124 = Assert<Eq< z.input< typeof M27.ValidationMode >, z.infer< typeof M27.ValidationMode > >>;
export type Iso125 = Assert<Eq< z.input< typeof M27.RouteCoverageEntrySchema >, z.infer< typeof M27.RouteCoverageEntrySchema > >>;
export type Iso126 = Assert<Eq< z.input< typeof M27.RouteCoverageReportSchema >, z.infer< typeof M27.RouteCoverageReportSchema > >>;

// api/protocol.zod.ts
export type Iso127 = Assert<Eq< z.input< typeof M28.GetDiscoveryRequestSchema >, z.infer< typeof M28.GetDiscoveryRequestSchema > >>;
export type Iso128 = Assert<Eq< z.input< typeof M28.GetDiscoveryResponseSchema >, z.infer< typeof M28.GetDiscoveryResponseSchema > >>;
export type Iso129 = Assert<Eq< z.input< typeof M28.GetMetaTypesRequestSchema >, z.infer< typeof M28.GetMetaTypesRequestSchema > >>;
export type Iso130 = Assert<Eq< z.input< typeof M28.GetMetaTypesResponseSchema >, z.infer< typeof M28.GetMetaTypesResponseSchema > >>;
export type Iso131 = Assert<Eq< z.input< typeof M28.GetMetaItemsRequestSchema >, z.infer< typeof M28.GetMetaItemsRequestSchema > >>;
export type Iso132 = Assert<Eq< z.input< typeof M28.GetMetaItemsResponseSchema >, z.infer< typeof M28.GetMetaItemsResponseSchema > >>;
export type Iso133 = Assert<Eq< z.input< typeof M28.GetMetaItemRequestSchema >, z.infer< typeof M28.GetMetaItemRequestSchema > >>;
export type Iso134 = Assert<Eq< z.input< typeof M28.GetMetaItemResponseSchema >, z.infer< typeof M28.GetMetaItemResponseSchema > >>;
export type Iso853 = Assert<Eq< z.input< typeof M28.GetMetaItemLayeredRequestSchema >, z.infer< typeof M28.GetMetaItemLayeredRequestSchema > >>;
export type Iso833 = Assert<Eq< z.input< typeof M28.GetMetaItemLayeredResponseSchema >, z.infer< typeof M28.GetMetaItemLayeredResponseSchema > >>;
export type Iso135 = Assert<Eq< z.input< typeof M28.SaveMetaItemRequestSchema >, z.infer< typeof M28.SaveMetaItemRequestSchema > >>;
export type Iso136 = Assert<Eq< z.input< typeof M28.SaveMetaItemResponseSchema >, z.infer< typeof M28.SaveMetaItemResponseSchema > >>;
export type Iso836 = Assert<Eq< z.input< typeof M28.PublishMetaItemResponseSchema >, z.infer< typeof M28.PublishMetaItemResponseSchema > >>;
export type Iso852 = Assert<Eq< z.input< typeof M28.PublishPackageDraftsResponseSchema >, z.infer< typeof M28.PublishPackageDraftsResponseSchema > >>;
export type Iso837 = Assert<Eq< z.input< typeof M28.RuntimeAuthoringIssueSchema >, z.infer< typeof M28.RuntimeAuthoringIssueSchema > >>;
export type Iso137 = Assert<Eq< z.input< typeof M28.DeleteMetaItemRequestSchema >, z.infer< typeof M28.DeleteMetaItemRequestSchema > >>;
export type Iso138 = Assert<Eq< z.input< typeof M28.DeleteMetaItemResponseSchema >, z.infer< typeof M28.DeleteMetaItemResponseSchema > >>;
export type Iso139 = Assert<Eq< z.input< typeof M28.GetMetaItemCachedRequestSchema >, z.infer< typeof M28.GetMetaItemCachedRequestSchema > >>;
export type Iso140 = Assert<Eq< z.input< typeof M28.GetUiViewRequestSchema >, z.infer< typeof M28.GetUiViewRequestSchema > >>;
export type Iso141 = Assert<Eq< z.input< typeof M28.AutomationTriggerRequestSchema >, z.infer< typeof M28.AutomationTriggerRequestSchema > >>;
export type Iso142 = Assert<Eq< z.input< typeof M28.AutomationTriggerResponseSchema >, z.infer< typeof M28.AutomationTriggerResponseSchema > >>;
export type Iso143 = Assert<Eq< z.input< typeof M28.FindDataResponseSchema >, z.infer< typeof M28.FindDataResponseSchema > >>;
export type Iso144 = Assert<Eq< z.input< typeof M28.GetDataResponseSchema >, z.infer< typeof M28.GetDataResponseSchema > >>;
export type Iso145 = Assert<Eq< z.input< typeof M28.CreateDataResponseSchema >, z.infer< typeof M28.CreateDataResponseSchema > >>;
export type Iso146 = Assert<Eq< z.input< typeof M28.UpdateDataResponseSchema >, z.infer< typeof M28.UpdateDataResponseSchema > >>;
export type Iso147 = Assert<Eq< z.input< typeof M28.DeleteDataResponseSchema >, z.infer< typeof M28.DeleteDataResponseSchema > >>;
export type Iso148 = Assert<Eq< z.input< typeof M28.CreateManyDataResponseSchema >, z.infer< typeof M28.CreateManyDataResponseSchema > >>;
export type Iso150 = Assert<Eq< z.input< typeof M28.CheckPermissionResponseSchema >, z.infer< typeof M28.CheckPermissionResponseSchema > >>;
export type Iso151 = Assert<Eq< z.input< typeof M28.GetEffectivePermissionsResponseSchema >, z.infer< typeof M28.GetEffectivePermissionsResponseSchema > >>;
export type Iso152 = Assert<Eq< z.input< typeof M28.RealtimeConnectResponseSchema >, z.infer< typeof M28.RealtimeConnectResponseSchema > >>;
export type Iso153 = Assert<Eq< z.input< typeof M28.RealtimeDisconnectResponseSchema >, z.infer< typeof M28.RealtimeDisconnectResponseSchema > >>;
export type Iso154 = Assert<Eq< z.input< typeof M28.RealtimeSubscribeResponseSchema >, z.infer< typeof M28.RealtimeSubscribeResponseSchema > >>;
export type Iso155 = Assert<Eq< z.input< typeof M28.RealtimeUnsubscribeResponseSchema >, z.infer< typeof M28.RealtimeUnsubscribeResponseSchema > >>;
export type Iso156 = Assert<Eq< z.input< typeof M28.SetPresenceResponseSchema >, z.infer< typeof M28.SetPresenceResponseSchema > >>;
export type Iso157 = Assert<Eq< z.input< typeof M28.GetPresenceResponseSchema >, z.infer< typeof M28.GetPresenceResponseSchema > >>;
export type Iso158 = Assert<Eq< z.input< typeof M28.RegisterDeviceResponseSchema >, z.infer< typeof M28.RegisterDeviceResponseSchema > >>;
export type Iso159 = Assert<Eq< z.input< typeof M28.UnregisterDeviceResponseSchema >, z.infer< typeof M28.UnregisterDeviceResponseSchema > >>;
export type Iso160 = Assert<Eq< z.input< typeof M28.MarkNotificationsReadResponseSchema >, z.infer< typeof M28.MarkNotificationsReadResponseSchema > >>;
export type Iso161 = Assert<Eq< z.input< typeof M28.MarkAllNotificationsReadResponseSchema >, z.infer< typeof M28.MarkAllNotificationsReadResponseSchema > >>;
export type Iso162 = Assert<Eq< z.input< typeof M28.AiChatResponseSchema >, z.infer< typeof M28.AiChatResponseSchema > >>;
export type Iso163 = Assert<Eq< z.input< typeof M28.AiStreamChunkSchema >, z.infer< typeof M28.AiStreamChunkSchema > >>;
export type Iso164 = Assert<Eq< z.input< typeof M28.AiModelsResponseSchema >, z.infer< typeof M28.AiModelsResponseSchema > >>;
export type Iso165 = Assert<Eq< z.input< typeof M28.AiConversationSchema >, z.infer< typeof M28.AiConversationSchema > >>;
export type Iso166 = Assert<Eq< z.input< typeof M28.ListAiConversationsResponseSchema >, z.infer< typeof M28.ListAiConversationsResponseSchema > >>;
export type Iso167 = Assert<Eq< z.input< typeof M28.AiAgentCapabilitiesSchema >, z.infer< typeof M28.AiAgentCapabilitiesSchema > >>;
export type Iso168 = Assert<Eq< z.input< typeof M28.AiAgentSummarySchema >, z.infer< typeof M28.AiAgentSummarySchema > >>;
export type Iso169 = Assert<Eq< z.input< typeof M28.AiAgentsResponseSchema >, z.infer< typeof M28.AiAgentsResponseSchema > >>;
export type Iso170 = Assert<Eq< z.input< typeof M28.AiPendingActionStatusSchema >, z.infer< typeof M28.AiPendingActionStatusSchema > >>;
export type Iso171 = Assert<Eq< z.input< typeof M28.AiPendingActionSchema >, z.infer< typeof M28.AiPendingActionSchema > >>;
export type Iso172 = Assert<Eq< z.input< typeof M28.ListAiPendingActionsResponseSchema >, z.infer< typeof M28.ListAiPendingActionsResponseSchema > >>;
export type Iso173 = Assert<Eq< z.input< typeof M28.ApproveAiPendingActionResponseSchema >, z.infer< typeof M28.ApproveAiPendingActionResponseSchema > >>;
export type Iso174 = Assert<Eq< z.input< typeof M28.RejectAiPendingActionResponseSchema >, z.infer< typeof M28.RejectAiPendingActionResponseSchema > >>;
export type Iso175 = Assert<Eq< z.input< typeof M28.GetTranslationsResponseSchema >, z.infer< typeof M28.GetTranslationsResponseSchema > >>;
export type Iso176 = Assert<Eq< z.input< typeof M28.GetFieldLabelsResponseSchema >, z.infer< typeof M28.GetFieldLabelsResponseSchema > >>;

// api/query-adapter.zod.ts
export type Iso177 = Assert<Eq< z.input< typeof M29.QueryAdapterTargetSchema >, z.infer< typeof M29.QueryAdapterTargetSchema > >>;
export type Iso178 = Assert<Eq< z.input< typeof M29.OperatorMappingSchema >, z.infer< typeof M29.OperatorMappingSchema > >>;

// api/realtime-shared.zod.ts
export type Iso179 = Assert<Eq< z.input< typeof M30.PresenceStatus >, z.infer< typeof M30.PresenceStatus > >>;
export type Iso180 = Assert<Eq< z.input< typeof M30.RealtimeRecordAction >, z.infer< typeof M30.RealtimeRecordAction > >>;
export type Iso181 = Assert<Eq< z.input< typeof M30.BasePresenceSchema >, z.infer< typeof M30.BasePresenceSchema > >>;

// api/realtime.zod.ts
export type Iso182 = Assert<Eq< z.input< typeof M31.TransportProtocol >, z.infer< typeof M31.TransportProtocol > >>;
export type Iso183 = Assert<Eq< z.input< typeof M31.RealtimeEventType >, z.infer< typeof M31.RealtimeEventType > >>;
export type Iso184 = Assert<Eq< z.input< typeof M31.SubscriptionSchema >, z.infer< typeof M31.SubscriptionSchema > >>;
export type Iso185 = Assert<Eq< z.input< typeof M31.RealtimePresenceSchema >, z.infer< typeof M31.RealtimePresenceSchema > >>;
export type Iso186 = Assert<Eq< z.input< typeof M31.RealtimeEventSchema >, z.infer< typeof M31.RealtimeEventSchema > >>;

// api/rest-server.zod.ts
export type Iso187 = Assert<Eq< z.input< typeof M32.CrudOperation >, z.infer< typeof M32.CrudOperation > >>;
export type Iso188 = Assert<Eq< z.input< typeof M32.CrudEndpointPatternSchema >, z.infer< typeof M32.CrudEndpointPatternSchema > >>;
export type Iso189 = Assert<Eq< z.input< typeof M32.GeneratedEndpointSchema >, z.infer< typeof M32.GeneratedEndpointSchema > >>;
export type Iso190 = Assert<Eq< z.input< typeof M32.EndpointRegistrySchema >, z.infer< typeof M32.EndpointRegistrySchema > >>;

// api/router.zod.ts
export type Iso191 = Assert<Eq< z.input< typeof M33.RouteCategory >, z.infer< typeof M33.RouteCategory > >>;
export type Iso192 = Assert<Eq< z.input< typeof M33.ConflictResolutionStrategy >, z.infer< typeof M33.ConflictResolutionStrategy > >>;

// api/storage.zod.ts
export type Iso193 = Assert<Eq< z.input< typeof M34.CompleteUploadRequestSchema >, z.infer< typeof M34.CompleteUploadRequestSchema > >>;
export type Iso194 = Assert<Eq< z.input< typeof M34.FileTypeValidationSchema >, z.infer< typeof M34.FileTypeValidationSchema > >>;
export type Iso195 = Assert<Eq< z.input< typeof M34.UploadChunkRequestSchema >, z.infer< typeof M34.UploadChunkRequestSchema > >>;
export type Iso196 = Assert<Eq< z.input< typeof M34.CompleteChunkedUploadRequestSchema >, z.infer< typeof M34.CompleteChunkedUploadRequestSchema > >>;

// api/versioning.zod.ts
export type Iso197 = Assert<Eq< z.input< typeof M35.VersioningStrategy >, z.infer< typeof M35.VersioningStrategy > >>;
export type Iso198 = Assert<Eq< z.input< typeof M35.VersionStatus >, z.infer< typeof M35.VersionStatus > >>;
export type Iso199 = Assert<Eq< z.input< typeof M35.VersionDefinitionSchema >, z.infer< typeof M35.VersionDefinitionSchema > >>;
export type Iso200 = Assert<Eq< z.input< typeof M35.VersionNegotiationResponseSchema >, z.infer< typeof M35.VersionNegotiationResponseSchema > >>;

// api/websocket.zod.ts
export type Iso201 = Assert<Eq< z.input< typeof M36.WebSocketMessageType >, z.infer< typeof M36.WebSocketMessageType > >>;
export type Iso202 = Assert<Eq< z.input< typeof M36.EventPatternSchema >, z.infer< typeof M36.EventPatternSchema > >>;
export type Iso203 = Assert<Eq< z.input< typeof M36.EventSubscriptionSchema >, z.infer< typeof M36.EventSubscriptionSchema > >>;
export type Iso204 = Assert<Eq< z.input< typeof M36.UnsubscribeRequestSchema >, z.infer< typeof M36.UnsubscribeRequestSchema > >>;
export type Iso205 = Assert<Eq< z.input< typeof M36.WebSocketPresenceStatus >, z.infer< typeof M36.WebSocketPresenceStatus > >>;
export type Iso206 = Assert<Eq< z.input< typeof M36.PresenceStateSchema >, z.infer< typeof M36.PresenceStateSchema > >>;
export type Iso207 = Assert<Eq< z.input< typeof M36.PresenceUpdateSchema >, z.infer< typeof M36.PresenceUpdateSchema > >>;
export type Iso208 = Assert<Eq< z.input< typeof M36.CursorPositionSchema >, z.infer< typeof M36.CursorPositionSchema > >>;
export type Iso209 = Assert<Eq< z.input< typeof M36.EditOperationType >, z.infer< typeof M36.EditOperationType > >>;
export type Iso210 = Assert<Eq< z.input< typeof M36.EditOperationSchema >, z.infer< typeof M36.EditOperationSchema > >>;
export type Iso211 = Assert<Eq< z.input< typeof M36.DocumentStateSchema >, z.infer< typeof M36.DocumentStateSchema > >>;
export type Iso212 = Assert<Eq< z.input< typeof M36.SubscribeMessageSchema >, z.infer< typeof M36.SubscribeMessageSchema > >>;
export type Iso213 = Assert<Eq< z.input< typeof M36.UnsubscribeMessageSchema >, z.infer< typeof M36.UnsubscribeMessageSchema > >>;
export type Iso214 = Assert<Eq< z.input< typeof M36.EventMessageSchema >, z.infer< typeof M36.EventMessageSchema > >>;
export type Iso215 = Assert<Eq< z.input< typeof M36.PresenceMessageSchema >, z.infer< typeof M36.PresenceMessageSchema > >>;
export type Iso216 = Assert<Eq< z.input< typeof M36.CursorMessageSchema >, z.infer< typeof M36.CursorMessageSchema > >>;
export type Iso217 = Assert<Eq< z.input< typeof M36.EditMessageSchema >, z.infer< typeof M36.EditMessageSchema > >>;
export type Iso218 = Assert<Eq< z.input< typeof M36.AckMessageSchema >, z.infer< typeof M36.AckMessageSchema > >>;
export type Iso219 = Assert<Eq< z.input< typeof M36.ErrorMessageSchema >, z.infer< typeof M36.ErrorMessageSchema > >>;
export type Iso220 = Assert<Eq< z.input< typeof M36.PingMessageSchema >, z.infer< typeof M36.PingMessageSchema > >>;
export type Iso221 = Assert<Eq< z.input< typeof M36.PongMessageSchema >, z.infer< typeof M36.PongMessageSchema > >>;
export type Iso222 = Assert<Eq< z.input< typeof M36.WebSocketMessageSchema >, z.infer< typeof M36.WebSocketMessageSchema > >>;
export type Iso223 = Assert<Eq< z.input< typeof M36.WebSocketEventSchema >, z.infer< typeof M36.WebSocketEventSchema > >>;
export type Iso224 = Assert<Eq< z.input< typeof M36.SimplePresenceStateSchema >, z.infer< typeof M36.SimplePresenceStateSchema > >>;
export type Iso225 = Assert<Eq< z.input< typeof M36.SimpleCursorPositionSchema >, z.infer< typeof M36.SimpleCursorPositionSchema > >>;

// automation/approval.zod.ts
export type Iso226 = Assert<Eq< z.input< typeof M37.ApprovalDecision >, z.infer< typeof M37.ApprovalDecision > >>;
export type Iso227 = Assert<Eq< z.input< typeof M37.ApprovalNodeApproverSchema >, z.infer< typeof M37.ApprovalNodeApproverSchema > >>;
export type Iso228 = Assert<Eq< z.input< typeof M37.DecisionOutputDefSchema >, z.infer< typeof M37.DecisionOutputDefSchema > >>;

// automation/bpmn-interop.zod.ts
export type Iso229 = Assert<Eq< z.input< typeof M38.BpmnUnmappedStrategySchema >, z.infer< typeof M38.BpmnUnmappedStrategySchema > >>;
export type Iso230 = Assert<Eq< z.input< typeof M38.BpmnVersionSchema >, z.infer< typeof M38.BpmnVersionSchema > >>;
export type Iso231 = Assert<Eq< z.input< typeof M38.BpmnDiagnosticSchema >, z.infer< typeof M38.BpmnDiagnosticSchema > >>;

// automation/execution.zod.ts
export type Iso232 = Assert<Eq< z.input< typeof M39.ExecutionStatus >, z.infer< typeof M39.ExecutionStatus > >>;
export type Iso233 = Assert<Eq< z.input< typeof M39.ExecutionStepMetricsSchema >, z.infer< typeof M39.ExecutionStepMetricsSchema > >>;
export type Iso234 = Assert<Eq< z.input< typeof M39.ExecutionStepSkipReasonSchema >, z.infer< typeof M39.ExecutionStepSkipReasonSchema > >>;
export type Iso235 = Assert<Eq< z.input< typeof M39.FlowRunNodeSummarySchema >, z.infer< typeof M39.FlowRunNodeSummarySchema > >>;
export type Iso236 = Assert<Eq< z.input< typeof M39.FlowRunGateSummarySchema >, z.infer< typeof M39.FlowRunGateSummarySchema > >>;
export type Iso237 = Assert<Eq< z.input< typeof M39.ExecutionErrorSeverity >, z.infer< typeof M39.ExecutionErrorSeverity > >>;

// automation/flow-function.zod.ts
export type Iso238 = Assert<Eq< z.input< typeof M40.FlowFunctionEffectSchema >, z.infer< typeof M40.FlowFunctionEffectSchema > >>;

// automation/node-executor.zod.ts
export type Iso239 = Assert<Eq< z.input< typeof M41.WaitEventTypeSchema >, z.infer< typeof M41.WaitEventTypeSchema > >>;
export type Iso240 = Assert<Eq< z.input< typeof M41.WaitResumePayloadSchema >, z.infer< typeof M41.WaitResumePayloadSchema > >>;
export type Iso241 = Assert<Eq< z.input< typeof M41.WaitTimeoutBehaviorSchema >, z.infer< typeof M41.WaitTimeoutBehaviorSchema > >>;
export type Iso242 = Assert<Eq< z.input< typeof M41.ActionCategorySchema >, z.infer< typeof M41.ActionCategorySchema > >>;
export type Iso243 = Assert<Eq< z.input< typeof M41.ActionParadigmSchema >, z.infer< typeof M41.ActionParadigmSchema > >>;

// automation/state-machine.zod.ts
export type Iso244 = Assert<Eq< z.input< typeof M42.ActionRefSchema >, z.infer< typeof M42.ActionRefSchema > >>;
export type Iso245 = Assert<Eq< z.input< typeof M42.TransitionSchema >, z.infer< typeof M42.TransitionSchema > >>;
export type Iso246 = Assert<Eq< z.input< typeof M42.StateMachineSchema >, z.infer< typeof M42.StateMachineSchema > >>;

// automation/time-relative-trigger.zod.ts
export type Iso247 = Assert<Eq< z.input< typeof M43.TimeRelativeTriggerSchema >, z.infer< typeof M43.TimeRelativeTriggerSchema > >>;

// automation/webhook.zod.ts
export type Iso248 = Assert<Eq< z.input< typeof M44.WebhookTriggerType >, z.infer< typeof M44.WebhookTriggerType > >>;

// cloud/app-store.zod.ts
export type Iso249 = Assert<Eq< z.input< typeof M45.ReviewModerationStatusSchema >, z.infer< typeof M45.ReviewModerationStatusSchema > >>;
export type Iso250 = Assert<Eq< z.input< typeof M45.SubmitReviewRequestSchema >, z.infer< typeof M45.SubmitReviewRequestSchema > >>;
export type Iso251 = Assert<Eq< z.input< typeof M45.RecommendationReasonSchema >, z.infer< typeof M45.RecommendationReasonSchema > >>;
export type Iso252 = Assert<Eq< z.input< typeof M45.RecommendedAppSchema >, z.infer< typeof M45.RecommendedAppSchema > >>;
export type Iso253 = Assert<Eq< z.input< typeof M45.AppDiscoveryResponseSchema >, z.infer< typeof M45.AppDiscoveryResponseSchema > >>;
export type Iso254 = Assert<Eq< z.input< typeof M45.SubscriptionStatusSchema >, z.infer< typeof M45.SubscriptionStatusSchema > >>;

// cloud/developer-portal.zod.ts
export type Iso255 = Assert<Eq< z.input< typeof M46.ReleaseChannelSchema >, z.infer< typeof M46.ReleaseChannelSchema > >>;
export type Iso256 = Assert<Eq< z.input< typeof M46.UpdateListingRequestSchema >, z.infer< typeof M46.UpdateListingRequestSchema > >>;
export type Iso257 = Assert<Eq< z.input< typeof M46.ListingActionRequestSchema >, z.infer< typeof M46.ListingActionRequestSchema > >>;
export type Iso258 = Assert<Eq< z.input< typeof M46.AnalyticsTimeRangeSchema >, z.infer< typeof M46.AnalyticsTimeRangeSchema > >>;
export type Iso259 = Assert<Eq< z.input< typeof M46.TimeSeriesPointSchema >, z.infer< typeof M46.TimeSeriesPointSchema > >>;

// cloud/environment-package.zod.ts
export type Iso260 = Assert<Eq< z.input< typeof M47.EnvironmentPackageStatusSchema >, z.infer< typeof M47.EnvironmentPackageStatusSchema > >>;
export type Iso261 = Assert<Eq< z.input< typeof M47.RollbackEnvironmentPackageRequestSchema >, z.infer< typeof M47.RollbackEnvironmentPackageRequestSchema > >>;

// cloud/environment.zod.ts
export type Iso262 = Assert<Eq< z.input< typeof M48.EnvironmentTypeSchema >, z.infer< typeof M48.EnvironmentTypeSchema > >>;
export type Iso263 = Assert<Eq< z.input< typeof M48.EnvironmentStatusSchema >, z.infer< typeof M48.EnvironmentStatusSchema > >>;
export type Iso264 = Assert<Eq< z.input< typeof M48.EnvironmentDriverSchema >, z.infer< typeof M48.EnvironmentDriverSchema > >>;
export type Iso265 = Assert<Eq< z.input< typeof M48.EnvironmentVisibilitySchema >, z.infer< typeof M48.EnvironmentVisibilitySchema > >>;
export type Iso266 = Assert<Eq< z.input< typeof M48.EnvironmentCredentialStatusSchema >, z.infer< typeof M48.EnvironmentCredentialStatusSchema > >>;
export type Iso267 = Assert<Eq< z.input< typeof M48.EnvironmentRoleSchema >, z.infer< typeof M48.EnvironmentRoleSchema > >>;
export type Iso268 = Assert<Eq< z.input< typeof M48.EnvironmentMemberSchema >, z.infer< typeof M48.EnvironmentMemberSchema > >>;

// cloud/marketplace-admin.zod.ts
export type Iso269 = Assert<Eq< z.input< typeof M49.ReviewDecisionSchema >, z.infer< typeof M49.ReviewDecisionSchema > >>;
export type Iso270 = Assert<Eq< z.input< typeof M49.RejectionReasonSchema >, z.infer< typeof M49.RejectionReasonSchema > >>;
export type Iso271 = Assert<Eq< z.input< typeof M49.PolicyViolationTypeSchema >, z.infer< typeof M49.PolicyViolationTypeSchema > >>;
export type Iso272 = Assert<Eq< z.input< typeof M49.MarketplaceHealthMetricsSchema >, z.infer< typeof M49.MarketplaceHealthMetricsSchema > >>;
export type Iso273 = Assert<Eq< z.input< typeof M49.TrendingListingSchema >, z.infer< typeof M49.TrendingListingSchema > >>;

// cloud/marketplace.zod.ts
export type Iso274 = Assert<Eq< z.input< typeof M50.ArtifactDownloadResponseSchema >, z.infer< typeof M50.ArtifactDownloadResponseSchema > >>;
export type Iso275 = Assert<Eq< z.input< typeof M50.PublisherVerificationSchema >, z.infer< typeof M50.PublisherVerificationSchema > >>;
export type Iso276 = Assert<Eq< z.input< typeof M50.MarketplaceCategorySchema >, z.infer< typeof M50.MarketplaceCategorySchema > >>;
export type Iso277 = Assert<Eq< z.input< typeof M50.ListingStatusSchema >, z.infer< typeof M50.ListingStatusSchema > >>;
export type Iso278 = Assert<Eq< z.input< typeof M50.PricingModelSchema >, z.infer< typeof M50.PricingModelSchema > >>;
export type Iso279 = Assert<Eq< z.input< typeof M50.MarketplaceInstallResponseSchema >, z.infer< typeof M50.MarketplaceInstallResponseSchema > >>;

// cloud/package-version.zod.ts
export type Iso280 = Assert<Eq< z.input< typeof M51.PackageVersionStatusSchema >, z.infer< typeof M51.PackageVersionStatusSchema > >>;
export type Iso281 = Assert<Eq< z.input< typeof M51.CreatePackageVersionRequestSchema >, z.infer< typeof M51.CreatePackageVersionRequestSchema > >>;
export type Iso282 = Assert<Eq< z.input< typeof M51.UpdatePackageVersionRequestSchema >, z.infer< typeof M51.UpdatePackageVersionRequestSchema > >>;
export type Iso283 = Assert<Eq< z.input< typeof M51.PublishPackageVersionRequestSchema >, z.infer< typeof M51.PublishPackageVersionRequestSchema > >>;

// cloud/package.zod.ts
export type Iso284 = Assert<Eq< z.input< typeof M52.PackageVisibilitySchema >, z.infer< typeof M52.PackageVisibilitySchema > >>;
export type Iso285 = Assert<Eq< z.input< typeof M52.PackageCategorySchema >, z.infer< typeof M52.PackageCategorySchema > >>;
export type Iso286 = Assert<Eq< z.input< typeof M52.PackagePublisherSchema >, z.infer< typeof M52.PackagePublisherSchema > >>;
export type Iso287 = Assert<Eq< z.input< typeof M52.PackageLocaleSchema >, z.infer< typeof M52.PackageLocaleSchema > >>;
export type Iso288 = Assert<Eq< z.input< typeof M52.PackageTranslationSchema >, z.infer< typeof M52.PackageTranslationSchema > >>;
export type Iso289 = Assert<Eq< z.input< typeof M52.PackageTranslationsSchema >, z.infer< typeof M52.PackageTranslationsSchema > >>;
export type Iso290 = Assert<Eq< z.input< typeof M52.CreatePackageRequestSchema >, z.infer< typeof M52.CreatePackageRequestSchema > >>;
export type Iso291 = Assert<Eq< z.input< typeof M52.UpdatePackageRequestSchema >, z.infer< typeof M52.UpdatePackageRequestSchema > >>;

// cloud/template-manifest.zod.ts
export type Iso292 = Assert<Eq< z.input< typeof M53.TemplateManifestSchema >, z.infer< typeof M53.TemplateManifestSchema > >>;

// cloud/tenant.zod.ts
export type Iso293 = Assert<Eq< z.input< typeof M54.TenantDatabaseStatusSchema >, z.infer< typeof M54.TenantDatabaseStatusSchema > >>;
export type Iso294 = Assert<Eq< z.input< typeof M54.TenantPlanSchema >, z.infer< typeof M54.TenantPlanSchema > >>;
export type Iso295 = Assert<Eq< z.input< typeof M54.PackageInstallationStatusSchema >, z.infer< typeof M54.PackageInstallationStatusSchema > >>;
export type Iso296 = Assert<Eq< z.input< typeof M54.TenantContextSchema >, z.infer< typeof M54.TenantContextSchema > >>;
export type Iso297 = Assert<Eq< z.input< typeof M54.TenantIdentificationSourceSchema >, z.infer< typeof M54.TenantIdentificationSourceSchema > >>;

// data/analytics.zod.ts
export type Iso298 = Assert<Eq< z.input< typeof M55.MetricSchema >, z.infer< typeof M55.MetricSchema > >>;
export type Iso299 = Assert<Eq< z.input< typeof M55.DimensionSchema >, z.infer< typeof M55.DimensionSchema > >>;
export type Iso300 = Assert<Eq< z.input< typeof M55.AnalyticsQuerySchema >, z.infer< typeof M55.AnalyticsQuerySchema > >>;

// data/data-engine.zod.ts
export type Iso301 = Assert<Eq< z.input< typeof M56.BaseEngineOptionsSchema >, z.infer< typeof M56.BaseEngineOptionsSchema > >>;
export type Iso302 = Assert<Eq< z.input< typeof M56.EngineUpdateOptionsSchema >, z.infer< typeof M56.EngineUpdateOptionsSchema > >>;
export type Iso303 = Assert<Eq< z.input< typeof M56.DroppedFieldsEventSchema >, z.infer< typeof M56.DroppedFieldsEventSchema > >>;
export type Iso304 = Assert<Eq< z.input< typeof M56.EngineDeleteOptionsSchema >, z.infer< typeof M56.EngineDeleteOptionsSchema > >>;
export type Iso305 = Assert<Eq< z.input< typeof M56.EngineAggregateOptionsSchema >, z.infer< typeof M56.EngineAggregateOptionsSchema > >>;
export type Iso306 = Assert<Eq< z.input< typeof M56.EngineCountOptionsSchema >, z.infer< typeof M56.EngineCountOptionsSchema > >>;
export type Iso307 = Assert<Eq< z.input< typeof M56.DataEngineFilterSchema >, z.infer< typeof M56.DataEngineFilterSchema > >>;
export type Iso308 = Assert<Eq< z.input< typeof M56.DataEngineInsertOptionsSchema >, z.infer< typeof M56.DataEngineInsertOptionsSchema > >>;
export type Iso309 = Assert<Eq< z.input< typeof M56.DataEngineUpdateOptionsSchema >, z.infer< typeof M56.DataEngineUpdateOptionsSchema > >>;
export type Iso310 = Assert<Eq< z.input< typeof M56.DataEngineDeleteOptionsSchema >, z.infer< typeof M56.DataEngineDeleteOptionsSchema > >>;
export type Iso311 = Assert<Eq< z.input< typeof M56.DataEngineAggregateOptionsSchema >, z.infer< typeof M56.DataEngineAggregateOptionsSchema > >>;
export type Iso312 = Assert<Eq< z.input< typeof M56.DataEngineCountOptionsSchema >, z.infer< typeof M56.DataEngineCountOptionsSchema > >>;

// data/datasource.zod.ts
export type Iso313 = Assert<Eq< z.input< typeof M57.DriverDefinitionSchema >, z.infer< typeof M57.DriverDefinitionSchema > >>;
export type Iso314 = Assert<Eq< z.input< typeof M57.SchemaModeSchema >, z.infer< typeof M57.SchemaModeSchema > >>;

// data/driver-nosql.zod.ts
export type Iso315 = Assert<Eq< z.input< typeof M58.NoSQLDatabaseTypeSchema >, z.infer< typeof M58.NoSQLDatabaseTypeSchema > >>;
export type Iso316 = Assert<Eq< z.input< typeof M58.NoSQLOperationTypeSchema >, z.infer< typeof M58.NoSQLOperationTypeSchema > >>;
export type Iso317 = Assert<Eq< z.input< typeof M58.ConsistencyLevelSchema >, z.infer< typeof M58.ConsistencyLevelSchema > >>;
export type Iso318 = Assert<Eq< z.input< typeof M58.NoSQLIndexTypeSchema >, z.infer< typeof M58.NoSQLIndexTypeSchema > >>;
export type Iso319 = Assert<Eq< z.input< typeof M58.NoSQLDataTypeMappingSchema >, z.infer< typeof M58.NoSQLDataTypeMappingSchema > >>;
export type Iso320 = Assert<Eq< z.input< typeof M58.NoSQLQueryOptionsSchema >, z.infer< typeof M58.NoSQLQueryOptionsSchema > >>;
export type Iso321 = Assert<Eq< z.input< typeof M58.AggregationStageSchema >, z.infer< typeof M58.AggregationStageSchema > >>;
export type Iso322 = Assert<Eq< z.input< typeof M58.AggregationPipelineSchema >, z.infer< typeof M58.AggregationPipelineSchema > >>;
export type Iso323 = Assert<Eq< z.input< typeof M58.NoSQLTransactionOptionsSchema >, z.infer< typeof M58.NoSQLTransactionOptionsSchema > >>;

// data/driver-sql.zod.ts
export type Iso324 = Assert<Eq< z.input< typeof M59.SQLDialectSchema >, z.infer< typeof M59.SQLDialectSchema > >>;
export type Iso325 = Assert<Eq< z.input< typeof M59.DataTypeMappingSchema >, z.infer< typeof M59.DataTypeMappingSchema > >>;

// data/driver.zod.ts
export type Iso326 = Assert<Eq< z.input< typeof M60.DriverOptionsSchema >, z.infer< typeof M60.DriverOptionsSchema > >>;
export type Iso327 = Assert<Eq< z.input< typeof M60.DriverCapabilitiesSchema >, z.infer< typeof M60.DriverCapabilitiesSchema > >>;

// data/driver/common.zod.ts
export type Iso328 = Assert<Eq< z.input< typeof M61.SqlAutoMigrateSchema >, z.infer< typeof M61.SqlAutoMigrateSchema > >>;

// data/driver/memory.zod.ts
export type Iso329 = Assert<Eq< z.input< typeof M62.PersistenceAdapterSchema >, z.infer< typeof M62.PersistenceAdapterSchema > >>;
export type Iso330 = Assert<Eq< z.input< typeof M62.PersistenceTypeSchema >, z.infer< typeof M62.PersistenceTypeSchema > >>;
export type Iso331 = Assert<Eq< z.input< typeof M62.LocalStoragePersistenceConfigSchema >, z.infer< typeof M62.LocalStoragePersistenceConfigSchema > >>;
export type Iso332 = Assert<Eq< z.input< typeof M62.CustomPersistenceConfigSchema >, z.infer< typeof M62.CustomPersistenceConfigSchema > >>;
export type Iso333 = Assert<Eq< z.input< typeof M62.AutoPersistenceConfigSchema >, z.infer< typeof M62.AutoPersistenceConfigSchema > >>;

// data/driver/sqlite.zod.ts
export type Iso334 = Assert<Eq< z.input< typeof M63.SqliteWasmPersistModeSchema >, z.infer< typeof M63.SqliteWasmPersistModeSchema > >>;

// data/driver/turso.zod.ts
export type Iso834 = Assert<Eq< z.input< typeof M181.TursoTransportModeSchema >, z.infer< typeof M181.TursoTransportModeSchema > >>;

// data/external-lookup.zod.ts — retired whole (#8075, ADR-0049); its pin left with it.

// data/feed.zod.ts
export type Iso336 = Assert<Eq< z.input< typeof M65.FeedItemType >, z.infer< typeof M65.FeedItemType > >>;
export type Iso337 = Assert<Eq< z.input< typeof M65.FeedFilterMode >, z.infer< typeof M65.FeedFilterMode > >>;

// data/field.zod.ts
export type Iso338 = Assert<Eq< z.input< typeof M66.FieldType >, z.infer< typeof M66.FieldType > >>;
export type Iso339 = Assert<Eq< z.input< typeof M66.LocationCoordinatesSchema >, z.infer< typeof M66.LocationCoordinatesSchema > >>;
export type Iso340 = Assert<Eq< z.input< typeof M66.AddressSchema >, z.infer< typeof M66.AddressSchema > >>;
export type Iso341 = Assert<Eq< z.input< typeof M66.CurrencyValueSchema >, z.infer< typeof M66.CurrencyValueSchema > >>;
// #8993 partial masking: keepHead/keepTail are plain optional-free ints — no
// transform, no defaults, so input === infer and the bare alias needs no Parsed.
export type Iso850 = Assert<Eq< z.input< typeof M66.FieldMaskingKeepSchema >, z.infer< typeof M66.FieldMaskingKeepSchema > >>;

// data/filter.zod.ts
export type Iso342 = Assert<Eq< z.input< typeof M67.FieldReferenceSchema >, z.infer< typeof M67.FieldReferenceSchema > >>;
export type Iso343 = Assert<Eq< z.input< typeof M67.FieldOperatorsSchema >, z.infer< typeof M67.FieldOperatorsSchema > >>;
export type Iso344 = Assert<Eq< z.input< typeof M67.QueryFilterSchema >, z.infer< typeof M67.QueryFilterSchema > >>;

// data/hook-body.zod.ts
export type Iso345 = Assert<Eq< z.input< typeof M68.HookBodyCapability >, z.infer< typeof M68.HookBodyCapability > >>;
export type Iso346 = Assert<Eq< z.input< typeof M68.ExpressionBodySchema >, z.infer< typeof M68.ExpressionBodySchema > >>;

// data/hook.zod.ts
export type Iso347 = Assert<Eq< z.input< typeof M69.HookEvent >, z.infer< typeof M69.HookEvent > >>;
export type Iso348 = Assert<Eq< z.input< typeof M69.HookContextSchema >, z.infer< typeof M69.HookContextSchema > >>;

// data/object.zod.ts
export type Iso349 = Assert<Eq< z.input< typeof M70.ApiMethod >, z.infer< typeof M70.ApiMethod > >>;
export type Iso350 = Assert<Eq< z.input< typeof M70.PerOperationRequiredPermissionsSchema >, z.infer< typeof M70.PerOperationRequiredPermissionsSchema > >>;
export type Iso351 = Assert<Eq< z.input< typeof M70.ObjectRequiredPermissionsSchema >, z.infer< typeof M70.ObjectRequiredPermissionsSchema > >>;
export type Iso352 = Assert<Eq< z.input< typeof M70.TenancyConfigSchema >, z.infer< typeof M70.TenancyConfigSchema > >>;
export type Iso353 = Assert<Eq< z.input< typeof M70.LifecycleClassSchema >, z.infer< typeof M70.LifecycleClassSchema > >>;
export type Iso354 = Assert<Eq< z.input< typeof M70.LifecycleSchema >, z.infer< typeof M70.LifecycleSchema > >>;
export type Iso355 = Assert<Eq< z.input< typeof M70.ObjectOwnershipEnum >, z.infer< typeof M70.ObjectOwnershipEnum > >>;

// data/query.zod.ts
export type Iso356 = Assert<Eq< z.input< typeof M71.AggregationNodeSchema >, z.infer< typeof M71.AggregationNodeSchema > >>;
export type Iso357 = Assert<Eq< z.input< typeof M71.GroupByNodeSchema >, z.infer< typeof M71.GroupByNodeSchema > >>;
export type Iso358 = Assert<Eq< z.input< typeof M71.DateGranularity >, z.infer< typeof M71.DateGranularity > >>;

// data/seed-loader.zod.ts
export type Iso359 = Assert<Eq< z.input< typeof M72.ReferenceResolutionErrorSchema >, z.infer< typeof M72.ReferenceResolutionErrorSchema > >>;
export type Iso360 = Assert<Eq< z.input< typeof M72.SeedIdentitySchema >, z.infer< typeof M72.SeedIdentitySchema > >>;

// data/seed.zod.ts
export type Iso361 = Assert<Eq< z.input< typeof M73.SeedMode >, z.infer< typeof M73.SeedMode > >>;

// data/validation.zod.ts
export type Iso362 = Assert<Eq< z.input< typeof M74.ValidationRuleSchema >, z.infer< typeof M74.ValidationRuleSchema > >>;

// identity/identity.zod.ts
export type Iso363 = Assert<Eq< z.input< typeof M75.AccountSchema >, z.infer< typeof M75.AccountSchema > >>;
export type Iso364 = Assert<Eq< z.input< typeof M75.VerificationTokenSchema >, z.infer< typeof M75.VerificationTokenSchema > >>;

// identity/organization.zod.ts
export type Iso365 = Assert<Eq< z.input< typeof M76.OrganizationSchema >, z.infer< typeof M76.OrganizationSchema > >>;
export type Iso366 = Assert<Eq< z.input< typeof M76.MemberSchema >, z.infer< typeof M76.MemberSchema > >>;
export type Iso367 = Assert<Eq< z.input< typeof M76.InvitationStatus >, z.infer< typeof M76.InvitationStatus > >>;

// identity/scim.zod.ts
export type Iso368 = Assert<Eq< z.input< typeof M77.SCIMMetaSchema >, z.infer< typeof M77.SCIMMetaSchema > >>;
export type Iso369 = Assert<Eq< z.input< typeof M77.SCIMNameSchema >, z.infer< typeof M77.SCIMNameSchema > >>;
export type Iso370 = Assert<Eq< z.input< typeof M77.SCIMGroupReferenceSchema >, z.infer< typeof M77.SCIMGroupReferenceSchema > >>;
export type Iso371 = Assert<Eq< z.input< typeof M77.SCIMEnterpriseUserSchema >, z.infer< typeof M77.SCIMEnterpriseUserSchema > >>;
export type Iso372 = Assert<Eq< z.input< typeof M77.SCIMMemberReferenceSchema >, z.infer< typeof M77.SCIMMemberReferenceSchema > >>;
export type Iso373 = Assert<Eq< z.input< typeof M77.SCIMPatchOperationSchema >, z.infer< typeof M77.SCIMPatchOperationSchema > >>;
export type Iso374 = Assert<Eq< z.input< typeof M77.SCIMBulkOperationSchema >, z.infer< typeof M77.SCIMBulkOperationSchema > >>;
export type Iso375 = Assert<Eq< z.input< typeof M77.SCIMBulkResponseOperationSchema >, z.infer< typeof M77.SCIMBulkResponseOperationSchema > >>;

// integration/connector.zod.ts
export type Iso376 = Assert<Eq< z.input< typeof M78.SyncStrategySchema >, z.infer< typeof M78.SyncStrategySchema > >>;
export type Iso377 = Assert<Eq< z.input< typeof M78.ConnectorConflictResolutionSchema >, z.infer< typeof M78.ConnectorConflictResolutionSchema > >>;
export type Iso378 = Assert<Eq< z.input< typeof M78.WebhookEventSchema >, z.infer< typeof M78.WebhookEventSchema > >>;
export type Iso379 = Assert<Eq< z.input< typeof M78.WebhookSignatureAlgorithmSchema >, z.infer< typeof M78.WebhookSignatureAlgorithmSchema > >>;
export type Iso380 = Assert<Eq< z.input< typeof M78.ConnectorRetryStrategySchema >, z.infer< typeof M78.ConnectorRetryStrategySchema > >>;
export type Iso381 = Assert<Eq< z.input< typeof M78.ConnectorErrorCategorySchema >, z.infer< typeof M78.ConnectorErrorCategorySchema > >>;
export type Iso382 = Assert<Eq< z.input< typeof M78.ErrorMappingRuleSchema >, z.infer< typeof M78.ErrorMappingRuleSchema > >>;
export type Iso383 = Assert<Eq< z.input< typeof M78.ConnectorTypeSchema >, z.infer< typeof M78.ConnectorTypeSchema > >>;
export type Iso384 = Assert<Eq< z.input< typeof M78.ConnectorStatusSchema >, z.infer< typeof M78.ConnectorStatusSchema > >>;
// [#4395] Added after the generated corpus, so its number continues from the
// file's end rather than from its neighbours — the `IsoNNN` label is only a
// unique name (the gate reads the `z.input< typeof Mn.XSchema >` occurrence,
// not the label), and renumbering 300+ following lines to close the gap would
// be a merge-conflict magnet for no reader benefit. Grouped with its siblings
// here because the FILE heading is what a reader navigates by.
// A bare `z.enum`, exactly like `ConnectorType` / `ConnectorStatus` two lines
// up: no default, no transform, so author and parsed states coincide and D5
// gives it no `XParsed`.
export type Iso718 = Assert<Eq< z.input< typeof M78.ConnectorActionEffectSchema >, z.infer< typeof M78.ConnectorActionEffectSchema > >>;

// kernel/cli-extension.zod.ts
export type Iso385 = Assert<Eq< z.input< typeof M79.CLICommandContributionSchema >, z.infer< typeof M79.CLICommandContributionSchema > >>;
export type Iso386 = Assert<Eq< z.input< typeof M79.OclifPluginConfigSchema >, z.infer< typeof M79.OclifPluginConfigSchema > >>;

// kernel/cluster.zod.ts
export type Iso387 = Assert<Eq< z.input< typeof M80.EventScopeSchema >, z.infer< typeof M80.EventScopeSchema > >>;
export type Iso388 = Assert<Eq< z.input< typeof M80.EventDeliverySemanticsSchema >, z.infer< typeof M80.EventDeliverySemanticsSchema > >>;
export type Iso389 = Assert<Eq< z.input< typeof M80.ServiceClusterScopeSchema >, z.infer< typeof M80.ServiceClusterScopeSchema > >>;
export type Iso390 = Assert<Eq< z.input< typeof M80.ServiceLeaderStrategySchema >, z.infer< typeof M80.ServiceLeaderStrategySchema > >>;
export type Iso391 = Assert<Eq< z.input< typeof M80.ClusterDriverSchema >, z.infer< typeof M80.ClusterDriverSchema > >>;
export type Iso392 = Assert<Eq< z.input< typeof M80.ClusterTenantIsolationSchema >, z.infer< typeof M80.ClusterTenantIsolationSchema > >>;
export type Iso393 = Assert<Eq< z.input< typeof M80.MetadataChangeOperationSchema >, z.infer< typeof M80.MetadataChangeOperationSchema > >>;
export type Iso394 = Assert<Eq< z.input< typeof M80.MetadataChangedEventPayloadSchema >, z.infer< typeof M80.MetadataChangedEventPayloadSchema > >>;

// kernel/context.zod.ts
export type Iso395 = Assert<Eq< z.input< typeof M81.RuntimeMode >, z.infer< typeof M81.RuntimeMode > >>;

// kernel/dependency-resolution.zod.ts
export type Iso396 = Assert<Eq< z.input< typeof M82.DependencyStatusEnum >, z.infer< typeof M82.DependencyStatusEnum > >>;
export type Iso397 = Assert<Eq< z.input< typeof M82.ResolvedDependencySchema >, z.infer< typeof M82.ResolvedDependencySchema > >>;
export type Iso398 = Assert<Eq< z.input< typeof M82.RequiredActionSchema >, z.infer< typeof M82.RequiredActionSchema > >>;
export type Iso399 = Assert<Eq< z.input< typeof M82.DependencyResolutionResultSchema >, z.infer< typeof M82.DependencyResolutionResultSchema > >>;

// kernel/events/core.zod.ts
export type Iso400 = Assert<Eq< z.input< typeof M83.EventPriority >, z.infer< typeof M83.EventPriority > >>;

// kernel/events/handlers.zod.ts
export type Iso401 = Assert<Eq< z.input< typeof M84.EventRouteSchema >, z.infer< typeof M84.EventRouteSchema > >>;

// kernel/manifest.zod.ts
export type Iso402 = Assert<Eq< z.input< typeof M85.PluginPermissionsSchema >, z.infer< typeof M85.PluginPermissionsSchema > >>;
export type Iso403 = Assert<Eq< z.input< typeof M85.ManifestPermissionsSchema >, z.infer< typeof M85.ManifestPermissionsSchema > >>;
export type Iso404 = Assert<Eq< z.input< typeof M85.PluginEnginesSchema >, z.infer< typeof M85.PluginEnginesSchema > >>;
export type Iso405 = Assert<Eq< z.input< typeof M85.PluginRuntimeSchema >, z.infer< typeof M85.PluginRuntimeSchema > >>;
export type Iso406 = Assert<Eq< z.input< typeof M85.PluginPackagingSchema >, z.infer< typeof M85.PluginPackagingSchema > >>;
export type Iso407 = Assert<Eq< z.input< typeof M85.PluginIntegritySchema >, z.infer< typeof M85.PluginIntegritySchema > >>;

// kernel/metadata-customization.zod.ts
export type Iso408 = Assert<Eq< z.input< typeof M86.CustomizationOriginSchema >, z.infer< typeof M86.CustomizationOriginSchema > >>;
export type Iso409 = Assert<Eq< z.input< typeof M86.FieldChangeSchema >, z.infer< typeof M86.FieldChangeSchema > >>;
export type Iso410 = Assert<Eq< z.input< typeof M86.MergeConflictSchema >, z.infer< typeof M86.MergeConflictSchema > >>;
export type Iso411 = Assert<Eq< z.input< typeof M86.MergeResultSchema >, z.infer< typeof M86.MergeResultSchema > >>;

// kernel/metadata-loader.zod.ts
export type Iso412 = Assert<Eq< z.input< typeof M87.MetadataFallbackStrategySchema >, z.infer< typeof M87.MetadataFallbackStrategySchema > >>;

// kernel/metadata-plugin.zod.ts
export type Iso413 = Assert<Eq< z.input< typeof M88.MetadataTypeSchema >, z.infer< typeof M88.MetadataTypeSchema > >>;
export type Iso414 = Assert<Eq< z.input< typeof M88.MetadataQueryResultSchema >, z.infer< typeof M88.MetadataQueryResultSchema > >>;
export type Iso415 = Assert<Eq< z.input< typeof M88.MetadataValidationResultSchema >, z.infer< typeof M88.MetadataValidationResultSchema > >>;
export type Iso416 = Assert<Eq< z.input< typeof M88.MetadataBulkResultSchema >, z.infer< typeof M88.MetadataBulkResultSchema > >>;
export type Iso417 = Assert<Eq< z.input< typeof M88.MetadataDependencySchema >, z.infer< typeof M88.MetadataDependencySchema > >>;

// kernel/metadata-protection.zod.ts
export type Iso418 = Assert<Eq< z.input< typeof M89.MetadataLockSchema >, z.infer< typeof M89.MetadataLockSchema > >>;
export type Iso419 = Assert<Eq< z.input< typeof M89.MetadataLockSourceSchema >, z.infer< typeof M89.MetadataLockSourceSchema > >>;
export type Iso420 = Assert<Eq< z.input< typeof M89.MetadataProvenanceSchema >, z.infer< typeof M89.MetadataProvenanceSchema > >>;

// kernel/package-artifact.zod.ts
export type Iso421 = Assert<Eq< z.input< typeof M90.MetadataCategoryEnum >, z.infer< typeof M90.MetadataCategoryEnum > >>;
export type Iso422 = Assert<Eq< z.input< typeof M90.ArtifactFileEntrySchema >, z.infer< typeof M90.ArtifactFileEntrySchema > >>;

// kernel/package-registry.zod.ts
export type Iso423 = Assert<Eq< z.input< typeof M91.PackageStatusEnum >, z.infer< typeof M91.PackageStatusEnum > >>;
export type Iso424 = Assert<Eq< z.input< typeof M91.NamespaceRegistryEntrySchema >, z.infer< typeof M91.NamespaceRegistryEntrySchema > >>;
export type Iso425 = Assert<Eq< z.input< typeof M91.NamespaceConflictErrorSchema >, z.infer< typeof M91.NamespaceConflictErrorSchema > >>;
export type Iso426 = Assert<Eq< z.input< typeof M91.ListPackagesRequestSchema >, z.infer< typeof M91.ListPackagesRequestSchema > >>;
export type Iso427 = Assert<Eq< z.input< typeof M91.GetPackageRequestSchema >, z.infer< typeof M91.GetPackageRequestSchema > >>;
export type Iso428 = Assert<Eq< z.input< typeof M91.UninstallPackageRequestSchema >, z.infer< typeof M91.UninstallPackageRequestSchema > >>;
export type Iso429 = Assert<Eq< z.input< typeof M91.UninstallPackageResponseSchema >, z.infer< typeof M91.UninstallPackageResponseSchema > >>;
export type Iso430 = Assert<Eq< z.input< typeof M91.EnablePackageRequestSchema >, z.infer< typeof M91.EnablePackageRequestSchema > >>;
export type Iso431 = Assert<Eq< z.input< typeof M91.DisablePackageRequestSchema >, z.infer< typeof M91.DisablePackageRequestSchema > >>;

// kernel/package-upgrade.zod.ts
export type Iso432 = Assert<Eq< z.input< typeof M92.MetadataChangeTypeSchema >, z.infer< typeof M92.MetadataChangeTypeSchema > >>;
export type Iso433 = Assert<Eq< z.input< typeof M92.UpgradeImpactLevelSchema >, z.infer< typeof M92.UpgradeImpactLevelSchema > >>;
export type Iso434 = Assert<Eq< z.input< typeof M92.UpgradePhaseSchema >, z.infer< typeof M92.UpgradePhaseSchema > >>;
export type Iso435 = Assert<Eq< z.input< typeof M92.RollbackPackageResponseSchema >, z.infer< typeof M92.RollbackPackageResponseSchema > >>;

// kernel/plugin-capability.zod.ts
export type Iso436 = Assert<Eq< z.input< typeof M93.CapabilityConformanceLevelSchema >, z.infer< typeof M93.CapabilityConformanceLevelSchema > >>;
export type Iso437 = Assert<Eq< z.input< typeof M93.ProtocolVersionSchema >, z.infer< typeof M93.ProtocolVersionSchema > >>;
export type Iso438 = Assert<Eq< z.input< typeof M93.ProtocolReferenceSchema >, z.infer< typeof M93.ProtocolReferenceSchema > >>;

// kernel/plugin-lifecycle-advanced.zod.ts
export type Iso439 = Assert<Eq< z.input< typeof M94.PluginHealthStatusSchema >, z.infer< typeof M94.PluginHealthStatusSchema > >>;
export type Iso440 = Assert<Eq< z.input< typeof M94.PluginHealthReportSchema >, z.infer< typeof M94.PluginHealthReportSchema > >>;

// kernel/plugin-loading.zod.ts
// (Iso441 pinned `PluginLoadingStrategySchema`, removed with the rest of the
// `manifest.loading` block in #4914 — ADR-0049 enforce-or-remove.)
export type Iso442 = Assert<Eq< z.input< typeof M95.PluginLoadingEventSchema >, z.infer< typeof M95.PluginLoadingEventSchema > >>;

// kernel/plugin-registry.zod.ts
export type Iso443 = Assert<Eq< z.input< typeof M96.PluginSearchFiltersSchema >, z.infer< typeof M96.PluginSearchFiltersSchema > >>;
export type Iso444 = Assert<Eq< z.input< typeof M96.PluginInstallConfigSchema >, z.infer< typeof M96.PluginInstallConfigSchema > >>;

// kernel/plugin-security-advanced.zod.ts
export type Iso445 = Assert<Eq< z.input< typeof M97.PermissionScopeSchema >, z.infer< typeof M97.PermissionScopeSchema > >>;
export type Iso446 = Assert<Eq< z.input< typeof M97.PermissionActionSchema >, z.infer< typeof M97.PermissionActionSchema > >>;
export type Iso447 = Assert<Eq< z.input< typeof M97.ResourceTypeSchema >, z.infer< typeof M97.ResourceTypeSchema > >>;
export type Iso448 = Assert<Eq< z.input< typeof M97.PluginTrustLevelSchema >, z.infer< typeof M97.PluginTrustLevelSchema > >>;

// kernel/plugin-security.zod.ts
export type Iso449 = Assert<Eq< z.input< typeof M98.VulnerabilitySeverity >, z.infer< typeof M98.VulnerabilitySeverity > >>;
export type Iso450 = Assert<Eq< z.input< typeof M98.PackageDependencyConflictSchema >, z.infer< typeof M98.PackageDependencyConflictSchema > >>;

// kernel/plugin-structure.zod.ts
export type Iso451 = Assert<Eq< z.input< typeof M99.OpsFilePathSchema >, z.infer< typeof M99.OpsFilePathSchema > >>;
export type Iso452 = Assert<Eq< z.input< typeof M99.OpsDomainModuleSchema >, z.infer< typeof M99.OpsDomainModuleSchema > >>;
export type Iso453 = Assert<Eq< z.input< typeof M99.OpsPluginStructureSchema >, z.infer< typeof M99.OpsPluginStructureSchema > >>;

// kernel/plugin-validator.zod.ts
export type Iso454 = Assert<Eq< z.input< typeof M100.ValidationErrorSchema >, z.infer< typeof M100.ValidationErrorSchema > >>;
export type Iso455 = Assert<Eq< z.input< typeof M100.ValidationWarningSchema >, z.infer< typeof M100.ValidationWarningSchema > >>;
export type Iso456 = Assert<Eq< z.input< typeof M100.ValidationResultSchema >, z.infer< typeof M100.ValidationResultSchema > >>;
export type Iso457 = Assert<Eq< z.input< typeof M100.PluginMetadataSchema >, z.infer< typeof M100.PluginMetadataSchema > >>;

// kernel/plugin-versioning.zod.ts
export type Iso458 = Assert<Eq< z.input< typeof M101.SemanticVersionSchema >, z.infer< typeof M101.SemanticVersionSchema > >>;
export type Iso459 = Assert<Eq< z.input< typeof M101.VersionConstraintSchema >, z.infer< typeof M101.VersionConstraintSchema > >>;
export type Iso460 = Assert<Eq< z.input< typeof M101.CompatibilityLevelSchema >, z.infer< typeof M101.CompatibilityLevelSchema > >>;
export type Iso461 = Assert<Eq< z.input< typeof M101.DeprecationNoticeSchema >, z.infer< typeof M101.DeprecationNoticeSchema > >>;

// kernel/plugin.zod.ts
export type Iso462 = Assert<Eq< z.input< typeof M102.PluginContextSchema >, z.infer< typeof M102.PluginContextSchema > >>;
export type Iso463 = Assert<Eq< z.input< typeof M102.PluginSchema >, z.infer< typeof M102.PluginSchema > >>;

// kernel/service-registry.zod.ts
export type Iso464 = Assert<Eq< z.input< typeof M103.ServiceScopeType >, z.infer< typeof M103.ServiceScopeType > >>;
export type Iso465 = Assert<Eq< z.input< typeof M103.ScopeConfigSchema >, z.infer< typeof M103.ScopeConfigSchema > >>;
export type Iso466 = Assert<Eq< z.input< typeof M103.ScopeInfoSchema >, z.infer< typeof M103.ScopeInfoSchema > >>;

// kernel/startup-orchestrator.zod.ts
export type Iso467 = Assert<Eq< z.input< typeof M104.HealthStatusSchema >, z.infer< typeof M104.HealthStatusSchema > >>;
export type Iso468 = Assert<Eq< z.input< typeof M104.PluginStartupResultSchema >, z.infer< typeof M104.PluginStartupResultSchema > >>;
export type Iso469 = Assert<Eq< z.input< typeof M104.StartupOrchestrationResultSchema >, z.infer< typeof M104.StartupOrchestrationResultSchema > >>;

// qa/testing.zod.ts
export type Iso470 = Assert<Eq< z.input< typeof M105.TestSuiteSchema >, z.infer< typeof M105.TestSuiteSchema > >>;
export type Iso471 = Assert<Eq< z.input< typeof M105.TestScenarioSchema >, z.infer< typeof M105.TestScenarioSchema > >>;
export type Iso472 = Assert<Eq< z.input< typeof M105.TestStepSchema >, z.infer< typeof M105.TestStepSchema > >>;
export type Iso473 = Assert<Eq< z.input< typeof M105.TestActionSchema >, z.infer< typeof M105.TestActionSchema > >>;
export type Iso474 = Assert<Eq< z.input< typeof M105.TestAssertionSchema >, z.infer< typeof M105.TestAssertionSchema > >>;

// security/explain.zod.ts
export type Iso475 = Assert<Eq< z.input< typeof M106.ExplainOperationSchema >, z.infer< typeof M106.ExplainOperationSchema > >>;
export type Iso476 = Assert<Eq< z.input< typeof M106.AuthzPostureSchema >, z.infer< typeof M106.AuthzPostureSchema > >>;
export type Iso477 = Assert<Eq< z.input< typeof M106.ExplainMatchedRuleSchema >, z.infer< typeof M106.ExplainMatchedRuleSchema > >>;
export type Iso478 = Assert<Eq< z.input< typeof M106.ExplainRequestSchema >, z.infer< typeof M106.ExplainRequestSchema > >>;
export type Iso479 = Assert<Eq< z.input< typeof M106.AccessMatrixEntrySchema >, z.infer< typeof M106.AccessMatrixEntrySchema > >>;

// security/permission.zod.ts
export type Iso480 = Assert<Eq< z.input< typeof M107.ObjectAccessScopeSchema >, z.infer< typeof M107.ObjectAccessScopeSchema > >>;
export type Iso481 = Assert<Eq< z.input< typeof M107.EffectiveObjectPermissionSchema >, z.infer< typeof M107.EffectiveObjectPermissionSchema > >>;

// security/rls.zod.ts
export type Iso482 = Assert<Eq< z.input< typeof M108.RLSOperation >, z.infer< typeof M108.RLSOperation > >>;
export type Iso483 = Assert<Eq< z.input< typeof M108.RLSUserContextSchema >, z.infer< typeof M108.RLSUserContextSchema > >>;
export type Iso484 = Assert<Eq< z.input< typeof M108.RLSEvaluationResultSchema >, z.infer< typeof M108.RLSEvaluationResultSchema > >>;

// shared/connector-auth.zod.ts
export type Iso485 = Assert<Eq< z.input< typeof M109.ConnectorInstanceAuthSchema >, z.infer< typeof M109.ConnectorInstanceAuthSchema > >>;

// shared/enums.zod.ts
export type Iso486 = Assert<Eq< z.input< typeof M110.SortDirectionEnum >, z.infer< typeof M110.SortDirectionEnum > >>;
export type Iso487 = Assert<Eq< z.input< typeof M110.SortItemSchema >, z.infer< typeof M110.SortItemSchema > >>;
export type Iso488 = Assert<Eq< z.input< typeof M110.MutationEventEnum >, z.infer< typeof M110.MutationEventEnum > >>;
export type Iso489 = Assert<Eq< z.input< typeof M110.IsolationLevelEnum >, z.infer< typeof M110.IsolationLevelEnum > >>;

// shared/expression.zod.ts
export type Iso490 = Assert<Eq< z.input< typeof M111.ExpressionDialect >, z.infer< typeof M111.ExpressionDialect > >>;
export type Iso491 = Assert<Eq< z.input< typeof M111.ExpressionMetaSchema >, z.infer< typeof M111.ExpressionMetaSchema > >>;
export type Iso492 = Assert<Eq< z.input< typeof M111.ExpressionSchema >, z.infer< typeof M111.ExpressionSchema > >>;
export type Iso493 = Assert<Eq< z.input< typeof M111.PredicateSchema >, z.infer< typeof M111.PredicateSchema > >>;

// shared/http.zod.ts
export type Iso494 = Assert<Eq< z.input< typeof M112.HttpMethod >, z.infer< typeof M112.HttpMethod > >>;
export type Iso495 = Assert<Eq< z.input< typeof M112.HttpMethodSubsetSchema >, z.infer< typeof M112.HttpMethodSubsetSchema > >>;
export type Iso496 = Assert<Eq< z.input< typeof M112.StaticMountSchema >, z.infer< typeof M112.StaticMountSchema > >>;

// shared/identifiers.zod.ts
export type Iso497 = Assert<Eq< z.input< typeof M113.SystemIdentifierSchema >, z.infer< typeof M113.SystemIdentifierSchema > >>;
export type Iso498 = Assert<Eq< z.input< typeof M113.SnakeCaseIdentifierSchema >, z.infer< typeof M113.SnakeCaseIdentifierSchema > >>;
export type Iso499 = Assert<Eq< z.input< typeof M113.EventNameSchema >, z.infer< typeof M113.EventNameSchema > >>;

// shared/mapping.zod.ts
// Graduated INTO the isomorphic set at protocol 17: #5552 retired `transform` and the
// whole `FieldMappingTransform` union, which is what used to give this schema two shapes.
export type Iso717 = Assert<Eq< z.input< typeof M169.FieldMappingSchema >, z.infer< typeof M169.FieldMappingSchema > >>;

// shared/metadata-types.zod.ts
export type Iso500 = Assert<Eq< z.input< typeof M114.MetadataFormatSchema >, z.infer< typeof M114.MetadataFormatSchema > >>;
export type Iso501 = Assert<Eq< z.input< typeof M114.BaseMetadataRecordSchema >, z.infer< typeof M114.BaseMetadataRecordSchema > >>;

// shared/protection.zod.ts
export type Iso502 = Assert<Eq< z.input< typeof M115.ProtectionSchema >, z.infer< typeof M115.ProtectionSchema > >>;

// stack.zod.ts
export type Iso503 = Assert<Eq< z.input< typeof M116.DatasourceMappingRuleSchema >, z.infer< typeof M116.DatasourceMappingRuleSchema > >>;
export type Iso504 = Assert<Eq< z.input< typeof M116.ConflictStrategySchema >, z.infer< typeof M116.ConflictStrategySchema > >>;

// studio/flow-builder.zod.ts
export type Iso505 = Assert<Eq< z.input< typeof M117.FlowNodeShapeSchema >, z.infer< typeof M117.FlowNodeShapeSchema > >>;
export type Iso506 = Assert<Eq< z.input< typeof M117.FlowCanvasEdgeStyleSchema >, z.infer< typeof M117.FlowCanvasEdgeStyleSchema > >>;
export type Iso507 = Assert<Eq< z.input< typeof M117.FlowLayoutAlgorithmSchema >, z.infer< typeof M117.FlowLayoutAlgorithmSchema > >>;
export type Iso508 = Assert<Eq< z.input< typeof M117.FlowLayoutDirectionSchema >, z.infer< typeof M117.FlowLayoutDirectionSchema > >>;

// studio/object-designer.zod.ts
export type Iso509 = Assert<Eq< z.input< typeof M118.ERLayoutAlgorithmSchema >, z.infer< typeof M118.ERLayoutAlgorithmSchema > >>;
export type Iso510 = Assert<Eq< z.input< typeof M118.ObjectListDisplayModeSchema >, z.infer< typeof M118.ObjectListDisplayModeSchema > >>;
export type Iso511 = Assert<Eq< z.input< typeof M118.ObjectSortFieldSchema >, z.infer< typeof M118.ObjectSortFieldSchema > >>;
export type Iso512 = Assert<Eq< z.input< typeof M118.ObjectDesignerDefaultViewSchema >, z.infer< typeof M118.ObjectDesignerDefaultViewSchema > >>;

// studio/plugin.zod.ts
export type Iso513 = Assert<Eq< z.input< typeof M119.ViewModeSchema >, z.infer< typeof M119.ViewModeSchema > >>;
export type Iso514 = Assert<Eq< z.input< typeof M119.ActionContributionLocationSchema >, z.infer< typeof M119.ActionContributionLocationSchema > >>;
export type Iso515 = Assert<Eq< z.input< typeof M119.MetadataIconContributionSchema >, z.infer< typeof M119.MetadataIconContributionSchema > >>;
export type Iso516 = Assert<Eq< z.input< typeof M119.CommandContributionSchema >, z.infer< typeof M119.CommandContributionSchema > >>;

// system/auth-config.zod.ts
export type Iso517 = Assert<Eq< z.input< typeof M120.OidcProviderConfigSchema >, z.infer< typeof M120.OidcProviderConfigSchema > >>;
export type Iso518 = Assert<Eq< z.input< typeof M120.OidcProvidersConfigSchema >, z.infer< typeof M120.OidcProvidersConfigSchema > >>;
export type Iso519 = Assert<Eq< z.input< typeof M120.AuthProviderConfigSchema >, z.infer< typeof M120.AuthProviderConfigSchema > >>;
export type Iso520 = Assert<Eq< z.input< typeof M120.EmailVerificationConfigSchema >, z.infer< typeof M120.EmailVerificationConfigSchema > >>;
export type Iso521 = Assert<Eq< z.input< typeof M120.AdvancedAuthConfigSchema >, z.infer< typeof M120.AdvancedAuthConfigSchema > >>;

// system/cache.zod.ts
export type Iso522 = Assert<Eq< z.input< typeof M121.CacheStrategySchema >, z.infer< typeof M121.CacheStrategySchema > >>;
export type Iso523 = Assert<Eq< z.input< typeof M121.CacheInvalidationSchema >, z.infer< typeof M121.CacheInvalidationSchema > >>;
export type Iso524 = Assert<Eq< z.input< typeof M121.CacheConsistencySchema >, z.infer< typeof M121.CacheConsistencySchema > >>;

// system/change-management.zod.ts
export type Iso525 = Assert<Eq< z.input< typeof M122.ChangeTypeSchema >, z.infer< typeof M122.ChangeTypeSchema > >>;
export type Iso526 = Assert<Eq< z.input< typeof M122.ChangeStatusSchema >, z.infer< typeof M122.ChangeStatusSchema > >>;
export type Iso527 = Assert<Eq< z.input< typeof M122.ChangePrioritySchema >, z.infer< typeof M122.ChangePrioritySchema > >>;
export type Iso528 = Assert<Eq< z.input< typeof M122.ChangeImpactSchema >, z.infer< typeof M122.ChangeImpactSchema > >>;
export type Iso529 = Assert<Eq< z.input< typeof M122.RollbackPlanSchema >, z.infer< typeof M122.RollbackPlanSchema > >>;

// system/collaboration.zod.ts
export type Iso530 = Assert<Eq< z.input< typeof M123.OTOperationType >, z.infer< typeof M123.OTOperationType > >>;
export type Iso531 = Assert<Eq< z.input< typeof M123.OTComponentSchema >, z.infer< typeof M123.OTComponentSchema > >>;
export type Iso532 = Assert<Eq< z.input< typeof M123.OTOperationSchema >, z.infer< typeof M123.OTOperationSchema > >>;
export type Iso533 = Assert<Eq< z.input< typeof M123.OTTransformResultSchema >, z.infer< typeof M123.OTTransformResultSchema > >>;
export type Iso534 = Assert<Eq< z.input< typeof M123.CRDTType >, z.infer< typeof M123.CRDTType > >>;
export type Iso535 = Assert<Eq< z.input< typeof M123.VectorClockSchema >, z.infer< typeof M123.VectorClockSchema > >>;
export type Iso536 = Assert<Eq< z.input< typeof M123.LWWRegisterSchema >, z.infer< typeof M123.LWWRegisterSchema > >>;
export type Iso537 = Assert<Eq< z.input< typeof M123.CounterOperationSchema >, z.infer< typeof M123.CounterOperationSchema > >>;
export type Iso538 = Assert<Eq< z.input< typeof M123.GCounterSchema >, z.infer< typeof M123.GCounterSchema > >>;
export type Iso539 = Assert<Eq< z.input< typeof M123.PNCounterSchema >, z.infer< typeof M123.PNCounterSchema > >>;
export type Iso540 = Assert<Eq< z.input< typeof M123.TextCRDTOperationSchema >, z.infer< typeof M123.TextCRDTOperationSchema > >>;
export type Iso541 = Assert<Eq< z.input< typeof M123.TextCRDTStateSchema >, z.infer< typeof M123.TextCRDTStateSchema > >>;
export type Iso542 = Assert<Eq< z.input< typeof M123.CursorColorPreset >, z.infer< typeof M123.CursorColorPreset > >>;
export type Iso543 = Assert<Eq< z.input< typeof M123.CursorSelectionSchema >, z.infer< typeof M123.CursorSelectionSchema > >>;
export type Iso544 = Assert<Eq< z.input< typeof M123.CursorUpdateSchema >, z.infer< typeof M123.CursorUpdateSchema > >>;
export type Iso545 = Assert<Eq< z.input< typeof M123.UserActivityStatus >, z.infer< typeof M123.UserActivityStatus > >>;
export type Iso546 = Assert<Eq< z.input< typeof M123.AwarenessUserStateSchema >, z.infer< typeof M123.AwarenessUserStateSchema > >>;
export type Iso547 = Assert<Eq< z.input< typeof M123.AwarenessSessionSchema >, z.infer< typeof M123.AwarenessSessionSchema > >>;
export type Iso548 = Assert<Eq< z.input< typeof M123.AwarenessUpdateSchema >, z.infer< typeof M123.AwarenessUpdateSchema > >>;
export type Iso549 = Assert<Eq< z.input< typeof M123.AwarenessEventSchema >, z.infer< typeof M123.AwarenessEventSchema > >>;
export type Iso550 = Assert<Eq< z.input< typeof M123.CollaborationMode >, z.infer< typeof M123.CollaborationMode > >>;

// system/core-services.zod.ts
export type Iso551 = Assert<Eq< z.input< typeof M124.CoreServiceName >, z.infer< typeof M124.CoreServiceName > >>;

// system/deploy-bundle.zod.ts
export type Iso552 = Assert<Eq< z.input< typeof M125.DeployStatusEnum >, z.infer< typeof M125.DeployStatusEnum > >>;
export type Iso553 = Assert<Eq< z.input< typeof M125.SchemaChangeSchema >, z.infer< typeof M125.SchemaChangeSchema > >>;
export type Iso554 = Assert<Eq< z.input< typeof M125.DeployValidationIssueSchema >, z.infer< typeof M125.DeployValidationIssueSchema > >>;

// system/disaster-recovery.zod.ts
export type Iso555 = Assert<Eq< z.input< typeof M126.BackupStrategySchema >, z.infer< typeof M126.BackupStrategySchema > >>;
export type Iso556 = Assert<Eq< z.input< typeof M126.FailoverModeSchema >, z.infer< typeof M126.FailoverModeSchema > >>;

// system/doc.zod.ts
export type Iso557 = Assert<Eq< z.input< typeof M127.DocSchema >, z.infer< typeof M127.DocSchema > >>;

// system/email-config.zod.ts
export type Iso558 = Assert<Eq< z.input< typeof M128.EmailProviderSchema >, z.infer< typeof M128.EmailProviderSchema > >>;
export type Iso559 = Assert<Eq< z.input< typeof M128.EmailAddressConfigSchema >, z.infer< typeof M128.EmailAddressConfigSchema > >>;

// system/email-template.zod.ts
export type Iso560 = Assert<Eq< z.input< typeof M129.EmailTemplateDefinitionCategorySchema >, z.infer< typeof M129.EmailTemplateDefinitionCategorySchema > >>;

// system/encryption.zod.ts
export type Iso561 = Assert<Eq< z.input< typeof M130.EncryptionAlgorithmSchema >, z.infer< typeof M130.EncryptionAlgorithmSchema > >>;
export type Iso562 = Assert<Eq< z.input< typeof M130.KeyManagementProviderSchema >, z.infer< typeof M130.KeyManagementProviderSchema > >>;

// system/environment-artifact.zod.ts
export type Iso563 = Assert<Eq< z.input< typeof M131.Sha256DigestSchema >, z.infer< typeof M131.Sha256DigestSchema > >>;

// system/http-server.zod.ts
export type Iso564 = Assert<Eq< z.input< typeof M132.MiddlewareType >, z.infer< typeof M132.MiddlewareType > >>;

// system/incident-response.zod.ts
export type Iso568 = Assert<Eq< z.input< typeof M133.IncidentResponsePhaseSchema >, z.infer< typeof M133.IncidentResponsePhaseSchema > >>;
export type Iso569 = Assert<Eq< z.input< typeof M133.IncidentSeveritySchema >, z.infer< typeof M133.IncidentSeveritySchema > >>;
export type Iso570 = Assert<Eq< z.input< typeof M133.IncidentCategorySchema >, z.infer< typeof M133.IncidentCategorySchema > >>;
export type Iso571 = Assert<Eq< z.input< typeof M133.IncidentStatusSchema >, z.infer< typeof M133.IncidentStatusSchema > >>;
export type Iso572 = Assert<Eq< z.input< typeof M133.IncidentSchema >, z.infer< typeof M133.IncidentSchema > >>;

// system/job.zod.ts
export type Iso573 = Assert<Eq< z.input< typeof M134.IntervalScheduleSchema >, z.infer< typeof M134.IntervalScheduleSchema > >>;
export type Iso574 = Assert<Eq< z.input< typeof M134.OnceScheduleSchema >, z.infer< typeof M134.OnceScheduleSchema > >>;
export type Iso575 = Assert<Eq< z.input< typeof M134.JobExecutionStatus >, z.infer< typeof M134.JobExecutionStatus > >>;
export type Iso576 = Assert<Eq< z.input< typeof M134.JobExecutionSchema >, z.infer< typeof M134.JobExecutionSchema > >>;

// system/license.zod.ts
export type Iso577 = Assert<Eq< z.input< typeof M135.LicenseMetricType >, z.infer< typeof M135.LicenseMetricType > >>;
export type Iso578 = Assert<Eq< z.input< typeof M135.LicenseSchema >, z.infer< typeof M135.LicenseSchema > >>;

// system/logging.zod.ts
export type Iso579 = Assert<Eq< z.input< typeof M136.LogLevel >, z.infer< typeof M136.LogLevel > >>;
export type Iso580 = Assert<Eq< z.input< typeof M136.LogFormat >, z.infer< typeof M136.LogFormat > >>;
export type Iso581 = Assert<Eq< z.input< typeof M136.LogEntrySchema >, z.infer< typeof M136.LogEntrySchema > >>;
export type Iso582 = Assert<Eq< z.input< typeof M136.ExtendedLogLevel >, z.infer< typeof M136.ExtendedLogLevel > >>;
export type Iso583 = Assert<Eq< z.input< typeof M136.LogDestinationType >, z.infer< typeof M136.LogDestinationType > >>;
export type Iso584 = Assert<Eq< z.input< typeof M136.ExternalServiceDestinationConfigSchema >, z.infer< typeof M136.ExternalServiceDestinationConfigSchema > >>;
export type Iso585 = Assert<Eq< z.input< typeof M136.StructuredLogEntrySchema >, z.infer< typeof M136.StructuredLogEntrySchema > >>;

// system/message-queue.zod.ts — retired whole (#8075, ADR-0049); its pin left with it.

// system/metadata-persistence.zod.ts
export type Iso587 = Assert<Eq< z.input< typeof M138.MetadataScopeSchema >, z.infer< typeof M138.MetadataScopeSchema > >>;
export type Iso588 = Assert<Eq< z.input< typeof M138.PackagePublishResultSchema >, z.infer< typeof M138.PackagePublishResultSchema > >>;
export type Iso589 = Assert<Eq< z.input< typeof M138.MetadataStatsSchema >, z.infer< typeof M138.MetadataStatsSchema > >>;
export type Iso590 = Assert<Eq< z.input< typeof M138.MetadataLoadOptionsSchema >, z.infer< typeof M138.MetadataLoadOptionsSchema > >>;
export type Iso591 = Assert<Eq< z.input< typeof M138.MetadataLoadResultSchema >, z.infer< typeof M138.MetadataLoadResultSchema > >>;
export type Iso592 = Assert<Eq< z.input< typeof M138.MetadataSaveResultSchema >, z.infer< typeof M138.MetadataSaveResultSchema > >>;
export type Iso593 = Assert<Eq< z.input< typeof M138.MetadataWatchEventSchema >, z.infer< typeof M138.MetadataWatchEventSchema > >>;
export type Iso594 = Assert<Eq< z.input< typeof M138.MetadataCollectionInfoSchema >, z.infer< typeof M138.MetadataCollectionInfoSchema > >>;
export type Iso595 = Assert<Eq< z.input< typeof M138.MetadataSourceSchema >, z.infer< typeof M138.MetadataSourceSchema > >>;
export type Iso596 = Assert<Eq< z.input< typeof M138.MetadataHistoryRecordSchema >, z.infer< typeof M138.MetadataHistoryRecordSchema > >>;
export type Iso597 = Assert<Eq< z.input< typeof M138.MetadataHistoryQueryResultSchema >, z.infer< typeof M138.MetadataHistoryQueryResultSchema > >>;
export type Iso598 = Assert<Eq< z.input< typeof M138.MetadataDiffResultSchema >, z.infer< typeof M138.MetadataDiffResultSchema > >>;

// system/metrics.zod.ts
export type Iso599 = Assert<Eq< z.input< typeof M139.MetricType >, z.infer< typeof M139.MetricType > >>;
export type Iso600 = Assert<Eq< z.input< typeof M139.MetricUnit >, z.infer< typeof M139.MetricUnit > >>;
export type Iso601 = Assert<Eq< z.input< typeof M139.MetricAggregationType >, z.infer< typeof M139.MetricAggregationType > >>;
export type Iso602 = Assert<Eq< z.input< typeof M139.HistogramBucketConfigSchema >, z.infer< typeof M139.HistogramBucketConfigSchema > >>;
export type Iso603 = Assert<Eq< z.input< typeof M139.MetricLabelsSchema >, z.infer< typeof M139.MetricLabelsSchema > >>;
export type Iso604 = Assert<Eq< z.input< typeof M139.MetricDataPointSchema >, z.infer< typeof M139.MetricDataPointSchema > >>;
export type Iso605 = Assert<Eq< z.input< typeof M139.TimeSeriesDataPointSchema >, z.infer< typeof M139.TimeSeriesDataPointSchema > >>;
export type Iso606 = Assert<Eq< z.input< typeof M139.TimeSeriesSchema >, z.infer< typeof M139.TimeSeriesSchema > >>;

// system/migration.zod.ts
export type Iso607 = Assert<Eq< z.input< typeof M140.DataMigrationFlagSchema >, z.infer< typeof M140.DataMigrationFlagSchema > >>;
export type Iso608 = Assert<Eq< z.input< typeof M140.MigrationJournalEventSchema >, z.infer< typeof M140.MigrationJournalEventSchema > >>;

// system/notification.zod.ts
export type Iso609 = Assert<Eq< z.input< typeof M141.NotificationChannelSchema >, z.infer< typeof M141.NotificationChannelSchema > >>;

// system/object-storage.zod.ts
export type Iso610 = Assert<Eq< z.input< typeof M142.StorageScopeSchema >, z.infer< typeof M142.StorageScopeSchema > >>;
export type Iso611 = Assert<Eq< z.input< typeof M142.FileMetadataSchema >, z.infer< typeof M142.FileMetadataSchema > >>;
export type Iso612 = Assert<Eq< z.input< typeof M142.StorageProviderSchema >, z.infer< typeof M142.StorageProviderSchema > >>;
export type Iso613 = Assert<Eq< z.input< typeof M142.StorageAclSchema >, z.infer< typeof M142.StorageAclSchema > >>;
export type Iso614 = Assert<Eq< z.input< typeof M142.StorageClassSchema >, z.infer< typeof M142.StorageClassSchema > >>;
export type Iso615 = Assert<Eq< z.input< typeof M142.LifecycleActionSchema >, z.infer< typeof M142.LifecycleActionSchema > >>;
export type Iso616 = Assert<Eq< z.input< typeof M142.ObjectMetadataSchema >, z.infer< typeof M142.ObjectMetadataSchema > >>;
export type Iso617 = Assert<Eq< z.input< typeof M142.PresignedUrlConfigSchema >, z.infer< typeof M142.PresignedUrlConfigSchema > >>;

// system/registry-config.zod.ts
export type Iso618 = Assert<Eq< z.input< typeof M143.RegistrySyncPolicySchema >, z.infer< typeof M143.RegistrySyncPolicySchema > >>;

// system/search-engine.zod.ts
export type Iso619 = Assert<Eq< z.input< typeof M144.SearchProviderSchema >, z.infer< typeof M144.SearchProviderSchema > >>;
export type Iso620 = Assert<Eq< z.input< typeof M144.AnalyzerConfigSchema >, z.infer< typeof M144.AnalyzerConfigSchema > >>;

// system/security-context.zod.ts
export type Iso621 = Assert<Eq< z.input< typeof M145.DataClassificationSchema >, z.infer< typeof M145.DataClassificationSchema > >>;
export type Iso622 = Assert<Eq< z.input< typeof M145.ComplianceFrameworkSchema >, z.infer< typeof M145.ComplianceFrameworkSchema > >>;

// system/settings-client.zod.ts
export type Iso623 = Assert<Eq< z.input< typeof M146.SettingsChangeEventSchema >, z.infer< typeof M146.SettingsChangeEventSchema > >>;

// system/settings-manifest.zod.ts
export type Iso624 = Assert<Eq< z.input< typeof M147.SpecifierType >, z.infer< typeof M147.SpecifierType > >>;
export type Iso625 = Assert<Eq< z.input< typeof M147.SpecifierOptionSchema >, z.infer< typeof M147.SpecifierOptionSchema > >>;
export type Iso626 = Assert<Eq< z.input< typeof M147.SpecifierScopeSchema >, z.infer< typeof M147.SpecifierScopeSchema > >>;
export type Iso627 = Assert<Eq< z.input< typeof M147.SettingsActionResultSchema >, z.infer< typeof M147.SettingsActionResultSchema > >>;
export type Iso758 = Assert<Eq< z.input< typeof M147.SpecifierValueDomainSchema >, z.infer< typeof M147.SpecifierValueDomainSchema > >>;

// system/supplier-security.zod.ts
export type Iso628 = Assert<Eq< z.input< typeof M148.SupplierRiskLevelSchema >, z.infer< typeof M148.SupplierRiskLevelSchema > >>;
export type Iso629 = Assert<Eq< z.input< typeof M148.SupplierAssessmentStatusSchema >, z.infer< typeof M148.SupplierAssessmentStatusSchema > >>;

// system/tenant.zod.ts
export type Iso630 = Assert<Eq< z.input< typeof M149.TenantIsolationLevel >, z.infer< typeof M149.TenantIsolationLevel > >>;
export type Iso631 = Assert<Eq< z.input< typeof M149.DatabaseProviderSchema >, z.infer< typeof M149.DatabaseProviderSchema > >>;
export type Iso632 = Assert<Eq< z.input< typeof M149.TenantConnectionConfigSchema >, z.infer< typeof M149.TenantConnectionConfigSchema > >>;
export type Iso633 = Assert<Eq< z.input< typeof M149.TenantQuotaSchema >, z.infer< typeof M149.TenantQuotaSchema > >>;
export type Iso634 = Assert<Eq< z.input< typeof M149.QuotaEnforcementResultSchema >, z.infer< typeof M149.QuotaEnforcementResultSchema > >>;
export type Iso635 = Assert<Eq< z.input< typeof M149.TenantSchema >, z.infer< typeof M149.TenantSchema > >>;

// system/tracing.zod.ts
export type Iso636 = Assert<Eq< z.input< typeof M150.TraceStateSchema >, z.infer< typeof M150.TraceStateSchema > >>;
export type Iso637 = Assert<Eq< z.input< typeof M150.TraceFlagsSchema >, z.infer< typeof M150.TraceFlagsSchema > >>;
export type Iso638 = Assert<Eq< z.input< typeof M150.SpanKind >, z.infer< typeof M150.SpanKind > >>;
export type Iso639 = Assert<Eq< z.input< typeof M150.SpanStatus >, z.infer< typeof M150.SpanStatus > >>;
export type Iso640 = Assert<Eq< z.input< typeof M150.SpanAttributeValueSchema >, z.infer< typeof M150.SpanAttributeValueSchema > >>;
export type Iso641 = Assert<Eq< z.input< typeof M150.SpanAttributesSchema >, z.infer< typeof M150.SpanAttributesSchema > >>;
export type Iso642 = Assert<Eq< z.input< typeof M150.SpanEventSchema >, z.infer< typeof M150.SpanEventSchema > >>;
export type Iso643 = Assert<Eq< z.input< typeof M150.SamplingDecision >, z.infer< typeof M150.SamplingDecision > >>;
export type Iso644 = Assert<Eq< z.input< typeof M150.SamplingStrategyType >, z.infer< typeof M150.SamplingStrategyType > >>;
export type Iso645 = Assert<Eq< z.input< typeof M150.TracePropagationFormat >, z.infer< typeof M150.TracePropagationFormat > >>;
export type Iso646 = Assert<Eq< z.input< typeof M150.OtelExporterType >, z.infer< typeof M150.OtelExporterType > >>;

// system/training.zod.ts
export type Iso647 = Assert<Eq< z.input< typeof M151.TrainingCategorySchema >, z.infer< typeof M151.TrainingCategorySchema > >>;
export type Iso648 = Assert<Eq< z.input< typeof M151.TrainingCompletionStatusSchema >, z.infer< typeof M151.TrainingCompletionStatusSchema > >>;
export type Iso649 = Assert<Eq< z.input< typeof M151.TrainingRecordSchema >, z.infer< typeof M151.TrainingRecordSchema > >>;

// system/translation.zod.ts
export type Iso650 = Assert<Eq< z.input< typeof M152.FieldTranslationSchema >, z.infer< typeof M152.FieldTranslationSchema > >>;
export type Iso651 = Assert<Eq< z.input< typeof M152.ActionResultDialogTranslationSchema >, z.infer< typeof M152.ActionResultDialogTranslationSchema > >>;
export type Iso652 = Assert<Eq< z.input< typeof M152.ObjectTranslationDataSchema >, z.infer< typeof M152.ObjectTranslationDataSchema > >>;
export type Iso653 = Assert<Eq< z.input< typeof M152.TranslationDataSchema >, z.infer< typeof M152.TranslationDataSchema > >>;
export type Iso654 = Assert<Eq< z.input< typeof M152.TranslationBundleSchema >, z.infer< typeof M152.TranslationBundleSchema > >>;
export type Iso655 = Assert<Eq< z.input< typeof M152.TranslationConfigSchema >, z.infer< typeof M152.TranslationConfigSchema > >>;
export type Iso656 = Assert<Eq< z.input< typeof M152.TranslationItemSchema >, z.infer< typeof M152.TranslationItemSchema > >>;
export type Iso657 = Assert<Eq< z.input< typeof M152.TranslationDiffStatusSchema >, z.infer< typeof M152.TranslationDiffStatusSchema > >>;
export type Iso658 = Assert<Eq< z.input< typeof M152.TranslationDiffItemSchema >, z.infer< typeof M152.TranslationDiffItemSchema > >>;
export type Iso659 = Assert<Eq< z.input< typeof M152.CoverageBreakdownEntrySchema >, z.infer< typeof M152.CoverageBreakdownEntrySchema > >>;
export type Iso660 = Assert<Eq< z.input< typeof M152.TranslationCoverageResultSchema >, z.infer< typeof M152.TranslationCoverageResultSchema > >>;

// system/worker.zod.ts
export type Iso661 = Assert<Eq< z.input< typeof M153.TaskPriority >, z.infer< typeof M153.TaskPriority > >>;
export type Iso662 = Assert<Eq< z.input< typeof M153.TaskStatus >, z.infer< typeof M153.TaskStatus > >>;
export type Iso663 = Assert<Eq< z.input< typeof M153.TaskExecutionResultSchema >, z.infer< typeof M153.TaskExecutionResultSchema > >>;
export type Iso664 = Assert<Eq< z.input< typeof M153.WorkerStatsSchema >, z.infer< typeof M153.WorkerStatsSchema > >>;

// ui/action-params.zod.ts
export type Iso665 = Assert<Eq< z.input< typeof M154.ActionSessionSchema >, z.infer< typeof M154.ActionSessionSchema > >>;

// ui/action.zod.ts
export type Iso666 = Assert<Eq< z.input< typeof M155.ActionLocationSchema >, z.infer< typeof M155.ActionLocationSchema > >>;

// ui/app.zod.ts
export type Iso667 = Assert<Eq< z.input< typeof M156.AppBrandingSchema >, z.infer< typeof M156.AppBrandingSchema > >>;

// ui/bulk-action.zod.ts
export type Iso668 = Assert<Eq< z.input< typeof M157.BulkActionOperationSchema >, z.infer< typeof M157.BulkActionOperationSchema > >>;
export type Iso669 = Assert<Eq< z.input< typeof M157.BulkActionExecutionSchema >, z.infer< typeof M157.BulkActionExecutionSchema > >>;
export type Iso670 = Assert<Eq< z.input< typeof M157.BulkActionParamSchema >, z.infer< typeof M157.BulkActionParamSchema > >>;

// ui/chart.zod.ts
export type Iso671 = Assert<Eq< z.input< typeof M158.ChartTypeSchema >, z.infer< typeof M158.ChartTypeSchema > >>;
export type Iso672 = Assert<Eq< z.input< typeof M158.ChartAggregateSchema >, z.infer< typeof M158.ChartAggregateSchema > >>;
export type Iso673 = Assert<Eq< z.input< typeof M158.ChartAggregateFunctionSchema >, z.infer< typeof M158.ChartAggregateFunctionSchema > >>;
export type Iso674 = Assert<Eq< z.input< typeof M158.ChartGroupBySchema >, z.infer< typeof M158.ChartGroupBySchema > >>;
export type Iso675 = Assert<Eq< z.input< typeof M158.ChartDrillDownSchema >, z.infer< typeof M158.ChartDrillDownSchema > >>;

// ui/dashboard.zod.ts
export type Iso676 = Assert<Eq< z.input< typeof M159.DashboardWidgetOptionsSchema >, z.infer< typeof M159.DashboardWidgetOptionsSchema > >>;
export type Iso677 = Assert<Eq< z.input< typeof M159.DashboardHeaderActionSchema >, z.infer< typeof M159.DashboardHeaderActionSchema > >>;
export type Iso678 = Assert<Eq< z.input< typeof M159.WidgetColorVariantSchema >, z.infer< typeof M159.WidgetColorVariantSchema > >>;
export type Iso679 = Assert<Eq< z.input< typeof M159.WidgetActionTypeSchema >, z.infer< typeof M159.WidgetActionTypeSchema > >>;
export type Iso680 = Assert<Eq< z.input< typeof M159.GlobalFilterOptionsFromSchema >, z.infer< typeof M159.GlobalFilterOptionsFromSchema > >>;

// ui/dataset.zod.ts
export type Iso681 = Assert<Eq< z.input< typeof M160.DatasetDimensionSchema >, z.infer< typeof M160.DatasetDimensionSchema > >>;
export type Iso682 = Assert<Eq< z.input< typeof M160.DatasetMeasureSchema >, z.infer< typeof M160.DatasetMeasureSchema > >>;
export type Iso683 = Assert<Eq< z.input< typeof M160.DerivedMeasureOp >, z.infer< typeof M160.DerivedMeasureOp > >>;
export type Iso684 = Assert<Eq< z.input< typeof M160.DatasetSchema >, z.infer< typeof M160.DatasetSchema > >>;

// ui/i18n.zod.ts
export type Iso686 = Assert<Eq< z.input< typeof M161.I18nLabelSchema >, z.infer< typeof M161.I18nLabelSchema > >>;
export type Iso687 = Assert<Eq< z.input< typeof M161.AriaPropsSchema >, z.infer< typeof M161.AriaPropsSchema > >>;
// `InlineLocaleMapSchema` carried an isomorphism pin here (`Iso759`, #5728)
// while its alias was a bare `z.input<…>` derivation. #9925 hand-tied the
// alias (`Record<string, string> & { key?: never; defaultValue?: never }`,
// carried by an explicit `z.ZodType<…>` annotation that spells that same
// shape STRUCTURALLY rather than naming the alias — naming it made every
// emitted embed carry an unaddressable alias reference, TS2883 in
// metadata-core), so no bare alias relies on the exemption any more and the
// ADR-0122 gate itself ordered the pin line deleted as no longer load-bearing.
// Input and output remain identical by construction — both halves of the
// annotation spell the same type.

// ui/notification.zod.ts
export type Iso690 = Assert<Eq< z.input< typeof M162.NotificationTypeSchema >, z.infer< typeof M162.NotificationTypeSchema > >>;
export type Iso691 = Assert<Eq< z.input< typeof M162.NotificationSeveritySchema >, z.infer< typeof M162.NotificationSeveritySchema > >>;
export type Iso692 = Assert<Eq< z.input< typeof M162.NotificationPositionSchema >, z.infer< typeof M162.NotificationPositionSchema > >>;

// ui/page.zod.ts
export type Iso693 = Assert<Eq< z.input< typeof M163.PageTypeSchema >, z.infer< typeof M163.PageTypeSchema > >>;
export type Iso694 = Assert<Eq< z.input< typeof M163.ElementDataSourceSchema >, z.infer< typeof M163.ElementDataSourceSchema > >>;

// ui/report.zod.ts
export type Iso695 = Assert<Eq< z.input< typeof M164.JoinedReportBlockSchema >, z.infer< typeof M164.JoinedReportBlockSchema > >>;

// ui/responsive.zod.ts
export type Iso696 = Assert<Eq< z.input< typeof M165.BreakpointName >, z.infer< typeof M165.BreakpointName > >>;
export type Iso697 = Assert<Eq< z.input< typeof M165.ResponsiveConfigSchema >, z.infer< typeof M165.ResponsiveConfigSchema > >>;
export type Iso698 = Assert<Eq< z.input< typeof M165.StyleMapSchema >, z.infer< typeof M165.StyleMapSchema > >>;
export type Iso699 = Assert<Eq< z.input< typeof M165.ResponsiveStylesSchema >, z.infer< typeof M165.ResponsiveStylesSchema > >>;

// ui/theme.zod.ts
export type Iso700 = Assert<Eq< z.input< typeof M166.ColorPaletteSchema >, z.infer< typeof M166.ColorPaletteSchema > >>;
export type Iso701 = Assert<Eq< z.input< typeof M166.TypographySchema >, z.infer< typeof M166.TypographySchema > >>;
export type Iso702 = Assert<Eq< z.input< typeof M166.BorderRadiusSchema >, z.infer< typeof M166.BorderRadiusSchema > >>;
export type Iso703 = Assert<Eq< z.input< typeof M166.ShadowSchema >, z.infer< typeof M166.ShadowSchema > >>;
export type Iso704 = Assert<Eq< z.input< typeof M166.ThemeModeSchema >, z.infer< typeof M166.ThemeModeSchema > >>;

// ui/view.zod.ts
export type Iso705 = Assert<Eq< z.input< typeof M167.FormButtonConfigSchema >, z.infer< typeof M167.FormButtonConfigSchema > >>;
export type Iso706 = Assert<Eq< z.input< typeof M167.ViewItemSchema >, z.infer< typeof M167.ViewItemSchema > >>;
export type Iso707 = Assert<Eq< z.input< typeof M167.ViewItemWireSchema >, z.infer< typeof M167.ViewItemWireSchema > >>;
export type Iso708 = Assert<Eq< z.input< typeof M167.ViewScopeSchema >, z.infer< typeof M167.ViewScopeSchema > >>;
export type Iso709 = Assert<Eq< z.input< typeof M167.ViewKindSchema >, z.infer< typeof M167.ViewKindSchema > >>;
export type Iso710 = Assert<Eq< z.input< typeof M167.ColumnSummarySchema >, z.infer< typeof M167.ColumnSummarySchema > >>;
export type Iso711 = Assert<Eq< z.input< typeof M167.ColumnSummaryConfigSchema >, z.infer< typeof M167.ColumnSummaryConfigSchema > >>;
export type Iso712 = Assert<Eq< z.input< typeof M167.RowHeightSchema >, z.infer< typeof M167.RowHeightSchema > >>;
export type Iso713 = Assert<Eq< z.input< typeof M167.RowColorConfigSchema >, z.infer< typeof M167.RowColorConfigSchema > >>;
export type Iso714 = Assert<Eq< z.input< typeof M167.VisualizationTypeSchema >, z.infer< typeof M167.VisualizationTypeSchema > >>;
export type Iso715 = Assert<Eq< z.input< typeof M167.UserFilterFieldSchema >, z.infer< typeof M167.UserFilterFieldSchema > >>;

// ui/component.zod.ts
// #5775 — the shared `children` contract for `page:section`/`page:footer`/
// `page:sidebar`. A lone optional array with no default, transform, catch or
// pipe anywhere in its tree, so the two shapes coincide and the phase-2 flip of
// the bare name changes nothing. `check:spec-parsed-alias` sent it here rather
// than to a `PageContainerPropsParsed`, which would be a permanent synonym.
export type Iso719 = Assert<Eq< z.input< typeof M170.PageContainerProps >, z.infer< typeof M170.PageContainerProps > >>;

// ---------------------------------------------------------------------------
// Phase 2 (#6083) additions. These 35 schemas were never in phase 1's
// population: their bare alias already read `z.input` before the flip, so the
// phase-1 gate — which only looked at bare `z.infer` aliases — never asked
// whether their parsed state was named. The inverted gate does ask, and the
// same probe that chose phase 1's split (with the same deliberate control
// assertion, so a vacuous pass could not be mistaken for isomorphism) says
// these 35 coincide. The other 22 it found got an `XParsed` instead.
// ---------------------------------------------------------------------------

// api/protocol.zod.ts
export type Iso720 = Assert<Eq< z.input< typeof M28.GetDataRequestSchema >, z.infer< typeof M28.GetDataRequestSchema > >>;
export type Iso721 = Assert<Eq< z.input< typeof M28.CreateDataRequestSchema >, z.infer< typeof M28.CreateDataRequestSchema > >>;
export type Iso722 = Assert<Eq< z.input< typeof M28.UpdateDataRequestSchema >, z.infer< typeof M28.UpdateDataRequestSchema > >>;
export type Iso723 = Assert<Eq< z.input< typeof M28.DeleteDataRequestSchema >, z.infer< typeof M28.DeleteDataRequestSchema > >>;
export type Iso724 = Assert<Eq< z.input< typeof M28.CreateManyDataRequestSchema >, z.infer< typeof M28.CreateManyDataRequestSchema > >>;
export type Iso728 = Assert<Eq< z.input< typeof M28.CheckPermissionRequestSchema >, z.infer< typeof M28.CheckPermissionRequestSchema > >>;
export type Iso729 = Assert<Eq< z.input< typeof M28.GetObjectPermissionsRequestSchema >, z.infer< typeof M28.GetObjectPermissionsRequestSchema > >>;
export type Iso730 = Assert<Eq< z.input< typeof M28.GetEffectivePermissionsRequestSchema >, z.infer< typeof M28.GetEffectivePermissionsRequestSchema > >>;
export type Iso731 = Assert<Eq< z.input< typeof M28.RealtimeConnectRequestSchema >, z.infer< typeof M28.RealtimeConnectRequestSchema > >>;
export type Iso732 = Assert<Eq< z.input< typeof M28.RealtimeDisconnectRequestSchema >, z.infer< typeof M28.RealtimeDisconnectRequestSchema > >>;
export type Iso733 = Assert<Eq< z.input< typeof M28.RealtimeSubscribeRequestSchema >, z.infer< typeof M28.RealtimeSubscribeRequestSchema > >>;
export type Iso734 = Assert<Eq< z.input< typeof M28.RealtimeUnsubscribeRequestSchema >, z.infer< typeof M28.RealtimeUnsubscribeRequestSchema > >>;
export type Iso735 = Assert<Eq< z.input< typeof M28.SetPresenceRequestSchema >, z.infer< typeof M28.SetPresenceRequestSchema > >>;
export type Iso736 = Assert<Eq< z.input< typeof M28.GetPresenceRequestSchema >, z.infer< typeof M28.GetPresenceRequestSchema > >>;
export type Iso737 = Assert<Eq< z.input< typeof M28.RegisterDeviceRequestSchema >, z.infer< typeof M28.RegisterDeviceRequestSchema > >>;
export type Iso738 = Assert<Eq< z.input< typeof M28.UnregisterDeviceRequestSchema >, z.infer< typeof M28.UnregisterDeviceRequestSchema > >>;
export type Iso739 = Assert<Eq< z.input< typeof M28.GetNotificationPreferencesRequestSchema >, z.infer< typeof M28.GetNotificationPreferencesRequestSchema > >>;
export type Iso740 = Assert<Eq< z.input< typeof M28.MarkNotificationsReadRequestSchema >, z.infer< typeof M28.MarkNotificationsReadRequestSchema > >>;
export type Iso741 = Assert<Eq< z.input< typeof M28.MarkAllNotificationsReadRequestSchema >, z.infer< typeof M28.MarkAllNotificationsReadRequestSchema > >>;
export type Iso742 = Assert<Eq< z.input< typeof M28.AiMessageSchema >, z.infer< typeof M28.AiMessageSchema > >>;
export type Iso743 = Assert<Eq< z.input< typeof M28.AiChatRequestSchema >, z.infer< typeof M28.AiChatRequestSchema > >>;
export type Iso744 = Assert<Eq< z.input< typeof M28.AiCompleteRequestSchema >, z.infer< typeof M28.AiCompleteRequestSchema > >>;
export type Iso745 = Assert<Eq< z.input< typeof M28.CreateAiConversationRequestSchema >, z.infer< typeof M28.CreateAiConversationRequestSchema > >>;
export type Iso746 = Assert<Eq< z.input< typeof M28.ListAiConversationsRequestSchema >, z.infer< typeof M28.ListAiConversationsRequestSchema > >>;
export type Iso747 = Assert<Eq< z.input< typeof M28.UpdateAiConversationRequestSchema >, z.infer< typeof M28.UpdateAiConversationRequestSchema > >>;
export type Iso748 = Assert<Eq< z.input< typeof M28.AiAgentChatRequestSchema >, z.infer< typeof M28.AiAgentChatRequestSchema > >>;
export type Iso749 = Assert<Eq< z.input< typeof M28.ListAiPendingActionsRequestSchema >, z.infer< typeof M28.ListAiPendingActionsRequestSchema > >>;
export type Iso750 = Assert<Eq< z.input< typeof M28.GetLocalesRequestSchema >, z.infer< typeof M28.GetLocalesRequestSchema > >>;
export type Iso751 = Assert<Eq< z.input< typeof M28.GetTranslationsRequestSchema >, z.infer< typeof M28.GetTranslationsRequestSchema > >>;
export type Iso752 = Assert<Eq< z.input< typeof M28.GetFieldLabelsRequestSchema >, z.infer< typeof M28.GetFieldLabelsRequestSchema > >>;
export type Iso755 = Assert<Eq< z.input< typeof M28.ValidateDataIssueSchema >, z.infer< typeof M28.ValidateDataIssueSchema > >>;
export type Iso756 = Assert<Eq< z.input< typeof M28.ValidateDataRequestSchema >, z.infer< typeof M28.ValidateDataRequestSchema > >>;
export type Iso757 = Assert<Eq< z.input< typeof M28.ValidateDataResponseSchema >, z.infer< typeof M28.ValidateDataResponseSchema > >>;

// automation/builtin-node-config.zod.ts
export type Iso753 = Assert<Eq< z.input< typeof M172.ScreenFieldConfigSchema >, z.infer< typeof M172.ScreenFieldConfigSchema > >>;

// automation/schemaless-node-config.zod.ts
export type Iso754 = Assert<Eq< z.input< typeof M173.DecisionConditionSchema >, z.infer< typeof M173.DecisionConditionSchema > >>;


// ---------------------------------------------------------------------------
// #4593 — the documented-schema type-alias backfill (2026-08-08).
//
// Every schema below already had a published JSON Schema and a reference page,
// and the page's `import type { X }` line was being dropped because no alias
// carried the name (`docs-import-surface.baseline.json`, "no type export").
// The backfill declares the bare alias; each schema here measured isomorphic, so
// it takes a pin rather than an `XParsed` synonym — the (RISE) case, and the
// largest single rise this file has taken.
// ---------------------------------------------------------------------------

// ai/conversation.zod.ts
export type Iso760 = Assert<Eq< z.input< typeof M1.FileContentSchema >, z.infer< typeof M1.FileContentSchema > >>;
export type Iso761 = Assert<Eq< z.input< typeof M1.TextContentSchema >, z.infer< typeof M1.TextContentSchema > >>;

// api/analytics.zod.ts
export type Iso762 = Assert<Eq< z.input< typeof M11.GetAnalyticsMetaRequestSchema >, z.infer< typeof M11.GetAnalyticsMetaRequestSchema > >>;

// api/endpoint.zod.ts
export type Iso763 = Assert<Eq< z.input< typeof M174.ApiMappingSchema >, z.infer< typeof M174.ApiMappingSchema > >>;

// api/metadata.zod.ts
export type Iso764 = Assert<Eq< z.input< typeof M24.MetadataBulkUnregisterRequestSchema >, z.infer< typeof M24.MetadataBulkUnregisterRequestSchema > >>;
export type Iso765 = Assert<Eq< z.input< typeof M24.MetadataValidateRequestSchema >, z.infer< typeof M24.MetadataValidateRequestSchema > >>;

// api/realtime.zod.ts
export type Iso766 = Assert<Eq< z.input< typeof M31.SubscriptionEventSchema >, z.infer< typeof M31.SubscriptionEventSchema > >>;

// automation/approval.zod.ts
export type Iso767 = Assert<Eq< z.input< typeof M37.ApproverType >, z.infer< typeof M37.ApproverType > >>;

// automation/flow.zod.ts
export type Iso768 = Assert<Eq< z.input< typeof M175.FlowNodeAction >, z.infer< typeof M175.FlowNodeAction > >>;

// automation/state-machine.zod.ts
export type Iso769 = Assert<Eq< z.input< typeof M42.GuardRefSchema >, z.infer< typeof M42.GuardRefSchema > >>;
export type Iso770 = Assert<Eq< z.input< typeof M42.StateNodeSchema >, z.infer< typeof M42.StateNodeSchema > >>;

// data/analytics.zod.ts
export type Iso771 = Assert<Eq< z.input< typeof M55.AggregationMetricType >, z.infer< typeof M55.AggregationMetricType > >>;
export type Iso772 = Assert<Eq< z.input< typeof M55.DimensionType >, z.infer< typeof M55.DimensionType > >>;
export type Iso773 = Assert<Eq< z.input< typeof M55.TimeUpdateInterval >, z.infer< typeof M55.TimeUpdateInterval > >>;

// data/context-tokens.zod.ts
export type Iso774 = Assert<Eq< z.input< typeof M176.ContextTokenPlaceholderSchema >, z.infer< typeof M176.ContextTokenPlaceholderSchema > >>;

// data/data-engine.zod.ts
export type Iso775 = Assert<Eq< z.input< typeof M56.DataEngineExecuteRequestSchema >, z.infer< typeof M56.DataEngineExecuteRequestSchema > >>;
export type Iso776 = Assert<Eq< z.input< typeof M56.DataEngineInsertRequestSchema >, z.infer< typeof M56.DataEngineInsertRequestSchema > >>;
export type Iso777 = Assert<Eq< z.input< typeof M56.DataEngineVectorFindRequestSchema >, z.infer< typeof M56.DataEngineVectorFindRequestSchema > >>;

// data/datasource.zod.ts
export type Iso778 = Assert<Eq< z.input< typeof M57.DriverType >, z.infer< typeof M57.DriverType > >>;

// data/date-macros.zod.ts
export type Iso779 = Assert<Eq< z.input< typeof M177.DateMacroPlaceholderSchema >, z.infer< typeof M177.DateMacroPlaceholderSchema > >>;

// data/driver/common.zod.ts
export type Iso780 = Assert<Eq< z.input< typeof M61.DriverSslToggleSchema >, z.infer< typeof M61.DriverSslToggleSchema > >>;

// data/field-value.zod.ts
export type Iso781 = Assert<Eq< z.input< typeof M178.AddressValueSchema >, z.infer< typeof M178.AddressValueSchema > >>;
export type Iso782 = Assert<Eq< z.input< typeof M178.CalendarDateValueSchema >, z.infer< typeof M178.CalendarDateValueSchema > >>;
export type Iso783 = Assert<Eq< z.input< typeof M178.ClockTimeValueSchema >, z.infer< typeof M178.ClockTimeValueSchema > >>;
export type Iso784 = Assert<Eq< z.input< typeof M178.FileLikeValueSchema >, z.infer< typeof M178.FileLikeValueSchema > >>;
export type Iso785 = Assert<Eq< z.input< typeof M178.FileReferenceIdValueSchema >, z.infer< typeof M178.FileReferenceIdValueSchema > >>;
export type Iso786 = Assert<Eq< z.input< typeof M178.FileValueSchema >, z.infer< typeof M178.FileValueSchema > >>;
export type Iso787 = Assert<Eq< z.input< typeof M178.InstantValueSchema >, z.infer< typeof M178.InstantValueSchema > >>;
export type Iso788 = Assert<Eq< z.input< typeof M178.LocationValueSchema >, z.infer< typeof M178.LocationValueSchema > >>;
export type Iso789 = Assert<Eq< z.input< typeof M178.ReferenceIdValueSchema >, z.infer< typeof M178.ReferenceIdValueSchema > >>;

// data/mapping.zod.ts
export type Iso790 = Assert<Eq< z.input< typeof M179.TransformType >, z.infer< typeof M179.TransformType > >>;

// data/query.zod.ts
export type Iso791 = Assert<Eq< z.input< typeof M71.AggregationFunction >, z.infer< typeof M71.AggregationFunction > >>;

// integration/connector.zod.ts
export type Iso792 = Assert<Eq< z.input< typeof M78.ConnectorActionSchema >, z.infer< typeof M78.ConnectorActionSchema > >>;
export type Iso793 = Assert<Eq< z.input< typeof M78.ConnectorTriggerSchema >, z.infer< typeof M78.ConnectorTriggerSchema > >>;

// qa/testing.zod.ts
export type Iso794 = Assert<Eq< z.input< typeof M105.TestActionTypeSchema >, z.infer< typeof M105.TestActionTypeSchema > >>;
export type Iso795 = Assert<Eq< z.input< typeof M105.TestAssertionTypeSchema >, z.infer< typeof M105.TestAssertionTypeSchema > >>;
export type Iso796 = Assert<Eq< z.input< typeof M105.TestContextSchema >, z.infer< typeof M105.TestContextSchema > >>;

// security/sharing.zod.ts
export type Iso797 = Assert<Eq< z.input< typeof M180.OWDModel >, z.infer< typeof M180.OWDModel > >>;
export type Iso798 = Assert<Eq< z.input< typeof M180.ShareRecipientType >, z.infer< typeof M180.ShareRecipientType > >>;
export type Iso799 = Assert<Eq< z.input< typeof M180.SharingLevel >, z.infer< typeof M180.SharingLevel > >>;
export type Iso800 = Assert<Eq< z.input< typeof M180.SharingRuleType >, z.infer< typeof M180.SharingRuleType > >>;

// shared/connector-auth.zod.ts
export type Iso801 = Assert<Eq< z.input< typeof M109.ConnectorInstanceAPIKeyAuthSchema >, z.infer< typeof M109.ConnectorInstanceAPIKeyAuthSchema > >>;
export type Iso802 = Assert<Eq< z.input< typeof M109.ConnectorInstanceBasicAuthSchema >, z.infer< typeof M109.ConnectorInstanceBasicAuthSchema > >>;
export type Iso803 = Assert<Eq< z.input< typeof M109.ConnectorInstanceBearerAuthSchema >, z.infer< typeof M109.ConnectorInstanceBearerAuthSchema > >>;
export type Iso804 = Assert<Eq< z.input< typeof M109.ConnectorInstanceNoAuthSchema >, z.infer< typeof M109.ConnectorInstanceNoAuthSchema > >>;

// studio/plugin.zod.ts
export type Iso805 = Assert<Eq< z.input< typeof M119.PanelLocationSchema >, z.infer< typeof M119.PanelLocationSchema > >>;

// system/core-services.zod.ts
export type Iso806 = Assert<Eq< z.input< typeof M124.KernelServiceMapSchema >, z.infer< typeof M124.KernelServiceMapSchema > >>;
export type Iso807 = Assert<Eq< z.input< typeof M124.ServiceConfigSchema >, z.infer< typeof M124.ServiceConfigSchema > >>;
export type Iso808 = Assert<Eq< z.input< typeof M124.ServiceCriticalitySchema >, z.infer< typeof M124.ServiceCriticalitySchema > >>;
export type Iso835 = Assert<Eq< z.input< typeof M124.KernelServiceStatusSchema >, z.infer< typeof M124.KernelServiceStatusSchema > >>;

// system/metadata-persistence.zod.ts
export type Iso809 = Assert<Eq< z.input< typeof M138.MetadataStateSchema >, z.infer< typeof M138.MetadataStateSchema > >>;

// system/migration.zod.ts
export type Iso810 = Assert<Eq< z.input< typeof M140.DeleteObjectOperation >, z.infer< typeof M140.DeleteObjectOperation > >>;
export type Iso811 = Assert<Eq< z.input< typeof M140.ExecuteSqlOperation >, z.infer< typeof M140.ExecuteSqlOperation > >>;
export type Iso812 = Assert<Eq< z.input< typeof M140.MigrationDependencySchema >, z.infer< typeof M140.MigrationDependencySchema > >>;
export type Iso813 = Assert<Eq< z.input< typeof M140.ModifyFieldOperation >, z.infer< typeof M140.ModifyFieldOperation > >>;
export type Iso814 = Assert<Eq< z.input< typeof M140.RemoveFieldOperation >, z.infer< typeof M140.RemoveFieldOperation > >>;
export type Iso815 = Assert<Eq< z.input< typeof M140.RenameObjectOperation >, z.infer< typeof M140.RenameObjectOperation > >>;

// system/translation.zod.ts
export type Iso816 = Assert<Eq< z.input< typeof M152.LocaleSchema >, z.infer< typeof M152.LocaleSchema > >>;

// ui/action.zod.ts
export type Iso817 = Assert<Eq< z.input< typeof M155.ActionType >, z.infer< typeof M155.ActionType > >>;

// ui/component.zod.ts
export type Iso818 = Assert<Eq< z.input< typeof M170.ElementNumberPropsSchema >, z.infer< typeof M170.ElementNumberPropsSchema > >>;
export type Iso819 = Assert<Eq< z.input< typeof M170.ElementRecordPickerPropsSchema >, z.infer< typeof M170.ElementRecordPickerPropsSchema > >>;
export type Iso820 = Assert<Eq< z.input< typeof M170.RecordHighlightsField >, z.infer< typeof M170.RecordHighlightsField > >>;
export type Iso821 = Assert<Eq< z.input< typeof M170.RecordPathProps >, z.infer< typeof M170.RecordPathProps > >>;
// `record:reference_rail` (#8691) — deliberately default-free on the same
// principle as the object-* family below: the renderer's `limit ?? 3` /
// `hideEmpty !== false` fallbacks stay the renderer's facts, so "the author
// said nothing" survives the parse, and input === infer holds for both shapes.
export type Iso845 = Assert<Eq< z.input< typeof M170.ReferenceRailEntrySchema >, z.infer< typeof M170.ReferenceRailEntrySchema > >>;
export type Iso846 = Assert<Eq< z.input< typeof M170.RecordReferenceRailProps >, z.infer< typeof M170.RecordReferenceRailProps > >>;
// #8744 — the three record types the rail fix left behind, default-free on
// the same principle. `RecordAlertProps` itself is deliberately NOT pinned:
// its `visible` carries `ExpressionInputSchema`, whose bare-string arm
// TRANSFORMS to the canonical `{ dialect, source }` envelope, so
// input ≠ infer by construction — the alias stays `z.input` (the authoring
// face), per the convention's own rule for Expression-carrying shapes.
export type Iso847 = Assert<Eq< z.input< typeof M170.RecordAlertActionSchema >, z.infer< typeof M170.RecordAlertActionSchema > >>;
export type Iso848 = Assert<Eq< z.input< typeof M170.RecordQuickActionsProps >, z.infer< typeof M170.RecordQuickActionsProps > >>;
export type Iso849 = Assert<Eq< z.input< typeof M170.RecordHistoryProps >, z.infer< typeof M170.RecordHistoryProps > >>;
// The object-* block family (#7751) — deliberately default-free in its first,
// warning-tier step ("the author said nothing" must stay distinguishable from
// "the author asked for the renderer's fallback"), so input === infer holds.
// A default added to any of these six goes red here, and the fix is the ADR's:
// declare the XParsed alias and delete the pin line.
export type Iso839 = Assert<Eq< z.input< typeof M170.ObjectGridPropsSchema >, z.infer< typeof M170.ObjectGridPropsSchema > >>;
export type Iso840 = Assert<Eq< z.input< typeof M170.ObjectMetricPropsSchema >, z.infer< typeof M170.ObjectMetricPropsSchema > >>;
export type Iso841 = Assert<Eq< z.input< typeof M170.ObjectKanbanPropsSchema >, z.infer< typeof M170.ObjectKanbanPropsSchema > >>;
export type Iso842 = Assert<Eq< z.input< typeof M170.ObjectCalendarPropsSchema >, z.infer< typeof M170.ObjectCalendarPropsSchema > >>;
export type Iso843 = Assert<Eq< z.input< typeof M170.ObjectFormPropsSchema >, z.infer< typeof M170.ObjectFormPropsSchema > >>;
export type Iso844 = Assert<Eq< z.input< typeof M170.ObjectMasterDetailFormPropsSchema >, z.infer< typeof M170.ObjectMasterDetailFormPropsSchema > >>;

// ui/page.zod.ts
export type Iso822 = Assert<Eq< z.input< typeof M163.PageComponentType >, z.infer< typeof M163.PageComponentType > >>;

// ui/report.zod.ts
export type Iso823 = Assert<Eq< z.input< typeof M164.ReportType >, z.infer< typeof M164.ReportType > >>;

// ui/responsive.zod.ts
export type Iso824 = Assert<Eq< z.input< typeof M165.BreakpointColumnMapSchema >, z.infer< typeof M165.BreakpointColumnMapSchema > >>;
export type Iso825 = Assert<Eq< z.input< typeof M165.BreakpointOrderMapSchema >, z.infer< typeof M165.BreakpointOrderMapSchema > >>;

// ui/view.zod.ts
export type Iso826 = Assert<Eq< z.input< typeof M167.CalendarConfigSchema >, z.infer< typeof M167.CalendarConfigSchema > >>;
export type Iso827 = Assert<Eq< z.input< typeof M167.GanttConfigSchema >, z.infer< typeof M167.GanttConfigSchema > >>;
export type Iso828 = Assert<Eq< z.input< typeof M167.GanttQuickFilterSchema >, z.infer< typeof M167.GanttQuickFilterSchema > >>;
export type Iso829 = Assert<Eq< z.input< typeof M167.KanbanConfigSchema >, z.infer< typeof M167.KanbanConfigSchema > >>;
export type Iso851 = Assert<Eq< z.input< typeof M167.ListMapConfigSchema >, z.infer< typeof M167.ListMapConfigSchema > >>;
export type Iso830 = Assert<Eq< z.input< typeof M167.NavigationModeSchema >, z.infer< typeof M167.NavigationModeSchema > >>;
export type Iso831 = Assert<Eq< z.input< typeof M167.TreeConfigSchema >, z.infer< typeof M167.TreeConfigSchema > >>;
export type Iso832 = Assert<Eq< z.input< typeof M167.ViewItemNameSchema >, z.infer< typeof M167.ViewItemNameSchema > >>;
// ---------------------------------------------------------------------------
// Representative spot-checks on the phase-2 FLIP.
//
// Five aliases across three domains, asserting the two facts that make phase 2
// correct: each `XParsed` still denotes exactly `z.infer<typeof XSchema>`, and
// the bare name beside it now denotes `z.input` — the author state. The second
// half is the one worth pinning: phase 2's whole claim is that these five names
// CHANGED meaning, in exactly one direction, and this is that claim in a form
// tsc rejects. In phase 1 these same five lines read `...Unmoved` and asserted
// the opposite of what they assert now; that inversion is the change.
// ---------------------------------------------------------------------------

export type Spot1 = Assert<Eq< ConnectorParsed, z.infer< typeof ConnectorSchema > >>;
export type Spot1Flipped = Assert<Eq< Connector, z.input< typeof ConnectorSchema > >>;
export type Spot2 = Assert<Eq< DataSyncConfigParsed, z.infer< typeof DataSyncConfigSchema > >>;
export type Spot2Flipped = Assert<Eq< DataSyncConfig, z.input< typeof DataSyncConfigSchema > >>;
export type Spot3 = Assert<Eq< ViewParsed, z.infer< typeof ViewSchema > >>;
export type Spot3Flipped = Assert<Eq< View, z.input< typeof ViewSchema > >>;
export type Spot4 = Assert<Eq< ViewFilterRuleParsed, z.infer< typeof ViewFilterRuleSchema > >>;
export type Spot4Flipped = Assert<Eq< ViewFilterRule, z.input< typeof ViewFilterRuleSchema > >>;
export type Spot5 = Assert<
  Eq< ObjectFieldGroupParsed, z.infer< typeof ObjectFieldGroupSchema > >
>;
export type Spot5Flipped = Assert<
  Eq< ObjectFieldGroup, z.input< typeof ObjectFieldGroupSchema > >
>;

// Each of the five is in the covered set because its two shapes DIFFER. Assert
// that too, so a spot-check cannot quietly become vacuous by drifting into the
// isomorphic complement — which is precisely how a pin stops testing anything.
// Without this, `Spot1` and `Spot1Flipped` would both hold trivially on an
// isomorphic schema and the flip would be untested at the very sites chosen to
// test it.
type Differs<A, B> = Eq<A, B> extends false ? true : false;
export type Spot1Differs = Assert<
  Differs< z.input< typeof ConnectorSchema >, z.infer< typeof ConnectorSchema > >
>;
export type Spot3Differs = Assert<
  Differs< z.input< typeof ViewSchema >, z.infer< typeof ViewSchema > >
>;

// ---------------------------------------------------------------------------
// The A-family, untouched — twice over. `shared/retry-policy.zod.ts` already
// spelled the ADR-0122 target shape before phase 1, phase 1 did not disturb it,
// and phase 2 had nothing to flip here: the bare name was already the AUTHOR
// state, and the parsed state was already on `RetryPolicyParsed`. That is the
// control on the whole change — a file the codemod must have left alone.
// ---------------------------------------------------------------------------

export type AFamilyBareIsAuthorState = Assert<
  Eq< RetryPolicy, z.input< typeof RetryPolicySchema > >
>;
export type AFamilyParsedIsParseState = Assert<
  Eq< RetryPolicyParsed, z.infer< typeof RetryPolicySchema > >
>;

// ---------------------------------------------------------------------------
// Runtime companions. Everything above is erased at runtime, so vitest needs a
// body — and these are the facts the type layer cannot state.
// ---------------------------------------------------------------------------

describe('ADR-0122 type-alias convention', () => {
  // The title states the count as well, and hand-tracking it did not hold: it
  // was corrected once, from 751 to 754 (#6037), and had drifted again to sit
  // 68 behind by the time #6605 looked. Both prose statements of the number —
  // this title and the section header above the pin list — are now asserted
  // against the recomputed count below, so neither can go stale without a red
  // test naming it.
  it('still declares all 839 isomorphic pins', () => {
    // The truth of each pin is proved by tsc, not here — an `Assert<Eq<...>>`
    // that stops holding is a compile error with the alias named. What tsc
    // cannot notice is a pin that was DELETED: removing the assertion removes
    // the failure too, so a red line can be made green by deleting it, and the
    // schema it exempted then drifts unwatched. Counting them from the source
    // is what makes that edit visible in `pnpm test` as well as in the gate.
    //
    // Rebalancing this number is normal — it drops by one whenever a schema
    // gains a shape and its alias gains an `XParsed`. Dropping it without that
    // corresponding alias is the edit this case exists to stop.
    //
    // It also RISES, which the count had not yet seen when it was written: a
    // NEW isomorphic schema arrives with a bare alias, and `check:spec-parsed-alias`
    // sends it here rather than to an `XParsed` (718 -> 719 was
    // `ConnectorActionEffectSchema`, #4395 — a bare `z.enum`, like the
    // `ConnectorType` / `ConnectorStatus` pins beside it).
    //
    // And it drops by MORE than one when schemas are RETIRED, which is the third
    // way and the one to read carefully, because from the count alone it looks
    // exactly like the edit this case exists to stop: #5055 removed
    // `I18nObjectSchema`, `PluralRuleSchema`, `DateFormatSchema` and
    // `WidgetLifecycleSchema` under ADR-0049, i.e. -4. What separates it from a
    // bare deletion is that the SCHEMAS went with the pins —
    // `check:spec-parsed-alias` has nothing left to exempt, and
    // `ui/widget-i18n-retirement.test.ts` asserts their absence on every public
    // entry. A pin deleted while its schema still exports is still the failure
    // this counts.
    //
    // 720 -> 716 is that retirement landing on top of #5775's addition
    // (`PageContainerProps`, the +1 that had taken the count to 720). Both moves
    // are in this number at once, which is exactly why it is recomputed from the
    // source rather than reasoned about: -4 retired, +0 of my own.
    //
    // The fourth way is the one ADR-0122 phase 2 (#6083) added, and it is a
    // BULK rise with no schema change behind it at all: 716 -> 751. Those
    // 35 schemas are not new and did not move. Their bare alias already read
    // `z.input` before the flip, so phase 1's gate — which only ever looked at
    // bare `z.infer` aliases — had never asked them whether their parsed state
    // was named. Inverting the gate asked, and 35 of the 57 it turned up
    // answered "isomorphic". A jump this size is normally the shape of a
    // mistake; this one is a gate widening, and the pins are its receipt.
    //
    // 751 -> 754 is #6037's `ValidateDataIssue` / `ValidateDataRequest` /
    // `ValidateDataResponse` — three new protocol shapes with no defaults or
    // transforms anywhere in their trees, i.e. the second (RISE) case above.
    //
    //
    // 751 -> 754 is #6037's `ValidateDataIssue` / `ValidateDataRequest` /
    // `ValidateDataResponse` — three new protocol shapes with no defaults or
    // transforms anywhere in their trees, i.e. the second (RISE) case above.
    //
    // 754 -> 755 is #5933's `SpecifierValueDomain` — one new closed enum on
    // `SettingsManifest`'s SpecifierSchema, the same (RISE) case: a `z.enum`
    // has no default or transform, so its two shapes coincide and it gets a pin
    // rather than a `SpecifierValueDomainParsed` synonym.
    //
    // 755 -> 748 is the 2026-08-08 ADR-0049 retirement sweep (#6486), the
    // first way again — a schema left the package, so its pin left with it.
    // Written out per member, because a MULTI-member sweep is exactly where a
    // count gets nudged to fit instead of recomputed:
    //
    //   #5295  -3  ServerEventType, ServerEventSchema, ServerStatusSchema
    //             (`ServerCapabilities` has a `Parsed` alias, so it was never
    //             pinned here — a retired schema does not always cost a line)
    //   #6239  -4  DeleteViewResponseSchema, ListViewsRequestSchema,
    //             GetViewRequestSchema, DeleteViewRequestSchema (four of the
    //             ten view schemas were isomorphic; the other six were paired)
    //   #6414   0  every ETL alias already had a `Parsed` counterpart
    //
    // -7, and 755 - 7 = 748. Three things this one entry is worth stating,
    // because they are the ways a MINUS gets miscomputed here. (1) The member
    // count (3) and the pin count (7) have no relation to each other. (2) The
    // -7 was computed against 751 at the branch point and had to be rebased
    // TWICE before landing — onto #6037's 754, then onto #5933's 755 — so the
    // subtrahend was the only stable operand. (3) A sibling retirement in the
    // same window contributed ZERO: #6527 retired `array_agg` / `string_agg`
    // from `AggregationFunction`, and an enum VALUE narrowing is invisible
    // here, exactly as it is to the four surface ratchets. Recompute from the
    // file; never from the changelog.
    //
    // 748 -> 749 is #5728's `InlineLocaleMapSchema`, the second arm of the
    // widened `I18nLabelSchema`. Same RISE case: a `z.record` of plain strings
    // whose KEY carries a format constraint. A regex narrows which keys parse;
    // it never rewrites one, so nothing in the tree produces an output shape
    // the input does not already have. (Its receipt was written twice before
    // landing — as 755 -> 756 against the pre-sweep count — and recomputed
    // here after the sweep's -7 merged in; the file, not the history, is the
    // operand.)
    //
    // 749 -> 822 is #4593's documented-schema alias backfill — the largest
    // single RISE this file has taken, and the one where the arithmetic is most
    // worth stating because the +73 is NOT "the gap the ratchet reports".
    // `docs-import-surface.baseline.json` listed 136 documented schemas whose
    // reference page could not spell an `import type` line. Four subtractions
    // stand between that 136 and this 73, and each is a REASON, not a filter:
    //
    //   -17  the alias already exists under a name the JSON Schema does not
    //        derive (`Discovery` is published as `DiscoveryResponse`,
    //        `SortDirectionEnum` as `SortDirection`, ...). Declaring the
    //        derived name too would mint exactly the permanent synonym
    //        ADR-0122 D3 forbids, so those lines STAY in the baseline.
    //   -40  `z.input` differs from `z.infer`, so the bare alias needs an
    //        `XParsed` sibling rather than a pin — a decision left open, see
    //        the issue.
    //   -5   host file was being edited concurrently (data/filter.zod.ts,
    //        api/protocol.zod.ts); deferred rather than raced.
    //   -1   `system/ServiceStatus`. Declaring it turned `check:dual-source-
    //        exports` red on the spot: `./api` already exports a DIFFERENT
    //        `ServiceStatus` (the discovery health enum in api/discovery.zod.ts),
    //        so the alias would have minted the #4411 trap the empty
    //        `dual-source-exports.baseline.json` exists to keep empty. One of
    //        the two names is wrong, and choosing which is a rename decision,
    //        not a backfill — the baseline line stays until it is made.
    //
    // 136 - 17 - 40 - 5 - 1 = 73, and 749 + 73 = 822. Isomorphism here was
    // MEASURED — a probe file asserting `Eq< z.input, z.infer >` over all 114
    // non-synonym candidates, compiled by tsc — not inferred from "it is an
    // enum". 40 of those 114 came back `false`, which is why the -40 above is a
    // measurement rather than an estimate. The subtrahend moved once in flight:
    // #5728 landed its +1 on `main` while this branch was open, so the 73 was
    // re-added to 749 rather than to the 748 it was computed against — the same
    // rebase discipline the -7 entry above records, applied in the other
    // direction.
    //
    // 822 -> 823 is #6487's `GetMetaItemLayeredResponseSchema` (#5882): the
    // three-layer projection `GET /meta/:type/:name/layers` now declares. Its
    // tree is enums, booleans, `z.unknown()` and
    // `MetadataValidationResultSchema` — no `.default()` anywhere — so its two
    // shapes coincide and ADR-0122 gives it a pin. Sweep siblings #5950 and
    // #6442 contribute 0 (already pinned / carries a Parsed alias). This
    // receipt was written twice before landing — as 749 -> 750 against the
    // pre-backfill count — and recomputed here after #4593's +73 merged in;
    // the pin also took its THIRD number (759 -> 760 -> 833), each time
    // because the next-free id had been claimed by a branch that merged
    // first. The file, not the history, is the operand.
    //
    // 824 -> 823 is #4914's ADR-0049 retirement of the `manifest.loading`
    // block: `Iso441` pinned `PluginLoadingStrategySchema`, one of the eleven
    // defs unpublished with the carrier key, so its pin goes with the schema.
    // A DECREASE, and the first here — the id is retired in place rather than
    // renumbered, because the ids are claims about pins and not positions
    // (`Iso824` remains the highest, and the next author still takes 825).
    //
    // 823 -> 824 is #6604 — the `-1` in #4593's arithmetic above, collected.
    // That subtraction was not a measurement but an OPEN QUESTION: the alias
    // for `system/ServiceStatus` was withheld because declaring it would have
    // minted the #4411 dual-source trap against `./api`'s discovery health
    // enum, and which of the two names was wrong is a rename decision. The
    // maintainer made it on 2026-08-08 (Option B): the kernel side is now
    // `KernelServiceStatusSchema`, matching its `KernelServiceMapSchema`
    // sibling two lines up in the pin list, and the name it vacated stays
    // `./api`'s alone. So the alias the -1 deferred exists at last, under a
    // different name than the one it was deferred under — and `Iso835`, not
    // `Iso809`, is its id, because the ids are claims about pins and not
    // positions (same rule the #4914 decrease above records). Isomorphism
    // MEASURED the same way as its 73 siblings: the tree is one enum, one
    // boolean, one inline `z.enum` and three optional strings/arrays — no
    // `.default()`, `.transform()`, `.catch()` or `.pipe()` anywhere — so the
    // two shapes coincide and ADR-0122 gives it a pin rather than an
    // `XParsed`. The rename itself contributes 0: renaming a schema const
    // moves no shape, and this file counts pins, not names.
    //
    // 824 -> 825 is #7294's `PublishMetaItemResponseSchema` — the declaration
    // that gives `POST /meta/:type/:name/publish` a response contract, the
    // #5745 discipline one door over from `SaveMetaItemResponseSchema`
    // (`Iso136`, two lines above the new pin). Isomorphism MEASURED, not
    // assumed: the tree is booleans, strings, `z.number().int()`s, three
    // inline optional objects and one `z.array(z.unknown())` — no
    // `.default()`, `.transform()`, `.catch()` or `.pipe()` anywhere — so the
    // two shapes coincide and ADR-0122 gives it a pin rather than an
    // `XParsed`. Its id is `Iso836`, the next free one, not a number near its
    // neighbours: the ids are claims about pins and not positions (the same
    // rule the #4914 decrease and the #6604 entry above both record).
    //
    // 825 -> 826 is #4717's `RuntimeAuthoringIssueSchema` — the ONE element
    // shape the #4463 runtime authoring gate reports a finding in, on both
    // halves of D3: the 422 `issues[]` and the new 2xx `advisories[]` on
    // `SaveMetaItemResponseSchema` (`Iso136`). Isomorphism MEASURED, not
    // assumed: five `z.string()`s and one `z.enum` — no `.default()`,
    // `.transform()`, `.catch()`, `.optional()` or `.pipe()` anywhere — so the
    // two shapes coincide and ADR-0122 gives it a pin rather than an
    // `XParsed`. Adding the OPTIONAL `advisories` key to
    // `SaveMetaItemResponseSchema` contributes 0 of its own: `.optional()`
    // widens input and output identically, so `Iso136` still holds and the
    // count moves by exactly the one new schema. Its id is `Iso837`, the next
    // free one — the ids are claims about pins, not positions.
    //
    // 826 -> 824 is #8075's ADR-0049 retirement of two whole modules:
    // `data/external-lookup.zod.ts` (`Iso335`, `ExternalDataSourceSchema`) and
    // `system/message-queue.zod.ts` (`Iso586`, `MessageQueueProviderSchema`).
    // A pin leaves when its schema leaves — the schemas are deleted, so the
    // pins are deleted with them, not re-pointed. The ids `Iso335`/`Iso586`
    // are retired with their subjects and are NOT free for reuse: the ids are
    // claims about pins, not positions.
    //
    // 824 -> 825 is #8211's `StandardSynonymWaiverSchema` — the recorded
    // waiver that keeps a semantic synonym of a standard-catalog member
    // registered in `ERROR_CODE_LEDGER`. Isomorphism MEASURED, not assumed:
    // two `z.string()`s (one regex-, one min-constrained — constraints refine,
    // they do not reshape) and the `StandardErrorCode` enum, with no
    // `.default()`, `.transform()`, `.catch()`, `.optional()` or `.pipe()`
    // anywhere, so the two shapes coincide and ADR-0122 gives it a pin rather
    // than an `XParsed`. Its id is `Iso838`, the next free one — the ids are
    // claims about pins, not positions.
    //
    // 825 -> 831 is #7751 — the object-* block family's six props schemas
    // (`ObjectGridPropsSchema` … `ObjectMasterDetailFormPropsSchema`),
    // deliberately default-free at the warning tier ("the author said
    // nothing" must stay distinguishable from "the author asked for the
    // renderer's fallback"), so all six pin isomorphic. Their ids are
    // `Iso839`-`Iso844`, the next free ones AFTER #8211's `Iso838` — the
    // branch numbered them `Iso838`-`Iso843` while unmerged and renumbered on
    // merge, which is legal precisely because the ids are claims about pins,
    // not positions: an unmerged claim has been asserted to nobody yet.
    //
    // 831 -> 833 is #8691 — `record:reference_rail`'s two schemas
    // (`ReferenceRailEntrySchema`, `RecordReferenceRailProps`), deliberately
    // default-free on the object-* family's principle (the renderer's
    // `limit ?? 3` / `hideEmpty !== false` fallbacks stay the renderer's
    // facts), so both pin isomorphic as `Iso845`/`Iso846`.
    //
    // 833 -> 836 is #8744 — the three record types the rail fix left behind
    // (`RecordAlertActionSchema`, `RecordQuickActionsProps`,
    // `RecordHistoryProps`), default-free on the same principle, pinned as
    // `Iso847`-`Iso849`. `RecordAlertProps` is deliberately unpinned: its
    // `visible` carries `ExpressionInputSchema`, whose bare-string arm
    // transforms to the canonical envelope, so input ≠ infer by construction.
    //
    // 836 -> 837 is #8993 — partial masking's `FieldMaskingKeepSchema`
    // ({keepHead, keepTail}, both plain non-negative ints, no defaults, no
    // transform), pinned as `Iso850`.
    //
    // 837 -> 838 is #9340 — the map list-view block (`ListMapConfigSchema`),
    // deliberately default-free: objectui#5000 ruled "declared camera wins, no
    // declaration → fit to the queried records", so a spec-side default
    // zoom/center would read as a declared camera and defeat the fit. Pinned
    // as `Iso851`.
    //
    // 838 -> 839 is #9406 — the batch publish door's
    // `PublishPackageDraftsResponseSchema` (the #7294 move one door over,
    // `Iso836`). Isomorphism MEASURED, not assumed: booleans, strings,
    // `z.number().int()`s, arrays of plain objects, one referenced
    // `RuntimeAuthoringIssueSchema` (itself pinned, `Iso837`) and one
    // `z.unknown()` (`probes`, deliberately opaque by the #9406 ruling) — no
    // `.default()`, `.transform()`, `.catch()` or `.pipe()` anywhere. The
    // absence of `.default()` is load-bearing beyond this pin: the door's
    // byte-stability promise (an advisory-free publish response unchanged by
    // the declaration) relies on parse fabricating nothing. Pinned as
    // `Iso852`, the next free id.
    //
    // 839 -> 840 is #9726 — `GetMetaItemLayeredRequestSchema`, the declared-
    // surface catch-up for the layered read verb: four plain string members
    // (two optional), no `.default()`, `.transform()`, `.catch()` or `.pipe()`,
    // mirroring metadata-protocol's inline parameter type member for member.
    // Pinned as `Iso853`, the next free id.
    //
    // 840 -> 839 is #9925 — `Iso759` (`InlineLocaleMapSchema`) DELETED, on the
    // ADR-0122 gate's own order: the alias is no longer a bare `z.input<…>`
    // derivation but a hand-tied narrowing carried by an explicit
    // `z.ZodType<…>` annotation (which spells the shape structurally, not by
    // the alias name — see the receipt at the pin's former line), so the
    // isomorphism exemption stopped being load-bearing. The first MINUS taken
    // by deletion of a pin whose schema SURVIVES — the earlier minuses retired
    // schemas or converted aliases to `Parsed` pairs; this one moved the
    // input/output identity into the annotation itself, where both halves
    // spell the same type.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const pins = self.match(/^export type Iso\d+ = Assert</gm) ?? [];
    expect(pins).toHaveLength(839);

    // The count is stated in PROSE twice as well — this case's title and the
    // section header above the pin list — and until #6605 nothing read either
    // one. Both had drifted, by different amounts: the header sat 106 behind,
    // the title 68. Correcting them is not the fix, because correcting was
    // already tried on the title once (the receipt at the top of this case)
    // and it drifted a second time. So the prose is recomputed against the
    // same operand as the assertion above: the file.
    //
    // Matched by PHRASE, deliberately, rather than at two fixed line numbers.
    // A sentence a later author writes is then covered the moment it is
    // written — the property a merely-corrected literal does not have, and the
    // reason this is preferred over deleting the numbers outright: a number
    // nobody may state cannot be re-stated wrongly, but a number anybody may
    // state and nobody may state falsely is worth more, and it is the bargain
    // the pins themselves are built on ("an exemption nobody can state falsely
    // is the only kind worth having", top of this file).
    //
    // Everything else above is HISTORY — `749 -> 822`, `-7`,
    // `136 - 17 - 40 - 5 - 1` — and is deliberately NOT matched. Those numbers
    // are true about a past state of the file, and rewriting them to today's
    // count would destroy the receipts. The phrase caught here is the narrow
    // one that can only ever mean "how many pins are in this file right now".
    const stated = [...self.matchAll(/(\d+) isomorphic \w+/g)].map((m) => m[0]);
    // Guard the guard: if a reword leaves nothing matching, the check below
    // passes over an empty list and silently stops existing.
    const phrasingMoved = 'no prose states the pin count any more — has the phrasing moved?';
    expect(stated.length, phrasingMoved).toBeGreaterThanOrEqual(2);
    const wrong = stated.filter((s) => !s.startsWith(`${pins.length} `));
    expect(wrong, `prose disagreeing with the ${pins.length} pins counted above`).toEqual([]);
  });

  it('leaves the A-family parse behaviour untouched', () => {
    const parsed = RetryPolicySchema.parse({});
    expect(parsed.maxRetries).toBe(0);
    expect(parsed.backoffMs).toBe(1000);
    expect(parsed.jitter).toBe(false);
  });

  it('changes no runtime behaviour — only which type name describes it', () => {
    // Phase 2 is a TYPE-only change: 1384 aliases moved from `z.infer` to
    // `z.input` and 102 `XInput` synonyms were deleted. Not one `.parse()` call,
    // default, transform or schema moved, so the values below are byte-for-byte
    // what phase 1 asserted — the difference is that `ConnectorParsed`, not
    // `Connector`, is now the name that describes them. `ConnectorInput`, which
    // used to be the name for what `Connector` means today, is gone.
    expect(typeof ConnectorSchema.parse).toBe('function');
    const parsedConnector: ConnectorParsed = ConnectorSchema.parse({
      name: 'acme_erp',
      label: 'Acme ERP',
      type: 'saas',
    });
    expect(parsedConnector.enabled).toBe(true);
    expect(parsedConnector.status).toBe('inactive');

    // And the flip's whole point, stated at runtime: the three keys above are
    // everything an author has to write, and the bare name is the type that
    // accepts exactly that.
    const authored: Connector = { name: 'acme_erp', label: 'Acme ERP', type: 'saas' };
    expect(ConnectorSchema.parse(authored).enabled).toBe(true);
  });
});

