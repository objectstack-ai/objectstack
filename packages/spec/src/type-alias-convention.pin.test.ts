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
// reason — phase 2 grew it by 35 for a reason recorded at the head of the list.
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
import type * as M50 from './marketplace/marketplace.zod.js';
import type * as M51 from './marketplace/package-version.zod.js';
import type * as M52 from './marketplace/package.zod.js';
import type * as M53 from './marketplace/template-manifest.zod.js';
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
// (M86 was kernel/metadata-customization.zod.js, removed whole in #13135 —
// ADR-0049 retirement of the paper customization protocol. The M number is
// positional and stays vacant.)
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
import type * as M186 from './automation/schedule-organization.zod.js';
import type * as M114 from './shared/metadata-types.zod.js';
import type * as M115 from './shared/protection.zod.js';
import type * as M116 from './stack.zod.js';
import type * as M117 from './studio/flow-builder.zod.js';
import type * as M118 from './studio/object-designer.zod.js';
import type * as M119 from './studio/plugin.zod.js';
import type * as M120 from './system/auth-config.zod.js';
import type * as M121 from './system/cache.zod.js';
// M122 was './system/change-management.zod.js' — the change-management family retired whole at
// #15513 (ADR-0049); the M-indices are positional, so the slot stays vacant.
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
// M133 was './system/incident-response.zod.js' — the incident-response family retired whole at
// #15513 (ADR-0049); the M-indices are positional, so the slot stays vacant.
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
// M151 was './system/training.zod.js' — the training family retired whole at
// #15513 (ADR-0049); the M-indices are positional, so the slot stays vacant.
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
// M166 was './ui/theme.zod.js' — retired whole at #10485 (ADR-0049); the
// M-indices are positional, so the slot stays vacant rather than renumbering.
import type * as M167 from './ui/view.zod.js';
// Appended out of alphabetical order deliberately: the M-indices are positional
// identifiers the pin lines below reference by number, so a new module takes the
// next free index rather than renumbering 169 imports and every pin that names
// one. #5775 is the first entry from this file — `component.zod.ts` had no bare
// `X = z.infer` alias until `PageContainerProps` arrived.
import type * as M170 from './ui/component.zod.js';
// [#10235] The served sortability projection — new module, next free index.
import type * as M183 from './api/sortability.zod.js';
import type * as M184 from './shared/value-domain.zod.js';
// [#15676] The shared epoch-millisecond instant — new module, next free index.
import type * as M185 from './shared/epoch.zod.js';
// [#18122] The closed duration vocabulary beside that instant — new module,
// next free index (M186 is `automation/schedule-organization.zod.ts`).
import type * as M187 from './shared/duration.zod.js';
// [#18451] The build-progress PHASE vocabulary -- new module, next free index.
import type * as M188 from './ai/build-progress.zod.js';

// ---------------------------------------------------------------------------
// 789 isomorphic aliases: `z.input` === `z.infer`, so no `XParsed` is declared.
//
// That number is machine-checked, not hand-kept. The runtime companion at the
// bottom of this file recomputes the pin count from the source and asserts that
// every sentence stating it — this header and that case's own title — agrees
// (#6605). Before the check existed this line had been left at 717 while the
// list grew past 800, because the counting assertion reads the `export type
// Iso...` declarations and never the prose sitting beside them.
// ---------------------------------------------------------------------------

// How a pin is named, and where it goes. A pin is named for the pair that is
// already unique to it — its module and its schema: `Iso_`, then the module's
// path below `src/` without `.zod.ts`, each kebab segment camelCased and the
// segments joined by `_` (`ai/knowledge-document.zod.ts` becomes
// `ai_knowledgeDocument`), then `__`, then the schema's export name. The block
// is sorted by that name in code-unit order (the order `LC_ALL=C sort` gives),
// one heading per module, and a note about a module's pins sits under its
// heading and names the pins it is about. A new pin's name AND its place are
// therefore functions of the schema alone: two branches that each pin a
// different schema write different lines in different places, and git merges
// them with nobody renumbering anything.
//
// The names used to be a dense counter, `Iso0` up to `Iso881`, each new pin
// taking "the next free number" — so two branches off one base took the SAME
// number for two different schemas, at insertion points hundreds of lines
// apart, and git merged the pair cleanly into two declarations of one name
// (`Iso871`, then `Iso877` / `Iso878`; both are recorded in the history at the
// bottom of this file). #19665 retired the counter. An `IsoNNN` that a note or
// that history still cites is the pin's former name, true of the file when it
// was written. The `Mn` import aliases above keep their positional numbering.
//
// Two cohorts used to head blocks of their own; their pins are now filed under
// their modules like every other pin.
//
// Phase 2 (#6083) additions. These 35 schemas were never in phase 1's
// population: their bare alias already read `z.input` before the flip, so the
// phase-1 gate — which only looked at bare `z.infer` aliases — never asked
// whether their parsed state was named. The inverted gate does ask, and the
// same probe that chose phase 1's split (with the same deliberate control
// assertion, so a vacuous pass could not be mistaken for isomorphism) says
// these 35 coincide. The other 22 it found got an `XParsed` instead.
//
// #4593 — the documented-schema type-alias backfill (2026-08-08). Every schema
// in it already had a published JSON Schema and a reference page, and the
// page's `import type { X }` line was being dropped because no alias carried
// the name (`docs-import-surface.baseline.json`, "no type export"). The
// backfill declares the bare alias; each schema in it measured isomorphic, so
// it takes a pin rather than an `XParsed` synonym — the (RISE) case, and the
// largest single rise this file has taken.

// ai/agent.zod.ts
export type Iso_ai_agent__StructuredOutputFormatSchema = Assert<Eq< z.input< typeof M0.StructuredOutputFormatSchema >, z.infer< typeof M0.StructuredOutputFormatSchema > >>;
export type Iso_ai_agent__TransformPipelineStepSchema = Assert<Eq< z.input< typeof M0.TransformPipelineStepSchema >, z.infer< typeof M0.TransformPipelineStepSchema > >>;

// ai/build-progress.zod.ts -- the closed build-progress PHASE vocabulary
// (#18451, cloud#2172 ruling A) and the frame that carries it. The enum has
// no default and no transform; the frame is a `z.looseObject` whose three
// members are a bare enum and two plain optionals, so both are the (RISE)
// case. The frame pin is the load-bearing one: it is deliberately a FLOOR
// that passes the consumer's own panel fields through untouched, and the day
// someone gives `phase` or `hop` a `.default()` to 'help' a producer that
// omits it, author state and parsed state part company -- this is the line
// that says so by name.
export type Iso_ai_buildProgress__BuildProgressFrameSchema = Assert<Eq< z.input< typeof M188.BuildProgressFrameSchema >, z.infer< typeof M188.BuildProgressFrameSchema > >>;
export type Iso_ai_buildProgress__BuildProgressPhaseSchema = Assert<Eq< z.input< typeof M188.BuildProgressPhaseSchema >, z.infer< typeof M188.BuildProgressPhaseSchema > >>;

// ai/conversation.zod.ts
export type Iso_ai_conversation__ConversationContextSchema = Assert<Eq< z.input< typeof M1.ConversationContextSchema >, z.infer< typeof M1.ConversationContextSchema > >>;
export type Iso_ai_conversation__ConversationSummarySchema = Assert<Eq< z.input< typeof M1.ConversationSummarySchema >, z.infer< typeof M1.ConversationSummarySchema > >>;
export type Iso_ai_conversation__FileContentSchema = Assert<Eq< z.input< typeof M1.FileContentSchema >, z.infer< typeof M1.FileContentSchema > >>;
export type Iso_ai_conversation__FunctionCallSchema = Assert<Eq< z.input< typeof M1.FunctionCallSchema >, z.infer< typeof M1.FunctionCallSchema > >>;
export type Iso_ai_conversation__MessageContentTypeSchema = Assert<Eq< z.input< typeof M1.MessageContentTypeSchema >, z.infer< typeof M1.MessageContentTypeSchema > >>;
export type Iso_ai_conversation__MessagePruningEventSchema = Assert<Eq< z.input< typeof M1.MessagePruningEventSchema >, z.infer< typeof M1.MessagePruningEventSchema > >>;
export type Iso_ai_conversation__MessageRoleSchema = Assert<Eq< z.input< typeof M1.MessageRoleSchema >, z.infer< typeof M1.MessageRoleSchema > >>;
export type Iso_ai_conversation__TextContentSchema = Assert<Eq< z.input< typeof M1.TextContentSchema >, z.infer< typeof M1.TextContentSchema > >>;
export type Iso_ai_conversation__TokenBudgetStrategySchema = Assert<Eq< z.input< typeof M1.TokenBudgetStrategySchema >, z.infer< typeof M1.TokenBudgetStrategySchema > >>;

// ai/embedding.zod.ts
export type Iso_ai_embedding__EmbeddingModelSchema = Assert<Eq< z.input< typeof M2.EmbeddingModelSchema >, z.infer< typeof M2.EmbeddingModelSchema > >>;
export type Iso_ai_embedding__VectorStoreProviderSchema = Assert<Eq< z.input< typeof M2.VectorStoreProviderSchema >, z.infer< typeof M2.VectorStoreProviderSchema > >>;
export type Iso_ai_embedding__VectorStoreSchema = Assert<Eq< z.input< typeof M2.VectorStoreSchema >, z.infer< typeof M2.VectorStoreSchema > >>;

// ai/knowledge-document.zod.ts
export type Iso_ai_knowledgeDocument__KnowledgeChunkSchema = Assert<Eq< z.input< typeof M3.KnowledgeChunkSchema >, z.infer< typeof M3.KnowledgeChunkSchema > >>;
export type Iso_ai_knowledgeDocument__KnowledgeDocumentSchema = Assert<Eq< z.input< typeof M3.KnowledgeDocumentSchema >, z.infer< typeof M3.KnowledgeDocumentSchema > >>;
export type Iso_ai_knowledgeDocument__KnowledgeHitSchema = Assert<Eq< z.input< typeof M3.KnowledgeHitSchema >, z.infer< typeof M3.KnowledgeHitSchema > >>;

// ai/knowledge-source.zod.ts
export type Iso_ai_knowledgeSource__FileKnowledgeSourceSchema = Assert<Eq< z.input< typeof M4.FileKnowledgeSourceSchema >, z.infer< typeof M4.FileKnowledgeSourceSchema > >>;
export type Iso_ai_knowledgeSource__HttpKnowledgeSourceSchema = Assert<Eq< z.input< typeof M4.HttpKnowledgeSourceSchema >, z.infer< typeof M4.HttpKnowledgeSourceSchema > >>;
export type Iso_ai_knowledgeSource__KnowledgeSourceKindSchema = Assert<Eq< z.input< typeof M4.KnowledgeSourceKindSchema >, z.infer< typeof M4.KnowledgeSourceKindSchema > >>;
export type Iso_ai_knowledgeSource__ObjectKnowledgeSourceSchema = Assert<Eq< z.input< typeof M4.ObjectKnowledgeSourceSchema >, z.infer< typeof M4.ObjectKnowledgeSourceSchema > >>;

// ai/mcp.zod.ts
export type Iso_ai_mcp__MCPApprovalPolicySchema = Assert<Eq< z.input< typeof M5.MCPApprovalPolicySchema >, z.infer< typeof M5.MCPApprovalPolicySchema > >>;
export type Iso_ai_mcp__MCPTransportSchema = Assert<Eq< z.input< typeof M5.MCPTransportSchema >, z.infer< typeof M5.MCPTransportSchema > >>;

// ai/model-registry.zod.ts
export type Iso_ai_modelRegistry__ModelLimitsSchema = Assert<Eq< z.input< typeof M6.ModelLimitsSchema >, z.infer< typeof M6.ModelLimitsSchema > >>;
export type Iso_ai_modelRegistry__ModelProviderSchema = Assert<Eq< z.input< typeof M6.ModelProviderSchema >, z.infer< typeof M6.ModelProviderSchema > >>;

// ai/skill.zod.ts
export type Iso_ai_skill__SkillTriggerConditionSchema = Assert<Eq< z.input< typeof M7.SkillTriggerConditionSchema >, z.infer< typeof M7.SkillTriggerConditionSchema > >>;

// ai/solution-blueprint.zod.ts
export type Iso_ai_solutionBlueprint__BlueprintConditionSchema = Assert<Eq< z.input< typeof M8.BlueprintConditionSchema >, z.infer< typeof M8.BlueprintConditionSchema > >>;
export type Iso_ai_solutionBlueprint__BlueprintDashboardSchema = Assert<Eq< z.input< typeof M8.BlueprintDashboardSchema >, z.infer< typeof M8.BlueprintDashboardSchema > >>;
export type Iso_ai_solutionBlueprint__BlueprintFieldSchema = Assert<Eq< z.input< typeof M8.BlueprintFieldSchema >, z.infer< typeof M8.BlueprintFieldSchema > >>;
export type Iso_ai_solutionBlueprint__BlueprintObjectSchema = Assert<Eq< z.input< typeof M8.BlueprintObjectSchema >, z.infer< typeof M8.BlueprintObjectSchema > >>;
export type Iso_ai_solutionBlueprint__BlueprintSeedSchema = Assert<Eq< z.input< typeof M8.BlueprintSeedSchema >, z.infer< typeof M8.BlueprintSeedSchema > >>;
export type Iso_ai_solutionBlueprint__BlueprintSummaryOperationsSchema = Assert<Eq< z.input< typeof M8.BlueprintSummaryOperationsSchema >, z.infer< typeof M8.BlueprintSummaryOperationsSchema > >>;
export type Iso_ai_solutionBlueprint__BlueprintWidgetConditionSchema = Assert<Eq< z.input< typeof M8.BlueprintWidgetConditionSchema >, z.infer< typeof M8.BlueprintWidgetConditionSchema > >>;
export type Iso_ai_solutionBlueprint__SolutionBlueprintStrictSchema = Assert<Eq< z.input< typeof M8.SolutionBlueprintStrictSchema >, z.infer< typeof M8.SolutionBlueprintStrictSchema > >>;

// ai/tool.zod.ts
export type Iso_ai_tool__ToolSchema = Assert<Eq< z.input< typeof M9.ToolSchema >, z.infer< typeof M9.ToolSchema > >>;

// ai/usage.zod.ts
export type Iso_ai_usage__AIUsageRecordSchema = Assert<Eq< z.input< typeof M10.AIUsageRecordSchema >, z.infer< typeof M10.AIUsageRecordSchema > >>;
export type Iso_ai_usage__TokenUsageSchema = Assert<Eq< z.input< typeof M10.TokenUsageSchema >, z.infer< typeof M10.TokenUsageSchema > >>;

// api/analytics.zod.ts
// [#17551] The ADR-0021 dataset selection (`DatasetSelectionSchema`) and its two
// nested directives (`DatasetCompareToSchema`, `DatasetTotalsSchema`). Their
// seven shared members ARE `AnalyticsQuerySchema`'s own declarations
// (`Iso_data_analytics__AnalyticsQuerySchema` pins that schema isomorphic), and
// the four dataset-only members carry no default, transform, catch or pipe — so
// the author state and the parsed state coincide and no `XParsed` name would be
// anything but a synonym.
export type Iso_api_analytics__AnalyticsEndpoint = Assert<Eq< z.input< typeof M11.AnalyticsEndpoint >, z.infer< typeof M11.AnalyticsEndpoint > >>;
export type Iso_api_analytics__AnalyticsQueryRequestSchema = Assert<Eq< z.input< typeof M11.AnalyticsQueryRequestSchema >, z.infer< typeof M11.AnalyticsQueryRequestSchema > >>;
export type Iso_api_analytics__DatasetCompareToSchema = Assert<Eq< z.input< typeof M11.DatasetCompareToSchema >, z.infer< typeof M11.DatasetCompareToSchema > >>;
export type Iso_api_analytics__DatasetSelectionSchema = Assert<Eq< z.input< typeof M11.DatasetSelectionSchema >, z.infer< typeof M11.DatasetSelectionSchema > >>;
export type Iso_api_analytics__DatasetTotalsSchema = Assert<Eq< z.input< typeof M11.DatasetTotalsSchema >, z.infer< typeof M11.DatasetTotalsSchema > >>;
export type Iso_api_analytics__GetAnalyticsMetaRequestSchema = Assert<Eq< z.input< typeof M11.GetAnalyticsMetaRequestSchema >, z.infer< typeof M11.GetAnalyticsMetaRequestSchema > >>;

// api/auth-endpoints.zod.ts
export type Iso_api_authEndpoints__AuthEndpointSchema = Assert<Eq< z.input< typeof M12.AuthEndpointSchema >, z.infer< typeof M12.AuthEndpointSchema > >>;
export type Iso_api_authEndpoints__DeviceTokenResponseSchema = Assert<Eq< z.input< typeof M12.DeviceTokenResponseSchema >, z.infer< typeof M12.DeviceTokenResponseSchema > >>;
export type Iso_api_authEndpoints__EmailPasswordConfigPublicSchema = Assert<Eq< z.input< typeof M12.EmailPasswordConfigPublicSchema >, z.infer< typeof M12.EmailPasswordConfigPublicSchema > >>;

// api/auth.zod.ts
export type Iso_api_auth__AuthProvider = Assert<Eq< z.input< typeof M13.AuthProvider >, z.infer< typeof M13.AuthProvider > >>;
export type Iso_api_auth__LoginType = Assert<Eq< z.input< typeof M13.LoginType >, z.infer< typeof M13.LoginType > >>;
export type Iso_api_auth__RefreshTokenRequestSchema = Assert<Eq< z.input< typeof M13.RefreshTokenRequestSchema >, z.infer< typeof M13.RefreshTokenRequestSchema > >>;
export type Iso_api_auth__RegisterRequestSchema = Assert<Eq< z.input< typeof M13.RegisterRequestSchema >, z.infer< typeof M13.RegisterRequestSchema > >>;
export type Iso_api_auth__SessionSchema = Assert<Eq< z.input< typeof M13.SessionSchema >, z.infer< typeof M13.SessionSchema > >>;

// api/automation-api.zod.ts
export type Iso_api_automationApi__AutomationApiErrorCode = Assert<Eq< z.input< typeof M14.AutomationApiErrorCode >, z.infer< typeof M14.AutomationApiErrorCode > >>;
export type Iso_api_automationApi__AutomationFlowPathParamsSchema = Assert<Eq< z.input< typeof M14.AutomationFlowPathParamsSchema >, z.infer< typeof M14.AutomationFlowPathParamsSchema > >>;
export type Iso_api_automationApi__AutomationRunPathParamsSchema = Assert<Eq< z.input< typeof M14.AutomationRunPathParamsSchema >, z.infer< typeof M14.AutomationRunPathParamsSchema > >>;
export type Iso_api_automationApi__DeleteFlowRequestSchema = Assert<Eq< z.input< typeof M14.DeleteFlowRequestSchema >, z.infer< typeof M14.DeleteFlowRequestSchema > >>;
export type Iso_api_automationApi__FlowSummarySchema = Assert<Eq< z.input< typeof M14.FlowSummarySchema >, z.infer< typeof M14.FlowSummarySchema > >>;
export type Iso_api_automationApi__GetFlowRequestSchema = Assert<Eq< z.input< typeof M14.GetFlowRequestSchema >, z.infer< typeof M14.GetFlowRequestSchema > >>;
export type Iso_api_automationApi__GetRunRequestSchema = Assert<Eq< z.input< typeof M14.GetRunRequestSchema >, z.infer< typeof M14.GetRunRequestSchema > >>;
export type Iso_api_automationApi__ToggleFlowRequestSchema = Assert<Eq< z.input< typeof M14.ToggleFlowRequestSchema >, z.infer< typeof M14.ToggleFlowRequestSchema > >>;
export type Iso_api_automationApi__TriggerFlowRequestSchema = Assert<Eq< z.input< typeof M14.TriggerFlowRequestSchema >, z.infer< typeof M14.TriggerFlowRequestSchema > >>;

// api/batch.zod.ts
export type Iso_api_batch__BatchOperationType = Assert<Eq< z.input< typeof M15.BatchOperationType >, z.infer< typeof M15.BatchOperationType > >>;
export type Iso_api_batch__BatchRecordSchema = Assert<Eq< z.input< typeof M15.BatchRecordSchema >, z.infer< typeof M15.BatchRecordSchema > >>;
export type Iso_api_batch__CrossObjectBatchDroppedFieldsSchema = Assert<Eq< z.input< typeof M15.CrossObjectBatchDroppedFieldsSchema >, z.infer< typeof M15.CrossObjectBatchDroppedFieldsSchema > >>;
export type Iso_api_batch__CrossObjectBatchResponseSchema = Assert<Eq< z.input< typeof M15.CrossObjectBatchResponseSchema >, z.infer< typeof M15.CrossObjectBatchResponseSchema > >>;
export type Iso_api_batch__UpdateManyRecordSchema = Assert<Eq< z.input< typeof M15.UpdateManyRecordSchema >, z.infer< typeof M15.UpdateManyRecordSchema > >>;

// api/contract.zod.ts
export type Iso_api_contract__CreateRequestSchema = Assert<Eq< z.input< typeof M16.CreateRequestSchema >, z.infer< typeof M16.CreateRequestSchema > >>;
export type Iso_api_contract__IdRequestSchema = Assert<Eq< z.input< typeof M16.IdRequestSchema >, z.infer< typeof M16.IdRequestSchema > >>;
export type Iso_api_contract__RecordDataSchema = Assert<Eq< z.input< typeof M16.RecordDataSchema >, z.infer< typeof M16.RecordDataSchema > >>;
export type Iso_api_contract__UpdateRequestSchema = Assert<Eq< z.input< typeof M16.UpdateRequestSchema >, z.infer< typeof M16.UpdateRequestSchema > >>;

// api/discovery.zod.ts
// [#16325] `EnvironmentTypeSchema` moved here from cloud/environment.zod.ts (was Iso262).
export type Iso_api_discovery__ApiRoutesSchema = Assert<Eq< z.input< typeof M17.ApiRoutesSchema >, z.infer< typeof M17.ApiRoutesSchema > >>;
export type Iso_api_discovery__CapabilityDescriptorSchema = Assert<Eq< z.input< typeof M17.CapabilityDescriptorSchema >, z.infer< typeof M17.CapabilityDescriptorSchema > >>;
export type Iso_api_discovery__DiscoveryEnvironmentSchema = Assert<Eq< z.input< typeof M17.DiscoveryEnvironmentSchema >, z.infer< typeof M17.DiscoveryEnvironmentSchema > >>;
export type Iso_api_discovery__DiscoverySchema = Assert<Eq< z.input< typeof M17.DiscoverySchema >, z.infer< typeof M17.DiscoverySchema > >>;
export type Iso_api_discovery__EnvironmentTypeSchema = Assert<Eq< z.input< typeof M17.EnvironmentTypeSchema >, z.infer< typeof M17.EnvironmentTypeSchema > >>;
export type Iso_api_discovery__RouteHealthEntrySchema = Assert<Eq< z.input< typeof M17.RouteHealthEntrySchema >, z.infer< typeof M17.RouteHealthEntrySchema > >>;
export type Iso_api_discovery__RouteHealthReportSchema = Assert<Eq< z.input< typeof M17.RouteHealthReportSchema >, z.infer< typeof M17.RouteHealthReportSchema > >>;
export type Iso_api_discovery__ServiceInfoSchema = Assert<Eq< z.input< typeof M17.ServiceInfoSchema >, z.infer< typeof M17.ServiceInfoSchema > >>;
export type Iso_api_discovery__ServiceSelfInfoSchema = Assert<Eq< z.input< typeof M17.ServiceSelfInfoSchema >, z.infer< typeof M17.ServiceSelfInfoSchema > >>;
export type Iso_api_discovery__ServiceStatus = Assert<Eq< z.input< typeof M17.ServiceStatus >, z.infer< typeof M17.ServiceStatus > >>;
export type Iso_api_discovery__WellKnownCapabilitiesSchema = Assert<Eq< z.input< typeof M17.WellKnownCapabilitiesSchema >, z.infer< typeof M17.WellKnownCapabilitiesSchema > >>;

// api/dispatcher.zod.ts
export type Iso_api_dispatcher__DispatcherErrorCode = Assert<Eq< z.input< typeof M18.DispatcherErrorCode >, z.infer< typeof M18.DispatcherErrorCode > >>;
export type Iso_api_dispatcher__DispatcherErrorResponseSchema = Assert<Eq< z.input< typeof M18.DispatcherErrorResponseSchema >, z.infer< typeof M18.DispatcherErrorResponseSchema > >>;

// api/documentation.zod.ts
export type Iso_api_documentation__ApiTestingUiType = Assert<Eq< z.input< typeof M19.ApiTestingUiType >, z.infer< typeof M19.ApiTestingUiType > >>;
export type Iso_api_documentation__CodeGenerationTemplateSchema = Assert<Eq< z.input< typeof M19.CodeGenerationTemplateSchema >, z.infer< typeof M19.CodeGenerationTemplateSchema > >>;
export type Iso_api_documentation__OpenApiSecuritySchemeSchema = Assert<Eq< z.input< typeof M19.OpenApiSecuritySchemeSchema >, z.infer< typeof M19.OpenApiSecuritySchemeSchema > >>;
export type Iso_api_documentation__OpenApiServerSchema = Assert<Eq< z.input< typeof M19.OpenApiServerSchema >, z.infer< typeof M19.OpenApiServerSchema > >>;

