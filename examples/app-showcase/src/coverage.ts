// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Coverage manifest — the soul of the showcase.
 *
 * This module declares *what the showcase is supposed to cover* and provides
 * the helpers the coverage test uses to prove it. The test (see
 * `test/coverage.test.ts`) introspects the protocol's own contracts at TWO
 * levels and asserts the showcase keeps up with both:
 *
 *   • Kind level — `DEFAULT_METADATA_TYPE_REGISTRY` (the definitive list of
 *     metadata kinds). Every kind must be either `demonstrated` (with the
 *     files that prove it) or explicitly `waived` (with a reason and a
 *     GitHub issue). A new registry kind fails CI until it is accounted for,
 *     and a silently-dropped demo fails the file-existence check. No kind
 *     can go missing without leaving a paper trail (Prime Directive #10:
 *     never advertise a capability the runtime doesn't deliver — and never
 *     let a gap hide).
 *
 *   • Variant level — the spec's own Zod enums (`FieldTypeSchema`,
 *     `ChartTypeSchema`, `ReportType`, `ActionType`, `ACTION_LOCATIONS`).
 *     Every member must appear at least once across the registered metadata.
 *
 * Because the expected sets come from the *spec*, the tests fail
 * automatically when the platform gains a new kind, field type, chart type,
 * or report type that the showcase has not yet demonstrated — keeping this
 * example a living conformance fixture, not a static snapshot.
 */

import type { MetadataType } from '@objectstack/spec/kernel';

/**
 * Kind-level coverage entry: either the showcase demonstrates the kind (and
 * `files` point at the proof, relative to the package root), or it is waived
 * with a reason and the GitHub issue that tracks closing the gap.
 */
export type KindCoverage =
  | { status: 'demonstrated'; files: string[]; notes?: string }
  | { status: 'waived'; reason: string; issue: string };

const ISSUE = {
  aiDeferred: 'https://github.com/objectstack-ai/framework/issues/2610',
  noAuthoringSurface: 'https://github.com/objectstack-ai/framework/issues/2613',
} as const;

/**
 * Every metadata kind in `DEFAULT_METADATA_TYPE_REGISTRY`, accounted for.
 * The coverage test enumerates the registry and fails on any kind missing
 * here (new platform kind) or any entry the registry no longer knows
 * (stale manifest).
 */
