// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata admin i18n bundle (Phase 3f).
 *
 * Lightweight static label table for the 27 built-in metadata types,
 * plus a tiny `t()` helper for engine UI strings.
 *
 * Why not i18next? The engine already consumes `label` from the
 * server's `/meta/types` response (which is sourced from
 * `DEFAULT_METADATA_TYPE_REGISTRY`). This bundle exists as a fallback
 * for environments without translation bundles configured, and as the
 * single source of truth for Chinese labels until the platform's
 * `setup.translation.ts` ships zh-CN coverage.
 *
 * Usage:
 *   import { translateMetadataType, t } from './i18n';
 *   translateMetadataType('view', 'zh-CN')  // → '视图'
 *   t('engine.directory.title', 'zh-CN')    // → '元数据'
 *
 * The DirectoryPage / PageShell call these to localise headings when
 * the consumer hasn't wired the global i18n provider.
 *
 * ## Typographic convention: the ellipsis is U+2026 `…`, never `...`
 *
 * Values here end (or interrupt) with the typographic ellipsis `…`, not three
 * ASCII full stops — per the maintainer-authorized consistency pass registered
 * on objectstack#6015 (2026-08-09), which objectui#3878 applied to the ten
 * locale packs in `packages/i18n/src/locales/`.
 *
 * This table is NOT one of those packs: the designer carries its own flat
 * `Record` of dotted keys with `en` and `zh` in one file, so
 * `packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts` — which scans the
 * ten packs and says so in its own header — deliberately does not reach it.
 * The convention is therefore held by this note rather than by a gate
 * (objectui#4377: generalising that pin to a second table shape was costed as
 * more machinery than the defect is worth). Follow it when adding a value; the
 * designer renders inside the console shell, so a `...` here lands on the same
 * screen as a `…` from the packs.
 *
 * ## Moving into `@object-ui/i18n` (objectstack#25922)
 *
 * The maintainer's ruling 6431032267 (Q2 = A, kept by the re-ruling
 * 6431234244) reopened the objectui#4662 carve-out: this table becomes the
 * `studio` namespace of `@object-ui/i18n` (`packages/i18n/src/namespaces/studio/`),
 * one lazy namespace carrying the existing `en` and `zh` text, every other
 * language falling back to `en`. It moves in slices. Until the last one, a key
 * lives either here or there, never both, and every lookup below asks this
 * table first and the namespace second (`lookupString`), so no call site
 * changes. `packages/i18n/README.md`, section "Scope — the Studio designer
 * strings", is the conventions-side record; keep the two in step.
 *
 * What has not changed for the keys still here: only `en` and `zh` exist, so
 * the other eight shipped locales render English on these screens, and the
 * pack gates do not read this module (`scripts/check-i18n-call-site-keys.mjs`
 * skips it by declaration). `check:i18n-designer-parity` reads both homes.
 */