// api/endpoint.zod.ts
export type Iso_api_endpoint__ApiMappingSchema = Assert<Eq< z.input< typeof M174.ApiMappingSchema >, z.infer< typeof M174.ApiMappingSchema > >>;

// api/error-code-ledger.zod.ts
export type Iso_api_errorCodeLedger__ProvenanceWaiverSchema = Assert<Eq< z.input< typeof M182.ProvenanceWaiverSchema >, z.infer< typeof M182.ProvenanceWaiverSchema > >>;
export type Iso_api_errorCodeLedger__StandardSynonymWaiverSchema = Assert<Eq< z.input< typeof M182.StandardSynonymWaiverSchema >, z.infer< typeof M182.StandardSynonymWaiverSchema > >>;

// api/errors.zod.ts
export type Iso_api_errors__ErrorCategory = Assert<Eq< z.input< typeof M20.ErrorCategory >, z.infer< typeof M20.ErrorCategory > >>;
export type Iso_api_errors__FieldErrorCode = Assert<Eq< z.input< typeof M20.FieldErrorCode >, z.infer< typeof M20.FieldErrorCode > >>;
export type Iso_api_errors__FieldErrorSchema = Assert<Eq< z.input< typeof M20.FieldErrorSchema >, z.infer< typeof M20.FieldErrorSchema > >>;
export type Iso_api_errors__RetryStrategy = Assert<Eq< z.input< typeof M20.RetryStrategy >, z.infer< typeof M20.RetryStrategy > >>;
export type Iso_api_errors__StandardErrorCode = Assert<Eq< z.input< typeof M20.StandardErrorCode >, z.infer< typeof M20.StandardErrorCode > >>;

// api/events.zod.ts
export type Iso_api_events__BulkDataEventSchema = Assert<Eq< z.input< typeof M21.BulkDataEventSchema >, z.infer< typeof M21.BulkDataEventSchema > >>;
export type Iso_api_events__BulkDataEventType = Assert<Eq< z.input< typeof M21.BulkDataEventType >, z.infer< typeof M21.BulkDataEventType > >>;
export type Iso_api_events__DataEventSchema = Assert<Eq< z.input< typeof M21.DataEventSchema >, z.infer< typeof M21.DataEventSchema > >>;
export type Iso_api_events__DataEventType = Assert<Eq< z.input< typeof M21.DataEventType >, z.infer< typeof M21.DataEventType > >>;
export type Iso_api_events__MetadataEventSchema = Assert<Eq< z.input< typeof M21.MetadataEventSchema >, z.infer< typeof M21.MetadataEventSchema > >>;
export type Iso_api_events__MetadataEventType = Assert<Eq< z.input< typeof M21.MetadataEventType >, z.infer< typeof M21.MetadataEventType > >>;

// api/export.zod.ts
export type Iso_api_export__CreateImportJobResponseSchema = Assert<Eq< z.input< typeof M22.CreateImportJobResponseSchema >, z.infer< typeof M22.CreateImportJobResponseSchema > >>;
export type Iso_api_export__DeduplicationStrategy = Assert<Eq< z.input< typeof M22.DeduplicationStrategy >, z.infer< typeof M22.DeduplicationStrategy > >>;
export type Iso_api_export__ExportFormat = Assert<Eq< z.input< typeof M22.ExportFormat >, z.infer< typeof M22.ExportFormat > >>;
export type Iso_api_export__ExportJobStatus = Assert<Eq< z.input< typeof M22.ExportJobStatus >, z.infer< typeof M22.ExportJobStatus > >>;
export type Iso_api_export__ExportJobSummarySchema = Assert<Eq< z.input< typeof M22.ExportJobSummarySchema >, z.infer< typeof M22.ExportJobSummarySchema > >>;
export type Iso_api_export__GetExportJobDownloadRequestSchema = Assert<Eq< z.input< typeof M22.GetExportJobDownloadRequestSchema >, z.infer< typeof M22.GetExportJobDownloadRequestSchema > >>;
export type Iso_api_export__ImportJobProgressSchema = Assert<Eq< z.input< typeof M22.ImportJobProgressSchema >, z.infer< typeof M22.ImportJobProgressSchema > >>;
export type Iso_api_export__ImportJobResultsSchema = Assert<Eq< z.input< typeof M22.ImportJobResultsSchema >, z.infer< typeof M22.ImportJobResultsSchema > >>;
export type Iso_api_export__ImportJobStatus = Assert<Eq< z.input< typeof M22.ImportJobStatus >, z.infer< typeof M22.ImportJobStatus > >>;
export type Iso_api_export__ImportJobSummarySchema = Assert<Eq< z.input< typeof M22.ImportJobSummarySchema >, z.infer< typeof M22.ImportJobSummarySchema > >>;
export type Iso_api_export__ImportResponseSchema = Assert<Eq< z.input< typeof M22.ImportResponseSchema >, z.infer< typeof M22.ImportResponseSchema > >>;
export type Iso_api_export__ImportRowResultSchema = Assert<Eq< z.input< typeof M22.ImportRowResultSchema >, z.infer< typeof M22.ImportRowResultSchema > >>;
export type Iso_api_export__ImportValidationMode = Assert<Eq< z.input< typeof M22.ImportValidationMode >, z.infer< typeof M22.ImportValidationMode > >>;
export type Iso_api_export__ImportWriteMode = Assert<Eq< z.input< typeof M22.ImportWriteMode >, z.infer< typeof M22.ImportWriteMode > >>;
export type Iso_api_export__ListImportJobsResponseSchema = Assert<Eq< z.input< typeof M22.ListImportJobsResponseSchema >, z.infer< typeof M22.ListImportJobsResponseSchema > >>;
export type Iso_api_export__UndoImportJobResponseSchema = Assert<Eq< z.input< typeof M22.UndoImportJobResponseSchema >, z.infer< typeof M22.UndoImportJobResponseSchema > >>;

// api/http-cache.zod.ts
export type Iso_api_httpCache__CacheControlSchema = Assert<Eq< z.input< typeof M23.CacheControlSchema >, z.infer< typeof M23.CacheControlSchema > >>;
export type Iso_api_httpCache__CacheDirective = Assert<Eq< z.input< typeof M23.CacheDirective >, z.infer< typeof M23.CacheDirective > >>;
export type Iso_api_httpCache__CacheInvalidationResponseSchema = Assert<Eq< z.input< typeof M23.CacheInvalidationResponseSchema >, z.infer< typeof M23.CacheInvalidationResponseSchema > >>;
export type Iso_api_httpCache__CacheInvalidationTarget = Assert<Eq< z.input< typeof M23.CacheInvalidationTarget >, z.infer< typeof M23.CacheInvalidationTarget > >>;
export type Iso_api_httpCache__MetadataCacheRequestSchema = Assert<Eq< z.input< typeof M23.MetadataCacheRequestSchema >, z.infer< typeof M23.MetadataCacheRequestSchema > >>;

// api/metadata.zod.ts
export type Iso_api_metadata__MetadataBulkUnregisterRequestSchema = Assert<Eq< z.input< typeof M24.MetadataBulkUnregisterRequestSchema >, z.infer< typeof M24.MetadataBulkUnregisterRequestSchema > >>;
export type Iso_api_metadata__MetadataRegisterRequestSchema = Assert<Eq< z.input< typeof M24.MetadataRegisterRequestSchema >, z.infer< typeof M24.MetadataRegisterRequestSchema > >>;
export type Iso_api_metadata__MetadataValidateRequestSchema = Assert<Eq< z.input< typeof M24.MetadataValidateRequestSchema >, z.infer< typeof M24.MetadataValidateRequestSchema > >>;

// api/odata.zod.ts
export type Iso_api_odata__ODataErrorSchema = Assert<Eq< z.input< typeof M25.ODataErrorSchema >, z.infer< typeof M25.ODataErrorSchema > >>;
export type Iso_api_odata__ODataFilterFunctionSchema = Assert<Eq< z.input< typeof M25.ODataFilterFunctionSchema >, z.infer< typeof M25.ODataFilterFunctionSchema > >>;
export type Iso_api_odata__ODataQuerySchema = Assert<Eq< z.input< typeof M25.ODataQuerySchema >, z.infer< typeof M25.ODataQuerySchema > >>;
export type Iso_api_odata__ODataResponseSchema = Assert<Eq< z.input< typeof M25.ODataResponseSchema >, z.infer< typeof M25.ODataResponseSchema > >>;

// api/package-api.zod.ts
export type Iso_api_packageApi__GetInstalledPackageRequestSchema = Assert<Eq< z.input< typeof M26.GetInstalledPackageRequestSchema >, z.infer< typeof M26.GetInstalledPackageRequestSchema > >>;
export type Iso_api_packageApi__PackageApiErrorCode = Assert<Eq< z.input< typeof M26.PackageApiErrorCode >, z.infer< typeof M26.PackageApiErrorCode > >>;
export type Iso_api_packageApi__PackagePathParamsSchema = Assert<Eq< z.input< typeof M26.PackagePathParamsSchema >, z.infer< typeof M26.PackagePathParamsSchema > >>;
export type Iso_api_packageApi__UninstallPackageApiRequestSchema = Assert<Eq< z.input< typeof M26.UninstallPackageApiRequestSchema >, z.infer< typeof M26.UninstallPackageApiRequestSchema > >>;

// api/plugin-rest-api.zod.ts
export type Iso_api_pluginRestApi__RestApiRouteCategory = Assert<Eq< z.input< typeof M27.RestApiRouteCategory >, z.infer< typeof M27.RestApiRouteCategory > >>;
export type Iso_api_pluginRestApi__ValidationMode = Assert<Eq< z.input< typeof M27.ValidationMode >, z.infer< typeof M27.ValidationMode > >>;

// api/protocol.zod.ts
export type Iso_api_protocol__AiAgentCapabilitiesSchema = Assert<Eq< z.input< typeof M28.AiAgentCapabilitiesSchema >, z.infer< typeof M28.AiAgentCapabilitiesSchema > >>;
export type Iso_api_protocol__AiAgentChatRequestSchema = Assert<Eq< z.input< typeof M28.AiAgentChatRequestSchema >, z.infer< typeof M28.AiAgentChatRequestSchema > >>;
export type Iso_api_protocol__AiAgentSummarySchema = Assert<Eq< z.input< typeof M28.AiAgentSummarySchema >, z.infer< typeof M28.AiAgentSummarySchema > >>;
export type Iso_api_protocol__AiAgentsResponseSchema = Assert<Eq< z.input< typeof M28.AiAgentsResponseSchema >, z.infer< typeof M28.AiAgentsResponseSchema > >>;
export type Iso_api_protocol__AiChatRequestSchema = Assert<Eq< z.input< typeof M28.AiChatRequestSchema >, z.infer< typeof M28.AiChatRequestSchema > >>;
export type Iso_api_protocol__AiChatResponseSchema = Assert<Eq< z.input< typeof M28.AiChatResponseSchema >, z.infer< typeof M28.AiChatResponseSchema > >>;
export type Iso_api_protocol__AiCompleteRequestSchema = Assert<Eq< z.input< typeof M28.AiCompleteRequestSchema >, z.infer< typeof M28.AiCompleteRequestSchema > >>;
export type Iso_api_protocol__AiConversationSchema = Assert<Eq< z.input< typeof M28.AiConversationSchema >, z.infer< typeof M28.AiConversationSchema > >>;
export type Iso_api_protocol__AiMessageSchema = Assert<Eq< z.input< typeof M28.AiMessageSchema >, z.infer< typeof M28.AiMessageSchema > >>;
export type Iso_api_protocol__AiModelsResponseSchema = Assert<Eq< z.input< typeof M28.AiModelsResponseSchema >, z.infer< typeof M28.AiModelsResponseSchema > >>;
export type Iso_api_protocol__AiPendingActionSchema = Assert<Eq< z.input< typeof M28.AiPendingActionSchema >, z.infer< typeof M28.AiPendingActionSchema > >>;
export type Iso_api_protocol__AiPendingActionStatusSchema = Assert<Eq< z.input< typeof M28.AiPendingActionStatusSchema >, z.infer< typeof M28.AiPendingActionStatusSchema > >>;
export type Iso_api_protocol__AiStreamChunkSchema = Assert<Eq< z.input< typeof M28.AiStreamChunkSchema >, z.infer< typeof M28.AiStreamChunkSchema > >>;
export type Iso_api_protocol__ApproveAiPendingActionResponseSchema = Assert<Eq< z.input< typeof M28.ApproveAiPendingActionResponseSchema >, z.infer< typeof M28.ApproveAiPendingActionResponseSchema > >>;
export type Iso_api_protocol__AuditMetaItemRequestSchema = Assert<Eq< z.input< typeof M28.AuditMetaItemRequestSchema >, z.infer< typeof M28.AuditMetaItemRequestSchema > >>;
export type Iso_api_protocol__AuditMetaItemResponseSchema = Assert<Eq< z.input< typeof M28.AuditMetaItemResponseSchema >, z.infer< typeof M28.AuditMetaItemResponseSchema > >>;
export type Iso_api_protocol__AutomationTriggerRequestSchema = Assert<Eq< z.input< typeof M28.AutomationTriggerRequestSchema >, z.infer< typeof M28.AutomationTriggerRequestSchema > >>;
export type Iso_api_protocol__AutomationTriggerResponseSchema = Assert<Eq< z.input< typeof M28.AutomationTriggerResponseSchema >, z.infer< typeof M28.AutomationTriggerResponseSchema > >>;
export type Iso_api_protocol__CheckPermissionRequestSchema = Assert<Eq< z.input< typeof M28.CheckPermissionRequestSchema >, z.infer< typeof M28.CheckPermissionRequestSchema > >>;
export type Iso_api_protocol__CheckPermissionResponseSchema = Assert<Eq< z.input< typeof M28.CheckPermissionResponseSchema >, z.infer< typeof M28.CheckPermissionResponseSchema > >>;
export type Iso_api_protocol__CloneDataResponseSchema = Assert<Eq< z.input< typeof M28.CloneDataResponseSchema >, z.infer< typeof M28.CloneDataResponseSchema > >>;
export type Iso_api_protocol__CreateAiConversationRequestSchema = Assert<Eq< z.input< typeof M28.CreateAiConversationRequestSchema >, z.infer< typeof M28.CreateAiConversationRequestSchema > >>;
export type Iso_api_protocol__CreateDataRequestSchema = Assert<Eq< z.input< typeof M28.CreateDataRequestSchema >, z.infer< typeof M28.CreateDataRequestSchema > >>;
export type Iso_api_protocol__CreateDataResponseSchema = Assert<Eq< z.input< typeof M28.CreateDataResponseSchema >, z.infer< typeof M28.CreateDataResponseSchema > >>;
export type Iso_api_protocol__CreateManyDataRequestSchema = Assert<Eq< z.input< typeof M28.CreateManyDataRequestSchema >, z.infer< typeof M28.CreateManyDataRequestSchema > >>;
export type Iso_api_protocol__CreateManyDataResponseSchema = Assert<Eq< z.input< typeof M28.CreateManyDataResponseSchema >, z.infer< typeof M28.CreateManyDataResponseSchema > >>;
export type Iso_api_protocol__DeleteDataRequestSchema = Assert<Eq< z.input< typeof M28.DeleteDataRequestSchema >, z.infer< typeof M28.DeleteDataRequestSchema > >>;
export type Iso_api_protocol__DeleteDataResponseSchema = Assert<Eq< z.input< typeof M28.DeleteDataResponseSchema >, z.infer< typeof M28.DeleteDataResponseSchema > >>;
export type Iso_api_protocol__DeleteMetaItemRequestSchema = Assert<Eq< z.input< typeof M28.DeleteMetaItemRequestSchema >, z.infer< typeof M28.DeleteMetaItemRequestSchema > >>;
export type Iso_api_protocol__DeleteMetaItemResponseSchema = Assert<Eq< z.input< typeof M28.DeleteMetaItemResponseSchema >, z.infer< typeof M28.DeleteMetaItemResponseSchema > >>;
export type Iso_api_protocol__FindDataResponseSchema = Assert<Eq< z.input< typeof M28.FindDataResponseSchema >, z.infer< typeof M28.FindDataResponseSchema > >>;
export type Iso_api_protocol__GetDataRequestSchema = Assert<Eq< z.input< typeof M28.GetDataRequestSchema >, z.infer< typeof M28.GetDataRequestSchema > >>;
export type Iso_api_protocol__GetDataResponseSchema = Assert<Eq< z.input< typeof M28.GetDataResponseSchema >, z.infer< typeof M28.GetDataResponseSchema > >>;
export type Iso_api_protocol__GetDiscoveryRequestSchema = Assert<Eq< z.input< typeof M28.GetDiscoveryRequestSchema >, z.infer< typeof M28.GetDiscoveryRequestSchema > >>;
export type Iso_api_protocol__GetDiscoveryResponseSchema = Assert<Eq< z.input< typeof M28.GetDiscoveryResponseSchema >, z.infer< typeof M28.GetDiscoveryResponseSchema > >>;
export type Iso_api_protocol__GetEffectivePermissionsRequestSchema = Assert<Eq< z.input< typeof M28.GetEffectivePermissionsRequestSchema >, z.infer< typeof M28.GetEffectivePermissionsRequestSchema > >>;
export type Iso_api_protocol__GetEffectivePermissionsResponseSchema = Assert<Eq< z.input< typeof M28.GetEffectivePermissionsResponseSchema >, z.infer< typeof M28.GetEffectivePermissionsResponseSchema > >>;
export type Iso_api_protocol__GetFieldLabelsRequestSchema = Assert<Eq< z.input< typeof M28.GetFieldLabelsRequestSchema >, z.infer< typeof M28.GetFieldLabelsRequestSchema > >>;
export type Iso_api_protocol__GetFieldLabelsResponseSchema = Assert<Eq< z.input< typeof M28.GetFieldLabelsResponseSchema >, z.infer< typeof M28.GetFieldLabelsResponseSchema > >>;
export type Iso_api_protocol__GetLocalesRequestSchema = Assert<Eq< z.input< typeof M28.GetLocalesRequestSchema >, z.infer< typeof M28.GetLocalesRequestSchema > >>;
export type Iso_api_protocol__GetMetaItemCachedRequestSchema = Assert<Eq< z.input< typeof M28.GetMetaItemCachedRequestSchema >, z.infer< typeof M28.GetMetaItemCachedRequestSchema > >>;
export type Iso_api_protocol__GetMetaItemLayeredRequestSchema = Assert<Eq< z.input< typeof M28.GetMetaItemLayeredRequestSchema >, z.infer< typeof M28.GetMetaItemLayeredRequestSchema > >>;
export type Iso_api_protocol__GetMetaItemLayeredResponseSchema = Assert<Eq< z.input< typeof M28.GetMetaItemLayeredResponseSchema >, z.infer< typeof M28.GetMetaItemLayeredResponseSchema > >>;
export type Iso_api_protocol__GetMetaItemRequestSchema = Assert<Eq< z.input< typeof M28.GetMetaItemRequestSchema >, z.infer< typeof M28.GetMetaItemRequestSchema > >>;
export type Iso_api_protocol__GetMetaItemResponseSchema = Assert<Eq< z.input< typeof M28.GetMetaItemResponseSchema >, z.infer< typeof M28.GetMetaItemResponseSchema > >>;
export type Iso_api_protocol__GetMetaItemsRequestSchema = Assert<Eq< z.input< typeof M28.GetMetaItemsRequestSchema >, z.infer< typeof M28.GetMetaItemsRequestSchema > >>;
export type Iso_api_protocol__GetMetaItemsResponseSchema = Assert<Eq< z.input< typeof M28.GetMetaItemsResponseSchema >, z.infer< typeof M28.GetMetaItemsResponseSchema > >>;
export type Iso_api_protocol__GetMetaTypesRequestSchema = Assert<Eq< z.input< typeof M28.GetMetaTypesRequestSchema >, z.infer< typeof M28.GetMetaTypesRequestSchema > >>;
export type Iso_api_protocol__GetMetaTypesResponseSchema = Assert<Eq< z.input< typeof M28.GetMetaTypesResponseSchema >, z.infer< typeof M28.GetMetaTypesResponseSchema > >>;
export type Iso_api_protocol__GetNotificationPreferencesRequestSchema = Assert<Eq< z.input< typeof M28.GetNotificationPreferencesRequestSchema >, z.infer< typeof M28.GetNotificationPreferencesRequestSchema > >>;
export type Iso_api_protocol__GetObjectPermissionsRequestSchema = Assert<Eq< z.input< typeof M28.GetObjectPermissionsRequestSchema >, z.infer< typeof M28.GetObjectPermissionsRequestSchema > >>;
export type Iso_api_protocol__GetPresenceRequestSchema = Assert<Eq< z.input< typeof M28.GetPresenceRequestSchema >, z.infer< typeof M28.GetPresenceRequestSchema > >>;
export type Iso_api_protocol__GetPresenceResponseSchema = Assert<Eq< z.input< typeof M28.GetPresenceResponseSchema >, z.infer< typeof M28.GetPresenceResponseSchema > >>;
export type Iso_api_protocol__GetTranslationsRequestSchema = Assert<Eq< z.input< typeof M28.GetTranslationsRequestSchema >, z.infer< typeof M28.GetTranslationsRequestSchema > >>;
export type Iso_api_protocol__GetTranslationsResponseSchema = Assert<Eq< z.input< typeof M28.GetTranslationsResponseSchema >, z.infer< typeof M28.GetTranslationsResponseSchema > >>;
export type Iso_api_protocol__GetUiViewRequestSchema = Assert<Eq< z.input< typeof M28.GetUiViewRequestSchema >, z.infer< typeof M28.GetUiViewRequestSchema > >>;
export type Iso_api_protocol__HistoryMetaItemRequestSchema = Assert<Eq< z.input< typeof M28.HistoryMetaItemRequestSchema >, z.infer< typeof M28.HistoryMetaItemRequestSchema > >>;
export type Iso_api_protocol__HistoryMetaItemResponseSchema = Assert<Eq< z.input< typeof M28.HistoryMetaItemResponseSchema >, z.infer< typeof M28.HistoryMetaItemResponseSchema > >>;
export type Iso_api_protocol__ListAiConversationsRequestSchema = Assert<Eq< z.input< typeof M28.ListAiConversationsRequestSchema >, z.infer< typeof M28.ListAiConversationsRequestSchema > >>;
export type Iso_api_protocol__ListAiConversationsResponseSchema = Assert<Eq< z.input< typeof M28.ListAiConversationsResponseSchema >, z.infer< typeof M28.ListAiConversationsResponseSchema > >>;
export type Iso_api_protocol__ListAiPendingActionsRequestSchema = Assert<Eq< z.input< typeof M28.ListAiPendingActionsRequestSchema >, z.infer< typeof M28.ListAiPendingActionsRequestSchema > >>;
export type Iso_api_protocol__ListAiPendingActionsResponseSchema = Assert<Eq< z.input< typeof M28.ListAiPendingActionsResponseSchema >, z.infer< typeof M28.ListAiPendingActionsResponseSchema > >>;
export type Iso_api_protocol__MarkAllNotificationsReadRequestSchema = Assert<Eq< z.input< typeof M28.MarkAllNotificationsReadRequestSchema >, z.infer< typeof M28.MarkAllNotificationsReadRequestSchema > >>;
export type Iso_api_protocol__MarkAllNotificationsReadResponseSchema = Assert<Eq< z.input< typeof M28.MarkAllNotificationsReadResponseSchema >, z.infer< typeof M28.MarkAllNotificationsReadResponseSchema > >>;
export type Iso_api_protocol__MarkNotificationsReadRequestSchema = Assert<Eq< z.input< typeof M28.MarkNotificationsReadRequestSchema >, z.infer< typeof M28.MarkNotificationsReadRequestSchema > >>;
export type Iso_api_protocol__MarkNotificationsReadResponseSchema = Assert<Eq< z.input< typeof M28.MarkNotificationsReadResponseSchema >, z.infer< typeof M28.MarkNotificationsReadResponseSchema > >>;
export type Iso_api_protocol__PublishMetaItemRequestSchema = Assert<Eq< z.input< typeof M28.PublishMetaItemRequestSchema >, z.infer< typeof M28.PublishMetaItemRequestSchema > >>;
export type Iso_api_protocol__PublishMetaItemResponseSchema = Assert<Eq< z.input< typeof M28.PublishMetaItemResponseSchema >, z.infer< typeof M28.PublishMetaItemResponseSchema > >>;
export type Iso_api_protocol__PublishPackageDraftsResponseSchema = Assert<Eq< z.input< typeof M28.PublishPackageDraftsResponseSchema >, z.infer< typeof M28.PublishPackageDraftsResponseSchema > >>;
export type Iso_api_protocol__RealtimeConnectRequestSchema = Assert<Eq< z.input< typeof M28.RealtimeConnectRequestSchema >, z.infer< typeof M28.RealtimeConnectRequestSchema > >>;
export type Iso_api_protocol__RealtimeConnectResponseSchema = Assert<Eq< z.input< typeof M28.RealtimeConnectResponseSchema >, z.infer< typeof M28.RealtimeConnectResponseSchema > >>;
export type Iso_api_protocol__RealtimeDisconnectRequestSchema = Assert<Eq< z.input< typeof M28.RealtimeDisconnectRequestSchema >, z.infer< typeof M28.RealtimeDisconnectRequestSchema > >>;
export type Iso_api_protocol__RealtimeDisconnectResponseSchema = Assert<Eq< z.input< typeof M28.RealtimeDisconnectResponseSchema >, z.infer< typeof M28.RealtimeDisconnectResponseSchema > >>;
export type Iso_api_protocol__RealtimeSubscribeRequestSchema = Assert<Eq< z.input< typeof M28.RealtimeSubscribeRequestSchema >, z.infer< typeof M28.RealtimeSubscribeRequestSchema > >>;
export type Iso_api_protocol__RealtimeSubscribeResponseSchema = Assert<Eq< z.input< typeof M28.RealtimeSubscribeResponseSchema >, z.infer< typeof M28.RealtimeSubscribeResponseSchema > >>;
export type Iso_api_protocol__RealtimeUnsubscribeRequestSchema = Assert<Eq< z.input< typeof M28.RealtimeUnsubscribeRequestSchema >, z.infer< typeof M28.RealtimeUnsubscribeRequestSchema > >>;
export type Iso_api_protocol__RealtimeUnsubscribeResponseSchema = Assert<Eq< z.input< typeof M28.RealtimeUnsubscribeResponseSchema >, z.infer< typeof M28.RealtimeUnsubscribeResponseSchema > >>;
export type Iso_api_protocol__RegisterDeviceRequestSchema = Assert<Eq< z.input< typeof M28.RegisterDeviceRequestSchema >, z.infer< typeof M28.RegisterDeviceRequestSchema > >>;
export type Iso_api_protocol__RegisterDeviceResponseSchema = Assert<Eq< z.input< typeof M28.RegisterDeviceResponseSchema >, z.infer< typeof M28.RegisterDeviceResponseSchema > >>;
export type Iso_api_protocol__RejectAiPendingActionResponseSchema = Assert<Eq< z.input< typeof M28.RejectAiPendingActionResponseSchema >, z.infer< typeof M28.RejectAiPendingActionResponseSchema > >>;
export type Iso_api_protocol__RuntimeAuthoringIssueSchema = Assert<Eq< z.input< typeof M28.RuntimeAuthoringIssueSchema >, z.infer< typeof M28.RuntimeAuthoringIssueSchema > >>;
export type Iso_api_protocol__SaveMetaItemRequestSchema = Assert<Eq< z.input< typeof M28.SaveMetaItemRequestSchema >, z.infer< typeof M28.SaveMetaItemRequestSchema > >>;
export type Iso_api_protocol__SaveMetaItemResponseSchema = Assert<Eq< z.input< typeof M28.SaveMetaItemResponseSchema >, z.infer< typeof M28.SaveMetaItemResponseSchema > >>;
export type Iso_api_protocol__SearchAllHitSchema = Assert<Eq< z.input< typeof M28.SearchAllHitSchema >, z.infer< typeof M28.SearchAllHitSchema > >>;
export type Iso_api_protocol__SearchAllPageHitSchema = Assert<Eq< z.input< typeof M28.SearchAllPageHitSchema >, z.infer< typeof M28.SearchAllPageHitSchema > >>;
export type Iso_api_protocol__SearchAllResponseSchema = Assert<Eq< z.input< typeof M28.SearchAllResponseSchema >, z.infer< typeof M28.SearchAllResponseSchema > >>;
export type Iso_api_protocol__SetPresenceRequestSchema = Assert<Eq< z.input< typeof M28.SetPresenceRequestSchema >, z.infer< typeof M28.SetPresenceRequestSchema > >>;
export type Iso_api_protocol__SetPresenceResponseSchema = Assert<Eq< z.input< typeof M28.SetPresenceResponseSchema >, z.infer< typeof M28.SetPresenceResponseSchema > >>;
export type Iso_api_protocol__UnregisterDeviceRequestSchema = Assert<Eq< z.input< typeof M28.UnregisterDeviceRequestSchema >, z.infer< typeof M28.UnregisterDeviceRequestSchema > >>;
export type Iso_api_protocol__UnregisterDeviceResponseSchema = Assert<Eq< z.input< typeof M28.UnregisterDeviceResponseSchema >, z.infer< typeof M28.UnregisterDeviceResponseSchema > >>;
export type Iso_api_protocol__UpdateAiConversationRequestSchema = Assert<Eq< z.input< typeof M28.UpdateAiConversationRequestSchema >, z.infer< typeof M28.UpdateAiConversationRequestSchema > >>;
export type Iso_api_protocol__UpdateDataRequestSchema = Assert<Eq< z.input< typeof M28.UpdateDataRequestSchema >, z.infer< typeof M28.UpdateDataRequestSchema > >>;
export type Iso_api_protocol__UpdateDataResponseSchema = Assert<Eq< z.input< typeof M28.UpdateDataResponseSchema >, z.infer< typeof M28.UpdateDataResponseSchema > >>;
export type Iso_api_protocol__ValidateDataIssueSchema = Assert<Eq< z.input< typeof M28.ValidateDataIssueSchema >, z.infer< typeof M28.ValidateDataIssueSchema > >>;
export type Iso_api_protocol__ValidateDataRequestSchema = Assert<Eq< z.input< typeof M28.ValidateDataRequestSchema >, z.infer< typeof M28.ValidateDataRequestSchema > >>;
export type Iso_api_protocol__ValidateDataResponseSchema = Assert<Eq< z.input< typeof M28.ValidateDataResponseSchema >, z.infer< typeof M28.ValidateDataResponseSchema > >>;