export const KIND_COVERAGE: Record<MetadataType, KindCoverage> = {
  // ── data ──
  object: {
    status: 'demonstrated',
    files: ['src/data/objects/index.ts', 'src/data/objects/field-zoo.object.ts'],
  },
  field: {
    status: 'demonstrated',
    files: ['src/data/objects/field-zoo.object.ts'],
    notes:
      'FieldSchema is authored inline on objects (the stack DSL has no standalone `fields` collection); field-zoo exhausts every field type — see the variant-level test.',
  },
  validation: {
    status: 'demonstrated',
    files: [
      'src/data/objects/account.object.ts',
      'src/data/objects/task.object.ts',
      'src/data/objects/project.object.ts',
      'src/data/objects/invoice.object.ts',
    ],
    notes:
      'Authored inline via object `validations`. Every declared rule type is now write-path enforced (rule-validator dispatches all of state_machine/script/cross_field/format/json_schema/conditional — ADR-0020 "no silent no-ops", closing the #1475 gap) and each is demonstrated: state_machine (task/project), script+cross_field (project), format/json_schema/conditional (account). Field-level requiredWhen/readonlyWhen are likewise enforced and demonstrated on invoice.',
  },
  hook: { status: 'demonstrated', files: ['src/data/hooks/index.ts'] },
  seed: { status: 'demonstrated', files: ['src/data/seed/index.ts'] },
  mapping: {
    status: 'demonstrated',
    files: ['src/data/mappings/index.ts'],
    notes:
      'Named import mapping resolved via mappingName at POST /data/:object/import (#2611); promoted to a registry kind per the ADR-0088 admission test.',
  },

  // ── ui ──
  view: { status: 'demonstrated', files: ['src/ui/views/task.view.ts', 'src/ui/views/project.view.ts'] },
  page: { status: 'demonstrated', files: ['src/ui/pages/index.ts'] },
  dashboard: { status: 'demonstrated', files: ['src/ui/dashboards/chart-gallery.dashboard.ts'] },
  app: { status: 'demonstrated', files: ['src/ui/apps/index.ts'] },
  action: { status: 'demonstrated', files: ['src/ui/actions/index.ts'] },
  report: { status: 'demonstrated', files: ['src/ui/reports/index.ts'] },
  dataset: { status: 'demonstrated', files: ['src/ui/datasets/index.ts'] },

  // ── automation ──
  flow: { status: 'demonstrated', files: ['src/automation/flows/index.ts'] },
  job: { status: 'demonstrated', files: ['src/automation/jobs/index.ts'] },

  // ── system ──
  datasource: {
    status: 'demonstrated',
    files: ['src/system/datasources/showcase-external.datasource.ts'],
  },
  external_catalog: {
    status: 'waived',
    reason:
      'PERMANENT by design (ADR-0088): a runtime-created snapshot produced by Setup → Datasources → Sync (ADR-0062). A package shipping one would be stale on arrival; the showcase demos the federation flow that produces it.',
    issue: ISSUE.noAuthoringSurface,
  },
  translation: { status: 'demonstrated', files: ['src/system/translations/index.ts'] },
  email_template: { status: 'demonstrated', files: ['src/system/emails/index.ts'] },
  doc: {
    status: 'demonstrated',
    files: ['src/docs/showcase_index.md', 'src/docs/showcase_tour_data.md'],
    notes: 'Includes the five per-domain guided-tour docs (showcase_tour_*) with live metadata embeds (ADR-0051).',
  },
  book: {
    status: 'demonstrated',
    files: ['src/system/books/index.ts'],
    notes: 'ShowcaseBook curates a Guided Tour group in fixed domain order.',
  },

  // ── security ──
  permission: {
    status: 'demonstrated',
    files: ['src/security/permission-sets.ts'],
    notes:
      'Full ADR-0090 authoring surface: CRUD+FLS+RLS, scope depth (own/org read-write asymmetry; hierarchy depths are enterprise hierarchy-security), VAMA, system permissions, the isDefault everyone-suggestion (D5), guest-safe capability (D9), and adminScope delegated administration (D12). Snapshot-gated by access-matrix.json (D6). tabPermissions is not demoable in a single-app package (ADR-0019 D3).',
  },
  position: {
    status: 'demonstrated',
    files: ['src/security/positions.ts'],
    notes: 'Flat positions only (no hierarchy — ADR-0090 D3); everyone/guest are built-in anchors, never declared.',
  },

  // ── ai ──
  agent: {
    status: 'waived',
    reason:
      'Agents are platform-owned — the kernel ships exactly ask/build and third parties never author *.agent.ts (ADR-0063). The in-UI AI runtime is cloud-only; the open framework exposes AI via @objectstack/mcp.',
    issue: ISSUE.aiDeferred,
  },
  tool: {
    status: 'waived',
    reason:
      'Deferred with the AI examples iteration — tools are the third-party AI extension primitive (ADR-0063) and belong here once the BYO-AI (MCP) verification story is worked out.',
    issue: ISSUE.aiDeferred,
  },
  skill: {
    status: 'waived',
    reason:
      'Deferred with the AI examples iteration — skills are the third-party AI extension primitive (ADR-0063) and belong here once the BYO-AI (MCP) verification story is worked out.',
    issue: ISSUE.aiDeferred,
  },
};

/**
 * Stack collections that are not registry kinds but that the showcase tracks
 * for ≥ app-crm parity. Same demonstrated-or-waived contract as
 * `KIND_COVERAGE`.
 */