import { useObjectTranslation } from '@object-ui/i18n';
// The designer strings' new home. Its `en` catalogue is resident; its other
// catalogues are fetched on demand, and `useMetadataLocale()` re-renders its
// caller when one lands. ⚠️ `ui/scripts/check-i18n-dead-keys.mjs` reads the
// namespace's catalogues as part of this table BECAUSE this module imports it:
// drop the import and the gates stop reading them.
import { studioString, useStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
// Type-only (erased at build): the overlay-scope and lock-state label tables
// below are keyed by their producer's own union rather than by hand — see
// `LAYER_SCOPE_ZH` and `LOCK_STATE_ZH`.
import type {
  MetadataAuditEntry,
  MetadataOverlayScope,
} from '@object-ui/data-objectstack';

export type SupportedLocale = 'en-US' | 'zh-CN';

const TYPE_LABELS_EN: Record<string, string> = {
  // Data
  object: 'Object',
  field: 'Field',
  trigger: 'Trigger',
  validation: 'Validation Rule',
  hook: 'Hook',
  // UI
  view: 'View',
  page: 'Page',
  dashboard: 'Dashboard',
  app: 'Application',
  action: 'Action',
  report: 'Report',
  // Automation
  flow: 'Flow',
  // ADR-0020: `workflow` retired as a metadata type.
  approval: 'Approval Process',
  // System
  datasource: 'Datasource',
  translation: 'Translation',
  router: 'Router',
  function: 'Function',
  service: 'Service',
  email_template: 'Email Template',
  book: 'Documentation Book',
  doc: 'Documentation',
  // Security — ADR-0090: profile removed (D2), role renamed to position (D3).
  permission: 'Permission Set',
  position: 'Position',
  // AI
  agent: 'AI Agent',
  tool: 'AI Tool',
  skill: 'AI Skill',
  // Platform
  package: 'Package',
  data: 'Dataset',
  job: 'Background Job',
  // New in spec 7.1 — externally surfaced metadata types that did not
  // ship with a human-readable label in the framework registry.
  api: 'API Endpoint',
  connector: 'Connector',
  mapping: 'Field Mapping',
  policy: 'Policy',
  webhook: 'Webhook',
  theme: 'Theme',
  sharing_rule: 'Sharing Rule',
  analytics_cube: 'Analytics Cube',
  picklist: 'Picklist',
};

const TYPE_LABELS_ZH: Record<string, string> = {
  object: '对象',
  field: '字段',
  trigger: '触发器',
  validation: '校验规则',
  hook: '钩子',
  view: '视图',
  page: '页面',
  dashboard: '仪表板',
  app: '应用',
  action: '操作',
  report: '报表',
  flow: '流程',
  // ADR-0020: `workflow` 已不再是独立元数据类型。
  approval: '审批流程',
  datasource: '数据源',
  translation: '翻译',
  router: '路由',
  function: '函数',
  service: '服务',
  email_template: '邮件模板',
  book: '文档手册',
  doc: '文档',
  permission: '权限集',
  position: '岗位',
  agent: 'AI 智能体',
  tool: 'AI 工具',
  skill: 'AI 技能',
  package: '包',
  data: '数据集',
  job: '后台任务',
  // New in spec 7.1.
  api: 'API 端点',
  connector: '连接器',
  mapping: '字段映射',
  policy: '策略',
  webhook: 'Webhook 回调',
  theme: '主题',
  sharing_rule: '共享规则',
  analytics_cube: '分析立方体',
  picklist: '选项列表',
};

const DOMAIN_LABELS_EN: Record<string, string> = {
  data: 'Data',
  ui: 'UI',
  automation: 'Automation',
  ai: 'AI',
  system: 'System',
  platform: 'Platform',
  identity: 'Identity',
  security: 'Security',
  other: 'Other',
};

const DOMAIN_LABELS_ZH: Record<string, string> = {
  data: '数据',
  ui: '界面',
  automation: '自动化',
  ai: 'AI',
  system: '系统',
  platform: '平台',
  identity: '身份',
  security: '安全',
  other: '其他',
};

const ENGINE_STRINGS_EN: Record<string, string> = {
  'engine.directory.title': 'All Metadata Types',
  'engine.directory.description':
    'The platform protocol exposes {count} metadata types ({writable} writable at runtime). Click any tile to browse, override, or create instances.',
  'engine.directory.search': 'Search metadata types…',
  'engine.directory.writableOnly': 'Writable only',
  'engine.directory.quickFind': 'Quick Find',
  'engine.directory.noMatches': 'No matches',
  'engine.directory.noMatchesHint': 'Adjust your search or filters to see more metadata types.',
  'engine.directory.loading': 'Loading metadata types…',
  'engine.directory.loadFailed': 'Failed to load metadata types',
  'engine.directory.all': 'All',
  'engine.directory.diagnosticsLink': 'View all issues ({count})',
  'engine.directory.invalidTooltip': '{count} invalid item(s) — click to fix',
  'engine.directory.warnTooltip': '{count} item(s) with warnings',
  'engine.directory.itemCountTooltip': '{count} item(s) of this type',
  'engine.home.recent': 'Recently viewed',
  'engine.diagnostics.title': 'Metadata Diagnostics',
  'engine.diagnostics.description':
    'Every metadata item that failed load-time validation, grouped by type. Errors block features that depend on the item; warnings are advisory.',
  'engine.diagnostics.back': 'Back to metadata',
  'engine.diagnostics.refresh': 'Refresh',
  'engine.diagnostics.loading': 'Scanning metadata…',
  'engine.diagnostics.loadFailed': 'Failed to load diagnostics: {error}',
  'engine.diagnostics.summary': '{count} issue(s) across {items} items in {types} types',
  'engine.diagnostics.cleanTitle': 'All clear',
  'engine.diagnostics.cleanHint': 'Scanned {items} item(s) across {types} type(s) — no issues found.',
  'engine.diagnostics.severity.error': 'Errors',
  'engine.diagnostics.severity.warning': 'Errors + Warnings',
  'engine.diagnostics.col.name': 'Item',
  'engine.diagnostics.col.issues': 'Issues',
  'engine.diagnostics.errorN': '{count} error(s)',
  'engine.diagnostics.warnN': '{count} warning(s)',
  'engine.diagnostics.more': '+{count} more…',
  'engine.list.create': 'New',
  'engine.list.refresh': 'Refresh',
  'engine.list.search': 'Search name, label, description…',
  'engine.list.empty': 'No items yet.',
  'engine.list.items': 'Items',
  'engine.list.filtered': 'Filtered',
  'engine.list.itemCount': '{count} items',
  'engine.list.itemCountOne': '1 item',
  'engine.list.invalid': 'Invalid',
  'engine.list.warnings': 'Warnings',
  'engine.list.invalidTitle': 'Invalid metadata',
  'engine.list.invalidCount': '{count} validation error(s):',
  'engine.list.warnTitle': 'Metadata warnings',
  'engine.list.warnCount': '{count} warning(s):',
  'engine.list.allSources': 'All sources',
  'engine.package.writableRequired': 'Pick or create a writable base (package) first — this item cannot be authored into a read-only code package.',
  'engine.list.source.artifact': 'Artifact',
  'engine.list.source.runtime': 'Runtime',
  'engine.list.source.artifactDesc': 'Shipped by code package',
  'engine.list.source.runtimeDesc': 'Authored at runtime',
  'engine.list.col.name': 'Name',
  'engine.list.col.label': 'Label',
  'engine.list.col.source': 'Source',
  'engine.list.col.object': 'Object',
  'engine.list.col.type': 'Type',
  'engine.list.col.description': 'Description',
  'engine.list.col.sharedWith': 'Shared with',
  'engine.list.col.accessLevel': 'Access',
  'engine.list.col._packageId': 'Package',
  'engine.list.col.criteria': 'Criteria',
  // objectstack#26649 — the member column of a type whose identity is
  // `(name, locale)` (`bundleMemberField`).
  'engine.list.col.locale': 'Locale',
  'engine.list.col.actions': 'Actions',
  // objectstack#25333 — the position list's served columns (`PositionGrantCells.tsx`).
  'engine.list.col._holderCount': 'Holders',
  'engine.list.col._grantedPermissionSets': 'Permission sets',
  'engine.position.holders.unknown': 'The server did not count the holders for you (no active organization, or no read on position assignments).',
  'engine.position.grants.none': 'None',
  // objectstack#26187 — the Setup position page's read-only previews of the
  // permission sets the position names (`PositionPermissionSetsSection.tsx`).
  'engine.position.sets.title': 'Permission sets',
  'engine.position.sets.hint':
    'What each permission set this position names grants, in the order it names them. Open a set to change it.',
  'engine.position.sets.empty': 'This position names no permission sets.',
  'engine.position.sets.loading': 'Loading…',
  'engine.position.sets.notFound': 'Permission set "{name}" was not found.',
  'engine.position.sets.readFailed': 'Permission set "{name}" could not be read.',
  'engine.position.sets.open': 'Open this permission set',
  'engine.list.emptyType': 'No {type} items registered',
  'engine.list.emptyQuery': 'No matches for "{query}"',
  'engine.list.createHint': 'Click "New" above to create the first {type}.',
  'engine.list.readOnlyHint':
    'This type is read-only — instances are defined by code artifacts in packages.',
  // objectui#7611 — the environment scope (Setup catalog). See `catalog-scope.ts`.
  'engine.catalog.col.active': 'Active',
  'engine.catalog.status.all': 'All',
  'engine.catalog.status.active': 'Active',
  'engine.catalog.status.inactive': 'Inactive',
  'engine.catalog.active.on': 'Active — click to deactivate',
  'engine.catalog.active.off': 'Inactive — click to activate',
  'engine.catalog.active.anchor':
    'An audience anchor: it carries the baseline every principal of the deployment holds, so it cannot be switched off. Change what it grants through the permission sets bound to it.',
  'engine.catalog.active.unknown': 'Activation state could not be read.',
  'engine.catalog.active.notVisible': 'Not visible to you',
  'engine.catalog.active.failed': 'The switch was not saved: {message}',
  // objectui#13338 — the confirm a permission set's or a position's switch
  // asks before it switches the item off, and the toast either way.
  'engine.catalog.active.switchedOn': '{name} activated.',
  'engine.catalog.active.switchedOff': '{name} deactivated.',
  'engine.catalog.deactivate.title': 'Deactivate {name}?',
  'engine.catalog.deactivate.counting': 'Counting the users who hold this access…',
  'engine.catalog.deactivate.holders': '{count} users will lose this access.',
  'engine.catalog.deactivate.holdersOne': '1 user will lose this access.',
  'engine.catalog.deactivate.holdersAtLeast': 'At least {count} users will lose this access.',
  'engine.catalog.deactivate.everyone':
    'Every signed-in member will lose this access: it is bound to the everyone position.',
  'engine.catalog.deactivate.countFailed': 'How many users hold this access could not be read: {message}',
  'engine.catalog.deactivate.confirm': 'Deactivate',
  'engine.catalog.readOnly.single':
    'Read-only for your account. {type} items are defined by the platform administrator (the `manage_metadata` capability); your organization assigns them.',
  'engine.catalog.readOnly.walled':
    'Read-only for organization administrators. On this deployment the platform operator defines {type} items for every organization in Studio; your organization assigns them.',
  // objectui#12982 — a declaration-only catalog (declared sharing rules). See
  // `sharing-rule-catalog.ts`.
  'engine.catalog.declaredOnly.hint.sharing_rule':
    'These sharing rules are declared by installed packages and are read-only. Switch one off, or clone it into a rule your organization owns. Rules your organization authors are on the Organization rules page.',
  'engine.catalog.declaredOnly.authoredLink.sharing_rule': 'Organization rules',
  'engine.catalog.declaredOnly.switchReadOnly':
    'Read-only for your account: switching a declared item on or off requires the `manage_metadata` capability.',
  'engine.sharingRule.clone.action': 'Clone',
  'engine.sharingRule.clone.title': 'Clone sharing rule',
  'engine.sharingRule.clone.body':
    'Creates a sharing rule your organization owns from the declared rule "{name}", under a new name. The declared rule itself does not change.',
  'engine.sharingRule.clone.copyLabel': '{label} (copy)',
  'engine.sharingRule.clone.name': 'New rule name',
  'engine.sharingRule.clone.label': 'New label',
  'engine.sharingRule.clone.loading': 'Reading the rule…',
  'engine.sharingRule.clone.noCriteria':
    'The server serves no criteria for "{name}" while it is switched off. Continue in the New form and enter them there.',
  'engine.sharingRule.clone.confirm': 'Create rule',
  'engine.sharingRule.clone.continueInForm': 'Continue in New form',
  'engine.sharingRule.clone.failed': 'The rule was not created.',
  'engine.sharingRule.clone.created':
    'Created "{name}". The declared rule "{source}" still grants access until you switch it off.',
  'engine.sharingRule.clone.disableSource': 'Switch "{source}" off',
  'engine.sharingRule.clone.sourceOff': 'The declared rule "{source}" is switched off.',
  'engine.sharingRule.clone.openCopy': 'Open the new rule',
  'engine.sharingRule.clone.done': 'Done',
  'engine.typeAction.confirmTitle': '{action} on "{item}"?',
  'engine.typeAction.confirmTitleNoItem': '{action}?',
  'engine.layers.code': 'Code',
  'engine.layers.overlay': 'Overlay',
  'engine.layers.effective': 'Effective',
  'engine.layers.diff': 'Diff',
  'engine.layers.diff.field': 'Field',
  'engine.layers.diff.code': 'Code (artifact)',
  'engine.layers.diff.effective': 'Effective',
  'engine.layers.diff.status': 'Status',
  'engine.layers.diff.unchanged': 'unchanged',
  'engine.layers.diff.modified': 'modified',
  'engine.layers.diff.added': 'added',
  'engine.layers.diff.removed': 'removed',
  'engine.layers.diff.showUnchanged': 'Show unchanged',
  'engine.layers.diff.noChanges': 'Overlay matches the code value — no field-level differences.',
  'engine.layers.diff.noBaseline': 'No code-level artifact to compare against. All fields are runtime-authored.',
  'engine.layers.diff.summary': '{modified} modified · {added} added · {removed} removed',
  // objectui#10804 (objectui#10805 folded in) — the dashboard add-widget picker
  // (`AddWidgetPicker`): its search box, empty text, category headings and the
  // type names it lists (`WIDGET_TYPE_META[].labelKey`). Display only: the new
  // widget's default `New TYPE` title is stored author data and keeps writing
  // `WIDGET_TYPE_META[].label`, the same English as these en rows.
  'engine.widgetPicker.search': 'Search widgets…',
  'engine.widgetPicker.noMatches': 'No matches.',
  'engine.widgetPicker.category.kpi': 'Single value',
  'engine.widgetPicker.category.chart': 'Charts',
  'engine.widgetPicker.category.data': 'Tabular',
  'engine.widgetPicker.type.metric': 'Metric (KPI)',
  'engine.widgetPicker.type.bar': 'Bar chart',
  'engine.widgetPicker.type.horizontalBar': 'Horizontal bar',
  'engine.widgetPicker.type.line': 'Line chart',
  'engine.widgetPicker.type.area': 'Area chart',
  'engine.widgetPicker.type.pie': 'Pie chart',
  'engine.widgetPicker.type.donut': 'Donut chart',
  'engine.widgetPicker.type.scatter': 'Scatter plot',
  'engine.widgetPicker.type.funnel': 'Funnel',
  'engine.widgetPicker.type.table': 'Data table',
  'engine.widgetPicker.type.pivot': 'Pivot table',
  // ConditionBuilder raw-expression mode (CEL editor, #1582)
  'engine.condition.celLabel': 'CEL expression',
  'engine.condition.advancedHint': 'Advanced expression — Builder only supports simple AND/OR conditions.',
  // Flow designer add-node palette (search box + recents, #1943)
  'engine.flowPalette.search': 'Search nodes…',
  'engine.flowPalette.empty': 'No matching nodes.',
  'engine.flowPalette.recent': 'Recently used',
  // Palette section headings (localized display; the canonical NodeCategory
  // literals stay English as in-memory bucket keys — see flow-canvas-parts).
  'engine.flowPalette.category.data': 'Data',
  'engine.flowPalette.category.logic': 'Logic',
  'engine.flowPalette.category.human': 'Human',
  'engine.flowPalette.category.integration': 'Integration',
  'engine.flowPalette.category.flow': 'Flow',
  // Flow canvas chrome — toolbar, node affordances, banner (FlowCanvas /
  // flow-canvas-parts). Node-type labels/hints live in the strings table too
  // (engine.flowNode.*) but are resolved via translateNodeLabel/Hint so the
  // server descriptor stays the source of truth in English.
  'engine.flowCanvas.zoomOut': 'Zoom out',
  'engine.flowCanvas.zoomIn': 'Zoom in',
  'engine.flowCanvas.fit': 'Fit to view',
  'engine.flowCanvas.canvas': 'Flow canvas',
  'engine.flowCanvas.reveal': 'Reveal on canvas',
  'engine.flowCanvas.moreErrors': '+{count} more…',
  'engine.flowCanvas.insertNode': 'Insert node here',
  'engine.flowCanvas.addConnected': 'Add connected node',
  'engine.flowCanvas.addReviseLoop': 'Add revision loop (send back for revision)',
  'engine.flowCanvas.addReviseLoopShort': 'Add revision loop',
  'engine.flowCanvas.awaitingRevision': 'Awaiting Revision',
  'engine.flowCanvas.collapseRegions': 'Collapse nested regions',
  'engine.flowCanvas.expandRegions': 'Expand nested regions',
  // objectui#10862, slice 4 — an edge's hover title and the node card's
  // one-line config summary (FlowCanvas).
  'engine.flowCanvas.edge.undeclaredCycle':
    '{source} → {target} — part of an un-declared cycle; mark the edge that closes the loop as a back-edge',
  'engine.flowCanvas.edge.backEdge': '{source} ↩ {target} (back-edge)',
  'engine.flowCanvas.summary.branches': '{count} branches',
  'engine.flowCanvas.summary.approversOne': '{count} approver',
  'engine.flowCanvas.summary.approversOther': '{count} approvers',
  'engine.flowCanvas.summary.unanimous': 'all',
  'engine.flowCanvas.summary.code': 'code',
  // objectui#11905 — the connect handle on a node card (FlowCanvas): drag it
  // onto another node to draw a connection between two existing nodes.
  'engine.flowCanvas.connect': 'Drag onto another node to connect',
  // Nested structured-region tray headers (FlowRegionView / extractRegions).
  'engine.flowRegion.branchN': 'Branch {n}',
  'engine.flowRegion.try': 'Try',
  'engine.flowRegion.catch': 'Catch',
  // objectui#10748 — a loop / map body region; the canvas draws no header for
  // it, so today only the inspector's nested-node breadcrumb reads it.
  'engine.flowRegion.body': 'Body',
  // Flow preview header — pills, panel toggles, empty states (FlowPreview).
  'engine.flowPreview.emptyHint': 'Add nodes in the Form tab to see the flow preview.',
  'engine.flowPreview.malformed': 'One of the flow nodes or edges is malformed.',
  'engine.flowPreview.pill.trigger': 'Trigger',
  'engine.flowPreview.pill.status': 'Status',
  'engine.flowPreview.pill.runAs': 'Run as',
  'engine.flowPreview.pill.onError': 'On error',
  'engine.flowPreview.showVars': 'Show variables panel',
  'engine.flowPreview.hideVars': 'Hide variables panel',
  'engine.flowPreview.variables': 'Variables',
  'engine.flowPreview.noVars': 'No variables declared.',
  'engine.flowPreview.runsTitle': 'Run history from the automation engine',
  'engine.flowPreview.runs': 'Runs',
  'engine.flowPreview.problemsTitle': 'Validation problems',
  'engine.flowPreview.problems': 'Problems',
  'engine.flowPreview.debug': 'Debug',
  // objectui#10862, slice 4 — the variables panel's input / output tags.
  'engine.flowPreview.varIn': 'in',
  'engine.flowPreview.varOut': 'out',
  // Flow run-history panel (FlowRunsPanel).
  'engine.flowRuns.title': 'Runs',
  'engine.flowRuns.refresh': 'Refresh run history',
  'engine.flowRuns.unavailable':
    'Run history unavailable — the automation engine is offline or this flow hasn’t been published.',
  'engine.flowRuns.empty': 'No runs yet.',
  'engine.flowRuns.noSteps': 'No step log recorded.',
  'engine.flowRuns.iteration': 'Iteration',
  'engine.flowRuns.iterationN': 'Iteration {n}',
  'engine.flowRuns.branch': 'Branch',
  'engine.flowRuns.branchN': 'Branch {n}',
  'engine.flowRuns.branchNIterationM': 'Branch {n} · Iteration {m}',
  'engine.flowRuns.try': 'Try',
  'engine.flowRuns.catch': 'Catch',
  'engine.flowRuns.status.completed': 'Completed',
  'engine.flowRuns.status.failed': 'Failed',
  'engine.flowRuns.status.paused': 'Paused',
  'engine.flowRuns.status.running': 'Running',
  'engine.flowRuns.status.cancelled': 'Cancelled',
  // objectui#10862, slice 4 — an expanded run's id line (the trigger part is
  // appended after a ` · ` separator when the run carries one).
  'engine.flowRuns.runId': 'run {id}',
  'engine.flowRuns.trigger': 'trigger {type}',
  // Flow debug simulator (FlowSimulatorPanel).
  'engine.flowSim.run': 'Run',
  'engine.flowSim.step': 'Step',
  'engine.flowSim.continue': 'Continue',
  'engine.flowSim.reset': 'Reset',
  'engine.flowSim.add': 'Add',
  'engine.flowSim.resumeBranch': 'Resume down the “{branch}” branch',
  'engine.flowSim.screen': 'Screen',
  'engine.flowSim.inputs': 'Inputs',
  'engine.flowSim.setVariables': 'Set variables',
  'engine.flowSim.setVariablesHint': 'Override or inject any variable (wins over inputs and mocks at start).',
  'engine.flowSim.mockOutputs': 'Mock outputs',
  'engine.flowSim.mockPlaceholder': 'mocked result (JSON)',
  'engine.flowSim.variables': 'Variables',
  'engine.flowSim.noVars': 'No variables set.',
  'engine.flowSim.timeline': 'Timeline',
  'engine.flowSim.namePlaceholder': 'name',
  'engine.flowSim.valuePlaceholder': 'value',
  'engine.flowSim.removeVariable': 'Remove variable',
  'engine.flowSim.idleHint':
    'Press Run to simulate, or Step to walk node by node. Side effects are mocked — no backend is called.',
  'engine.flowSim.status.idle': 'idle',
  'engine.flowSim.status.running': 'running',
  'engine.flowSim.status.paused': 'paused',
  'engine.flowSim.status.done': 'done',
  'engine.flowSim.status.error': 'error',
  // objectui#10835 — the Debug run's step records (`FlowSimulator`, shown by
  // `FlowSimulatorPanel`): a step's status chip, an out-edge's error result, and
  // every note and error sentence the simulator writes. Node ids, labels, types,
  // CEL sources, config paths and the producer text a reason carries
  // (`@objectstack/spec` / `@objectstack/formula`) pass through as written.
  'engine.flowSim.stepStatus.ok': 'ok',
  'engine.flowSim.stepStatus.mocked': 'mocked',
  'engine.flowSim.stepStatus.paused': 'paused',
  'engine.flowSim.stepStatus.skipped': 'skipped',
  'engine.flowSim.stepStatus.error': 'error',
  'engine.flowSim.edge.error': 'error',
  'engine.flowSim.note.stepLimit': 'Step limit ({max}) exceeded — the flow may contain an infinite loop.',
  'engine.flowSim.note.nodeNotFound': 'Node "{id}" not found.',
  'engine.flowSim.note.resumed': 'Resumed.',
  'engine.flowSim.note.decisionTaken': 'Decision: {decision} → {taken}.',
  'engine.flowSim.note.decisionNoneTaken': 'no out-edge taken',
  'engine.flowSim.note.noDecision': 'No decision supplied; every out-edge is considered.',
  'engine.flowSim.note.flowEnd': 'Flow end reached.',
  'engine.flowSim.note.unsupported': '"{type}" is not modelled by the simulator; passing through without its real semantics.',
  'engine.flowSim.note.parallelSplit': 'Parallel split — branches fan out (no join synchronization is simulated).',
  'engine.flowSim.note.approvalReached': 'Approval reached — choose a decision to continue.',
  'engine.flowSim.note.waitReached': 'Wait reached — continue manually.',
  'engine.flowSim.note.screenReached': 'Screen reached — provide inputs, then continue.',
  'engine.flowSim.note.screenUnevaluable':
    "A screen field's visibleWhen may reference only the fields declared on this screen; the screen cannot evaluate {fields}.",
  'engine.flowSim.note.screenUnevaluableField': '"{name}" ({reason})',
  'engine.flowSim.note.screenNoInput': 'Screen has no input — passed through (matches runtime).',
  'engine.flowSim.note.passThrough': 'Type "{type}" treated as pass-through.',
  'engine.flowSim.note.decisionNoOutEdge': 'The decision has no out-edge; the runtime ends this branch here.',
  'engine.flowSim.note.branchMatched': 'Branch "{label}" matched (config.conditions).',
  'engine.flowSim.note.noConditionMatched': 'No entry of config.conditions matched; the branch is "{label}".',
  'engine.flowSim.note.noAssignments': 'No assignments defined.',
  'engine.flowSim.note.loopSinglePass': 'Loop simulated as a single pass (body re-execution is not modelled).',
  'engine.flowSim.note.loopCollection': 'Collection "{ref}" has {count} item(s); simulated as a single pass.',
  'engine.flowSim.note.loopNotArray': 'Collection "{ref}" is not an array; loop may not run at runtime.',
  'engine.flowSim.note.loopCollectionNotList': 'Collection "{ref}" is not a list; the runtime fails the loop here.',
  'engine.flowSim.note.mockedCall': "Mocked call to '{fn}' (no function executed).",
  'engine.flowSim.note.retiredAction':
    "Retired '{action}' action — it never delivered anything; use a notify node (or a connector for Slack).",
  'engine.flowSim.note.retiredScript':
    'Retired inline script — the runtime never executed it; move the logic into a registered function.',
  'engine.flowSim.note.mocked': 'Mocked {type} (no backend call).',
  'engine.flowSim.note.noBranchLabel':
    'No out-edge carries the branch label "{label}", so every out-edge is considered, as the runtime does (it logs a warning).',
  'engine.flowSim.note.evaluationFailed': 'Evaluation failed.',
  'engine.flowSim.note.multipleMatched':
    'Multiple conditions matched; the first declared branch was taken (the runtime takes every match, objectstack#15429).',
  'engine.flowSim.note.noEdgeTaken':
    'No out-edge was taken: no guard was true and there is no default edge. The runtime ends this branch here.',
  // objectui#10848 — the frames `flow-sim-validate` puts around a CEL failure
  // on a step or an out-edge. `{message}` is the producer's own text
  // (`@objectstack/formula`), passed through as written; its fallback, when
  // the producer gives none, is `engine.flowSim.note.evaluationFailed`.
  'engine.flowSim.note.celEvaluationFailed': 'CEL evaluation failed: {message}',
  'engine.flowSim.note.celConditionFailed': 'condition failed to evaluate as CEL: {message}',
  // objectui#10862 — the RLS policy editor's CEL try-it dialog: the result for
  // an empty predicate (`celAuthoring.testRunCelPredicate` returns it as a
  // `messageKey` the dialog reads through its `t`) and the sample-JSON
  // refusal. The engine's own message, when it gives one, passes through as
  // written; when it gives none, the fallback key is
  // `engine.flowSim.note.evaluationFailed`, the same "Evaluation failed.".
  'engine.celTest.predicateEmpty': 'The predicate is empty.',
  'engine.celTest.notObject': 'expected a JSON object.',
  'engine.bookPreview.nameTitle': 'Name your book',
  'engine.bookPreview.nameDescription': 'Enter a name in the Form tab to start authoring the documentation spine.',
  'engine.bookPreview.treeTitle': 'Open the live-resolved navigation tree (actual docs per group)',
  'engine.bookPreview.tree': 'Resolved tree',
  'engine.bookPreview.audience.public': 'Public',
  'engine.bookPreview.audience.permissionSet': 'Permission set: {name}',
  'engine.bookPreview.audience.org': 'Org',
  'engine.bookPreview.slug': 'Slug: {slug}',
  'engine.bookPreview.noGroups': 'No groups yet',
  'engine.bookPreview.noGroupsDescription':
    'A book needs at least one group in its {groups} spine. Each group derives its members from an {include} rule (a glob like {glob} or a {tag}).',
  'engine.bookPreview.noKey': '(no key)',
  'engine.bookPreview.orderTitle': 'Order within the book',
  'engine.bookPreview.packageTitle': 'Membership rule is scoped to this package',
  'engine.bookPreview.derived': 'Members derived from the rule above — resolved against the live doc set.',
  'engine.bookPreview.noRule':
    'No {include} rule and no explicit {pages} — this group matches nothing unless docs set {group}.',
  'engine.bookPreview.curatedTitle': 'Curated order via explicit pages',
  'engine.bookPreview.curated': 'curated',
  'engine.bookPreview.globTitle': 'Glob over doc names',
  'engine.bookPreview.tagTitle': 'Match by doc tag',
  'engine.bookPreview.separator': 'separator',
  'engine.bookPreview.rest': '…rest (remaining matched docs, by order)',
  'engine.bookPreview.emptyPage': '(empty)',
  // The doc editor (previews/DocPreview, objectui#10188).
  'engine.docPreview.bookSection': 'Book section',
  'engine.docPreview.noSection': 'Not placed in a section',
  'engine.docPreview.unknownSection': '{key} (not a section of any book)',
  'engine.docPreview.booksLoading': 'Loading books…',
  'engine.docPreview.booksFailed': 'Books could not be loaded: {message}',
  'engine.docPreview.appearsIn': 'Appears in:',
  'engine.docPreview.publicBook': 'public',
  'engine.docPreview.noBooks': 'No documentation book exists yet — create one to place this doc in a section.',
  'engine.docPreview.unplaced': 'Not in any book section yet — book trees list it under Uncategorized.',
  'engine.docPreview.locales': 'Locale variants',
  'engine.docPreview.baseLocale': 'Default',
  'engine.docPreview.removeLocale': 'Remove the {locale} variant',
  'engine.docPreview.localePlaceholder': 'zh-CN',
  'engine.docPreview.addLocaleInput': 'New locale tag',
  'engine.docPreview.addLocale': 'Locale',
  'engine.docPreview.localeDuplicate': '{locale} already has a variant',
  'engine.docPreview.localeInvalid': 'Use a locale tag such as zh-CN',
  'engine.docPreview.variantTitle': 'Title',
  'engine.docPreview.variantSummary': 'Summary',
  'engine.docPreview.preview': 'Live preview',
  'engine.docPreview.renderFailed': 'The Markdown renderer failed on this content.',
  'engine.docPreview.emptyEditing': 'Nothing to preview yet — write Markdown in the source pane.',
  'engine.docPreview.empty': 'This doc has no content.',
  'engine.docPreview.source': 'Markdown source',
  'engine.docPreview.sourceLocale': 'Markdown source ({locale})',
  'engine.docPreview.sourcePlaceholder': '# Title\n\nWrite Markdown here…',
  'engine.translationPreview.empty':
    'This bundle is empty — add at least one translated string to see the coverage report.',
  // One heading per group of the per-app `TranslationDataSchema`, in its order (objectui#11765).
  'engine.translationPreview.category.objects': 'Objects',
  'engine.translationPreview.category.picklists': 'Picklists',
  'engine.translationPreview.category.apps': 'Apps',
  'engine.translationPreview.category.messages': 'Messages',
  'engine.translationPreview.category.globalActions': 'Global Actions',
  'engine.translationPreview.category.dashboards': 'Dashboards',
  'engine.translationPreview.category.datasets': 'Datasets',
  'engine.translationPreview.category.reports': 'Reports',
  'engine.translationPreview.category.pages': 'Pages',
  'engine.translationPreview.category.flows': 'Flows',
  'engine.translationPreview.category.positions': 'Positions',
  'engine.translationPreview.category.permissions': 'Permission Sets',
  'engine.translationPreview.category.books': 'Doc Books',
  'engine.translationPreview.category.metadataForms': 'Metadata Forms',
  'engine.translationPreview.category.settingsCommon': 'Settings UI',
  'engine.translationPreview.coverage': 'Category coverage:',
  'engine.translationPreview.totalKeys': '{count} total keys',
  'engine.translationPreview.categoryEmpty': 'empty',
  'engine.translationPreview.more': '+{count} more…',
  'engine.translationPreview.keyCountOne': '{{count} key}',
  'engine.translationPreview.keyCountOther': '{{count} keys}',
  // objectui#10862 (slice 2) — the advisory `celAuthoring.lintCelPredicate`
  // words itself, shown beneath the CEL editors: the wrong-layer root (the
  // local instrument's sentence; a slot `@objectstack/lint` covers ships that
  // package's own message instead). The lint returns it as a `messageKey` plus
  // its values and `CelPredicateField` reads it through the designer `t` its
  // host binds. `Unknown variable: …` is the runtime's own fault text and stays
  // as written. (An RLS clause the runtime cannot lower has no row here: it
  // ships `@objectstack/lint`'s own message, objectui#13061.)
  'engine.celLint.notTheRow':
    '`{identifier}` is not the row on this surface: a row predicate binds the record as `{canonical}` and nothing else. The CEL scope vocabulary still accepts `{identifier}`, so nothing here blocks the save, but at runtime the expression faults with `Unknown variable: {identifier}` and the rule never fires. Re-root the reference on `{canonical}`.',
  'engine.pageBlockCanvas.renderFailed':
    '"{type}" can\'t render with its current configuration — check its Properties.',
  'engine.pageBlockCanvas.itemN': 'Item {n}',
  'engine.pageBlockCanvas.body': 'Body',
  'engine.pageBlockCanvas.content': 'Content',
  'engine.pageBlockCanvas.noRegions': 'No regions yet',
  'engine.pageBlockCanvas.noRegionsHint':
    'A Page is composed of regions (header / main / sidebar / …). Add a region to start dropping blocks into it.',
  'engine.pageBlockCanvas.addRegion': 'Add region',
  // objectui#12902 — "Add region" offers only a slot the page's template places.
  'engine.pageBlockCanvas.gridCell': 'Grid cell',
  'engine.pageBlockCanvas.addRegionAllFilled': "Every slot the '{template}' template places is filled ({slots}).",
  'engine.pageBlockCanvas.addRegionUnknownTemplate': "'{template}' is not a page template, so it places no region.",
  'engine.pageBlockCanvas.regionN': 'region {n}',
  'engine.pageBlockCanvas.dropHere': 'drop here',
  'engine.pageBlockCanvas.slotInherited':
    'Inherited from the default page — add a block to override this slot.',
  'engine.pageBlockCanvas.regionEmpty': 'Empty region — drop a block here or use the add button below.',
  'engine.pageBlockCanvas.select': 'Select {label}',
  'engine.pageBlockCanvas.span': 'Spans {span} of 12 columns on a wide screen',
  'engine.pageBlockCanvas.groupEmpty': 'Empty — add a block.',
  'engine.pageBlockCanvas.searchTypes': 'Search block type…',
  'engine.pageBlockCanvas.noMatch': 'No matching types.',
  'engine.pageBlockCanvas.category.data': 'Data',
  'engine.pageBlockCanvas.category.layout': 'Layout',
  'engine.pageBlockCanvas.category.record': 'Record context',
  'engine.pageBlockCanvas.category.navigation': 'Navigation',
  'engine.pageBlockCanvas.category.element': 'Elements',
  'engine.pageBlockCanvas.category.ai': 'AI',
  'engine.pageBlockCanvas.category.misc': 'Other',
  'engine.pageBlockCanvas.type.grid': 'Grid',
  'engine.pageBlockCanvas.type.objectGrid': 'Table',
  'engine.pageBlockCanvas.type.objectForm': 'Form',
  'engine.pageBlockCanvas.type.objectMetric': 'Metric',
  'engine.pageBlockCanvas.type.objectKanban': 'Kanban',
  'engine.pageBlockCanvas.type.pageHeader': 'Header',
  'engine.pageBlockCanvas.type.pageFooter': 'Footer',
  'engine.pageBlockCanvas.type.pageSidebar': 'Sidebar',
  'engine.pageBlockCanvas.type.pageTabs': 'Tabs',
  'engine.pageBlockCanvas.type.pageAccordion': 'Accordion',
  'engine.pageBlockCanvas.type.pageCard': 'Card',
  'engine.pageBlockCanvas.type.pageSection': 'Section',
  'engine.pageBlockCanvas.type.recordDetails': 'Record details',
  'engine.pageBlockCanvas.type.recordHighlights': 'Highlights',
  'engine.pageBlockCanvas.type.recordRelatedList': 'Related list',
  'engine.pageBlockCanvas.type.recordActivity': 'Activity timeline',
  'engine.pageBlockCanvas.type.recordDiscussion': 'Discussion',
  'engine.pageBlockCanvas.type.recordPath': 'Stage path',
  'engine.pageBlockCanvas.type.recordAlert': 'Alert banner',
  'engine.pageBlockCanvas.type.recordQuickActions': 'Quick actions',
  'engine.pageBlockCanvas.type.recordReferenceRail': 'Reference rail',
  'engine.pageBlockCanvas.type.recordHistory': 'History',
  'engine.pageBlockCanvas.type.navMenu': 'Nav menu',
  'engine.pageBlockCanvas.type.navBreadcrumb': 'Breadcrumb',
  'engine.pageBlockCanvas.type.globalSearch': 'Global search',
  'engine.pageBlockCanvas.type.aiSuggestion': 'AI suggestion',
  'engine.pageBlockCanvas.type.elementText': 'Text',
  'engine.pageBlockCanvas.type.elementNumber': 'Number',
  'engine.pageBlockCanvas.type.elementImage': 'Image',
  'engine.pageBlockCanvas.type.elementDivider': 'Divider',
  'engine.pageBlockCanvas.type.elementButton': 'Button',
  'engine.pageBlockCanvas.type.elementDefinitionList': 'Definition list',
  'engine.pageBlockCanvas.type.elementRepeater': 'Repeater',
  'engine.sourcePageEditor.source': 'Page source',
  'engine.sourcePageEditor.renderFailed':
    'The page source threw while rendering — fix the code in the Source tab.',
  'engine.fieldsListEditor.columns': 'Columns',
  'engine.fieldsListEditor.empty': 'No columns yet. Add a field below.',
  'engine.fieldsListEditor.colN': 'col {n}',
  'engine.viewColumnPanes.remove': 'Remove {label}',
  // Structural flow validation (flow-sim-validate) — canvas banner, Problems
  // panel, and the debug simulator.
  'engine.flowValidate.nodeMissingId': 'A node is missing an id.',
  'engine.flowValidate.duplicateNodeId': 'Duplicate node id "{id}".',
  'engine.flowValidate.edgeSourceMissing': 'Edge source "{source}" does not exist.',
  'engine.flowValidate.edgeTargetMissing': 'Edge target "{target}" does not exist.',
  // objectui#11838 — the other positions that name a node by id.
  'engine.flowValidate.exprRefNodeMissing': 'Expression "{ref}" reads node "{id}", which does not exist.',
  'engine.flowValidate.boundaryHostMissing': 'Boundary event "{name}" ({id}) is attached to node "{host}", which does not exist.',
  'engine.flowValidate.startHasIncoming': 'Start node has an incoming edge.',
  'engine.flowValidate.multipleStart': 'Flow has {count} start nodes; expected one.',
  'engine.flowValidate.noStartUsingRoot': 'No "start" node; using the only root node as the entry.',
  'engine.flowValidate.noEntry': 'No entry node (every node has an incoming edge — the graph is fully cyclic).',
  'engine.flowValidate.ambiguousEntry': 'Cannot determine a single entry node ({count} candidates). Add a "start" node.',
  'engine.flowValidate.decisionMultipleDefaults': 'Decision "{name}" ({id}) has {count} default branches.',
  'engine.flowValidate.decisionNoBranches': 'Decision "{name}" ({id}) has no outgoing branches.',
  'engine.flowValidate.decisionNoDefault': 'Decision "{name}" ({id}) has no default branch; it may dead-end when no condition matches.',
  'engine.flowValidate.nodeUnreachable': 'Node "{name}" ({id}) is unreachable from the entry.',
  'engine.flowValidate.cycleDetected': 'Cycle detected ({cycle}). Mark the connection that closes the loop as a back-edge (Connection type → Back-edge) to declare an intentional revise/rework loop.',
  // Unknown-reference (scope) warnings (flow-ref-check) — Problems panel + the
  // inline expression-field warnings.
  'engine.flowRef.unknownWithSuggestion': 'Unknown reference `{token}` — did you mean `{suggestion}`?',
  'engine.flowRef.notInScope': '`{token}` is not a reference in scope at this step.',
  'engine.flowRef.notInScopeMulti': 'Not in scope: {tokens}.',
  // objectui#10804 — a screen field's `visibleWhen` names a root that is not a
  // field declared on the same screen (`screenVisibleWhenScopeError`,
  // screen-spec): the inline cell's note and the Problems panel. The parse and
  // shape refusals beside it are `@objectstack/formula`'s and
  // `@objectstack/spec`'s own words and pass through as they are.
  'engine.flowRef.notAScreenField': '`{token}` is not a field on this screen',
  'engine.flowRef.notAScreenFieldWithSuggestion': '`{token}` is not a field on this screen (did you mean `{suggestion}`?)',
  // objectui#10748 — the author-time expression shape errors
  // (`validateExpressionClient`, expression-validate), rendered inline under an
  // expression field, a repeater cell and the edge condition. The code spans
  // are code and stay as they are in every locale.
  'engine.flowExpr.templateDialect': 'Expected a text template but got a `{dialect}` expression.',
  'engine.flowExpr.singleBraceTemplate': 'Single-brace `{{ref}}` is not a valid template hole — use double braces: `{{ {ref} }}`.',
  'engine.flowExpr.celDialect': 'Expected a CEL expression but got a `{dialect}` dialect.',
  'engine.flowExpr.braceInCondition':
    'It looks like a `{{ref}}` template brace was used inside a condition — `{…}` parses as a CEL map literal and fails. Write the bare reference instead, e.g. `{ref}`. Conditions are bare CEL (e.g. `record.rating >= 4`).',
  'engine.flowExpr.unbalancedParens': 'Unbalanced parentheses in `{source}`.',
  'engine.flowExpr.unbalancedBrackets': 'Unbalanced brackets in `{source}`.',
  // objectui#10748 — the variable data-picker (`VariableTextInput`): its button
  // and search box, its section headings (`useFlowScope`) and the muted detail
  // beside a reference (`flow-scope`, `useFlowScope`). Tokens, type names and
  // object names inside a detail are code or author data and stay as they are.
  'engine.flowScope.picker.insert': 'Insert a reference',
  'engine.flowScope.picker.search': 'Search references…',
  'engine.flowScope.picker.empty': 'No matching references.',
  'engine.flowScope.group.variables': 'Flow variables',
  'engine.flowScope.group.outputs': 'Upstream outputs',
  'engine.flowScope.group.loop': 'Loop item',
  'engine.flowScope.group.trigger': 'Trigger record',
  'engine.flowScope.group.approvalCurrent': 'Current record (live at node entry)',
  'engine.flowScope.group.approvalTrigger': 'Trigger snapshot (at submit)',
  // objectui#10804 — the one section of a screen field's `visibleWhen` picker.
  'engine.flowScope.group.screenFields': 'Screen fields',
  'engine.flowScope.detail.variable': 'variable',
  'engine.flowScope.detail.variableTyped': 'variable · {type}',
  'engine.flowScope.detail.triggerRecord': 'trigger record · {object}',
  'engine.flowScope.detail.previousRecord': 'record values before the change',
  'engine.flowScope.detail.priorOf': 'prior {detail}',
  'engine.flowScope.detail.priorValue': 'prior value',
  'engine.flowScope.detail.preUpdateRow': 'pre-update row',
  // Problems panel (ProblemsPanel).
  'engine.flowProblems.title': 'Problems',
  'engine.flowProblems.empty': 'No problems — this flow is structurally valid.',
  'engine.flowProblems.sourceSchema': 'schema',
  'engine.flowProblems.sourceExpression': 'expression',
  // objectui#11772 — one extra copy of a connection (`edgeRouteKey`): the
  // engine follows every copy, so the target runs once per copy.
  'engine.flowProblems.repeatedEdge': 'Connection "{sourceName}" ({source}) → "{targetName}" ({target}) is repeated; the flow runs "{targetName}" once for each copy. Remove this copy.',
  // objectui#11905 — why a connection between two existing nodes is refused,
  // shown by both doors that draw one: the canvas's connect handle and the
  // connection inspector's From / To (`edgeConnectionRefusal`).
  'engine.flowProblems.connectRefused.missingSource': 'Cannot connect: this flow has no node "{source}".',
  'engine.flowProblems.connectRefused.missingTarget': 'Cannot connect: this flow has no node "{target}".',
  'engine.flowProblems.connectRefused.self': 'Cannot connect "{source}" to itself.',
  'engine.flowProblems.connectRefused.repeat': '"{source}" already connects to "{target}". Select that connection to change it.',
  'engine.badge.createOnly': 'create-only',
  'engine.repeater.empty': 'No items. Click + to add.',
  'engine.badge.writable': 'writable',
  'engine.badge.readOnly': 'read-only',
  'engine.cancel': 'Cancel',
  'engine.close': 'Close',
  'engine.validation.invalid': 'Invalid input',
  'engine.validation.pattern': 'Invalid string: must match pattern {pattern}',
  'engine.validation.expectedStringUndefined': 'Required text value',
  'engine.validation.expectedType': 'Invalid type: expected {expected}, received {received}',
  'engine.validation.invalidOption': 'Invalid option: expected one of {options}',
  'engine.validation.failed': 'Validation failed ({count} issues).',
  'engine.validation.serverRefused': 'The server refused this draft — fix {issue} before saving.',
  'engine.validation.failedOne': 'Validation failed (1 issue).',
  'engine.validation.nameRequired': 'A name is required.',
  // objectui#12810 — a create that leaves a required seed placeholder unset
  // (a dataset's base object) is refused before any request.
  'engine.validation.seedPlaceholderUnset': 'Set {fields} before saving: a new item is never saved with the placeholder its template starts from.',
  'engine.embedded.saved': 'Saved.',
  'engine.embedded.readOnlyParent': 'The parent type is read-only — saving will still attempt a PUT and may be refused by the server.',
  'engine.embedded.saveIntoParent': 'Save into {parentType}',
  'engine.embedded.saveNoPath': 'Cannot save: this item has no embeddedPath registered.',
  'engine.embedded.noSchema': 'No form schema is registered for {type}. Edit the raw JSON below; saving will splice it back into {target}.',
  'engine.embedded.readOnly': 'Read-only',
  'engine.embedded.noPathHint': 'No embedded path registered — cannot determine where to write this item back.',
  'engine.quickfind.placeholder': "Find metadata types or items… (try 'view', 'account')",
  'engine.quickfind.empty': 'Type to search across all metadata types.',
  'engine.quickfind.title': 'Quick Find',
  'engine.quickfind.indexing': 'Indexing items across',
  'engine.quickfind.noMatches': 'No matches.',
  'engine.breadcrumb.allTypes': 'All Metadata Types',

  // objectui#11773 — the draft-save version conflict (`DraftConflictDialog.tsx`):
  // a draft save the server refused because the draft was saved elsewhere after
  // this editor opened it.
  'engine.draftConflict.title': 'This draft changed since you opened it',
  'engine.draftConflict.description':
    'The draft of {type} “{name}” was saved elsewhere — by someone else or in another tab — after you opened it. Reload the saved version (your unsaved edits here are dropped), or overwrite it with yours.',
  'engine.draftConflict.reload': 'Reload saved version',
  'engine.draftConflict.overwrite': 'Overwrite…',
  'engine.draftConflict.keepEditing': 'Keep editing',
  'engine.draftConflict.overwriteTitle': 'Overwrite the saved draft?',
  'engine.draftConflict.overwriteDescription':
    'Your version of {type} “{name}” will replace the saved draft, and the changes saved after you opened it will be lost.',
  'engine.draftConflict.overwriteConfirm': 'Overwrite',
  'engine.draftConflict.back': 'Back',
  'engine.draftConflict.notSaved': 'Not saved: {type} “{name}” was saved elsewhere after you opened it.',
  'engine.studio.inspector.props': 'Properties',
  'engine.studio.inspector.draftFooter': 'Edits save as drafts. Publish the package to apply them.',
  'engine.studio.inspector.collapse': 'Collapse properties',
  'engine.studio.inspector.expand': 'Show properties',
  'engine.studio.inspector.emptyLine1': 'Click a block on the canvas,',
  'engine.studio.inspector.emptyLine2': 'and edit its properties right here.',
  // objectui#7121 — the rail beside a studio-canvas leaf (a
  // `registerStudioCanvasPreview` type: the running app, not a block tree).
  // States what the canvas IS; promises no recovery, because there is nothing
  // to wait for — `StudioCanvasPreviewProps` carries no selection by contract.
  'engine.studio.inspector.studioCanvasNoBlocks':
    'This canvas renders the running app, not a block tree — it has no blocks to select, and nothing here is edited from this panel.',
  // objectui#11823 — an `object` leaf's panel: the list view its canvas shows.
  'engine.studio.inspector.listView.kind': 'List view',
  'engine.studio.inspector.listView.intro':
    'The list on the canvas. Its columns, filter and sort save to this package\'s draft and show on the canvas at once.',
  // objectui#13151 — a view with no label is named by its object's display
  // name and its role, never by its qualified name (`{view}` below is the
  // panel's title, the same string).
  'engine.studio.inspector.listView.defaultTitle': '{object} · Default view',
  'engine.studio.inspector.listView.namedTitle': '{object} · {view}',
  'engine.studio.inspector.listView.notCreated':
    'There is no list view “{view}” yet. Your first change here creates it in this package\'s draft.',
  'engine.studio.inspector.listView.readOnly': 'This package is read-only: the list view is shown here, not edited.',
  'engine.studio.inspector.listView.notList': '“{view}” is not a list view, so it is not edited here.',
  'engine.studio.inspector.listView.filter': 'Filter',
  'engine.studio.inspector.listView.sort': 'Sort',
  'engine.studio.inspector.listView.addSort': '+ Add sort…',
  'engine.studio.inspector.listView.sortAsc': '{field} ascending',
  'engine.studio.inspector.listView.sortDesc': '{field} descending',
  // objectui#12725 — a kanban view's card section: a card click on the canvas selects it.
  'engine.studio.inspector.listView.kanbanCard': 'Kanban card',
  'engine.studio.inspector.listView.kanbanCard.intro': 'What each card on the board shows, and what a click on a card opens.',
  'engine.studio.inspector.listView.kanbanCard.groupByFirst': 'Pick the group-by field first: the card settings are saved with it.',
  'engine.studio.inspector.listView.kanbanCard.fields': 'Card fields',
  'engine.studio.inspector.listView.kanbanCard.title': 'Title',
  'engine.studio.inspector.listView.kanbanCard.titleRecordName': 'Record name',
  'engine.studio.inspector.listView.kanbanCard.open': 'Click to open',
  'engine.studio.inspector.listView.kanbanCard.openDefault': 'Default',
  'engine.studio.inspector.listView.kanbanCard.mode.page': 'Record page',
  'engine.studio.inspector.listView.kanbanCard.mode.drawer': 'Side drawer',
  'engine.studio.inspector.listView.kanbanCard.mode.newWindow': 'New window',
  'engine.studio.inspector.listView.kanbanCard.mode.none': "Don't open",
  'engine.studio.inspector.listView.kanbanCard.groupBy': 'Group by field',
  'engine.studio.inspector.listView.kanbanCard.pickField': 'Pick a field',
  'engine.studio.inspector.designersMissing':
    'No metadata designers are registered in this session, so there is nothing to edit here.',
  'engine.studio.inspector.noPageSchema': 'Page settings are unavailable — the page schema could not be loaded.',



  // ── AppNavCanvas (nav-tree editor, used by Studio + AppPreview) ─────────
  'engine.appNav.heading': 'Navigation',
  'engine.appNav.addItem': 'Add nav item',
  'engine.appNav.removeItem': 'Remove nav item',
  'engine.appNav.empty': 'Empty — click “Add nav item” to start',
  'engine.appNav.emptyReadonly': 'No top-level nav items yet',
  'engine.appNav.item': 'Item {n}',
  'engine.appNav.itemOne': 'item',
  'engine.appNav.itemOther': 'items',
};

const ENGINE_STRINGS_ZH: Record<string, string> = {
  'engine.package.writableRequired': '请先选择或新建一个可写的基座（package）——只读的代码包中无法新建该项。',
  'engine.directory.title': '元数据',
  'engine.directory.description':
    '平台协议共暴露 {count} 个元数据类型（其中 {writable} 个支持运行时覆盖）。点击任意卡片即可浏览、覆盖或创建实例。',
  'engine.directory.search': '搜索元数据类型…',
  'engine.directory.writableOnly': '仅显示可写',
  'engine.directory.quickFind': '快速查找',
  'engine.directory.noMatches': '没有匹配项',
  'engine.directory.noMatchesHint': '调整搜索或筛选条件以查看更多元数据类型。',
  'engine.directory.loading': '正在加载元数据类型…',
  'engine.directory.loadFailed': '加载元数据类型失败',
  'engine.directory.all': '全部',
  'engine.directory.diagnosticsLink': '查看全部问题（{count}）',
  'engine.directory.invalidTooltip': '{count} 个无效项 — 点击修复',
  'engine.directory.warnTooltip': '{count} 个条目带有警告',
  'engine.directory.itemCountTooltip': '此类型共 {count} 项',
  'engine.home.recent': '最近访问',
  'engine.diagnostics.title': '元数据诊断',
  'engine.diagnostics.description':
    '所有加载时校验失败的元数据条目，按类型分组。错误会阻塞依赖该条目的功能；警告仅提示。',
  'engine.diagnostics.back': '返回元数据',
  'engine.diagnostics.refresh': '刷新',
  'engine.diagnostics.loading': '正在扫描元数据…',
  'engine.diagnostics.loadFailed': '加载诊断失败：{error}',
  'engine.diagnostics.summary': '{items} 个条目（{types} 个类型）中共发现 {count} 个问题',
  'engine.diagnostics.cleanTitle': '一切正常',
  'engine.diagnostics.cleanHint': '已扫描 {items} 个条目（{types} 个类型），未发现问题。',
  'engine.diagnostics.severity.error': '错误',
  'engine.diagnostics.severity.warning': '错误 + 警告',
  'engine.diagnostics.col.name': '条目',
  'engine.diagnostics.col.issues': '问题',
  'engine.diagnostics.errorN': '{count} 个错误',
  'engine.diagnostics.warnN': '{count} 个警告',
  'engine.diagnostics.more': '另有 {count} 个…',
  'engine.list.create': '新建',
  'engine.list.refresh': '刷新',
  'engine.list.search': '搜索名称、标签或描述…',
  'engine.list.empty': '暂无数据。',
  'engine.list.items': '条目',
  'engine.list.filtered': '已筛选',
  'engine.list.itemCount': '{count} 个条目',
  'engine.list.itemCountOne': '1 个条目',
  'engine.list.invalid': '无效',
  'engine.list.warnings': '警告',
  'engine.list.invalidTitle': '元数据无效',
  'engine.list.invalidCount': '{count} 个校验错误：',
  'engine.list.warnTitle': '元数据警告',
  'engine.list.warnCount': '{count} 个警告：',
  'engine.list.allSources': '全部来源',
  'engine.list.source.artifact': '代码包',
  'engine.list.source.runtime': '运行时',
  'engine.list.source.artifactDesc': '由代码包提供',
  'engine.list.source.runtimeDesc': '运行时创建',
  'engine.list.col.name': '名称',
  'engine.list.col.label': '标签',
  'engine.list.col.source': '来源',
  'engine.list.col.object': '对象',
  'engine.list.col.type': '类型',
  'engine.list.col.description': '描述',
  'engine.list.col.sharedWith': '共享给',
  'engine.list.col.accessLevel': '访问级别',
  'engine.list.col._packageId': '软件包',
  'engine.list.col.criteria': '条件',
  'engine.list.col.locale': '语言',
  'engine.list.col.actions': '操作',
  'engine.list.col._holderCount': '持有人数',
  'engine.list.col._grantedPermissionSets': '权限集',
  'engine.position.holders.unknown': '服务器未为你统计持有人数（没有当前组织，或无权读取岗位分配）。',
  'engine.position.grants.none': '无',
  'engine.position.sets.title': '权限集',
  'engine.position.sets.hint': '此岗位列出的每个权限集授予的权限，按列出顺序显示。打开权限集可修改它。',
  'engine.position.sets.empty': '此岗位未列出任何权限集。',
  'engine.position.sets.loading': '加载中…',
  'engine.position.sets.notFound': '未找到权限集"{name}"。',
  'engine.position.sets.readFailed': '无法读取权限集"{name}"。',
  'engine.position.sets.open': '打开此权限集',
  'engine.list.emptyType': '暂无 {type} 条目',
  'engine.list.emptyQuery': '没有匹配 "{query}" 的结果',
  'engine.list.createHint': '点击上方"新建"创建第一个 {type}。',
  'engine.list.readOnlyHint': '此类型为只读 — 实例由包内的代码工件定义。',
  'engine.catalog.col.active': '启用',
  'engine.catalog.status.all': '全部',
  'engine.catalog.status.active': '已启用',
  'engine.catalog.status.inactive': '已停用',
  'engine.catalog.active.on': '已启用 — 点击停用',
  'engine.catalog.active.off': '已停用 — 点击启用',
  'engine.catalog.active.anchor':
    '受众锚点：它承载此部署中每个主体都持有的基线，因此不能停用。请通过绑定到它的权限集来调整它授予的内容。',
  'engine.catalog.active.unknown': '无法读取启用状态。',
  'engine.catalog.active.notVisible': '对你不可见',
  'engine.catalog.active.failed': '开关未保存：{message}',
  'engine.catalog.active.switchedOn': '已启用「{name}」。',
  'engine.catalog.active.switchedOff': '已停用「{name}」。',
  'engine.catalog.deactivate.title': '停用「{name}」？',
  'engine.catalog.deactivate.counting': '正在统计持有此权限的用户…',
  'engine.catalog.deactivate.holders': '{count} 个用户将失去此权限。',
  'engine.catalog.deactivate.holdersOne': '1 个用户将失去此权限。',
  'engine.catalog.deactivate.holdersAtLeast': '至少 {count} 个用户将失去此权限。',
  'engine.catalog.deactivate.everyone': '所有登录成员都将失去此权限：它绑定在 everyone 岗位上。',
  'engine.catalog.deactivate.countFailed': '无法读取持有此权限的用户数：{message}',
  'engine.catalog.deactivate.confirm': '停用',
  'engine.catalog.readOnly.single':
    '您的账号只能查看。{type}由平台管理员定义（需要 `manage_metadata` 能力）；您的组织负责分配。',
  'engine.catalog.readOnly.walled':
    '组织管理员只能查看。此部署中由平台运营方在 Studio 中为所有组织定义{type}；您的组织负责分配。',
  'engine.catalog.declaredOnly.hint.sharing_rule':
    '这些共享规则由已安装的软件包声明，只读。可以停用某条规则，或将其克隆为您组织自己的规则。您组织编写的规则在「组织规则」页面中。',
  'engine.catalog.declaredOnly.authoredLink.sharing_rule': '组织规则',
  'engine.catalog.declaredOnly.switchReadOnly':
    '您的账号只能查看：启用或停用已声明的条目需要 `manage_metadata` 能力。',
  'engine.sharingRule.clone.action': '克隆',
  'engine.sharingRule.clone.title': '克隆共享规则',
  'engine.sharingRule.clone.body':
    '以新名称从已声明的规则「{name}」创建一条归您组织所有的共享规则。已声明的规则本身不变。',
  'engine.sharingRule.clone.copyLabel': '{label}（副本）',
  'engine.sharingRule.clone.name': '新规则名称',
  'engine.sharingRule.clone.label': '新标签',
  'engine.sharingRule.clone.loading': '正在读取规则…',
  'engine.sharingRule.clone.noCriteria':
    '「{name}」停用期间，服务器不提供它的条件。请在新建表单中继续并填写条件。',
  'engine.sharingRule.clone.confirm': '创建规则',
  'engine.sharingRule.clone.continueInForm': '在新建表单中继续',
  'engine.sharingRule.clone.failed': '规则未创建。',
  'engine.sharingRule.clone.created':
    '已创建「{name}」。在您停用之前，已声明的规则「{source}」仍会授予访问权限。',
  'engine.sharingRule.clone.disableSource': '停用「{source}」',
  'engine.sharingRule.clone.sourceOff': '已声明的规则「{source}」已停用。',
  'engine.sharingRule.clone.openCopy': '打开新规则',
  'engine.sharingRule.clone.done': '完成',
  'engine.typeAction.confirmTitle': '对“{item}”执行{action}？',
  'engine.typeAction.confirmTitleNoItem': '执行{action}？',
  'engine.layers.code': '代码',
  'engine.layers.overlay': '覆盖',
  'engine.layers.effective': '生效',
  'engine.layers.diff': '差异',
  'engine.layers.diff.field': '字段',
  'engine.layers.diff.code': '代码（工件）',
  'engine.layers.diff.effective': '生效值',
  'engine.layers.diff.status': '状态',
  'engine.layers.diff.unchanged': '未变更',
  'engine.layers.diff.modified': '已修改',
  'engine.layers.diff.added': '新增',
  'engine.layers.diff.removed': '删除',
  'engine.layers.diff.showUnchanged': '显示未变更字段',
  'engine.layers.diff.noChanges': '覆盖层与代码值一致——没有字段级差异。',
  'engine.layers.diff.noBaseline': '没有代码级工件可比对——所有字段均为运行时创建。',
  'engine.layers.diff.summary': '{modified} 修改 · {added} 新增 · {removed} 删除',
  'engine.widgetPicker.search': '搜索组件…',
  'engine.widgetPicker.noMatches': '没有匹配项。',
  'engine.widgetPicker.category.kpi': '单值',
  'engine.widgetPicker.category.chart': '图表',
  'engine.widgetPicker.category.data': '表格',
  'engine.widgetPicker.type.metric': '指标 (KPI)',
  'engine.widgetPicker.type.bar': '柱状图',
  'engine.widgetPicker.type.horizontalBar': '条形图',
  'engine.widgetPicker.type.line': '折线图',
  'engine.widgetPicker.type.area': '面积图',
  'engine.widgetPicker.type.pie': '饼图',
  'engine.widgetPicker.type.donut': '环形图',
  'engine.widgetPicker.type.scatter': '散点图',
  'engine.widgetPicker.type.funnel': '漏斗图',
  'engine.widgetPicker.type.table': '数据表格',
  'engine.widgetPicker.type.pivot': '透视表',
  // ConditionBuilder 裸表达式模式（CEL 编辑器，#1582）
  'engine.condition.celLabel': 'CEL 表达式',
  'engine.condition.advancedHint': '高级表达式 —— 搭建器仅支持简单的 AND/OR 条件。',
  // Flow designer add-node palette (search box + recents, #1943)
  'engine.flowPalette.search': '搜索节点…',
  'engine.flowPalette.empty': '没有匹配的节点。',
  'engine.flowPalette.recent': '最近使用',
  // Palette section headings (localized display only)
  'engine.flowPalette.category.data': '数据',
  'engine.flowPalette.category.logic': '逻辑',
  'engine.flowPalette.category.human': '人工',
  'engine.flowPalette.category.integration': '集成',
  'engine.flowPalette.category.flow': '流程',
  // Flow node types — resolved by translateNodeLabel/Hint. Present only in the
  // zh table: for English the palette falls back to the engine descriptor's
  // own name/description (the server-authoritative label), so built-in nodes
  // read Chinese under zh-CN while plugin/unknown nodes gracefully fall back.
  'engine.flowNode.start.label': '开始',
  'engine.flowNode.create_record.label': '创建记录',
  'engine.flowNode.create_record.hint': '向对象中插入一条新记录',
  'engine.flowNode.map.label': '逐项映射',
  'engine.flowNode.map.hint': '对集合逐项运行子流程(可暂停)',
  'engine.flowNode.update_record.label': '更新记录',
  'engine.flowNode.update_record.hint': '更新匹配条件的记录',
  'engine.flowNode.get_record.label': '查询记录',
  'engine.flowNode.get_record.hint': '从对象中查询记录',
  'engine.flowNode.delete_record.label': '删除记录',
  'engine.flowNode.delete_record.hint': '删除匹配条件的记录',
  'engine.flowNode.decision.label': '条件分支',
  'engine.flowNode.decision.hint': '根据条件分支执行',
  'engine.flowNode.loop.label': '循环',
  'engine.flowNode.loop.hint': '遍历集合',
  'engine.flowNode.assignment.label': '设置变量',
  'engine.flowNode.assignment.hint': '为流程变量赋值',
  'engine.flowNode.parallel.label': '并行',
  'engine.flowNode.parallel.hint': '并发执行多个分支,结束时汇合',
  'engine.flowNode.try_catch.label': '异常捕获',
  'engine.flowNode.try_catch.hint': '用错误处理与重试保护步骤',
  'engine.flowNode.approval.label': '审批',
  'engine.flowNode.approval.hint': '暂停等待人工决策',
  // `add10d8f9` — `approval_revise` was the ONE palette entry with no zh
  // row, so it alone rendered the server descriptor: an English name and the
  // descriptor's three-line English paragraph in a list where every other node
  // is a Chinese name and a short Chinese phrase.
  //
  // This is a translation, not an override. The English stays exactly where
  // the other 21 node types keep theirs — `defineActionDescriptor` in the
  // framework's plugin-approvals — and `translateNodeLabel`/`translateNodeHint`
  // fall back to it whenever this table has no row, which is the whole reason
  // the en table carries no `engine.flowNode.*` entry at all. Wording follows
  // the 修订 vocabulary this console already uses for the same loop
  // (`engine.flowCanvas.addReviseLoop`, `engine.flowCanvas.awaitingRevision`),
  // and the hint is a one-line phrase like its siblings rather than a
  // translation of the descriptor's paragraph.
  'engine.flowNode.approval_revise.label': '修订窗口',
  'engine.flowNode.approval_revise.hint': '审批退回后暂停,等待提交人重新提交',
  'engine.flowNode.screen.label': '交互页面',
  'engine.flowNode.screen.hint': '收集用户输入',
  'engine.flowNode.http.label': 'HTTP 请求',
  'engine.flowNode.http.hint': '调用外部 API',
  'engine.flowNode.connector_action.label': '连接器',
  'engine.flowNode.connector_action.hint': '执行集成动作',
  'engine.flowNode.notify.label': '通知',
  'engine.flowNode.notify.hint': '向用户发送外发通知',
  'engine.flowNode.script.label': '脚本',
  'engine.flowNode.script.hint': '运行自定义代码',
  'engine.flowNode.subflow.label': '子流程',
  'engine.flowNode.subflow.hint': '调用其他流程',
  'engine.flowNode.wait.label': '等待',
  'engine.flowNode.wait.hint': '等待事件或定时器',
  'engine.flowNode.end.label': '结束',
  'engine.flowNode.end.hint': '终止流程',
  // Flow canvas chrome — toolbar, node affordances, banner.
  'engine.flowCanvas.zoomOut': '缩小',
  'engine.flowCanvas.zoomIn': '放大',
  'engine.flowCanvas.fit': '适应视图',
  'engine.flowCanvas.canvas': '流程画布',
  'engine.flowCanvas.reveal': '在画布中定位',
  'engine.flowCanvas.moreErrors': '还有 {count} 项…',
  'engine.flowCanvas.insertNode': '在此处插入节点',
  'engine.flowCanvas.addConnected': '添加后继节点',
  'engine.flowCanvas.addReviseLoop': '添加退回修订环(退回重新修订)',
  'engine.flowCanvas.addReviseLoopShort': '添加退回修订环',
  'engine.flowCanvas.awaitingRevision': '等待修订',
  'engine.flowCanvas.collapseRegions': '折叠嵌套区域',
  'engine.flowCanvas.expandRegions': '展开嵌套区域',
  // objectui#10862, slice 4.
  'engine.flowCanvas.edge.undeclaredCycle': '{source} → {target} —— 属于未声明的环；请将闭合该环的连线标记为回边',
  'engine.flowCanvas.edge.backEdge': '{source} ↩ {target}（回边）',
  'engine.flowCanvas.summary.branches': '{count} 个分支',
  'engine.flowCanvas.summary.approversOne': '{count} 位审批人',
  'engine.flowCanvas.summary.approversOther': '{count} 位审批人',
  'engine.flowCanvas.summary.unanimous': '全员',
  'engine.flowCanvas.summary.code': '代码',
  // objectui#11905 — the connect handle (see the en row).
  'engine.flowCanvas.connect': '拖到另一个节点上以连线',
  // Nested structured-region tray headers.
  'engine.flowRegion.branchN': '分支 {n}',
  'engine.flowRegion.try': '尝试',
  'engine.flowRegion.catch': '捕获',
  'engine.flowRegion.body': '循环体',
  // Flow preview header — pills, panel toggles, empty states.
  'engine.flowPreview.emptyHint': '在“表单”标签页中添加节点即可查看流程预览。',
  'engine.flowPreview.malformed': '某个流程节点或连线的格式有误。',
  'engine.flowPreview.pill.trigger': '触发',
  'engine.flowPreview.pill.status': '状态',
  'engine.flowPreview.pill.runAs': '运行身份',
  'engine.flowPreview.pill.onError': '出错时',
  'engine.flowPreview.showVars': '显示变量面板',
  'engine.flowPreview.hideVars': '隐藏变量面板',
  'engine.flowPreview.variables': '变量',
  'engine.flowPreview.noVars': '未声明变量。',
  'engine.flowPreview.runsTitle': '来自自动化引擎的运行历史',
  'engine.flowPreview.runs': '运行',
  'engine.flowPreview.problemsTitle': '校验问题',
  'engine.flowPreview.problems': '问题',
  'engine.flowPreview.debug': '调试',
  // objectui#10862, slice 4.
  'engine.flowPreview.varIn': '输入',
  'engine.flowPreview.varOut': '输出',
  // Flow run-history panel.
  'engine.flowRuns.title': '运行',
  'engine.flowRuns.refresh': '刷新运行历史',
  'engine.flowRuns.unavailable': '运行历史不可用 —— 自动化引擎已离线,或此流程尚未发布。',
  'engine.flowRuns.empty': '暂无运行记录。',
  'engine.flowRuns.noSteps': '未记录步骤日志。',
  'engine.flowRuns.iteration': '迭代',
  'engine.flowRuns.iterationN': '第 {n} 次迭代',
  'engine.flowRuns.branch': '分支',
  'engine.flowRuns.branchN': '分支 {n}',
  'engine.flowRuns.branchNIterationM': '分支 {n} · 第 {m} 次迭代',
  'engine.flowRuns.try': '尝试',
  'engine.flowRuns.catch': '捕获',
  'engine.flowRuns.status.completed': '已完成',
  'engine.flowRuns.status.failed': '失败',
  'engine.flowRuns.status.paused': '已暂停',
  'engine.flowRuns.status.running': '运行中',
  'engine.flowRuns.status.cancelled': '已取消',
  // objectui#10862, slice 4.
  'engine.flowRuns.runId': '运行 {id}',
  'engine.flowRuns.trigger': '触发 {type}',
  // Flow debug simulator.
  'engine.flowSim.run': '运行',
  'engine.flowSim.step': '单步',
  'engine.flowSim.continue': '继续',
  'engine.flowSim.reset': '重置',
  'engine.flowSim.add': '添加',
  'engine.flowSim.resumeBranch': '沿“{branch}”分支继续',
  'engine.flowSim.screen': '交互页面',
  'engine.flowSim.inputs': '输入',
  'engine.flowSim.setVariables': '设置变量',
  'engine.flowSim.setVariablesHint': '覆盖或注入任意变量(启动时优先于输入与模拟值)。',
  'engine.flowSim.mockOutputs': '模拟输出',
  'engine.flowSim.mockPlaceholder': '模拟结果(JSON)',
  'engine.flowSim.variables': '变量',
  'engine.flowSim.noVars': '未设置变量。',
  'engine.flowSim.timeline': '时间线',
  'engine.flowSim.namePlaceholder': '名称',
  'engine.flowSim.valuePlaceholder': '值',
  'engine.flowSim.removeVariable': '删除变量',
  'engine.flowSim.idleHint': '点击“运行”进行模拟,或用“单步”逐节点执行。副作用均为模拟 —— 不会调用后端。',
  'engine.flowSim.status.idle': '空闲',
  'engine.flowSim.status.running': '运行中',
  'engine.flowSim.status.paused': '已暂停',
  'engine.flowSim.status.done': '完成',
  'engine.flowSim.status.error': '错误',
  // objectui#10835 — the Debug run's step records (see the en rows).
  'engine.flowSim.stepStatus.ok': '正常',
  'engine.flowSim.stepStatus.mocked': '已模拟',
  'engine.flowSim.stepStatus.paused': '已暂停',
  'engine.flowSim.stepStatus.skipped': '已跳过',
  'engine.flowSim.stepStatus.error': '错误',
  'engine.flowSim.edge.error': '错误',
  'engine.flowSim.note.stepLimit': '超出步数上限({max}) —— 流程中可能存在死循环。',
  'engine.flowSim.note.nodeNotFound': '节点 “{id}” 不存在。',
  'engine.flowSim.note.resumed': '已继续。',
  'engine.flowSim.note.decisionTaken': '决策:{decision} → {taken}。',
  'engine.flowSim.note.decisionNoneTaken': '未走任何出向连线',
  'engine.flowSim.note.noDecision': '未提供决策;将考虑所有出向连线。',
  'engine.flowSim.note.flowEnd': '已到达流程结束。',
  'engine.flowSim.note.unsupported': '模拟器不模拟 “{type}”;按直通处理,不含其真实语义。',
  'engine.flowSim.note.parallelSplit': '并行拆分 —— 各分支同时展开(不模拟汇合同步)。',
  'engine.flowSim.note.approvalReached': '已到达审批 —— 请选择一个决策以继续。',
  'engine.flowSim.note.waitReached': '已到达等待 —— 请手动继续。',
  'engine.flowSim.note.screenReached': '已到达交互页面 —— 请填写输入后继续。',
  'engine.flowSim.note.screenUnevaluable':
    '交互页面字段的 visibleWhen 只能引用此页面上声明的字段;该页面无法求值 {fields}。',
  'engine.flowSim.note.screenUnevaluableField': '“{name}”({reason})',
  'engine.flowSim.note.screenNoInput': '交互页面没有输入 —— 已直接通过(与运行时一致)。',
  'engine.flowSim.note.passThrough': '类型 “{type}” 按直通处理。',
  'engine.flowSim.note.decisionNoOutEdge': '该条件分支没有出向连线;运行时在此结束该分支。',
  'engine.flowSim.note.branchMatched': '分支 “{label}” 已匹配(config.conditions)。',
  'engine.flowSim.note.noConditionMatched': 'config.conditions 中没有条目匹配;分支为 “{label}”。',
  'engine.flowSim.note.noAssignments': '未定义任何赋值。',
  'engine.flowSim.note.loopSinglePass': '循环按单次执行模拟(不模拟循环体的重复执行)。',
  'engine.flowSim.note.loopCollection': '集合 “{ref}” 有 {count} 项;按单次执行模拟。',
  'engine.flowSim.note.loopNotArray': '集合 “{ref}” 不是数组;运行时循环可能不会执行。',
  'engine.flowSim.note.loopCollectionNotList': '集合 “{ref}” 不是列表;运行时该循环在此失败。',
  'engine.flowSim.note.mockedCall': '已模拟对 “{fn}” 的调用(未执行任何函数)。',
  'engine.flowSim.note.retiredAction':
    '已退役的 “{action}” 动作 —— 它从未投递过任何内容;请改用通知节点(Slack 请用连接器)。',
  'engine.flowSim.note.retiredScript': '已退役的内联脚本 —— 运行时从未执行过它;请把逻辑移入已注册的函数。',
  'engine.flowSim.note.mocked': '已模拟 {type}(未调用后端)。',
  'engine.flowSim.note.noBranchLabel':
    '没有出向连线带有分支标签 “{label}”,因此会考虑所有出向连线,与运行时一致(运行时会记录一条警告)。',
  'engine.flowSim.note.evaluationFailed': '求值失败。',
  'engine.flowSim.note.multipleMatched':
    '有多个条件匹配;已走第一个声明的分支(运行时会走所有匹配的分支,objectstack#15429)。',
  'engine.flowSim.note.noEdgeTaken': '未走任何出向连线:没有为真的条件,也没有默认连线。运行时在此结束该分支。',
  // objectui#10848 — the CEL failure frames and the preview chrome (see the en rows).
  'engine.flowSim.note.celEvaluationFailed': 'CEL 求值失败:{message}',
  'engine.flowSim.note.celConditionFailed': '条件无法按 CEL 求值:{message}',
  'engine.celTest.predicateEmpty': '条件为空。',
  'engine.celTest.notObject': '应为 JSON 对象。',
  'engine.bookPreview.nameTitle': '为文档书命名',
  'engine.bookPreview.nameDescription': '在“表单”标签页中输入名称，即可开始编写文档目录骨架。',
  'engine.bookPreview.treeTitle': '打开实时解析的导航树（每个分组的实际文档）',
  'engine.bookPreview.tree': '解析后的目录树',
  'engine.bookPreview.audience.public': '公开',
  'engine.bookPreview.audience.permissionSet': '权限集：{name}',
  'engine.bookPreview.audience.org': '组织',
  'engine.bookPreview.slug': 'URL 标识：{slug}',
  'engine.bookPreview.noGroups': '尚无分组',
  'engine.bookPreview.noGroupsDescription':
    '文档书的 {groups} 骨架中至少需要一个分组。每个分组由 {include} 规则（如 {glob} 这样的通配符，或 {tag}）派生其成员。',
  'engine.bookPreview.noKey': '（无键）',
  'engine.bookPreview.orderTitle': '在文档书中的顺序',
  'engine.bookPreview.packageTitle': '成员规则仅限于此包',
  'engine.bookPreview.derived': '成员由上方的规则派生 —— 按实时文档集解析。',
  'engine.bookPreview.noRule': '没有 {include} 规则，也没有显式的 {pages} —— 除非文档设置了 {group}，否则此分组不匹配任何文档。',
  'engine.bookPreview.curatedTitle': '由显式页面指定的人工排序',
  'engine.bookPreview.curated': '人工排序',
  'engine.bookPreview.globTitle': '匹配文档名称的通配符',
  'engine.bookPreview.tagTitle': '按文档标签匹配',
  'engine.bookPreview.separator': '分隔线',
  'engine.bookPreview.rest': '…其余（剩余的匹配文档，按顺序）',
  'engine.bookPreview.emptyPage': '（空）',
  // The doc editor (previews/DocPreview, objectui#10188).
  'engine.docPreview.bookSection': '所属手册分组',
  'engine.docPreview.noSection': '未放入任何分组',
  'engine.docPreview.unknownSection': '{key}（不是任何文档手册的分组）',
  'engine.docPreview.booksLoading': '正在加载文档手册…',
  'engine.docPreview.booksFailed': '无法加载文档手册：{message}',
  'engine.docPreview.appearsIn': '出现在：',
  'engine.docPreview.publicBook': '公开',
  'engine.docPreview.noBooks': '尚无文档手册 —— 先创建一本，才能把这篇文档放进某个分组。',
  'engine.docPreview.unplaced': '尚未放入任何手册分组 —— 手册目录会把它列在“未分类”下。',
  'engine.docPreview.locales': '语言版本',
  'engine.docPreview.baseLocale': '默认',
  'engine.docPreview.removeLocale': '删除 {locale} 版本',
  'engine.docPreview.localePlaceholder': 'zh-CN',
  'engine.docPreview.addLocaleInput': '新的语言标记',
  'engine.docPreview.addLocale': '语言',
  'engine.docPreview.localeDuplicate': '{locale} 已有版本',
  'engine.docPreview.localeInvalid': '请使用 zh-CN 这样的语言标记',
  'engine.docPreview.variantTitle': '标题',
  'engine.docPreview.variantSummary': '摘要',
  'engine.docPreview.preview': '实时预览',
  'engine.docPreview.renderFailed': 'Markdown 渲染器无法渲染此内容。',
  'engine.docPreview.emptyEditing': '暂无可预览的内容 —— 请在源码区编写 Markdown。',
  'engine.docPreview.empty': '这篇文档没有内容。',
  'engine.docPreview.source': 'Markdown 源码',
  'engine.docPreview.sourceLocale': 'Markdown 源码（{locale}）',
  'engine.docPreview.sourcePlaceholder': '# 标题\n\n在此编写 Markdown…',
  'engine.translationPreview.empty': '此语言包为空 —— 至少添加一条译文，即可查看覆盖率报告。',
  'engine.translationPreview.category.objects': '对象',
  'engine.translationPreview.category.picklists': '选项列表',
  'engine.translationPreview.category.apps': '应用',
  'engine.translationPreview.category.messages': '消息',
  'engine.translationPreview.category.globalActions': '全局操作',
  'engine.translationPreview.category.dashboards': '仪表盘',
  'engine.translationPreview.category.datasets': '数据集',
  'engine.translationPreview.category.reports': '报表',
  'engine.translationPreview.category.pages': '页面',
  'engine.translationPreview.category.flows': '流程',
  'engine.translationPreview.category.positions': '岗位',
  'engine.translationPreview.category.permissions': '权限集',
  'engine.translationPreview.category.books': '文档书',
  'engine.translationPreview.category.metadataForms': '元数据表单',
  'engine.translationPreview.category.settingsCommon': '设置界面',
  'engine.translationPreview.coverage': '分类覆盖率：',
  'engine.translationPreview.totalKeys': '共 {count} 个键',
  'engine.translationPreview.categoryEmpty': '空',
  'engine.translationPreview.more': '另有 {count} 项…',
  'engine.translationPreview.keyCountOne': '{{count} 个键}',
  'engine.translationPreview.keyCountOther': '{{count} 个键}',
  'engine.celLint.notTheRow':
    '`{identifier}` 在此处不是记录行：行条件只把记录绑定为 `{canonical}`，别无其他。CEL 作用域词汇仍接受 `{identifier}`，所以这里不会阻止保存，但运行时表达式会以 `Unknown variable: {identifier}` 报错，规则永远不会触发。请改为以 `{canonical}` 为根引用。',
  'engine.pageBlockCanvas.renderFailed': '“{type}” 无法以当前配置渲染 —— 请检查它的属性。',
  'engine.pageBlockCanvas.itemN': '第 {n} 项',
  'engine.pageBlockCanvas.body': '主体',
  'engine.pageBlockCanvas.content': '内容',
  'engine.pageBlockCanvas.noRegions': '还没有区域',
  'engine.pageBlockCanvas.noRegionsHint': '页面由区域（header / main / sidebar / …）组成。添加一个区域，即可开始向其中放入区块。',
  'engine.pageBlockCanvas.addRegion': '添加区域',
  'engine.pageBlockCanvas.gridCell': '网格单元',
  'engine.pageBlockCanvas.addRegionAllFilled': '“{template}”模板放置的每个槽位都已填充（{slots}）。',
  'engine.pageBlockCanvas.addRegionUnknownTemplate': '“{template}”不是页面模板，不放置任何区域。',
  'engine.pageBlockCanvas.regionN': '区域 {n}',
  'engine.pageBlockCanvas.dropHere': '放到这里',
  'engine.pageBlockCanvas.slotInherited': '继承自默认页面 —— 添加一个区块即可覆盖此插槽。',
  'engine.pageBlockCanvas.regionEmpty': '空区域 —— 将区块拖放到这里，或使用下方的添加按钮。',
  'engine.pageBlockCanvas.select': '选择 {label}',
  'engine.pageBlockCanvas.span': '宽屏下占 12 列中的 {span} 列',
  'engine.pageBlockCanvas.groupEmpty': '空 —— 添加一个区块。',
  'engine.pageBlockCanvas.searchTypes': '搜索区块类型…',
  'engine.pageBlockCanvas.noMatch': '没有匹配的类型。',
  'engine.pageBlockCanvas.category.data': '数据',
  'engine.pageBlockCanvas.category.layout': '布局',
  'engine.pageBlockCanvas.category.record': '记录上下文',
  'engine.pageBlockCanvas.category.navigation': '导航',
  'engine.pageBlockCanvas.category.element': '元素',
  'engine.pageBlockCanvas.category.ai': 'AI',
  'engine.pageBlockCanvas.category.misc': '其他',
  'engine.pageBlockCanvas.type.grid': '网格',
  'engine.pageBlockCanvas.type.objectGrid': '表格',
  'engine.pageBlockCanvas.type.objectForm': '表单',
  'engine.pageBlockCanvas.type.objectMetric': '指标',
  'engine.pageBlockCanvas.type.objectKanban': '看板',
  'engine.pageBlockCanvas.type.pageHeader': '页头',
  'engine.pageBlockCanvas.type.pageFooter': '页脚',
  'engine.pageBlockCanvas.type.pageSidebar': '侧边栏',
  'engine.pageBlockCanvas.type.pageTabs': '标签页',
  'engine.pageBlockCanvas.type.pageAccordion': '折叠面板',
  'engine.pageBlockCanvas.type.pageCard': '卡片',
  'engine.pageBlockCanvas.type.pageSection': '分区',
  'engine.pageBlockCanvas.type.recordDetails': '记录详情',
  'engine.pageBlockCanvas.type.recordHighlights': '重点信息',
  'engine.pageBlockCanvas.type.recordRelatedList': '关联列表',
  'engine.pageBlockCanvas.type.recordActivity': '活动时间线',
  'engine.pageBlockCanvas.type.recordDiscussion': '讨论',
  'engine.pageBlockCanvas.type.recordPath': '阶段路径',
  'engine.pageBlockCanvas.type.recordAlert': '提醒横幅',
  'engine.pageBlockCanvas.type.recordQuickActions': '快捷操作',
  'engine.pageBlockCanvas.type.recordReferenceRail': '参考侧栏',
  'engine.pageBlockCanvas.type.recordHistory': '历史记录',
  'engine.pageBlockCanvas.type.navMenu': '导航菜单',
  'engine.pageBlockCanvas.type.navBreadcrumb': '面包屑',
  'engine.pageBlockCanvas.type.globalSearch': '全局搜索',
  'engine.pageBlockCanvas.type.aiSuggestion': 'AI 建议',
  'engine.pageBlockCanvas.type.elementText': '文本',
  'engine.pageBlockCanvas.type.elementNumber': '数字',
  'engine.pageBlockCanvas.type.elementImage': '图片',
  'engine.pageBlockCanvas.type.elementDivider': '分隔线',
  'engine.pageBlockCanvas.type.elementButton': '按钮',
  'engine.pageBlockCanvas.type.elementDefinitionList': '定义列表',
  'engine.pageBlockCanvas.type.elementRepeater': '重复器',
  'engine.sourcePageEditor.source': '页面源码',
  'engine.sourcePageEditor.renderFailed': '页面源码在渲染时抛出错误 —— 请在“源码”标签页中修复代码。',
  'engine.fieldsListEditor.columns': '列',
  'engine.fieldsListEditor.empty': '还没有列。请在下方添加字段。',
  'engine.fieldsListEditor.colN': '列 {n}',
  'engine.viewColumnPanes.remove': '移除 {label}',
  // 连线(edge)Type 枚举值 —— 属性表单里的 SchemaForm 下拉(与画布连线检查器一致)。
  'engine.enum.type.default': '普通',
  'engine.enum.type.conditional': '条件',
  'engine.enum.type.fault': '故障(错误路径)',
  'engine.enum.type.back': '回边(退回修改环)',
  // 流程结构校验(flow-sim-validate)—— 画布横幅、问题面板、调试模拟器。
  'engine.flowValidate.nodeMissingId': '有节点缺少 id。',
  'engine.flowValidate.duplicateNodeId': '重复的节点 id “{id}”。',
  'engine.flowValidate.edgeSourceMissing': '连线的源节点 “{source}” 不存在。',
  'engine.flowValidate.edgeTargetMissing': '连线的目标节点 “{target}” 不存在。',
  'engine.flowValidate.exprRefNodeMissing': '表达式 “{ref}” 读取的节点 “{id}” 不存在。',
  'engine.flowValidate.boundaryHostMissing': '边界事件 “{name}”（{id}）附着的节点 “{host}” 不存在。',
  'engine.flowValidate.startHasIncoming': '开始节点存在入边。',
  'engine.flowValidate.multipleStart': '流程有 {count} 个开始节点;应只有一个。',
  'engine.flowValidate.noStartUsingRoot': '没有“开始”节点;以唯一的根节点作为入口。',
  'engine.flowValidate.noEntry': '没有入口节点(每个节点都有入边 —— 整个图是全环状)。',
  'engine.flowValidate.ambiguousEntry': '无法确定唯一入口节点(有 {count} 个候选)。请添加一个“开始”节点。',
  'engine.flowValidate.decisionMultipleDefaults': '条件分支 “{name}”（{id}）有 {count} 个默认分支。',
  'engine.flowValidate.decisionNoBranches': '条件分支 “{name}”（{id}）没有出向分支。',
  'engine.flowValidate.decisionNoDefault': '条件分支 “{name}”（{id}）没有默认分支;当无条件匹配时可能走入死路。',
  'engine.flowValidate.nodeUnreachable': '节点 “{name}”（{id}）从入口不可达。',
  'engine.flowValidate.cycleDetected': '检测到环({cycle})。将闭合该环的连线标记为回边(连接类型 → 回边)以声明这是有意的退回 / 返工环。',
  // 未知引用(作用域)告警(flow-ref-check)—— 问题面板 + 表达式字段内联提示。
  'engine.flowRef.unknownWithSuggestion': '未知引用 `{token}` —— 是否想用 `{suggestion}`?',
  'engine.flowRef.notInScope': '`{token}` 在当前步骤的作用域中不是有效引用。',
  'engine.flowRef.notInScopeMulti': '不在作用域内:{tokens}。',
  'engine.flowRef.notAScreenField': '`{token}` 不是此页面上的字段',
  'engine.flowRef.notAScreenFieldWithSuggestion': '`{token}` 不是此页面上的字段(是否想用 `{suggestion}`?)',
  'engine.flowExpr.templateDialect': '此处应为文本模板，但得到的是 `{dialect}` 表达式。',
  'engine.flowExpr.singleBraceTemplate': '单花括号 `{{ref}}` 不是有效的模板占位 —— 请使用双花括号：`{{ {ref} }}`。',
  'engine.flowExpr.celDialect': '此处应为 CEL 表达式，但得到的是 `{dialect}` 方言。',
  'engine.flowExpr.braceInCondition':
    '条件中似乎用了模板花括号 `{{ref}}` —— `{…}` 会被解析为 CEL 映射字面量而失败。请直接写引用本身，例如 `{ref}`。条件是裸 CEL（例如 `record.rating >= 4`）。',
  'engine.flowExpr.unbalancedParens': '`{source}` 中的圆括号不配对。',
  'engine.flowExpr.unbalancedBrackets': '`{source}` 中的方括号不配对。',
  'engine.flowScope.picker.insert': '插入引用',
  'engine.flowScope.picker.search': '搜索引用…',
  'engine.flowScope.picker.empty': '没有匹配的引用。',
  'engine.flowScope.group.variables': '流程变量',
  'engine.flowScope.group.outputs': '上游输出',
  'engine.flowScope.group.loop': '循环项',
  'engine.flowScope.group.trigger': '触发记录',
  'engine.flowScope.group.approvalCurrent': '当前记录（进入节点时的实时值）',
  'engine.flowScope.group.approvalTrigger': '触发快照（提交时）',
  'engine.flowScope.group.screenFields': '页面字段',
  'engine.flowScope.detail.variable': '变量',
  'engine.flowScope.detail.variableTyped': '变量 · {type}',
  'engine.flowScope.detail.triggerRecord': '触发记录 · {object}',
  'engine.flowScope.detail.previousRecord': '变更前的记录值',
  'engine.flowScope.detail.priorOf': '{detail}（变更前）',
  'engine.flowScope.detail.priorValue': '变更前的值',
  'engine.flowScope.detail.preUpdateRow': '更新前的行',
  // 问题面板(ProblemsPanel)。
  'engine.flowProblems.title': '问题',
  'engine.flowProblems.empty': '没有问题 —— 该流程结构有效。',
  'engine.flowProblems.sourceSchema': '架构',
  'engine.flowProblems.sourceExpression': '表达式',
  // objectui#11772 — one extra copy of a connection (see the en row).
  'engine.flowProblems.repeatedEdge': '连线 “{sourceName}”（{source}）→ “{targetName}”（{target}）重复;流程会为每一条副本各运行一次 “{targetName}”。请删除这条副本。',
  // objectui#11905 — a refused connection (see the en rows).
  'engine.flowProblems.connectRefused.missingSource': '无法连线：此流程中没有节点 “{source}”。',
  'engine.flowProblems.connectRefused.missingTarget': '无法连线：此流程中没有节点 “{target}”。',
  'engine.flowProblems.connectRefused.self': '无法将 “{source}” 连到它自身。',
  'engine.flowProblems.connectRefused.repeat': '“{source}” 已经连到 “{target}”。请选中那条连线再修改。',
  'engine.badge.createOnly': '仅可新建',
  'engine.repeater.empty': '暂无条目。点击 + 添加。',
  'engine.badge.writable': '可写',
  'engine.badge.readOnly': '只读',
  'engine.cancel': '取消',
  'engine.close': '关闭',
  'engine.validation.invalid': '输入无效',
  'engine.validation.pattern': '格式无效：必须匹配 {pattern}',
  'engine.validation.expectedStringUndefined': '必填，需输入文本',
  'engine.validation.expectedType': '类型无效：应为 {expected}，当前为 {received}',
  'engine.validation.invalidOption': '选项无效：必须是 {options} 之一',
  'engine.validation.failed': '校验失败（{count} 个问题）。',
  'engine.validation.serverRefused': '服务端已拒绝此草稿 —— 请先修复 {issue} 再保存。',
  'engine.validation.failedOne': '校验失败（1 个问题）。',
  'engine.validation.nameRequired': '名称必填。',
  // objectui#12810 — 见英文表同名条目。
  'engine.validation.seedPlaceholderUnset': '请先设置 {fields} 再保存：新建项不会带着模板的占位值保存。',
  'engine.embedded.saved': '已保存。',
  'engine.embedded.readOnlyParent': '父类型为只读；仍会尝试 PUT 保存，但服务器可能拒绝。',
  'engine.embedded.saveIntoParent': '保存到 {parentType}',
  'engine.embedded.saveNoPath': '无法保存：此条目没有注册 embeddedPath。',
  'engine.embedded.noSchema': '{type} 未注册表单 schema。请在下方编辑原始 JSON；保存时会写回 {target}。',
  'engine.embedded.readOnly': '只读',
  'engine.embedded.noPathHint': '未注册 embeddedPath，无法判断该条目应写回哪里。',

  'engine.quickfind.placeholder': '搜索元数据类型或条目…（如：view、account）',
  'engine.quickfind.empty': '输入关键字以搜索所有元数据类型。',
  'engine.quickfind.title': '快速查找',
  'engine.quickfind.indexing': '正在索引所有类型，共',
  'engine.quickfind.noMatches': '没有匹配项。',
  'engine.breadcrumb.allTypes': '元数据',

  'engine.draftConflict.title': '此草稿在你打开后已被修改',
  'engine.draftConflict.description':
    '{type}「{name}」的草稿在你打开后已在别处保存（其他人或另一个标签页）。可以重新加载已保存的版本（此处未保存的修改将丢弃），或用你的版本覆盖它。',
  'engine.draftConflict.reload': '重新加载已保存版本',
  'engine.draftConflict.overwrite': '覆盖…',
  'engine.draftConflict.keepEditing': '继续编辑',
  'engine.draftConflict.overwriteTitle': '覆盖已保存的草稿？',
  'engine.draftConflict.overwriteDescription':
    '你的{type}「{name}」将替换已保存的草稿，你打开之后保存的那些修改会丢失。',
  'engine.draftConflict.overwriteConfirm': '覆盖',
  'engine.draftConflict.back': '返回',
  'engine.draftConflict.notSaved': '未保存：{type}「{name}」在你打开后已在别处保存。',
  'engine.studio.inspector.props': '属性',
  'engine.studio.inspector.draftFooter': '编辑先保存为草稿，发布包后生效。',
  'engine.studio.inspector.collapse': '收起属性',
  'engine.studio.inspector.expand': '展开属性',
  'engine.studio.inspector.emptyLine1': '在画布里点选一个积木,',
  'engine.studio.inspector.emptyLine2': '它的属性会在这里直接编辑。',
  'engine.studio.inspector.studioCanvasNoBlocks':
    '此画布渲染的是运行态应用，而不是积木树 —— 这里没有可选中的积木，也没有可在本面板编辑的内容。',
  'engine.studio.inspector.listView.kind': '列表视图',
  'engine.studio.inspector.listView.intro': '画布上的就是这个列表。它的列、筛选与排序保存到本包的草稿,并立即显示在画布上。',
  'engine.studio.inspector.listView.defaultTitle': '{object} · 默认视图',
  'engine.studio.inspector.listView.namedTitle': '{object} · {view}',
  'engine.studio.inspector.listView.notCreated': '还没有列表视图「{view}」。在这里做的第一次修改会在本包的草稿中创建它。',
  'engine.studio.inspector.listView.readOnly': '本包只读:这里展示列表视图,不能编辑。',
  'engine.studio.inspector.listView.notList': '「{view}」不是列表视图,因此不在这里编辑。',
  'engine.studio.inspector.listView.filter': '筛选',
  'engine.studio.inspector.listView.sort': '排序',
  'engine.studio.inspector.listView.addSort': '+ 添加排序…',
  'engine.studio.inspector.listView.sortAsc': '{field} 升序',
  'engine.studio.inspector.listView.sortDesc': '{field} 降序',
  'engine.studio.inspector.listView.kanbanCard': '看板卡片',
  'engine.studio.inspector.listView.kanbanCard.intro': '看板上每张卡片显示什么,点一张卡片时打开什么。',
  'engine.studio.inspector.listView.kanbanCard.groupByFirst': '先选分组字段:卡片设置随它一起保存。',
  'engine.studio.inspector.listView.kanbanCard.fields': '卡片字段',
  'engine.studio.inspector.listView.kanbanCard.title': '标题',
  'engine.studio.inspector.listView.kanbanCard.titleRecordName': '记录名称',
  'engine.studio.inspector.listView.kanbanCard.open': '点击打开',
  'engine.studio.inspector.listView.kanbanCard.openDefault': '默认',
  'engine.studio.inspector.listView.kanbanCard.mode.page': '记录页',
  'engine.studio.inspector.listView.kanbanCard.mode.drawer': '侧边抽屉',
  'engine.studio.inspector.listView.kanbanCard.mode.newWindow': '新窗口',
  'engine.studio.inspector.listView.kanbanCard.mode.none': '不打开',
  'engine.studio.inspector.listView.kanbanCard.groupBy': '分组字段',
  'engine.studio.inspector.listView.kanbanCard.pickField': '选择字段',
  'engine.studio.inspector.designersMissing': '本次会话没有注册任何元数据设计器,这里没有可编辑的内容。',
  'engine.studio.inspector.noPageSchema': '页面设置不可用——无法加载页面 schema。',



  // ── AppNavCanvas (nav-tree editor, used by Studio + AppPreview) ─────────
  'engine.appNav.heading': '导航',
  'engine.appNav.addItem': '添加导航项',
  'engine.appNav.removeItem': '删除导航项',
  'engine.appNav.empty': '还没有导航项 — 点「添加导航项」开始',
  'engine.appNav.emptyReadonly': '还没有顶层导航项',
  'engine.appNav.item': '导航项 {n}',
  'engine.appNav.itemOne': '项',
  'engine.appNav.itemOther': '项',
};

/** Whether a locale resolves to Chinese (the only non-English catalog). */
export function isZhLocale(locale?: SupportedLocale | string): boolean {
  return (locale ?? '').toLowerCase().startsWith('zh');
}

/** zh-CN overrides for one flow-node config field. English is the fallback. */
interface FlowFieldZh {
  label?: string;
  help?: string;
  /** The field's `unsetNotice` (objectui#11054). */
  unsetNotice?: string;
  /** select option value → zh label. */
  opts?: Record<string, string>;
  /** objectList column key → zh label (+ nested option labels). */
  cols?: Record<string, { label?: string; opts?: Record<string, string> }>;
}

/**
 * zh-CN translations for the flow node inspector's config fields, keyed by the
 * canonical node type then the field `id`. Consumed by
 * `localizeFlowFields` (flow-node-config) at render, which overlays these onto
 * the English field table AND the engine-published `configSchema` fields (they
 * share field ids for built-in nodes). Any field/option absent here falls back
 * to its English label, so plugin nodes stay readable. Placeholders (example
 * literals like cron strings / URLs) are intentionally left in English.
 */
const FLOW_FIELD_ZH: Record<string, Record<string, FlowFieldZh>> = {
  start: {
    triggerType: {
      label: '触发方式',
      help: '流程何时启动。记录触发在数据变更时触发;定时触发按计划(cron、间隔或指定时间)触发。',
      opts: {
        'record-after-create': '记录创建后',
        'record-after-update': '记录更新后',
        'record-after-write': '记录创建或更新后',
        'record-before-update': '记录更新前',
        'record-after-delete': '记录删除后',
        schedule: '定时',
        time_relative: '相对时间(日期扫描)',
        manual: '手动 / 自动启动',
        api: 'Webhook / API',
      },
    },
    // objectui#11054 — the inbound hook's per-flow secret (write-only).
    secret: {
      label: '密钥',
      help: '入站 hook 用来校验每一次请求的流程级密钥。只写不读:已保存的密钥不会在此显示,留空即保持不变。',
      unsetNotice: '未输入密钥。API 触发的流程若开始节点没有密钥,会被拒绝。此流程已保存的密钥在留空时保持不变。',
    },
    objectName: { label: '对象', help: '其记录变更会启动此流程的对象。' },
    condition: {
      label: '进入条件',
      help: 'CEL 表达式 —— 仅当其为 true 时流程才运行(相对时间扫描时对每条匹配记录做门控)。留空则每次事件都运行。',
    },
    'schedule.expression': {
      label: 'Cron 表达式',
      help: 'Cron 表达式 —— 流程运行的时刻。相对时间扫描留空默认每日。',
    },
    'timeRelative.object': { label: '扫描对象', help: '每次运行被扫描的对象。' },
    'timeRelative.dateField': { label: '日期字段', help: '与今天比较的日期 / 日期时间字段。' },
    'timeRelative.withinDays': {
      label: '天数范围内',
      help: '范围模式:当日期在今天前后 N 天内时触发(负值 = 逾期回溯)。若用偏移天数则留空。',
    },
    'timeRelative.offsetDays': {
      label: '偏移天数',
      help: '偏移模式:当日期恰好等于今天 + 各偏移量时触发(如 60、30、7)。若用天数范围则留空。',
    },
    'timeRelative.filter': { label: '附加筛选', help: '与日期窗口做 AND 的可选筛选(如 status = active)。' },
    'timeRelative.maxRecords': { label: '每次最多记录数', help: '每次扫描启动的记录数上限(默认 1000)。' },
    criteria: { label: '进入条件(旧)', help: '旧字段 —— 建议使用“进入条件”(condition)。' },
  },
  end: {
    outcome: {
      label: '结果',
      help: '运行在此处如何结束。“已完成”是普通终态,也是省略该键时的取值。“已拒绝”把拒绝记为一等结果 —— 它是一次成功的评估,只是结论为否 —— 并要求在下方字段中给出拒绝理由 message({{ }} 模板)。',
      opts: { completed: '已完成', refused: '已拒绝' },
    },
    // objectui#9336 —— 仅在“结果”选为“已拒绝”时出现(见 flow-node-config 的
    // `showWhen`);契约两个方向都校验:已拒绝必须有 message,已完成则拒收它。
    message: {
      label: '拒绝原因',
      help: '当结果为“已拒绝”时必填;结果为“已完成”时则被拒收 —— 已完成的结束节点不渲染任何文本,该键会成为静默的空操作。支持 {{ }} 模板(如 {{ record.name }}),与屏幕节点的“描述”一致。',
    },
    // objectui#9335 — an `outputVariable` overlay lived here and went with the
    // descriptor it localized: `EndConfigSchema` refuses that key by name, so
    // the end group no longer offers a field for it (see flow-node-config).
  },
  decision: {
    conditions: {
      label: '分支',
      help: '每个分支包含标签、CEL 表达式和目标节点。表达式为 “true” 的分支即默认 / else 路径。选择目标会接线该分支的出边(创建或更新),清空则断开该边。',
      cols: { label: { label: '标签' }, expression: { label: '表达式' }, target: { label: '目标节点' } },
    },
    condition: { label: '单一条件', help: '旧的单分支条件(CEL)。建议使用上方“分支”;每条边的条件也可写在出边上。' },
  },
  assignment: {
    assignments: { label: '赋值', help: '设置变量:每个键为一个变量,值为表达式或字面量。' },
  },
  loop: {
    collection: {
      label: '集合',
      help: '要遍历的列表:求值为列表的 CEL 表达式(如 leadList),或以 JSON 数组写出的各项。没有循环体区域的循环改为读取列表变量的裸名称。',
    },
    iteratorVariable: { label: '当前项变量', help: '存放当前项的循环变量。' },
    indexVariable: { label: '索引变量', help: '存放当前索引的可选循环变量。' },
    maxIterations: { label: '最大迭代次数' },
  },
  map: {
    collection: { label: '集合', help: '要逐项处理的列表:求值为列表的 CEL 表达式(如 items),或以 JSON 数组写出的各项。' },
    flowName: { label: '每项子流程', help: '为每一项运行的子流程 —— 它可以暂停(如审批)。' },
    iteratorVariable: { label: '当前项变量' },
    itemObject: { label: '项对象', help: '当项为记录时,它们所属的对象(将每项暴露为子流程的记录)。' },
    outputVariable: { label: '输出变量', help: '各项子流程的输出,按顺序收集。' },
  },
  create_record: {
    objectName: { label: '对象' },
    fields: { label: '字段值', help: '写入新记录的字段值。' },
    outputVariable: { label: '输出变量' },
  },
  update_record: {
    objectName: { label: '对象' },
    filter: { label: '筛选', help: '标识待更新记录的字段 / 值对。每个值是字面量,或 CEL 表达式(如 id → 以表达式写的 recordId)。' },
    fields: { label: '字段值', help: '要写入的字段值。' },
  },
  delete_record: {
    objectName: { label: '对象' },
    filter: { label: '筛选', help: '标识待删除记录的字段 / 值对。每个值是字面量,或 CEL 表达式。' },
  },
  get_record: {
    objectName: { label: '对象' },
    filter: { label: '筛选', help: '待匹配的字段 / 值对(如 status → active)。每个值是字面量,或 CEL 表达式。像 {"$ne": null} 这样的运算符值会被保留。' },
    limit: { label: '数量上限' },
    outputVariable: { label: '输出变量' },
  },
  http: {
    method: { label: '方法' },
    url: { label: 'URL', help: '请求 URL。会渲染 {{ }} 占位。' },
    headers: { label: '请求头', help: '请求头(如 Authorization、Content-Type)。每个值都会渲染 {{ }} 占位。' },
    body: { label: '请求体', help: '请求负载:按原样发送的 JSON,或求值为负载的 CEL 表达式。' },
    // objectui#11968 — no `outputVariable` overlay: the `http` contract declares
    // no such key, so neither form offers a field for it.
    durable: { label: '持久化(异步)', help: '通过持久化队列即发即忘(异步投递)。' },
    signingSecret: { label: '签名密钥', help: 'HMAC-SHA256 密钥 → 写入 X-Objectstack 签名请求头。' },
    timeoutMs: { label: '超时(毫秒)' },
  },
  script: {
    actionType: {
      label: '动作类型',
      help: '本步骤如何运行。“调用函数”会调用已注册的函数 —— 真正执行逻辑的路径。',
      opts: { invoke_function: '调用函数', email: '邮件', slack: 'Slack' },
    },
    function: { label: '函数', help: '要调用的已注册函数 —— 经 defineStack({ functions }) 声明。优先于动作类型。' },
    inputs: { label: '输入', help: '传给函数的值。每个值是字面量,或按流程变量求值的 CEL 表达式。' },
    outputVariable: { label: '输出变量', help: '绑定函数返回值的流程变量,供后续步骤使用。' },
    template: { label: '模板', help: '消息模板 id。' },
    recipients: { label: '收件人', help: '每行一个收件人(用户 id、字段引用或地址)。' },
    variables: { label: '模板变量', help: '注入模板的值。' },
    script: {
      label: '代码(不执行)',
      help: '内置运行时不执行内联脚本 —— 此节点为 no-op。请把逻辑移入已注册函数并使用“调用函数”。',
    },
    timeoutMs: { label: '超时(毫秒)' },
  },
  screen: {
    title: { label: '标题', help: '显示在页面上方的标题。' },
    description: { label: '描述', help: '正文文本。会渲染 {{ }} 占位(如 {{ approval_path }})。' },
    fields: {
      label: '字段',
      help: '此页面收集的输入字段。留空则为纯消息页面。',
      cols: {
        name: { label: '名称' },
        label: { label: '标签' },
        type: { label: '类型' },
        required: { label: '必填' },
        visibleWhen: { label: '显示条件' },
      },
    },
    waitForInput: {
      label: '等待输入',
      help: '即使没有字段也暂停以展示此页面(消息 / 确认)。无字段且关闭此项则为服务端直通。',
    },
    objectName: { label: '对象表单', help: '渲染该对象完整的新建 / 编辑表单(含主从),而非扁平字段列表。' },
    idVariable: { label: '保存记录变量', help: '仅对象表单:绑定到已保存记录 id 的变量,供后续步骤使用。' },
    mode: { label: '表单模式', help: '仅对象表单。', opts: { create: '新建', edit: '编辑' } },
    defaults: { label: '表单默认值', help: '仅对象表单:预填值。每个值是字面量,或 CEL 表达式(如 account → 以表达式写的 account_id)。' },
  },
  approval: {
    approvers: {
      label: '审批人',
      help: '谁可以处理此步骤。为节点的出边打上 “approve” 和 “reject” 标签。',
      cols: {
        type: {
          label: '类型',
          opts: {
            user: '用户',
            position: '岗位',
            org_membership_level: '组织成员(所有者 / 管理员 / 成员)',
            team: '团队',
            department: '部门',
            manager: '上级',
            field: '字段',
            queue: '队列',
          },
        },
        value: { label: '值' },
        group: { label: '分组' },
      },
    },
    behavior: {
      label: '审批方式',
      help: '多个审批人如何组合。任何一个拒绝在所有模式下都是否决。',
      opts: {
        first_response: '首个响应生效',
        unanimous: '全员通过',
        quorum: '法定人数(N 选 M)',
        per_group: '分组会签(每组签核)',
      },
    },
    minApprovals: { label: '最少审批数', help: '所需审批数 —— quorum 为总数,per_group 为每组。服务端会做钳制以防死锁。' },
    lockRecord: { label: '锁定记录', help: '此节点待处理期间锁定触发记录,禁止编辑。' },
    approvalStatusField: {
      label: '状态字段',
      help: '将请求状态(待审 / 通过 / 拒绝)镜像到的业务对象字段。应为只读。',
    },
    'escalation.enabled': { label: 'SLA 升级', help: '在超时内未做决策时升级。' },
    'escalation.timeoutHours': { label: '超时(小时)' },
    'escalation.action': {
      label: '超时动作',
      opts: { notify: '通知', reassign: '改派', auto_approve: '自动通过', auto_reject: '自动拒绝' },
    },
    'escalation.escalateTo': { label: '升级至' },
    'escalation.notifySubmitter': { label: '通知提交人' },
    maxRevisions: {
      label: '最多退回次数',
      help: '请求自动拒绝前的最多退回修订次数(0 表示禁用退回)。需要一条 “revise” 出边才生效。',
    },
  },
  wait: {
    'waitEventConfig.eventType': {
      label: '等待类型',
      opts: { timer: '定时器', signal: '信号', webhook: 'Webhook', manual: '手动', condition: '条件' },
    },
    'waitEventConfig.timerDuration': { label: '时长', help: 'ISO 8601 时长(如 PT1H、P3D)。' },
    'waitEventConfig.signalName': { label: '信号名称' },
    // `waitEventConfig.timeoutMs` / `.onTimeout` 的覆盖随字段一并移除(#3101):
    // 两个键在 spec 17.0.0-rc.1 已是墓碑,表单不再提供授权入口。
  },
  subflow: {
    flowName: { label: '流程' },
    input: { label: '输入映射', help: '传给子流程输入变量的值。每个值是字面量,或在本流程中求值的 CEL 表达式。' },
    outputVariable: { label: '输出变量' },
    timeoutMs: { label: '超时(毫秒)' },
  },
  connector_action: {
    // Client field ids carry the `connectorConfig.` block prefix; the engine's
    // published configSchema uses flat ids — cover both so on/offline match.
    'connectorConfig.connectorId': { label: '连接器' },
    'connectorConfig.actionId': { label: '动作' },
    'connectorConfig.input': { label: '输入', help: '连接器动作的映射输入。' },
    connectorId: { label: '连接器', help: '已注册的连接器名称。' },
    actionId: { label: '动作', help: '连接器声明的动作标识。' },
    input: { label: '输入', help: '连接器动作的映射输入。' },
    timeoutMs: { label: '超时(毫秒)' },
  },
  try_catch: {
    errorVariable: { label: '错误变量', help: '在 catch 区域内绑定所捕获错误的变量。' },
    retry: { label: '重试' },
  },
  // notify's offline table and the engine-published configSchema share these
  // field ids, so one overlay localizes both forms.
  notify: {
    recipients: { label: '收件人', help: '接收通知的人：触发记录的某个字段、用户、团队或邮箱地址。至少需要一个。' },
    title: { label: '标题', help: '通知标题(别名:subject)。' },
    message: { label: '内容', help: '通知正文(别名:body)。' },
    channels: { label: '渠道', help: '扇出投递的渠道(默认站内)。' },
    topic: { label: '主题', help: '事件主题(默认 "notify")。' },
    severity: { label: '级别', help: 'info | warning | critical' },
    sourceObject: { label: '来源对象', help: '通知所关联记录的对象名。' },
    sourceId: { label: '来源记录', help: '通知链接到的记录 id(需配合来源对象):以文本写出的 id,或 CEL 表达式(如 record.id)。' },
    actorId: { label: '触发用户', help: '引发该事件的用户 id。' },
    // objectui#11968 — keyed `actionUrl`, the key the contract declares and both
    // forms now write; the `url` spelling is the converted alias.
    actionUrl: { label: '链接 URL', help: '显式的点击跳转 URL;覆盖默认值。会渲染 {{ }} 占位。' },
    payload: { label: '附加数据', help: '合并进模板输入的额外数据。' },
  },
  boundary_event: {
    'boundaryConfig.attachedToNodeId': { label: '附加到', help: '此边界事件所监视的宿主节点。' },
    'boundaryConfig.eventType': {
      label: '事件类型',
      opts: { error: '错误', timer: '定时器', signal: '信号', cancel: '取消' },
    },
    'boundaryConfig.interrupting': { label: '中断', help: '此事件触发时取消宿主活动。' },
    'boundaryConfig.errorCode': { label: '错误码' },
    'boundaryConfig.timerDuration': { label: '时长' },
    'boundaryConfig.signalName': { label: '信号名称' },
  },
  legacy_action: {
    action: { label: '动作' },
    objectName: { label: '对象' },
    recordId: { label: '记录' },
    params: { label: '参数', help: '动作输入。值会自动定型:3 → 数字,true → 布尔。' },
    fields: { label: '字段值' },
    outputVariable: { label: '输出变量' },
  },
};

/** zh-CN overrides for a flow config field, or `undefined` for an unknown one. */
export function flowFieldZh(type: string, id: string): FlowFieldZh | undefined {
  return FLOW_FIELD_ZH[type]?.[id];
}

function pickTable(
  locale: SupportedLocale | string | undefined,
): { types: Record<string, string>; domains: Record<string, string>; strings: Record<string, string> } {
  const lower = (locale ?? '').toLowerCase();
  if (lower.startsWith('zh')) {
    return { types: TYPE_LABELS_ZH, domains: DOMAIN_LABELS_ZH, strings: ENGINE_STRINGS_ZH };
  }
  return { types: TYPE_LABELS_EN, domains: DOMAIN_LABELS_EN, strings: ENGINE_STRINGS_EN };
}

/**
 * The value of one designer string: this module's own table for the locale
 * first, then the `studio` namespace in `@object-ui/i18n`, which the table is
 * moving into slice by slice (objectstack#25922, ruling 6431032267 Q2 = A).
 * A key lives in exactly one of the two homes — `check:i18n-designer-parity`
 * fails on a key in both — so the order decides nothing but cost.
 *
 * The namespace answers a language it has no catalogue for, and a catalogue
 * still being fetched, from its `en` catalogue; this table keeps its own
 * behaviour for the keys it still holds (a key its zh half lacks echoes back).
 */
function lookupString(key: string, locale: SupportedLocale | string | undefined): string | undefined {
  return pickTable(locale).strings[key] ?? studioString(key, locale);
}

export function translateMetadataType(
  type: string,
  locale?: SupportedLocale | string,
  fallback?: string,
): string {
  // Prefer locale table when the locale has a translation for this type.
  // This ensures Chinese labels win over the English `label` baked into
  // the server's metadata registry (which would otherwise show "Field"
  // even when the user's locale is zh-CN).
  const localized = pickTable(locale).types[type];
  if (localized) return localized;
  // Fall back to caller-supplied label (typically the server's English one).
  return fallback ?? type;
}

export function translateMetadataDomain(
  domain: string,
  locale?: SupportedLocale | string,
): string {
  return pickTable(locale).domains[domain] ?? domain;
}

/**
 * Localized display label for a flow node type (palette + node cards).
 *
 * Mirrors {@link translateMetadataType}: the locale table wins for built-in
 * node types (so they read Chinese under zh-CN), while the caller-supplied
 * `fallback` — typically the engine descriptor's server-authoritative `name`,
 * or the hardcoded NODE_PALETTE label offline — covers plugin / unknown types
 * and the English locale (whose table intentionally carries no `flowNode.*`
 * keys, keeping the server descriptor authoritative in English).
 */
export function translateNodeLabel(
  type: string,
  locale?: SupportedLocale | string,
  fallback?: string,
): string {
  const localized = lookupString(`engine.flowNode.${type}.label`, locale);
  if (localized) return localized;
  return fallback ?? type;
}

/** Localized one-line hint for a flow node type. See {@link translateNodeLabel}. */
export function translateNodeHint(
  type: string,
  locale?: SupportedLocale | string,
  fallback?: string,
): string | undefined {
  const localized = lookupString(`engine.flowNode.${type}.hint`, locale);
  if (localized) return localized;
  return fallback;
}

/**
 * zh-CN labels for the flow-level meta values shown in the canvas header pills
 * (trigger type / status / run-as / on-error). Keyed by pill kind → raw value.
 * English is a no-op (raw value shown), and any value not listed here falls
 * back to its raw form — so this never hides an unexpected value.
 */
const FLOW_META_ZH: Record<string, Record<string, string>> = {
  type: {
    autolaunched: '自动启动',
    record_change: '记录变更',
    schedule: '定时',
    time_relative: '相对时间',
    screen: '交互页面',
    api: 'API',
    manual: '手动',
    webhook: 'Webhook',
    event: '平台事件',
  },
  status: { active: '启用', draft: '草稿', inactive: '停用' },
  runAs: { user: '用户', system: '系统', owner: '记录所有者' },
  onError: { stop: '停止', continue: '继续', rollback: '回滚', retry: '重试', fail: '失败' },
};

/** Localized display for a flow-level meta value (header pills). English = raw. */
export function translateFlowMeta(
  kind: 'type' | 'status' | 'runAs' | 'onError',
  value: string,
  locale?: SupportedLocale | string,
): string {
  if (!isZhLocale(locale)) return value;
  return FLOW_META_ZH[kind]?.[value] ?? value;
}

/**
 * zh-CN labels for the overlay-scope vocabulary, keyed by the spec's own enum.
 *
 * The key type is `@objectstack/spec`'s `GetMetaItemLayeredResponseSchema`
 * `overlayScope` union, reached through `MetadataOverlayScope` — so the day the
 * spec adds a scope this record stops compiling and names the label that is
 * missing, instead of the badge silently shipping a raw English value. That
 * silent path is objectui#4982: `overlayScope` reached the badge untranslated
 * while the only two values it can hold had no entry in the table below.
 *
 * Deliberately zh-only, like every other group here — `translateConsoleValue`
 * returns the raw value for the other nine locale packs by existing design, and
 * whether to extend it is a separate decision, not a rider on this fix.
 *
 * `org` left this table with the spec's enum (objectstack#15206 S5, ADR-0131),
 * when objectui#12030 moved to `@objectstack/spec` 18: no served response
 * carries it, and an `org` from an older server is outside the union, so
 * `translateConsoleValue` hands it back raw rather than refusing it.
 */
const LAYER_SCOPE_ZH: Record<NonNullable<MetadataOverlayScope>, string> = {
  env: '环境',
};

/**
 * zh-CN labels for the ADR-0010 §3.6 four-state metadata lock, keyed by the
 * producer field the only consumer actually renders.
 *
 * The key type is `MetadataAuditEntry['lockState']`, which since objectui#5024
 * is `MetadataLockState` — derived from `GetMetaItemLayeredResponseSchema`'s
 * `z.enum` in `@objectstack/spec`. It was a hand-written union in
 * `packages/data-objectstack/src/metadata-client.ts` when this comment was
 * first written, on the belief that the spec had no enum to derive from; the
 * spec does declare one (17.1.0), so the question of ownership this comment
 * used to leave open is answered upstream, not here. Binding the keys means a
 * fifth lock state stops this record from compiling and names the label that is
 * missing, instead of the column silently shipping a raw English token.
 *
 * That silent path is objectui#5004, and it was total rather than partial: the
 * table used to hold `draft` / `locked` / `published` / `none` — a draft-status
 * vocabulary — so of the three values the audit column can actually show, zero
 * had an entry. A zh-CN admin read bare `no-overlay` / `no-delete` / `full`.
 *
 * Wording tracks the lock banner sentences a reader meets on the same screen
 * (`engine.edit.lockNoOverlay` 不可编辑 / `lockNoDelete` 不可删除 / `lockFull`
 * 不可编辑或删除), compressed to state names for a narrow badge column.
 *
 * `none` is currently unreachable through the sole call site — `AuditPanel`
 * renders an em dash for an unlocked/`null` row rather than a word — and is kept
 * anyway: the key set follows the producer's type, so the record stays complete
 * over the domain and does not need editing the day that presentation choice
 * changes.
 *
 * Deliberately zh-only, like every other group here — `translateConsoleValue`
 * returns the raw value for the other nine locale packs by existing design, and
 * whether to extend it is a separate decision, not a rider on this fix.
 */
const LOCK_STATE_ZH: Record<NonNullable<MetadataAuditEntry['lockState']>, string> = {
  none: '无',
  'no-overlay': '禁止编辑',
  'no-delete': '禁止删除',
  full: '完全锁定',
};

/**
 * zh-CN labels for the metadata-editor side panels' raw enum-ish values —
 * History operation badges, Audit operation/outcome/lock-state, and the Layered
 * diff tab badges. Shared by every metadata type (not flow-specific). English
 * (and any value not listed) shows the raw value, so unknown ops never break.
 */
const CONSOLE_VALUE_ZH: Record<string, Record<string, string>> = {
  op: {
    create: '创建',
    update: '更新',
    delete: '删除',
    tombstone: '已删除',
    publish: '发布',
    revert: '回滚',
    save: '保存',
    restore: '恢复',
    rollback: '回滚',
  },
  outcome: { allowed: '允许', denied: '拒绝', forced: '强制' },
  lock: LOCK_STATE_ZH,
  layer: {
    artifact: '工件',
    none: '无',
    merged: '合并',
    set: '已设',
    overlay: '覆盖',
    ...LAYER_SCOPE_ZH,
  },
};

/** Localized label for a metadata-editor side-panel value (English = raw). */
export function translateConsoleValue(
  group: 'op' | 'outcome' | 'lock' | 'layer',
  value: string,
  locale?: SupportedLocale | string,
): string {
  if (!isZhLocale(locale)) return value;
  return CONSOLE_VALUE_ZH[group]?.[value] ?? value;
}

/** Schema-form enum field names that reuse the flow header meta value maps. */
const ENUM_FIELD_TO_META: Record<string, keyof typeof FLOW_META_ZH> = {
  type: 'type',
  status: 'status',
  runAs: 'runAs',
  run_as: 'runAs',
};

/**
 * Localized label for a raw JSON-Schema enum option in the metadata SchemaForm
 * (e.g. the flow `type` picker: `autolaunched` → 自动启动). Keyed by field name
 * so it's unambiguous; English (and any value not translated) shows the raw
 * value, so unknown enums across the 27 metadata types are never hidden. Reuses
 * {@link FLOW_META_ZH} for type/status/runAs, plus an `engine.enum.<field>.<value>`
 * strings-table extension point for anything else.
 */
export function translateEnumOption(
  fieldName: string,
  value: string,
  locale?: SupportedLocale | string,
): string {
  if (!isZhLocale(locale)) return value;
  const kind = ENUM_FIELD_TO_META[fieldName];
  if (kind && FLOW_META_ZH[kind]?.[value]) return FLOW_META_ZH[kind][value];
  const direct = lookupString(`engine.enum.${fieldName}.${value}`, locale);
  if (direct) return direct;
  // A `type` field can also hold a flow-NODE type (the node sub-form's type
  // picker) — reuse the node label table so create_record → 创建记录 etc.
  if (fieldName === 'type') {
    const nodeLabel = lookupString(`engine.flowNode.${value}.label`, locale);
    if (nodeLabel) return nodeLabel;
  }
  return value;
}

/**
 * Generic zh-CN labels for raw JSON-Schema fields the metadata SchemaForm
 * renders without a client `fieldSpec.label` — chiefly the flow edge/node
 * sub-forms (Source / Target / Condition / …). Names here have one unambiguous
 * meaning across metadata types, so the zh label is universally correct; English
 * (and any name not listed) keeps the schema's own title. Applied only as a
 * fallback UNDER `fieldSpec.label`, so curated top-level forms are untouched.
 */
const SCHEMA_FIELD_LABEL_ZH: Record<string, string> = {
  id: 'ID',
  name: '名称',
  label: '标签',
  type: '类型',
  description: '描述',
  source: '源节点',
  target: '目标节点',
  condition: '条件',
  isDefault: '默认',
  nodes: '节点',
  edges: '连线',
  config: '配置',
  outputVariable: '输出变量',
};

/** zh-CN help text for the unambiguous (edge-specific) raw schema fields. */
const SCHEMA_FIELD_HELP_ZH: Record<string, string> = {
  source: '源节点 ID',
  target: '目标节点 ID',
  condition: '用于分支的 CEL 布尔表达式',
  isDefault: '当没有其他条件匹配时,将此连线标记为默认路径',
};

/** Localized label for a raw schema field (falls back to the schema title). */
export function translateSchemaFieldLabel(
  name: string,
  fallback: string | undefined,
  locale?: SupportedLocale | string,
): string | undefined {
  if (isZhLocale(locale)) {
    const v = SCHEMA_FIELD_LABEL_ZH[name];
    if (v) return v;
  }
  return fallback;
}

/** Localized help for a raw schema field (falls back to the schema description). */
export function translateSchemaFieldHelp(
  name: string,
  fallback: string | undefined,
  locale?: SupportedLocale | string,
): string | undefined {
  if (isZhLocale(locale)) {
    const v = SCHEMA_FIELD_HELP_ZH[name];
    if (v) return v;
  }
  return fallback;
}

export function t(key: string, locale?: SupportedLocale | string): string {
  return lookupString(key, locale) ?? key;
}

/**
 * Like {@link t}, but returns `undefined` when the active locale's table has
 * no entry — instead of echoing the key back as if it were a translation.
 *
 * For strings this console does not OWN (`add10d8f9`). The package form's
 * help text is `@objectstack/spec`'s `ManifestSchema` `.describe()`, produced
 * in the framework repo and already reaching the form through the
 * spec-derived JSONSchema; only the zh rendering lives here. A caller uses
 * this so an en-US console finds nothing and falls through to the producer's
 * own sentence, rather than reading a copy of it that this repo would then
 * have to keep in step with the spec by hand.
 *
 * ⚠️ Never reach for this to paper over a MISSING key in a string this
 * console does own — a missing key must stay loud (`t` echoing `engine.…`
 * back is what makes it visible). Use it only where a producer-owned fallback
 * is the deliberate other half.
 */
export function tOptional(
  key: string,
  locale?: SupportedLocale | string,
): string | undefined {
  return lookupString(key, locale);
}

/**
 * Format a translated string with `{token}` placeholders.
 *
 *   tFormat('engine.directory.description', 'zh-CN', { count: 28, writable: 4 })
 */
export function tFormat(
  key: string,
  locale: SupportedLocale | string | undefined,
  vars: Record<string, string | number>,
): string {
  const template = t(key, locale);
  return template.replace(/\{(\w+)\}/g, (_m, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function translateValidationMessage(
  message: string | undefined,
  locale?: SupportedLocale | string,
): string {
  const raw = String(message ?? '').trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === 'invalid' || lower === 'invalid input') {
    return t('engine.validation.invalid', locale);
  }
  const patternMatch = raw.match(/^Invalid string: must match pattern (.+)$/);
  if (patternMatch) {
    return tFormat('engine.validation.pattern', locale, { pattern: patternMatch[1] });
  }
  const expectedMatch = raw.match(/^Invalid input: expected (.+), received (.+)$/);
  if (expectedMatch) {
    const expected = expectedMatch[1];
    const received = expectedMatch[2];
    if (expected === 'string' && received === 'undefined') {
      return t('engine.validation.expectedStringUndefined', locale);
    }
    return tFormat('engine.validation.expectedType', locale, { expected, received });
  }
  const optionMatch = raw.match(/^Invalid option: expected one of (.+)$/);
  if (optionMatch) {
    return tFormat('engine.validation.invalidOption', locale, { options: optionMatch[1] });
  }
  if (lower === 'required' || lower === 'is required') {
    return t('engine.validation.nameRequired', locale);
  }
  if (lower === 'invalid json') {
    return t('engine.form.invalidJson', locale);
  }
  return raw;
}

/**
 * Returns the locale string most browsers report (matches navigator.language).
 *
 * ⚠️ Non-reactive and browser-only — it ignores the app language picked in
 * the LocaleSwitcher. Component code should use {@link useMetadataLocale}
 * instead, which follows the live i18next language (and re-renders on
 * change); this stays only as a fallback for non-hook call sites.
 */
export function detectLocale(): SupportedLocale {
  if (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language)) return 'zh-CN';
  return 'en-US';
}

/**
 * React hook — the Studio/metadata-admin locale derived from the app's ACTIVE
 * i18n language, collapsed to one of the two locales this catalog ships.
 *
 * Prefer this over {@link detectLocale} in components: `detectLocale()` reads
 * `navigator.language`, which never changes when the user switches languages
 * in-app via the LocaleSwitcher (that only moves the i18next instance). This
 * follows the live `useObjectTranslation().language`, so the Studio pillars
 * re-render in lock-step with the console locale — the same source the rest of
 * the app (Home, forms, list views) renders from.
 *
 * ⛔ Never hand this value to `Intl` (`Intl.*Format`, `toLocale*String`) as the
 * locale a date, time or number is formatted in. It picks one of this file's
 * TWO string tables, so it is `'en-US'` for every language that is not zh — a
 * de-DE session would read its faces in US English (objectui#10232). Faces
 * format with `useDisplayLocale()` from `@object-ui/i18n`, the channel every
 * date and number renderer resolves through; keep this value for `t()` /
 * `tFormat()` and the other lookups into the tables here.
 */
export function useMetadataLocale(): SupportedLocale {
  const { language } = useObjectTranslation();
  const locale: SupportedLocale = /^zh/i.test(language) ? 'zh-CN' : 'en-US';
  // Starts the fetch of the `studio` namespace catalogue this locale reads and
  // re-renders the caller when it lands, so a moved key does not stay on the
  // `en` answer the first render gave.
  useStudioCatalogue(locale);
  return locale;
}