// api/query-adapter.zod.ts
export type Iso_api_queryAdapter__OperatorMappingSchema = Assert<Eq< z.input< typeof M29.OperatorMappingSchema >, z.infer< typeof M29.OperatorMappingSchema > >>;
export type Iso_api_queryAdapter__QueryAdapterTargetSchema = Assert<Eq< z.input< typeof M29.QueryAdapterTargetSchema >, z.infer< typeof M29.QueryAdapterTargetSchema > >>;

// api/realtime-shared.zod.ts
export type Iso_api_realtimeShared__BasePresenceSchema = Assert<Eq< z.input< typeof M30.BasePresenceSchema >, z.infer< typeof M30.BasePresenceSchema > >>;
export type Iso_api_realtimeShared__PresenceStatus = Assert<Eq< z.input< typeof M30.PresenceStatus >, z.infer< typeof M30.PresenceStatus > >>;
export type Iso_api_realtimeShared__RealtimeRecordAction = Assert<Eq< z.input< typeof M30.RealtimeRecordAction >, z.infer< typeof M30.RealtimeRecordAction > >>;

// api/realtime.zod.ts
export type Iso_api_realtime__RealtimeEventSchema = Assert<Eq< z.input< typeof M31.RealtimeEventSchema >, z.infer< typeof M31.RealtimeEventSchema > >>;
export type Iso_api_realtime__RealtimeEventType = Assert<Eq< z.input< typeof M31.RealtimeEventType >, z.infer< typeof M31.RealtimeEventType > >>;
export type Iso_api_realtime__RealtimePresenceSchema = Assert<Eq< z.input< typeof M31.RealtimePresenceSchema >, z.infer< typeof M31.RealtimePresenceSchema > >>;
export type Iso_api_realtime__SubscriptionEventSchema = Assert<Eq< z.input< typeof M31.SubscriptionEventSchema >, z.infer< typeof M31.SubscriptionEventSchema > >>;
export type Iso_api_realtime__SubscriptionSchema = Assert<Eq< z.input< typeof M31.SubscriptionSchema >, z.infer< typeof M31.SubscriptionSchema > >>;
export type Iso_api_realtime__TransportProtocol = Assert<Eq< z.input< typeof M31.TransportProtocol >, z.infer< typeof M31.TransportProtocol > >>;

// api/rest-server.zod.ts
export type Iso_api_restServer__CrudOperation = Assert<Eq< z.input< typeof M32.CrudOperation >, z.infer< typeof M32.CrudOperation > >>;
export type Iso_api_restServer__EndpointRegistrySchema = Assert<Eq< z.input< typeof M32.EndpointRegistrySchema >, z.infer< typeof M32.EndpointRegistrySchema > >>;
export type Iso_api_restServer__GeneratedEndpointSchema = Assert<Eq< z.input< typeof M32.GeneratedEndpointSchema >, z.infer< typeof M32.GeneratedEndpointSchema > >>;

// api/router.zod.ts
export type Iso_api_router__ConflictResolutionStrategy = Assert<Eq< z.input< typeof M33.ConflictResolutionStrategy >, z.infer< typeof M33.ConflictResolutionStrategy > >>;
export type Iso_api_router__RouteCategory = Assert<Eq< z.input< typeof M33.RouteCategory >, z.infer< typeof M33.RouteCategory > >>;

// [#10235] api/sortability.zod.ts — the served projection carries no defaults
// or transforms by design (it is a serve-time computation, never parsed from
// an author), so input and parsed coincide and the bare aliases stand alone.
export type Iso_api_sortability__FieldSortabilitySchema = Assert<Eq< z.input< typeof M183.FieldSortabilitySchema >, z.infer< typeof M183.FieldSortabilitySchema > >>;
export type Iso_api_sortability__ObjectSortabilitySchema = Assert<Eq< z.input< typeof M183.ObjectSortabilitySchema >, z.infer< typeof M183.ObjectSortabilitySchema > >>;

// api/storage.zod.ts
export type Iso_api_storage__CompleteChunkedUploadRequestSchema = Assert<Eq< z.input< typeof M34.CompleteChunkedUploadRequestSchema >, z.infer< typeof M34.CompleteChunkedUploadRequestSchema > >>;
export type Iso_api_storage__CompleteUploadRequestSchema = Assert<Eq< z.input< typeof M34.CompleteUploadRequestSchema >, z.infer< typeof M34.CompleteUploadRequestSchema > >>;
export type Iso_api_storage__FileTypeValidationSchema = Assert<Eq< z.input< typeof M34.FileTypeValidationSchema >, z.infer< typeof M34.FileTypeValidationSchema > >>;
export type Iso_api_storage__UploadChunkRequestSchema = Assert<Eq< z.input< typeof M34.UploadChunkRequestSchema >, z.infer< typeof M34.UploadChunkRequestSchema > >>;

// api/versioning.zod.ts
export type Iso_api_versioning__VersionDefinitionSchema = Assert<Eq< z.input< typeof M35.VersionDefinitionSchema >, z.infer< typeof M35.VersionDefinitionSchema > >>;
export type Iso_api_versioning__VersionNegotiationResponseSchema = Assert<Eq< z.input< typeof M35.VersionNegotiationResponseSchema >, z.infer< typeof M35.VersionNegotiationResponseSchema > >>;
export type Iso_api_versioning__VersionStatus = Assert<Eq< z.input< typeof M35.VersionStatus >, z.infer< typeof M35.VersionStatus > >>;
export type Iso_api_versioning__VersioningStrategy = Assert<Eq< z.input< typeof M35.VersioningStrategy >, z.infer< typeof M35.VersioningStrategy > >>;

// api/websocket.zod.ts
export type Iso_api_websocket__AckMessageSchema = Assert<Eq< z.input< typeof M36.AckMessageSchema >, z.infer< typeof M36.AckMessageSchema > >>;
export type Iso_api_websocket__CursorMessageSchema = Assert<Eq< z.input< typeof M36.CursorMessageSchema >, z.infer< typeof M36.CursorMessageSchema > >>;
export type Iso_api_websocket__CursorPositionSchema = Assert<Eq< z.input< typeof M36.CursorPositionSchema >, z.infer< typeof M36.CursorPositionSchema > >>;
export type Iso_api_websocket__DocumentStateSchema = Assert<Eq< z.input< typeof M36.DocumentStateSchema >, z.infer< typeof M36.DocumentStateSchema > >>;
export type Iso_api_websocket__EditMessageSchema = Assert<Eq< z.input< typeof M36.EditMessageSchema >, z.infer< typeof M36.EditMessageSchema > >>;
export type Iso_api_websocket__EditOperationSchema = Assert<Eq< z.input< typeof M36.EditOperationSchema >, z.infer< typeof M36.EditOperationSchema > >>;
export type Iso_api_websocket__EditOperationType = Assert<Eq< z.input< typeof M36.EditOperationType >, z.infer< typeof M36.EditOperationType > >>;
export type Iso_api_websocket__ErrorMessageSchema = Assert<Eq< z.input< typeof M36.ErrorMessageSchema >, z.infer< typeof M36.ErrorMessageSchema > >>;
export type Iso_api_websocket__EventMessageSchema = Assert<Eq< z.input< typeof M36.EventMessageSchema >, z.infer< typeof M36.EventMessageSchema > >>;
export type Iso_api_websocket__EventPatternSchema = Assert<Eq< z.input< typeof M36.EventPatternSchema >, z.infer< typeof M36.EventPatternSchema > >>;
export type Iso_api_websocket__EventSubscriptionSchema = Assert<Eq< z.input< typeof M36.EventSubscriptionSchema >, z.infer< typeof M36.EventSubscriptionSchema > >>;
export type Iso_api_websocket__PingMessageSchema = Assert<Eq< z.input< typeof M36.PingMessageSchema >, z.infer< typeof M36.PingMessageSchema > >>;
export type Iso_api_websocket__PongMessageSchema = Assert<Eq< z.input< typeof M36.PongMessageSchema >, z.infer< typeof M36.PongMessageSchema > >>;
export type Iso_api_websocket__PresenceMessageSchema = Assert<Eq< z.input< typeof M36.PresenceMessageSchema >, z.infer< typeof M36.PresenceMessageSchema > >>;
export type Iso_api_websocket__PresenceStateSchema = Assert<Eq< z.input< typeof M36.PresenceStateSchema >, z.infer< typeof M36.PresenceStateSchema > >>;
export type Iso_api_websocket__PresenceUpdateSchema = Assert<Eq< z.input< typeof M36.PresenceUpdateSchema >, z.infer< typeof M36.PresenceUpdateSchema > >>;
export type Iso_api_websocket__SimpleCursorPositionSchema = Assert<Eq< z.input< typeof M36.SimpleCursorPositionSchema >, z.infer< typeof M36.SimpleCursorPositionSchema > >>;
export type Iso_api_websocket__SimplePresenceStateSchema = Assert<Eq< z.input< typeof M36.SimplePresenceStateSchema >, z.infer< typeof M36.SimplePresenceStateSchema > >>;
export type Iso_api_websocket__SubscribeMessageSchema = Assert<Eq< z.input< typeof M36.SubscribeMessageSchema >, z.infer< typeof M36.SubscribeMessageSchema > >>;
export type Iso_api_websocket__UnsubscribeMessageSchema = Assert<Eq< z.input< typeof M36.UnsubscribeMessageSchema >, z.infer< typeof M36.UnsubscribeMessageSchema > >>;
export type Iso_api_websocket__UnsubscribeRequestSchema = Assert<Eq< z.input< typeof M36.UnsubscribeRequestSchema >, z.infer< typeof M36.UnsubscribeRequestSchema > >>;
export type Iso_api_websocket__WebSocketEventSchema = Assert<Eq< z.input< typeof M36.WebSocketEventSchema >, z.infer< typeof M36.WebSocketEventSchema > >>;
export type Iso_api_websocket__WebSocketMessageSchema = Assert<Eq< z.input< typeof M36.WebSocketMessageSchema >, z.infer< typeof M36.WebSocketMessageSchema > >>;
export type Iso_api_websocket__WebSocketMessageType = Assert<Eq< z.input< typeof M36.WebSocketMessageType >, z.infer< typeof M36.WebSocketMessageType > >>;
export type Iso_api_websocket__WebSocketPresenceStatus = Assert<Eq< z.input< typeof M36.WebSocketPresenceStatus >, z.infer< typeof M36.WebSocketPresenceStatus > >>;

// automation/approval.zod.ts
export type Iso_automation_approval__ApprovalDecision = Assert<Eq< z.input< typeof M37.ApprovalDecision >, z.infer< typeof M37.ApprovalDecision > >>;
export type Iso_automation_approval__ApprovalNodeApproverSchema = Assert<Eq< z.input< typeof M37.ApprovalNodeApproverSchema >, z.infer< typeof M37.ApprovalNodeApproverSchema > >>;
export type Iso_automation_approval__ApproverType = Assert<Eq< z.input< typeof M37.ApproverType >, z.infer< typeof M37.ApproverType > >>;
export type Iso_automation_approval__DecisionOutputDefSchema = Assert<Eq< z.input< typeof M37.DecisionOutputDefSchema >, z.infer< typeof M37.DecisionOutputDefSchema > >>;

// automation/bpmn-interop.zod.ts
export type Iso_automation_bpmnInterop__BpmnDiagnosticSchema = Assert<Eq< z.input< typeof M38.BpmnDiagnosticSchema >, z.infer< typeof M38.BpmnDiagnosticSchema > >>;
export type Iso_automation_bpmnInterop__BpmnUnmappedStrategySchema = Assert<Eq< z.input< typeof M38.BpmnUnmappedStrategySchema >, z.infer< typeof M38.BpmnUnmappedStrategySchema > >>;
export type Iso_automation_bpmnInterop__BpmnVersionSchema = Assert<Eq< z.input< typeof M38.BpmnVersionSchema >, z.infer< typeof M38.BpmnVersionSchema > >>;

// automation/builtin-node-config.zod.ts
export type Iso_automation_builtinNodeConfig__ScreenFieldConfigSchema = Assert<Eq< z.input< typeof M172.ScreenFieldConfigSchema >, z.infer< typeof M172.ScreenFieldConfigSchema > >>;

// automation/execution.zod.ts
export type Iso_automation_execution__ExecutionErrorSeverity = Assert<Eq< z.input< typeof M39.ExecutionErrorSeverity >, z.infer< typeof M39.ExecutionErrorSeverity > >>;
export type Iso_automation_execution__ExecutionStatus = Assert<Eq< z.input< typeof M39.ExecutionStatus >, z.infer< typeof M39.ExecutionStatus > >>;
export type Iso_automation_execution__ExecutionStepMetricsSchema = Assert<Eq< z.input< typeof M39.ExecutionStepMetricsSchema >, z.infer< typeof M39.ExecutionStepMetricsSchema > >>;
export type Iso_automation_execution__ExecutionStepSkipReasonSchema = Assert<Eq< z.input< typeof M39.ExecutionStepSkipReasonSchema >, z.infer< typeof M39.ExecutionStepSkipReasonSchema > >>;
export type Iso_automation_execution__FlowRunGateSummarySchema = Assert<Eq< z.input< typeof M39.FlowRunGateSummarySchema >, z.infer< typeof M39.FlowRunGateSummarySchema > >>;
export type Iso_automation_execution__FlowRunNodeSummarySchema = Assert<Eq< z.input< typeof M39.FlowRunNodeSummarySchema >, z.infer< typeof M39.FlowRunNodeSummarySchema > >>;

// automation/flow-function.zod.ts
export type Iso_automation_flowFunction__FlowFunctionEffectSchema = Assert<Eq< z.input< typeof M40.FlowFunctionEffectSchema >, z.infer< typeof M40.FlowFunctionEffectSchema > >>;

// automation/flow.zod.ts
export type Iso_automation_flow__FlowNodeAction = Assert<Eq< z.input< typeof M175.FlowNodeAction >, z.infer< typeof M175.FlowNodeAction > >>;

// automation/node-executor.zod.ts
export type Iso_automation_nodeExecutor__ActionCategorySchema = Assert<Eq< z.input< typeof M41.ActionCategorySchema >, z.infer< typeof M41.ActionCategorySchema > >>;
export type Iso_automation_nodeExecutor__ActionParadigmSchema = Assert<Eq< z.input< typeof M41.ActionParadigmSchema >, z.infer< typeof M41.ActionParadigmSchema > >>;
export type Iso_automation_nodeExecutor__WaitEventTypeSchema = Assert<Eq< z.input< typeof M41.WaitEventTypeSchema >, z.infer< typeof M41.WaitEventTypeSchema > >>;
export type Iso_automation_nodeExecutor__WaitResumePayloadSchema = Assert<Eq< z.input< typeof M41.WaitResumePayloadSchema >, z.infer< typeof M41.WaitResumePayloadSchema > >>;
export type Iso_automation_nodeExecutor__WaitTimeoutBehaviorSchema = Assert<Eq< z.input< typeof M41.WaitTimeoutBehaviorSchema >, z.infer< typeof M41.WaitTimeoutBehaviorSchema > >>;

// automation/schedule-organization.zod.ts
// [#16659] A bare non-empty string: no transform, no default, no coercion — an
// organization id is written exactly as it is stored. So input === infer, and an
// `XParsed` here would be a permanent synonym. The day this schema learns to
// normalize an id, this line goes red and the ADR's remedy applies.
export type Iso_automation_scheduleOrganization__ScheduleOrganizationSchema = Assert<Eq< z.input< typeof M186.ScheduleOrganizationSchema >, z.infer< typeof M186.ScheduleOrganizationSchema > >>;

// automation/schemaless-node-config.zod.ts
export type Iso_automation_schemalessNodeConfig__DecisionConditionSchema = Assert<Eq< z.input< typeof M173.DecisionConditionSchema >, z.infer< typeof M173.DecisionConditionSchema > >>;

// automation/state-machine.zod.ts
export type Iso_automation_stateMachine__ActionRefSchema = Assert<Eq< z.input< typeof M42.ActionRefSchema >, z.infer< typeof M42.ActionRefSchema > >>;
export type Iso_automation_stateMachine__GuardRefSchema = Assert<Eq< z.input< typeof M42.GuardRefSchema >, z.infer< typeof M42.GuardRefSchema > >>;
export type Iso_automation_stateMachine__StateMachineSchema = Assert<Eq< z.input< typeof M42.StateMachineSchema >, z.infer< typeof M42.StateMachineSchema > >>;
export type Iso_automation_stateMachine__StateNodeSchema = Assert<Eq< z.input< typeof M42.StateNodeSchema >, z.infer< typeof M42.StateNodeSchema > >>;
export type Iso_automation_stateMachine__TransitionSchema = Assert<Eq< z.input< typeof M42.TransitionSchema >, z.infer< typeof M42.TransitionSchema > >>;

// automation/time-relative-trigger.zod.ts
export type Iso_automation_timeRelativeTrigger__TimeRelativeTriggerSchema = Assert<Eq< z.input< typeof M43.TimeRelativeTriggerSchema >, z.infer< typeof M43.TimeRelativeTriggerSchema > >>;

// automation/webhook.zod.ts
export type Iso_automation_webhook__WebhookTriggerType = Assert<Eq< z.input< typeof M44.WebhookTriggerType >, z.infer< typeof M44.WebhookTriggerType > >>;

// data/analytics.zod.ts
// [#16041] The closed `timeDimensions[].dateRange` vocabulary:
// `AnalyticsDateRangePresetSchema`, a bare `z.enum` derived from
// `DATE_RANGE_PRESETS`, and `AnalyticsDateRangeSchema`, the union of that enum
// with `z.array(z.string())` — no default, no transform on either arm, so
// author and parsed states coincide.
export type Iso_data_analytics__AggregationMetricType = Assert<Eq< z.input< typeof M55.AggregationMetricType >, z.infer< typeof M55.AggregationMetricType > >>;
export type Iso_data_analytics__AnalyticsDateRangePresetSchema = Assert<Eq< z.input< typeof M55.AnalyticsDateRangePresetSchema >, z.infer< typeof M55.AnalyticsDateRangePresetSchema > >>;
export type Iso_data_analytics__AnalyticsDateRangeSchema = Assert<Eq< z.input< typeof M55.AnalyticsDateRangeSchema >, z.infer< typeof M55.AnalyticsDateRangeSchema > >>;
export type Iso_data_analytics__AnalyticsQuerySchema = Assert<Eq< z.input< typeof M55.AnalyticsQuerySchema >, z.infer< typeof M55.AnalyticsQuerySchema > >>;
export type Iso_data_analytics__DimensionSchema = Assert<Eq< z.input< typeof M55.DimensionSchema >, z.infer< typeof M55.DimensionSchema > >>;
export type Iso_data_analytics__DimensionType = Assert<Eq< z.input< typeof M55.DimensionType >, z.infer< typeof M55.DimensionType > >>;
export type Iso_data_analytics__MetricSchema = Assert<Eq< z.input< typeof M55.MetricSchema >, z.infer< typeof M55.MetricSchema > >>;
export type Iso_data_analytics__TimeUpdateInterval = Assert<Eq< z.input< typeof M55.TimeUpdateInterval >, z.infer< typeof M55.TimeUpdateInterval > >>;

// data/context-tokens.zod.ts
export type Iso_data_contextTokens__ContextTokenPlaceholderSchema = Assert<Eq< z.input< typeof M176.ContextTokenPlaceholderSchema >, z.infer< typeof M176.ContextTokenPlaceholderSchema > >>;