export const STACK_COLLECTION_COVERAGE: Record<string, KindCoverage> = {
  analyticsCubes: {
    status: 'demonstrated',
    files: ['src/data/analytics/showcase.cube.ts'],
    notes:
      'Served by the foundational analytics capability (/api/v1/analytics/*); complements the dataset semantic layer (ADR-0021).',
  },
  objectExtensions: {
    status: 'demonstrated',
    files: ['src/data/extensions/account.extension.ts'],
    notes: 'Merged into showcase_account by the ObjectQL engine at registerApp (priority overlay).',
  },
  apis: {
    status: 'demonstrated',
    files: ['src/system/apis/index.ts'],
    notes:
      'Declarative ApiEndpoint metadata (object_operation + flow targets), executed by the runtime dispatcher (handleApiEndpoint). Complements the code-mounted endpoint in src/system/server/ (router kind stays waived: code-only).',
  },
  connectors: {
    status: 'demonstrated',
    files: ['src/system/connectors/index.ts', 'src/automation/flows/index.ts'],
    notes:
      'Both connector kinds are demonstrated. (1) Provider-bound INSTANCE (ADR-0096 / #2977): StatusApiConnector declares `provider: rest` and is materialized into a live, dispatchable connector at boot by ConnectorRestPlugin\'s provider factory — ShowcaseDeclarativeConnectorPingFlow calls it via connector_action and it appears in GET /connectors. (2) Catalog DESCRIPTOR (#2612): ErpCatalogConnector has no provider, so it stays inert metadata; enabled:false marks the deliberate catalog entry and silences the boot audit. Plugin-registered connectors (ConnectorRestPlugin/ConnectorSlackPlugin in objectstack.config.ts) are also exercised by the connector flows.',
  },
};

/** List-view visualisation types (ListViewSchema `type`). */
export const LIST_VIEW_TYPES = [
  'grid',
  'kanban',
  'gallery',
  'calendar',
  'timeline',
  'gantt',
  'map',
  'chart',
] as const;

/** Form-view layout types (FormViewSchema `type`). */
export const FORM_VIEW_TYPES = ['simple', 'tabbed', 'wizard', 'split', 'drawer'] as const;

/**
 * Human/CI-readable map of each coverage dimension to where it is exercised.
 * Useful as documentation and as a checklist when extending the showcase.
 */
export const COVERAGE = {
  fieldTypes: {
    source: 'FieldTypeSchema',
    coveredBy: 'data/objects/field-zoo.object.ts (+ relationship/date/select fields on the backbone objects)',
  },
  relationships: {
    coveredBy: [
      'lookup → project.account, category.parent (self-referencing tree)',
      'master_detail → task.project, project_membership.{team,project}',
      'many-to-many → showcase_project_membership junction',
    ],
  },
  listViewTypes: {
    expected: LIST_VIEW_TYPES,
    coveredBy: 'ui/views/task.view.ts (all 8) + ui/views/project.view.ts',
  },
  formViewTypes: {
    expected: FORM_VIEW_TYPES,
    coveredBy: 'ui/views/task.view.ts formViews (simple/tabbed/wizard/split/drawer)',
  },
  chartTypes: {
    source: 'ChartTypeSchema',
    coveredBy: 'ui/dashboards/chart-gallery.dashboard.ts (one widget per chart family)',
  },
  reportTypes: {
    source: 'ReportType',
    coveredBy: 'ui/reports/index.ts (tabular/summary/matrix/joined)',
  },
  actionTypesAndLocations: {
    source: 'ActionType + ACTION_LOCATIONS',
    coveredBy: 'ui/actions/index.ts (script/url/flow/modal/api/form across all locations)',
  },
  flowNodeTypes: {
    source: 'FlowNodeAction',
    coveredBy:
      'automation/flows/index.ts — CRUD quartet (create: InboundTaskWebhookFlow, update: ReassignWizardFlow, get+delete: InquiryPurgeFlow), screen/approval/wait/subflow/map/connector_action across the chain; BPMN gateway/boundary forms waived (FLOW_NODE_WAIVERS) in favor of the ADR-0031 structured containers.',
  },
  capabilityChains: {
    security:
      'security/* — positions + permission sets (CRUD + FLS + RLS + depth + VAMA + system/tab permissions + adminScope) + sharing rules (position & BU-subtree recipients) + per-object OWD/externalSharingModel + seeded sys_business_unit tree + access-matrix.json gate (ADR-0090)',
    automation: 'automation/flows/index.ts (incl. approval nodes) + automation/webhooks/index.ts + automation/jobs/index.ts + system/emails/index.ts',
  },
  i18nThemingPortals: {
    coveredBy: 'system/translations/index.ts (en + zh-CN), ui/themes/index.ts (light + dark), ui/portals/index.ts',
  },
  docs: {
    source: 'ADR-0046 (doc metadata)',
    coveredBy: 'src/docs/*.md — flat Markdown compiled to `doc` items: frontmatter title + first-heading title, cross-references with anchors, namespace-prefixed names',
  },
} as const;