// data/data-engine.zod.ts
export type Iso_data_dataEngine__BaseEngineOptionsSchema = Assert<Eq< z.input< typeof M56.BaseEngineOptionsSchema >, z.infer< typeof M56.BaseEngineOptionsSchema > >>;
export type Iso_data_dataEngine__DataEngineAggregateOptionsSchema = Assert<Eq< z.input< typeof M56.DataEngineAggregateOptionsSchema >, z.infer< typeof M56.DataEngineAggregateOptionsSchema > >>;
export type Iso_data_dataEngine__DataEngineCountOptionsSchema = Assert<Eq< z.input< typeof M56.DataEngineCountOptionsSchema >, z.infer< typeof M56.DataEngineCountOptionsSchema > >>;
export type Iso_data_dataEngine__DataEngineDeleteOptionsSchema = Assert<Eq< z.input< typeof M56.DataEngineDeleteOptionsSchema >, z.infer< typeof M56.DataEngineDeleteOptionsSchema > >>;
export type Iso_data_dataEngine__DataEngineExecuteRequestSchema = Assert<Eq< z.input< typeof M56.DataEngineExecuteRequestSchema >, z.infer< typeof M56.DataEngineExecuteRequestSchema > >>;
export type Iso_data_dataEngine__DataEngineFilterSchema = Assert<Eq< z.input< typeof M56.DataEngineFilterSchema >, z.infer< typeof M56.DataEngineFilterSchema > >>;
export type Iso_data_dataEngine__DataEngineInsertOptionsSchema = Assert<Eq< z.input< typeof M56.DataEngineInsertOptionsSchema >, z.infer< typeof M56.DataEngineInsertOptionsSchema > >>;
export type Iso_data_dataEngine__DataEngineInsertRequestSchema = Assert<Eq< z.input< typeof M56.DataEngineInsertRequestSchema >, z.infer< typeof M56.DataEngineInsertRequestSchema > >>;
export type Iso_data_dataEngine__DataEngineUpdateOptionsSchema = Assert<Eq< z.input< typeof M56.DataEngineUpdateOptionsSchema >, z.infer< typeof M56.DataEngineUpdateOptionsSchema > >>;
export type Iso_data_dataEngine__DataEngineVectorFindRequestSchema = Assert<Eq< z.input< typeof M56.DataEngineVectorFindRequestSchema >, z.infer< typeof M56.DataEngineVectorFindRequestSchema > >>;
export type Iso_data_dataEngine__DroppedFieldsEventSchema = Assert<Eq< z.input< typeof M56.DroppedFieldsEventSchema >, z.infer< typeof M56.DroppedFieldsEventSchema > >>;
export type Iso_data_dataEngine__EngineAggregateOptionsSchema = Assert<Eq< z.input< typeof M56.EngineAggregateOptionsSchema >, z.infer< typeof M56.EngineAggregateOptionsSchema > >>;
export type Iso_data_dataEngine__EngineCountOptionsSchema = Assert<Eq< z.input< typeof M56.EngineCountOptionsSchema >, z.infer< typeof M56.EngineCountOptionsSchema > >>;
export type Iso_data_dataEngine__EngineDeleteOptionsSchema = Assert<Eq< z.input< typeof M56.EngineDeleteOptionsSchema >, z.infer< typeof M56.EngineDeleteOptionsSchema > >>;
export type Iso_data_dataEngine__EngineUpdateOptionsSchema = Assert<Eq< z.input< typeof M56.EngineUpdateOptionsSchema >, z.infer< typeof M56.EngineUpdateOptionsSchema > >>;

// data/datasource.zod.ts
export type Iso_data_datasource__DriverDefinitionSchema = Assert<Eq< z.input< typeof M57.DriverDefinitionSchema >, z.infer< typeof M57.DriverDefinitionSchema > >>;
export type Iso_data_datasource__DriverType = Assert<Eq< z.input< typeof M57.DriverType >, z.infer< typeof M57.DriverType > >>;
export type Iso_data_datasource__SchemaModeSchema = Assert<Eq< z.input< typeof M57.SchemaModeSchema >, z.infer< typeof M57.SchemaModeSchema > >>;

// data/date-macros.zod.ts
export type Iso_data_dateMacros__DateMacroPlaceholderSchema = Assert<Eq< z.input< typeof M177.DateMacroPlaceholderSchema >, z.infer< typeof M177.DateMacroPlaceholderSchema > >>;

// data/driver-nosql.zod.ts
export type Iso_data_driverNosql__AggregationPipelineSchema = Assert<Eq< z.input< typeof M58.AggregationPipelineSchema >, z.infer< typeof M58.AggregationPipelineSchema > >>;
export type Iso_data_driverNosql__AggregationStageSchema = Assert<Eq< z.input< typeof M58.AggregationStageSchema >, z.infer< typeof M58.AggregationStageSchema > >>;
export type Iso_data_driverNosql__ConsistencyLevelSchema = Assert<Eq< z.input< typeof M58.ConsistencyLevelSchema >, z.infer< typeof M58.ConsistencyLevelSchema > >>;
export type Iso_data_driverNosql__NoSQLDataTypeMappingSchema = Assert<Eq< z.input< typeof M58.NoSQLDataTypeMappingSchema >, z.infer< typeof M58.NoSQLDataTypeMappingSchema > >>;
export type Iso_data_driverNosql__NoSQLDatabaseTypeSchema = Assert<Eq< z.input< typeof M58.NoSQLDatabaseTypeSchema >, z.infer< typeof M58.NoSQLDatabaseTypeSchema > >>;
export type Iso_data_driverNosql__NoSQLIndexTypeSchema = Assert<Eq< z.input< typeof M58.NoSQLIndexTypeSchema >, z.infer< typeof M58.NoSQLIndexTypeSchema > >>;
export type Iso_data_driverNosql__NoSQLOperationTypeSchema = Assert<Eq< z.input< typeof M58.NoSQLOperationTypeSchema >, z.infer< typeof M58.NoSQLOperationTypeSchema > >>;
export type Iso_data_driverNosql__NoSQLQueryOptionsSchema = Assert<Eq< z.input< typeof M58.NoSQLQueryOptionsSchema >, z.infer< typeof M58.NoSQLQueryOptionsSchema > >>;
export type Iso_data_driverNosql__NoSQLTransactionOptionsSchema = Assert<Eq< z.input< typeof M58.NoSQLTransactionOptionsSchema >, z.infer< typeof M58.NoSQLTransactionOptionsSchema > >>;

// data/driver-sql.zod.ts
export type Iso_data_driverSql__DataTypeMappingSchema = Assert<Eq< z.input< typeof M59.DataTypeMappingSchema >, z.infer< typeof M59.DataTypeMappingSchema > >>;
export type Iso_data_driverSql__SQLDialectSchema = Assert<Eq< z.input< typeof M59.SQLDialectSchema >, z.infer< typeof M59.SQLDialectSchema > >>;

// data/driver.zod.ts
export type Iso_data_driver__DriverCapabilitiesSchema = Assert<Eq< z.input< typeof M60.DriverCapabilitiesSchema >, z.infer< typeof M60.DriverCapabilitiesSchema > >>;
export type Iso_data_driver__DriverOptionsSchema = Assert<Eq< z.input< typeof M60.DriverOptionsSchema >, z.infer< typeof M60.DriverOptionsSchema > >>;

// data/driver/common.zod.ts
export type Iso_data_driver_common__DriverSslToggleSchema = Assert<Eq< z.input< typeof M61.DriverSslToggleSchema >, z.infer< typeof M61.DriverSslToggleSchema > >>;
export type Iso_data_driver_common__SqlAutoMigrateSchema = Assert<Eq< z.input< typeof M61.SqlAutoMigrateSchema >, z.infer< typeof M61.SqlAutoMigrateSchema > >>;

// data/driver/memory.zod.ts
export type Iso_data_driver_memory__AutoPersistenceConfigSchema = Assert<Eq< z.input< typeof M62.AutoPersistenceConfigSchema >, z.infer< typeof M62.AutoPersistenceConfigSchema > >>;
export type Iso_data_driver_memory__CustomPersistenceConfigSchema = Assert<Eq< z.input< typeof M62.CustomPersistenceConfigSchema >, z.infer< typeof M62.CustomPersistenceConfigSchema > >>;
export type Iso_data_driver_memory__LocalStoragePersistenceConfigSchema = Assert<Eq< z.input< typeof M62.LocalStoragePersistenceConfigSchema >, z.infer< typeof M62.LocalStoragePersistenceConfigSchema > >>;
export type Iso_data_driver_memory__PersistenceAdapterSchema = Assert<Eq< z.input< typeof M62.PersistenceAdapterSchema >, z.infer< typeof M62.PersistenceAdapterSchema > >>;
export type Iso_data_driver_memory__PersistenceTypeSchema = Assert<Eq< z.input< typeof M62.PersistenceTypeSchema >, z.infer< typeof M62.PersistenceTypeSchema > >>;

// data/driver/sqlite.zod.ts
export type Iso_data_driver_sqlite__SqliteWasmPersistModeSchema = Assert<Eq< z.input< typeof M63.SqliteWasmPersistModeSchema >, z.infer< typeof M63.SqliteWasmPersistModeSchema > >>;

// data/driver/turso.zod.ts
export type Iso_data_driver_turso__TursoTransportModeSchema = Assert<Eq< z.input< typeof M181.TursoTransportModeSchema >, z.infer< typeof M181.TursoTransportModeSchema > >>;

// data/external-lookup.zod.ts — retired whole (#8075, ADR-0049); its pin left with it.

// data/feed.zod.ts
export type Iso_data_feed__FeedFilterMode = Assert<Eq< z.input< typeof M65.FeedFilterMode >, z.infer< typeof M65.FeedFilterMode > >>;
export type Iso_data_feed__FeedItemType = Assert<Eq< z.input< typeof M65.FeedItemType >, z.infer< typeof M65.FeedItemType > >>;

// data/field-value.zod.ts
export type Iso_data_fieldValue__AddressValueSchema = Assert<Eq< z.input< typeof M178.AddressValueSchema >, z.infer< typeof M178.AddressValueSchema > >>;
export type Iso_data_fieldValue__CalendarDateValueSchema = Assert<Eq< z.input< typeof M178.CalendarDateValueSchema >, z.infer< typeof M178.CalendarDateValueSchema > >>;
export type Iso_data_fieldValue__ClockTimeValueSchema = Assert<Eq< z.input< typeof M178.ClockTimeValueSchema >, z.infer< typeof M178.ClockTimeValueSchema > >>;
export type Iso_data_fieldValue__FileLikeValueSchema = Assert<Eq< z.input< typeof M178.FileLikeValueSchema >, z.infer< typeof M178.FileLikeValueSchema > >>;
export type Iso_data_fieldValue__FileReferenceIdValueSchema = Assert<Eq< z.input< typeof M178.FileReferenceIdValueSchema >, z.infer< typeof M178.FileReferenceIdValueSchema > >>;
export type Iso_data_fieldValue__FileValueSchema = Assert<Eq< z.input< typeof M178.FileValueSchema >, z.infer< typeof M178.FileValueSchema > >>;
export type Iso_data_fieldValue__InstantValueSchema = Assert<Eq< z.input< typeof M178.InstantValueSchema >, z.infer< typeof M178.InstantValueSchema > >>;
export type Iso_data_fieldValue__LocationValueSchema = Assert<Eq< z.input< typeof M178.LocationValueSchema >, z.infer< typeof M178.LocationValueSchema > >>;
export type Iso_data_fieldValue__ReferenceIdValueSchema = Assert<Eq< z.input< typeof M178.ReferenceIdValueSchema >, z.infer< typeof M178.ReferenceIdValueSchema > >>;

// data/field.zod.ts
// #8993 partial masking (`FieldMaskingKeepSchema`): keepHead/keepTail are plain
// optional-free ints — no transform, no defaults, so input === infer and the
// bare alias needs no Parsed.
export type Iso_data_field__AddressSchema = Assert<Eq< z.input< typeof M66.AddressSchema >, z.infer< typeof M66.AddressSchema > >>;
export type Iso_data_field__CurrencyValueSchema = Assert<Eq< z.input< typeof M66.CurrencyValueSchema >, z.infer< typeof M66.CurrencyValueSchema > >>;
export type Iso_data_field__FieldMaskingKeepSchema = Assert<Eq< z.input< typeof M66.FieldMaskingKeepSchema >, z.infer< typeof M66.FieldMaskingKeepSchema > >>;
export type Iso_data_field__FieldType = Assert<Eq< z.input< typeof M66.FieldType >, z.infer< typeof M66.FieldType > >>;
export type Iso_data_field__LocationCoordinatesSchema = Assert<Eq< z.input< typeof M66.LocationCoordinatesSchema >, z.infer< typeof M66.LocationCoordinatesSchema > >>;

// data/filter.zod.ts
export type Iso_data_filter__FieldOperatorsSchema = Assert<Eq< z.input< typeof M67.FieldOperatorsSchema >, z.infer< typeof M67.FieldOperatorsSchema > >>;
export type Iso_data_filter__FieldReferenceSchema = Assert<Eq< z.input< typeof M67.FieldReferenceSchema >, z.infer< typeof M67.FieldReferenceSchema > >>;
export type Iso_data_filter__QueryFilterSchema = Assert<Eq< z.input< typeof M67.QueryFilterSchema >, z.infer< typeof M67.QueryFilterSchema > >>;

// data/hook-body.zod.ts
export type Iso_data_hookBody__ExpressionBodySchema = Assert<Eq< z.input< typeof M68.ExpressionBodySchema >, z.infer< typeof M68.ExpressionBodySchema > >>;
export type Iso_data_hookBody__HookBodyCapability = Assert<Eq< z.input< typeof M68.HookBodyCapability >, z.infer< typeof M68.HookBodyCapability > >>;

// data/hook.zod.ts
export type Iso_data_hook__HookContextSchema = Assert<Eq< z.input< typeof M69.HookContextSchema >, z.infer< typeof M69.HookContextSchema > >>;
export type Iso_data_hook__HookEvent = Assert<Eq< z.input< typeof M69.HookEvent >, z.infer< typeof M69.HookEvent > >>;

// data/mapping.zod.ts
export type Iso_data_mapping__TransformType = Assert<Eq< z.input< typeof M179.TransformType >, z.infer< typeof M179.TransformType > >>;

// data/object.zod.ts
export type Iso_data_object__ApiMethod = Assert<Eq< z.input< typeof M70.ApiMethod >, z.infer< typeof M70.ApiMethod > >>;
export type Iso_data_object__LifecycleClassSchema = Assert<Eq< z.input< typeof M70.LifecycleClassSchema >, z.infer< typeof M70.LifecycleClassSchema > >>;
export type Iso_data_object__LifecycleSchema = Assert<Eq< z.input< typeof M70.LifecycleSchema >, z.infer< typeof M70.LifecycleSchema > >>;
export type Iso_data_object__ObjectOwnershipEnum = Assert<Eq< z.input< typeof M70.ObjectOwnershipEnum >, z.infer< typeof M70.ObjectOwnershipEnum > >>;
export type Iso_data_object__ObjectRequiredPermissionsSchema = Assert<Eq< z.input< typeof M70.ObjectRequiredPermissionsSchema >, z.infer< typeof M70.ObjectRequiredPermissionsSchema > >>;
export type Iso_data_object__PerOperationRequiredPermissionsSchema = Assert<Eq< z.input< typeof M70.PerOperationRequiredPermissionsSchema >, z.infer< typeof M70.PerOperationRequiredPermissionsSchema > >>;
export type Iso_data_object__TenancyConfigSchema = Assert<Eq< z.input< typeof M70.TenancyConfigSchema >, z.infer< typeof M70.TenancyConfigSchema > >>;

// data/query.zod.ts
export type Iso_data_query__AggregationFunction = Assert<Eq< z.input< typeof M71.AggregationFunction >, z.infer< typeof M71.AggregationFunction > >>;
export type Iso_data_query__AggregationNodeSchema = Assert<Eq< z.input< typeof M71.AggregationNodeSchema >, z.infer< typeof M71.AggregationNodeSchema > >>;
export type Iso_data_query__DateGranularity = Assert<Eq< z.input< typeof M71.DateGranularity >, z.infer< typeof M71.DateGranularity > >>;
export type Iso_data_query__GroupByNodeSchema = Assert<Eq< z.input< typeof M71.GroupByNodeSchema >, z.infer< typeof M71.GroupByNodeSchema > >>;

// data/seed-loader.zod.ts
export type Iso_data_seedLoader__ReferenceResolutionErrorSchema = Assert<Eq< z.input< typeof M72.ReferenceResolutionErrorSchema >, z.infer< typeof M72.ReferenceResolutionErrorSchema > >>;
export type Iso_data_seedLoader__SeedIdentitySchema = Assert<Eq< z.input< typeof M72.SeedIdentitySchema >, z.infer< typeof M72.SeedIdentitySchema > >>;

// data/seed.zod.ts
export type Iso_data_seed__SeedMode = Assert<Eq< z.input< typeof M73.SeedMode >, z.infer< typeof M73.SeedMode > >>;

// data/validation.zod.ts
export type Iso_data_validation__ValidationRuleSchema = Assert<Eq< z.input< typeof M74.ValidationRuleSchema >, z.infer< typeof M74.ValidationRuleSchema > >>;

// identity/identity.zod.ts
export type Iso_identity_identity__AccountSchema = Assert<Eq< z.input< typeof M75.AccountSchema >, z.infer< typeof M75.AccountSchema > >>;
export type Iso_identity_identity__VerificationTokenSchema = Assert<Eq< z.input< typeof M75.VerificationTokenSchema >, z.infer< typeof M75.VerificationTokenSchema > >>;

// identity/organization.zod.ts
export type Iso_identity_organization__InvitationStatus = Assert<Eq< z.input< typeof M76.InvitationStatus >, z.infer< typeof M76.InvitationStatus > >>;
export type Iso_identity_organization__MemberSchema = Assert<Eq< z.input< typeof M76.MemberSchema >, z.infer< typeof M76.MemberSchema > >>;
export type Iso_identity_organization__OrganizationSchema = Assert<Eq< z.input< typeof M76.OrganizationSchema >, z.infer< typeof M76.OrganizationSchema > >>;

// identity/scim.zod.ts
export type Iso_identity_scim__SCIMBulkOperationSchema = Assert<Eq< z.input< typeof M77.SCIMBulkOperationSchema >, z.infer< typeof M77.SCIMBulkOperationSchema > >>;
export type Iso_identity_scim__SCIMBulkResponseOperationSchema = Assert<Eq< z.input< typeof M77.SCIMBulkResponseOperationSchema >, z.infer< typeof M77.SCIMBulkResponseOperationSchema > >>;
export type Iso_identity_scim__SCIMEnterpriseUserSchema = Assert<Eq< z.input< typeof M77.SCIMEnterpriseUserSchema >, z.infer< typeof M77.SCIMEnterpriseUserSchema > >>;
export type Iso_identity_scim__SCIMGroupReferenceSchema = Assert<Eq< z.input< typeof M77.SCIMGroupReferenceSchema >, z.infer< typeof M77.SCIMGroupReferenceSchema > >>;
export type Iso_identity_scim__SCIMMemberReferenceSchema = Assert<Eq< z.input< typeof M77.SCIMMemberReferenceSchema >, z.infer< typeof M77.SCIMMemberReferenceSchema > >>;
export type Iso_identity_scim__SCIMMetaSchema = Assert<Eq< z.input< typeof M77.SCIMMetaSchema >, z.infer< typeof M77.SCIMMetaSchema > >>;
export type Iso_identity_scim__SCIMNameSchema = Assert<Eq< z.input< typeof M77.SCIMNameSchema >, z.infer< typeof M77.SCIMNameSchema > >>;
export type Iso_identity_scim__SCIMPatchOperationSchema = Assert<Eq< z.input< typeof M77.SCIMPatchOperationSchema >, z.infer< typeof M77.SCIMPatchOperationSchema > >>;

// integration/connector.zod.ts
// [#4395] `ConnectorActionEffectSchema`, added after the generated corpus: a
// bare `z.enum`, exactly like its `ConnectorType` / `ConnectorStatus` siblings
// in this module — no default, no transform, so author and parsed states
// coincide and D5 gives it no `XParsed`.
export type Iso_integration_connector__ConnectorActionEffectSchema = Assert<Eq< z.input< typeof M78.ConnectorActionEffectSchema >, z.infer< typeof M78.ConnectorActionEffectSchema > >>;
export type Iso_integration_connector__ConnectorActionSchema = Assert<Eq< z.input< typeof M78.ConnectorActionSchema >, z.infer< typeof M78.ConnectorActionSchema > >>;
export type Iso_integration_connector__ConnectorConflictResolutionSchema = Assert<Eq< z.input< typeof M78.ConnectorConflictResolutionSchema >, z.infer< typeof M78.ConnectorConflictResolutionSchema > >>;
export type Iso_integration_connector__ConnectorRetryStrategySchema = Assert<Eq< z.input< typeof M78.ConnectorRetryStrategySchema >, z.infer< typeof M78.ConnectorRetryStrategySchema > >>;
export type Iso_integration_connector__ConnectorStatusSchema = Assert<Eq< z.input< typeof M78.ConnectorStatusSchema >, z.infer< typeof M78.ConnectorStatusSchema > >>;
export type Iso_integration_connector__ConnectorTriggerSchema = Assert<Eq< z.input< typeof M78.ConnectorTriggerSchema >, z.infer< typeof M78.ConnectorTriggerSchema > >>;
export type Iso_integration_connector__ConnectorTypeSchema = Assert<Eq< z.input< typeof M78.ConnectorTypeSchema >, z.infer< typeof M78.ConnectorTypeSchema > >>;
export type Iso_integration_connector__SyncStrategySchema = Assert<Eq< z.input< typeof M78.SyncStrategySchema >, z.infer< typeof M78.SyncStrategySchema > >>;
export type Iso_integration_connector__WebhookEventSchema = Assert<Eq< z.input< typeof M78.WebhookEventSchema >, z.infer< typeof M78.WebhookEventSchema > >>;
export type Iso_integration_connector__WebhookSignatureAlgorithmSchema = Assert<Eq< z.input< typeof M78.WebhookSignatureAlgorithmSchema >, z.infer< typeof M78.WebhookSignatureAlgorithmSchema > >>;

// kernel/cli-extension.zod.ts
// Iso385 (`CLICommandContributionSchema`) left with the #12007 retirement.
export type Iso_kernel_cliExtension__OclifPluginConfigSchema = Assert<Eq< z.input< typeof M79.OclifPluginConfigSchema >, z.infer< typeof M79.OclifPluginConfigSchema > >>;

// kernel/cluster.zod.ts
export type Iso_kernel_cluster__ClusterDriverSchema = Assert<Eq< z.input< typeof M80.ClusterDriverSchema >, z.infer< typeof M80.ClusterDriverSchema > >>;
export type Iso_kernel_cluster__ClusterTenantIsolationSchema = Assert<Eq< z.input< typeof M80.ClusterTenantIsolationSchema >, z.infer< typeof M80.ClusterTenantIsolationSchema > >>;
export type Iso_kernel_cluster__EventDeliverySemanticsSchema = Assert<Eq< z.input< typeof M80.EventDeliverySemanticsSchema >, z.infer< typeof M80.EventDeliverySemanticsSchema > >>;
export type Iso_kernel_cluster__EventScopeSchema = Assert<Eq< z.input< typeof M80.EventScopeSchema >, z.infer< typeof M80.EventScopeSchema > >>;
export type Iso_kernel_cluster__ServiceClusterScopeSchema = Assert<Eq< z.input< typeof M80.ServiceClusterScopeSchema >, z.infer< typeof M80.ServiceClusterScopeSchema > >>;
export type Iso_kernel_cluster__ServiceLeaderStrategySchema = Assert<Eq< z.input< typeof M80.ServiceLeaderStrategySchema >, z.infer< typeof M80.ServiceLeaderStrategySchema > >>;

// kernel/context.zod.ts
export type Iso_kernel_context__RuntimeMode = Assert<Eq< z.input< typeof M81.RuntimeMode >, z.infer< typeof M81.RuntimeMode > >>;

// kernel/dependency-resolution.zod.ts
export type Iso_kernel_dependencyResolution__DependencyResolutionResultSchema = Assert<Eq< z.input< typeof M82.DependencyResolutionResultSchema >, z.infer< typeof M82.DependencyResolutionResultSchema > >>;
export type Iso_kernel_dependencyResolution__DependencyStatusEnum = Assert<Eq< z.input< typeof M82.DependencyStatusEnum >, z.infer< typeof M82.DependencyStatusEnum > >>;
export type Iso_kernel_dependencyResolution__RequiredActionSchema = Assert<Eq< z.input< typeof M82.RequiredActionSchema >, z.infer< typeof M82.RequiredActionSchema > >>;
export type Iso_kernel_dependencyResolution__ResolvedDependencySchema = Assert<Eq< z.input< typeof M82.ResolvedDependencySchema >, z.infer< typeof M82.ResolvedDependencySchema > >>;

// kernel/events/core.zod.ts
export type Iso_kernel_events_core__EventPriority = Assert<Eq< z.input< typeof M83.EventPriority >, z.infer< typeof M83.EventPriority > >>;

// kernel/events/handlers.zod.ts
export type Iso_kernel_events_handlers__EventRouteSchema = Assert<Eq< z.input< typeof M84.EventRouteSchema >, z.infer< typeof M84.EventRouteSchema > >>;

// kernel/manifest.zod.ts
export type Iso_kernel_manifest__ManifestPermissionsSchema = Assert<Eq< z.input< typeof M85.ManifestPermissionsSchema >, z.infer< typeof M85.ManifestPermissionsSchema > >>;
export type Iso_kernel_manifest__PluginEnginesSchema = Assert<Eq< z.input< typeof M85.PluginEnginesSchema >, z.infer< typeof M85.PluginEnginesSchema > >>;
export type Iso_kernel_manifest__PluginIntegritySchema = Assert<Eq< z.input< typeof M85.PluginIntegritySchema >, z.infer< typeof M85.PluginIntegritySchema > >>;
export type Iso_kernel_manifest__PluginPackagingSchema = Assert<Eq< z.input< typeof M85.PluginPackagingSchema >, z.infer< typeof M85.PluginPackagingSchema > >>;
export type Iso_kernel_manifest__PluginPermissionsSchema = Assert<Eq< z.input< typeof M85.PluginPermissionsSchema >, z.infer< typeof M85.PluginPermissionsSchema > >>;
export type Iso_kernel_manifest__PluginRuntimeSchema = Assert<Eq< z.input< typeof M85.PluginRuntimeSchema >, z.infer< typeof M85.PluginRuntimeSchema > >>;

// kernel/metadata-customization.zod.ts
// (Iso408 `CustomizationOriginSchema` / Iso409 `FieldChangeSchema` /
// Iso410 `MergeConflictSchema` / Iso411 `MergeResultSchema` removed with
// their module — #13135's ADR-0049 retirement of the paper
// metadata-customization protocol.)

// kernel/metadata-loader.zod.ts
export type Iso_kernel_metadataLoader__MetadataFallbackStrategySchema = Assert<Eq< z.input< typeof M87.MetadataFallbackStrategySchema >, z.infer< typeof M87.MetadataFallbackStrategySchema > >>;

// kernel/metadata-plugin.zod.ts
export type Iso_kernel_metadataPlugin__MetadataBulkResultSchema = Assert<Eq< z.input< typeof M88.MetadataBulkResultSchema >, z.infer< typeof M88.MetadataBulkResultSchema > >>;
export type Iso_kernel_metadataPlugin__MetadataDependencySchema = Assert<Eq< z.input< typeof M88.MetadataDependencySchema >, z.infer< typeof M88.MetadataDependencySchema > >>;
export type Iso_kernel_metadataPlugin__MetadataQueryResultSchema = Assert<Eq< z.input< typeof M88.MetadataQueryResultSchema >, z.infer< typeof M88.MetadataQueryResultSchema > >>;
export type Iso_kernel_metadataPlugin__MetadataTypeSchema = Assert<Eq< z.input< typeof M88.MetadataTypeSchema >, z.infer< typeof M88.MetadataTypeSchema > >>;
export type Iso_kernel_metadataPlugin__MetadataValidationResultSchema = Assert<Eq< z.input< typeof M88.MetadataValidationResultSchema >, z.infer< typeof M88.MetadataValidationResultSchema > >>;

// kernel/metadata-protection.zod.ts
export type Iso_kernel_metadataProtection__MetadataLockSchema = Assert<Eq< z.input< typeof M89.MetadataLockSchema >, z.infer< typeof M89.MetadataLockSchema > >>;
export type Iso_kernel_metadataProtection__MetadataLockSourceSchema = Assert<Eq< z.input< typeof M89.MetadataLockSourceSchema >, z.infer< typeof M89.MetadataLockSourceSchema > >>;
export type Iso_kernel_metadataProtection__MetadataProvenanceSchema = Assert<Eq< z.input< typeof M89.MetadataProvenanceSchema >, z.infer< typeof M89.MetadataProvenanceSchema > >>;

// kernel/package-artifact.zod.ts
export type Iso_kernel_packageArtifact__ArtifactFileEntrySchema = Assert<Eq< z.input< typeof M90.ArtifactFileEntrySchema >, z.infer< typeof M90.ArtifactFileEntrySchema > >>;
export type Iso_kernel_packageArtifact__MetadataCategoryEnum = Assert<Eq< z.input< typeof M90.MetadataCategoryEnum >, z.infer< typeof M90.MetadataCategoryEnum > >>;

// kernel/package-registry.zod.ts
export type Iso_kernel_packageRegistry__DisablePackageRequestSchema = Assert<Eq< z.input< typeof M91.DisablePackageRequestSchema >, z.infer< typeof M91.DisablePackageRequestSchema > >>;
export type Iso_kernel_packageRegistry__EnablePackageRequestSchema = Assert<Eq< z.input< typeof M91.EnablePackageRequestSchema >, z.infer< typeof M91.EnablePackageRequestSchema > >>;
export type Iso_kernel_packageRegistry__GetPackageRequestSchema = Assert<Eq< z.input< typeof M91.GetPackageRequestSchema >, z.infer< typeof M91.GetPackageRequestSchema > >>;
export type Iso_kernel_packageRegistry__ListPackagesRequestSchema = Assert<Eq< z.input< typeof M91.ListPackagesRequestSchema >, z.infer< typeof M91.ListPackagesRequestSchema > >>;
export type Iso_kernel_packageRegistry__NamespaceConflictErrorSchema = Assert<Eq< z.input< typeof M91.NamespaceConflictErrorSchema >, z.infer< typeof M91.NamespaceConflictErrorSchema > >>;
export type Iso_kernel_packageRegistry__NamespaceRegistryEntrySchema = Assert<Eq< z.input< typeof M91.NamespaceRegistryEntrySchema >, z.infer< typeof M91.NamespaceRegistryEntrySchema > >>;
export type Iso_kernel_packageRegistry__PackageStatusEnum = Assert<Eq< z.input< typeof M91.PackageStatusEnum >, z.infer< typeof M91.PackageStatusEnum > >>;
export type Iso_kernel_packageRegistry__UninstallPackageRequestSchema = Assert<Eq< z.input< typeof M91.UninstallPackageRequestSchema >, z.infer< typeof M91.UninstallPackageRequestSchema > >>;
export type Iso_kernel_packageRegistry__UninstallPackageResponseSchema = Assert<Eq< z.input< typeof M91.UninstallPackageResponseSchema >, z.infer< typeof M91.UninstallPackageResponseSchema > >>;

// kernel/package-upgrade.zod.ts
export type Iso_kernel_packageUpgrade__MetadataChangeTypeSchema = Assert<Eq< z.input< typeof M92.MetadataChangeTypeSchema >, z.infer< typeof M92.MetadataChangeTypeSchema > >>;
export type Iso_kernel_packageUpgrade__RollbackPackageResponseSchema = Assert<Eq< z.input< typeof M92.RollbackPackageResponseSchema >, z.infer< typeof M92.RollbackPackageResponseSchema > >>;
export type Iso_kernel_packageUpgrade__UpgradeImpactLevelSchema = Assert<Eq< z.input< typeof M92.UpgradeImpactLevelSchema >, z.infer< typeof M92.UpgradeImpactLevelSchema > >>;
export type Iso_kernel_packageUpgrade__UpgradePhaseSchema = Assert<Eq< z.input< typeof M92.UpgradePhaseSchema >, z.infer< typeof M92.UpgradePhaseSchema > >>;

// kernel/plugin-capability.zod.ts
export type Iso_kernel_pluginCapability__CapabilityConformanceLevelSchema = Assert<Eq< z.input< typeof M93.CapabilityConformanceLevelSchema >, z.infer< typeof M93.CapabilityConformanceLevelSchema > >>;
export type Iso_kernel_pluginCapability__ProtocolReferenceSchema = Assert<Eq< z.input< typeof M93.ProtocolReferenceSchema >, z.infer< typeof M93.ProtocolReferenceSchema > >>;
export type Iso_kernel_pluginCapability__ProtocolVersionSchema = Assert<Eq< z.input< typeof M93.ProtocolVersionSchema >, z.infer< typeof M93.ProtocolVersionSchema > >>;

// kernel/plugin-lifecycle-advanced.zod.ts
export type Iso_kernel_pluginLifecycleAdvanced__PluginHealthReportSchema = Assert<Eq< z.input< typeof M94.PluginHealthReportSchema >, z.infer< typeof M94.PluginHealthReportSchema > >>;
export type Iso_kernel_pluginLifecycleAdvanced__PluginHealthStatusSchema = Assert<Eq< z.input< typeof M94.PluginHealthStatusSchema >, z.infer< typeof M94.PluginHealthStatusSchema > >>;

// kernel/plugin-loading.zod.ts
// (Iso441 pinned `PluginLoadingStrategySchema`, removed with the rest of the
// `manifest.loading` block in #4914 — ADR-0049 enforce-or-remove.)
export type Iso_kernel_pluginLoading__PluginLoadingEventSchema = Assert<Eq< z.input< typeof M95.PluginLoadingEventSchema >, z.infer< typeof M95.PluginLoadingEventSchema > >>;

// kernel/plugin-registry.zod.ts
export type Iso_kernel_pluginRegistry__PluginInstallConfigSchema = Assert<Eq< z.input< typeof M96.PluginInstallConfigSchema >, z.infer< typeof M96.PluginInstallConfigSchema > >>;
export type Iso_kernel_pluginRegistry__PluginSearchFiltersSchema = Assert<Eq< z.input< typeof M96.PluginSearchFiltersSchema >, z.infer< typeof M96.PluginSearchFiltersSchema > >>;

// kernel/plugin-security-advanced.zod.ts
export type Iso_kernel_pluginSecurityAdvanced__PermissionActionSchema = Assert<Eq< z.input< typeof M97.PermissionActionSchema >, z.infer< typeof M97.PermissionActionSchema > >>;
export type Iso_kernel_pluginSecurityAdvanced__PermissionScopeSchema = Assert<Eq< z.input< typeof M97.PermissionScopeSchema >, z.infer< typeof M97.PermissionScopeSchema > >>;
export type Iso_kernel_pluginSecurityAdvanced__PluginTrustLevelSchema = Assert<Eq< z.input< typeof M97.PluginTrustLevelSchema >, z.infer< typeof M97.PluginTrustLevelSchema > >>;
export type Iso_kernel_pluginSecurityAdvanced__ResourceTypeSchema = Assert<Eq< z.input< typeof M97.ResourceTypeSchema >, z.infer< typeof M97.ResourceTypeSchema > >>;

// kernel/plugin-security.zod.ts
export type Iso_kernel_pluginSecurity__PackageDependencyConflictSchema = Assert<Eq< z.input< typeof M98.PackageDependencyConflictSchema >, z.infer< typeof M98.PackageDependencyConflictSchema > >>;
export type Iso_kernel_pluginSecurity__VulnerabilitySeverity = Assert<Eq< z.input< typeof M98.VulnerabilitySeverity >, z.infer< typeof M98.VulnerabilitySeverity > >>;

// kernel/plugin-structure.zod.ts
export type Iso_kernel_pluginStructure__OpsDomainModuleSchema = Assert<Eq< z.input< typeof M99.OpsDomainModuleSchema >, z.infer< typeof M99.OpsDomainModuleSchema > >>;
export type Iso_kernel_pluginStructure__OpsFilePathSchema = Assert<Eq< z.input< typeof M99.OpsFilePathSchema >, z.infer< typeof M99.OpsFilePathSchema > >>;
export type Iso_kernel_pluginStructure__OpsPluginStructureSchema = Assert<Eq< z.input< typeof M99.OpsPluginStructureSchema >, z.infer< typeof M99.OpsPluginStructureSchema > >>;

// kernel/plugin-validator.zod.ts
export type Iso_kernel_pluginValidator__PluginMetadataSchema = Assert<Eq< z.input< typeof M100.PluginMetadataSchema >, z.infer< typeof M100.PluginMetadataSchema > >>;
export type Iso_kernel_pluginValidator__ValidationErrorSchema = Assert<Eq< z.input< typeof M100.ValidationErrorSchema >, z.infer< typeof M100.ValidationErrorSchema > >>;
export type Iso_kernel_pluginValidator__ValidationResultSchema = Assert<Eq< z.input< typeof M100.ValidationResultSchema >, z.infer< typeof M100.ValidationResultSchema > >>;
export type Iso_kernel_pluginValidator__ValidationWarningSchema = Assert<Eq< z.input< typeof M100.ValidationWarningSchema >, z.infer< typeof M100.ValidationWarningSchema > >>;

// kernel/plugin-versioning.zod.ts
export type Iso_kernel_pluginVersioning__CompatibilityLevelSchema = Assert<Eq< z.input< typeof M101.CompatibilityLevelSchema >, z.infer< typeof M101.CompatibilityLevelSchema > >>;
export type Iso_kernel_pluginVersioning__DeprecationNoticeSchema = Assert<Eq< z.input< typeof M101.DeprecationNoticeSchema >, z.infer< typeof M101.DeprecationNoticeSchema > >>;
export type Iso_kernel_pluginVersioning__SemanticVersionSchema = Assert<Eq< z.input< typeof M101.SemanticVersionSchema >, z.infer< typeof M101.SemanticVersionSchema > >>;
export type Iso_kernel_pluginVersioning__VersionConstraintSchema = Assert<Eq< z.input< typeof M101.VersionConstraintSchema >, z.infer< typeof M101.VersionConstraintSchema > >>;

// kernel/plugin.zod.ts
export type Iso_kernel_plugin__PluginContextSchema = Assert<Eq< z.input< typeof M102.PluginContextSchema >, z.infer< typeof M102.PluginContextSchema > >>;
export type Iso_kernel_plugin__PluginSchema = Assert<Eq< z.input< typeof M102.PluginSchema >, z.infer< typeof M102.PluginSchema > >>;

// kernel/service-registry.zod.ts
export type Iso_kernel_serviceRegistry__ScopeConfigSchema = Assert<Eq< z.input< typeof M103.ScopeConfigSchema >, z.infer< typeof M103.ScopeConfigSchema > >>;
export type Iso_kernel_serviceRegistry__ScopeInfoSchema = Assert<Eq< z.input< typeof M103.ScopeInfoSchema >, z.infer< typeof M103.ScopeInfoSchema > >>;
export type Iso_kernel_serviceRegistry__ServiceScopeType = Assert<Eq< z.input< typeof M103.ServiceScopeType >, z.infer< typeof M103.ServiceScopeType > >>;

// kernel/startup-orchestrator.zod.ts
export type Iso_kernel_startupOrchestrator__PluginStartupResultSchema = Assert<Eq< z.input< typeof M104.PluginStartupResultSchema >, z.infer< typeof M104.PluginStartupResultSchema > >>;

// marketplace/marketplace.zod.ts
export type Iso_marketplace_marketplace__ArtifactDownloadResponseSchema = Assert<Eq< z.input< typeof M50.ArtifactDownloadResponseSchema >, z.infer< typeof M50.ArtifactDownloadResponseSchema > >>;
export type Iso_marketplace_marketplace__ListingStatusSchema = Assert<Eq< z.input< typeof M50.ListingStatusSchema >, z.infer< typeof M50.ListingStatusSchema > >>;
export type Iso_marketplace_marketplace__MarketplaceCategorySchema = Assert<Eq< z.input< typeof M50.MarketplaceCategorySchema >, z.infer< typeof M50.MarketplaceCategorySchema > >>;
export type Iso_marketplace_marketplace__MarketplaceInstallResponseSchema = Assert<Eq< z.input< typeof M50.MarketplaceInstallResponseSchema >, z.infer< typeof M50.MarketplaceInstallResponseSchema > >>;
export type Iso_marketplace_marketplace__PricingModelSchema = Assert<Eq< z.input< typeof M50.PricingModelSchema >, z.infer< typeof M50.PricingModelSchema > >>;
export type Iso_marketplace_marketplace__PublisherVerificationSchema = Assert<Eq< z.input< typeof M50.PublisherVerificationSchema >, z.infer< typeof M50.PublisherVerificationSchema > >>;

// marketplace/package-version.zod.ts
export type Iso_marketplace_packageVersion__CreatePackageVersionRequestSchema = Assert<Eq< z.input< typeof M51.CreatePackageVersionRequestSchema >, z.infer< typeof M51.CreatePackageVersionRequestSchema > >>;
export type Iso_marketplace_packageVersion__PackageVersionStatusSchema = Assert<Eq< z.input< typeof M51.PackageVersionStatusSchema >, z.infer< typeof M51.PackageVersionStatusSchema > >>;
export type Iso_marketplace_packageVersion__PublishPackageVersionRequestSchema = Assert<Eq< z.input< typeof M51.PublishPackageVersionRequestSchema >, z.infer< typeof M51.PublishPackageVersionRequestSchema > >>;
export type Iso_marketplace_packageVersion__UpdatePackageVersionRequestSchema = Assert<Eq< z.input< typeof M51.UpdatePackageVersionRequestSchema >, z.infer< typeof M51.UpdatePackageVersionRequestSchema > >>;

// marketplace/package.zod.ts
export type Iso_marketplace_package__CreatePackageRequestSchema = Assert<Eq< z.input< typeof M52.CreatePackageRequestSchema >, z.infer< typeof M52.CreatePackageRequestSchema > >>;
export type Iso_marketplace_package__PackageCategorySchema = Assert<Eq< z.input< typeof M52.PackageCategorySchema >, z.infer< typeof M52.PackageCategorySchema > >>;
export type Iso_marketplace_package__PackageLocaleSchema = Assert<Eq< z.input< typeof M52.PackageLocaleSchema >, z.infer< typeof M52.PackageLocaleSchema > >>;
export type Iso_marketplace_package__PackagePublisherSchema = Assert<Eq< z.input< typeof M52.PackagePublisherSchema >, z.infer< typeof M52.PackagePublisherSchema > >>;
export type Iso_marketplace_package__PackageTranslationSchema = Assert<Eq< z.input< typeof M52.PackageTranslationSchema >, z.infer< typeof M52.PackageTranslationSchema > >>;
export type Iso_marketplace_package__PackageTranslationsSchema = Assert<Eq< z.input< typeof M52.PackageTranslationsSchema >, z.infer< typeof M52.PackageTranslationsSchema > >>;
export type Iso_marketplace_package__PackageVisibilitySchema = Assert<Eq< z.input< typeof M52.PackageVisibilitySchema >, z.infer< typeof M52.PackageVisibilitySchema > >>;
export type Iso_marketplace_package__UpdatePackageRequestSchema = Assert<Eq< z.input< typeof M52.UpdatePackageRequestSchema >, z.infer< typeof M52.UpdatePackageRequestSchema > >>;

// marketplace/template-manifest.zod.ts
export type Iso_marketplace_templateManifest__TemplateManifestSchema = Assert<Eq< z.input< typeof M53.TemplateManifestSchema >, z.infer< typeof M53.TemplateManifestSchema > >>;

// qa/testing.zod.ts
export type Iso_qa_testing__TestActionSchema = Assert<Eq< z.input< typeof M105.TestActionSchema >, z.infer< typeof M105.TestActionSchema > >>;
export type Iso_qa_testing__TestActionTypeSchema = Assert<Eq< z.input< typeof M105.TestActionTypeSchema >, z.infer< typeof M105.TestActionTypeSchema > >>;
export type Iso_qa_testing__TestAssertionSchema = Assert<Eq< z.input< typeof M105.TestAssertionSchema >, z.infer< typeof M105.TestAssertionSchema > >>;
export type Iso_qa_testing__TestAssertionTypeSchema = Assert<Eq< z.input< typeof M105.TestAssertionTypeSchema >, z.infer< typeof M105.TestAssertionTypeSchema > >>;
export type Iso_qa_testing__TestContextSchema = Assert<Eq< z.input< typeof M105.TestContextSchema >, z.infer< typeof M105.TestContextSchema > >>;
export type Iso_qa_testing__TestScenarioSchema = Assert<Eq< z.input< typeof M105.TestScenarioSchema >, z.infer< typeof M105.TestScenarioSchema > >>;
export type Iso_qa_testing__TestStepSchema = Assert<Eq< z.input< typeof M105.TestStepSchema >, z.infer< typeof M105.TestStepSchema > >>;
export type Iso_qa_testing__TestSuiteSchema = Assert<Eq< z.input< typeof M105.TestSuiteSchema >, z.infer< typeof M105.TestSuiteSchema > >>;

// security/explain.zod.ts
export type Iso_security_explain__AccessMatrixEntrySchema = Assert<Eq< z.input< typeof M106.AccessMatrixEntrySchema >, z.infer< typeof M106.AccessMatrixEntrySchema > >>;
export type Iso_security_explain__AuthzPostureSchema = Assert<Eq< z.input< typeof M106.AuthzPostureSchema >, z.infer< typeof M106.AuthzPostureSchema > >>;
export type Iso_security_explain__ExplainMatchedRuleSchema = Assert<Eq< z.input< typeof M106.ExplainMatchedRuleSchema >, z.infer< typeof M106.ExplainMatchedRuleSchema > >>;
export type Iso_security_explain__ExplainOperationSchema = Assert<Eq< z.input< typeof M106.ExplainOperationSchema >, z.infer< typeof M106.ExplainOperationSchema > >>;
export type Iso_security_explain__ExplainRequestSchema = Assert<Eq< z.input< typeof M106.ExplainRequestSchema >, z.infer< typeof M106.ExplainRequestSchema > >>;

// security/permission.zod.ts
export type Iso_security_permission__EffectiveObjectPermissionSchema = Assert<Eq< z.input< typeof M107.EffectiveObjectPermissionSchema >, z.infer< typeof M107.EffectiveObjectPermissionSchema > >>;
export type Iso_security_permission__ObjectAccessScopeSchema = Assert<Eq< z.input< typeof M107.ObjectAccessScopeSchema >, z.infer< typeof M107.ObjectAccessScopeSchema > >>;

// security/rls.zod.ts
export type Iso_security_rls__RLSEvaluationResultSchema = Assert<Eq< z.input< typeof M108.RLSEvaluationResultSchema >, z.infer< typeof M108.RLSEvaluationResultSchema > >>;
export type Iso_security_rls__RLSOperation = Assert<Eq< z.input< typeof M108.RLSOperation >, z.infer< typeof M108.RLSOperation > >>;
export type Iso_security_rls__RLSUserContextSchema = Assert<Eq< z.input< typeof M108.RLSUserContextSchema >, z.infer< typeof M108.RLSUserContextSchema > >>;

// security/sharing.zod.ts
export type Iso_security_sharing__OWDModel = Assert<Eq< z.input< typeof M180.OWDModel >, z.infer< typeof M180.OWDModel > >>;
export type Iso_security_sharing__ShareRecipientType = Assert<Eq< z.input< typeof M180.ShareRecipientType >, z.infer< typeof M180.ShareRecipientType > >>;
export type Iso_security_sharing__SharingLevel = Assert<Eq< z.input< typeof M180.SharingLevel >, z.infer< typeof M180.SharingLevel > >>;
export type Iso_security_sharing__SharingRuleType = Assert<Eq< z.input< typeof M180.SharingRuleType >, z.infer< typeof M180.SharingRuleType > >>;

// shared/connector-auth.zod.ts
export type Iso_shared_connectorAuth__ConnectorInstanceAPIKeyAuthSchema = Assert<Eq< z.input< typeof M109.ConnectorInstanceAPIKeyAuthSchema >, z.infer< typeof M109.ConnectorInstanceAPIKeyAuthSchema > >>;
export type Iso_shared_connectorAuth__ConnectorInstanceAuthSchema = Assert<Eq< z.input< typeof M109.ConnectorInstanceAuthSchema >, z.infer< typeof M109.ConnectorInstanceAuthSchema > >>;
export type Iso_shared_connectorAuth__ConnectorInstanceBasicAuthSchema = Assert<Eq< z.input< typeof M109.ConnectorInstanceBasicAuthSchema >, z.infer< typeof M109.ConnectorInstanceBasicAuthSchema > >>;
export type Iso_shared_connectorAuth__ConnectorInstanceBearerAuthSchema = Assert<Eq< z.input< typeof M109.ConnectorInstanceBearerAuthSchema >, z.infer< typeof M109.ConnectorInstanceBearerAuthSchema > >>;
export type Iso_shared_connectorAuth__ConnectorInstanceNoAuthSchema = Assert<Eq< z.input< typeof M109.ConnectorInstanceNoAuthSchema >, z.infer< typeof M109.ConnectorInstanceNoAuthSchema > >>;

// shared/duration.zod.ts — the closed DURATION vocabulary (#18122), step ① of
// ruling A on #18115 and the counterpart of the `shared/epoch` instant. Both are
// `z.number().int().nonnegative()`: no default, no transform, the (RISE) case.
// The refinement is deliberate rather than incidental, so these two pins are
// what goes red the day someone gives a duration type a `.default()` — which
// would put the author state and the parsed state on different sides of it.
export type Iso_shared_duration__DurationMs = Assert<Eq< z.input< typeof M187.DurationMs >, z.infer< typeof M187.DurationMs > >>;
export type Iso_shared_duration__DurationSeconds = Assert<Eq< z.input< typeof M187.DurationSeconds >, z.infer< typeof M187.DurationSeconds > >>;

// shared/enums.zod.ts
export type Iso_shared_enums__IsolationLevelEnum = Assert<Eq< z.input< typeof M110.IsolationLevelEnum >, z.infer< typeof M110.IsolationLevelEnum > >>;
export type Iso_shared_enums__MutationEventEnum = Assert<Eq< z.input< typeof M110.MutationEventEnum >, z.infer< typeof M110.MutationEventEnum > >>;
export type Iso_shared_enums__SortDirectionEnum = Assert<Eq< z.input< typeof M110.SortDirectionEnum >, z.infer< typeof M110.SortDirectionEnum > >>;
export type Iso_shared_enums__SortItemSchema = Assert<Eq< z.input< typeof M110.SortItemSchema >, z.infer< typeof M110.SortItemSchema > >>;

// shared/epoch.zod.ts — the shared epoch-millisecond INSTANT (#15676), the
// first of the two exemptions ruling B on #14478 declares on the schema.
// `z.number().int()`: no default, no transform, the (RISE) case.
export type Iso_shared_epoch__EpochMs = Assert<Eq< z.input< typeof M185.EpochMs >, z.infer< typeof M185.EpochMs > >>;