/**
 * Built-in flow node types (FlowNodeAction) the showcase deliberately does
 * not author, with the reason. The coverage test asserts every OTHER member
 * of the enum appears in at least one flow, and that each waiver names a
 * real enum member with a substantive reason — same demonstrated-or-waived
 * contract as the metadata kinds.
 */
export const FLOW_NODE_WAIVERS: Record<string, string> = {
  parallel_gateway:
    'BPMN-interop lowering target — the author-facing form is the ADR-0031 structured `parallel` container (FanOutNotifyFlow); bpmn-mapping lowers it to the gateway pair.',
  join_gateway:
    'The AND-join half of the pair bpmn-mapping derives from a structured `parallel` container — never hand-authored in examples.',
  boundary_event:
    'BPMN-interop form; the author-facing equivalents the showcase demos are the ADR-0031 `try_catch` container (ResilientSyncFlow) and `wait` timers (TaskFollowUpFlow).',
};

/**
 * Collect every node `type` used across a set of flow definitions, including
 * nodes nested inside structured-container regions (ADR-0031: a `parallel` /
 * `loop` / `try_catch` container carries sub-graphs in its config).
 */
export function collectFlowNodeTypes(flows: Array<{ nodes?: Array<Record<string, unknown>> }>): Set<string> {
  const used = new Set<string>();
  const visitNodes = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      if (typeof n.type === 'string') used.add(n.type);
      if (n.config) visitContainer(n.config);
    }
  };
  // Walk any nested { nodes: [...] } region a container config may carry.
  const visitContainer = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const v of value) visitContainer(v); return; }
    const obj = value as Record<string, unknown>;
    for (const [key, v] of Object.entries(obj)) {
      if (key === 'nodes') visitNodes(v);
      else visitContainer(v);
    }
  };
  for (const flow of flows) visitNodes(flow.nodes);
  return used;
}

/** Collect every field `type` used across a set of object definitions. */
export function collectFieldTypes(objects: Array<{ fields?: Record<string, { type?: string }> }>): Set<string> {
  const used = new Set<string>();
  for (const obj of objects) {
    for (const field of Object.values(obj.fields ?? {})) {
      if (field?.type) used.add(field.type);
    }
  }
  return used;
}

/** Collect every list-view `type` from a set of `defineView` results. */
export function collectListViewTypes(views: Array<{ list?: { type?: string }; listViews?: Record<string, { type?: string }> }>): Set<string> {
  const used = new Set<string>();
  for (const view of views) {
    if (view.list?.type) used.add(view.list.type);
    for (const lv of Object.values(view.listViews ?? {})) {
      if (lv?.type) used.add(lv.type);
    }
  }
  return used;
}

/** Collect every form-view `type` from a set of `defineView` results. */
export function collectFormViewTypes(views: Array<{ formViews?: Record<string, { type?: string }> }>): Set<string> {
  const used = new Set<string>();
  for (const view of views) {
    for (const fv of Object.values(view.formViews ?? {})) {
      if (fv?.type) used.add(fv.type);
    }
  }
  return used;
}