// shared/expression.zod.ts
export type Iso_shared_expression__ExpressionDialect = Assert<Eq< z.input< typeof M111.ExpressionDialect >, z.infer< typeof M111.ExpressionDialect > >>;
export type Iso_shared_expression__ExpressionMetaSchema = Assert<Eq< z.input< typeof M111.ExpressionMetaSchema >, z.infer< typeof M111.ExpressionMetaSchema > >>;
export type Iso_shared_expression__ExpressionSchema = Assert<Eq< z.input< typeof M111.ExpressionSchema >, z.infer< typeof M111.ExpressionSchema > >>;
export type Iso_shared_expression__PredicateSchema = Assert<Eq< z.input< typeof M111.PredicateSchema >, z.infer< typeof M111.PredicateSchema > >>;

// shared/http.zod.ts
export type Iso_shared_http__HttpMethod = Assert<Eq< z.input< typeof M112.HttpMethod >, z.infer< typeof M112.HttpMethod > >>;
export type Iso_shared_http__HttpMethodSubsetSchema = Assert<Eq< z.input< typeof M112.HttpMethodSubsetSchema >, z.infer< typeof M112.HttpMethodSubsetSchema > >>;
export type Iso_shared_http__StaticMountSchema = Assert<Eq< z.input< typeof M112.StaticMountSchema >, z.infer< typeof M112.StaticMountSchema > >>;

// shared/identifiers.zod.ts
export type Iso_shared_identifiers__MetadataItemNameSchema = Assert<Eq< z.input< typeof M113.MetadataItemNameSchema >, z.infer< typeof M113.MetadataItemNameSchema > >>;
export type Iso_shared_identifiers__SnakeCaseIdentifierSchema = Assert<Eq< z.input< typeof M113.SnakeCaseIdentifierSchema >, z.infer< typeof M113.SnakeCaseIdentifierSchema > >>;
export type Iso_shared_identifiers__SystemIdentifierSchema = Assert<Eq< z.input< typeof M113.SystemIdentifierSchema >, z.infer< typeof M113.SystemIdentifierSchema > >>;

// shared/mapping.zod.ts
// Graduated INTO the isomorphic set at protocol 17: #5552 retired `transform` and the
// whole `FieldMappingTransform` union, which is what used to give this schema two shapes.
export type Iso_shared_mapping__FieldMappingSchema = Assert<Eq< z.input< typeof M169.FieldMappingSchema >, z.infer< typeof M169.FieldMappingSchema > >>;

// shared/metadata-types.zod.ts
export type Iso_shared_metadataTypes__BaseMetadataRecordSchema = Assert<Eq< z.input< typeof M114.BaseMetadataRecordSchema >, z.infer< typeof M114.BaseMetadataRecordSchema > >>;
export type Iso_shared_metadataTypes__MetadataFormatSchema = Assert<Eq< z.input< typeof M114.MetadataFormatSchema >, z.infer< typeof M114.MetadataFormatSchema > >>;

// shared/protection.zod.ts
export type Iso_shared_protection__ProtectionSchema = Assert<Eq< z.input< typeof M115.ProtectionSchema >, z.infer< typeof M115.ProtectionSchema > >>;

// shared/value-domain.zod.ts — the ONE standard-domain vocabulary (#14168);
// `SpecifierValueDomainSchema` is an alias of it, so its pin
// (`Iso_system_settingsManifest__SpecifierValueDomainSchema`) and this one hold
// or fall together. A `z.enum` has no default or transform, the (RISE) case.
export type Iso_shared_valueDomain__ValueDomainSchema = Assert<Eq< z.input< typeof M184.ValueDomainSchema >, z.infer< typeof M184.ValueDomainSchema > >>;

// stack.zod.ts
export type Iso_stack__ConflictStrategySchema = Assert<Eq< z.input< typeof M116.ConflictStrategySchema >, z.infer< typeof M116.ConflictStrategySchema > >>;
export type Iso_stack__DatasourceMappingRuleSchema = Assert<Eq< z.input< typeof M116.DatasourceMappingRuleSchema >, z.infer< typeof M116.DatasourceMappingRuleSchema > >>;

// studio/flow-builder.zod.ts
export type Iso_studio_flowBuilder__FlowCanvasEdgeStyleSchema = Assert<Eq< z.input< typeof M117.FlowCanvasEdgeStyleSchema >, z.infer< typeof M117.FlowCanvasEdgeStyleSchema > >>;
export type Iso_studio_flowBuilder__FlowLayoutAlgorithmSchema = Assert<Eq< z.input< typeof M117.FlowLayoutAlgorithmSchema >, z.infer< typeof M117.FlowLayoutAlgorithmSchema > >>;
export type Iso_studio_flowBuilder__FlowLayoutDirectionSchema = Assert<Eq< z.input< typeof M117.FlowLayoutDirectionSchema >, z.infer< typeof M117.FlowLayoutDirectionSchema > >>;
export type Iso_studio_flowBuilder__FlowNodeShapeSchema = Assert<Eq< z.input< typeof M117.FlowNodeShapeSchema >, z.infer< typeof M117.FlowNodeShapeSchema > >>;

// studio/object-designer.zod.ts
export type Iso_studio_objectDesigner__ERLayoutAlgorithmSchema = Assert<Eq< z.input< typeof M118.ERLayoutAlgorithmSchema >, z.infer< typeof M118.ERLayoutAlgorithmSchema > >>;
export type Iso_studio_objectDesigner__ObjectDesignerDefaultViewSchema = Assert<Eq< z.input< typeof M118.ObjectDesignerDefaultViewSchema >, z.infer< typeof M118.ObjectDesignerDefaultViewSchema > >>;
export type Iso_studio_objectDesigner__ObjectListDisplayModeSchema = Assert<Eq< z.input< typeof M118.ObjectListDisplayModeSchema >, z.infer< typeof M118.ObjectListDisplayModeSchema > >>;
export type Iso_studio_objectDesigner__ObjectSortFieldSchema = Assert<Eq< z.input< typeof M118.ObjectSortFieldSchema >, z.infer< typeof M118.ObjectSortFieldSchema > >>;

// studio/plugin.zod.ts
export type Iso_studio_plugin__ActionContributionLocationSchema = Assert<Eq< z.input< typeof M119.ActionContributionLocationSchema >, z.infer< typeof M119.ActionContributionLocationSchema > >>;
export type Iso_studio_plugin__CommandContributionSchema = Assert<Eq< z.input< typeof M119.CommandContributionSchema >, z.infer< typeof M119.CommandContributionSchema > >>;
export type Iso_studio_plugin__MetadataIconContributionSchema = Assert<Eq< z.input< typeof M119.MetadataIconContributionSchema >, z.infer< typeof M119.MetadataIconContributionSchema > >>;
export type Iso_studio_plugin__PanelLocationSchema = Assert<Eq< z.input< typeof M119.PanelLocationSchema >, z.infer< typeof M119.PanelLocationSchema > >>;
export type Iso_studio_plugin__ViewModeSchema = Assert<Eq< z.input< typeof M119.ViewModeSchema >, z.infer< typeof M119.ViewModeSchema > >>;

// system/auth-config.zod.ts
export type Iso_system_authConfig__AdvancedAuthConfigSchema = Assert<Eq< z.input< typeof M120.AdvancedAuthConfigSchema >, z.infer< typeof M120.AdvancedAuthConfigSchema > >>;
export type Iso_system_authConfig__AuthProviderConfigSchema = Assert<Eq< z.input< typeof M120.AuthProviderConfigSchema >, z.infer< typeof M120.AuthProviderConfigSchema > >>;
export type Iso_system_authConfig__EmailVerificationConfigSchema = Assert<Eq< z.input< typeof M120.EmailVerificationConfigSchema >, z.infer< typeof M120.EmailVerificationConfigSchema > >>;
export type Iso_system_authConfig__OidcProviderConfigSchema = Assert<Eq< z.input< typeof M120.OidcProviderConfigSchema >, z.infer< typeof M120.OidcProviderConfigSchema > >>;
export type Iso_system_authConfig__OidcProvidersConfigSchema = Assert<Eq< z.input< typeof M120.OidcProvidersConfigSchema >, z.infer< typeof M120.OidcProvidersConfigSchema > >>;

// system/cache.zod.ts
export type Iso_system_cache__CacheConsistencySchema = Assert<Eq< z.input< typeof M121.CacheConsistencySchema >, z.infer< typeof M121.CacheConsistencySchema > >>;
export type Iso_system_cache__CacheInvalidationSchema = Assert<Eq< z.input< typeof M121.CacheInvalidationSchema >, z.infer< typeof M121.CacheInvalidationSchema > >>;
export type Iso_system_cache__CacheStrategySchema = Assert<Eq< z.input< typeof M121.CacheStrategySchema >, z.infer< typeof M121.CacheStrategySchema > >>;

// system/collaboration.zod.ts
export type Iso_system_collaboration__AwarenessEventSchema = Assert<Eq< z.input< typeof M123.AwarenessEventSchema >, z.infer< typeof M123.AwarenessEventSchema > >>;
export type Iso_system_collaboration__AwarenessSessionSchema = Assert<Eq< z.input< typeof M123.AwarenessSessionSchema >, z.infer< typeof M123.AwarenessSessionSchema > >>;
export type Iso_system_collaboration__AwarenessUpdateSchema = Assert<Eq< z.input< typeof M123.AwarenessUpdateSchema >, z.infer< typeof M123.AwarenessUpdateSchema > >>;
export type Iso_system_collaboration__AwarenessUserStateSchema = Assert<Eq< z.input< typeof M123.AwarenessUserStateSchema >, z.infer< typeof M123.AwarenessUserStateSchema > >>;
export type Iso_system_collaboration__CRDTType = Assert<Eq< z.input< typeof M123.CRDTType >, z.infer< typeof M123.CRDTType > >>;
export type Iso_system_collaboration__CollaborationMode = Assert<Eq< z.input< typeof M123.CollaborationMode >, z.infer< typeof M123.CollaborationMode > >>;
export type Iso_system_collaboration__CounterOperationSchema = Assert<Eq< z.input< typeof M123.CounterOperationSchema >, z.infer< typeof M123.CounterOperationSchema > >>;
export type Iso_system_collaboration__CursorColorPreset = Assert<Eq< z.input< typeof M123.CursorColorPreset >, z.infer< typeof M123.CursorColorPreset > >>;
export type Iso_system_collaboration__CursorSelectionSchema = Assert<Eq< z.input< typeof M123.CursorSelectionSchema >, z.infer< typeof M123.CursorSelectionSchema > >>;
export type Iso_system_collaboration__CursorUpdateSchema = Assert<Eq< z.input< typeof M123.CursorUpdateSchema >, z.infer< typeof M123.CursorUpdateSchema > >>;
export type Iso_system_collaboration__GCounterSchema = Assert<Eq< z.input< typeof M123.GCounterSchema >, z.infer< typeof M123.GCounterSchema > >>;
export type Iso_system_collaboration__LWWRegisterSchema = Assert<Eq< z.input< typeof M123.LWWRegisterSchema >, z.infer< typeof M123.LWWRegisterSchema > >>;
export type Iso_system_collaboration__OTComponentSchema = Assert<Eq< z.input< typeof M123.OTComponentSchema >, z.infer< typeof M123.OTComponentSchema > >>;
export type Iso_system_collaboration__OTOperationSchema = Assert<Eq< z.input< typeof M123.OTOperationSchema >, z.infer< typeof M123.OTOperationSchema > >>;
export type Iso_system_collaboration__OTOperationType = Assert<Eq< z.input< typeof M123.OTOperationType >, z.infer< typeof M123.OTOperationType > >>;
export type Iso_system_collaboration__OTTransformResultSchema = Assert<Eq< z.input< typeof M123.OTTransformResultSchema >, z.infer< typeof M123.OTTransformResultSchema > >>;
export type Iso_system_collaboration__PNCounterSchema = Assert<Eq< z.input< typeof M123.PNCounterSchema >, z.infer< typeof M123.PNCounterSchema > >>;
export type Iso_system_collaboration__TextCRDTOperationSchema = Assert<Eq< z.input< typeof M123.TextCRDTOperationSchema >, z.infer< typeof M123.TextCRDTOperationSchema > >>;
export type Iso_system_collaboration__TextCRDTStateSchema = Assert<Eq< z.input< typeof M123.TextCRDTStateSchema >, z.infer< typeof M123.TextCRDTStateSchema > >>;
export type Iso_system_collaboration__UserActivityStatus = Assert<Eq< z.input< typeof M123.UserActivityStatus >, z.infer< typeof M123.UserActivityStatus > >>;
export type Iso_system_collaboration__VectorClockSchema = Assert<Eq< z.input< typeof M123.VectorClockSchema >, z.infer< typeof M123.VectorClockSchema > >>;

// system/core-services.zod.ts
export type Iso_system_coreServices__CoreServiceName = Assert<Eq< z.input< typeof M124.CoreServiceName >, z.infer< typeof M124.CoreServiceName > >>;
export type Iso_system_coreServices__KernelServiceMapSchema = Assert<Eq< z.input< typeof M124.KernelServiceMapSchema >, z.infer< typeof M124.KernelServiceMapSchema > >>;
export type Iso_system_coreServices__KernelServiceStatusSchema = Assert<Eq< z.input< typeof M124.KernelServiceStatusSchema >, z.infer< typeof M124.KernelServiceStatusSchema > >>;
export type Iso_system_coreServices__ServiceConfigSchema = Assert<Eq< z.input< typeof M124.ServiceConfigSchema >, z.infer< typeof M124.ServiceConfigSchema > >>;
export type Iso_system_coreServices__ServiceCriticalitySchema = Assert<Eq< z.input< typeof M124.ServiceCriticalitySchema >, z.infer< typeof M124.ServiceCriticalitySchema > >>;

// system/deploy-bundle.zod.ts
export type Iso_system_deployBundle__DeployStatusEnum = Assert<Eq< z.input< typeof M125.DeployStatusEnum >, z.infer< typeof M125.DeployStatusEnum > >>;
export type Iso_system_deployBundle__DeployValidationIssueSchema = Assert<Eq< z.input< typeof M125.DeployValidationIssueSchema >, z.infer< typeof M125.DeployValidationIssueSchema > >>;
export type Iso_system_deployBundle__SchemaChangeSchema = Assert<Eq< z.input< typeof M125.SchemaChangeSchema >, z.infer< typeof M125.SchemaChangeSchema > >>;

// system/disaster-recovery.zod.ts
export type Iso_system_disasterRecovery__BackupStrategySchema = Assert<Eq< z.input< typeof M126.BackupStrategySchema >, z.infer< typeof M126.BackupStrategySchema > >>;
export type Iso_system_disasterRecovery__FailoverModeSchema = Assert<Eq< z.input< typeof M126.FailoverModeSchema >, z.infer< typeof M126.FailoverModeSchema > >>;

// system/doc.zod.ts
export type Iso_system_doc__DocSchema = Assert<Eq< z.input< typeof M127.DocSchema >, z.infer< typeof M127.DocSchema > >>;

// system/email-config.zod.ts
export type Iso_system_emailConfig__EmailAddressConfigSchema = Assert<Eq< z.input< typeof M128.EmailAddressConfigSchema >, z.infer< typeof M128.EmailAddressConfigSchema > >>;
export type Iso_system_emailConfig__EmailProviderSchema = Assert<Eq< z.input< typeof M128.EmailProviderSchema >, z.infer< typeof M128.EmailProviderSchema > >>;

// system/email-template.zod.ts
export type Iso_system_emailTemplate__EmailTemplateDefinitionCategorySchema = Assert<Eq< z.input< typeof M129.EmailTemplateDefinitionCategorySchema >, z.infer< typeof M129.EmailTemplateDefinitionCategorySchema > >>;

// system/encryption.zod.ts
export type Iso_system_encryption__EncryptionAlgorithmSchema = Assert<Eq< z.input< typeof M130.EncryptionAlgorithmSchema >, z.infer< typeof M130.EncryptionAlgorithmSchema > >>;
export type Iso_system_encryption__KeyManagementProviderSchema = Assert<Eq< z.input< typeof M130.KeyManagementProviderSchema >, z.infer< typeof M130.KeyManagementProviderSchema > >>;

// system/environment-artifact.zod.ts
export type Iso_system_environmentArtifact__Sha256DigestSchema = Assert<Eq< z.input< typeof M131.Sha256DigestSchema >, z.infer< typeof M131.Sha256DigestSchema > >>;

// system/http-server.zod.ts
export type Iso_system_httpServer__MiddlewareType = Assert<Eq< z.input< typeof M132.MiddlewareType >, z.infer< typeof M132.MiddlewareType > >>;

// system/job.zod.ts
export type Iso_system_job__IntervalScheduleSchema = Assert<Eq< z.input< typeof M134.IntervalScheduleSchema >, z.infer< typeof M134.IntervalScheduleSchema > >>;
export type Iso_system_job__JobExecutionSchema = Assert<Eq< z.input< typeof M134.JobExecutionSchema >, z.infer< typeof M134.JobExecutionSchema > >>;
export type Iso_system_job__JobExecutionStatus = Assert<Eq< z.input< typeof M134.JobExecutionStatus >, z.infer< typeof M134.JobExecutionStatus > >>;
export type Iso_system_job__OnceScheduleSchema = Assert<Eq< z.input< typeof M134.OnceScheduleSchema >, z.infer< typeof M134.OnceScheduleSchema > >>;

// system/license.zod.ts
export type Iso_system_license__LicenseMetricType = Assert<Eq< z.input< typeof M135.LicenseMetricType >, z.infer< typeof M135.LicenseMetricType > >>;
export type Iso_system_license__LicenseSchema = Assert<Eq< z.input< typeof M135.LicenseSchema >, z.infer< typeof M135.LicenseSchema > >>;

// system/logging.zod.ts
export type Iso_system_logging__ExtendedLogLevel = Assert<Eq< z.input< typeof M136.ExtendedLogLevel >, z.infer< typeof M136.ExtendedLogLevel > >>;
export type Iso_system_logging__ExternalServiceDestinationConfigSchema = Assert<Eq< z.input< typeof M136.ExternalServiceDestinationConfigSchema >, z.infer< typeof M136.ExternalServiceDestinationConfigSchema > >>;
export type Iso_system_logging__LogDestinationType = Assert<Eq< z.input< typeof M136.LogDestinationType >, z.infer< typeof M136.LogDestinationType > >>;
export type Iso_system_logging__LogEntrySchema = Assert<Eq< z.input< typeof M136.LogEntrySchema >, z.infer< typeof M136.LogEntrySchema > >>;
export type Iso_system_logging__LogFormat = Assert<Eq< z.input< typeof M136.LogFormat >, z.infer< typeof M136.LogFormat > >>;
export type Iso_system_logging__LogLevel = Assert<Eq< z.input< typeof M136.LogLevel >, z.infer< typeof M136.LogLevel > >>;
export type Iso_system_logging__StructuredLogEntrySchema = Assert<Eq< z.input< typeof M136.StructuredLogEntrySchema >, z.infer< typeof M136.StructuredLogEntrySchema > >>;

// system/message-queue.zod.ts — retired whole (#8075, ADR-0049); its pin left with it.

// system/metadata-persistence.zod.ts
export type Iso_system_metadataPersistence__MetadataCollectionInfoSchema = Assert<Eq< z.input< typeof M138.MetadataCollectionInfoSchema >, z.infer< typeof M138.MetadataCollectionInfoSchema > >>;
export type Iso_system_metadataPersistence__MetadataDiffResultSchema = Assert<Eq< z.input< typeof M138.MetadataDiffResultSchema >, z.infer< typeof M138.MetadataDiffResultSchema > >>;
export type Iso_system_metadataPersistence__MetadataHistoryQueryResultSchema = Assert<Eq< z.input< typeof M138.MetadataHistoryQueryResultSchema >, z.infer< typeof M138.MetadataHistoryQueryResultSchema > >>;
export type Iso_system_metadataPersistence__MetadataHistoryRecordSchema = Assert<Eq< z.input< typeof M138.MetadataHistoryRecordSchema >, z.infer< typeof M138.MetadataHistoryRecordSchema > >>;
export type Iso_system_metadataPersistence__MetadataLoadOptionsSchema = Assert<Eq< z.input< typeof M138.MetadataLoadOptionsSchema >, z.infer< typeof M138.MetadataLoadOptionsSchema > >>;
export type Iso_system_metadataPersistence__MetadataLoadResultSchema = Assert<Eq< z.input< typeof M138.MetadataLoadResultSchema >, z.infer< typeof M138.MetadataLoadResultSchema > >>;
export type Iso_system_metadataPersistence__MetadataSaveResultSchema = Assert<Eq< z.input< typeof M138.MetadataSaveResultSchema >, z.infer< typeof M138.MetadataSaveResultSchema > >>;
export type Iso_system_metadataPersistence__MetadataScopeSchema = Assert<Eq< z.input< typeof M138.MetadataScopeSchema >, z.infer< typeof M138.MetadataScopeSchema > >>;
export type Iso_system_metadataPersistence__MetadataSourceSchema = Assert<Eq< z.input< typeof M138.MetadataSourceSchema >, z.infer< typeof M138.MetadataSourceSchema > >>;
export type Iso_system_metadataPersistence__MetadataStateSchema = Assert<Eq< z.input< typeof M138.MetadataStateSchema >, z.infer< typeof M138.MetadataStateSchema > >>;
export type Iso_system_metadataPersistence__MetadataStatsSchema = Assert<Eq< z.input< typeof M138.MetadataStatsSchema >, z.infer< typeof M138.MetadataStatsSchema > >>;
export type Iso_system_metadataPersistence__MetadataWatchEventSchema = Assert<Eq< z.input< typeof M138.MetadataWatchEventSchema >, z.infer< typeof M138.MetadataWatchEventSchema > >>;
export type Iso_system_metadataPersistence__PackagePublishResultSchema = Assert<Eq< z.input< typeof M138.PackagePublishResultSchema >, z.infer< typeof M138.PackagePublishResultSchema > >>;

// system/metrics.zod.ts
export type Iso_system_metrics__HistogramBucketConfigSchema = Assert<Eq< z.input< typeof M139.HistogramBucketConfigSchema >, z.infer< typeof M139.HistogramBucketConfigSchema > >>;
export type Iso_system_metrics__MetricAggregationType = Assert<Eq< z.input< typeof M139.MetricAggregationType >, z.infer< typeof M139.MetricAggregationType > >>;
export type Iso_system_metrics__MetricDataPointSchema = Assert<Eq< z.input< typeof M139.MetricDataPointSchema >, z.infer< typeof M139.MetricDataPointSchema > >>;
export type Iso_system_metrics__MetricLabelsSchema = Assert<Eq< z.input< typeof M139.MetricLabelsSchema >, z.infer< typeof M139.MetricLabelsSchema > >>;
export type Iso_system_metrics__MetricType = Assert<Eq< z.input< typeof M139.MetricType >, z.infer< typeof M139.MetricType > >>;
export type Iso_system_metrics__MetricUnit = Assert<Eq< z.input< typeof M139.MetricUnit >, z.infer< typeof M139.MetricUnit > >>;
export type Iso_system_metrics__TimeSeriesDataPointSchema = Assert<Eq< z.input< typeof M139.TimeSeriesDataPointSchema >, z.infer< typeof M139.TimeSeriesDataPointSchema > >>;
export type Iso_system_metrics__TimeSeriesSchema = Assert<Eq< z.input< typeof M139.TimeSeriesSchema >, z.infer< typeof M139.TimeSeriesSchema > >>;

// system/migration.zod.ts
export type Iso_system_migration__DataMigrationFlagSchema = Assert<Eq< z.input< typeof M140.DataMigrationFlagSchema >, z.infer< typeof M140.DataMigrationFlagSchema > >>;
export type Iso_system_migration__DeleteObjectOperation = Assert<Eq< z.input< typeof M140.DeleteObjectOperation >, z.infer< typeof M140.DeleteObjectOperation > >>;
export type Iso_system_migration__ExecuteSqlOperation = Assert<Eq< z.input< typeof M140.ExecuteSqlOperation >, z.infer< typeof M140.ExecuteSqlOperation > >>;
export type Iso_system_migration__MigrationDependencySchema = Assert<Eq< z.input< typeof M140.MigrationDependencySchema >, z.infer< typeof M140.MigrationDependencySchema > >>;
export type Iso_system_migration__MigrationJournalEventSchema = Assert<Eq< z.input< typeof M140.MigrationJournalEventSchema >, z.infer< typeof M140.MigrationJournalEventSchema > >>;
export type Iso_system_migration__ModifyFieldOperation = Assert<Eq< z.input< typeof M140.ModifyFieldOperation >, z.infer< typeof M140.ModifyFieldOperation > >>;
export type Iso_system_migration__RemoveFieldOperation = Assert<Eq< z.input< typeof M140.RemoveFieldOperation >, z.infer< typeof M140.RemoveFieldOperation > >>;
export type Iso_system_migration__RenameObjectOperation = Assert<Eq< z.input< typeof M140.RenameObjectOperation >, z.infer< typeof M140.RenameObjectOperation > >>;

// system/notification.zod.ts
export type Iso_system_notification__NotificationChannelSchema = Assert<Eq< z.input< typeof M141.NotificationChannelSchema >, z.infer< typeof M141.NotificationChannelSchema > >>;

// system/object-storage.zod.ts
export type Iso_system_objectStorage__FileMetadataSchema = Assert<Eq< z.input< typeof M142.FileMetadataSchema >, z.infer< typeof M142.FileMetadataSchema > >>;
export type Iso_system_objectStorage__LifecycleActionSchema = Assert<Eq< z.input< typeof M142.LifecycleActionSchema >, z.infer< typeof M142.LifecycleActionSchema > >>;
export type Iso_system_objectStorage__ObjectMetadataSchema = Assert<Eq< z.input< typeof M142.ObjectMetadataSchema >, z.infer< typeof M142.ObjectMetadataSchema > >>;
export type Iso_system_objectStorage__PresignedUrlConfigSchema = Assert<Eq< z.input< typeof M142.PresignedUrlConfigSchema >, z.infer< typeof M142.PresignedUrlConfigSchema > >>;
export type Iso_system_objectStorage__StorageAclSchema = Assert<Eq< z.input< typeof M142.StorageAclSchema >, z.infer< typeof M142.StorageAclSchema > >>;
export type Iso_system_objectStorage__StorageClassSchema = Assert<Eq< z.input< typeof M142.StorageClassSchema >, z.infer< typeof M142.StorageClassSchema > >>;
export type Iso_system_objectStorage__StorageProviderSchema = Assert<Eq< z.input< typeof M142.StorageProviderSchema >, z.infer< typeof M142.StorageProviderSchema > >>;
export type Iso_system_objectStorage__StorageScopeSchema = Assert<Eq< z.input< typeof M142.StorageScopeSchema >, z.infer< typeof M142.StorageScopeSchema > >>;

// system/registry-config.zod.ts
export type Iso_system_registryConfig__RegistrySyncPolicySchema = Assert<Eq< z.input< typeof M143.RegistrySyncPolicySchema >, z.infer< typeof M143.RegistrySyncPolicySchema > >>;

// system/search-engine.zod.ts
export type Iso_system_searchEngine__AnalyzerConfigSchema = Assert<Eq< z.input< typeof M144.AnalyzerConfigSchema >, z.infer< typeof M144.AnalyzerConfigSchema > >>;
export type Iso_system_searchEngine__SearchProviderSchema = Assert<Eq< z.input< typeof M144.SearchProviderSchema >, z.infer< typeof M144.SearchProviderSchema > >>;

// system/security-context.zod.ts
export type Iso_system_securityContext__ComplianceFrameworkSchema = Assert<Eq< z.input< typeof M145.ComplianceFrameworkSchema >, z.infer< typeof M145.ComplianceFrameworkSchema > >>;
export type Iso_system_securityContext__DataClassificationSchema = Assert<Eq< z.input< typeof M145.DataClassificationSchema >, z.infer< typeof M145.DataClassificationSchema > >>;

// system/settings-client.zod.ts
export type Iso_system_settingsClient__SettingsChangeEventSchema = Assert<Eq< z.input< typeof M146.SettingsChangeEventSchema >, z.infer< typeof M146.SettingsChangeEventSchema > >>;

// system/settings-manifest.zod.ts
export type Iso_system_settingsManifest__SettingsActionResultSchema = Assert<Eq< z.input< typeof M147.SettingsActionResultSchema >, z.infer< typeof M147.SettingsActionResultSchema > >>;
export type Iso_system_settingsManifest__SpecifierOptionSchema = Assert<Eq< z.input< typeof M147.SpecifierOptionSchema >, z.infer< typeof M147.SpecifierOptionSchema > >>;
export type Iso_system_settingsManifest__SpecifierScopeSchema = Assert<Eq< z.input< typeof M147.SpecifierScopeSchema >, z.infer< typeof M147.SpecifierScopeSchema > >>;
export type Iso_system_settingsManifest__SpecifierType = Assert<Eq< z.input< typeof M147.SpecifierType >, z.infer< typeof M147.SpecifierType > >>;
export type Iso_system_settingsManifest__SpecifierValueDomainSchema = Assert<Eq< z.input< typeof M147.SpecifierValueDomainSchema >, z.infer< typeof M147.SpecifierValueDomainSchema > >>;

// system/supplier-security.zod.ts
export type Iso_system_supplierSecurity__SupplierAssessmentStatusSchema = Assert<Eq< z.input< typeof M148.SupplierAssessmentStatusSchema >, z.infer< typeof M148.SupplierAssessmentStatusSchema > >>;
export type Iso_system_supplierSecurity__SupplierRiskLevelSchema = Assert<Eq< z.input< typeof M148.SupplierRiskLevelSchema >, z.infer< typeof M148.SupplierRiskLevelSchema > >>;

// system/tenant.zod.ts
export type Iso_system_tenant__DatabaseProviderSchema = Assert<Eq< z.input< typeof M149.DatabaseProviderSchema >, z.infer< typeof M149.DatabaseProviderSchema > >>;
export type Iso_system_tenant__QuotaEnforcementResultSchema = Assert<Eq< z.input< typeof M149.QuotaEnforcementResultSchema >, z.infer< typeof M149.QuotaEnforcementResultSchema > >>;
export type Iso_system_tenant__TenantConnectionConfigSchema = Assert<Eq< z.input< typeof M149.TenantConnectionConfigSchema >, z.infer< typeof M149.TenantConnectionConfigSchema > >>;
export type Iso_system_tenant__TenantIsolationLevel = Assert<Eq< z.input< typeof M149.TenantIsolationLevel >, z.infer< typeof M149.TenantIsolationLevel > >>;
export type Iso_system_tenant__TenantQuotaSchema = Assert<Eq< z.input< typeof M149.TenantQuotaSchema >, z.infer< typeof M149.TenantQuotaSchema > >>;
export type Iso_system_tenant__TenantSchema = Assert<Eq< z.input< typeof M149.TenantSchema >, z.infer< typeof M149.TenantSchema > >>;

// system/tracing.zod.ts
export type Iso_system_tracing__OtelExporterType = Assert<Eq< z.input< typeof M150.OtelExporterType >, z.infer< typeof M150.OtelExporterType > >>;
export type Iso_system_tracing__SamplingDecision = Assert<Eq< z.input< typeof M150.SamplingDecision >, z.infer< typeof M150.SamplingDecision > >>;
export type Iso_system_tracing__SamplingStrategyType = Assert<Eq< z.input< typeof M150.SamplingStrategyType >, z.infer< typeof M150.SamplingStrategyType > >>;
export type Iso_system_tracing__SpanAttributeValueSchema = Assert<Eq< z.input< typeof M150.SpanAttributeValueSchema >, z.infer< typeof M150.SpanAttributeValueSchema > >>;
export type Iso_system_tracing__SpanAttributesSchema = Assert<Eq< z.input< typeof M150.SpanAttributesSchema >, z.infer< typeof M150.SpanAttributesSchema > >>;
export type Iso_system_tracing__SpanEventSchema = Assert<Eq< z.input< typeof M150.SpanEventSchema >, z.infer< typeof M150.SpanEventSchema > >>;
export type Iso_system_tracing__SpanKind = Assert<Eq< z.input< typeof M150.SpanKind >, z.infer< typeof M150.SpanKind > >>;
export type Iso_system_tracing__SpanStatus = Assert<Eq< z.input< typeof M150.SpanStatus >, z.infer< typeof M150.SpanStatus > >>;
export type Iso_system_tracing__TraceFlagsSchema = Assert<Eq< z.input< typeof M150.TraceFlagsSchema >, z.infer< typeof M150.TraceFlagsSchema > >>;
export type Iso_system_tracing__TracePropagationFormat = Assert<Eq< z.input< typeof M150.TracePropagationFormat >, z.infer< typeof M150.TracePropagationFormat > >>;
export type Iso_system_tracing__TraceStateSchema = Assert<Eq< z.input< typeof M150.TraceStateSchema >, z.infer< typeof M150.TraceStateSchema > >>;

// system/translation.zod.ts
// #15178 split the bundle type in two (`PlatformTranslationDataSchema`,
// `PlatformTranslationBundleSchema`). The platform face is the per-app shape
// plus one more optional group, so its two states coincide exactly as the
// per-app face's do — pinned rather than given a permanent `XParsed` synonym.
export type Iso_system_translation__ActionResultDialogTranslationSchema = Assert<Eq< z.input< typeof M152.ActionResultDialogTranslationSchema >, z.infer< typeof M152.ActionResultDialogTranslationSchema > >>;
export type Iso_system_translation__CoverageBreakdownEntrySchema = Assert<Eq< z.input< typeof M152.CoverageBreakdownEntrySchema >, z.infer< typeof M152.CoverageBreakdownEntrySchema > >>;
export type Iso_system_translation__FieldTranslationSchema = Assert<Eq< z.input< typeof M152.FieldTranslationSchema >, z.infer< typeof M152.FieldTranslationSchema > >>;
export type Iso_system_translation__LocaleSchema = Assert<Eq< z.input< typeof M152.LocaleSchema >, z.infer< typeof M152.LocaleSchema > >>;
export type Iso_system_translation__ObjectTranslationDataSchema = Assert<Eq< z.input< typeof M152.ObjectTranslationDataSchema >, z.infer< typeof M152.ObjectTranslationDataSchema > >>;
export type Iso_system_translation__PlatformTranslationBundleSchema = Assert<Eq< z.input< typeof M152.PlatformTranslationBundleSchema >, z.infer< typeof M152.PlatformTranslationBundleSchema > >>;
export type Iso_system_translation__PlatformTranslationDataSchema = Assert<Eq< z.input< typeof M152.PlatformTranslationDataSchema >, z.infer< typeof M152.PlatformTranslationDataSchema > >>;
export type Iso_system_translation__TranslationBundleSchema = Assert<Eq< z.input< typeof M152.TranslationBundleSchema >, z.infer< typeof M152.TranslationBundleSchema > >>;
export type Iso_system_translation__TranslationConfigSchema = Assert<Eq< z.input< typeof M152.TranslationConfigSchema >, z.infer< typeof M152.TranslationConfigSchema > >>;
export type Iso_system_translation__TranslationCoverageResultSchema = Assert<Eq< z.input< typeof M152.TranslationCoverageResultSchema >, z.infer< typeof M152.TranslationCoverageResultSchema > >>;
export type Iso_system_translation__TranslationDataSchema = Assert<Eq< z.input< typeof M152.TranslationDataSchema >, z.infer< typeof M152.TranslationDataSchema > >>;
export type Iso_system_translation__TranslationDiffItemSchema = Assert<Eq< z.input< typeof M152.TranslationDiffItemSchema >, z.infer< typeof M152.TranslationDiffItemSchema > >>;
export type Iso_system_translation__TranslationDiffStatusSchema = Assert<Eq< z.input< typeof M152.TranslationDiffStatusSchema >, z.infer< typeof M152.TranslationDiffStatusSchema > >>;
export type Iso_system_translation__TranslationItemSchema = Assert<Eq< z.input< typeof M152.TranslationItemSchema >, z.infer< typeof M152.TranslationItemSchema > >>;

// system/worker.zod.ts
export type Iso_system_worker__TaskExecutionResultSchema = Assert<Eq< z.input< typeof M153.TaskExecutionResultSchema >, z.infer< typeof M153.TaskExecutionResultSchema > >>;
export type Iso_system_worker__TaskPriority = Assert<Eq< z.input< typeof M153.TaskPriority >, z.infer< typeof M153.TaskPriority > >>;
export type Iso_system_worker__TaskStatus = Assert<Eq< z.input< typeof M153.TaskStatus >, z.infer< typeof M153.TaskStatus > >>;
export type Iso_system_worker__WorkerStatsSchema = Assert<Eq< z.input< typeof M153.WorkerStatsSchema >, z.infer< typeof M153.WorkerStatsSchema > >>;

// ui/action-params.zod.ts
export type Iso_ui_actionParams__ActionSessionSchema = Assert<Eq< z.input< typeof M154.ActionSessionSchema >, z.infer< typeof M154.ActionSessionSchema > >>;

// ui/action.zod.ts
export type Iso_ui_action__ActionLocationSchema = Assert<Eq< z.input< typeof M155.ActionLocationSchema >, z.infer< typeof M155.ActionLocationSchema > >>;
export type Iso_ui_action__ActionType = Assert<Eq< z.input< typeof M155.ActionType >, z.infer< typeof M155.ActionType > >>;

// ui/app.zod.ts
export type Iso_ui_app__AppBrandingSchema = Assert<Eq< z.input< typeof M156.AppBrandingSchema >, z.infer< typeof M156.AppBrandingSchema > >>;

// ui/bulk-action.zod.ts
export type Iso_ui_bulkAction__BulkActionExecutionSchema = Assert<Eq< z.input< typeof M157.BulkActionExecutionSchema >, z.infer< typeof M157.BulkActionExecutionSchema > >>;
export type Iso_ui_bulkAction__BulkActionOperationSchema = Assert<Eq< z.input< typeof M157.BulkActionOperationSchema >, z.infer< typeof M157.BulkActionOperationSchema > >>;
export type Iso_ui_bulkAction__BulkActionParamSchema = Assert<Eq< z.input< typeof M157.BulkActionParamSchema >, z.infer< typeof M157.BulkActionParamSchema > >>;

// ui/chart.zod.ts
export type Iso_ui_chart__ChartAggregateFunctionSchema = Assert<Eq< z.input< typeof M158.ChartAggregateFunctionSchema >, z.infer< typeof M158.ChartAggregateFunctionSchema > >>;
export type Iso_ui_chart__ChartAggregateSchema = Assert<Eq< z.input< typeof M158.ChartAggregateSchema >, z.infer< typeof M158.ChartAggregateSchema > >>;
export type Iso_ui_chart__ChartDrillDownSchema = Assert<Eq< z.input< typeof M158.ChartDrillDownSchema >, z.infer< typeof M158.ChartDrillDownSchema > >>;
export type Iso_ui_chart__ChartGroupBySchema = Assert<Eq< z.input< typeof M158.ChartGroupBySchema >, z.infer< typeof M158.ChartGroupBySchema > >>;
export type Iso_ui_chart__ChartTypeSchema = Assert<Eq< z.input< typeof M158.ChartTypeSchema >, z.infer< typeof M158.ChartTypeSchema > >>;

// ui/component.zod.ts
// #5775 — `PageContainerProps`, the shared `children` contract for
// `page:section`/`page:footer`/`page:sidebar`. A lone optional array with no
// default, transform, catch or pipe anywhere in its tree, so the two shapes
// coincide and the phase-2 flip of the bare name changes nothing.
// `check:spec-parsed-alias` sent it here rather than to a
// `PageContainerPropsParsed`, which would be a permanent synonym.
// `ElementNumberPropsSchema` (Iso818) left the family on the ui#6206
// convergence: its `filter` now carries `z.array(ViewFilterRuleSchema)`, whose
// own input ≠ infer (`operator` is normalized on parse — `ViewFilterRuleParsed`
// exists for exactly that reason), so `ElementNumberPropsParsed` is declared
// and the pin deleted.
// `ElementRecordPickerPropsSchema` (Iso819) left the family the same way on
// #14406 — the LAST record-form `filter` in `ComponentPropsMap`: its `filter`
// now carries `z.array(ViewFilterRuleSchema)` too, so `ElementRecordPickerPropsParsed`
// is declared and this pin deleted.
// `record:reference_rail` (#8691: `ReferenceRailEntrySchema`,
// `RecordReferenceRailProps`) — deliberately default-free on the same
// principle as the object-* family: the renderer's `limit ?? 3` /
// `hideEmpty !== false` fallbacks stay the renderer's facts, so "the author
// said nothing" survives the parse, and input === infer holds for both shapes.
// #8744 — the three record types the rail fix left behind
// (`RecordAlertActionSchema`, `RecordQuickActionsProps`, `RecordHistoryProps`),
// default-free on the same principle. `RecordAlertProps` itself is
// deliberately NOT pinned: its `visible` carries `ExpressionInputSchema`, whose
// bare-string arm TRANSFORMS to the canonical `{ dialect, source }` envelope,
// so input ≠ infer by construction — the alias stays `z.input` (the authoring
// face), per the convention's own rule for Expression-carrying shapes.
// The object-* block family (#7751; `ObjectFormPropsSchema` and
// `ObjectMasterDetailFormPropsSchema` are the members still pinned) —
// deliberately default-free in its first, warning-tier step ("the author said
// nothing" must stay distinguishable from "the author asked for the renderer's
// fallback"), so input === infer holds. A default added to any of them goes
// red here, and the fix is the ADR's: declare the XParsed alias and delete the
// pin line.
// `ObjectGridPropsSchema` (Iso839) left the family exactly that way on the
// ui#6207 convergence: its `data` now carries `ViewDataSchema`, whose own
// input ≠ infer, so `ObjectGridPropsParsed` is declared and the pin deleted.
// `ObjectMetricPropsSchema` (Iso840), `ObjectKanbanPropsSchema` (Iso841) and
// `ObjectCalendarPropsSchema` (Iso842) left the same way on #15449 — the
// ui#6206-B filter orthography reaching the four `object-*` `filter` doors:
// each now carries `z.array(ViewFilterRuleSchema)` (input ≠ infer), so the
// three `XParsed` aliases are declared and the three pins deleted.
export type Iso_ui_component__ObjectFormPropsSchema = Assert<Eq< z.input< typeof M170.ObjectFormPropsSchema >, z.infer< typeof M170.ObjectFormPropsSchema > >>;
export type Iso_ui_component__ObjectMasterDetailFormPropsSchema = Assert<Eq< z.input< typeof M170.ObjectMasterDetailFormPropsSchema >, z.infer< typeof M170.ObjectMasterDetailFormPropsSchema > >>;
export type Iso_ui_component__PageContainerProps = Assert<Eq< z.input< typeof M170.PageContainerProps >, z.infer< typeof M170.PageContainerProps > >>;
export type Iso_ui_component__RecordAlertActionSchema = Assert<Eq< z.input< typeof M170.RecordAlertActionSchema >, z.infer< typeof M170.RecordAlertActionSchema > >>;
export type Iso_ui_component__RecordHighlightsField = Assert<Eq< z.input< typeof M170.RecordHighlightsField >, z.infer< typeof M170.RecordHighlightsField > >>;
export type Iso_ui_component__RecordHistoryProps = Assert<Eq< z.input< typeof M170.RecordHistoryProps >, z.infer< typeof M170.RecordHistoryProps > >>;
export type Iso_ui_component__RecordPathProps = Assert<Eq< z.input< typeof M170.RecordPathProps >, z.infer< typeof M170.RecordPathProps > >>;
export type Iso_ui_component__RecordQuickActionsProps = Assert<Eq< z.input< typeof M170.RecordQuickActionsProps >, z.infer< typeof M170.RecordQuickActionsProps > >>;
export type Iso_ui_component__RecordReferenceRailProps = Assert<Eq< z.input< typeof M170.RecordReferenceRailProps >, z.infer< typeof M170.RecordReferenceRailProps > >>;
export type Iso_ui_component__ReferenceRailEntrySchema = Assert<Eq< z.input< typeof M170.ReferenceRailEntrySchema >, z.infer< typeof M170.ReferenceRailEntrySchema > >>;

// ui/dashboard.zod.ts
export type Iso_ui_dashboard__DashboardHeaderActionSchema = Assert<Eq< z.input< typeof M159.DashboardHeaderActionSchema >, z.infer< typeof M159.DashboardHeaderActionSchema > >>;
export type Iso_ui_dashboard__DashboardWidgetOptionsSchema = Assert<Eq< z.input< typeof M159.DashboardWidgetOptionsSchema >, z.infer< typeof M159.DashboardWidgetOptionsSchema > >>;
export type Iso_ui_dashboard__GlobalFilterOptionsFromSchema = Assert<Eq< z.input< typeof M159.GlobalFilterOptionsFromSchema >, z.infer< typeof M159.GlobalFilterOptionsFromSchema > >>;
export type Iso_ui_dashboard__WidgetActionTypeSchema = Assert<Eq< z.input< typeof M159.WidgetActionTypeSchema >, z.infer< typeof M159.WidgetActionTypeSchema > >>;
export type Iso_ui_dashboard__WidgetColorVariantSchema = Assert<Eq< z.input< typeof M159.WidgetColorVariantSchema >, z.infer< typeof M159.WidgetColorVariantSchema > >>;

// ui/dataset.zod.ts
export type Iso_ui_dataset__DatasetDimensionSchema = Assert<Eq< z.input< typeof M160.DatasetDimensionSchema >, z.infer< typeof M160.DatasetDimensionSchema > >>;
export type Iso_ui_dataset__DatasetMeasureSchema = Assert<Eq< z.input< typeof M160.DatasetMeasureSchema >, z.infer< typeof M160.DatasetMeasureSchema > >>;
export type Iso_ui_dataset__DatasetSchema = Assert<Eq< z.input< typeof M160.DatasetSchema >, z.infer< typeof M160.DatasetSchema > >>;
export type Iso_ui_dataset__DerivedMeasureOp = Assert<Eq< z.input< typeof M160.DerivedMeasureOp >, z.infer< typeof M160.DerivedMeasureOp > >>;

// ui/i18n.zod.ts
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
export type Iso_ui_i18n__AriaPropsSchema = Assert<Eq< z.input< typeof M161.AriaPropsSchema >, z.infer< typeof M161.AriaPropsSchema > >>;
export type Iso_ui_i18n__I18nLabelSchema = Assert<Eq< z.input< typeof M161.I18nLabelSchema >, z.infer< typeof M161.I18nLabelSchema > >>;

// ui/notification.zod.ts
export type Iso_ui_notification__NotificationPositionSchema = Assert<Eq< z.input< typeof M162.NotificationPositionSchema >, z.infer< typeof M162.NotificationPositionSchema > >>;
export type Iso_ui_notification__NotificationSeveritySchema = Assert<Eq< z.input< typeof M162.NotificationSeveritySchema >, z.infer< typeof M162.NotificationSeveritySchema > >>;
export type Iso_ui_notification__NotificationTypeSchema = Assert<Eq< z.input< typeof M162.NotificationTypeSchema >, z.infer< typeof M162.NotificationTypeSchema > >>;

// ui/page.zod.ts
// `ElementDataSourceSchema` (Iso694) left the family on #15442 — the ui#6206-B
// filter orthography reaching the binding-level `dataSource.filter`: it now
// carries `z.array(ViewFilterRuleSchema)`, whose own input ≠ infer (`operator`
// is normalized on parse), so `ElementDataSourceParsed` is declared and this
// pin deleted.
export type Iso_ui_page__PageComponentType = Assert<Eq< z.input< typeof M163.PageComponentType >, z.infer< typeof M163.PageComponentType > >>;
export type Iso_ui_page__PageTypeSchema = Assert<Eq< z.input< typeof M163.PageTypeSchema >, z.infer< typeof M163.PageTypeSchema > >>;

// ui/report.zod.ts
export type Iso_ui_report__JoinedReportBlockSchema = Assert<Eq< z.input< typeof M164.JoinedReportBlockSchema >, z.infer< typeof M164.JoinedReportBlockSchema > >>;
export type Iso_ui_report__ReportType = Assert<Eq< z.input< typeof M164.ReportType >, z.infer< typeof M164.ReportType > >>;

// ui/responsive.zod.ts
// (Iso696 `BreakpointName` / Iso697 `ResponsiveConfigSchema` removed with
// their schemas — #11027's ADR-0049 retirement of the responsive layout
// vocabulary.)
// (Iso824 `BreakpointColumnMapSchema` / Iso825 `BreakpointOrderMapSchema`
// removed with their schemas — #11027, see the Iso696/Iso697 note above.)
export type Iso_ui_responsive__ResponsiveStylesSchema = Assert<Eq< z.input< typeof M165.ResponsiveStylesSchema >, z.infer< typeof M165.ResponsiveStylesSchema > >>;
export type Iso_ui_responsive__StyleMapSchema = Assert<Eq< z.input< typeof M165.StyleMapSchema >, z.infer< typeof M165.StyleMapSchema > >>;

// ui/theme.zod.ts — its five pins (Iso700–Iso704) left with the module at #10485.

// ui/view.zod.ts
// (Iso829 `KanbanConfigSchema` left this list in #17393: the author-settable
// row ceiling `limit` APPLIES its default, which is exactly the "a nested field
// gains a `.default()`" event this file exists to catch — so the schema now has
// two shapes and `KanbanConfigParsed` is declared beside the bare alias, as
// ADR-0122 prescribes. Its two page-shaped siblings needed no line moved: both
// already carried defaults and therefore both halves of the pair.)
export type Iso_ui_view__CalendarConfigSchema = Assert<Eq< z.input< typeof M167.CalendarConfigSchema >, z.infer< typeof M167.CalendarConfigSchema > >>;
export type Iso_ui_view__ColumnSummaryConfigSchema = Assert<Eq< z.input< typeof M167.ColumnSummaryConfigSchema >, z.infer< typeof M167.ColumnSummaryConfigSchema > >>;
export type Iso_ui_view__ColumnSummarySchema = Assert<Eq< z.input< typeof M167.ColumnSummarySchema >, z.infer< typeof M167.ColumnSummarySchema > >>;
export type Iso_ui_view__FormButtonConfigSchema = Assert<Eq< z.input< typeof M167.FormButtonConfigSchema >, z.infer< typeof M167.FormButtonConfigSchema > >>;
export type Iso_ui_view__GanttConfigSchema = Assert<Eq< z.input< typeof M167.GanttConfigSchema >, z.infer< typeof M167.GanttConfigSchema > >>;
export type Iso_ui_view__GanttQuickFilterSchema = Assert<Eq< z.input< typeof M167.GanttQuickFilterSchema >, z.infer< typeof M167.GanttQuickFilterSchema > >>;
export type Iso_ui_view__ListMapConfigSchema = Assert<Eq< z.input< typeof M167.ListMapConfigSchema >, z.infer< typeof M167.ListMapConfigSchema > >>;
export type Iso_ui_view__NavigationModeSchema = Assert<Eq< z.input< typeof M167.NavigationModeSchema >, z.infer< typeof M167.NavigationModeSchema > >>;
export type Iso_ui_view__RowColorConfigSchema = Assert<Eq< z.input< typeof M167.RowColorConfigSchema >, z.infer< typeof M167.RowColorConfigSchema > >>;
export type Iso_ui_view__RowHeightSchema = Assert<Eq< z.input< typeof M167.RowHeightSchema >, z.infer< typeof M167.RowHeightSchema > >>;
export type Iso_ui_view__TreeConfigSchema = Assert<Eq< z.input< typeof M167.TreeConfigSchema >, z.infer< typeof M167.TreeConfigSchema > >>;
export type Iso_ui_view__UserFilterFieldSchema = Assert<Eq< z.input< typeof M167.UserFilterFieldSchema >, z.infer< typeof M167.UserFilterFieldSchema > >>;
export type Iso_ui_view__ViewItemNameSchema = Assert<Eq< z.input< typeof M167.ViewItemNameSchema >, z.infer< typeof M167.ViewItemNameSchema > >>;
export type Iso_ui_view__ViewItemSchema = Assert<Eq< z.input< typeof M167.ViewItemSchema >, z.infer< typeof M167.ViewItemSchema > >>;
export type Iso_ui_view__ViewItemWireSchema = Assert<Eq< z.input< typeof M167.ViewItemWireSchema >, z.infer< typeof M167.ViewItemWireSchema > >>;
export type Iso_ui_view__ViewKindSchema = Assert<Eq< z.input< typeof M167.ViewKindSchema >, z.infer< typeof M167.ViewKindSchema > >>;
export type Iso_ui_view__ViewScopeSchema = Assert<Eq< z.input< typeof M167.ViewScopeSchema >, z.infer< typeof M167.ViewScopeSchema > >>;
export type Iso_ui_view__VisualizationTypeSchema = Assert<Eq< z.input< typeof M167.VisualizationTypeSchema >, z.infer< typeof M167.VisualizationTypeSchema > >>;

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
  it('still declares all 789 isomorphic pins', () => {
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
    //
    // 839 -> 834 is #10485 — `Iso700`-`Iso704` DELETED with `ui/theme.zod.ts`
    // (ADR-0049 retirement of the whole theme authoring surface): the five
    // schemas they pinned no longer exist, so there is nothing left to exempt.
    // The Iso numbers are positional and stay vacant.
    //
    // 836 -> 837 is #11006's `PublishMetaItemRequestSchema` — the request half
    // of the door whose response half `Iso836` pinned (#7294), declared on the
    // 2026-08-22 maintainer ruling that also gave `MetadataProtocol` the
    // optional `publishMetaItem` member. Isomorphism MEASURED, not assumed:
    // the tree is two required `z.string()`s, three optional `z.string()`s and
    // one `z.string().nullable().optional()` — no `.default()`,
    // `.transform()`, `.catch()` or `.pipe()` anywhere — so the two shapes
    // coincide and ADR-0122 gives it a pin rather than an `XParsed`. Its id is
    // `Iso856`, the next free one — the ids are claims about pins, not
    // positions.
    //
    // 837 -> 833 is #11027's ADR-0049 retirement of the responsive layout
    // vocabulary (`BreakpointName`, `ResponsiveConfigSchema`,
    // `BreakpointColumnMapSchema`, `BreakpointOrderMapSchema` — Iso696/697/
    // 824/825): the four schemas no longer exist, so there is nothing left to
    // exempt. -4 retired, +0 of my own; the Iso numbers stay vacant.
    //
    // 833 -> 835 is #11678's `AuditMetaItemRequestSchema` /
    // `AuditMetaItemResponseSchema` — the audit door declared on the #11006
    // pattern (PR #12003). Isomorphism MEASURED, not assumed: the request is
    // two required `z.string()`s, a `z.string().nullable().optional()` and an
    // optional `z.number()`; the response is one `z.array` of a plain object
    // of strings, booleans, closed `z.enum`s, `.nullable()` strings and a
    // `z.unknown()` — no `.default()`, `.transform()`, `.catch()` or
    // `.pipe()` anywhere in either tree, so the two shapes coincide and
    // ADR-0122 gives each a pin rather than an `XParsed`. Ids `Iso857`/
    // `Iso858`, the next free ones — ids are claims about pins, not positions.
    //
    // 835 -> 834 is #12039's ui#6207 convergence: `ObjectGridPropsSchema.data`
    // now carries `ViewDataSchema`, whose own input ≠ infer (measured — the
    // Eq probe answers false on ViewDataSchema alone), so `object-grid` left
    // the default-free object-* family exactly the way that family's comment
    // prescribes: `ObjectGridPropsParsed` declared, the Iso839 pin deleted.
    // -1 converted to an `XParsed` pair; the Iso number stays vacant.
    //
    // 834 -> 837 is #11924's `CloneDataResponseSchema` /
    // `SearchAllHitSchema` / `SearchAllResponseSchema` — the `data.clone` and
    // global-search route response contracts, declared as produced. (Authored
    // as 835 -> 838; restated from the post-merge base after #12039's -1
    // landed first — the two changes touch disjoint pins.) Isomorphism
    // MEASURED, not assumed: all three trees are plain `z.object`s of
    // `z.string()` (some `.optional()`), `z.number()`, `z.boolean()`,
    // `z.record(z.string(), z.unknown())` and one `z.array` of the hit
    // object — no `.default()`, `.transform()`, `.catch()` or `.pipe()`
    // anywhere, so the two shapes coincide and ADR-0122 gives each a pin
    // rather than an `XParsed`. Ids `Iso859`/`Iso860`/`Iso861`, the next
    // free ones — ids are claims about pins, not positions.
    //
    // 837 -> 838 is #12194's `MetadataItemNameSchema` — the item-name grammar
    // (shared/identifiers.zod.ts). A bare `z.string().regex()` with no
    // `.default()`, `.transform()`, `.catch()` or `.pipe()`, so `z.input` and
    // `z.infer` are both `string` and ADR-0122 gives it a pin rather than an
    // `XParsed`, exactly like its three identifier siblings on the lines
    // above it. (Authored as 834 -> 835 with id `Iso859`; restated from the
    // post-merge base after #11924's +3 landed first and took 859-861 — the
    // pin was renumbered to `Iso862`, the next free one, because ids are
    // claims about pins, not positions.)
    //
    // 838 -> 837 is #12007's retirement of `CLICommandContributionSchema`
    // (kernel/cli-extension.zod.ts): its pin `Iso385` left with the schema —
    // the alias no longer exists, so there is nothing to be isomorphic. -1
    // removed; the Iso number stays vacant (ids are claims about pins, not
    // positions).
    //
    // 837 -> 833 is #13135's ADR-0049 retirement of the paper
    // metadata-customization protocol: `kernel/metadata-customization.zod.ts`
    // removed whole, so its four pins `Iso408`-`Iso411`
    // (`CustomizationOriginSchema` / `FieldChangeSchema` /
    // `MergeConflictSchema` / `MergeResultSchema`) left with the module. -4
    // removed; the Iso numbers and the `M86` module number stay vacant (ids
    // are claims about pins, not positions).
    //
    // 833 -> 835 is #12005's `HistoryMetaItemRequestSchema` /
    // `HistoryMetaItemResponseSchema` — the history door declared on the
    // #11006 pattern, exactly as #11678 (PR #12003) declared its audit twin.
    // Isomorphism MEASURED, not assumed: the request is two required
    // `z.string()`s, an optional `z.string()` and two optional
    // `z.number()`s; the response is one `z.array` of a plain object of
    // strings (some `.nullable()`, some `.optional()`), `z.number().int()`s,
    // one closed `z.enum` and one nested plain object of strings — no
    // `.default()`, `.transform()`, `.catch()` or `.pipe()` anywhere in
    // either tree, so the two shapes coincide and ADR-0122 gives each a pin
    // rather than an `XParsed`. Ids `Iso863`/`Iso864`, the next free ones —
    // ids are claims about pins, not positions.
    //
    // 835 -> 836 is #13353's `ProvenanceWaiverSchema` — the recorded waiver
    // that keeps a registered-code stamp site without an owner-key row a
    // decision instead of drift (the door-not-producer class). Isomorphism
    // MEASURED, not assumed: four `z.string()`s (three regex-, one
    // min-constrained — constraints refine, they do not reshape), with no
    // `.default()`, `.transform()`, `.catch()`, `.optional()` or `.pipe()`
    // anywhere, so the two shapes coincide and ADR-0122 gives it a pin rather
    // than an `XParsed` — the exact reasoning of its #8211 sibling `Iso838`
    // one entry up. Its id is `Iso865`, the next free one — ids are claims
    // about pins, not positions.
    //
    // 836 -> 835 is #13613's ADR-0049 retirement of `EventNameSchema`
    // (shared/identifiers.zod.ts): its pin `Iso499` left with the schema —
    // the alias no longer exists, so there is nothing to be isomorphic. The
    // three schemas that bound it keep their fields as plain `z.string()`;
    // the platform-checked event vocabulary is the closed `DataEventType` /
    // `BulkDataEventType` enums. -1 removed; the Iso number stays vacant
    // (ids are claims about pins, not positions).
    //
    // 835 -> 836 is #13216's `SearchAllPageHitSchema` — the published-page
    // hit of the global-search body (`pages`, the sibling array of
    // `SearchAllHitSchema`'s record hits), declared as produced like its
    // #11924 siblings one family up. Isomorphism MEASURED, not assumed: one
    // `z.literal('page')`, two required `z.string()`s and two optional
    // `z.string()`s — no `.default()`, `.transform()`, `.catch()` or
    // `.pipe()` anywhere, so the two shapes coincide and ADR-0122 gives it a
    // pin rather than an `XParsed`. Its id is `Iso866`, the next free one —
    // ids are claims about pins, not positions.
    //
    // 836 -> 835 is #12039's ui#6206 convergence (the card's Key 2):
    // `ElementNumberPropsSchema.filter` now carries `z.array(ViewFilterRuleSchema)`,
    // whose own input ≠ infer (`operator` is normalized on parse — measured:
    // `ViewFilterRuleParsed` already exists for exactly that reason), so
    // `element:number` left the isomorphic family the way ADR-0122 prescribes:
    // `ElementNumberPropsParsed` declared, the Iso818 pin deleted. -1 converted
    // to an `XParsed` pair; the Iso number stays vacant.
    //
    // 835 -> 832 is #13823's ADR-0049 retirement of `RestApiEndpoint.handlerStatus`
    // and the Route Coverage Report (api/plugin-rest-api.zod.ts): the
    // `HandlerStatusSchema` enum and the `RouteCoverageEntrySchema` /
    // `RouteCoverageReportSchema` defs left the module whole, so their pins
    // `Iso123` / `Iso125` / `Iso126` left with them — the aliases no longer
    // exist, so there is nothing to be isomorphic. The carrier
    // `RestApiEndpointSchema` keeps its `XParsed` pair (it has defaults), and
    // `api/plugin-rest-api.handler-status-retirement.test.ts` asserts the
    // absence of all six retired names on every public entry. -3 removed; the
    // Iso numbers stay vacant (ids are claims about pins, not positions).
    //
    // 832 -> 831 is #14691's ADR-0049 retirement of `crud.patterns` on
    // `CrudEndpointsConfigSchema` (api/rest-server.zod.ts): its value def
    // `CrudEndpointPatternSchema` had no other consumer and left the module
    // whole (RETIRED_DEFS_BY_MAJOR[18] `api/CrudEndpointPattern`), so its pin
    // `Iso188` left with it. `CrudOperation` (`Iso187`) stays — the enum is
    // still read by `GeneratedEndpointSchema.operation`. -1 removed; the Iso
    // number stays vacant.
    //
    // 831 -> 829 is #14825's typing of `KnowledgeRefreshPolicySchema.cron`
    // (ai/knowledge-source.zod.ts) with `CronExpressionInputSchema`: its
    // bare-string arm transforms to the `{ dialect: 'cron', source }` envelope,
    // so input ≠ infer by construction — for the policy itself (`Iso15`) and
    // for the `KnowledgeSourceSchema` that nests it under `refresh` (`Iso20`).
    // Both aliases gained their `XParsed` (`KnowledgeRefreshPolicyParsed`,
    // `KnowledgeSourceParsed`) in the same commit — the ADR-0122 D6 order:
    // declare the parsed name, THEN delete the pin. -2 removed; the Iso
    // numbers stay vacant.
    //
    // 829 -> 830 is #14168's `ValueDomainSchema` (shared/value-domain.zod.ts)
    // — the ONE standard-domain vocabulary the settings specifier and the
    // field slot now share (maintainer ruling 2026-09-02). A `z.enum` with no
    // default or transform: the (RISE) case, one new pin (`Iso867`).
    // `SpecifierValueDomainSchema` became an alias of it, so its own pin
    // (`Iso758`) stays and the two hold or fall together. +1 added.
    //
    // 825 -> 826 is #15676's `EpochMs` (shared/epoch.zod.ts) — the shared
    // epoch-millisecond instant that ruling B on #14478 declares as the first
    // of the duration rule's two structural exemptions. A bare
    // `z.number().int()` with no default and no transform: the (RISE) case,
    // one new pin (`Iso868`). +1 added.
    //
    // 830 -> 828 is #14180's ADR-0049 retirement of the `metadata:changed`
    // event payload (kernel/cluster.zod.ts): `MetadataChangedEventPayloadSchema`
    // — a MUST-emit contract nothing ever produced or consumed, whose
    // `z.bigint()` version could not cross a JSON transport — and the
    // `MetadataChangeOperationSchema` enum that existed only to type its
    // `operation` field left the module whole (RETIRED_DEFS_BY_MAJOR[18]
    // `kernel/MetadataChangedEventPayload` + `kernel/MetadataChangeOperation`),
    // so their pins `Iso393` / `Iso394` left with them — the aliases no longer
    // exist, so there is nothing to be isomorphic. `kernel/cluster.test.ts`
    // asserts the absence of both names on the module and the `./kernel`
    // entry. -2 removed; the Iso numbers stay vacant (ids are claims about
    // pins, not positions). (Authored as 829 -> 827; restated from the
    // post-merge base after #14168's +1 landed first — the two changes touch
    // disjoint pins.)
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const pins = self.match(/^export type Iso\w+ = Assert</gm) ?? [];
    // 828 -> 826 is #14676's ADR-0049 retirement of `connector.errorMapping`:
    // `ErrorMappingRuleSchema` and `ConnectorErrorCategorySchema` left whole
    // with the key (whole-def removal, `RETIRED_DEFS_BY_MAJOR[18]`), so the
    // two pins that named them (`Iso381` / `Iso382`) leave with the schemas.
    //
    // 826 -> 825 is #14406's ui#6206-B convergence of the LAST record-form
    // `filter` in `ComponentPropsMap`: `ElementRecordPickerPropsSchema.filter`
    // now carries `z.array(ViewFilterRuleSchema)`, whose own input ≠ infer
    // (`operator` is normalized on parse — `ViewFilterRuleParsed` exists for
    // exactly that reason), so `element:record_picker` left the isomorphic
    // family the way ADR-0122 prescribes and `element:number` did one entry
    // earlier: `ElementRecordPickerPropsParsed` declared, the Iso819 pin
    // deleted. -1 converted to an `XParsed` pair; the Iso number stays vacant
    // (ids are claims about pins, not positions).
    // 825 -> 812 is #15513's ADR-0049 whole-family retirement of the
    // incident-response, training and change-management schemas: the thirteen
    // isomorphic enums and objects those three modules declared (Iso525–Iso529,
    // Iso568–Iso572, Iso647–Iso649) left with their defs (whole-def removal,
    // `RETIRED_DEFS_BY_MAJOR[18]`), so the pins that named them leave with the
    // schemas; the M122 / M133 / M151 import slots stay vacant.
    //
    // 812 -> 813 is this branch's own `EpochMs` (#15676): the shared
    // epoch-instant schema arrived as module slot M185 with one isomorphic
    // pin (`Iso868`). The two movements are disjoint — the retirement drops
    // pins those three modules declared, this adds one no module had — so
    // the merged count is 825 - 13 + 1.
    //
    // 813 -> 815 is #16041's closed `timeDimensions[].dateRange` vocabulary
    // (data/analytics.zod.ts, module slot M55): `AnalyticsDateRangePresetSchema`
    // (a bare `z.enum` derived from `DATE_RANGE_PRESETS`) and
    // `AnalyticsDateRangeSchema` (its union with `z.array(z.string())`) — no
    // default, no transform on either arm, two new pins (`Iso869` / `Iso870`).
    // +2 added.
    //
    // 815 -> 811 is the ui#6206-B filter-orthography family convergence
    // (#15442 + #15449, decision batch #55, option A): `ElementDataSourceSchema`
    // (the binding-level `dataSource.filter`) and `ObjectMetricPropsSchema` /
    // `ObjectKanbanPropsSchema` / `ObjectCalendarPropsSchema` (three of the four
    // `object-*` `filter` doors; `object-grid` had already left on ui#6207) now
    // carry `z.array(ViewFilterRuleSchema)`, whose own input ≠ infer, so each
    // left the isomorphic family the way ADR-0122 prescribes: the `XParsed`
    // alias declared, the pin deleted. -4 converted to `XParsed` pairs; the
    // Iso numbers stay vacant (ids are claims about pins, not positions).
    //
    // 811 -> 782 is #16325, the `./cloud` subpath leaving `@objectstack/spec`
    // (maintainer ruling, option B "cut by owner"): the six control-plane
    // modules — `cloud/app-store` (6 pins), `developer-portal` (5),
    // `environment-package` (2), `environment` (7), `marketplace-admin` (5),
    // `tenant` (5) — left with their 30 pins (module slots M45–M49 and M54 are
    // vacant), and `EnvironmentTypeSchema` moved with its only open-source
    // reader to `api/discovery.zod.ts` (M17), where it is pinned again as
    // `Iso871`. The four package-format modules (M50–M53) moved to
    // `marketplace/` and kept their pins. -30 + 1.
    //
    // 782 -> 783 is #16659's `ScheduleOrganizationSchema`
    // (automation/schedule-organization.zod.ts, new module slot M186): the
    // acting organization a time-triggered flow declares, a bare
    // `z.string().min(1)` — no coercion, no default, no transform, because an
    // organization id is written exactly as it is stored. The (RISE) case, one
    // new pin. +1 added.
    //
    // ⚠️ Worth one line on how it ARRIVED, because the module is not new — only
    // its NAME is. It shipped in the same card as `schedule-organization.ts`,
    // and every gate in this family reads `*.zod.ts` only, so neither this pin
    // file nor `check:spec-parsed-alias` could see it. Renaming the file to
    // `.zod.ts` is what asked the question, and the answer was a real ADR-0122
    // violation (`z.infer` on the bare alias) sitting green behind an extension.
    //
    // ⚠️ Its id took a SECOND number on the merge, and that is the interesting
    // half: this branch authored the pin as `Iso871` while #16325 landed its
    // own `Iso871` (`EnvironmentTypeSchema`) on `main`. The two additions are
    // disjoint pins, so the text merge took BOTH lines with no conflict marker
    // and left two declarations sharing one id — a duplicate-identifier error
    // tsc catches, but only after a merge that read clean. Renumbered here to
    // `Iso872`, the next free id after the merged file's maximum; ids are
    // claims about pins, not positions, so the collision costs nothing but a
    // number. The merged count is 811 - 30 + 1 + 1.
    //
    // 783 -> 785 is #18122's closed DURATION vocabulary (shared/duration.zod.ts,
    // new module slot M187): `DurationMs` and `DurationSeconds`, the declared
    // half of ruling A on #18115 and the counterpart of `EpochMs` (`Iso868`)
    // one block above. Both are `z.number().int().nonnegative()` with no
    // default and no transform — the (RISE) case twice, two new pins. +2 added.
    //
    // Note what these two pins are FOR, because the schemas are trivial and the
    // reason is not: the whole point of the vocabulary is that the unit rides on
    // the VALUE, so a site composes `DurationSeconds.default(60 * 60 * 24)`
    // rather than the type carrying a default of its own. The day someone moves
    // that default onto the shared type instead, author state and parsed state
    // part company for every key in the family at once, and these are the lines
    // that say so by name.
    // 785 -> 783 is #16059's ADR-0049 retirement of the startup ORCHESTRATION
    // surface (kernel/startup-orchestrator.zod.ts, module slot M104):
    // `HealthStatusSchema` (`Iso467`) and `StartupOrchestrationResultSchema`
    // (`Iso469`) left with their defs (whole-def removal,
    // `RETIRED_DEFS_BY_MAJOR[18]` `kernel/HealthStatus` +
    // `kernel/StartupOrchestrationResult`), so the pins that named them leave
    // with the schemas — there is nothing left to be isomorphic. The module
    // slot stays occupied and `Iso468` stays with it: the maintainer ruling
    // KEEPS `PluginStartupResultSchema`, re-declared against the shape
    // `@objectstack/core` ships, and it is still the (RISE) case — every new
    // member is `.optional()` with no default and no transform, so author
    // state and parsed state still coincide. -2 removed; the Iso numbers stay
    // vacant (ids are claims about pins, not positions).
    //
    // Worth one line on the member that could have moved it: the deprecated
    // `startTime` alias is mirrored, not defaulted. The day someone writes
    // `startTime: durationMs`-style `.default()` or a `.transform()` that
    // fills one member from another, this pin is the line that says the alias
    // has gained a second shape.
    // 783 -> 785 is #18451's build-progress PHASE vocabulary
    // (ai/build-progress.zod.ts, new module slot M188): `BuildProgressPhase`
    // and `BuildProgressFrame`, the (RISE) case twice. The enum is a bare
    // `z.enum` like the `ConnectorActionEffectSchema` pin that first taught
    // this count to rise; the frame is a `z.looseObject` of one enum and two
    // plain optionals. Neither carries a default or a transform, so no
    // `XParsed` is declared and both come here instead. +2 added.
    //
    // Note the number is the same 783 -> 785 the DURATION block above records,
    // arrived at from the same 783 after #16059's retirement took it back down.
    // The two entries are different movements that share a pair of endpoints.
    // 785 -> 784 is #17393's author-settable row ceiling on the page-shaped
    // view configs (ui/view.zod.ts, module slot M167): `KanbanConfigSchema`
    // gained a `limit` member whose default is APPLIED, which is the "a nested
    // field gains a `.default()`" event at the top of this file, one level in.
    // Author state and parsed state part company, so the pin left and
    // `KanbanConfigParsed` is declared beside the bare alias. Its two siblings
    // in that card moved no line: `GalleryConfig` and `TimelineConfig` already
    // carried defaults (`coverFit` / `cardSize`, `scale`) and therefore already
    // carried both halves of the pair — which is also why only ONE of the three
    // was ever on this list. -1 converted to an `XParsed` pair; the Iso number
    // stays vacant (ids are claims about pins, not positions).
    // 784 -> 787 is #17551's ADR-0021 dataset selection (api/analytics.zod.ts,
    // module slot M11): `DatasetSelectionSchema` and the two nested directives
    // `DatasetCompareToSchema` / `DatasetTotalsSchema`, the (RISE) case three
    // times. The selection takes its seven shared members straight off
    // `AnalyticsQuerySchema.shape` — already pinned isomorphic as Iso300 — and
    // the four it adds carry no default, transform, catch or pipe, so no
    // `XParsed` is declared and all three come here instead. +3 added.
    //
    // 787 -> 789 is #15178's translation bundle split (system/translation.zod.ts,
    // module slot M152): `PlatformTranslationDataSchema` and
    // `PlatformTranslationBundleSchema`, the (RISE) case twice. The platform
    // face is the per-app shape plus one more `.optional()` group and the
    // bundle is a `z.record` of it, so neither gains a default or a transform —
    // the same reason `TranslationDataSchema` and `TranslationBundleSchema`
    // were already on this list, which is what makes their new siblings belong
    // here rather than carrying a permanent `XParsed` synonym. +2 added. The
    // two movements were authored in parallel off the same 784 and both took
    // Iso877/Iso878; #17551 landed on main first, so its ids stand and this
    // card's pins renumbered to Iso880/Iso881 — ids are claims about pins, not
    // positions, so the renumbering asserts nothing new.
    //
    // 789 -> 789 is #19665, which moves no pin in or out: it RENAMES every
    // pin. The dense counter these receipts allocate from — "the next free id"
    // — let two branches off one base give one name to two different schemas,
    // and git merged each pair cleanly because the two insertion points sat far
    // apart: `Iso871` above, then `Iso877` / `Iso878` — each a duplicate
    // identifier that no merge flags and only the type-check of this file
    // reports. So each pin is now named for its module and schema, and the
    // block is sorted by that name (the rule is written at the head of the
    // list). Every `IsoNNN` cited above is a pin's former name,
    // true of the file when its entry was written, like the counts beside it.
    // The set `check:spec-parsed-alias` reads is identical member for member,
    // and so is each assertion — only the names moved. +0.
    expect(pins).toHaveLength(789);

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

