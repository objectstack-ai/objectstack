// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full reasoning behind an author-time rule, kept out of its finding.
 *
 * A finding is printed by `os validate`, `os build` and `os dev` on every run,
 * so it carries one verdict sentence (`message`) and one fix (`hint`) and
 * nothing more. Everything an author needs only once — what the rule counts,
 * what it deliberately does not, why it exists, where its boundaries are —
 * lives here instead, keyed by rule id, and `os explain <rule-id>` prints it.
 * The CLI's `rule:` line names that command for exactly the rule ids this
 * table holds, so the pointer is never printed for a rule that has nothing to
 * show.
 *
 * ⛔ One copy. The text below is not repeated in the rule's message or hint,
 * and a rule's message does not paraphrase it: an author who wants the "why"
 * runs the command. One deliberate overlap: a functional-completeness verdict
 * (`@objectstack/spec/kernel`'s `FUNCTIONAL_COMPLETENESS_RULES`) still names
 * the runtime site that makes it true, because ADR-0078 §6 keeps that
 * citation in the finding's own message.
 *
 * ## Why this module imports nothing
 *
 * It is published as its own entry, `@objectstack/lint/rule-explanations`, as
 * well as from the root barrel, because the CLI's finding printer reads it on
 * every command that prints a finding, and that printer is deliberately not a
 * rule-engine import: loading the root barrel costs about half a second (every
 * rule module and `@objectstack/spec` with it), which `os explain object` and
 * every other command would otherwise pay. So the keys are the rule ids
 * spelled as literals, and a list a rule computes from data (the roots a scan
 * reads) is written out here — `rule-explanations.test.ts` holds each key to a
 * rule id constant some rule file exports (or to an id in the completeness
 * predicate's `FUNCTIONAL_COMPLETENESS_RULES`, whose rules live in
 * `@objectstack/spec`, or to its exact list of the ids `@objectstack/cli`
 * produces, which the CLI's own test fires from their producers because the
 * CLI depends on this package) and each such list to the rule's own constant,
 * so neither can drift from the rule it explains.
 *
 * Adding an entry: key it by the rule's id, write `covers` so that it
 * completes the sentence "`os explain <id>` for …", and move the long text out
 * of the rule in the same edit. The id must not equal an `os explain` schema
 * name — the command resolves one positional against both, and the CLI pins
 * the two sets disjoint.
 */

/** The long-form explanation of one author-time rule. */
export interface RuleExplanation {
  /** The rule id this explains — the `rule` of every finding it covers. */
  rule: string;
  /**
   * A short noun phrase that completes "`os explain <id>` for …" on the CLI's
   * `rule:` line, e.g. `what counts as a consumer`.
   */
  covers: string;
  /** The reasoning, one paragraph per entry, in reading order. */
  paragraphs: readonly string[];
}

const FIELD_NO_CONSUMERS_EXPLANATION: RuleExplanation = {
  rule: 'field-no-consumers',
  covers: 'what counts as a consumer',
  paragraphs: [
    'A declared field is CONSUMED when something in this stack reads or displays it: a view column, ' +
      'an inline grid column, a form section, a page binding, a flow node, a dataset or cube member, a ' +
      'dashboard widget, a formula, a validation, a hook or an action that names it; a declared field ' +
      'group (`group` naming one of the object\'s `fieldGroups`) that places it on the synthesized ' +
      'layout; or a seed or import mapping that matches on it (`externalId` / `upsertKey`). One such ' +
      'site is enough: a field that is only drawn is the ordinary state of most fields, not a defect.',
    'A CARRIER names a field without reading it, so it does not count: a translation label, a seed ' +
      'value, an import-mapping target, a permission grant, a flow that only WRITES it, an ' +
      '`inlineColumns` entry on a relationship field that does not set `inlineEdit` (no grid is ' +
      'drawn), or a dataset or cube member path the analytics door refuses (a hop or column that does ' +
      'not resolve, or a join the dataset\'s `include` does not declare).',
    'The verdict on the warning is `inert` when no site of any kind names the field, and ' +
      '`carrier-only` when only carriers do — then the `fix:` line names the first carrier site and counts ' +
      'the rest, because removing the declaration means cleaning them too (each one names the field). ' +
      'Verdicts are per object: a consumer of the same field name on another object does not cover this ' +
      'declaration.',
    'Never reported, because the platform reads them without an authored consumer: a system column ' +
      'the registry injects (when the object re-declares it), the record\'s title field, and a ' +
      '`master_detail` field (the relationship is consumed by being declared). Fields an ' +
      '`objectExtensions` entry adds are not judged, and a stack that declares no consumer root at ' +
      'all (objects only) is skipped: its consumers are declared elsewhere.',
    'To fix it, give the field a consumer — a view column, a form section, a page binding, a ' +
      'formula, a validation, a flow node, a dataset dimension, or a `group` naming one of the ' +
      'object\'s declared `fieldGroups` so the synthesized layout draws it — or remove the ' +
      'declaration together with any carrier sites the warning lists.',
    'The rule is advisory and stays a warning: a consumer can legitimately live outside the stack — ' +
      'an API client, a hook or package this stack does not carry, a Studio-authored view. Ignore ' +
      'the warning for such a field.',
    // Held equal to `CONSUMER_ROOTS` / `CARRIER_ROOTS` by `rule-explanations.test.ts`.
    'Roots scanned: objects, views, pages, apps, flows, dashboards, reports, datasets, actions, hooks, ' +
      'jobs, emailTemplates, agents, tools, skills, apis, webhooks, sharingRules, analyticsCubes ' +
      '(consumers) · translations, data, mappings, permissions (carriers). Test fixtures are never ' +
      'scanned: the rule reads metadata, not a repository, so a field that only a test reads is ' +
      'reported.',
  ],
};

const SECURITY_OWD_UNSET_EXPLANATION: RuleExplanation = {
  rule: 'security-owd-unset',
  covers: 'why the baseline must be declared',
  paragraphs: [
    'Every custom object declares its organization-wide default, `sharingModel` (OWD): the ' +
      'record-level baseline that every permission set\'s object grant is read against. An object ' +
      'that declares none still runs — the runtime fails CLOSED to \'private\' (ADR-0090 D1) — and ' +
      'this rule refuses it anyway, because the baseline must be an authored decision, not an ' +
      'accident of a default.',
    'The shape it guards: an object with no `sharingModel`, granted ordinary read/write by a ' +
      'permission set, let that grant read and edit every other user\'s records. Failing closed is ' +
      'the runtime\'s half of the fix; declaring the value is the author\'s half, so the next reader ' +
      'of the object sees the decision instead of inferring it from a default.',
    'The values, for internal users: \'private\' — the owner plus explicit shares (the recommended ' +
      'default); \'public_read\' — everyone reads, the owner writes; \'public_read_write\' — everyone ' +
      'reads and writes; \'controlled_by_parent\' — access derives from the master record (a ' +
      'master-detail child).',
    'System objects (`isSystem: true`, or a name starting with `sys_`) are not judged: the platform ' +
      'owns their posture.',
  ],
};

// ── Functional completeness (ADR-0078) ──────────────────────────────────────
// The verdicts live in `packages/spec/src/kernel/functional-completeness.ts`;
// each names the runtime site that makes it true, and the measured reading
// behind it is written out below. A mechanism corrected there is corrected
// here in the same edit.

const FIELD_SUMMARY_WITHOUT_OPERATIONS_EXPLANATION: RuleExplanation = {
  rule: 'field/summary-without-operations',
  covers: 'why a summary field needs summaryOperations',
  paragraphs: [
    'A `summary` field is a roll-up over child records, and `summaryOperations` says which child ' +
      'object, which child field and which function to roll up. Without it the engine\'s summary ' +
      'index skips the field (`engine.ts` — `if (!d.summaryOperations) continue`), so it computes ' +
      'nothing: it reads 0/null everywhere, and anything derived from it is stuck at 0.',
    'Nothing else notices: the field parses, publishes and is served, and every authoring surface ' +
      'reports success. This is the shape ADR-0078 was written for — metadata that is valid and uses ' +
      'only live properties, yet is dead because it omits the sibling config its consumer needs.',
    'To fix it, declare `summaryOperations` with the child object, the child field and the function ' +
      '(the `fix:` line shows `sum`), or remove the field.',
  ],
};

const FIELD_FORMULA_WITHOUT_EXPRESSION_EXPLANATION: RuleExplanation = {
  rule: 'field/formula-without-expression',
  covers: 'why a formula field needs an expression',
  paragraphs: [
    'A `formula` field computes its value from `expression`. The engine builds its formula plan ' +
      'only from fields that have one (`engine.ts` — `if (def?.type === \'formula\' && ' +
      'def.expression)`), so a formula with no `expression` never computes: the field is ' +
      'permanently empty, while parsing and publishing both succeed.',
    'To fix it, write the expression (the `fix:` line shows the shape, reading other fields through ' +
      '`record`), or remove the field.',
  ],
};

const FIELD_RELATIONSHIP_WITHOUT_REFERENCE_EXPLANATION: RuleExplanation = {
  rule: 'field/relationship-without-reference',
  covers: 'why a relationship field needs a reference',
  paragraphs: [
    'A `lookup` or `master_detail` field is a relationship, and `reference` names the object it ' +
      'points at. With no `reference` it is a relationship to nowhere: `$expand` silently skips it ' +
      '(`engine.ts` — `if (!referenceObject) continue`), and the record picker has no object to ' +
      'search, so the column stores raw ids that never resolve.',
    'A `user` field is not judged: its target is implicitly `sys_user`. To fix it, declare ' +
      '`reference` with the name of the target object.',
  ],
};

const FIELD_CHOICE_WITHOUT_OPTIONS_EXPLANATION: RuleExplanation = {
  rule: 'field/choice-without-options',
  covers: 'why a choice field needs options',
  paragraphs: [
    'A `select` or `radio` field with no `options` is a choice with nothing to choose, and it fails ' +
      'twice: the form control is empty, AND server-side value validation is disabled — ' +
      '`record-validator.ts` skips the check when the allowed list is empty — so any value writes ' +
      'through the API. That is an error.',
    'A `picklist` reference is an option source too: the served field carries the shared list\'s ' +
      'options, so `picklist` naming a declared list satisfies the rule as well as an `options` list.',
    'A `checkboxes` field with no `options` renders zero checkboxes. The validator\'s multi-value ' +
      'branch tolerates it as free-form (the `multiselect` tags mode), so it is a warning, not an ' +
      'error — but a checkbox group is almost never meant to be free-form: declare the boxes, or use ' +
      '`multiselect` if free-form tags were the intent.',
    'A `multiselect` with no `options` is not judged: `record-validator.ts` accepts it as free-form ' +
      'tags by design.',
  ],
};

const VIEW_LAYOUT_WITHOUT_BINDING_EXPLANATION: RuleExplanation = {
  rule: 'view/layout-without-binding',
  covers: 'what each view type renders without its block',
  paragraphs: [
    'Six list-view types read their layout from a config block named after the type: `kanban`, ' +
      '`calendar`, `gantt`, `timeline`, `map` and `tree`. A view of one of them with no block parses ' +
      'and publishes clean, but the surface the author asked for is not the one that renders. What ' +
      'renders instead differs by type, as read from the renderer below; the rule is a warning on all six.',
    '`calendar`: no date axis, and the renderer does not invent one. objectui\'s `ListView.tsx` ' +
      'calendar branch forwards only the bindings the view declared, so `getCalendarConfig` ' +
      '(`ObjectCalendar.tsx`) resolves `null` and the view renders its "Calendar configuration ' +
      'required" refusal screen instead of records — on any object, not just on one that happens to ' +
      'lack a field. Declare `calendar.startDateField`, the block\'s one required key; the event title ' +
      'resolves through the ADR-0079 record display-name chain when `titleField` is omitted.',
    '`gantt`: the `ListView.tsx` gantt branch forwards only the bindings the view declared, so ' +
      '`getGanttConfig` (`ObjectGantt.tsx`) resolves `null` without both dates and the view renders ' +
      'its "Gantt configuration required" refusal screen instead of tasks, on any object. Declare ' +
      '`gantt.startDateField`, `gantt.endDateField` and `gantt.titleField`, the three keys ' +
      '`GanttConfigSchema` requires; `progressField` and `dependenciesField` are optional and stay ' +
      'unbound when omitted.',
    '`timeline`: the `ListView.tsx` timeline branch forwards a start date only when the view ' +
      'declared one, so `ObjectTimeline.tsx` resolves no date field and renders its "Timeline date ' +
      'axis required" refusal instead of records, on any object. Only the title has a renderer ' +
      'default (`name`); the date axis never does. Declare `timeline.startDateField` and ' +
      '`timeline.titleField`, the two keys `TimelineConfigSchema` requires.',
    '`map`: no coordinate binding, and the renderer does not guess one. The `ListView.tsx` map ' +
      'branch forwards only the keys the view declared, and `ObjectMap.tsx` no longer guesses ' +
      '`location` / `latitude` / `longitude` field names, so its `hasCoordinateBinding` gate fails ' +
      'and the view renders its "Map configuration required" refusal instead of markers, plotting ' +
      'nothing on any object. The gate treats a declared block exactly as an absent one, so a `map` ' +
      'block that binds neither form is reported too. Declare `map.locationField`, or both ' +
      '`map.latitudeField` and `map.longitudeField` (half a pair is not a binding); ' +
      '`ListMapConfigSchema` requires neither form, so this warning is where the requirement is stated.',
    '`kanban` and `tree`: the renderer falls back to literal default field names, which works only ' +
      'if the object happens to declare them; on any other object the view renders empty while ' +
      'authoring reports success. For `tree` a block is not the whole story either: every `tree` key ' +
      'is optional, and a tree with no resolvable parent pointer renders flat — that is ' +
      '`view/tree-without-parent-field`.',
    'A `gallery` view is not judged: no `gallery` key is required, and its fallback mis-titles ' +
      'cards rather than emptying the view.',
  ],
};

const VIEW_TREE_WITHOUT_PARENT_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'view/tree-without-parent-field',
  covers: 'how a tree view finds its parent pointer',
  paragraphs: [
    'A `tree` view nests each record under its parent, so it needs a parent pointer: ' +
      '`tree.parentField`, or a field the renderer can auto-detect on the bound object (objectui ' +
      '`ObjectTree.tsx` — `detectParentField`). Auto-detection accepts a `tree` field with no ' +
      '`reference` or with one naming this object, or a `lookup` / `master_detail` whose `reference` ' +
      'is this object.',
    'When `parentField` is undeclared and the bound object has none of those, auto-detection finds ' +
      'nothing and `buildForest` makes every record a root at depth 0. The view renders FLAT, not ' +
      'empty: a complete, correct-looking table with an expand slot that never opens, while ' +
      'authoring reports success.',
    'The rule fires only when both halves fail, so a view that renders correctly by auto-detection ' +
      'is never warned about; it stays silent when the stack does not declare the view\'s object. To ' +
      'fix it, declare `tree.parentField`, or add a self-referencing field to the object.',
  ],
};

const VIEW_ROW_COLOR_WITHOUT_COLORS_EXPLANATION: RuleExplanation = {
  rule: 'view/row-color-without-colors',
  covers: 'how a grid colours its rows',
  paragraphs: [
    'A grid\'s `rowColor` colours each row from a field\'s value: `field` says which value to look ' +
      'up, and the `colors` map says which colour each value gets — the map does the colouring. With ' +
      'no `colors` map the grid\'s row-className resolver returns before it reads a record (objectui ' +
      '`useRowColor.ts` — `if (!config?.field || !config.colors) return undefined`), so every row ' +
      'keeps the default background while parsing and publishing report success.',
    'An empty `colors: {}` is the same dead shape spelled out: it passes that guard and then matches ' +
      'no value. To turn row colouring off, omit the `rowColor` block or leave the toolbar toggle ' +
      '`userActions.rowColor` off.',
    'Each value in the map is a colour NAME from the resolver\'s own vocabulary (`red`, `blue`, ' +
      '`slate`, …) or a complete Tailwind background class (`bg-red-200`). A hex parses, publishes and ' +
      'silences this rule while still colouring nothing — that is `view/row-color-unresolvable-value`.',
    'Only `grid` views are judged: the other list-view types never read `rowColor`, so a `colors` ' +
      'map would not make them colour anything.',
  ],
};

const VIEW_ROW_COLOR_UNRESOLVABLE_VALUE_EXPLANATION: RuleExplanation = {
  rule: 'view/row-color-unresolvable-value',
  covers: 'which colour values a grid can resolve',
  paragraphs: [
    'objectui\'s `useRowColor.ts` resolves a `rowColor.colors` value in `colorToClass`: a ' +
      '`bg-`-prefixed literal is handed through untouched, and anything else is lower-cased, trimmed and ' +
      'looked up in the resolver\'s own closed vocabulary of colour NAMES, returning `undefined` for ' +
      'everything else. Tailwind v4 has no runtime, so no class can be fabricated from a hex.',
    'A map holding such values CLEARS the `!config.colors` guard, so ' +
      '`view/row-color-without-colors` goes quiet — and every row still keeps its default background ' +
      'while parsing and publishing report success. A hex is the obvious value to copy, because a ' +
      'select field\'s own option colours are hexes; the warning lists each offending entry with its ' +
      'value so the author does not have to re-read the map.',
    'The rule judges a value\'s SHAPE, not the vocabulary: a value that is neither `bg-`-prefixed nor ' +
      'a bare alphabetic word once lower-cased and trimmed cannot be a colour name, whatever the ' +
      'vocabulary holds. So it never reports a value the renderer would resolve (`RED` and a padded ' +
      '`red` resolve), and a misspelled name such as `chartreuse` passes it. Whether a `bg-…` class was ' +
      'actually compiled into the stylesheet is not judged.',
    'To fix it, write a colour name (`red`, `blue`, `slate`, …) or a complete Tailwind background ' +
      'class (`bg-red-200`).',
  ],
};

const WEBHOOK_WITHOUT_TRIGGERS_EXPLANATION: RuleExplanation = {
  rule: 'webhook/without-triggers',
  covers: 'why an empty trigger list is not an off switch',
  paragraphs: [
    'A webhook fires on the record events its `triggers` name. With none, the auto-enqueuer drops it ' +
      'while building its subscription cache (`auto-enqueuer.ts` — `if (triggers.size === 0) … return ' +
      'null`), and there is no manual fire path to reach it either: `webhook.zod.ts` records that the ' +
      '`api` trigger was removed because "no manual fire path exists — the only webhook HTTP surface ' +
      're-queues already-failed deliveries". So it never fires on any path.',
    'The webhook still materializes into `sys_webhook`, looks armed in Setup, and delivers nothing. ' +
      'An empty `triggers: []` is judged the same as an omitted list.',
    'To disable a webhook use `isActive: false`; an empty `triggers` is not an off switch, just a ' +
      'dead one. To fix it, name the events it should fire on.',
  ],
};

// ── Dashboard widget bindings (`validate-widget-bindings.ts`) ──────────────
// A widget is bound to a semantic dataset (ADR-0021) and selects its
// dimensions and measures by name; these entries hold what each verdict about
// that binding no longer says.

const WIDGET_LEGACY_ANALYTICS_UNRENDERABLE_EXPLANATION: RuleExplanation = {
  rule: 'widget-legacy-analytics-unrenderable',
  covers: 'why the legacy analytics keys render nothing',
  paragraphs: [
    'The ADR-0021 single-form cutover removed the inline analytics shape — `categoryField`, ' +
      '`valueField`, `xAxisField`, `yAxisFields`, `aggregate`, `aggregation`, `rowField` and ' +
      '`columnField`. The dashboard renderer reads a widget\'s data only through its semantic dataset ' +
      '(`dataset`, `dimensions`, `values`, rendered by DatasetWidget), so a legacy key is dead ' +
      'wherever it appears.',
    'This id is the error case: the legacy keys are the widget\'s only data wiring — no `dataset`, ' +
      'no `object`, no inline `data` (top-level or under `options`) — so the widget has no data at all ' +
      'and renders nothing. When a data source is present the widget still renders and the legacy ' +
      'keys are only ignored noise; that is the suppressible warning `widget-legacy-analytics-shape`.',
    'To fix it, bind a semantic dataset and select fields by name: `dataset`, `dimensions` and ' +
      '`values` (pivot rows and columns come from `dimensions`, cell values from `values`).',
  ],
};

const WIDGET_LEGACY_ANALYTICS_SHAPE_EXPLANATION: RuleExplanation = {
  rule: 'widget-legacy-analytics-shape',
  covers: 'why the legacy analytics keys are ignored',
  paragraphs: [
    'The ADR-0021 single-form cutover removed the inline analytics shape — `categoryField`, ' +
      '`valueField`, `xAxisField`, `yAxisFields`, `aggregate`, `aggregation`, `rowField` and ' +
      '`columnField`. Dataset-bound widgets render through DatasetWidget, which reads only the ' +
      'semantic dataset: pivot rows and columns come from `dimensions`, cell values from `values`. ' +
      'These inline keys are a no-op.',
    'This id is the warning case: the widget also has a data source (`dataset`, `object`, or inline ' +
      '`data`, top-level or under `options`), so it still renders and the legacy keys are only ignored ' +
      'noise. With no data source the widget renders nothing, and that is the error ' +
      '`widget-legacy-analytics-unrenderable`.',
    'On the schema-parsed paths (`compile`, `validate`) the strict widget schema refuses these keys as ' +
      'a parse error before this rule runs; the rule is the steer on the raw-config paths (`lint`, ' +
      '`doctor`).',
    'To fix it, delete the legacy keys and select fields by name through the widget\'s dataset. ' +
      'Suppress with `suppressWarnings: [\'widget-legacy-analytics-shape\']` if the keys are ' +
      'intentional.',
  ],
};

const DASHBOARD_FILTER_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'dashboard-filter-field-unknown',
  covers: 'how a dashboard filter reaches every widget',
  paragraphs: [
    'A dashboard-level filter — the built-in `dateRange` (on `created_at` unless `dateRange.field` ' +
      'says otherwise) or a `globalFilters` entry — is ANDed into EVERY bound widget\'s analytics ' +
      'query. The field it lands on in one widget is the effective field: the filter\'s own field, ' +
      'unless the widget re-targets it with `filterBindings` or opts out with ' +
      '`filterBindings: { NAME: false }`.',
    'When the effective field is not a column of the widget\'s dataset object, the query addresses a ' +
      'column that does not exist and the widget fails at query time. That is a broken query, not ' +
      'advice, so the rule is an error. A dotted field (`account.signed_at`) is resolved hop by hop on ' +
      'the object graph and the verdict names the hop that failed; a bare name is judged against the ' +
      'object\'s authored and registry-injected columns.',
    'How the widget came to carry the filter decides the fix: an explicit `filterBindings` target is ' +
      'a typo to correct, an inherited default is one the widget may opt out of. Not reported: a ' +
      'widget that opts out, an object this stack does not define, and an object with no readable ' +
      'field map (an ADR-0015 external object, an introspected datasource).',
    'A re-target may be a field of the dataset\'s object or a `relationship[.relationship].field` ' +
      'path. Every hop of such a path must be a relationship field (lookup, master_detail, user or ' +
      'tree; ADR-0021 derives every join from the object graph, so there is no ON clause to write), ' +
      'and its prefix must be declared in the dataset\'s `include` ' +
      '(`dashboard-filter-field-not-included` otherwise). The verdict\'s "Did you mean" names the ' +
      'nearest field of the object the miss landed on.',
  ],
};

const DASHBOARD_FILTER_FIELD_NOT_INCLUDED_EXPLANATION: RuleExplanation = {
  rule: 'dashboard-filter-field-not-included',
  covers: 'why a filter\'s relationship prefix must be included',
  paragraphs: [
    'ADR-0021 joins ONLY the relationship paths a dataset declares in `include`. A dashboard filter ' +
      'lands in the same `runtimeFilter` slot as a widget\'s own filter, and the compiler\'s ' +
      '`assertDeclared` never sees a `runtimeFilter`, so there is no runtime door in front of this ' +
      'check: an effective field that resolves on the object graph but whose prefix is not declared ' +
      'compiles to no join, and the column is out of the query\'s reach.',
    'The filter is ANDed into EVERY bound widget\'s analytics query, so the whole board renders ' +
      'empty, not one tile.',
    'To fix it, add the prefix to the dataset\'s `include` (declaring `a.b` implicitly includes `a`), ' +
      'filter on a field of the dataset\'s own object, or opt the widget out with ' +
      '`filterBindings: { NAME: false }`.',
  ],
};

/**
 * What an unprovisioned anchor is — the cause half of every read-side anchor
 * id (`dashboard-filter-field-unprovisioned`, `react-chart-field-unprovisioned`,
 * `sort-field-unprovisioned`, `searchable-field-unprovisioned`,
 * `page-field-unprovisioned`, `flow-template-field-unprovisioned`).
 * The rule files share its verdict clause, `unprovisionedAnchorVerdict()`, or
 * its long form, `unprovisionedAnchorCause()`.
 */
const UNPROVISIONED_ANCHOR_CAUSE =
  'The registry injects system columns — the ownership and audit anchors such as `owner_id`, ' +
  '`created_at` and `created_by` — into objects. On an ADR-0015 external object the remote ' +
  'database owns the schema, so the platform registers these anchors without provisioning a ' +
  'column: the name resolves, but no storage stands behind it.';

/**
 * The three ways out of an unprovisioned anchor, which the one-line `fix:` of
 * the converted anchor ids (`unprovisionedAnchorFix()`) names without the how:
 * `sort-field-unprovisioned`, `searchable-field-unprovisioned`,
 * `react-chart-field-unprovisioned`, `dashboard-filter-field-unprovisioned`,
 * `page-field-unprovisioned`, `flow-template-field-unprovisioned` and the hook,
 * action and flow-node write-anchor ids write it out.
 */
const UNPROVISIONED_ANCHOR_REMEDY =
  'To fix it, check the remote table. If it really carries the column, declare it in the object\'s ' +
  'own `fields`, mapped to the remote column through the external binding\'s `columnMap`, so the name ' +
  'resolves to a column you vouch for. If it does not, drop the reference, or opt the object out of ' +
  'the injection: `ownership: \'none\'` for the ownership anchors, `systemFields: { audit: false }` ' +
  'for the audit family.';

const DASHBOARD_FILTER_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'dashboard-filter-field-unprovisioned',
  covers: 'why a filter on an unprovisioned anchor matches nothing',
  paragraphs: [
    UNPROVISIONED_ANCHOR_CAUSE,
    'A dashboard filter whose effective field lands on such an anchor is ANDed into the widget\'s ' +
      'analytics query and can never match a real value: on SQLite it silently degrades to ' +
      'constant-false and the widget renders empty (HTTP 200, zero rows, no error).',
    'Only a leaf that resolved BECAUSE it is injected is judged — an author-declared column of the ' +
      'same name is one the author vouches for — and a dotted path ending on an external object is ' +
      'judged too. The rule is a warning, not an error, because it cannot see the remote table, only ' +
      'that the platform provisions no storage. Opt the widget out with ' +
      '`filterBindings: { NAME: false }`, or suppress with ' +
      '`suppressWarnings: [\'dashboard-filter-field-unprovisioned\']` if the remote schema resolves ' +
      'the column some other way.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

const WIDGET_FILTER_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'widget-filter-field-unknown',
  covers: 'what an unresolved widget filter key does',
  paragraphs: [
    'A widget\'s own `filter` is ANDed into its dataset query as `runtimeFilter`. A key that names no ' +
      'column either widens the scope (the condition is dropped) or empties it, and the widget ' +
      'renders successfully either way: nothing reports the miss.',
    'Each key is resolved on the object graph against the dataset\'s object — a dotted ' +
      '`relationship.field` path hop by hop, a bare name against the authored and registry-injected ' +
      'columns — and the verdict names the hop that failed. This rule judges the KEYS; ' +
      '`filter-token-unknown` judges the values in the same subtree. Not reported: an object this ' +
      'stack does not define, or one with no readable field map.',
    'To fix it, filter on a field of the dataset\'s object, or on a `relationship[.relationship].field` ' +
      'path: every hop must be a relationship field (lookup, master_detail, user or tree; ADR-0021 ' +
      'derives every join from the object graph), and the prefix must be declared in the dataset\'s ' +
      '`include` (`widget-filter-field-not-included` otherwise). The verdict\'s "Did you mean" names ' +
      'the nearest field of the object the miss landed on.',
  ],
};

const WIDGET_FILTER_FIELD_NOT_INCLUDED_EXPLANATION: RuleExplanation = {
  rule: 'widget-filter-field-not-included',
  covers: 'why a filter key\'s relationship prefix must be included',
  paragraphs: [
    'ADR-0021 joins ONLY the paths a dataset declares in `include`, and the compiler\'s ' +
      '`assertDeclared` never sees a `runtimeFilter`, so an undeclared prefix has no runtime door in ' +
      'front of it: no join is compiled, the column is out of the query\'s reach, and the widget ' +
      'renders empty.',
    'To fix it, add the prefix to the dataset\'s `include` (declaring `a.b` implicitly includes `a`), ' +
      'or filter on a field of the dataset\'s own object.',
  ],
};

const WIDGET_SORTBY_UNSELECTED_EXPLANATION: RuleExplanation = {
  rule: 'widget-sortby-unselected',
  covers: 'why sortBy must name a column the widget selects',
  paragraphs: [
    '`options.sortBy` is lowered into the dataset selection\'s `order`, whose key must name a ' +
      'dimension or measure this widget selects — the contract `DashboardWidgetOptionsSchema.sortBy` ' +
      'states. A key that does not is either dropped in favour of the implicit ordering, silently, or ' +
      'refused by the executor (`resolveOrdering` throws `DATASET_INVALID`). Both lose the order the ' +
      'author wrote, and the first loses it in silence.',
    'Ordering is applied to the query RESULT, so it can only name a column that result carries: a ' +
      'name the dataset declares but this widget does not select is not in the result. The fix for ' +
      'that case is a `values` or `dimensions` entry, not a spelling correction.',
    'Judged against the AUTHORED `dimensions` and `values` arrays. An entry there that does not ' +
      'resolve is `widget-dimension-unknown` or `widget-measure-unknown`\'s finding and is not ' +
      'reported twice.',
  ],
};

const CHART_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'chart-field-unknown',
  covers: 'why chartConfig binding keys are ignored',
  paragraphs: [
    'On a dataset-bound widget the dashboard renderer derives every chart binding from the widget\'s ' +
      '`dimensions` and `values`. An authored axis `field` — `chartConfig.xAxis.field` or ' +
      '`chartConfig.yAxis[].field` — is stripped by `axisPresentation`, so the x-axis stays bound to ' +
      'the widget\'s first dimension and the y-axis bindings stay derived from its values.',
    'For `chartConfig.series` the renderer derives one series per selected measure and matches an ' +
      'authored entry BY NAME, so an entry naming no selected measure pairs with no series and the ' +
      'presentation on it (mark, colour, stack, axis side) lands on nothing.',
    'Each is a silent no-op, not a query that fails, so the rule is a warning. A field that already ' +
      'names an entry of the widget\'s selection is not reported, and a selection entry that does not ' +
      'resolve is `widget-dimension-unknown` or `widget-measure-unknown`\'s error.',
    'To fix it, delete the key: `chartConfig.xAxis`, `chartConfig.yAxis` and `chartConfig.series` are ' +
      'refused on a dataset-bound widget (ADR-0021). Post-cutover data is keyed by the dataset\'s ' +
      'measure NAME, not the base column. Suppress with `suppressWarnings: [\'chart-field-unknown\']` ' +
      'if the inert key is intentional.',
    'What replaces each key: the x-axis is the widget\'s first `dimensions` entry; the y-axis ' +
      'bindings come from `values`, one entry per mark; series membership follows `values` (and a ' +
      'second `dimensions` entry to split). A measure named by a refused key that the dataset declares ' +
      'but the widget does not select is plotted by adding it to `values`. ' +
      'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
  ],
};

const CHART_MEASURES_MISSING_EXPLANATION: RuleExplanation = {
  rule: 'chart-measures-missing',
  covers: 'what a chart with no measures renders',
  paragraphs: [
    'A dataset widget whose `values` list is empty never runs a query: the renderer returns its ' +
      'authoring placeholder, "Pick measures (values) for this dataset widget." (`DatasetWidget.tsx`), ' +
      'before any widget-family branch, so no chart is drawn at all.',
    'This id is the chart family\'s; `widget-measures-missing` is the same shape on a single-value or ' +
      'tabular widget. A chart with no measures is reported once, here, even when it also selects no ' +
      'dimensions: the placeholder returns before the renderer ever tests for dimensions. A chart ' +
      'family still needs a dimension to plot against (`chart-dimensions-missing`).',
    'To fix it, select at least one measure of the dataset by name in `values` (the `fix:` line ' +
      'names up to three the dataset declares). Suppress with ' +
      '`suppressWarnings: [\'chart-measures-missing\']` while the widget is still being authored.',
  ],
};

const WIDGET_MEASURES_MISSING_EXPLANATION: RuleExplanation = {
  rule: 'widget-measures-missing',
  covers: 'what a KPI or table widget with no measures renders',
  paragraphs: [
    'The same short-circuit as `chart-measures-missing`, on every declared widget type outside the ' +
      'chart family: with `values` empty the renderer returns the authoring placeholder "Pick measures ' +
      '(values) for this dataset widget." before any query runs. A single-value widget (`metric`, ' +
      '`kpi`, `gauge`, `solid-gauge`, `bullet`) loses the one KPI number the tile exists to show; a ' +
      'tabular one (`table`, `pivot`) loses its grid.',
    'Such a widget needs no `dimensions`, so measures are the whole fix: select at least one measure ' +
      'of the dataset by name in `values` (the `fix:` line names up to three the dataset declares). ' +
      'Suppress with `suppressWarnings: [\'widget-measures-missing\']` while the widget is still being ' +
      'authored.',
  ],
};

const CHART_DIMENSIONS_MISSING_EXPLANATION: RuleExplanation = {
  rule: 'chart-dimensions-missing',
  covers: 'why a chart with no dimensions draws one number',
  paragraphs: [
    'The renderer\'s `isMetric` test is `METRIC_TYPES.has(widgetType) || dimensions.length === 0`, so ' +
      'a chart-family widget that selects measures but no dimensions draws a single KPI number instead ' +
      'of its declared chart. The number is real, so nothing looks broken — the declared chart family ' +
      'is simply gone.',
    'To fix it, plot the chart against a dataset dimension (`dimensions`; the `fix:` line names up to ' +
      'three the dataset declares), or, if a single value IS what the tile should show, declare it as ' +
      'a `metric` or `kpi` widget so the type matches what renders. Suppress with ' +
      '`suppressWarnings: [\'chart-dimensions-missing\']`.',
  ],
};

const TABLE_COUNT_ONLY_EXPLANATION: RuleExplanation = {
  rule: 'table-count-only',
  covers: 'why a count-only table renders one summary row',
  paragraphs: [
    'A `table` or `pivot` widget bound to a dataset runs an analytics query: rows are the groups of ' +
      'its `dimensions`, cells the aggregates of its `values`. With no dimensions and only count ' +
      'measures (a derived measure is never counted as one), there is nothing to group by, so the ' +
      'widget renders a single summary row — not a per-record list.',
    'A flat record listing is not an analytics dataset. Model it as an object-bound ListView ' +
      '(ADR-0017) surfaced through app navigation, and use a `metric` widget on the dashboard if only ' +
      'the count is needed. If a single-row table is intentional, add an explicit dimension or ' +
      'suppress with `suppressWarnings: [\'table-count-only\']`.',
    'Not reported: a widget that selects a dimension, selects no measures (`widget-measures-missing`), ' +
      'or names a measure the dataset does not declare (`widget-measure-unknown`).',
  ],
};

// ── Dataset references (`validate-dataset-references.ts`) ──────────────────

const DATASET_INCLUDE_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'dataset-include-unknown',
  covers: 'why an include entry must be a relationship',
  paragraphs: [
    'Joins are COMPILED from a dataset\'s `include` (ADR-0021): each entry must be a traversable ' +
      'relationship path — a lookup, master_detail, user or tree field, up to three hops (ADR-0071). An entry that ' +
      'resolves to nothing, or to a field that is not a relationship, produces no join at all, so ' +
      'every dimension or measure written against that prefix addresses nothing. ADR-0021 derives ' +
      'every join from the object graph, so an entry names a relationship field and never an ON clause.',
    'Resolution is the shared object graph\'s, injected columns included: `owner_id` reads as the ' +
      'lookup it is and joins, `created_at` reads as a datetime and does not. Not reported: a dataset ' +
      'whose base object this stack does not define or cannot read the fields of.',
    'To fix it, declare a relationship that exists on the join chain from the dataset\'s object, or ' +
      'drop the entry. Declaring `a.b` implicitly includes `a`. The verdict\'s "Did you mean" names the ' +
      'nearest field of the object the entry was resolved on.',
  ],
};

const DATASET_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'dataset-field-unknown',
  covers: 'what an unresolved field path does to the query',
  paragraphs: [
    'A dimension\'s or measure\'s `field` is compiled into the analytics query as written, so a path ' +
      'that names no column addresses one that does not exist: the surface renders successfully with ' +
      'empty or wrong numbers, and nothing reports the miss. A dimension bound to such a column cannot ' +
      'group by anything; a measure bound to one cannot aggregate anything.',
    'Dashboards and reports bind a dataset\'s dimensions and measures by name, and that consumer end ' +
      'is already guarded (`widget-dimension-unknown`, `widget-measure-unknown`), so this was the quiet ' +
      'hole one level down: every binding resolves, the board renders, and the numbers are wrong. The ' +
      'rule is an error for that reason.',
    'Paths are resolved on the shared object graph — a dotted `relationship.field` path hop by hop — ' +
      'and the verdict names the hop that failed and, when one is close, the nearest declared field ' +
      '("Did you mean"). Not reported: an object this stack does not define, ' +
      'an object with no readable field map (an ADR-0015 external object, an introspected ' +
      'datasource), and a registry-injected system column, which is real at runtime.',
  ],
};

const DATASET_FIELD_NOT_INCLUDED_EXPLANATION: RuleExplanation = {
  rule: 'dataset-field-not-included',
  covers: 'why a relationship prefix must be in include',
  paragraphs: [
    'ADR-0021 joins ONLY the relationship paths a dataset declares in `include`. A dimension, measure ' +
      'or filter path that resolves on the object graph but whose prefix was never declared compiles ' +
      'to no join, so the column is out of the query\'s reach however real it is.',
    'The path is still compiled into the analytics query as written, so it addresses a column that ' +
      'does not exist: the surface renders successfully with empty or wrong numbers, and nothing ' +
      'reports the miss.',
    'To fix it, add the prefix to `include` (declaring `a.b` implicitly includes `a`), or bind the ' +
      'position to a field on the dataset\'s own object.',
  ],
};

const DATASET_FILTER_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'dataset-filter-field-unknown',
  covers: 'what an unresolved filter key does',
  paragraphs: [
    'A filter KEY — on the dataset\'s scope `filter` or on a measure\'s `filter` — that names no ' +
      'column either widens the scope (the condition is dropped) or empties it (the engine compares a ' +
      'missing column). The path is compiled into the analytics query as written, so the surface ' +
      'renders successfully with empty or wrong numbers, and nothing reports the miss.',
    'All three authored filter shapes are walked — a condition object, `{ field, operator, value }` ' +
      'rules and `[field, op, value]` triples — so a filter written one way is not judged while another ' +
      'is skipped. This rule judges the KEYS; `filter-token-unknown` judges the values in the same ' +
      'position.',
  ],
};

// ── Security posture (`validate-security-posture.ts`) ──────────────────────

const SECURITY_CBP_AMBIGUOUS_RELATION_EXPLANATION: RuleExplanation = {
  rule: 'security-controlled-by-parent-ambiguous-relation',
  covers: 'why a controlled_by_parent object takes exactly one master',
  paragraphs: [
    'A `controlled_by_parent` object derives every row\'s record-level access from a master record. ' +
      'ADR-0055 §1 names that master by exactly one `master_detail` field declared `required: true`, ' +
      'with a `reference` to the master object.',
    'With two or more such fields the declaration does not say which master governs the rows, and the ' +
      'platform derives none: every read is DENIED and every write is refused with 422 INVALID_METADATA, ' +
      'exactly as for an object with no master at all. Picking one by field declaration order — what ' +
      'the runtime once did — would let a cosmetic reordering of the schema move a security boundary to ' +
      'another object. System objects are judged too: the ambiguity is a property of the document.',
    'To fix it, keep `master_detail` on the ONE master this object\'s rows belong to, and declare every ' +
      'other parent as a `lookup` field. `ObjectSchema.create()` makes every `master_detail` on such an ' +
      'object required, so a second parent declared as `master_detail` is always a second master.',
  ],
};

const SECURITY_CBP_NO_RELATION_EXPLANATION: RuleExplanation = {
  rule: 'security-controlled-by-parent-no-relation',
  covers: 'why the object is unusable without a master',
  paragraphs: [
    'A `controlled_by_parent` object says its access comes from its master. ADR-0055 §1 names that ' +
      'master by exactly one `master_detail` field declared `required: true`, with a `reference` to the ' +
      'master object, and by nothing else: a `master_detail` without `required: true` and a required ' +
      '`lookup` derive no access.',
    'Both runtime halves refuse an object without one: every read is DENIED, and every write is refused ' +
      'with 422 INVALID_METADATA — as a metadata defect rather than a permission denial — so the object ' +
      'is unusable rather than merely locked down. System objects are judged too, because the runtime ' +
      'refusal does not exempt them.',
    'To fix it, declare the master relation this object is derived from: a `master_detail` field with a ' +
      '`reference` and `required: true` (a lookup to the master becomes that field; a detail is deleted ' +
      'with its master unless it declares `deleteBehavior: \'restrict\'`). An object with no master decides ' +
      'its own baseline — and so does one whose rows must outlive their parent, which is not a detail: ' +
      '\'private\' (the owner plus explicit shares), \'public_read\' or \'public_read_write\'.',
  ],
};

const SECURITY_FLS_UNKNOWN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'security-fls-unknown-field',
  covers: 'how the runtime resolves a field-permission key',
  paragraphs: [
    'The runtime resolves a field-permission (FLS) key by stripping its object prefix and looking the ' +
      'remainder up as a column (`PermissionEvaluator.getFieldPermissions`). A remainder no column ' +
      'answers to contributes nothing, so the key matches NOTHING: the masking it declares never ' +
      'enforces, and the field it was meant to cover stays as readable and as editable as the ' +
      'object-level grant leaves it — for every holder of the set. Nothing reports that at runtime.',
    'Unlike an unqualified key (`security-fls-unqualified-key`) this one looks correct in review, and ' +
      'it is exactly what a field rename leaves behind; an empty remainder is what a half-finished edit ' +
      'leaves. A key with more dots is judged on its whole remainder, because FLS keys address columns, ' +
      'never joins.',
    'Not judged: an object this stack does not define, an object with no readable field map, and a ' +
      'registry-injected system column, which is real and addressable. To fix it, point the key at a ' +
      'field the object declares, or delete the entry: an entry that cannot match is not protection, ' +
      'and if the field was renamed the mask has been off since that rename. If the masking is still ' +
      'wanted, renaming the key is the fix; the `fix:` line names the nearest declared or injected ' +
      'column when one is close, rather than listing the object\'s fields.',
  ],
};

const SECURITY_MASTER_DETAIL_UNGRANTED_EXPLANATION: RuleExplanation = {
  rule: 'security-master-detail-ungranted',
  covers: 'why a detail object needs its own CRUD grant',
  paragraphs: [
    'A master-detail child derives its RECORD-level access from the master (ADR-0055 ' +
      '`controlled_by_parent`), but object-level CRUD is a SEPARATE gate that is never derived: a ' +
      'permission set that grants the master and forgets the child denies role-bound non-admin users ' +
      '(403) before the parent-derived access is ever consulted — the silent "can\'t submit the ' +
      'subtable" trap.',
    'A child is an object with a master_detail field, or a `controlled_by_parent` object that resolves ' +
      'its master the way the runtime does (its one required master_detail). The rule is a warning, and it ' +
      'stays silent when the stack authors no permission sets or a `\'*\'` wildcard grant covers every ' +
      'object; one set granting the child while another forgets it is out of scope.',
    'To fix it, grant the object in at least one permission set that already grants its master — ' +
      'allowRead, allowCreate and allowEdit. A table no role should ever touch is named `sys_*` or set ' +
      '`isSystem: true`.',
  ],
};

const SECURITY_WILDCARD_VAMA_EXPLANATION: RuleExplanation = {
  rule: 'security-wildcard-vama',
  covers: 'why the \'*\' entry cannot carry View All / Modify All',
  paragraphs: [
    'A permission set\'s `\'*\'` entry applies to every object, and `viewAllRecords` / `modifyAllRecords` ' +
      '(View All / Modify All Data) are the superuser bypass of ADR-0066: they skip read-side and write-side ' +
      'row-level security on every object whose posture permits it. Together they make a package-authored ' +
      'superuser over the whole deployment, objects other packages own included. Only the platform\'s own ' +
      'admin set may combine the two, and it lives outside every package, so the rule is an error on any ' +
      'set a stack authors.',
    'An app needs no wildcard of its own: platform admins already reach every installed package\'s objects ' +
      'through that platform set. An app-level admin (`crm_admin`, say) is an ordinary set that names the ' +
      'objects it needs and that the customer binds to a position of their own choosing (ADR-0090 D9), ' +
      'because "who runs this app" and "who runs the platform" are rarely the same people.',
    'To fix it, enumerate the objects the set really needs, with `viewAllRecords` / `modifyAllRecords` only ' +
      'on the entries where the bypass is meant, or drop the two flags from the `\'*\'` entry.',
  ],
};

const SECURITY_OWD_ALIAS_EXPLANATION: RuleExplanation = {
  rule: 'security-owd-alias',
  covers: 'which sharing values are retired or misplaced',
  paragraphs: [
    'ADR-0090 D4 retired three OWD spellings: \'read\' (now \'public_read\'), \'read_write\' and ' +
      '\'full\' (both now \'public_read_write\'). The runtime fails CLOSED to \'private\' on a value it ' +
      'does not know, so an object meant to be readable or writable org-wide is neither, with no notice ' +
      'on the read path.',
    '\'public\' is not an OWD value and never was, so nothing retired it: it is legal on the ' +
      'neighbouring keys \'access\' (its \'default\') and \'publicSharing\' (its \'allowedAudiences\'), ' +
      'just not on \'sharingModel\'. Its fix-it offers \'public_read_write\'.',
    'The parsed doors refuse these values at the schema enum before this rule runs; it reaches the ' +
      'unparsed ones — `os lint` on a raw config, a direct call of the rule.',
  ],
};

const SECURITY_DELEGATION_MISSING_REASON_EXPLANATION: RuleExplanation = {
  rule: 'security-delegation-missing-reason',
  covers: 'why a delegation needs a reason',
  paragraphs: [
    'ADR-0091 D3 makes the reason mandatory on every delegation, for the dual audit trail: ' +
      '`granted_by` records the writer, `delegated_from` the authority source, and `reason` why. The ' +
      'runtime delegation gate rejects a delegation without one; this rule moves the failure to ' +
      'authoring.',
    'Judged on `sys_user_position` seed rows only: `delegated_from` is not declared on ' +
      '`sys_user_permission_set`, whose engine refuses it as an undeclared field.',
  ],
};

// ── Visibility predicates (`validate-visibility-predicates.ts`) ────────────
// The console renders an element whose predicate cannot evaluate as if it had
// none (it falls OPEN); every entry below is a way to reach that outcome.

const VISIBILITY_ROOT_MISLAYERED_EXPLANATION: RuleExplanation = {
  rule: 'visibility-root-mislayered',
  covers: 'which root each surface binds',
  paragraphs: [
    'ADR-0089 D3 binds a different root on each layer. A runtime view or page surface binds the live ' +
      'record as `record`, plus `current_user` (and page state as `page.VAR` on a page component); a ' +
      'metadata-editing form — a `*.form.ts` module or a schema-bound form view — binds the row under ' +
      'edit as `data`.',
    'A predicate rooted at the other layer\'s namespace never matches, and the element renders ' +
      'unconditionally. The rule is a warning rather than an error because the root is at least a ' +
      'namespace some surface binds.',
  ],
};

const VISIBILITY_PREDICATE_OVER_BUDGET_EXPLANATION: RuleExplanation = {
  rule: 'visibility-predicate-over-budget',
  covers: 'why an oversized predicate never evaluates',
  paragraphs: [
    'The canonical CEL front end enforces the platform\'s parse budgets (`maxAstNodes`, ' +
      '`maxListElements` and the rest). A predicate that is valid CEL but overruns one is refused, so it ' +
      'can never evaluate, and the console falls OPEN: the element renders unconditionally and looks ' +
      'exactly like one with no predicate at all. Failing open is the console\'s settled behaviour, so ' +
      'this error is the only signal.',
    'It is a SIZE fault, not a dialect mistake, so re-spelling the predicate will not fix it. Collapse ' +
      'a long `record.f == \'a\' || record.f == \'b\'` chain into one `record.f in [\'a\', \'b\']`, which is ' +
      'far fewer AST nodes (`maxListElements` is 64, so a very large set needs the next option), or ' +
      'precompute the heavy part into a formula or roll-up field and test that one field. The finding ' +
      'does not echo the predicate; its `path` locates it.',
    'Logic genuinely this large is not element visibility: compute it once on the record rather than ' +
      're-deriving it in every predicate that needs it.',
  ],
};

const VISIBILITY_PREDICATE_SYNTAX_EXPLANATION: RuleExplanation = {
  rule: 'visibility-predicate-syntax',
  covers: 'why a predicate that does not parse is an error',
  paragraphs: [
    'Visibility predicates are bare CEL. A predicate the canonical front end does not parse can never ' +
      'evaluate, and the console falls OPEN: the element renders unconditionally and looks exactly like ' +
      'one with no predicate at all (failing open is the console\'s settled behaviour). Every other ' +
      'predicate surface already gates a syntax fault (ADR-0032), so this one does too.',
    'Spellings from other languages do not parse: write `==` (not `===`), `!=` (not `!==` or `<>`), ' +
      '`&&` (not `and`), `||` (not `or`), `!` (not `not`). A predicate that is flawless CEL but too ' +
      'large is `visibility-predicate-over-budget` instead.',
  ],
};

const VISIBILITY_PREDICATE_UNKNOWN_FUNCTION_EXPLANATION: RuleExplanation = {
  rule: 'visibility-predicate-unknown-function',
  covers: 'what a call to an unregistered function does',
  paragraphs: [
    'The predicate parses, so nothing else reports it, and it faults the moment it is evaluated. On a ' +
      'view or page surface the console falls OPEN and the element renders unconditionally, exactly ' +
      'like one carrying no predicate at all. On an action surface — evaluated with ' +
      '`throwOnError: true` — it falls CLOSED and the action disappears for EVERY user, including one ' +
      'who holds the grant, leaving one deduped `console.warn` as the only signal.',
    'The finding quotes the engine\'s own wording and offers no "did you mean": the nearest name is ' +
      'often an unrelated function. It is a NAME fault, so re-spelling the predicate will not fix it. ' +
      'The callable names advertised for authoring are the `functions` list `introspectScope` returns ' +
      '(`CEL_STDLIB_FUNCTIONS`); pick one of those, or precompute the value into a formula field on the ' +
      'object and test that field.',
  ],
};

const VISIBILITY_PREDICATE_HAS_ARGUMENT_EXPLANATION: RuleExplanation = {
  rule: 'visibility-predicate-has-argument',
  covers: 'what `has()` accepts as its argument',
  paragraphs: [
    'CEL defines the macro in one form, `has(e.f)`: a presence test on field `f` of whatever `e` ' +
      'evaluates to, where `f` is a plain field name written after a dot. Any other argument — a name ' +
      'alone (`has(status)`), an index as the last step (`has(record.items[0])`), a call, a literal or ' +
      'an operator — is refused by the engine as `has() invalid argument` on every evaluation, whatever ' +
      'the record holds. On a view or page surface the console then falls OPEN and the element renders ' +
      'unconditionally, exactly like one carrying no predicate at all.',
    'Write the test the definition admits: `has(record.status)` or `\'status\' in record` for a field ' +
      '(`data` instead of `record` on a metadata-editing form), and `size(record.items) > 0` to ask whether ' +
      'a list has a first element. `has()` over a selection whose receiver is indexed or called, such as ' +
      '`has(record.items[0].name)`, is accepted.',
  ],
};

const VISIBILITY_BARE_IDENTIFIER_EXPLANATION: RuleExplanation = {
  rule: 'visibility-bare-identifier',
  covers: 'why every value is read through a namespace',
  paragraphs: [
    'On a visibility surface values are bound under a namespace — `record` and `current_user` on a ' +
      'runtime view or page (plus `page.VAR` on a page component), `data` on a metadata-editing form — ' +
      'and never flattened to top level. A bare identifier, or a path through a namespace no binding ' +
      'provides, resolves to nothing, so the predicate can never evaluate and the console falls OPEN: ' +
      'the element renders unconditionally and looks exactly like one with no predicate at all ' +
      '(failing open is the console\'s settled behaviour).',
    'There is no reading of the metadata under which it was going to work, so the rule is an error. ' +
      'One position is exempt: a bare word on the right of `==` or `!=` on a metadata-editing form, ' +
      'which the console parses as a literal (a path there is `predicate-rhs-path-shaped`\'s finding).',
  ],
};

// ── Record writes (the body, flow-node and readonly write rules) ────────────
// Three surfaces write a record's fields by name: an L2 (`language: 'js'`)
// hook body, an L2 action body, and the `fields` map of a flow
// `create_record` / `update_record` node. Three families of rules ask the same
// questions of all three — does the field exist (`validate-hook-body-writes.ts`,
// `validate-action-body-writes.ts`, `validate-flow-node-writes.ts`), does it
// have storage, and is it writable through this channel
// (`validate-readonly-{flow,hook,action}-writes.ts`) — so the reasoning they
// share is written ONCE, as the constants below that every entry it explains
// references, and the families cannot drift apart. The rule files share their
// verdict clauses the same way.

/** Why the engine refuses a write that names an undeclared field — the three undeclared-field ids. */
const DECLARED_FIELD_DOOR =
  'The engine\'s declared-field door judges every caller-supplied write payload against the object\'s ' +
  'declared fields and refuses a key the object does not declare: INVALID_FIELD / 400, identically on ' +
  'every driver, before any statement is built. The whole payload is refused, so the correctly named ' +
  'fields beside the bad key never land either. The refusal arrives at run time, on whichever record ' +
  'first exercises the write and far from the line that made the mistake, which is why the rule ' +
  'reports it at author time, naming the field, the object and the write.';

/** The cause and the consequence of writing an unprovisioned anchor — the three anchor ids. */
const UNPROVISIONED_ANCHOR_WRITE: readonly string[] = [
  'The registry injects system columns — the ownership anchors `owner_id` and `organization_id`, the ' +
    'audit family — into every object. On an ADR-0015 external object the remote database owns the ' +
    'schema, so the platform registers these anchors without provisioning a column: the name resolves, ' +
    'but no storage stands behind it.',
  'A write naming such an anchor can never land. The anchor exists only in the registered schema, which ' +
    'is what carries it PAST the write-path validator that refuses an undeclared name outright ' +
    '(INVALID_FIELD); the remote database is what rejects it. On a SQL remote that is an untyped driver ' +
    'error (`no such column`) that aborts the whole statement, so the correctly named fields of the same ' +
    'payload never land either; on a schemaless remote the key is persisted into a column no read ' +
    'surface returns.',
  'Only a name that resolved BECAUSE it is injected is judged: an author-declared column of the same ' +
    'name maps a remote column the author vouches for and is never reported. The finding is a warning ' +
    'because the rule cannot see the remote table, only that the platform provisions no storage for the ' +
    'anchor.',
];

/** What a body that does not parse leaves unchecked — the two body-source ids. */
const BODY_PARSE_FAILURE: readonly string[] = [
  'The body is parsed — never executed, never type-checked — so its writes can be checked. A body with ' +
    'a syntax error is only partially recovered by the parser, so the write set the checks read comes ' +
    'from that recovered tree: a write in the part the parser could not read is judged by no rule.',
  'It is reported rather than skipped because the body would otherwise come back with nothing to ' +
    'report — the same silence the undeclared write itself has at run time, this time wearing the ' +
    'checker\'s badge. It is a warning: it says what the checker could read, not a second syntax verdict.',
];

/** The static `readonly` strip — the flow and hook static-readonly ids. */
const READONLY_STATIC_STRIP =
  'The engine strips every static `readonly: true` field from a caller-supplied write payload, on ' +
  'UPDATE and on INSERT alike, unless the write runs in a system context. The strip is silent: the call ' +
  'or step still reports success, the rest of the payload lands, and on INSERT the column falls back to ' +
  'the field\'s `defaultValue`; only a run-time warning naming the dropped field records it. `readonly` ' +
  'governs the end-user and API surface, not trusted system writers, so a system context is the ' +
  'intended channel for maintaining such a field.';

/** The conditional `readonlyWhen` strip — the three readonlyWhen ids. */
const READONLY_WHEN_STRIP: readonly string[] = [
  'A `readonlyWhen` field is locked per record. On an UPDATE the engine strips it from the ' +
    'caller-supplied payload wherever its predicate is TRUE for the record being written over, and a ' +
    'bulk update strips it from every matched row once any one of them is locked. The strip is silent, ' +
    'so whether the write lands depends on the record\'s state, which is why the finding is a warning.',
  'Unlike the static `readonly` strip, the conditional lock is NOT waived by a system context, so ' +
    'elevation is no workaround. A value a `beforeUpdate` hook derives is not caller-supplied and does ' +
    'land, even on a locked record. An INSERT is never judged: there is no prior record for the ' +
    'predicate to read, and the engine runs no conditional strip there.',
];

/** How a flow CRUD node's `fields` map reaches the engine — the two flow readonly ids. */
const FLOW_FIELDS_CALLER_PAYLOAD =
  'A `create_record` or `update_record` node hands its `fields` map to the engine as a caller-supplied ' +
  'payload, under the flow\'s run identity: `runAs`, which defaults to \'user\'.';

/** How a hook body's `ctx.api` write reaches the engine — the two hook readonly ids. */
const HOOK_API_CALLER_PAYLOAD =
  'A hook\'s `ctx.api` is a scoped handle over the TRIGGERING operation\'s context, so on every ' +
  'non-system trigger a `ctx.api.object(NAME).update / updateById / insert(…)` payload is an ordinary ' +
  'caller-supplied one.';

const HOOK_BODY_WRITE_UNKNOWN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'hook-body-write-unknown-field',
  covers: 'why an undeclared field write is refused',
  paragraphs: [
    'A hook body writes a record\'s fields through two channels, and both reach the same door. A ' +
      '`ctx.input.NAME = …` write mutates the triggering record: the sandboxed script runs clean, the ' +
      'value is copied back onto the record payload unfiltered, and the declared-field door runs a ' +
      'second time over the payload the `before*` hooks produced. A ' +
      '`ctx.api.object(NAME).insert / update / updateById(…)` write is a second, nested engine call: ' +
      '`ctx.api` is a scoped handle on the running engine, so its payload arrives as an ordinary CALLER ' +
      'write.',
    DECLARED_FIELD_DOOR,
    'What fails depends on the channel. A `ctx.input` write takes the triggering record write down with ' +
      'it: the record is never written, and the refusal names the field far from the body that wrote it. ' +
      'A `ctx.api` write lands nothing, and its refusal escapes the body and fails the operation that ' +
      'triggered the hook.',
    'A `ctx.input` write is judged against the hook\'s target objects, and a multi-target hook is ' +
      'reported only when the field is missing on every one of them: the body may branch per object. ' +
      'What the parser cannot pin down is skipped silently — a dynamic object name, an `object: \'*\'` ' +
      'hook\'s input, a target another package declares — because a false positive costs an advisory ' +
      'rule more than a miss. The rule stays a warning: it reads the body through a parser, never by ' +
      'running it.',
    'Only the literal write shapes in `HOOK_BODY_WRITE_PATTERNS` are checked: a computed key, a spread ' +
      'and an aliased `ctx.input` are not, so a clean run does not prove every write lands. The warning ' +
      'never blocks a build. The `fix:` line suggests the nearest declared or system column when one is ' +
      'close.',
  ],
};

const HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION: RuleExplanation = {
  rule: 'hook-body-write-unprovisioned-anchor',
  covers: 'why a write to an unprovisioned anchor never lands',
  paragraphs: [
    ...UNPROVISIONED_ANCHOR_WRITE,
    'On a hook body both write channels are judged. A `ctx.input` write is judged against the hook\'s ' +
      'target objects, and a multi-target hook is reported only when the anchor is unprovisioned on ' +
      'every one of them: the body may branch per object, so an anchor that is real on one target is a ' +
      'legitimate write there. A `ctx.api.object(NAME)` write is judged against the object it names.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

const HOOK_BODY_SOURCE_UNPARSEABLE_EXPLANATION: RuleExplanation = {
  rule: 'hook-body-source-unparseable',
  covers: 'what an unparseable body leaves unchecked',
  paragraphs: [
    ...BODY_PARSE_FAILURE,
    'The gating readonly rule on the same body (`hook-api-update-readonly-field`) skips an unparseable ' +
      'body rather than guess at what the unread part wrote, so this finding is the one that describes ' +
      'the problem.',
  ],
};

const ACTION_BODY_WRITE_UNKNOWN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'action-body-write-unknown-field',
  covers: 'why an undeclared field write is refused',
  paragraphs: [
    'An action body persists records only through ' +
      '`ctx.api.object(NAME).insert / create / update / updateById(…)`. `ctx.api` is a scoped handle on ' +
      'the running engine, so the payload arrives as an ordinary CALLER write. An action\'s `ctx.input` ' +
      'is its params bag, validated against the action\'s own `params`, so it is never resolved against ' +
      'fields.',
    DECLARED_FIELD_DOOR,
    'The nested write lands nothing, and its refusal escapes the body and fails the action. Hook bodies ' +
      'get the same check (`hook-body-write-unknown-field`) through the same extractor, so the two rules ' +
      'judge the same write shape the same way.',
    'Only the literal write shapes in `ACTION_BODY_WRITE_PATTERNS` are checked — today the ' +
      '`ctx.api.object(NAME)` call with a literal payload — so a clean run does not prove every write ' +
      'lands, and the `ctx.input` shapes are excluded because an action\'s input is its params bag. The ' +
      'warning never blocks a build. The `fix:` line suggests the nearest declared or system column when ' +
      'one is close.',
  ],
};

const ACTION_RECORD_WRITE_DISCARDED_EXPLANATION: RuleExplanation = {
  rule: 'action-record-write-discarded',
  covers: 'why an assignment to the record snapshot is discarded',
  paragraphs: [
    'The runtime hands an action body a plain snapshot of the record as `ctx.record` and never writes it ' +
      'back: the handler returns the body\'s value and applies nothing to the record. So ' +
      '`ctx.record.NAME = …` changes a copy that dies with the sandbox, whether or not NAME is a declared ' +
      'field, and the action still returns success. The snapshot stays read-only by design: an action\'s ' +
      'write channel is `ctx.api`.',
    'This is its own rule id rather than a case of `action-body-write-unknown-field` on purpose: ' +
      'reporting only the undeclared half would imply that a write to a declared field persists, the ' +
      'false completion the rule exists to stop.',
    'It is reported only when the write is provably dead: `ctx.record` never leaves the body as a ' +
      'value. Handed to anything — an argument, an assignment, a spread, a return — the snapshot may be ' +
      'a payload under construction, so every write in that body is skipped. An alias ' +
      '(`const r = ctx.record`) counts as an escape; a property read does not. The warning never blocks ' +
      'a build.',
  ],
};

const ACTION_BODY_SOURCE_UNPARSEABLE_EXPLANATION: RuleExplanation = {
  rule: 'action-body-source-unparseable',
  covers: 'what an unparseable body leaves unchecked',
  paragraphs: [
    ...BODY_PARSE_FAILURE,
    'The readonly rule on the same body (`action-api-update-readonly-when-field`) skips an unparseable ' +
      'body rather than guess at what the unread part wrote, so this finding is the one that describes ' +
      'the problem.',
  ],
};

const ACTION_BODY_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION: RuleExplanation = {
  rule: 'action-body-write-unprovisioned-anchor',
  covers: 'why a write to an unprovisioned anchor never lands',
  paragraphs: [
    ...UNPROVISIONED_ANCHOR_WRITE,
    'On an action body only the `ctx.api.object(NAME)` write is judged: an action\'s `ctx.input` is its ' +
      'params bag, not a record, and its `ctx.record` is a snapshot the runtime never writes back ' +
      '(`action-record-write-discarded`).',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

const FLOW_NODE_WRITE_UNKNOWN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'flow-node-write-unknown-field',
  covers: 'why an undeclared field write is refused',
  paragraphs: [
    'A `create_record` or `update_record` node hands its `fields` map to the data engine directly — the ' +
      'flow executor calls the engine\'s insert or update, not the metadata API — so the map arrives as an ' +
      'ordinary caller payload.',
    DECLARED_FIELD_DOOR,
    'The node folds the refusal into a step failure, so the run fails. On `create_record` the row is ' +
      'never created at all, so every later node that expected the new record\'s id is working from a ' +
      'record that does not exist.',
    'This rule gates where the hook and action body rules advise: nothing here is parsed — the key and ' +
      'the object name are both literal metadata — so a finding is a certainty. Not judged: a templated ' +
      'object name (resolved from flow variables at run time), a non-literal `fields` map, a dotted key ' +
      '(a nested path the document drivers forward verbatim) and an object another package declares. ' +
      '`runAs` is not consulted: no run identity conjures a column.',
  ],
};

const FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION: RuleExplanation = {
  rule: 'flow-node-write-unprovisioned-anchor',
  covers: 'why a write to an unprovisioned anchor never lands',
  paragraphs: [
    ...UNPROVISIONED_ANCHOR_WRITE,
    'On a flow the `fields` map of a `create_record` or `update_record` node is judged against the ' +
      'node\'s literal object name. This finding is a warning where the node\'s undeclared-field finding ' +
      'is an error: that one is a certainty about this stack, this one is a claim about a remote schema ' +
      'the build cannot see.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

const FLOW_UPDATE_READONLY_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'flow-update-readonly-field',
  covers: 'why a readonly field write is silently dropped',
  paragraphs: [
    FLOW_FIELDS_CALLER_PAYLOAD,
    READONLY_STATIC_STRIP,
    'A `runAs: \'system\'` flow bypasses the static strip and legitimately maintains readonly fields ' +
      '(users cannot edit them, automation does), so it is never reported here; the same flow is still ' +
      'judged for `readonlyWhen` fields, whose lock elevation does not waive. A `create_record` on a ' +
      'platform-internal object (an engine-owned, append-only or better-auth bucket, or a `sys_` name) ' +
      'is not judged: the engine runs no create-side strip there. The rule gates because a literal ' +
      'field name against a declared `readonly: true` is a certain no-op.',
    'So if automation is meant to maintain the field, declare the flow `runAs: \'system\'`; otherwise ' +
      'remove the field from the node. Seeding a readonly column at create time is a SYSTEM act, so a ' +
      '`create_record` has a third route: stamp the value in a `beforeInsert` hook on the object, because a ' +
      'hook-assigned key is the hook\'s write, not a caller-supplied one, and survives the strip.',
  ],
};

const FLOW_UPDATE_READONLY_WHEN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'flow-update-readonly-when-field',
  covers: 'why a readonlyWhen field write may not land',
  paragraphs: [
    FLOW_FIELDS_CALLER_PAYLOAD,
    ...READONLY_WHEN_STRIP,
    'So a `runAs: \'system\'` flow is judged here like any other, and the verdict names the run ' +
      'identity it was judged under. Only `update_record` is judged.',
    'To fix it, derive the value in a `beforeUpdate` hook on the record\'s own object, or make sure the ' +
      'node only targets records whose `readonlyWhen` predicate is FALSE; otherwise remove the field from ' +
      'the `update_record` node. The warning never blocks a build.',
  ],
};

const HOOK_API_UPDATE_READONLY_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'hook-api-update-readonly-field',
  covers: 'why a readonly field write is silently dropped',
  paragraphs: [
    HOOK_API_CALLER_PAYLOAD,
    READONLY_STATIC_STRIP,
    'Never reported, because it never reaches the strip: a hook that declares `runAs: \'system\'` (its ' +
      '`ctx.api` gets a system context, so the write lands and the triggering user is still stamped on ' +
      'the record), and a `ctx.input.NAME = …` stamp in the record\'s own `beforeInsert` / `beforeUpdate` ' +
      'hook, a server value rather than a caller\'s, which survives the strip. The rule keys on the write ' +
      'channel, not the field, so that correct stamp is never touched. `ctx.api.sudo()` is no way out ' +
      'from a body: `sudo()` lives on the in-process scoped context and is not marshalled into the ' +
      'sandbox, so calling it is a TypeError at run time.',
    'Seeding a readonly column at create time is a SYSTEM act, so the two routes are the remedy whichever ' +
      'verb the body calls: `runAs: \'system\'` on this hook, or the own-hook stamp — on an update the ' +
      'recommended shape, since a value automation maintains belongs on the record\'s own hook. Otherwise drop ' +
      'the field from the payload, or drop `readonly: true` from the field.',
    'The rule gates because both halves are declared in this stack: the field\'s `readonly` and the ' +
      'body\'s literal `ctx.api` write. `id` in an update payload is the write\'s address, not a field ' +
      'write, and is not judged; a body that does not parse is skipped, and its ' +
      '`hook-body-source-unparseable` finding describes the problem.',
  ],
};

const HOOK_API_UPDATE_READONLY_WHEN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'hook-api-update-readonly-when-field',
  covers: 'why a readonlyWhen field write may not land',
  paragraphs: [
    HOOK_API_CALLER_PAYLOAD,
    ...READONLY_WHEN_STRIP,
    'Neither `runAs: \'system\'` nor `ctx.api.sudo()` helps: a system context does not waive the ' +
      'conditional lock, and `sudo()` is not marshalled into the sandbox in any case (calling it from a ' +
      'body is a TypeError at run time).',
    'So derive the value in a `beforeUpdate` hook on the record\'s own object, or make sure the call only ' +
      'targets records whose `readonlyWhen` predicate is FALSE; otherwise drop the field from the ' +
      'payload. The warning never blocks a build.',
  ],
};

const ACTION_API_UPDATE_READONLY_WHEN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'action-api-update-readonly-when-field',
  covers: 'why a readonlyWhen field write may not land',
  paragraphs: [
    'An action body\'s `ctx.api` runs elevated by design, in a system context. That exempts its writes ' +
      'from the STATIC `readonly` strip — a `readonly: true` field written there lands, so this surface ' +
      'has no static-readonly rule — but NOT from the conditional one.',
    ...READONLY_WHEN_STRIP,
    'Only `ctx.api.object(NAME).update / updateById(…)` is judged. `ctx.record` is not a write surface ' +
      '(`action-record-write-discarded` owns that shape), and `id` in an update payload is the write\'s ' +
      'address, not a field write.',
    'Elevation is no way out here: the body already runs system-elevated and the lock still applies, so ' +
      '`ctx.api.sudo()` changes nothing. So derive the value in a `beforeUpdate` hook on the record\'s own ' +
      'object, or make sure the call only targets records whose `readonlyWhen` predicate is FALSE; ' +
      'otherwise drop the field from the payload. The warning never blocks a build.',
  ],
};

// ── Row-level security and sharing rules (the two enforceability rules) ─────
// Two security surfaces are compiled to a row filter rather than interpreted:
// an RLS policy's `using` / `check` (`validate-rls-predicate-enforceability.ts`)
// and a declared sharing rule's `condition`
// (`validate-sharing-rule-enforceability.ts`). Both rules ask the runtime's own
// compiler whether a predicate lowers, and both judge a lowered field-to-field
// comparison by the declared field map, so the reasoning they share is written
// ONCE below and every entry it explains references it. The rule files share
// their verdict clauses the same way.

/** How the runtime treats an RLS predicate it cannot compile — every id that drops a policy. */
const RLS_UNCOMPILABLE_DROP =
  '`RLSCompiler` compiles every RLS predicate to a row filter at request time and DROPS a policy whose ' +
  'predicate it cannot compile. One WARN line — "has an uncompilable predicate … and was DROPPED (no ' +
  'enforcement)" — is the only signal, and nothing else reports it at authoring time. The runtime fails ' +
  'CLOSED, which is why such a policy is survivable; it reads as an authorization and behaves as a refusal.';

/**
 * What a dropped `using` does, for both sources a policy has: a permission
 * set's `rowLevelSecurity[]` and an object's `defaultRowScope` (#24452), which
 * the security plugin's row-policy collection applies alone, only when the
 * held sets carry no row policy for the object and operation. The INSERT
 * half: the ADR-0058 D4 write check takes its set from `writeCheckPolicies`,
 * so when no applicable policy for the insert declares a `check`, every
 * applicable policy's `using` is compiled as its check. Measured through the real `SecurityPlugin` on an `insert` and an
 * `all` policy, for all three kinds of drop (an unlowerable shape, an
 * unresolved `current_user.*`, an undeclared column): with nothing else
 * compiling in that set, every single-record insert is refused (403); with
 * another applicable policy's `using` compiling, that one alone decides; with a
 * declared `check` beside it, the declared check alone decides.
 */
const RLS_DROPPED_USING =
  'A dropped `using`: when it is the only applicable policy for that object and operation, `compileFilter` ' +
  'returns the `RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause, so every select / ' +
  'update / delete on the object matches ZERO rows and the object disappears for every holder of the ' +
  'permission set that carries the policy. An object\'s `defaultRowScope` is applied only when the caller\'s ' +
  'permission sets carry no row policy for that object and operation, so it is always the only applicable ' +
  'policy: a dropped default makes the object disappear for every caller it applies to, and a caller whose ' +
  'permission set carries its own row policy for the object is not affected. When other policies also apply, ' +
  'which only a permission set\'s policy can meet, this one just vanishes from the OR and grants none of the ' +
  'access it appears to. ' +
  'On an `insert` or `all` policy the same `using` is also the single-record INSERT check ' +
  'whenever no applicable policy for the insert declares a `check` (ADR-0058 D4): when nothing else in that set ' +
  'compiles, every single-record insert it governs fails with `PermissionDeniedError`; when another policy\'s ' +
  '`using` compiles, that one alone decides the insert.';

/**
 * What a dropped `check` does. The write check OR-combines the declared checks
 * of all the applicable policies for the operation, so a dropped `check` is a
 * blanket refusal only when no other declared `check` in that set compiles
 * (measured: beside a compiling declared `check`, that one alone decided;
 * beside a USING-only sibling, every single-record insert was refused, because
 * a USING-only sibling takes no part once any policy declares a `check`).
 */
const RLS_DROPPED_CHECK =
  'A dropped `check`: on the ADR-0058 D4 write path it leaves the post-image `check` as the `RLS_DENY_FILTER` ' +
  'sentinel, which no record can satisfy, so every single-record insert and by-id update the policy governs ' +
  'fails with `PermissionDeniedError`: the policy reads as a write rule and behaves as a blanket refusal. That ' +
  'holds when no other applicable policy for the operation declares a `check` that compiles; when one does, ' +
  'that `check` alone decides and this one contributes nothing.';

/** A comparison with a column that holds a list or an object — both rules' list-holding arm. */
const LIST_HOLDING_COMPARISON =
  'A column that holds a list or an object — one declared with a structured JSON type such as `json` or ' +
  '`address`, or a multi-value field such as `multiselect`, `tags` or a lookup flagged `multiple: true` — is ' +
  'not one comparable value, on either side of a field-to-field comparison, so the platform refuses the ' +
  'comparison instead of evaluating it. The compiler accepts it, because it knows the predicate\'s text and not ' +
  'the object\'s field types; the rule judges it by the declared type, as driver-sql does.';

/** A comparison across comparison classes — both rules' cross-class arm. */
const CROSS_CLASS_COMPARISON =
  'Two columns are compared only within one comparison class — the class decides how their stored values ' +
  'order and equal, and across classes SQL and the in-memory evaluator answer differently — and a file field ' +
  'or a formula field has no class at all: no row filter can compare a file field with another column, and a ' +
  'formula field has no stored column a row filter can read. So the platform defines no comparison between ' +
  'such columns. The classification is the spec\'s (`crossFieldComparisonVerdict`), the one driver-sql applies.';

/**
 * The comparison classes with the declared types each holds — both rules'
 * cross-class arm, which used to print this listing on its `fix:` line.
 * `validate-rls-predicate-enforceability.test.ts` holds it to
 * `CROSS_FIELD_CLASS_LISTING`, which the rule reads off the spec's class table.
 */
const CROSS_CLASS_LISTING =
  'Compare a field only with a field of the same comparison class: a number only with a number (`number`, ' +
  '`currency`, `percent`, `rating`, `slider`, `progress`, `summary`); text only with text (`text`, `textarea`, ' +
  '`email`, `url`, `phone`, `password`, `secret`, `markdown`, `html`, `richtext`, `code`, `color`, `signature`, ' +
  '`qrcode`, `autonumber`, `select`, `radio`, `lookup`, `master_detail`, `user`, `tree`); a boolean only with a ' +
  'boolean (`boolean`, `toggle`); a date only with a date (`date`); a datetime only with a datetime ' +
  '(`datetime`); a time of day only with a time of day (`time`). A file field and a formula field cannot be ' +
  'compared with another column at all. If the two columns do hold comparable values, one of them is declared ' +
  'with the wrong type: fix the declaration, not the predicate.';

const RLS_PREDICATE_UNPARSEABLE_EXPLANATION: RuleExplanation = {
  rule: 'rls-predicate-unparseable',
  covers: 'why a predicate that does not parse is dropped',
  paragraphs: [
    'An RLS predicate is CEL (ADR-0058 D1). Before parsing, a legacy SQL bridge rewrites the historic subset ' +
      'it covers — a bare `=` to `==` and `IN` to `in`, never inside a quoted literal — and everything else must ' +
      'already be CEL: SQL `AND` / `OR` / `LIKE`, a subquery or a stray operator does not parse.',
    'So combine with `&&` / `||` rather than SQL `AND` / `OR`, negate with `!`, and use `startsWith` / ' +
      '`endsWith` / `contains` rather than `LIKE`. A subquery has no CEL spelling at all: RLS cannot join ' +
      '(ADR-0055), so pre-resolve the set into a membership key the runtime exposes ' +
      '(`FIELD in current_user.KEY`, ADR-0105 D11) or denormalise the value onto this object.',
    RLS_UNCOMPILABLE_DROP,
    RLS_DROPPED_USING,
    RLS_DROPPED_CHECK,
    'A predicate that is flawless CEL but too large for a platform parse bound is `rls-predicate-over-budget` ' +
      'instead: the runtime refuses both the same way, and the fix differs.',
  ],
};

const RLS_PREDICATE_OVER_BUDGET_EXPLANATION: RuleExplanation = {
  rule: 'rls-predicate-over-budget',
  covers: 'why an oversized predicate is dropped',
  paragraphs: [
    'The compiler parses a predicate under the platform\'s CEL bounds (`maxAstNodes` 256, `maxDepth` 32, ' +
      '`maxListElements` 64 and the rest) and refuses one that overruns a bound exactly as it refuses a syntax ' +
      'error — on purpose, because the runtime\'s only decision is whether to drop the policy. This rule tells ' +
      'the two apart because the fix differs: there is no syntax or dialect error to correct, so the predicate ' +
      'must get smaller. The finding names the bound and its value; its `path` locates the predicate.',
    'So make it smaller, or move the work off the predicate. (1) Collapse a long `field == a || field == b || …` ' +
      'chain into a single `field in [a, b, …]`, which is far fewer AST nodes (`maxListElements` is 64, so a very ' +
      'large set needs option 2). (2) Pre-resolve the set into a membership key the runtime exposes and test ' +
      '`field in current_user.<key>` (ADR-0105 D11) — one comparison whatever the set size. (3) Denormalise a ' +
      'repeated sub-expression onto this object as a formula/rollup field and test that single column. (4) Split ' +
      'a TOP-LEVEL `||` across several `rowLevelSecurity` policies: applicable policies are OR-ed, so that is ' +
      'equivalent — but never split a top-level `&&` this way, which would WIDEN access rather than preserve it. ' +
      'Logic genuinely this large is not a row filter: move it to a hook or action body ' +
      '(`ScriptBody { language: \'js\' }`, the L2 sandboxed surface).',
    RLS_UNCOMPILABLE_DROP,
    RLS_DROPPED_USING,
    RLS_DROPPED_CHECK,
  ],
};

const RLS_PREDICATE_UNENFORCEABLE_EXPLANATION: RuleExplanation = {
  rule: 'rls-predicate-unenforceable',
  covers: 'what a predicate the runtime cannot enforce does',
  paragraphs: [
    'An RLS predicate is compiled to a row filter (ADR-0056 D4), so only the pushdown subset lowers. A ' +
      'function call (`size(…)`, `has(…)`), arithmetic, a ternary, a related-record path, a list literal under ' +
      '`==` / `!=` or the bare `current_user` root used as a value is outside it, and the compiler refuses it. ' +
      'The finding quotes the verdict half of the compiler\'s own refusal. It judges both places a row policy ' +
      'is declared, which the runtime compiles alike: a permission set\'s `rowLevelSecurity` entry and an ' +
      'object\'s `defaultRowScope`, whose `path` starts at `objects[N].defaultRowScope`. It judges a ' +
      'membership key\'s `filter` the same way (`objects[N].membershipKeys.KEY.filter`), with the declaring ' +
      'object as its target: see `os explain rls-predicate-membership-key-target` for what a membership key is.',
    'The lowerable subset is: `==` `!=` `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and the ' +
      'string methods `startsWith` / `endsWith` / `contains` — over SINGLE-column field paths (ADR-0058 D2), ' +
      'compared against a literal or a `current_user.*` value. Three traps in particular: (1) a function call — ' +
      '`size(record.tags) > 0`, `has(record.x)` — is correct in an object VALIDATION rule, which is INTERPRETED, ' +
      'and wrong here, where the predicate is COMPILED to a filter; write the null test as `field != null`. ' +
      '(2) A related-record path (`record.account.region`) is a join, which the compiler refuses by design ' +
      '(ADR-0055) — denormalise the value onto this object (a formula/rollup field) and test that column. ' +
      '(3) Arithmetic on a column (`amount * 2 > 100`) never lowers — precompute it into a field, or compare the ' +
      'column against the literal directly.',
    RLS_UNCOMPILABLE_DROP,
    // The two key lists are held equal to the rule's per-key probe types by the rule's test.
    'A predicate can pass that shape check and still be refused for the TYPE of the value a `current_user` ' +
      'reference holds on every request. `ExecutionContext` declares, and the kernel resolves, the membership ' +
      'sets `accessible_org_ids`, `org_user_ids` and `positions` as LISTS and `email`, `id` and ' +
      '`organization_id` as one value each, and `current_user` alone is the whole caller context object. A ' +
      'list under `==` / `!=` or handed to a string method, one value on the right of `in`, or the whole ' +
      'context object where one value or one set belongs is refused on EVERY request, so `RLSCompiler` drops ' +
      'the policy on every request. The ' +
      'shape check passes, so the "uncompilable predicate" WARN is never logged; the only signal is a ' +
      'per-request "DENY (fail closed)" WARN, emitted only when nothing else applicable compiles. A refusal that ' +
      'depends on WHICH caller asks — a constant comparison such as `current_user.email == \'ops@acme.com\'` — is ' +
      'not reported: no single probe can stand for every request.',
    'Each holding breaks one rule. `==` / `!=` compare ONE value and a string method takes ONE string, so a ' +
      'membership set is tested with `in` — "one of these" is `x in set`, "none of these" is `!(x in set)`. `in` ' +
      'tests membership in a SET, so one value is compared with `==` / `!=`. And `current_user` is the caller ' +
      'context, not a value: name the key that holds what you mean. The `fix:` line rewrites the first site the ' +
      'fault lands on and counts the rest; every site admits the same rewrite. A site also admits a second one: a ' +
      'string method can be passed ONE of the one-value keys above instead of a set, and a set is named by one of ' +
      'the membership keys above, or by an app-staged §7.3.1 set (`field in current_user.<key>`).',
    'The same per-request drop, with the same signal, follows a lowered comparand the platform\'s shared filter ' +
      'check refuses — a `null` list member or a `null` ordering bound, which no two backends agree on: ' +
      '`RLSCompiler` runs that check on every compiled policy filter before any backend sees it.',
    '`null` has no place inside a list or opposite an ordering operator — the platform refuses both in every ' +
      'filter it is sent, because no two backends agree on what they match. Test for no value with `== null` and ' +
      'for a value with `!= null`. A list that keeps other members either keeps matching a missing value ' +
      '(`(field in [...] || field == null)`, the `fix:` line\'s rewrite) or drops the `null` member; an ordering ' +
      'bound of `null` becomes `!= null` (has a value) or `== null` (has none), or a real bound.',
    RLS_DROPPED_USING,
    RLS_DROPPED_CHECK,
    LIST_HOLDING_COMPARISON,
    'A row filter compares one value with one value, so it cannot test membership in a list another column ' +
      'holds: compare with a single-valued column, or with a literal or a `current_user` value — "one of these ' +
      'values" is `record.status in [\'open\', \'pending\']` or `record.owner in current_user.org_user_ids` — or ' +
      'move the condition into a validation rule or a hook.',
    CROSS_CLASS_COMPARISON,
    CROSS_CLASS_LISTING,
    'To keep the rule without a second column, compare with a literal or a `current_user` value, test a file ' +
      'field with `!= null`, or store the value you mean in a field of the right type and compare that — or move ' +
      'the condition into a validation rule or a hook.',
    'Such a comparison is not dropped; it is refused where it runs. On a `using`, every read the policy scopes ' +
      'is refused on the SQL drivers (`INVALID_FILTER` / 400: driver-sql refuses the comparison by the columns\' ' +
      'declared types), and every by-id update or delete it scopes fails closed (`PERMISSION_DENIED` / 403). On ' +
      'a `check` — and on the `using` of an `insert`, `update` or `all` policy whenever no applicable policy for ' +
      'that operation declares a `check` (ADR-0058 D4), where the `using` is the write check — the in-process ' +
      'write check refuses the comparison too (`INVALID_FILTER` / 400) and stores nothing: against a list-holding ' +
      'column every single-record insert and by-id update whose record holds a list or an object there, across ' +
      'two classes every insert or update it judges.',
    'Last, the `using` of a `select` or `all` policy — the object\'s row-level READ SCOPE — is judged by the ' +
      'engine\'s own filter admission, which reads what the object\'s fields ARE: a text operator aimed at a ' +
      'number field, a date field compared with a value its storage cannot read, a filter on a formula field or ' +
      'a `{placeholder}` string (judged with no caller, so it never resolves) is refused there. The finding ' +
      'quotes the engine\'s verdict with its code and status. The analytics face hands the read scope to this ' +
      'same admission before it runs a query, so every analytics query over the object that this policy scopes ' +
      'is refused. Each clause earns one finding: the engine judges only a clause every earlier check left clean.',
    'What the engine refuses, it refuses for a reason the `fix:` line names in one line: a text operator ' +
      '(`startsWith` / `endsWith` / `contains`) runs only on a field that holds a string, and a date or datetime ' +
      'field only against a value its storage can read. A `{…}` placeholder is saved-filter syntax, and an RLS ' +
      'predicate does not use it: the predicate is CEL, and the caller\'s values are the `current_user` keys ' +
      '(accessible_org_ids, email, id, org_user_ids, organization_id, positions).',
  ],
};

// This text was rewritten once, and why it was wrong is worth keeping: it said
// the field half had TWO directions — fail-closed in the leading position
// `extractTargetField` recognises, fail-OPEN everywhere else — and credited the
// WRITE leg's fail-closed to that same safety net. The runtime now judges
// column existence on the COMPILED predicate, inside `RLSCompiler.compileFilter`,
// which the read layer and the ADR-0058 D4 write gate both pass through, so a
// miss fails CLOSED everywhere, on both clauses; and `computeWriteCheckFilter`
// never had an `extractTargetField` net — which is why a negated `check` miss
// PERMITTED the write until the compiler-side guard landed.
const RLS_PREDICATE_UNKNOWN_FIELD_EXPLANATION: RuleExplanation = {
  rule: 'rls-predicate-unknown-field',
  covers: 'what a policy naming a missing column does',
  paragraphs: [
    'The predicate lowers, but a column it names is not declared on the policy\'s object — most often what a ' +
      'column RENAME leaves behind. `RLSCompiler` judges column existence on the COMPILED predicate, so the ' +
      'position and the polarity it is written in make no difference: a leading `field ==`, a negation ' +
      '(`field != x`, `!(field == x)`, `!(field in [...])`) and any arm after the first all lower to the same ' +
      'tree and all DROP the policy at request time, with one WARN line as the only signal.',
    RLS_DROPPED_USING,
    'The object then disappears not because its readers were denied, but because the narrowing they were ' +
      'granted names a column that is not there.',
    RLS_DROPPED_CHECK,
    'On a runtime older than that compiled-predicate guard a `check` miss failed OPEN rather than closed: the ' +
      'write path had no field-existence check at all, so a negated miss was satisfied VACUOUSLY by the ' +
      'post-image and PERMITTED exactly the writes the policy was written to refuse, on every driver. Fix the ' +
      'name rather than relying on either behaviour.',
    'So point the predicate at a column the object really declares — the verdict\'s "Did you mean" names the ' +
      'nearest one — or delete the policy if the narrowing is gone: a policy naming a column that does not exist ' +
      'is not protection. If the field was RENAMED, this policy has been wrong since that rename, so check which ' +
      'runtime it ran on before you judge the blast radius. If the value was meant to live on another object, ' +
      'RLS cannot join to it (ADR-0055) — denormalise it onto the policy\'s object (a formula/rollup field) and ' +
      'test that column instead.',
  ],
};

const RLS_PREDICATE_UNKNOWN_USER_VARIABLE_EXPLANATION: RuleExplanation = {
  rule: 'rls-predicate-unknown-user-variable',
  covers: 'which current_user values a predicate can read',
  paragraphs: [
    // Held equal to `RESERVED_RLS_MEMBERSHIP_KEYS` by the rule's test.
    'The kernel-resolved `current_user` keys are exactly accessible_org_ids, email, id, org_user_ids, ' +
      'organization_id, positions. The only other keys that can EVER appear are §7.3.1 membership sets, which ' +
      'the runtime stages as ARRAYS and which are therefore usable only as `field in current_user.KEY`. A key ' +
      'outside that list in a scalar position — compared with `==` / `!=` / `<` / `>` or handed to a string ' +
      'method — can therefore never be supplied by any request.',
    'Of the kernel keys, `current_user.organization_id` is the tenant, `current_user.id` the acting user ' +
      'and `current_user.email` their unique address. A key meant as an app-resolved set is either declared ' +
      'on its roster object (`membershipKeys`) or staged into `ExecutionContext.rlsMembership` by an ' +
      '`IRlsMembershipResolver` that DECLARES it in its `keys`, and can then only be tested with `in` ' +
      '(`FIELD in current_user.KEY`), never compared with `==`: the runtime stages membership sets as arrays ' +
      'and never as scalars. A declared key compared with `==` is `rls-predicate-unenforceable`, as a kernel ' +
      'list key is: the rule knows it holds a list.',
    'The compiler answers `unresolved-variable` for it in EVERY position — including under `!` and in a ' +
      'trailing `||` arm — so `RLSCompiler` DROPS the policy at request time, and one WARN line is the only ' +
      'signal.',
    RLS_DROPPED_USING,
    'The object then disappears not because its readers were denied, but because the narrowing they were ' +
      'granted resolves to nothing.',
    RLS_DROPPED_CHECK,
    'An unknown key in a membership position (`field in current_user.KEY`) is not reported by `os validate`, ' +
      '`os build` or `os lint`: there it is indistinguishable from a key a self-hosted resolver the CLI cannot ' +
      'see owns. The runtime publish gate (the Studio, REST and MCP save door) knows the deployment\'s ' +
      'registered resolver and every object\'s `membershipKeys`, so there such a key is reported when no ' +
      'kernel key, declaration or resolver owns it: nothing can stage it, and every policy reading it drops.',
    'A membership key\'s `filter` may not read any `current_user` value at all. The security plugin resolves ' +
      'the key with no caller values bound, so a filter reading one never compiles, the key never resolves, ' +
      'and every policy reading the key matches no rows. Keeping the filter to the roster object\'s own ' +
      'columns is also what keeps one key from being built from another.',
  ],
};

/** What a declared membership key is and how it resolves — the opening of every membership-key entry. */
const MEMBERSHIP_KEY_RESOLUTION =
  'A membership key (`ObjectSchema.membershipKeys`) is declared on a roster object X: `current_user.KEY` is ' +
  'the distinct values of its `valueField` (F) on the rows of X whose `userField` (U) is the signed-in user ' +
  'and on which its optional `filter` holds, read once per request by the platform itself, inside the ' +
  'caller\'s organization wall. A policy then tests a record against the set: `supplier in ' +
  'current_user.portal_supplier_ids`. Every miss fails closed: the key stays unresolved, every policy ' +
  'reading it is dropped, and the records it was meant to grant are not readable.';

const MEMBERSHIP_KEY_USER_FIELD_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'membership-key-user-field-invalid',
  covers: 'which column a membership key matches the user on',
  paragraphs: [
    MEMBERSHIP_KEY_RESOLUTION,
    'The read matches U against ONE user id, the caller\'s. So U must be a column of X that holds one user: ' +
      'a `user` field, or a `lookup` or `master_detail` field to `sys_user`, not flagged `multiple: true`. A ' +
      'column X does not have makes the read fail; a text column, or a reference to another object, holds ' +
      'values that are not user ids, so the key resolves to the wrong rows or none; a multi-user column ' +
      'cannot equal one id. A column the platform injects (`owner_id`, `created_by`) is a column of X and is ' +
      'judged by its injected definition.',
    'U is judged on the object as it runs: an `objectExtensions` entry that replaces the column is folded in ' +
      'first, by the registry\'s own merge order. A column two packages write at the same deciding priority is ' +
      'not judged, because registration order picks the winner.',
  ],
};

const MEMBERSHIP_KEY_VALUE_FIELD_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'membership-key-value-field-invalid',
  covers: 'which column a membership key collects',
  paragraphs: [
    MEMBERSHIP_KEY_RESOLUTION,
    'The set holds F\'s values, and a policy compares it with a column that references the same object, or ' +
      'with `id` on that object. So F must be a reference column of X: `lookup`, `master_detail` or `user`. A ' +
      'multi-valued one is allowed, and its values are flattened. A column X does not have makes the read ' +
      'fail; any other type holds values no policy can compare with a record. F may not be U\'s column: the ' +
      'schema refuses that, because the set would hold only the caller\'s own id.',
    'F is judged on the object as it runs, an `objectExtensions` entry that replaces it folded in first.',
  ],
};

const MEMBERSHIP_KEY_DECLARED_TWICE_EXPLANATION: RuleExplanation = {
  rule: 'membership-key-declared-twice',
  covers: 'why one membership key has one roster object',
  paragraphs: [
    MEMBERSHIP_KEY_RESOLUTION,
    'Key names share one namespace across the deployment. When two objects declare the same key, the ' +
      'platform cannot tell which roster defines it, so neither declaration resolves and the request that ' +
      'meets it logs an error. `defineStack` and `composeStacks` refuse the pair inside one stack; the ' +
      'runtime save door also sees the objects already deployed, so it refuses a declaration of a key a live ' +
      'object declares. Rename one of the keys, or remove one declaration.',
  ],
};

const MEMBERSHIP_KEY_RESOLVER_COLLISION_EXPLANATION: RuleExplanation = {
  rule: 'membership-key-resolver-collision',
  covers: 'why a declared key may not be a resolver key',
  paragraphs: [
    MEMBERSHIP_KEY_RESOLUTION,
    'A deployment can also register a code resolver (`IRlsMembershipResolver`, ADR-0105 D11) that stages ' +
      'the keys it lists in `keys`. One key has one owner: when a declaration and the resolver both claim it, ' +
      'the platform takes neither value, every policy reading the key matches no rows, and the boot logs an ' +
      'error naming both owners. Only the runtime save door knows the registered resolver, so `os validate`, ' +
      '`os build` and `os lint` do not judge this. Rename the declared key, or drop it from the resolver.',
  ],
};

const RLS_PREDICATE_MEMBERSHIP_KEY_TARGET_EXPLANATION: RuleExplanation = {
  rule: 'rls-predicate-membership-key-target',
  covers: 'what a membership key can be compared with',
  paragraphs: [
    MEMBERSHIP_KEY_RESOLUTION,
    'The set holds ids of the object F references; call it T (`sys_user` for a `user` field). A policy can ' +
      'only find those ids in a column that references T, or in the `id` of T itself. Tested against a ' +
      'reference to another object, against a column that is not a reference, or against the `id` of another ' +
      'object, the set never matches: `x in KEY` matches no row, and `!(x in KEY)` matches every row. Neither ' +
      'is the policy that was written. The compiler accepts the comparison, because it knows the predicate ' +
      'and not what the declaration collects; the rule reads the declaration.',
    'So test the key against the column that references T — on a purchase order whose `supplier` is a lookup ' +
      'to the supplier object, `supplier in current_user.portal_supplier_ids` — or against `id` when the ' +
      'policy is on T itself. A key whose declaring object is not in the stack, or that two objects declare, ' +
      'is not judged here.',
  ],
};

/** What happens to a declared sharing rule whose `condition` does not lower — the two condition ids. */
const SHARING_RULE_SKIPPED =
  'A declared sharing rule\'s `condition` is compiled where enforcement reads the rule from the registry: ' +
  '`createDeclaredSharingRuleSource` lowers it to a static `criteria` filter with no variables bound. A ' +
  'condition that does not lower is not degraded, partially applied or deferred — the rule is SKIPPED: ' +
  'enforcement never serves it, no `sys_record_share` grant is ever materialised, and the only signal is one ' +
  'WARN line in the log, once per process. An unlowerable condition is never served as a permissive match-all ' +
  '(ADR-0049), so the rule is declared and grants nothing.';

/** Why a grant on the rule's anchor object can be refused outright — the two anchor ids. */
const SHARING_INERT_GRANT =
  '`SharingRuleService.reconcile` hands each matched record to `SharingService.grant`, whose ' +
  '`assertNotInertGrant` pre-flight (ADR-0111 D7) refuses, with SHARING_NOT_ENABLED, a grant no access gate ' +
  'would ever consult. The refusal fails the rule\'s boot backfill and no `sys_record_share` row is ever ' +
  'written. The boot WARN it leaves appears only for a rule whose criteria matched at least one record, so a ' +
  'rule that matches nothing is just as dead and says nothing — which is why the anchor is judged here, on ' +
  'the declaration.';

const SHARING_RULE_UNLOWERABLE_CONDITION_EXPLANATION: RuleExplanation = {
  rule: 'sharing-rule-unlowerable-condition',
  covers: 'why a condition the runtime cannot evaluate grants nothing',
  paragraphs: [
    'A `condition` outside the pushdown subset — a function call such as `has(…)` (correct in an object ' +
      'validation, which is interpreted, and wrong here, where the condition is compiled), arithmetic, a ' +
      'ternary or a related-record path — does not lower. The finding quotes the compiler\'s own refusal.',
    'The lowerable subset is: `==` `!=` `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and the ' +
      'string methods `startsWith` / `endsWith` / `contains` — over SINGLE-column `record.<field>` paths ' +
      '(ADR-0058 D2). Two traps in particular: `has(record.x)` is correct in an object VALIDATION rule, which is ' +
      'INTERPRETED, and wrong here, where the condition is COMPILED — write the null test as ' +
      '`record.x != null`; and a related-record path (`record.account.region`) is a join, which the compiler ' +
      'refuses by design (ADR-0055) — denormalise the value onto this object (a formula/rollup field) and test ' +
      'that column, or share the related object instead.',
    SHARING_RULE_SKIPPED,
    LIST_HOLDING_COMPARISON,
    'A row filter compares one value with one value, so it cannot test membership in a list another column ' +
      'holds: compare with a single-valued column, or with a literal — "one of these values" is ' +
      '`record.status in [\'open\', \'pending\']` — or keep the value the rule keys on in a single-valued ' +
      'field and compare with that.',
    CROSS_CLASS_COMPARISON,
    CROSS_CLASS_LISTING,
    'To keep the rule without a second column, compare with a literal — "one of these values" is ' +
      '`record.status in [\'open\', \'pending\']` — or test a file field with `!= null`.',
    'Such a comparison lowers, so the rule IS served to enforcement, but every criteria query it runs ' +
      'is refused on the SQL drivers (`INVALID_FILTER` / 400: driver-sql refuses the comparison by the ' +
      'columns\' declared types), and `SharingRuleService` reads a refused query as matching no record. No ' +
      '`sys_record_share` grant is ever materialised, at boot or on any later write, and the only signal is a ' +
      'WARN line in the server log. The rule is declared and grants nothing.',
    'A condition that does not parse is not reported here: the expression rule gates the same field with a ' +
      'message written about syntax.',
  ],
};

const SHARING_RULE_RUNTIME_VARIABLE_CONDITION_EXPLANATION: RuleExplanation = {
  rule: 'sharing-rule-runtime-variable-condition',
  covers: 'why a sharing condition cannot read current_user',
  paragraphs: [
    'A criteria sharing rule is MATERIALISED: its registry read compiles one static `criteria` filter per rule and the ' +
      'evaluator writes `sys_record_share` rows from it, so there is no "current user" at compile time and the ' +
      'compiler refuses a `current_user.*` read.',
    SHARING_RULE_SKIPPED,
    'The fix is a different mechanism, not a different spelling, and which one depends on the anchor object\'s ' +
      '`sharingModel`, because the security layers are AND-composed (`getReadFilter` = RLS AND ' +
      'controlled-by-parent AND sharing) and an AND term can only REMOVE rows — it can never add one back.',
    'On `public_read` / `public_read_write` the sharing layer imposes nothing on reads (`buildReadFilter` ' +
      'constrains `private` only), so an RLS policy on a permission set (`rowLevelSecurity[].using`, where ' +
      '`current_user.*` IS resolved) is the right mechanism there: it NARROWS an open baseline, the direction ' +
      'AND can express.',
    'On `private` — including a CUSTOM object that declares no `sharingModel`, which resolves to `private` ' +
      '(ADR-0090 D1) — that same policy CANNOT work: the sharing layer has already withheld the row, and AND-ing ' +
      'a predicate onto it can only withhold more, so the policy lints clean, passes every gate and grants ' +
      'nothing.',
    'The two doors that widen a `private` object for a non-admin principal both key on WHO OWNS the row or on ' +
      'an explicit share row, never on a property of the record: the ADR-0057 D1 depth scopes (`readScope` / ' +
      '`writeScope` on the object permission — `own` | `own_and_reports` | `unit` | `unit_and_below` | `org`), ' +
      'which widen the owner-match to `owner_id IN (…)`; and a `sys_record_share` row, which on this path only a ' +
      'criteria sharing rule writes — this rule. So keep the rule for the part of the predicate that is a ' +
      'property of the RECORD (e.g. `record.stage == \'closed_won\'`) and name the audience through ' +
      '`sharedWith`, which is what the `fix:` line says.',
    'If the audience is genuinely record-relative ("the owner\'s manager", "this record\'s approver"), no ' +
      'mechanism expresses it today: `sharedWith` recipients resolve tenant-wide, so reaching for `position` ' +
      'shares every matched row with EVERY holder of that position (the skip-level, the manager two teams over) ' +
      '— an over-broad grant, not the narrower one you meant. That is a known gap in the platform, not ' +
      'something a different spelling of this rule can close: leave the grant unauthored rather than widening ' +
      'it, and ask for record-relative sharing recipients.',
  ],
};

const SHARING_RULE_OBJECT_NOT_SHAREABLE_EXPLANATION: RuleExplanation = {
  rule: 'sharing-rule-object-not-shareable',
  covers: 'why a rule on a public object reaches externals only',
  paragraphs: [
    'Sharing only ever WIDENS an organization-wide default (OWD) baseline, and for the people who work in the ' +
      'organization a public baseline has nothing left to widen. An object\'s effective sharing model is ' +
      '`public` when it declares `sharingModel: \'public_read_write\'`, or when it declares none and is a ' +
      'system object (`isSystem: true` or a `sys_` name), which ADR-0090 D1 resolves to public. A custom object ' +
      'with no `sharingModel` resolves to private and is not reported.',
    'An EXTERNAL member of the organization (`sys_member.role` exactly `external`: a supplier\'s or a ' +
      'customer\'s portal user) is different. Its baseline on every object is the rows it owns, so a share is ' +
      'how it reaches a record of a public object. `SharingService.grant` therefore admits a grant on such an ' +
      'object for a recipient who is an external member of the record\'s organization, and its ' +
      '`assertNotInertGrant` pre-flight (ADR-0111 D7) refuses everyone else with SHARING_NOT_ENABLED: "\'OBJECT\' ' +
      'has a public sharing model, so a share row on it is consulted only for an external member". The rule\'s ' +
      'pass writes rows for the external recipients it expands to, skips the internal ones, and says so in one ' +
      'line (`note` on the evaluate result, and one log line per pass).',
    'Measured for an internal reader: `buildReadFilter` returns `null` on such an object — NO record-level ' +
      'filter at all — so every member already reads every row, and for them the rule advertises a restriction ' +
      'that does not exist. That is why this is advice and not an error: it is right when the rule\'s audience ' +
      'is external, and only half of what it says when the audience includes staff.',
    'To act on it, decide which half is wrong. If the audience is external — the rule hands a supplier the ' +
      'records it should see — keep it. If the ACCESS is right for staff and the rule names staff, the staff ' +
      'half is dead metadata: narrow the recipients (ADR-0049 enforce-or-remove). If only the named audience ' +
      'should reach these records, staff included, the object\'s OWD is the defect: set ' +
      '`sharingModel: \'private\'` (the owner plus explicit shares) or `\'public_read\'`, and the rule enforces ' +
      'for everyone. Do not re-home the rule onto another public object; that moves the inertness instead of ' +
      'removing it.',
  ],
};

const SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT_EXPLANATION: RuleExplanation = {
  rule: 'sharing-rule-object-controlled-by-parent',
  covers: 'why a rule on a detail object grants nothing',
  paragraphs: [
    'A master-detail DETAIL (`sharingModel: \'controlled_by_parent\'`) has no record-level access of its own: ' +
      'its visibility is DERIVED from its master (ADR-0055), so it holds no shares to widen.',
    SHARING_INERT_GRANT,
    'Here the refusal reads "\'OBJECT\' is controlled by its parent (master-detail); share the master record ' +
      'instead", and the recipients the rule names get whatever the MASTER grants them — which may be nothing. ' +
      'The grant is declared and does not exist.',
    'To fix it, move the rule onto the MASTER object (the one the detail\'s master_detail field names) and ' +
      'share that: the detail rows follow. If the detail is meant to carry a record-level baseline of its ' +
      'own, that is a different decision: change its `sharingModel` to \'private\' (the owner plus explicit ' +
      'shares) or \'public_read\', and the rule becomes enforceable where it stands.',
  ],
};

// ── Flow trigger readiness (the never-fire family) ──────────────────────────
// `validate-flow-trigger-readiness.ts`: five ids whose verdict is settled by a
// contract this repository ships, so no installed package can make the flow
// fire. The engine's routing chain, the record-trigger grammar, the
// time-relative partition and the publish-gate reach are shared, so each is
// written ONCE below and referenced by every entry that needs it. The rule
// file shares its verdict clause the same way (`NEVER_FIRES`).

/** How the engine picks a flow's trigger — the routing chain every flow id reads. */
const FLOW_TRIGGER_ROUTING =
  'The automation engine picks a flow\'s trigger from its start node in one fixed chain ' +
  '(`resolveTriggerBinding`): a `triggerType` starting with \'record-\' routes to the record-change ' +
  'trigger (an array-form `triggerType` holding such a token is routed there too, to be refused); a ' +
  '`config.timeRelative` that is an object routes to the time-relative sweep; a `config.schedule` or ' +
  '`type: \'schedule\'` to the schedule trigger; `type: \'api\'` or `triggerType: \'api\'` to the inbound ' +
  'api trigger. Every test in the chain is a literal string or `typeof` check with no registry lookup, so ' +
  'no installed package can teach the engine a new token, and a flow that matches none of them is a ' +
  'manual flow.';

/** The record trigger's closed token grammar — the two triggerType ids. */
const RECORD_TRIGGER_GRAMMAR =
  'The record-change trigger maps a token to ObjectQL hook events only on the grammar ' +
  'record-{before,after}-{create,insert,update,delete,write}: `insert` is a synonym for `create`, and ' +
  '`write` fires on create OR update in one flow. Any other token maps to no hook event, and there is no ' +
  '"any change" token.';

/** The routing predicate that splits the two time-relative ids. */
const TIME_RELATIVE_PARTITION =
  'The engine routes a flow to the time-relative sweep only when `config.timeRelative` is present and ' +
  '`typeof` says \'object\' (arrays and dates included). The two time-relative ids partition the key\'s ' +
  'values along that predicate, so exactly one of them can fire on a descriptor: ' +
  '`flow-time-relative-descriptor-invalid` for a routed value the descriptor schema refuses, ' +
  '`flow-time-relative-descriptor-unroutable` for a value the engine never routes.';

/** Where the never-fire family gates, and what the runtime door judges — every flow error id. */
const FLOW_GATE_REACH =
  'The finding is an error, so it fails `os validate` and `os build`, and the runtime publish gate ' +
  'refuses an active flow write that carries it. That gate judges only the flow being written, against ' +
  'the findings the stored stack already had, so a dead flow already stored never blocks another flow\'s ' +
  'save; what is refused is the dead flow\'s own publish.';

const FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'flow-time-relative-descriptor-invalid',
  covers: 'why a refused timeRelative descriptor never binds',
  paragraphs: [
    TIME_RELATIVE_PARTITION,
    'The time-relative trigger safeParses the descriptor against `TimeRelativeTriggerSchema` ' +
      '(`@objectstack/spec/automation`) when it binds, and a descriptor the schema refuses is not bound: ' +
      'the sweep is never installed, so the flow declares a time-relative trigger and then never runs. ' +
      'Before this rule the only trace was one warn in the server log at bind time — a channel an ' +
      'authoring loop never reads.',
    'The rule asks that same schema; it restates none of the descriptor\'s contract. The verdict quotes ' +
      'the schema\'s own words for ONE issue — an unrecognized key first, since its rename usually ' +
      'explains the others (a misspelled `field` is also the missing `dateField`) — and counts the rest; ' +
      'the bind-time warn prints the whole list. Each issue is quoted to its verdict: the key or value ' +
      'that is wrong, and the schema\'s rename when it has one.',
    'Two keys the schema answers with a prescription rather than a rename, because each is real one ' +
      'layer out: `schedule` is a sibling of `timeRelative` on the START node\'s `config`, not a key ' +
      'inside it (omitting it means daily at 08:00 UTC), and `runAs` is a FLOW-level key: a sweep has no ' +
      'trigger user, so declare `runAs: \'system\'` beside `nodes` and `edges`.',
    'A descriptor that satisfies `TimeRelativeTriggerSchema` binds, because it is the same schema the ' +
      'trigger safeParses at bind time; an unrecognized key names the declared key it was probably meant to ' +
      'be. The descriptor\'s keys are listed in content/docs/references/automation/time-relative-trigger.mdx.',
    FLOW_GATE_REACH,
  ],
};

const FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE_EXPLANATION: RuleExplanation = {
  rule: 'flow-time-relative-descriptor-unroutable',
  covers: 'why a non-object timeRelative is never routed',
  paragraphs: [
    TIME_RELATIVE_PARTITION,
    'A `config.timeRelative` that is a string, a number, a boolean or a function — `\'daily\'` is the ' +
      'usual one, a cadence written into the descriptor slot — is never routed to the sweep, so the ' +
      'descriptor schema never sees it and the sweep is never installed. A node\'s `config` is an open ' +
      'slot, so the scalar parses everywhere, and nothing at any layer says a word: not the schema, not ' +
      'the engine, not even the one bind-time warn a descriptor that IS an object gets when it is refused.',
    FLOW_TRIGGER_ROUTING,
    'What follows depends on the rest of the start node, so the verdict names it. When the node also ' +
      'declares a trigger the engine does route — a record-change token, a `config.schedule` cadence, the ' +
      'api trigger — the flow fires on THAT trigger\'s terms (once per firing, with no record on the ' +
      'context) instead of once per matching record, and the descriptor is silently dropped. When nothing ' +
      'else declares a trigger the flow binds to nothing and never fires.',
    'A descriptor is an object: `{ object, dateField, and exactly one of withinDays | offsetDays }`, plus ' +
      'an optional `filter` and `maxRecords`. HOW OFTEN the sweep runs is the sibling key ' +
      '`config.schedule` on the same start node, which means daily at 08:00 UTC when omitted, so it is ' +
      'usually left out. The descriptor is `TimeRelativeTriggerSchema`, documented in ' +
      'content/docs/references/automation/time-relative-trigger.mdx.',
    FLOW_GATE_REACH,
  ],
};

const FLOW_TRIGGER_UNROUTABLE_EXPLANATION: RuleExplanation = {
  rule: 'flow-trigger-unroutable',
  covers: 'why a record_change flow with no record token never fires',
  paragraphs: [
    FLOW_TRIGGER_ROUTING,
    'A flow that declares `type: \'record_change\'` has stated its intent, so a start node whose ' +
      '`triggerType` is off that chain (`onCreate`, `on_update`, an empty string) or absent altogether is ' +
      'a defect, not a manual flow: the engine routes it to no trigger, the flow is demoted to a manual ' +
      'one, and it never fires. A plugin cannot rescue it — triggers are registered by the RESOLVED type, ' +
      'and this flow never resolves one.',
    'Nothing names it at run time. The unbound-flow audit resolves the same binding and skips the flow ' +
      'as "manual — nothing to bind", so neither the boot warning nor the startup summary lists it; the ' +
      'only trace is the banner\'s flow count being one higher than its bound count.',
    RECORD_TRIGGER_GRAMMAR,
    'Not reported: a `record_change` flow that ALSO declares something the engine routes ' +
      '(`config.schedule`, `triggerType: \'api\'`) — it binds and fires, on the wrong trigger\'s terms, ' +
      'which is a different defect. A flow that really is launched by hand or from a screen declares ' +
      '`type: \'autolaunched\'` or `\'screen\'`, which have no trigger to be missing.',
    FLOW_GATE_REACH,
  ],
};

const FLOW_TRIGGER_UNKNOWN_EVENT_EXPLANATION: RuleExplanation = {
  rule: 'flow-trigger-unknown-event',
  covers: 'which record trigger tokens fire',
  paragraphs: [
    RECORD_TRIGGER_GRAMMAR,
    'A token that starts with \'record-\' but is off that grammar — a typo (`record-after-updated`), a ' +
      'phase-less noun (`record-change`), a bad phase (`record-during-update`) — is still routed to the ' +
      'record-change trigger, which maps it to no hook event: the flow binds and never fires, with one ' +
      'bind-time warn in the server log as the only trace.',
    'An array-form `triggerType` (`[\'record-after-create\', \'record-after-delete\']`) is a multi-event ' +
      'shape the engine does not support: a start node takes one trigger event, so the flow binds to ' +
      'nothing and never fires. For "created or updated" use `record-after-write`; any other combination ' +
      'is one flow per event. Multi-event arrays are deferred until two independent projects need a ' +
      'combination other than created-or-updated.',
    FLOW_GATE_REACH,
  ],
};

const FLOW_API_TRIGGER_SECRET_MISSING_EXPLANATION: RuleExplanation = {
  rule: 'flow-api-trigger-secret-missing',
  covers: 'why an inbound api flow needs a secret',
  paragraphs: [
    'An inbound api hook is armed only with a per-flow secret that every post is HMAC-verified against ' +
      '(ADR-0041): the `x-objectstack-signature` header carries `t=<unix seconds>,v1=<hex>`, where the hex ' +
      'is the HMAC-SHA256 of `<t>.<raw body>` under the secret, and the door refuses a `t` more than 300 ' +
      'seconds from its own clock, so a captured post stops verifying. A usable secret is a string that is ' +
      'not blank after trimming, on the start node\'s `config.secret`; absent, blank and non-string are one ' +
      'verdict.',
    'A flow that ships in a package names its secret instead of carrying it: `config.secretRef` holds the ' +
      'name the deployment fills (an environment variable of that name in the open tier, or the entry the ' +
      'host\'s credential resolver serves), never in the platform\'s `OS_` namespace and never beside a ' +
      'literal `secret`. The engine reads the name at every post, so the value never appears in the ' +
      'definition or the repository; a post that arrives while the name resolves to nothing is answered ' +
      '503, never verified against nothing.',
    'The automation engine refuses to register a flow bound to the api trigger without one — a ' +
      'hardcoded check in `registerFlow`, before any trigger is consulted and whatever the flow\'s ' +
      '`status` — and the trigger refuses to arm it, so the flow never receives a post. The `/automation` ' +
      'write doors answer 400, and a boot skips the flow with a warning.',
    'Which flows bind the api trigger is the engine\'s answer, not a reading of `type`: the chain ranks a ' +
      'record token, a time-relative descriptor and a schedule ahead of `api`, so a `type: \'api\'` flow ' +
      'whose start node also carries one of those is bound to THAT trigger and needs no secret. The ' +
      'verdict names which declaration binds the flow; the secret\'s value is never printed, only its type.',
    'At the runtime publish gate a signed flow\'s ordinary edit arrives without its secret, because the ' +
      'read path withholds it; the gate passes the positions the stored secret will be restored to, and ' +
      'the rule reads those as present. A secretless api flow is refused there.',
    'A flow that is only ever started explicitly and never receives inbound posts is `type: ' +
      '\'autolaunched\'`, with no `triggerType: \'api\'` on its start node: that flow binds no api trigger ' +
      'and needs no secret.',
  ],
};

// `flow-trigger-unknown-object` lives in the same rule file but is not one of
// the five: its verdict depends on packages a build cannot see, so it warns —
// except under a package closure the runtime publish gate states, where the
// snapshot is that closure and the id refuses.

const FLOW_TRIGGER_UNKNOWN_OBJECT_EXPLANATION: RuleExplanation = {
  rule: 'flow-trigger-unknown-object',
  covers: 'why an unknown trigger object warns, and when it refuses',
  paragraphs: [
    'A record-triggered flow binds an ObjectQL hook filtered to the exact name in its start node\'s ' +
      '`config.objectName`, and a time-relative sweep queries the exact name in `config.timeRelative.object`. ' +
      'Names match exactly — `app_candidate`, not `candidate` — so when no object answers to that name the ' +
      'flow never fires, or the sweep matches nothing, and the runtime says nothing about it.',
    'The rule asks whether this stack defines the object. One it does not define may be declared by ' +
      'another installed package, which a build of this stack cannot see, so the finding is a warning and ' +
      'can be ignored when such a package declares the object; a `sys_` name is a platform object and is ' +
      'not judged. Of the findings that say a flow never fires, it is the only one that stays advisory: ' +
      'the others are settled by contracts this repository ships. At the runtime publish gate a write that ' +
      'names no package gets it as a save advisory, judged against the live object registry.',
    'A write into a package is judged against that package\'s closure instead: its own objects, the objects ' +
      'of the packages its manifest declares in `dependencies`, and platform objects. An object outside it ' +
      'is one the package never declared it may reference, and nothing it installs puts the object in ' +
      'reach until its manifest declares the dependency, so there the finding is an error and the publish ' +
      'is refused, the verdict the dataset and view doors give the same reference. Declare a dependency on ' +
      'the package that defines the object, or trigger the flow on an object inside the closure. A `sys_` ' +
      'name is not judged there either, a draft save is not gated, and a stored flow is judged at its next ' +
      'publish.',
  ],
};

// ── Validation rules that compile at publish time ───────────────────────────
// `validate-rule-compilability.ts` and `validate-rule-schema-formats.ts`: the
// write path's fail-open skip and the runtime's ajv environment are shared,
// so each is written ONCE below. The compile verdicts share their closing
// clause in the rule file (`SKIPPED_ON_EVERY_WRITE`).

/** What the write path does with a rule whose artifact does not compile — the two compile ids. */
const VALIDATION_RULE_FAIL_OPEN =
  'On the write path (`rule-validator.ts`), `checkFormat` builds a `format` rule\'s `regex` with ' +
  '`new RegExp(rule.regex)` and `checkJsonSchema` compiles a `json_schema` rule\'s `schema` with ajv, ' +
  'each inside a `try/catch` whose catch logs "… — skipped" and returns no error. A rule whose artifact ' +
  'does not compile is therefore declared, listed in the metadata and in every listing of what protects ' +
  'the object, and enforces nothing on any record, forever; one WARN line in the server log is the only ' +
  'trace. Both artifacts are static, so the rule refuses them before they ship. Rules nested in a ' +
  '`conditional`\'s `then` / `otherwise` are judged too: they reach the same checks.';

/** The ajv the runtime compiles with, mirrored by the gate — the two `json_schema` ids. */
const RUNTIME_AJV_ENVIRONMENT =
  'The runtime compiles every `json_schema` rule with one shared ajv: `new Ajv({ allErrors: true, ' +
  'strict: false })` plus the `ajv-formats` plugin. The gate builds the same environment (its test pins ' +
  'both halves against `rule-validator.ts`), so it never invents a verdict the runtime does not share: ' +
  '`strict: false` lets an author\'s vendor keywords through, and `ajv-formats` registers the format ' +
  'names and the `formatMinimum` / `formatMaximum` keywords.';

const VALIDATION_RULE_REGEX_UNCOMPILABLE_EXPLANATION: RuleExplanation = {
  rule: 'validation-rule-regex-uncompilable',
  covers: 'what the write path does with a regex that does not compile',
  paragraphs: [
    VALIDATION_RULE_FAIL_OPEN,
    'The pattern is compiled exactly as `checkFormat` compiles it — `new RegExp(source)`, no flags — and ' +
      'the verdict quotes the engine\'s reason; the `fix:` line quotes the source. The source is a STRING, ' +
      'so a backslash in it is written twice in TypeScript.',
    'To fix it, escape a literal `(`, `[` or `\\`: in TypeScript source that is `\\\\(`, `\\\\[` and ' +
      '`\\\\\\\\`, and a pattern such as `^\\d{2}-\\d{7}$` is written `\'^\\\\d{2}-\\\\d{7}$\'`. A rule that only ' +
      'checks a common shape can drop `regex` and name a `format` instead: ' +
      // Held equal to `FormatValidationSchema`'s `format` enum by the rule's test.
      '`email`, `url`, `phone` or `json`.',
  ],
};

const VALIDATION_RULE_JSON_SCHEMA_UNCOMPILABLE_EXPLANATION: RuleExplanation = {
  rule: 'validation-rule-json-schema-uncompilable',
  covers: 'what the write path does with a schema ajv refuses',
  paragraphs: [
    VALIDATION_RULE_FAIL_OPEN,
    RUNTIME_AJV_ENVIRONMENT,
    'Under `allErrors: true` a schema that fails ajv\'s metaschema lists every violation; the verdict ' +
      'quotes the first, which names the offending keyword, and counts the rest.',
    'Each schema is compiled on a fresh instance, so a duplicate `$id` between two deployed rules — an ' +
      'outcome that depends on which schema the runtime happened to compile first — is not judged here. ' +
      'A misspelled `format` name compiles in both environments; that is ' +
      '`validation-rule-json-schema-unknown-format`\'s verdict, not this one\'s.',
    'To fix it, correct the keyword the verdict names. The usual offenders: `type` must be one of ' +
      '`null`, `boolean`, `object`, `array`, `number`, `string` or `integer` (or an array of those), ' +
      '`required` an array of strings, and every `$ref` must resolve. A vendor keyword is fine, because ' +
      'the runtime runs `strict: false`; a MALFORMED standard keyword is not.',
  ],
};

const VALIDATION_RULE_JSON_SCHEMA_UNKNOWN_FORMAT_EXPLANATION: RuleExplanation = {
  rule: 'validation-rule-json-schema-unknown-format',
  covers: 'why an unregistered format name enforces nothing',
  paragraphs: [
    RUNTIME_AJV_ENVIRONMENT,
    'Under `strict: false` an unregistered `format` name is not an error: ajv logs ' +
      '`unknown format "NAME" ignored in schema at path …` once at compile time and DROPS the keyword — in ' +
      'the write path and at the publish gate alike. The schema compiles, the rule ships and runs on every ' +
      'write, its other keywords (`type`, `required`) are enforced, and this constraint is enforced on no ' +
      'record, ever. The record is ACCEPTED, the silent direction, so nothing downstream reports the gap.',
    'The rule\'s registered names are read off a live instance of that ajv, never a list written into the ' +
      'rule, so it follows `ajv-formats` across an upgrade. Names are case-sensitive and hyphenated ' +
      '(`date-time`, not `datetime`); the `fix:` line names the nearest registered one.',
    // Held equal to `registeredFormatNames()` by `validate-rule-schema-formats.test.ts`.
    'The registered names (the default `ajv-formats` set, the one `rule-validator.ts` registers so that a ' +
      '`format` is enforced on every write): binary, byte, date, date-time, double, duration, email, float, ' +
      'hostname, int32, int64, ipv4, ipv6, iso-date-time, iso-time, json-pointer, json-pointer-uri-fragment, ' +
      'password, regex, relative-json-pointer, time, uri, uri-reference, uri-template, url, uuid.',
    'If you meant a constraint ajv has no format for, express it with `pattern` instead: a regex is ' +
      'enforced, an unknown format name is not.',
    'Only positions JSON Schema defines as subschemas are walked (`properties`, `items`, `$defs`, ' +
      '`allOf` / `anyOf` / `oneOf`, `if` / `then` / `else` and the rest), because those are the places ' +
      'ajv applies the keyword; a `format` inside `default`, `const`, `enum` or `examples` is data. A ' +
      'non-string `format` is the compile gate\'s refusal (`validation-rule-json-schema-uncompilable`), ' +
      'not this rule\'s.',
  ],
};

// ── Dataset and cube members the analytics doors refuse ─────────────────────
// `validate-dataset-measure-aggregates.ts`: two ids on one walk. What a
// JSON-stored column is, the cube leg and the shared skips are written ONCE.

/** What "JSON-stored" means — both ids. Held to the spec's three type sets by the rule's test. */
const JSON_STORED_COLUMN =
  'A JSON-stored column is a structured-JSON type — json, composite, repeater, record, location, ' +
  'address, vector — or a multi-value field: an inherently multi option type (multiselect, checkboxes, ' +
  'tags), or a multi-capable type (select, radio, lookup, user, file, image) flagged `multiple: true`. ' +
  'The same multi-capable type without the flag stores one value.';

/** Where the rule reads its columns, and what it never judges — both ids. */
const ANALYTICS_MEMBER_WALK =
  'Dataset measures and dimensions name their column with `field`; authored cubes (`analyticsCubes`) ' +
  'name it with a member\'s `sql`, resolved the way the analytics door resolves it — a hop the cube ' +
  'declares a join for reaches that join\'s object, any other hop is walked on the object graph ' +
  '("joined object" in the verdict), and the row wildcard `\'*\'` names no column. Never judged: an ' +
  'object this stack does not define or that has no readable field map, a path that does not resolve ' +
  '(`dataset-field-unknown` reports it), a leaf with no declared type, and, for a measure, an aggregate ' +
  'outside the table\'s vocabulary. At the runtime publish gate a `dataset` write carries no `analyticsCubes`, so ' +
  'the cube leg speaks on the CLI doors.';

const MEASURE_AGGREGATE_FIELD_TYPE_REFUSED_EXPLANATION: RuleExplanation = {
  rule: 'measure-aggregate-field-type-refused',
  covers: 'which aggregates each field type accepts',
  paragraphs: [
    'A measure pairs an aggregate with a column, and the aggregate × field-type compatibility table ' +
      '(`AGGREGATE_FIELD_TYPE_COMPATIBILITY`, `@objectstack/spec/data`) decides which pairs are coherent. ' +
      'For a refused pair the number a backend returns is a property of the SQL dialect rather than of the ' +
      'data: SQLite coerces a `datetime` column\'s stored text by its leading digits, so `avg` over it ' +
      'returns the average YEAR with no error and no log, while another backend has no such function and ' +
      'fails at query time.',
    // Held equal to `AGGREGATE_FIELD_TYPE_COMPATIBILITY` by `validate-dataset-measure-aggregates.test.ts`.
    'The table\'s rows: `count` accepts every type, because it reads no value; `count_distinct` every ' +
      'type but the JSON-stored ones; `sum`: number, currency, rating, slider, progress, summary, ' +
      'boolean, toggle; `avg`: number, currency, percent, rating, slider, progress, summary, boolean, ' +
      'toggle; `min` and `max`: number, currency, percent, rating, slider, progress, summary, date, ' +
      'datetime, time, boolean, toggle.',
    'So the fix is a field of an accepted type, or an aggregate the field\'s declaration accepts. A ' +
      'quantity that must be added up or averaged has to be STORED as a numeric field and aggregated as ' +
      'one.',
    // Held equal to `VIRTUAL_FIELD_AGGREGATE_REMEDY` (`@objectstack/spec/data`) — the `fix:` line, and
    // the compile leg's remedy, for this pair — by `validate-dataset-measure-aggregates.test.ts`.
    'A `formula` field stores no value, whatever its `returnType` says, so `sum`, `avg`, `min` and `max` ' +
      'over one have no column to read, and a count substituted for the total is a plausible wrong ' +
      'number. Its fix line reads: The field is computed on read and stores no value: store the value as ' +
      'a number field (kept by a hook) and aggregate that. `count` / `count_distinct` answer a different ' +
      'question: how many records.',
    JSON_STORED_COLUMN,
    'The per-type row cannot see `multiple: true`, so `count_distinct` over a multi-capable field ' +
      'flagged that way is refused by the declaration: the value is a list stored as JSON, and ' +
      '`count_distinct` compares values for equality, which no two backends do alike for JSON — one ' +
      'counts every row apart, one compares the serialized text, another has no equality for the type ' +
      'and fails at query time.',
    'The same pair is refused later by the doors the member reaches: a dataset\'s by its compile ' +
      '(`400 DATASET_INVALID`), a cube\'s by the analytics door when a query names the measure ' +
      '(`400 INVALID_FIELD`). This rule makes the same refusal where the author is standing. A dotted ' +
      'path is judged on the leaf\'s own declaration, which the compile leg cannot see.',
    ANALYTICS_MEMBER_WALK,
    'Its advisory neighbour `measure-aggregate-incoherent` judges whether a number MEANS anything, so ' +
      '`sum` over a `percent` field is reported by both: an advisory about meaning, and this refusal ' +
      'about the contract.',
  ],
};

const DIMENSION_JSON_STORED_FIELD_REFUSED_EXPLANATION: RuleExplanation = {
  rule: 'dimension-json-stored-field-refused',
  covers: 'why analytics does not group by a JSON-stored column',
  paragraphs: [
    'A dimension is a GROUP KEY: a dataset dimension compiles to a cube dimension whose `sql` is its ' +
      '`field`, and a query that selects it groups by that column. The analytics door refuses a grouped ' +
      'member whose column is JSON-stored with `400 INVALID_FIELD`, before any SQL is built, because a ' +
      'JSON value is no group key the SQL dialects share: one groups each serialized value apart, another ' +
      'refuses the statement. Every report, dashboard or query that selects the dimension gets that ' +
      'refusal instead of an answer, and no selection of it is served as a group.',
    'For a structured-JSON column, store the part of the document you group on in a field of its own ' +
      'and point the dimension at that field. For a multi-value field, filter by one member instead of ' +
      'grouping: a record query on the field\'s object with `where { FIELD: { $contains: VALUE } }` ' +
      'counts or lists the records that hold VALUE, one query per member.',
    JSON_STORED_COLUMN,
    ANALYTICS_MEMBER_WALK,
  ],
};

// ── React page props (`validate-react-page-props.ts`) ───────────────────────
// Two ids forward `@objectstack/spec`'s own refusal of a chart prop. The
// verdict quotes it to its head — the key or value, and the schema's rename
// (`schemaRefusalHead()`); the shape note below is shared, and each entry
// names the keys its schema answers with a prescription instead.

/** How a forwarded chart-prop refusal is quoted — the two `<ObjectChart>` schema ids. */
const CHART_PROP_REFUSAL =
  'The prop is judged by PARSING its `@objectstack/spec/ui` schema, never by a second copy of its rules, ' +
  'so the vocabulary, the refinements and the unknown-key handling all arrive from the spec. Only a ' +
  'fully static literal is judged: a value built at run time is unknowable here, not wrong. The verdict ' +
  'quotes the schema\'s refusal to its verdict — the key or value that is wrong, and the schema\'s ' +
  'rename when it has one — and leaves out the sentence on why the key used to be dropped silently.';

const REACT_CHART_DRILLDOWN_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'react-chart-drilldown-invalid',
  covers: 'what an ObjectChart drillDown block accepts',
  paragraphs: [
    '`<ObjectChart drillDown={{…}}>` is checked against `ChartDrillDownSchema`, a closed shape. Until it ' +
      'was closed every key inside it, right or wrong, reached the renderer unchecked, and a misspelling ' +
      'was simply ignored at click time.',
    CHART_PROP_REFUSAL,
    'Keys the schema answers with a prescription rather than a rename, because each is real on another ' +
      'surface: `drilldown` (all lowercase) is `ReportSchema.drilldown`, a boolean on a summary or matrix ' +
      'report, while the chart\'s is `drillDown` and takes an object; `mode` is objectui\'s ' +
      '`object-data-table` drill key, and a chart drill is always the filtered-list kind, so delete it; ' +
      '`report` is a metric or pivot widget capability `<ObjectChart>` does not read; `view` and `sort` ' +
      'are declared by objectui\'s renderer-side type and read by no renderer, so delete them.',
  ],
};

const REACT_CHART_AGGREGATE_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'react-chart-aggregate-invalid',
  covers: 'what an ObjectChart aggregate accepts',
  paragraphs: [
    '`<ObjectChart aggregate={{…}}>` is checked against `ChartAggregateSchema`, a closed shape whose ' +
      '`groupBy` is a bare field name or a closed `{ field, dateGranularity?, alias? }`. Until both were ' +
      'closed an undeclared key was dropped at parse: `groupby` for `groupBy` degraded the chart to a ' +
      'single ungrouped point, `fn` for `function` fell back to the default, and `dateGranularty` for ' +
      '`dateGranularity` cost the date bucketing, all with `build` and `validate` green.',
    CHART_PROP_REFUSAL,
    'When no form of a union matches, the verdict keeps the forms whose complaint is about the value\'s ' +
      'content and drops one whose only complaint is that the whole value is another type — for an object, ' +
      'the bare-field-name form\'s "expected string" — unless every form says only that.',
    'Keys the schema answers with a prescription rather than a rename, because each is real one layer ' +
      'out: on the aggregate, `dateGranularity` and `alias` go inside the structured `groupBy`, `filter` ' +
      'and `objectName` are props of the chart itself, and `measures` is the dataset path\'s (an inline ' +
      'aggregate is one function over one field); inside `groupBy`, `function` belongs on the aggregate ' +
      'and a nested `groupBy` is the one you are already in.',
    'Every refusal the schema, the published react-blocks type and objectui\'s renderer agree on is an ' +
      'error. An absent `groupBy` is a warning, and it is a tolerance, not a supported shape: the ' +
      'aggregate returns one ungrouped row and the chart plots a single point; a single number belongs ' +
      'in an object-metric block. It stays a warning rather than an error only because promoting it is its ' +
      'own step.',
  ],
};

const REACT_CHART_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'react-chart-field-unprovisioned',
  covers: 'why a chart over an unprovisioned anchor shows nothing',
  paragraphs: [
    UNPROVISIONED_ANCHOR_CAUSE,
    'An `<ObjectChart>` aggregate whose `field` or `groupBy` names such an anchor reads a column that ' +
      'is empty on every row: grouping by it puts every row into one empty bucket, and aggregating it ' +
      'yields nothing. The query does not fail, so the chart renders and says nothing true.',
    'Only a name that resolved BECAUSE it is injected is judged: an author-declared column of the same ' +
      'name maps a remote column the author vouches for and is never reported. The finding is a warning ' +
      'because the rule cannot see the remote table, only that the platform provisions no storage for ' +
      'the anchor.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

const REACT_BLOCK_NEEDS_RECORD_CONTEXT_EXPLANATION: RuleExplanation = {
  rule: 'react-block-needs-record-context',
  covers: 'why a record block renders empty on a react page',
  paragraphs: [
    'The `record:*` blocks — `<RecordDetails>`, `<RecordHighlights>`, `<RecordRelatedList>`, ' +
      '`<RecordActivity>` and the rest, or `<Block type="record:…">` — render the record that a record ' +
      'page puts in context. A `kind:\'react\'` page never mounts that context, so the block renders ' +
      'empty however it is bound: the renderer does not read its `objectName` or `recordId`.',
    'They were withdrawn from the react tier for that reason, and the finding is an error because no ' +
      'binding makes the block render. A component the page declares itself under the same name ' +
      'shadows the injected one and is not judged. The `fix:` line names the block\'s react-tier ' +
      'replacement, or a record page.',
    'On a react page the record is ordinary React state, so the replacement binds it itself: ' +
      '`<ObjectForm>` by its own `objectName` / `recordId` props, `<ListView>` with the parent binding ' +
      'as an ordinary filter, and a strip or a stage bar by reading the record with ' +
      '`useAdapter().findOne` and laying it out in JSX.',
  ],
};

const REACT_PAGE_SOURCE_UNPARSEABLE_EXPLANATION: RuleExplanation = {
  rule: 'react-page-source-unparseable',
  covers: 'what a react source that does not parse leaves unchecked',
  paragraphs: [
    'A `kind:\'react\'` page\'s source is parsed with TypeScript — never executed — so its component ' +
      'contract can be checked: props, field bindings, chart aggregates. A source with syntax errors is ' +
      'only partially recovered, and the checks read that recovered tree, so a problem in the part the ' +
      'parser could not read is reported by no rule.',
    'It is a warning, not a second syntax verdict. The syntax verdict on a react page is ' +
      '`react-page-syntax`\'s, which transpiles the source with Sucrase, the parser that actually compiles it, ' +
      'and the two parsers accept different sets: an octal literal such as `0755` parses in Sucrase and ' +
      'not in TypeScript, and `with (o) {}` the other way round. Erroring here would fail builds the ' +
      'platform\'s own transpiler accepts.',
  ],
};

// ── List-view sort and search fields (the SORT and SEARCH axes) ─────────────
// `validate-sortable-fields.ts` and `validate-searchable-fields.ts` resolve a
// list view's `sort` and `searchableFields` against one object index, so the
// two axes share their surfaces, their skips and their storage fact.

/** Which declarations the two axes judge, and where they stop (both write it out). */
const LIST_VIEW_FIELD_SKIPS =
  'Not judged, so a miss is never a false finding: an object this stack does not define (it may ' +
  'come from another package), an object with no authored field map (an ADR-0015 external object ' +
  'or an introspected datasource), and a registry-injected system column such as `created_at`, ' +
  'which exists at runtime but is never in authored `fields` — whose one question, on an external ' +
  'object, is the matching `*-unprovisioned` warning\'s.';

/**
 * The storage fact behind the two virtual-entry ids (`sort-field-unsortable`,
 * `searchable-field-unsearchable`). The rule files share its verdict clause,
 * `virtualFieldClause()`.
 */
const VIRTUAL_FIELD_STORAGE =
  'A `formula` field\'s value is computed on read and never stored, so no driver materializes a ' +
  'column for it. Virtuality is judged by the spec\'s storage predicate (`isVirtualSearchField`, ' +
  '`SEARCH_VIRTUAL_TYPES`: `formula` alone), the one the REST ingress and the engine read, so the ' +
  'linter and the runtime cannot disagree. `summary` and `autonumber` are not judged: they are ' +
  'stored (the engine maintains the one and assigns the other), and the spec\'s ' +
  '`COMPUTED_VALUE_TYPES` that groups them with `formula` is the write contract, not a storage ' +
  'fact.';

/** What a list view's `searchableFields` becomes at request time (the three search ids). */
const SEARCH_FIELDS_ECHO =
  'A list view\'s `searchableFields` narrows the object\'s searchable set (ADR-0061): clients echo ' +
  'it verbatim as the `$searchFields` override on every toolbar search, and the REST ingress ' +
  '(`assertSearchFieldsAreSearchable`) refuses an entry outside the object\'s allowed set with ' +
  '`400 INVALID_FIELD` — the whole toolbar search, for every role. A `<ListView searchableFields>` ' +
  'prop on a react page is judged by the same core. The object\'s own `searchableFields` is the ' +
  'canonical set.';

const SORT_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'sort-field-unknown',
  covers: 'why an unknown sort field breaks the whole view',
  paragraphs: [
    'A list view\'s `sort` is the ORDER BY its FIRST fetch carries. A name that is not a field of ' +
      'the bound object is refused at the REST ingress (`assertSortFieldsExist`), not dropped: every ' +
      'load of the view answers `400 INVALID_SORT`, and the cause is an authoring typo made long ' +
      'before. `ListViewSchema.sort` types the name as a bare string, so the parse cannot see it.',
    'The name is judged on its HEAD segment, as the ingress gate judges it, so the two agree about ' +
      'which names are unknown; a dotted name with a known head passes here and is refused at request ' +
      'time, because `sort` reaches only the object\'s own columns.',
    'Walked: an object\'s built-in `listViews`, a `defineView` aggregate\'s `list` and `listViews`, a ' +
      'flattened list overlay (a `views[]` entry with `viewKind: \'list\'`, the shape ' +
      '`PUT /api/v1/meta/view` carries) and a ViewItem record\'s `config`. A report\'s ordering, a ' +
      'dashboard widget\'s `sortBy` and flow nodes have no field-name sort to judge here.',
    LIST_VIEW_FIELD_SKIPS,
  ],
};

const SORT_FIELD_UNSORTABLE_EXPLANATION: RuleExplanation = {
  rule: 'sort-field-unsortable',
  covers: 'why a formula field cannot be sorted by',
  paragraphs: [
    VIRTUAL_FIELD_STORAGE,
    'Measured before the runtime refused it: an ORDER BY over a formula returned \'asc\' and \'desc\' ' +
      'in byte-identical row order, carrying the very values it was asked to order by, unordered, ' +
      'under a success. Both runtime doors now refuse it with `400 INVALID_SORT` — the REST ingress ' +
      '(`assertSortFieldsExist`) and the engine (`assertOrderByIsMaterializable`) — so the declaration ' +
      'breaks the view\'s first fetch, and every fetch after it.',
    LIST_VIEW_FIELD_SKIPS,
  ],
};

const SORT_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'sort-field-unprovisioned',
  covers: 'why sorting by an unprovisioned anchor loses the order',
  paragraphs: [
    UNPROVISIONED_ANCHOR_CAUSE,
    'Measured on a federated object over a real remote table: the ORDER BY reaches the driver, finds ' +
      'no column and is dropped, so \'asc\' and \'desc\' return byte-identical row order under a 200 ' +
      'while the same query on a real column reverses. Unlike the two other sort ids nothing refuses ' +
      'it — the REST ingress and the engine judge only `formula` — so the view\'s first fetch and every ' +
      'fetch after it answer in an arbitrary order, which `limit` / `offset` then slice into an ' +
      'arbitrary page.',
    'Only an undotted name that resolved BECAUSE it is injected is judged: an author-declared column ' +
      'of the same name is one the author vouches for, and a dotted sort name is refused by the ' +
      'ingress gate on its own. The rule is a warning because it cannot see the remote table, only ' +
      'that the platform provisions no storage.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

const SEARCHABLE_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'searchable-field-unknown',
  covers: 'what a stale searchableFields entry does',
  paragraphs: [
    '`searchableFields` is an array of bare strings on the object and on a list view, so the parse ' +
      'never checks that an entry resolves. The engine tolerates a stale one — `resolveSearchFields` ' +
      'filters the declaration down to fields that exist — and that tolerance hides it: with some ' +
      'entries stale, search scans a narrower set than declared and a record that should match does ' +
      'not; with every entry stale, resolution falls through to the AUTO-DEFAULT set, which the ' +
      'author never wrote.',
    SEARCH_FIELDS_ECHO,
    'A dotted entry is judged too, unlike in other field rules: search matches the field map by exact ' +
      'string, so `owner_id.name` is dropped exactly like a typo.',
    LIST_VIEW_FIELD_SKIPS,
  ],
};

const SEARCHABLE_FIELD_UNSEARCHABLE_EXPLANATION: RuleExplanation = {
  rule: 'searchable-field-unsearchable',
  covers: 'which searchableFields entries the runtime refuses',
  paragraphs: [
    SEARCH_FIELDS_ECHO,
    // Held equal to `SEARCHABLE_TEXTUAL_TYPES` + `SEARCHABLE_ENUM_TYPES` by the rule's tests.
    'The allowed set is computed by the function the ingress and the engine consult ' +
      '(`resolveSearchFieldResolution`): the object\'s declared `searchableFields` when it declares ' +
      'them, otherwise the AUTO-DEFAULT set — its text-like columns (text / email / phone / url / ' +
      'autonumber / textarea / markdown / select), never a system/audit column or a hidden field. A ' +
      '`lookup` or `master_detail` column stores only the referenced record\'s id, so it is never a ' +
      'keyword target: to search by the related record\'s title, mirror it onto a stored text field ' +
      'and declare that. Declaring `searchableFields` on the object chooses its set explicitly, and a ' +
      'view then narrows that set, never widens it (ADR-0061). The verdict quotes at most three names ' +
      'of a declared set.',
    VIRTUAL_FIELD_STORAGE,
    'A formula entry is refused on EVERY surface, the object\'s own set included — the REST ingress ' +
      'answers `400 INVALID_FIELD`, the same answer a stale entry gets: measured, it ' +
      'matched 0 rows on driver-memory, and 0 rows with no error on driver-sql. Otherwise the ' +
      'object\'s own `searchableFields` is existence-only: its declared branch scans any stored ' +
      'column, so a json or lookup column declared there is a narrow choice the engine executes, not ' +
      'a finding. A system column outside the allowed set is not judged either: its runtime ' +
      'metadata is registry-owned and invisible here.',
  ],
};

const SEARCHABLE_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'searchable-field-unprovisioned',
  covers: 'why searching an unprovisioned anchor matches nothing',
  paragraphs: [
    UNPROVISIONED_ANCHOR_CAUSE,
    'Existence says yes — the anchor is a registry-injected column — so the entry survives into the ' +
      'resolved allow-list. On a list view it is echoed as the `$searchFields` override, so every ' +
      'toolbar search on the list scans a column that is empty on every record: it reads as search ' +
      'coverage and matches nothing. On the object\'s own set, search scans it on every record and ' +
      'never matches, so the searchable set is narrower than it declares — and if it is the only ' +
      'entry that resolves, the set scans nothing at all.',
    'Only a name that resolved BECAUSE it is injected is judged: an author-declared column of the ' +
      'same name is one the author vouches for. The rule is a warning because it cannot see the ' +
      'remote table, only that the platform provisions no storage.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

// ── Metadata-form predicate paths (`validate-predicate-path-refs.ts`) ───────
// A metadata-editing form's `visibleWhen` predicate, judged against the schema
// of the metadata type the form edits; the three ids share the scope.

/** Which predicates the three ids judge, and the oracle they ask (all three). */
const PREDICATE_FORM_SCOPE =
  'Judged: the `visibleWhen` predicates on a metadata-editing form — a `views[]` ' +
  'form, its default `form` or a `formViews` entry whose data source is `{ provider: \'schema\', ' +
  'schemaId }` — on its sections and fields, nested repeater rows included, where `data` is rebound ' +
  'to the ROW. A path is resolved against the Zod schema of the metadata type the form edits ' +
  '(`getMetadataTypeSchema(schemaId)`, the entry `saveMetaItem` validates the saved row against), ' +
  'never asked of CEL. A form bound to an ObjectQL object (`record.*`) is not judged: lookup ' +
  'traversal, injected columns and formula outputs leave that set open, and an error-level gate ' +
  'over an open set refuses good metadata.';

/** What a predicate that resolves to nothing does in the console (the two resolution ids). */
const PREDICATE_FAIL_OPEN =
  'A reference that resolves to nothing makes the predicate unevaluable, and the console\'s ' +
  'evaluator then fails OPEN — its settled behaviour: the element renders unconditionally, ' +
  'pixel-identical to one carrying no predicate at all, so nothing tells the author the condition ' +
  'is dead.';

const PREDICATE_PATH_UNRESOLVED_EXPLANATION: RuleExplanation = {
  rule: 'predicate-path-unresolved',
  covers: 'how a predicate path is resolved, and where it stops',
  paragraphs: [
    PREDICATE_FAIL_OPEN,
    'Every reference must resolve against the schema the form edits. A `data.`-rooted path is walked ' +
      'segment by segment through that schema; the first segment it does not declare at that point is the ' +
      'verdict, and the `fix:` line names the nearest declared key, or up to twelve of the keys declared ' +
      'there. The syntax rules cannot see this: `data.tpye == \'formula\'` parses, is rooted, and is ' +
      'rooted on the right root.',
    PREDICATE_FORM_SCOPE,
    'Where the walk stops — a missed catch, never a false error: a scope that is not key-bearing (a ' +
      'record map\'s values, `unknown`, `any`, an array reached by `.`), below which nothing is ' +
      'judged; a record map\'s KEY segment (`data.fields.acme` accepts any `acme`); index access ' +
      '(`data.x[\'y\']`); a predicate that does not parse (`visibility-predicate-syntax` reports it); ' +
      'and a `schemaId` that resolves to no schema.',
  ],
};

const PREDICATE_PATH_UNROOTED_EXPLANATION: RuleExplanation = {
  rule: 'predicate-path-unrooted',
  covers: 'why a bare schema key in a form predicate never matches',
  paragraphs: [
    'A metadata-editing form binds the row under edit as `data`, at every depth — inside a repeater ' +
      '`data` is the ROW, still spelled `data`: there is no implicit row scope — and never flattens its ' +
      'values to top level. A bare identifier that IS a key of the edited schema is that key with its ' +
      'root dropped: it resolves to nothing.',
    PREDICATE_FAIL_OPEN,
    'Narrower than `visibility-bare-identifier` on purpose: the schema-key membership makes the ' +
      'verdict unambiguous, and it reaches an identifier CEL itself declares, such as `type`, which ' +
      'the strict CEL checker reports as an overload rather than an unknown variable. Not reported: a ' +
      'comprehension-macro variable (`data.tags.all(t, …)`), and a word used only as the bare right ' +
      'operand of `==` / `!=`, which is `predicate-rhs-path-shaped`\'s literal slot.',
    PREDICATE_FORM_SCOPE,
  ],
};

const PREDICATE_RHS_PATH_SHAPED_EXPLANATION: RuleExplanation = {
  rule: 'predicate-rhs-path-shaped',
  covers: 'why the right side of == or != is a literal',
  paragraphs: [
    'The metadata-admin evaluator resolves the LEFT side of `==` / `!=` as a path and hands the RIGHT ' +
      'side to its literal parser, which returns anything it does not recognise as a literal ' +
      'verbatim. So `data.a == data.b` compares `data.a` against the string "data.b": it is FALSE ' +
      'however equal the two values are — an `==` written this way hides the element on every row — ' +
      'and `data.a != data.b` is correspondingly TRUE. The supported subset is `path == \'literal\'` ' +
      'and `path != \'literal\'`, nothing wider, and the evaluator says so only in a development build.',
    'Two severities under one id. A dotted chain is an error: nobody writes one meaning its text, so ' +
      'there is no reading under which it worked. A bare word (`status == active`) is a warning: it ' +
      'compares as the text today, which is usually what was meant, but it is outside the subset and ' +
      'breaks when this surface moves to the real CEL evaluator, where a bare `active` is an ' +
      'undeclared reference.',
    'The bare word also reads as a `data.` root someone dropped, so the finding carries both ' +
      'readings and the `fix:` line names both spellings: quote the word (`== \'active\'`), which is ' +
      'what the surface renders today and so changes no behaviour, or move the field to the LEFT with a ' +
      'literal on the right (`data.active == \'yes\'`). Adding the root in place (`== data.active`) ' +
      'is not one of them: it is a path on the right, this id\'s error arm, parsed as the literal string ' +
      '"data.active" and so FALSE on every row. There is no spelling that compares two paths here. For ' +
      'that one position `visibility-bare-identifier` and `predicate-path-unrooted` stand down, so the ' +
      'author gets one prescription rather than three contradicting ones.',
    'The right-hand grammar is the console\'s own path-shaped-literal pattern, so the producer and the ' +
      'renderer refuse and warn about the same set; `true`, `false`, `null`, numbers and quoted strings ' +
      'are literals and never reported. The check asks about a POSITION, not a resolution, so it runs ' +
      'even where the form\'s schema is unknown.',
  ],
};

// ── List-view bulk dispatch (`validate-action-dispatch-contract.ts`) ────────

const ACTION_DISPATCH_CONTRACT_MISMATCH_EXPLANATION: RuleExplanation = {
  rule: 'action-dispatch-contract-mismatch',
  covers: 'how the two bulk wirings call an action',
  paragraphs: [
    'A list view can wire one declared action two ways, and they hand the same body OPPOSITE input. ' +
      '`bulkActions: [\'NAME\']`, the bare-string form, is `execution: \'perRecord\'`: the renderer ' +
      'promotes the action to a def and dispatches it ONCE PER selected row, each call carrying that ' +
      'row\'s `recordId` and no `_selectedIds`. A `bulkActionDefs` entry with ' +
      '`execution: \'aggregate\'` dispatches ONCE for the whole selection, with every selected id in ' +
      '`params._selectedIds` and no `recordId`.',
    'Wired against its declaration, a body misreads its input in silence: one written for the ' +
      'aggregate call reads `_selectedIds` as `undefined` on every per-row call, falls through to its ' +
      'single-record branch and reports success for one row of the selection; one written per record ' +
      'finds no `recordId` on the single aggregate call and throws its own "nothing selected", which ' +
      'reads like a selection bug rather than a wiring one.',
    'Nothing refuses it at runtime: `recordId` and `_selectedIds` are both builtin action params ' +
      '(ADR-0104), so the strict params gate admits either bag, and no single parse sees both ends — ' +
      'the wiring lives on the view, the declaration on the action. The verdict names both contracts ' +
      'because the fix is a choice between them.',
    'To fix it, pick the contract the body is actually written for and make both ends say it: change the ' +
      'action\'s `execution` to the wiring\'s when the body was written for the wiring, or rewire the view ' +
      'to the declaration when it was written for the declaration. If the two wirings are both wanted, ' +
      'they are two actions: one call and N calls have different side effects, which is why the platform ' +
      'will not silently unify them.',
    'Not reported: an action that declares no `execution` (undeclared is not defaulted to either ' +
      'contract; the ADR-0087 migration `action-bulk-dispatch-contract-undeclared` derives ' +
      'declarations where a wiring is unambiguous); a name declared with different contracts, or ' +
      'declared in one place and undeclared in another, anywhere in the stack\'s one action namespace; ' +
      'an `update` / `delete` def or a hand-inlined `actionDef`; and a name that resolves to no action ' +
      '(`action-name-undefined`).',
  ],
};

// ── Page component types (`validate-component-types.ts`) ────────────────────

const COMPONENT_TYPE_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'component-type-unknown',
  covers: 'which component types the platform vocabulary closes',
  paragraphs: [
    '`PageComponentSchema.type` accepts a standard component type or any string, so an arbitrary ' +
      'string parses — on purpose: plugin widgets (`mcp:connect-agent`), kebab SDUI blocks (`flex`, ' +
      '`page-header`) and dot shapes (`custom.widget`) depend on that open arm. What it also ' +
      'swallowed was a typo inside the spec\'s OWN namespaces: `global:serch` validated clean on every ' +
      'authoring command, and the console drew the component-placeholder scaffold in front of the end ' +
      'user.',
    'So a `type` inside a namespace the standard vocabulary populates (derived from the enum, never ' +
      'restated) must be a type the spec answers for — an enum member, a `ComponentPropsMap` row or a ' +
      'registered string-arm type — and the verdict names the closest declared spellings. A type ' +
      'outside those namespaces is untouched. It was an error from birth because the in-repo page ' +
      'corpus was measured clean first. A source-authored (`kind: \'react\'`) page is not walked.',
    'A custom component registered by your own plugin belongs in its own namespace (`my-plugin:…`), so it ' +
      'cannot be mistaken for platform vocabulary: a reserved namespace is closed to it.',
    'A RETIRED type (`RETIRED_PAGE_COMPONENT_TYPES`) is reported by exact name, before the namespace ' +
      'check, because a retirement can take its namespace with it: `user:profile` was the `user:` ' +
      'namespace\'s only member. The verdict quotes the head of the retirement\'s prescription and the ' +
      '`fix:` line its "delete the …" sentence; the page cannot validate or publish while the node is ' +
      'present. The whole prescription — what replaces the type, or that nothing does — is the parse door\'s ' +
      'refusal of the same name, which `os validate` and `os build` print, and the kept ' +
      '`ComponentPropsMap` row carries it too: one copy, never restated here.',
  ],
};

// ── Page component props and print pages (`validate-component-props.ts`, `validate-print-page-blocks.ts`) ──

const COMPONENT_PROPS_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'component-props-invalid',
  covers: 'why a page component\'s props are refused',
  paragraphs: [
    'A page component\'s `properties` is an untyped bag at the parse, and the renderer spreads whatever ' +
      'it carries. Each type\'s typed props schema is its row in `ComponentPropsMap` ' +
      '(`@objectstack/spec/ui`), and this rule judges the bag against that row: a value the schema ' +
      'rejects is refused at the value\'s own path, and the verdict carries the schema\'s own account of ' +
      'what it expected. A key the schema does not declare at all is `component-props-unknown-key`\'s ' +
      'finding, not this one.',
    'It is an error on every authoring door — `os validate`, `os build`, `os lint` and the metadata ' +
      'save door (Studio, REST, MCP), judged page by page — so the stack does not pass and the page does ' +
      'not save until its props are ones the schema accepts. A stored page keeps loading and serving: ' +
      'only its next save is judged.',
    'The fix belongs to the PAGE in almost every case: write the value the verdict asks for. Correct ' +
      'the schema instead only when the component really does honour what is written — then the ' +
      'declaration is what is wrong, and the change makes the declaration and the renderer agree.',
    'Two verdicts of this id carry their own fix. A RETIRED key is refused with its retirement\'s ' +
      'prescription, and the fix is the rename or removal it names, never a schema change: the props ' +
      'schema keeps a retired key only to refuse it, so re-declaring it would undo the retirement. And a ' +
      'block that reads its records from the node-level `dataSource` binding (`element:record_picker`, ' +
      '`element:number`, `element:repeater`) must name its object there — `dataSource: { object: NAME }`, ' +
      'a sibling of `type`, not a key inside `properties`, where a flat `object` is retired and read by ' +
      'nothing.',
  ],
};

const PRINT_PAGE_BLOCK_UNPRINTABLE_EXPLANATION: RuleExplanation = {
  rule: 'print-page-block-unprintable',
  covers: 'which blocks a print page may hold',
  paragraphs: [
    'A page that declares `print` is a document, and a document prints only what it draws in full. So ' +
      'every block in it, at any depth — every region, a container\'s `children`, a card\'s `footer`, a ' +
      'tab or accordion panel — must come from the printable block subset the spec declares ' +
      '(`PRINTABLE_PAGE_COMPONENT_TYPES`, `@objectstack/spec/ui`). The subset is an allow list: a type ' +
      'the platform vocabulary does not declare at all, such as a plugin widget or an SDUI layout block, ' +
      'is refused too, because nothing answers for how it prints.',
    // Held equal to `PRINTABLE_PAGE_COMPONENT_TYPES` (`@objectstack/spec/ui`) by the rule's test.
    'The printable blocks: `page:section`, `page:card`, `page:footer`, `record:details`, ' +
      '`record:highlights`, `record:line_items`, `element:text`, `element:image`, `element:divider`, ' +
      '`element:definition-list`, `element:repeater`, `element:number`, `object-metric`.',
    'Every other declared type is refused for one of three reasons, and the verdict names the one for ' +
      'the block it reports: the block draws a window of its rows (a page, a `limit`, the nodes a viewer ' +
      'expanded), so a printed copy carries only part of the data; it lays itself out to the screen ' +
      '(docked panels, boards, canvases sized to the viewport); or it has no printable content of its ' +
      'own (a control, an input, shell chrome, a panel switcher, per-viewer state). A retired type is ' +
      'refused by name at the parse and reported by `component-type-unknown`, not here.',
    'It is an error on every authoring door — `os validate`, `os build`, `os lint` and the metadata ' +
      'save door (Studio, REST, MCP) — so the page does not validate or save until the block is ' +
      'replaced with a printable one or removed. A page that is not a document should not declare ' +
      '`print`: delete the declaration and the subset no longer applies.',
  ],
};

// ── Filter comparands (`validate-preset-comparands.ts`) ────────────────────

const FILTER_PRESET_COMPARAND_EXPLANATION: RuleExplanation = {
  rule: 'filter-preset-comparand',
  covers: 'where a date-range preset name is understood',
  paragraphs: [
    'The 13 dashboard date-range presets (`last_30_days`, `this_quarter`, …) are real names only in ' +
      'the dashboard date-filter positions — `dateRange.defaultRange` and a date global filter\'s ' +
      '`defaultValue` — where the console lowers them to `{date-macro}` bounds before any query. As a ' +
      'bare filter comparand nothing resolves them: a declared `date` / `datetime` field refuses the ' +
      'query at the engine (`INVALID_FILTER`, 400), and any other column compares the literal string. ' +
      'Measured before the refusal: `$gte "last_30_days"` answered 200 with 0 rows where ' +
      '`{30_days_ago}` found 38.',
    'Two arms. An ordering position — `$gt` / `$gte` / `$lt` / `$lte`, a `$between` endpoint, and ' +
      'their infix and view-rule spellings — is refused on any column: an ordered comparison against a ' +
      'preset name has no legitimate reading. An equality or membership position — bare, `$eq` / ' +
      '`$ne`, `$in` / `$nin` and their spellings — is refused only on a declared `date` / `datetime` ' +
      'field, because a picklist column may store a value named like a preset. A bare value is ' +
      'reported under the operator it lowers to, `$eq`.',
    'The fix is the preset\'s `{date-macro}` window, which the verdict names — ' +
      '`{ $between: [START, END] }`, its first day through its last, and a rolling preset\'s last day ' +
      'is `{today}` — or an ISO date. The schema ' +
      'door refuses the Mongo-shape ordering positions too, with the whole explanation in its ' +
      'refusal; this rule also reaches view filter rules and filter-array triples, which no condition ' +
      'parse touches, and is the one door for the equality arm.',
    'Not judged: a filter no ancestor binds to an object, an object or dataset the stack does not ' +
      'declare, a `time` field, and a field the object does not declare (the `*-filter-field-unknown` ' +
      'rules\' finding).',
  ],
};

// ── Filter placeholders (`validate-filter-tokens.ts`) ──────────────────────

const FILTER_TOKEN_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'filter-token-unknown',
  covers: 'which placeholders a filter value resolves',
  paragraphs: [
    'A filter value travels as JSON, so a user- or time-scoped filter writes a placeholder that is ' +
      'resolved just before the query: `{ owner_id: \'{current_user_id}\', created_at: { $gte: ' +
      '\'{week_start}\' } }`. Only a whole-string placeholder counts (`{token}`, or `${token}`); a value ' +
      'that merely contains braces is left alone.',
    // The context tokens are held equal to `CONTEXT_TOKENS` (`@objectstack/spec/data`) by the rule's test.
    'Exactly two vocabularies resolve in a filter value. The context tokens: `{current_user_id}`, ' +
      '`{current_org_id}`. The date macros: the instants `{today}`, `{yesterday}`, `{tomorrow}` and ' +
      '`{now}`; the start and end of the current, last or next week, month, quarter or year ' +
      '(`{current_quarter_start}`, `{last_year_end}`), with bare aliases for the current period ' +
      '(`{week_start}`, `{month_end}`); and counted offsets in minutes, hours, days, weeks, months or ' +
      'years (`{30_days_ago}`, `{2_weeks_from_now}`).',
    'Anything else does not resolve: the data engine refuses the query (`FILTER_TOKEN_UNKNOWN`, 400) ' +
      'rather than compare the placeholder as a literal string, so the surface never shows the data the ' +
      'filter meant. The rule makes that an error at build time, where an author — or an AI correcting ' +
      'from `os validate` — sees it before anyone opens the surface. A near miss spelled the way ' +
      'another part of the platform spells it (`{current_user}`, `{user_id}`, ' +
      '`{current_organization_id}`) gets a "Did you mean" naming the token meant. A literal value that ' +
      'really looks like a placeholder cannot be filtered on: rename the value.',
    'The record-context token `{record_id}` is the id of the record a `type: \'record\'` page shows, ' +
      'so it resolves only in a filter on a component of such a page. Every other surface this rule ' +
      'walks — list views and the rest of an object definition, dashboard widgets, reports, datasets, ' +
      'apps, and `home`, `app`, `utility` and `list` pages — has no record in context, and there the ' +
      'server refuses the query rather than count every record or none. Move the filter onto a record ' +
      'page\'s component, filter on a concrete id, or scope to the signed-in user with ' +
      '`{current_user_id}`.',
    'Walked: the `filter`, `filters` and `runtimeFilter` subtrees of dashboards, objects, views, ' +
      'reports, datasets, pages and apps. Not walked: navigation `recordId` and `params`, which resolve ' +
      'the app-context selector vocabulary, not a filter\'s.',
  ],
};

// ── Approval approvers (`validate-approval-approvers.ts`) ───────────────────

/**
 * How an operator populates `sys_user.manager_id` — the `manager` arm's
 * remedy, which its `fix:` line printed whole until it became one line. The
 * measurement behind each graded route is the docblock above `MANAGER_ONLY_FIX`
 * in `validate-approval-approvers.ts`; this is the one printed copy.
 */
const MANAGER_ONLY_REMEDY =
  'sys_user.manager_id is not a profile column — the data API\'s managed-update whitelist is ' +
  '{name, image, locale} and the column is readonly on the user form, so it is never populated by ' +
  'editing the user in the Console. It has a dedicated admin operation instead: a platform admin ' +
  'uses Set Manager (Setup → Users, from the user\'s row menu or record header) or POSTs ' +
  '{ userId, managerId } to /api/v1/auth/admin/set-user-manager, with managerId set to null ' +
  'to clear the link.';

/** The routes an operator can actually take, GRADED — the paragraph after {@link MANAGER_ONLY_REMEDY}. */
const MANAGER_ONLY_ROUTES =
  'That endpoint is the route this platform gives you, and it refuses a link that would make a ' +
  'user their own manager, close a cycle, run past the chain depth cap, or point across an ' +
  'organization boundary. For many users at once, the admin bulk import ' +
  '(POST /api/v1/auth/admin/import-users) reads a manager_id column holding the manager\'s ' +
  'email address, or phone number where phone sign-in is enabled — someone in the same file or ' +
  'an existing user — and links each row once every row in the file exists, through those same ' +
  'refusals; a link it cannot make is reported on that row\'s manager result and never fails the ' +
  'user it imported. The column is also written by a seed, or by any other system-context ' +
  'write, which bypasses the managed-update whitelist. SCIM provisioning and directory sync can ' +
  'populate it too, but only through a provisioning path your own deployment supplies: this ' +
  'platform declares the SCIM \'manager\' attribute without projecting it onto the column — and ' +
  'where an identity carries source \'idp_provisioned\' the admin operation refuses, the import\'s ' +
  'manager_id column included, leaving that directory the one surface that authors its ' +
  'manager. Or declare onEmptyApprovers: \'fallback\' on the node, with a ' +
  'fallbackApprovers list: an empty manager rung then opens the request on those people instead ' +
  'of on the organization\'s administrators, which needs no write to the column at all.';

const APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY_EXPLANATION: RuleExplanation = {
  rule: 'approval-approvers-may-resolve-empty',
  covers: 'why an all-group or all-manager slate can stall',
  paragraphs: [
    'An approval node opens its request on the people its approvers expand to at runtime. When ' +
      'EVERY approver on the node routes to a group whose membership is runtime data — a ' +
      '`position`, a `team` or a `department` — and none is staffed, no person the node names can ' +
      'act. Under the default `onEmptyApprovers: \'admin_rescue\'` the request then opens on the ' +
      "organization's administrators (the people holding its organization-admin capability) " +
      'instead, and under the default `lockRecord: true` the record stays locked until one of them ' +
      'decides. Declare `onEmptyApprovers: \'fallback\'` with a `fallbackApprovers` list to name who ' +
      'decides instead; only an organization with no administrator leaves the request on an empty ' +
      '`pending_approvers` slate, for a platform administrator\'s override. An approver of any ' +
      'other type on the node is a non-group route, so a mixed slate is not judged.',
    'The `manager` arm reaches the same empty slate with a cause the flow cannot repair. ' +
      '`{ type: \'manager\' }` resolves from `sys_user.manager_id` of the user the record names ' +
      '(the field `value` names, else the owner), and returns nobody where that column is unset; a ' +
      'static check cannot read that column, so this does not assert the slate IS empty — it reports ' +
      'that nothing else on the node can approve if it is. The arm fires only when the whole slate ' +
      'is `manager` rungs, so no node draws both arms, and a slate mixing groups and `manager` is ' +
      'silent.',
    'One fact in the stack silences the `manager` arm: a seed row of `sys_user` carrying a ' +
      'non-empty `manager_id`, which shows the stack populates the column. Declaring ' +
      '`onEmptyApprovers: \'fallback\'` does not silence it, because a `fallbackApprovers` list can ' +
      'itself resolve to nobody, which a static check cannot see either. The runtime publish gate ' +
      'carries no seeds, so a Studio publish of a manager-only flow draws the advisory however the ' +
      'users are wired.',
    'Both arms are `info`: staffing and the manager column are runtime data a linter cannot see, so ' +
      'the rule flags the SHAPE, and an `info` finding never blocks a build or a publish.',
    'For the group arm: make sure at least one target is always staffed, or add a guaranteed-staffed ' +
      'approver entry, e.g. { type: \'org_membership_level\', value: \'owner\' }, or declare ' +
      'onEmptyApprovers: \'fallback\' with a fallbackApprovers list to name who decides when the ' +
      'groups come back empty.',
    MANAGER_ONLY_REMEDY,
    MANAGER_ONLY_ROUTES,
    'For either arm, a slate that still names no one opens on the organization\'s administrators under ' +
      'the default `onEmptyApprovers: \'admin_rescue\'` (the first paragraph), and declaring ' +
      '`onEmptyApprovers: \'fallback\'` with a `fallbackApprovers` list names who decides instead.',
  ],
};

const APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER_EXPLANATION: RuleExplanation = {
  rule: 'approval-approver-not-membership-tier',
  covers: 'what an org_membership_level approver resolves against',
  paragraphs: [
    '`org_membership_level` — and `role`, its deprecated spelling — resolves against the ' +
      'better-auth org-membership tier a member holds (`sys_member.role`), never against positions. ' +
      'The vocabulary is closed and framework-owned (ADR-0108): the tiers the verdict lists are ' +
      'read from `@objectstack/spec`\'s `BUILTIN_MEMBERSHIP_ROLES`, and a value is compared ' +
      'case-insensitively.',
    'After ADR-0090 D3 renamed `sys_role` to `sys_position`, an approver authored as ' +
      '`{ type: \'role\', value: \'sales_manager\' }` finds no member row: the expansion falls back ' +
      'to the `role:sales_manager` literal, and the request waits on an approver that can never ' +
      'act. A business role is always a position, resolved through `sys_user_position`.',
    'A warning, not an error: the runtime keeps its literal fallback rather than refusing the node. ' +
      'When the value is not a tier, this finding is reported instead of ' +
      '`approval-approver-type-deprecated` on the same approver: the bad value is the more serious ' +
      'defect, and its fix (`position`) differs from the deprecation\'s (`org_membership_level`).',
  ],
};

const APPROVAL_EXPRESSION_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'approval-expression-invalid',
  covers: 'what an expression approver may read',
  paragraphs: [
    // The three roots are held to the spec's `APPROVER_EXPRESSION_ROOTS` by the rule's test.
    'An `expression` approver resolves its people from runtime data: its `value` is bare CEL, with ' +
      'no `{…}` template braces, evaluated at node entry over three roots. `current.*` is the ' +
      'record\'s live state at node entry; `trigger.*` is the submit-time snapshot; `vars.*` holds the ' +
      'flow\'s variables, an upstream node\'s output included (for example ' +
      '`vars.get_reviewers.record.owner_id` or `vars.approval_lead.picked_departments`). The result — ' +
      'a user id, a comma-separated list or an array, or ids re-expanded per `resolveAs` — is the ' +
      'approver slate.',
    'The runtime rejects an expression that is empty, does not parse, or reads any other root, and ' +
      'fails the node at entry: the CEL environment would resolve an unknown root as `dyn`, so it ' +
      'would evaluate to null and leave a silently empty slate, and the pre-check fails the node ' +
      'loudly instead. So each is an error here, on the CLI and at the runtime publish gate alike.',
    '`record` and `previous` are deliberately not bound at an approval node. Everywhere else on the ' +
      'platform (flow conditions, hooks) `record` means the record at event time, and reusing it here ' +
      'would silently alias one of two times. Write `current.FIELD` for the live value at node entry ' +
      'or `trigger.FIELD` for the submit-time snapshot; `vars.previous` carries the pre-update row.',
    '`resolveAs` means something only on an `expression` approver: it says how the resolved values ' +
      'become people (`user`, the default, or `department`, `position` or `team`, expanded through the ' +
      'same lookups those approver types use). On any other type it does nothing, so it is reported ' +
      'as dead config at `info`: remove it, or make the approver an expression.',
  ],
};

const APPROVAL_EXPRESSION_NO_EMPTY_POLICY_EXPLANATION: RuleExplanation = {
  rule: 'approval-expression-no-empty-policy',
  covers: 'what each empty-slate policy does',
  paragraphs: [
    'A node with an `expression` approver resolves people from runtime data, so an empty result is ' +
      'far likelier than for a static approver type: a field nobody has written yet mid-flow, or an ' +
      'upstream output that came back empty. The rule asks the node to SAY what an empty slate should ' +
      'do rather than inherit the default silently.',
    // The four policies are held to the spec's `onEmptyApprovers` enum by the rule's test.
    'The policies, in `onEmptyApprovers`: `admin_rescue`, the default — the request opens on the ' +
      'organization\'s administrators, and only a privileged admin can act; `fail` — the node fails ' +
      '(its fault edge, or the run), for a slate that can only be empty through a configuration bug; ' +
      '`auto_approve` — the request is skipped and the run continues down the `approve` edge with ' +
      '`output.autoApproved = true`, which waves the record through; `fallback` — the request opens on ' +
      'the people a sibling `fallbackApprovers` list names instead, and a fallback that itself resolves ' +
      'to nobody degrades to `admin_rescue`.',
    'Advisory (`info`): declaring the default explicitly silences it, and an `info` finding never ' +
      'blocks a build or a publish.',
  ],
};

// ── Record titles (`validate-record-title.ts`) ──────────────────────────────

const TITLE_FORMAT_RETIRED_EXPLANATION: RuleExplanation = {
  rule: 'title-format-retired',
  covers: 'why titleFormat is retired, and what replaces it',
  paragraphs: [
    'ADR-0079 makes a record\'s title a structural invariant: every object resolves one primary ' +
      'title from a real field, the one `nameField` points at (`displayNameField` is its deprecated ' +
      'alias), or one derived from the object\'s fields. `titleFormat` is a render-only template: the ' +
      'server can neither return the title it draws nor query by it, the shared title predicate ' +
      '(`objectTitleCompleteness`) never reads it, and an explicit `nameField` takes precedence over it.',
    'For a single-field title, set `nameField` to that field. A composite title that must be queried ' +
      '(matched by an import, sorted, searched) is a stored computed field: a non-formula field, such as ' +
      'a `text` field, that declares an `expression`, which the engine computes and stores on every ' +
      'write; point `nameField` at it. A formula with `returnType: \'text\'` is title-eligible too and ' +
      'stays legal for a title shown for display only: its value is computed on read and stored nowhere, ' +
      'so a sort by it is refused, search never reaches it, and an import cannot match a lookup cell ' +
      'against it. Then drop `titleFormat`, which this warning reports for as long as it is declared.',
    'A warning, not an error: the schema still parses the key, so existing metadata keeps loading.',
  ],
};

const TITLE_UNRESOLVABLE_EXPLANATION: RuleExplanation = {
  rule: 'title-unresolvable',
  covers: 'how a record title resolves, and its fallback',
  paragraphs: [
    // The eligible types are held to the spec's `TITLE_ELIGIBLE_TYPES` by the rule's test.
    'A record\'s title resolves from the object\'s `nameField` pointer (or the deprecated ' +
      '`displayNameField`), else by derivation from a title-eligible field: a `text`, `textarea`, ' +
      '`email`, `url`, `markdown`, `html` or `richtext` field, or a `formula` whose `returnType` is ' +
      '`text`, a field named like a title (`name`, `title`, `subject`, …) first. This finding means ' +
      'neither exists: no pointer and nothing to derive one from (`objectTitleCompleteness` answers ' +
      '`none`), so records have no meaningful name.',
    'A warning, not an error: the runtime still auto-provisions a primary and falls back to a stable ' +
      '`Record #ID` floor, so a green build never ships a title-less object. An explicit title is far ' +
      'more useful to every surface that names the record.',
  ],
};

// ── Data-model rules (`data-model-rules.ts`) ───────────────────────────────
// The three ADR-0120 uniqueness ids run on `os validate` and `os build` as
// registry entries and on `os lint` through `lintDataModel`; the other three
// are `lintDataModel`'s own sweep.

/** The ADR-0120 scope words, as the two uniqueness spellings read them (both write it out). */
const UNIQUE_SCOPE_WORDS =
  'ADR-0120 gives uniqueness two scope words: `\'organization\'`, one holder per organization, and ' +
  '`\'global\'`, installation-wide. On a FIELD, bare `unique: true` is the positional synonym of ' +
  '`\'organization\'` and stays valid; on a declared INDEX the same spelling states no scope, and ' +
  'is judged as `\'global\'`.';

/** Where the three `lintDataModel` sweep ids are reported (all three write it out). */
const DATA_MODEL_SWEEP_REACH =
  'Reach: `os lint` and the metadata-generation rubric run this rule, and nothing else does — it ' +
  'is not an `os validate` / `os build` rule and does not run at the metadata save door, so its ' +
  'severity moves `os lint`\'s exit code and the rubric\'s score, never a publish verdict.';

const UNIQUE_LEGACY_ORGANIZATION_COMPOSITE_EXPLANATION: RuleExplanation = {
  rule: 'unique/legacy-organization-composite',
  covers: 'what a hand-written organization composite enforces',
  paragraphs: [
    'A declared unique index that lists the organization column itself — `organization_id`, or the ' +
      'object\'s `tenancy.tenantField` — is the hand-written per-organization composite that ' +
      'predates the scope vocabulary (ADR-0120 S6). It reads as "unique per organization" but ' +
      'materializes as a plain composite, and SQL UNIQUE is NULL-distinct: it enforces nothing on a ' +
      'row whose organization column is NULL — every row a 17.x single-organization deployment ' +
      'wrote. Since ADR-0131 D9 a new row carries its organization wherever the organization object ' +
      'is registered, so what the gap still admits there is that residue; a composition that ' +
      'registers no organization object still writes rows whose organization column is NULL.',
    'Respelled `unique: \'organization\'`, the NULL rows become one bucket ' +
      '(`COALESCE(organization_id, \'__global__\')`) that is unique among themselves, which is what ' +
      'closes the hole. The respelling keeps `fields` exactly as they are: the driver makes the listed ' +
      'organization column NULL-safe in place rather than prepending a second organization key part, ' +
      'so `[organization_id, email]` then really is "one email per organization".',
    'Opting in is a physical tightening. It surfaces as a `recreate_index` drift op gated by the ' +
      'duplicate pre-flight probe (ADR-0120 D4), so pre-existing duplicate NULL-organization rows ' +
      'block it with a report rather than failing a boot.',
    'Advisory, and never auto-fixed (ADR-0120 D5c): the legacy spelling stays valid indefinitely ' +
      'and forces no drift, and opting in is a real physical tightening that goes through the D4 ' +
      'ceremony, because rows the void constraint admitted may still be there. Not reported: ' +
      '`unique: \'organization\'` itself, and a unique on the organization column alone, which is ' +
      'not a composite.',
  ],
};

const UNIQUE_UNSCOPED_DECLARED_INDEX_EXPLANATION: RuleExplanation = {
  rule: 'unique/unscoped-declared-index',
  covers: 'why a declared unique index must state its scope',
  paragraphs: [
    'Bare `unique: true` on a declared index states no scope (ADR-0120 D5a). It built the index ' +
      'over exactly its `fields` — installation-wide — while reading like "unique per ' +
      'organization", so on an organization-scoped object a value one organization holds refused ' +
      'the same value in every other. The rule fires on the spelling alone, with no tenancy ' +
      'inference: `organization_id` is kernel-injected at registration, so a guess from the ' +
      'authored fields would be wrong half the time.',
    UNIQUE_SCOPE_WORDS,
    'Protocol 18 refuses the spelling (ADR-0120 D7) through two channels. The schema ' +
      '(`IndexSchema.unique`) refuses it at every door that parses — `os validate`, `os build`, ' +
      '`ObjectSchema.create` and the runtime save door — and this rule refuses it where nothing ' +
      'parses: `os lint`, which judges the normalized stack. Stored metadata that still carries it ' +
      'converts to `unique: \'global\'`, which builds the same physical index.',
    'Either word is a complete fix. `\'global\'` keeps the index exactly as bare `true` built it; ' +
      '`\'organization\'` makes the driver prepend the NULL-safe organization key part at ' +
      'registration, so each organization may hold the value once. ' +
      'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
  ],
};

const UNIQUE_DOUBLE_DECLARATION_EXPLANATION: RuleExplanation = {
  rule: 'unique/double-declaration',
  covers: 'how a field unique and an index unique combine',
  paragraphs: [
    'One column carries both a field-level `unique` and a declared single-column unique index, and ' +
      'the two are judged in the scope vocabulary (ADR-0120 D5b), from the two spellings alone with ' +
      'no tenancy inference.',
    UNIQUE_SCOPE_WORDS,
    'Different scopes CONTRADICT: the installation-wide index is physically stricter and wins, so ' +
      'the per-organization constraint can never be tripped and one of the two declared intents is ' +
      'silently dead. The same scope on both sides is REDUNDANT — the same index declared twice — ' +
      'and dropping one gives the intent a single home.',
    'Either way the fix leaves one spelling. Installation-wide uniqueness is `unique: \'global\'`, on ' +
      'the field or on the declared index; per-organization uniqueness is `unique: \'organization\'`, ' +
      'preferably field-level on the column, or on the declared index.',
    'A composite declared index is not judged here: listing the organization column is the legacy ' +
      'organization spelling, `unique/legacy-organization-composite`\'s question. Advisory: the ' +
      'stack is well-defined, and the cost is an intent that never takes effect.',
  ],
};

const RELATIONSHIP_MASTER_DETAIL_REQUIRED_EXPLANATION: RuleExplanation = {
  rule: 'relationship/master-detail-required',
  covers: 'why a master_detail reference must be required',
  paragraphs: [
    'A detail record cannot exist without its master, so a `master_detail` reference should be ' +
      '`required: true`. On most objects nothing at runtime refuses a detail saved without one, so ' +
      'there the rule is a warning.',
    'On a `sharingModel: \'controlled_by_parent\'` object it is an error. Such an object derives ALL ' +
      'of its record access through the master reference (ADR-0055), and the derived read filter — ' +
      '`masterFK IN (accessible master ids)` — never matches an empty master, so a detail saved ' +
      'without one is readable by nobody and refused on every later write. Record validation never ' +
      'checks a field that is not `required`, and skips `readonly` and `system` fields before its ' +
      'required check, so on the three shapes reported — `required` absent or false, ' +
      '`required: true` with `readonly: true`, and `required: true` with `system: true` — the ' +
      'security gate (`assertControlledByParentWrite`) is the only thing refusing such an insert.',
    'Every `master_detail` field of such an object is judged, not only the one the runtime resolves ' +
      'as the master: that is the scope `ObjectSchema.create()` enforces when it forces ' +
      '`required: true` and refuses an explicit `required: false`. The spec parse also ' +
      'refuses every shape that leaves the object without exactly one writable required master, so ' +
      '`os validate`, `os build` and the save door stop there; a shape on a second, non-required ' +
      '`master_detail` beside the master is this rule\'s report alone. One finding per field, located ' +
      'at its first defect.',
    DATA_MODEL_SWEEP_REACH,
  ],
};

const ROLLUP_NON_NUMERIC_AGGREGAND_EXPLANATION: RuleExplanation = {
  rule: 'rollup/non-numeric-aggregand',
  covers: 'why a min/max roll-up needs a numeric child field',
  paragraphs: [
    'A `summary` field persists its roll-up\'s answer, and its value contract is a finite number: ' +
      '`summary` is a member of the spec\'s `NUMERIC_VALUE_TYPES`. `min` and `max` answer with a ' +
      'value of the CHILD field\'s own type, and the engine stores the driver\'s answer verbatim, so ' +
      'an ordinary "latest shipment" roll-up — `max` over a `datetime` child — computes an instant ' +
      'into a number column.',
    'Accepted children are the numeric value types and the boolean ones, which aggregate as numbers ' +
      'on every backend. This is deliberately not the analytics aggregate table, which accepts a ' +
      'temporal `min` / `max` because a dataset measure RETURNS its answer to the caller instead of ' +
      'storing it.',
    'Judged: `min` and `max` only — `count` reads no value off the field, and `sum` / `avg` over a ' +
      'non-numeric child is a different shape. Silent when the child object or field does not ' +
      'resolve in this stack (another package, a partial load): a rule that cannot answer does not ' +
      'block.',
    DATA_MODEL_SWEEP_REACH,
  ],
};

const RELATIONSHIP_DELETE_BEHAVIOR_EXPLANATION: RuleExplanation = {
  rule: 'relationship/delete-behavior',
  covers: 'what deleting a master does to its details',
  paragraphs: [
    'On a `master_detail` field the engine resolves every `deleteBehavior` except `restrict` — an ' +
      'unset one included — to `cascade`: deleting the master deletes its details. Declaring the ' +
      'value states that choice where a reader can see it: `cascade` accepts it, and `restrict` ' +
      'refuses to delete a master that still has details.',
    '`set_null` is not a choice here. A detail cannot outlive its master — a nulled master reference ' +
      'would orphan it — so an authored `deleteBehavior: \'set_null\'` on a `master_detail` is ' +
      'refused at the parse. Where children must survive their parent, the relationship is a ' +
      '`lookup`, not a `master_detail`.',
    DATA_MODEL_SWEEP_REACH,
  ],
};

// ── AI agent authoring (`validate-ai-agent-authoring.ts`) ──────────────────

/**
 * The platform agent roster and its aliases (all three ids). The aliases are
 * held to the rule's own table by its tests, which run the rule on each.
 */
const PLATFORM_AGENT_ROSTER =
  'The kernel ships exactly two agents, `ask` and `build`, and the surface the user is in binds one ' +
  '(ADR-0063 §2). Their retired spellings — `data_chat` for `ask`, `metadata_assistant` for ' +
  '`build` — are registered one way in the alias registry at plugin init: resolution only, kept ' +
  'for old bookmarks and persisted `agent_id`s, never separate records, and the agent catalog ' +
  'shows each agent once under its canonical name.';

/** How an app reaches the platform agents without an agent of its own — the two agent ids it fixes. */
const SKILLS_ATTACH_BY_SURFACE =
  'A capability or persona an app wants from an agent is authored as skills: a skill attaches to the ' +
  'platform agent (`ask` or `build`) by `surface` affinity, not through a custom agent or a custom ' +
  '`defaultAgent` value, so the skills a stack declares reach the agent that serves their surface.';

const DEFAULT_AGENT_LEGACY_ALIAS_EXPLANATION: RuleExplanation = {
  rule: 'default-agent-legacy-alias',
  covers: 'why a retired agent alias is the wrong spelling',
  paragraphs: [
    PLATFORM_AGENT_ROSTER,
    'So an aliased `defaultAgent` is not broken: it resolves, and the app gets the agent it meant. ' +
      'What is wrong is the spelling in the artifact, and it is also the weaker pin: resolution ' +
      'depends on the owning package\'s in-process alias registration having run, which the ' +
      'canonical id does not. A warning for that reason, and an id of its own beside ' +
      '`default-agent-outside-roster`, because an alias resolves and an unknown name does not.',
  ],
};

const DEFAULT_AGENT_OUTSIDE_ROSTER_EXPLANATION: RuleExplanation = {
  rule: 'default-agent-outside-roster',
  covers: 'what an app\'s defaultAgent resolves against',
  paragraphs: [
    PLATFORM_AGENT_ROSTER,
    '`app.defaultAgent` is resolved against those two names and their aliases only. An unrecognized ' +
      'name is not rejected: it silently falls back to the platform default at runtime (ADR-0063 ' +
      '§1), so the pin has no effect and the value drifts from what actually serves the app.',
    'The key is a plain snake_case identifier in the schema, so any value parses, validates and ' +
      'builds. The check is a warning rather than a schema enum on purpose: narrowing the key is a ' +
      'breaking authoring change ADR-0063 already walked back once.',
    SKILLS_ATTACH_BY_SURFACE,
  ],
};

const AGENT_AUTHORING_WITHDRAWN_EXPLANATION: RuleExplanation = {
  rule: 'agent-authoring-withdrawn',
  covers: 'why a stack-declared agent never runs',
  paragraphs: [
    PLATFORM_AGENT_ROSTER,
    'ADR-0063 §2 withdrew tenant and app-package custom agents: third parties extend the platform ' +
      'by authoring skills. The runtime enforces it on both paths — `listAgents()` filters ' +
      'non-platform records out of the catalog and `loadAgent()` refuses them — so a stack-authored ' +
      'agent 404s on chat and cannot be pinned through `app.defaultAgent`: it parses, validates and ' +
      'ships as inert metadata.',
    'A declaration named after a platform agent — `ask`, `build`, or an alias of one — is a ' +
      'different case: it shadows the platform\'s record, which the runtime serves for that name ' +
      'while ignoring this one, so the declaration has no effect and drifts from the platform\'s ' +
      'definition.',
    'A warning, not an error: the platform\'s own packages legitimately author agent records, and ' +
      'the rule cannot tell a platform package from an app package by reading the stack alone — the ' +
      'runtime is what gates. Not a schema refinement either: an existing stack must keep parsing ' +
      '(ADR-0078).',
    SKILLS_ATTACH_BY_SURFACE,
    'Everything an agent carries that a skill does not is persona text, so the useful parts of its ' +
      '`instructions` move into the skills\' own instructions. The skills the agent references ' +
      'already carry its capability, so nothing is lost by dropping the persona.',
  ],
};

// ── View references (`lint-view-refs.ts`) ──────────────────────────────────

const VIEW_REF_NAV_VIEW_MISSING_EXPLANATION: RuleExplanation = {
  rule: 'view-ref-nav-view-missing',
  covers: 'how a navigation viewName is resolved',
  paragraphs: [
    'An app navigation entry\'s `viewName` names a list view of its object, and an unresolvable name ' +
      'does not fail: the console falls back to the object\'s default view, else its first list ' +
      'view, and keeps the entry\'s authored label and icon. The sidebar reads correctly while ' +
      'opening the wrong view, `os validate` and `os build` stay green, and renaming a list view ' +
      'silently degrades every entry that points at it; the console\'s only signal is a ' +
      'browser-console warning.',
    'The name is matched the way the console\'s `resolveViewId` matches it, in all three ' +
      'directions: the exact id, a short name retried as `OBJECT.NAME`, and a qualified name ' +
      'retried with the `OBJECT.` prefix stripped. `all` is not special-cased: it resolves only ' +
      'when the object declares it. A name that resolves to a FORM view of the object is still ' +
      'reported, because the object\'s view switcher never offers one. The verdict quotes at most ' +
      'three of the object\'s list views.',
    'An error, because it fires only when this stack declared a non-empty list-view namespace for ' +
      'the object. Skipped: an object this stack does not declare or contributes no expandable list ' +
      'view for, an entry carrying `requiresObject` (another package provides the object), an ' +
      'interpolated name, and an entry with `recordId` (the schema ignores `viewName` there). A view ' +
      'saved at runtime is invisible to any author-time pass.',
  ],
};

const VIEW_KEY_COLLISION_EXPLANATION: RuleExplanation = {
  rule: 'view-key-collision',
  covers: 'what a renamed view key does to its references',
  paragraphs: [
    'List and form views share one `OBJECT.KEY` namespace when a view container is expanded. A ' +
      'colliding key is renamed — `OBJECT.KEY` becomes `OBJECT.KEY_2` — so the registry key stays ' +
      'unique, and every reference to the requested name resolves to the OTHER view: a ' +
      '`type: \'form\'` action target and a navigation `viewName` alike.',
    'A warning, not an error: the rename alone breaks something only when the name is referenced, ' +
      'and a reference that lands on the wrong kind of view is reported on its own, by ' +
      '`view-ref-form-target-kind` or `view-ref-nav-view-missing`.',
  ],
};

// ── Chart bindings (`validate-chart-bindings.ts`) ──────────────────────────

/** Which chart surfaces the two ids judge, and which they leave alone (both write it out). */
const CHART_BINDING_SURFACES =
  'Judged on the chart surfaces the dashboard rule does not reach: a report\'s own selection ' +
  '(`rows`, `columns`, `values`) and its chart, a list-view chart, and a dataset-bound page chart ' +
  'component. Not judged: the react `ObjectChart` block, which is object-bound and keyed by raw ' +
  'field names (`validate-react-page-props` judges it), and the chart of a `joined` report or of a ' +
  'report block, which no renderer draws (their own selections are judged).';

const CHART_MEASURE_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'chart-measure-unknown',
  covers: 'which chart positions bind a measure, per surface',
  paragraphs: [
    'Post-ADR-0021 a dataset query\'s result rows are keyed by MEASURE NAME (`sum_amount`), not by ' +
      'the base field (`amount`). A position that names a raw field instead of a declared measure ' +
      'still renders, and the series it feeds comes back empty.',
    'At a QUERY position the name is a binding, and an unknown one is an error: a report\'s ' +
      '`values` and its chart\'s `yAxis` (the embedded report chart queries `chart.xAxis` × ' +
      '`chart.yAxis` itself), a list-view chart\'s `values`, and a page chart\'s `values`.',
    'At a PRESENTATION position the renderer does not bind the name, so an unknown one is a ' +
      'warning: a report `chart.series[]` entry is a per-measure display-name override, paired with ' +
      'the derived series whose key it equals and ignored when it names no declared measure; a page ' +
      'chart\'s `series[]` is replaced wholesale by one derived entry per selected measure; and a ' +
      'page chart\'s `yAxis[].field` keeps its slot (the count turns on a secondary axis) and its ' +
      'scale, while the plotted columns come from `values`.',
    'So at a presentation position the fix is the name or nothing: `series[].name` selects WHICH ' +
      'derived series a label and its presentation land on and cannot add, remove or re-point one ' +
      '(membership belongs to the dataset selection), and `yAxis[]` carries presentation only — title, ' +
      'min/max, position, gridlines. None of these surfaces carries a `suppressWarnings` key, so ' +
      'correcting the name or dropping the entry is the only way to clear the advisory. The fix line ' +
      'names the nearest declared measure ("Did you mean") rather than listing the dataset\'s measures.',
    CHART_BINDING_SURFACES,
  ],
};

const CHART_AXIS_NOT_SELECTED_EXPLANATION: RuleExplanation = {
  rule: 'chart-axis-not-selected',
  covers: 'which selection a chart position is measured against',
  paragraphs: [
    'The entry sits at a PRESENTATION position — a report `chart.series[]` override, or a page ' +
      'chart\'s `series[]` or `yAxis[].field` — and names a measure the dataset declares but the ' +
      'chart does not select. No series is derived for it, so the entry lands on nothing and the ' +
      'chart drawn is unaffected. Advisory: the selection may legitimately be widened at runtime. A ' +
      'query position is never reported: it IS the selection, or the query itself.',
    'The selection is per surface. On a page chart it is `values`, the measure set the query asks ' +
      'for. On a report it is the chart\'s own `chart.yAxis`: the embedded chart queries ' +
      'exactly one dimension × one measure and derives ONE series, while `report.values` is the ' +
      'selection of the table beneath it. So a report\'s `chart.yAxis` is never reported — a chart ' +
      'cannot fail to select what it queries — and a `chart.series[].name` override lands only when ' +
      'it names `chart.yAxis`. The verdict quotes at most three names of the selection.',
    CHART_BINDING_SURFACES,
  ],
};

// ── Dashboard header actions (`validate-dashboard-action-refs.ts`) ──────────

/** Which dashboard surface the two ids judge, and which targets they leave alone (both write it out). */
const DASHBOARD_HEADER_ACTION_SCOPE =
  'Judged: a dashboard\'s `header.actions[]`, the one dashboard surface that draws an action ' +
  'button, over the whole stack (a single published item cannot see the actions and pages it ' +
  'would resolve against, so the runtime publish gate does not run it). The per-widget ' +
  '`actionUrl`, `actionType` and `actionIcon` were retired in `@objectstack/spec` 17 — no ' +
  'renderer ever drew a per-widget button — so the parse refuses them by name. Not judged: an ' +
  'interpolated target (`${…}`), resolved by the renderer at click time, and a `flow` or `api` ' +
  'target, which resolves against the automation engine or is an opaque endpoint.';

const DASHBOARD_ACTION_TARGET_UNDEFINED_EXPLANATION: RuleExplanation = {
  rule: 'dashboard-action-target-undefined',
  covers: 'what a script or modal header-action target must name',
  paragraphs: [
    'A header action names its target in `actionUrl`, a free string the schema cannot check, so ' +
      'a target defined nowhere parses and ships. The button renders, and on click it does ' +
      'nothing (`script`) or the runtime refuses the dispatch (`modal`): a dangling reference, the ' +
      'shape ADR-0049 rules out for a declared reference. An error, so `os validate` and ' +
      '`os build` fail.',
    'A `script` target must name a defined action: a `stack.actions` entry or an entry of any ' +
      'object\'s `actions`, by `name`. A `modal` target must name a declared page (`stack.pages`), ' +
      'and only a page: the runtime resolves a string modal target against page metadata and ' +
      'refuses everything else, so a defined action name, a bare object name and the retired ' +
      '`VERB_OBJECT` convention (`create_opportunity` for object `opportunity`) are all reported. ' +
      'To open an object\'s form, use `actionType: \'form\'` with an `OBJECT.VIEW` form-view target.',
    DASHBOARD_HEADER_ACTION_SCOPE,
  ],
};

const DASHBOARD_ACTION_ROUTE_UNRESOLVED_EXPLANATION: RuleExplanation = {
  rule: 'dashboard-action-route-unresolved',
  covers: 'how a url header-action route is resolved',
  paragraphs: [
    'A `url` target — and a header action with no `actionType`, which the renderer treats as ' +
      '`url` — is a relative in-app path. Every `COLLECTION/NAME` pair in it is checked, for the ' +
      'collections `apps`, `objects`, `reports`, `dashboards`, `pages` and `views` (singular or ' +
      'plural), and each name this stack does not register is reported on its own, so a bad app ' +
      'name at the head of a path does not hide a bad dashboard name at its tail. A view is ' +
      'routable by a view container\'s name or by an object\'s name (its default view).',
    'A warning, not an error: route resolution depends on the app context, and a path may be ' +
      'served by another installed package or by a host or console route. Skipped: an external URL ' +
      '(`http(s)://` or `//`), a path that does not start with `/`, and an opaque route with no ' +
      'recognised collection segment anywhere in it.',
    DASHBOARD_HEADER_ACTION_SCOPE,
  ],
};

// ── Empty filter shapes (`validate-empty-combinators.ts`) ──────────────────

/**
 * The identity table both ids rest on (both write it out). The rule derives
 * its row-set words from `reduceFilterVerdict`; `validate-empty-combinators.test.ts`
 * holds this sentence to the same reduction.
 */
const EMPTY_FILTER_IDENTITIES =
  'Every backend reduces an empty shape to its boolean identity through one shared reduction ' +
  '(`reduceFilterVerdict` in `@objectstack/spec/data`): `{ $and: [] }` and `{}` reduce to TRUE ' +
  'and match EVERY row; `{ $or: [] }` and `{ $not: {} }` reduce to FALSE and match NO row. The ' +
  'asymmetry is why each finding\'s fix is per shape: a generic "empty filter" reading teaches ' +
  'the wrong fix half the time.';

/**
 * What both ids judge and what they leave alone (both write it out). The
 * filter keys are held to `FILTER_KEYS` by `validate-empty-combinators.test.ts`.
 */
const EMPTY_FILTER_SCOPE =
  'Judged: a filter literal written in the metadata, under a `filter`, `filters`, ' +
  '`runtimeFilter`, `relatedListFilter`, `filterBy` or `lookupFilters` key anywhere in a ' +
  'dashboard, object, view, report, dataset, page, app or flow (a CRUD node\'s filter included). ' +
  'The runtime is unchanged — a stack that ignores the finding runs exactly as before — and a ' +
  'filter a producer builds while serving a request never enters the metadata, so a read scope ' +
  'whose disjuncts loop down to zero keeps failing closed. Not judged: `{ FIELD: {} }` (a field ' +
  'with zero operators, another rule\'s refusal), a non-array `$and` / `$or` or non-object ' +
  '`$not` operand (the schema and the drivers refuse those by name), the array filter form, and ' +
  'an absent `filter` key, which is the canonical spelling of "no filter".';

const FILTER_EMPTY_COMBINATOR_EXPLANATION: RuleExplanation = {
  rule: 'filter-empty-combinator',
  covers: 'what an empty combinator matches, and why it is refused',
  paragraphs: [
    EMPTY_FILTER_IDENTITIES,
    'So `$and: []` constrains nothing while it reads as a filter; `$or: []` renders the surface ' +
      'permanently empty and, on a read scope, hides every row (fail-closed by design: an empty ' +
      'disjunction never opens a read scope to the whole table); and `$not: {}` matches NO row, ' +
      'the opposite of the "no filter" an empty operand looks like. An error: no reading of the ' +
      'literal behaves as written, and a literal empty combinator is not an authoring surface.',
    'To express "no filter", DELETE the key — an absent `filter` and a filter that reduces to TRUE run ' +
      'identically, and only the absent key says so to the next reader (and to the next AI author that ' +
      'copies this metadata). If you really do want a predicate that selects nothing, ' +
      '`{ <field>: { $in: [] } }` is the declared spelling for it (an empty `$in` list matches nothing, on ' +
      'every backend) — it says so where an empty combinator only implies it. A PROGRAMMATIC producer that ' +
      'loops to zero operands keeps the runtime identity unchanged — this rule judges only what is written in ' +
      'the metadata.',
    EMPTY_FILTER_SCOPE,
  ],
};

const FILTER_EMPTY_NODE_EXPLANATION: RuleExplanation = {
  rule: 'filter-empty-node',
  covers: 'what an empty filter node matches where it stands',
  paragraphs: [
    EMPTY_FILTER_IDENTITIES,
    'An empty node is TRUE wherever it stands. As the whole filter it matches EVERY row, exactly ' +
      'as if the key were absent, so a filter is declared and enforces nothing. As a branch of ' +
      '`$or` it is a TRUE disjunct, which ABSORBS the disjunction, so every branch beside it is ' +
      'dead (a compiler that dropped the branch instead would silently narrow the scope to the ' +
      'branches that survive, which is why the runtime absorbs). As a branch of `$and` it is the ' +
      'AND identity and contributes no condition, indistinguishable from a branch whose condition ' +
      'was lost in an edit. An error: no reading of the literal behaves as written.',
    'To express "no filter", DELETE the key — an absent `filter` and a filter that reduces to TRUE run ' +
      'identically, and only the absent key says so to the next reader (and to the next AI author that ' +
      'copies this metadata). If you really do want a predicate that selects nothing, ' +
      '`{ <field>: { $in: [] } }` is the declared spelling for it (an empty `$in` list matches nothing, on ' +
      'every backend). Otherwise delete the empty branch, or write the condition it was meant to carry.',
    EMPTY_FILTER_SCOPE,
  ],
};

// ── List-view field references (`validate-list-view-field-refs.ts`) ────────

/** Why a dotted name is judged by its head only (both ids write it out). */
const LIST_VIEW_HEAD_ONLY =
  'A list view declares no ADR-0021 `include`, so it compiles no joins: a dotted name in it is ' +
  'judged by its HEAD segment, and its hops are never walked — walking them would bless ' +
  '`owner.name` on a surface whose query doors (projection, filter and sort) all refuse a ' +
  'dotted path by name. A head that does not resolve is `list-view-field-unknown`; a head that ' +
  'resolves, at a position whose name reaches a query door, is `list-view-field-dotted`.';

const LIST_VIEW_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'list-view-field-unknown',
  covers: 'what a dangling list-view field reference costs',
  paragraphs: [
    // The positions are held to `listViewWalkedPositions()` by the rule's test.
    'Every field a list view names must be a field of its bound object: its `columns` (and a ' +
      'column\'s `summary` and `prefix`), `hiddenFields`, `fieldOrder`, ' +
      '`grouping`, `rowColor` and `userFilters`, the keys of its `filter` and of each ' +
      '`userFilters.tabs[].filter`, and every binding inside a `kanban`, `calendar`, `gantt`, ' +
      '`timeline`, `gallery`, `map` or `tree` block. Nothing resolves the name at render time: the ' +
      'view renders successfully with a blank, empty or wrong result, and nothing else reports the ' +
      'miss. The verdict\'s "Did you mean" names the nearest field the object declares.',
    'An error where the miss changes what the view returns or collapses what it lays out — for ' +
      'example, a filter key, user filter or gantt quick filter matches no record; a column is sent as the ' +
      'projection, where the REST ingress answers `400 INVALID_FIELD`; a `kanban.groupByField` ' +
      'collapses every card into one lane; a required date field of a `gantt`, `calendar` or ' +
      '`timeline` leaves nothing to place; a map with no coordinate field plots no marker; a ' +
      '`tree.parentField` flattens the tree; a `gantt.lockField` unfreezes every row and a ' +
      '`gantt.objectField` stops every bar opening its record. A warning where one decoration ' +
      'drops and the rest renders — an optional colour, title, tooltip or cover binding, or a stale ' +
      '`hiddenFields` or `fieldOrder` entry, which hides or orders nothing.',
    LIST_VIEW_HEAD_ONLY,
    'Not judged: an object this stack does not define, an object with no readable field map (an ' +
      'external or introspected schema), a hop through a registry-injected system column, a list ' +
      'view bound to a provider other than `object`, and the positions other rules own: `sort` ' +
      '(`sort-field-unknown`), `searchableFields` (`searchable-field-unknown`), the `chart` ' +
      'bindings, action names and `conditionalFormatting` predicates. An ' +
      'unresolvable binding skips the whole list view on `os validate`, `os build` and `os lint`, so one ' +
      'typo yields one finding; the runtime save door refuses it once instead, as `list-view-object-unknown` ' +
      'or, for a write into a package, `list-view-object-outside-closure`.',
  ],
};

const LIST_VIEW_FIELD_DOTTED_EXPLANATION: RuleExplanation = {
  rule: 'list-view-field-dotted',
  covers: 'which list-view positions refuse a dotted path, and why',
  paragraphs: [
    LIST_VIEW_HEAD_ONLY,
    'Only a position whose name reaches a query door is judged, each by that door\'s own verdict. ' +
      'Projection: `columns[]` is sent as the query\'s `$select`, and both doors refuse every ' +
      'dotted entry whatever its head (`assertProjectionHasNoDottedPaths` on the engine boundary, ' +
      '`assertProjectionFieldsExist` at the REST ingress, both `400 INVALID_FIELD`), so the view\'s ' +
      'FIRST fetch is refused, not rendered.',
    'Filter: the view\'s `filter`, its `userFilters.tabs[].filter` and ' +
      '`userFilters.fields` are judged by the head\'s class, through the classifier the door ' +
      'itself uses (`classifyDottedFilterHead`). A relation head stores the related record\'s id, ' +
      'not an embedded document; a virtual head is computed on read, so no driver materialises a ' +
      'column; a scalar head stores a single value, with nothing beneath it. No backend serves such ' +
      'a path, so the predicate could only match zero records, and the query is REFUSED ' +
      '(`assertFilterIsMaterializable` and the REST ingress, `400 INVALID_FIELD`) rather than ' +
      'answered with an empty list. A structured or JSON head, an array (`multiple: true`) head, a ' +
      'file head and an unreadable head are served by the door, so they are not reported.',
    'The ways out are the doors\' own. At a projection position, name the whole column and read ' +
      'into its value in the client, or read the related record with `expand`; at a filter position, ' +
      'filter on a column of the bound object itself. At either, denormalise the value onto the bound ' +
      'object — a stored field, written when the source changes — and name that.',
    'Not judged, because each is read client-side out of the fetched row, where a dotted path ' +
      'walks an embedded record: `gantt.quickFilters[].field`, `gantt.tooltipFields[]` and every ' +
      'renderer binding. `sort` keeps its own rule. Always an error: every judged position is ' +
      'refused outright by its door.',
  ],
};

/** Which keys a list view's binding is read from, and what stays unjudged (both binding ids write it out). */
const LIST_VIEW_BINDING_SCOPE =
  'One finding per list view, at the key the binding was read from: the view\'s `object`, or a list ' +
  'view\'s own `data.object` where it sets one. The view\'s field references stay unjudged while the ' +
  'binding does not resolve, so a wrong name is reported once per list view rather than once per ' +
  'position. Not judged: a draft save, and a stored view until its next save — the door judges ' +
  'writes only.';

const LIST_VIEW_OBJECT_OUTSIDE_CLOSURE_EXPLANATION: RuleExplanation = {
  rule: 'list-view-object-outside-closure',
  covers: 'what a package closure holds, and why the view refuses',
  paragraphs: [
    'A view written into a package at the runtime save door is judged against that package\'s ' +
      'closure, never the whole deployment: the package\'s own objects, the objects of the packages its ' +
      'manifest declares in `dependencies`, platform objects, and tenant-authored objects that carry no ' +
      'package. The declared `dependencies` bound what the package MAY reference, so a list view bound ' +
      'to an object outside that closure is not resolvable by declaration — whether the object belongs ' +
      'to a package the manifest never declared or exists nowhere at all, because the closure is all ' +
      'the door can see.',
    'An error, so the publish is refused (`422`): it is the verdict the dataset door gives a base ' +
      'object outside the same closure (`object-reference-unknown`). Judging the view\'s field ' +
      'references against an object the package may not reference would judge the package against the ' +
      'wrong set; declaring the dependency puts the object, and the field judgement with it, inside the ' +
      'closure.',
    LIST_VIEW_BINDING_SCOPE,
    'To fix it, declare a dependency on the package that defines the object in the `dependencies` of ' +
      'the written package\'s manifest, or bind the view to an object inside the closure; when the name ' +
      'is a typo, the verdict names the nearest object in reach. A write that names no package is ' +
      'judged against the whole collection instead (`list-view-object-unknown`), and `os validate`, ' +
      '`os build` and `os lint` judge neither: a stack there is one app, and an unresolved binding may ' +
      'be a dependency package\'s object the stack does not carry.',
  ],
};

const LIST_VIEW_OBJECT_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'list-view-object-unknown',
  covers: 'why the save door can say an object exists nowhere',
  paragraphs: [
    'A view written at the runtime save door with no package named (an overlay write) is judged ' +
      'against the whole collection the deployment serves: every installed package\'s objects, enabled ' +
      'or not, the platform\'s, and the objects saved at run time — the same merge the object metadata ' +
      'listing answers from. Nothing narrows it, so a list view bound to an object missing from it is ' +
      'bound to an object that exists nowhere: there is no other package for it to come from.',
    'An error, so the publish is refused (`422`): left in, the view would be stored with none of its ' +
      'field references checked and fail only when it renders. The nearest object name rides the ' +
      '`fix:` line, never the verdict, so a stored view\'s verdict does not change when an unrelated ' +
      'write creates an object with a similar name.',
    LIST_VIEW_BINDING_SCOPE,
    'To fix it, bind the view to an object that exists, or save the object before you publish the ' +
      'view. Not judged: a write into a package, which is judged against that package\'s closure ' +
      'instead (`list-view-object-outside-closure`); an empty collection, which means the host supplied ' +
      'none, because no deployment serves zero objects; and `os validate`, `os build` and `os lint`, ' +
      'where a stack is one app and an unresolved binding may be a dependency package\'s object the ' +
      'stack does not carry, so the list view is skipped and the binding left to the object-reference ' +
      'checks.',
  ],
};

// ── Translation bundles (`validate-translation-references.ts`, `validate-translatable-sections.ts`) ──

/** How a bundle key is read at all (the two reference ids write it out). */
const TRANSLATION_LOOKUP =
  'The resolver never walks a bundle: it derives each key from the metadata it is rendering — an ' +
  'object\'s field, a view\'s `name`, an option\'s stored `value` — and looks that key up. A key ' +
  'the metadata never derives is read by nothing, and the string it was written for renders in ' +
  'the source locale while every neighbouring label resolves, so the app looks translated and ' +
  'the one hole reads as a styling quirk rather than a missing translation.';

const TRANSLATION_TARGET_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'translation-target-unknown',
  covers: 'what each translation key may name, and why it gates',
  paragraphs: [
    TRANSLATION_LOOKUP,
    'An error, not a warning: an orphan key is not inert, it is misleading. Grepping its id ' +
      'returns a confident-looking hit in every locale — to a reviewer and to an AI author alike — ' +
      'long after the field, view, section or navigation entry it was written for was deleted. The ' +
      'forward half of the same parity, a declared surface with no translation, already fails, so ' +
      'the two halves gate alike.',
    'The verdict names the nearest declared name when one is close ("Did you mean"), and the fix ' +
      'line names the remedy only, without listing what is declared; what each key may name follows.',
    'Under `objects.OBJECT` (an object this stack, or a sibling package of the same artifact, ' +
      'defines): `fields.FIELD` a declared field (a system column, `_id`, `name` and `space` are ' +
      'never reported); `_views.VIEW` a view\'s `name`, not its label — the runtime keys a nameless ' +
      'default `list` `default`, never `list`; `_sections.KEY` a ' +
      '`fieldGroups[].key`, a named form-view section or a named `record:details` section — a ' +
      'section is translatable only through a stable name; `_tabs.TAB` a filter-preset tab that a ' +
      'page over the object declares in `interfaceConfig.userFilters.tabs` (a list view\'s own ' +
      '`tabs` has no renderer); `_validations.RULE` a rule in the object\'s `validations[]`, whose ' +
      '`message` otherwise stays in its source locale beside platform refusals in the caller\'s ' +
      'locale; `_actions.ACTION` an action of that object or a `stack.actions` entry bound to it.',
    '`globalActions.ACTION` an object-less action: an action bound to an object is read from ' +
      '`objects.OBJECT._actions.ACTION` and never from `globalActions`. `apps.APP` an app this ' +
      'stack declares or contributes into, and `apps.APP.navigation.ID` a navigation item `id` it ' +
      'declares or contributes; under an app this stack only contributes into ' +
      '(`manifest.navigationContributions`), the contributed ids alone, because the app\'s own ' +
      'entries are declared and translated by the package that owns it. `dashboards.DASH` a ' +
      'dashboard, `.widgets.ID` a widget `id` on it, and `.actions.URL` a header action\'s ' +
      '`actionUrl`, not its label. `picklists.LIST` a picklist\'s `name` that a package of this ' +
      'stack declares.',
    // The terminal toast keys are held to `FLOW_TERMINAL_MESSAGE_KEYS` by the rule's test.
    '`flows.FLOW` a flow\'s machine `name`; `.successMessage` / `.errorMessage` a toast the flow ' +
      'itself authors (a bundle cannot add one); `.screens.NODE` the `id` of a `type: \'screen\'` ' +
      'node at any depth, loop, parallel and try/catch regions included; `.screens.NODE.description` ' +
      'a screen that authors `config.description`; `.screens.NODE.fields.FIELD` a ' +
      '`config.fields[].name` on that screen — an OBJECT-FORM screen (`config.objectName`) declares ' +
      'none, and its input labels live under `objects.OBJECT.fields`; `.refusals.NODE` the `id` of ' +
      'an `end` node declaring `outcome: \'refused\'`.',
    'Under an action entry: `params.PARAM` a declared param `name`; `outcomeMessages.OUTCOME` an ' +
      'outcome the action\'s own `outcomeMessages` declares; `resultDialog.title`, `.description` ' +
      'and `.acknowledge` an action that declares a `resultDialog` at all; ' +
      '`resultDialog.fields.PATH` the literal `path` of a declared dialog field, dots included. A ' +
      'bundle translates what the action declares and cannot add an outcome or a dialog.',
    'Not judged: a platform object in the registry, an object this stack only extends through ' +
      '`objectExtensions[]`, and a picklist it only extends through `picklistExtensions[]` — the ' +
      'owner\'s declaration is not visible from here, so the whole subtree ' +
      'is skipped (a platform-prefixed name that no platform package, official plugin or cloud ' +
      'runtime object registers is reported on the object key alone). `messages`, ' +
      '`validationMessages`, `settings`, `settingsCommon` and `metadataForms` ' +
      'are keyed by code and by the platform, with no universe to resolve against, and a misspelled ' +
      'leaf attribute (`labl:`) is a schema-shape question.',
  ],
};

const TRANSLATION_OPTION_KEY_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'translation-option-key-unknown',
  covers: 'how option translations are keyed',
  paragraphs: [
    TRANSLATION_LOOKUP,
    'An option translation is keyed by the option\'s stored `value` — read as text, so `1` for a ' +
      'number value and `true` for a boolean — never by its display label and never by a variant ' +
      'spelling (`direct_mail`, not `Direct Mail` or `direct-mail`). A key that matches an ' +
      'option\'s label is reported with the value to rename it to; any other key with the nearest ' +
      'declared value.',
    'Judged on four surfaces, each against the one option list its resolver walks: an object ' +
      'field\'s `options`; an action param\'s inline `options` (a param that references a `field` ' +
      'and declares no inline list takes the field\'s list when the dialog renders, so its keys are ' +
      'not judged); a flow screen field\'s own `options`; and a picklist\'s `options` together with ' +
      'those its `picklistExtensions[]` entries add, which every field referencing the list ' +
      'inherits. A map under something that declares no options at all is read by nothing.',
    'A warning, where `translation-target-unknown` is an error: a mis-keyed option names ' +
      'something real, so its fix is a rename, not a deletion.',
  ],
};

const TRANSLATION_SECTION_NAME_MISSING_EXPLANATION: RuleExplanation = {
  rule: 'translation-section-name-missing',
  covers: 'why a section with no name cannot be translated',
  paragraphs: [
    'A section heading is translated through `objects.OBJECT._sections.NAME.label`, and every ' +
      'renderer keys the heading off `section.name` (form, modal form and `record:details` alike), ' +
      'so a section with a `label` and no `name` has no key a bundle can carry: its heading renders ' +
      'the authored label in EVERY locale.',
    'No other gate sees it. The object is translated, so every neighbouring label resolves and ' +
      'the hole is invisible; `translation-target-unknown` has no key to report as an orphan; and ' +
      'the i18n coverage report walks `sections[].name`, so a nameless section contributes nothing ' +
      'to walk and coverage reads complete.',
    'Why the renderer does not fall back to a key slugified from the label: that would fossilise ' +
      'a second contract (`_sections.SLUG_OF_LABEL`) beside the declared one, and the slug would ' +
      'move the day anyone edits the heading text. The defect is at the producer, so this rule is ' +
      'where the producer hears about it. For the same reason the name the `fix:` line suggests is a ' +
      'suggestion to write down, never a key derived from the label: the renderers look the heading ' +
      'up by name only, so renaming the heading later cannot break the lookup.',
    'A warning: the section is real and renders, and only its heading stays in the source locale. ' +
      'Judged only on an object that some `stack.translations` bundle carries a node for (a ' +
      'monolingual stack owes nobody a section name), and only on the array form of `sections`: a ' +
      'name-keyed map supplies the name from its key, and a `fieldGroups` section is keyed by ' +
      '`fieldGroups[].key`. Surfaces: a view container\'s `sections`, its default `form` and every ' +
      '`listViews.*` / `formViews.*` sub-container, on stack views and on views embedded in an ' +
      'object, and `record:details` sections anywhere in a page\'s component tree.',
  ],
};

// ── App navigation (`validate-nav-access.ts`, `validate-nav-object-servability.ts`, `validate-nav-target-refs.ts`) ──

/**
 * Why an object nav entry's grant and its servability are two findings (both
 * object-entry ids write it out).
 */
const NAV_INDEPENDENT_CONDITIONS =
  'Whether anyone is GRANTED read on a nav entry\'s object (`nav-object-ungranted`) and whether the ' +
  'object can SERVE a list at all (`nav-object-unservable`) are independent conditions, so each has ' +
  'its own finding: no permission on the entry or the object makes an API-disabled object listable, ' +
  'and an object that serves lists still refuses a caller no permission set grants read. Gating the ' +
  'entry with `requiredPermissions` or `visible` answers neither: those gate whether the entry is ' +
  'shown, not the object\'s grant or its `enable` block.';

const NAV_OBJECT_UNGRANTED_EXPLANATION: RuleExplanation = {
  rule: 'nav-object-ungranted',
  covers: 'which grants count, and why it only warns',
  paragraphs: [
    'Navigation and permissions are separate metadata, each valid on its own, so an app can put an ' +
      'object in its navigation that no permission set grants read on. The entry renders, and ' +
      'opening it fails permission-denied for every principal except one holding the platform\'s ' +
      'built-in wildcard admin set: it works when you browse as an administrator and breaks for the ' +
      'users the app ships permission sets for.',
    // The read bits and the walked containers are held to the rule by its test.
    'Read is judged through the stack\'s access matrix (ADR-0090 D6), folded across `allowRead`, ' +
      '`viewAllRecords` and `modifyAllRecords`; a wildcard grant (`objects: { \'*\': { allowRead: ' +
      'true } }`, the shape the platform\'s own admin set uses) covers every object. Walked: every ' +
      '`type: \'object\'` entry of each app\'s `navigation` and each area\'s `navigation`, nested ' +
      '`children` included. An object several entries expose is reported once.',
    NAV_INDEPENDENT_CONDITIONS,
    'A warning, not an error: a grant can legitimately live outside this stack — a permission set ' +
      'another installed package ships, a platform default, or an org-level assignment made after ' +
      'install. Not judged: a platform-provided object (`sys_user`, …), whose package ships its own ' +
      'permission sets; an object this stack does not define, whose grants are not this stack\'s to ' +
      'make; and a stack that declares no permission sets at all, whose permissions are managed ' +
      'elsewhere.',
  ],
};

const NAV_OBJECT_UNSERVABLE_EXPLANATION: RuleExplanation = {
  rule: 'nav-object-unservable',
  covers: 'why the entry cannot serve a list to anyone',
  paragraphs: [
    'An object nav entry opens a list of the object it names, and that object\'s own `enable` block ' +
      'decides whether the REST surface answers a `list` at all: `enable.apiEnabled: false` answers ' +
      '404 `OBJECT_API_DISABLED`, and an `enable.apiMethods` whitelist that does not grant `list` (an ' +
      'empty one denies everything) answers 405 `OBJECT_API_METHOD_NOT_ALLOWED`. `apiEnabled` is ' +
      'judged first, whatever the whitelist says. Both are pure functions of `enable` ' +
      '(`canServeApiOperation` in `@objectstack/spec/data`) with no user and no request in them, so ' +
      'the entry is dead for every user, platform administrators included.',
    'The server prunes such an entry from the served `/meta` payload, so a user never sees a menu ' +
      'row that cannot work, and without this rule the author would watch the entry vanish from the ' +
      'running app with no signal anywhere. The verdict names the `enable` key that condemns the ' +
      'entry, because the fix may belong at either end: remove the entry, or make the object ' +
      'listable, unless it is API-disabled on purpose (several platform objects hold credential ' +
      'material), in which case the entry is the mistake.',
    NAV_INDEPENDENT_CONDITIONS,
    // The walked containers are held to the rule by its test.
    'An error, unlike `nav-object-ungranted`: `enable` is declared on the object, in this stack, and ' +
      'only objects this stack declares are judged, so when the rule fires it has read the whole of ' +
      'the evidence. Walked: every `type: \'object\'` entry of each app\'s `navigation` and each ' +
      'area\'s `items` and `navigation`, nested `children` included. Not judged: an object this stack ' +
      'does not declare (its `enable` block is not visible from here), an interpolated target ' +
      '(`${…}`), whether the object exists at all, and an entry of any other type.',
  ],
};

const NAV_TARGET_UNRESOLVED_EXPLANATION: RuleExplanation = {
  rule: 'nav-target-unresolved',
  covers: 'which check this stands in for, and why it only warns',
  paragraphs: [
    // The three entry types and their collections are held to the rule by its test.
    'A `page`, `report` or `dashboard` nav entry names its target in `pageName`, `reportName` or ' +
      '`dashboardName`, resolved against the stack\'s `pages`, `reports` or `dashboards`. ' +
      '`defineStack`\'s own cross-reference check validates the same three, but each only when its ' +
      'collection is non-empty (`pageNames.size > 0`, `reportNames.size > 0`, ' +
      '`dashboardNames.size > 0`), so a stack that declares none of a kind has that check switched ' +
      'off: precisely the state of a stack where the target was never written. When the collection ' +
      'is non-empty, `defineStack` refuses the name first; this rule is what speaks when that check ' +
      'switched itself off, and the verdict says so.',
    'The entry renders in the sidebar and resolves to nothing when clicked. A warning, not an ' +
      'error: an object name resolves against a curated registry of platform objects, but no such ' +
      'registry exists for pages, reports or dashboards, so "unresolved" cannot be told apart from ' +
      '"provided by a package this stack cannot see". If another package provides the target, the ' +
      'warning is expected.',
    'Walked: each app\'s `navigation` and each area\'s `items` and `navigation`, nested `children` ' +
      'included; an interpolated target (`${…}`) resolves at render time and is skipped. Not ' +
      'judged: an `action` entry (`action-name-undefined` owns it), a `component` entry (an ' +
      'unregistered one renders its own named diagnostic at run time), a `url` entry (external by ' +
      'definition) and an `object` entry (`defineStack` refuses an unknown one unless it carries ' +
      '`requiresObject`).',
  ],
};

// ── Object field-name lists (`validate-object-field-refs.ts`) ──────────────

const OBJECT_FIELD_REF_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'object-field-ref-unknown',
  covers: 'which field-name lists are judged, against which object',
  paragraphs: [
    'Every field name an object writes in one of its own field-name lists, and every name one of ' +
      'its fields writes in a field-level list, must name a field of the object that list ' +
      'addresses. The schema cannot judge one (each is a bare string) and every consumer degrades ' +
      'quietly, so a miss surfaced only when a user opened a page or a picker, or never. An error, ' +
      'on the CLI and at the runtime publish gate alike: the reference is parsed, unmarked and ' +
      'silently inert (ADR-0078), and a misspelling is refused loudly at authoring.',
    // The positions are held to the rule by its test, each fired.
    'Object-level: `highlightFields` (the default list columns, record cards, previews and the ' +
      'detail highlight strip each skip the entry and render one field short); ' +
      '`publicSharing.redactFields` (the redaction fails OPEN: records served through a share link ' +
      'still carry the field, and a misspelled entry is indistinguishable from one never written); ' +
      'and `indexes[].fields` (the SQL driver skips the WHOLE index at sync, logged at error, ' +
      '`os migrate plan` reports it unbuildable, and the object keeps serving, so a `unique` index ' +
      'is then unenforced until the name is fixed). The retired `compactLayout` spelling is read at the ' +
      '`highlightFields` position on the raw `os lint` path; the parse refuses it.',
    'Field-level, each against the object its reader addresses: `relatedListColumns` against the ' +
      'object that owns the field (the related list on the parent\'s detail page lists that ' +
      'object\'s rows); `lookupColumns` and `lookupFilters[].field` against the REFERENCED object ' +
      '(the record picker\'s columns and the filter on its query); `dependsOn` against the owning ' +
      'object (the form gates this field until that one has a value, and a field the record does ' +
      'not have never gets one, so it stays gated for good) and, through `param` or the bare name, ' +
      'against the referenced object ' +
      '(the picker scopes its candidates by that key). The referenced object is judged only on ' +
      '`lookup`, `master_detail` and `user` fields, the types that render the picker, and a bare ' +
      '`dependsOn` name that misses on the owning object is reported once, there.',
    '`lookupColumns`, `dependsOn` and `indexes[].fields` are read verbatim (a picker column key, a ' +
      'record key, a physical column), so a dotted name there is one name no field carries; the ' +
      'other positions resolve a relationship path. Not judged: an object this stack does not ' +
      'define, an object with no readable field map (`external`, an introspected schema), a ' +
      'registry-injected system column (resolved per object, so `owner_id` resolves on an owned ' +
      'object and misses under `ownership: \'none\'`), and the positions other rules own: ' +
      '`searchableFields` (`searchable-field-unknown`), list views (the list-view rules) and the ' +
      'scalar role pointers.',
    'The verdict names the nearest field of the addressed object when one is close ("Did you mean"), ' +
      'and the fix line names the position\'s remedy only, without listing that object\'s fields.',
  ],
};

// ── Object-name references (`validate-object-references.ts`) ────────────────

/** The sites judged — both object-reference ids. */
const OBJECT_REFERENCE_SITES =
  'Judged: the object names no other rule resolves, each a plain string the schema ships as ' +
  'written: a `lookup`, `master_detail` or `user` field\'s `reference`; a view container\'s own ' +
  '`object`; an action param\'s `reference` and `objectOverride`; a dashboard global filter\'s ' +
  '`optionsFrom.object`; a dataset\'s base `object`; and a nav entry\'s `requiresObject`, with ' +
  'the `objectName` of an entry that carries one. Interpolated names (`${…}`) resolve at render ' +
  'time and are skipped.';

/** The resolution ladder — both object-reference ids. Held to `PLATFORM_OBJECT_PREFIXES` by the rule's test. */
const OBJECT_REFERENCE_LADDER =
  'Each name climbs one ladder: it resolves when this stack, or a package in the same artifact ' +
  '(`packages[]`, ADR-0130 D4), defines it, or when it is a known platform object ' +
  '(`PLATFORM_PROVIDED_OBJECT_NAMES` in `@objectstack/spec/system`, the objects the platform\'s ' +
  'packages, official plugins and cloud runtime register). An unresolved name with no platform ' +
  'prefix is `object-reference-unknown`, an error. An unresolved name WITH a platform prefix ' +
  '(`sys_`, `cloud_`, `ai_`) is `object-reference-unregistered-platform`: no package we know of ' +
  'registers it, but a third-party package still might, so a warning is the honest ceiling.';

/** What a miss costs, per site — both object-reference ids. Held to the rule's sites by its test. */
const OBJECT_REFERENCE_MISS_COST =
  'What a miss costs, per site. A relationship field: the record picker has no object to query, ' +
  '`$expand` has nothing to resolve, and the form renders a relationship control that can never ' +
  'resolve a value. A view container: the runtime indexes a container\'s views by this key ' +
  '(`getViewsByObject()` / `GET /meta/view?object=`), so none of its views appears for any object. An ' +
  'action param\'s `reference`: the picker degrades to a raw record-id text input. Its ' +
  '`objectOverride`: the param inherits its type and options from a field on that object, so it is ' +
  'left untyped. A dashboard filter\'s options source: the dropdown renders an always-empty filter. A ' +
  'dataset\'s base object: a dataset is the FROM of every report and dashboard widget bound to it ' +
  '(ADR-0021), so every one of them queries nothing. A nav entry\'s `requiresObject`: the entry is ' +
  'hidden unless the object is registered, so a typo hides it for good, and it suppresses the nav ' +
  'cross-reference check that would have caught the target; the gated `objectName` is exempt from ' +
  'the build-time check, so it is verified only here.';

const OBJECT_REFERENCE_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'object-reference-unknown',
  covers: 'how an object name resolves, and what a miss costs',
  paragraphs: [
    // The sites are held to the rule by its test, each fired.
    OBJECT_REFERENCE_SITES,
    OBJECT_REFERENCE_LADDER,
    'An error: a stack\'s own objects are namespace-prefixed and present, so an unprefixed name that ' +
      'resolves nowhere has no legitimate elsewhere. Nothing reports the miss at run time.',
    OBJECT_REFERENCE_MISS_COST,
    'To fix it, point the reference at an object this stack or its artifact defines, or at a platform ' +
      'object by its full name (the platform user object is `sys_user`, not `user`). The verdict names ' +
      'the nearest defined object when one is close; a view container written with an object\'s short ' +
      'name in a namespaced package is told the prefixed spelling.',
  ],
};

const OBJECT_REFERENCE_UNREGISTERED_PLATFORM_EXPLANATION: RuleExplanation = {
  rule: 'object-reference-unregistered-platform',
  covers: 'how an object name resolves, and why this rung only warns',
  paragraphs: [
    // The sites are held to the rule by its test, each fired.
    OBJECT_REFERENCE_SITES,
    // The prefixes are held to `PLATFORM_OBJECT_PREFIXES` by the rule's test.
    OBJECT_REFERENCE_LADDER,
    'If nothing provides the name at run time, the reference resolves to nothing and fails ' +
      'silently, at a cost each site spells out below. A guess by prefix alone cannot tell `sys_user` ' +
      '(real) from `sys_approval_process` (removed when approval became a flow node, ADR-0019), which is ' +
      'why the ladder reads the registry.',
    OBJECT_REFERENCE_MISS_COST,
    'So check the spelling against the object the providing package registers (the approval request ' +
      'object is `sys_approval_request`); if a third-party package genuinely provides the name, the ' +
      'warning is expected.',
  ],
};

// ── Capability references (`validate-capability-references.ts`) ───────────

const CAPABILITY_REFERENCE_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'capability-reference-unknown',
  covers: 'where a capability may come from, and why it only warns',
  paragraphs: [
    'A `requiredPermissions` entry names a capability the caller must hold. It is a free string, so ' +
      'a typo (`mange_users` for `manage_users`) parses and fails CLOSED at run time: the gate denies ' +
      'its callers, the safe direction, and nothing tells the author the capability exists nowhere.',
    // The three sources are held to the rule by its test, each one silencing it.
    'A capability is known when it is a built-in platform capability, when the stack declares it ' +
      'with `defineCapability` (`stack.capabilities`, ADR-0066 D1), or when a permission set in the ' +
      'stack grants it through `systemPermissions` (granting declares it). A seed row is no source: ' +
      'no runtime reader consults one, so ship the capability with `defineCapability` instead. ' +
      '`systemPermissions` itself is never reported: it is the declaration side.',
    // The positions are held to the rule by its test, each fired.
    'Judged at every position the key is declared: an object\'s `requiredPermissions` (the array ' +
      'form, or each operation of the per-operation map), each field\'s, each object action\'s and ' +
      'each top-level action\'s, each flow\'s, an app\'s and each of its nav entries (through `navigation`, ' +
      '`areas`, `tabs`, `children` and `items`), a view\'s (its own, its `config`\'s, its default ' +
      '`list`\'s and each `listViews` entry\'s, on views and on objects) and a dashboard\'s.',
    'A warning, not an error: one package\'s lint cannot see the capabilities other installed ' +
      'packages declare, and the reference fails closed anyway, so a dangling one is almost ' +
      'certainly a typo to surface, not a build to break. If another installed package declares the ' +
      'capability, the warning is expected: leave the reference as it is.',
  ],
};

// ── Object list view mode (`validate-list-view-mode.ts`) ─────────────────────

const LIST_VIEW_FILTERS_IN_VIEWS_MODE_EXPLANATION: RuleExplanation = {
  rule: 'list-view-filters-in-views-mode',
  covers: 'why page filter controls do nothing on an object view',
  paragraphs: [
    'An object\'s list views render in "views" mode: the ViewTabBar owns navigation, one segmented ' +
      'tab per named `listViews` entry. Two page filters-mode controls collide with it and are ignored ' +
      'there (ADR-0047): `quickFilters`, and `userFilters` with `element: "tabs"` or a `tabs` list.',
    'To fix it, pick what the control was for. Named presets on the object are `listViews` entries, ' +
      'each one a tab of the bar; value chips over a field are `userFilters` with `element: ' +
      '"dropdown"`, which an object view does allow; and quick filters or a filters-mode tab strip ' +
      'belong on a page list (InterfaceListPage, "filters" mode), where no ViewTabBar is drawn.',
  ],
};

// ── Liveness ledgers (`lint-liveness-properties.ts`) ─────────────────────────

const LIVENESS_LEDGER_UNREADABLE_EXPLANATION: RuleExplanation = {
  rule: 'liveness-ledger-unreadable',
  covers: 'why a missing liveness ledger switches warnings off',
  paragraphs: [
    'A metadata type\'s author warnings about declared-but-inert properties are read from its ' +
      'liveness ledger, the `TYPE.json` file `@objectstack/spec` ships in its `liveness/` directory. ' +
      'When that file is missing, or does not parse as a ledger, every such warning for the type is ' +
      'switched off, and this finding is reported once per run for the type.',
    'This is a packaging fault in the platform, not an authoring error: nothing in the metadata being ' +
      'linted caused it, and the rule\'s silence about that type means nothing until it is fixed. ' +
      'Reinstall or repair `@objectstack/spec` so its `liveness/` directory ships intact.',
  ],
};

// ── Page field bindings (`validate-page-field-bindings.ts`) ──────────────────

const PAGE_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'page-field-unknown',
  covers: 'how a page binding names a field',
  paragraphs: [
    'A page component binds fields by name, and each name must match one of the bound object\'s ' +
      'declared fields, or a system field, exactly: a misspelt or renamed field resolves to nothing, ' +
      'at the cost the message names.',
    'To fix it, correct the name (the `fix:` line names the nearest declared field when one is ' +
      'close) or add the field to the object. Not judged here: a dotted relationship path ' +
      '(`account.name`), which the query engine resolves, and an object this stack does not define.',
  ],
};

const PAGE_SECTION_COUNT_NOT_MULTI_VALUE_EXPLANATION: RuleExplanation = {
  rule: 'page-section-count-not-multi-value',
  covers: 'which fields a section heading can count',
  paragraphs: [
    'A section heading\'s `{{ count }}` counts the values of the field the section is bound to. On a ' +
      'single-value field it can only ever read 0 or 1: a number that looks like a count and is not one.',
    'A multi-value field is `multiselect`, `checkboxes` or `tags`, or a `select`, `lookup`, `user`, ' +
      '`file` or `image` field declared with `multiple: true`. Count one of those; to show a single ' +
      'value, list the field in the section\'s `fields` instead. Not reported: a dotted relationship ' +
      'path, or a field whose type this stack cannot resolve.',
  ],
};

const PAGE_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'page-field-unprovisioned',
  covers: 'why a page binding on an unprovisioned anchor is blank',
  paragraphs: [
    UNPROVISIONED_ANCHOR_CAUSE,
    'A page component that binds such an anchor reads a column that holds nothing, at the cost the ' +
      'message names for its position: a display binding renders blank on every record, a query ' +
      'predicate can never match a real value (on SQLite it degrades to constant-false and the ' +
      'surface reads as "there is no data"), and a field a section heading counts reads 0 on every ' +
      'record. A `kind: \'react\'` page\'s blocks are judged the same way, under the same id.',
    'Only a name that resolved BECAUSE it is injected is judged — an author-declared column of the ' +
      'same name is one the author vouches for — and a dotted relationship path is not judged. The rule ' +
      'is a warning in every position, the query one included, where a genuinely missing field is an ' +
      'error: it cannot see the remote table, only that the platform provisions no storage.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

/**
 * What a section's `group` reference is, the half the two section-group ids
 * (`page-section-group-unknown`, `form-section-group-unknown`) share. Their
 * one-line `fix:` comes from one helper, `checkSectionGroupRefs()`.
 */
const SECTION_GROUP_REFERENCE: readonly string[] = [
  'A layout section may name one of its object\'s declared field groups instead of listing its ' +
    'members: `{ group: \'contact_info\' }`. The section then inherits its members and presentation ' +
    'from the object\'s `fieldGroups` entry with that key (ADR-0085 §5). A section either names a ' +
    'group or enumerates `fields`, never both, so a key that matches no declared group leaves it with ' +
    'no members, and the whole section silently does not render.',
  'The key is judged against the groups the bound object DECLARES (`fieldGroups[].key`), not the ' +
    'ones the layout derives: a declared group no visible field joins is a different question. An ' +
    'object this stack does not define is not judged. The rule is a warning: the section is missing ' +
    'on screen, and no query reads the key.',
  'To fix it, correct the key (the `fix:` line names the nearest declared group when one is close), ' +
    'or declare the group on the object — `fieldGroups: [{ key, label }]` — and set `group` to that ' +
    'key on each field that belongs in it: membership is declared on the FIELD, never on the group. ' +
    'An object with no field groups yet can take the members as the section\'s `fields` list instead.',
];

const PAGE_SECTION_GROUP_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'page-section-group-unknown',
  covers: 'how a page section inherits a field group',
  paragraphs: [
    ...SECTION_GROUP_REFERENCE,
    'On a page the reference is a `record:details` section\'s `group`, resolved against the object ' +
      'the component binds (its `dataSource.object`, then `properties.object`, then the binding it ' +
      'inherits from its container, then the page\'s `object`).',
  ],
};

const FORM_SECTION_GROUP_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'form-section-group-unknown',
  covers: 'how a form section inherits a field group',
  paragraphs: [
    ...SECTION_GROUP_REFERENCE,
    'On a form view the reference is a section\'s `group`, in `sections` and in the legacy `groups` ' +
      'alias alike, resolved against the object the form binds (its own `objectName`, `object` or ' +
      '`data.object`, else its container\'s, else the container\'s list binding).',
  ],
};

// ── Flow template paths (`validate-flow-template-paths.ts`) ───────────────────

const FLOW_TEMPLATE_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'flow-template-field-unprovisioned',
  covers: 'why a template hole on an unprovisioned anchor is empty',
  paragraphs: [
    UNPROVISIONED_ANCHOR_CAUSE,
    'A `{{ record.<anchor> }}` hole in a flow node\'s text — a notify title or body, an http body — on ' +
      'a flow triggered by such an object renders from the flow record, where the anchor carries no ' +
      'value: the hole renders an empty string on every run, and nothing reports it.',
    'Only the trigger root is judged: the injected columns are read off the start node\'s object, and ' +
      'a flow variable a `get_record` node binds has no counterpart. A CRUD node\'s `filter` operand is ' +
      'a value slot, not a template, and is not scanned. The rule is a warning because it cannot see ' +
      'the remote table, only that the platform provisions no storage.',
    UNPROVISIONED_ANCHOR_REMEDY,
  ],
};

const FLOW_TEMPLATE_LOOKUP_TRAVERSAL_EXPLANATION: RuleExplanation = {
  rule: 'flow-template-lookup-traversal',
  covers: 'why a lookup hop in a template renders empty',
  paragraphs: [
    'A flow record carries a relationship field (`lookup`, `master_detail`, `user` or `tree`) as its ' +
      'foreign-key id, a scalar, not as the related record, so a `{{ record.<lookup>.<field> }}` hole ' +
      'walks `.<field>` on a string id and renders an empty string at run time, with no error. The same ' +
      'holds for a record a `get_record` node reads into a flow variable. A trailing numeric segment ' +
      '(`{{ record.target_channels.0 }}`) indexes a `multiple` lookup and is not a hop, and a sub-path ' +
      'on any other field type is left alone.',
    'On the trigger root the start node can opt in: `config.expand` names relations (a string or a ' +
      'list), and the engine re-reads the triggering record with those relations expanded, one hop ' +
      'deep, as the run\'s identity, so the related object\'s record and field access rules apply as ' +
      'the run. A hop through a relation named there resolves and is not reported.',
    '`config.expand` is the start node\'s opt-in and covers the trigger record alone: a record read ' +
      'into a flow variable is never expanded, so the `fix:` line on a variable root does not ' +
      'prescribe it.',
    'To fix it, reference the foreign-key id itself (`{{ record.<lookup> }}`), project the related ' +
      'value onto this object with a formula field and reference that, read the related record with a ' +
      '`get_record` node and reference its fields, or — on the trigger root — add the relation to the ' +
      'start node\'s `config.expand`. The rule is a warning: the run completes, with a blank where the ' +
      'value should be.',
  ],
};

// ── Flow reference syntax (`lint-flow-patterns.ts`) ──────────────────────────

/** Where a flow node reads `{{ }}`, shared by the two wrong-syntax entries. */
const FLOW_TEXT_SLOTS =
  'Double-brace `{{ }}` is the template dialect of a flow\'s text slots only: a notify `title` / ' +
  '`message` / `actionUrl`, an http `url` and `headers` values, a screen `title` / `description`, an ' +
  '`end` `message`.';

/** The literals and every other config value, shared by the two wrong-syntax entries. */
const FLOW_LITERALS =
  'A node\'s literals (a notify `sourceObject`, `actorId` and `payload`; an http `method`, `durable`, ' +
  '`timeoutMs` and `signingSecret`) and every config value outside the text and value slots are read as ' +
  'written: neither `{var}` nor `{{ }}` resolves there, and nothing evaluates a reference, braced or ' +
  'bare. A brace token in a literal is refused at `objectstack validate` and `registerFlow`, and in ' +
  '`signingSecret`, whose secret the flow credential store may hold, by the executor\'s parse. Write ' +
  'the value itself.';

/** What the spelling on the `fix:` line does not show, shared by the two wrong-syntax entries. */
const FLOW_CEL_CAVEATS =
  'Two CEL facts the spelling does not show. CEL refuses an absent variable or key where the template ' +
  'wrote nothing, so guard one that may be absent with `has()`, a step at a time from `vars`, which ' +
  'holds only the variables the run has bound: `has(vars.a) && has(vars.a.b) ? vars.a.b : null`, which ' +
  'writes (or, to a callee, hands) `null` where the template wrote nothing. And text with holes is one ' +
  'CEL concatenation: wrap a hole that is not a string in `string(…)`, and one that may be null in ' +
  '`coalesce(…, \'\')`, because CEL refuses `+ null`.';

/** A CRUD node's filter operand, shared by the two wrong-syntax entries. */
const FLOW_FILTER_OPERAND =
  'A filter operand envelope is evaluated before the query. One that evaluates to `null` refuses the ' +
  'node, because an absent condition does not narrow a query, it widens it; so where the value may be ' +
  'absent, route around the node with a `decision` rather than guarding it.';

/** Where an envelope at the string's place would not evaluate, shared by the two wrong-syntax entries. */
const FLOW_NO_ENVELOPE_POSITIONS =
  'Where an envelope at the string\'s own place would not evaluate, the `fix:` line names none. A ' +
  'string inside an object or list literal is stored as the object it spells, so compute the whole ' +
  'value as one CEL envelope that builds a CEL map or list literal with this string\'s spelling at its ' +
  'place (wrap each entry in `dyn(…)` where literal and computed values mix). A legacy `assignment` ' +
  'shape (the `assignments: [{ variable, value }]` array, or variables written as the config\'s own ' +
  'keys) evaluates nothing, so move the assignments into the canonical `assignments: { … }` map and ' +
  'write the envelope there.';

const FLOW_DOUBLE_BRACE_INTERPOLATION_EXPLANATION: RuleExplanation = {
  rule: 'flow-double-brace-interpolation',
  covers: 'where `{{ }}` is a template, and what replaces it',
  paragraphs: [
    FLOW_TEXT_SLOTS + ' Anywhere else in a node\'s config a `{{ }}` renders nothing: the string is stored ' +
      'or sent as the literal text it spells.',
    'A value slot (a record write\'s `fields`, an `assignment` value, a filter operand, a callee\'s ' +
      'input map, a screen\'s prefill or record id, an http `body`) reads a CEL value envelope, ' +
      '`{ dialect: \'cel\', source: \'…\' }`, and no template: the value-slot refusal reads a `{{ }}` ' +
      'string\'s outer braces as literal text, so the build refuses it, and the spelling that refusal ' +
      'gives keeps the braces as text. The `fix:` line names the value-slot judge\'s own spelling of ' +
      'the holes the string means instead: each `{{ x }}` hole is the CEL path `x`.',
    FLOW_NO_ENVELOPE_POSITIONS,
    FLOW_CEL_CAVEATS,
    FLOW_FILTER_OPERAND,
    FLOW_LITERALS,
  ],
};

const FLOW_BARE_DOLLAR_REFERENCE_EXPLANATION: RuleExplanation = {
  rule: 'flow-bare-dollar-reference',
  covers: 'how a bare `$` reference is written in each slot',
  paragraphs: [
    'A bare `$name.path` in a flow node\'s config is never resolved: it is stored or sent as the ' +
      'literal text it spells. How to write the reference depends on the slot the string sits in.',
    'In a text slot (where `{{ }}` is the template; `os explain flow-double-brace-interpolation` ' +
      'lists them) it becomes a hole, `{{ $error.message }}`, when the flow engine binds its `$` root. ' +
      'A hole over any other `$` name is refused: a variable the flow binds itself (a declared ' +
      'variable, an `assignment` target, an `outputVariable`, a `try_catch` `errorVariable`) is ' +
      'written without the `$`, and any other value is computed into a variable with an `assignment` ' +
      'node and written `{{ v }}`.',
    'In a value slot (a record write\'s `fields`, an `assignment` value, a filter operand, a ' +
      'callee\'s input map, a screen\'s prefill or record id, an http `body`) the reference is the CEL ' +
      'value envelope the spec\'s value-slot judge spells for the `{…}` token it names, and the ' +
      '`fix:` line carries that spelling: a `$` root the engine binds reads as that variable ' +
      '(`$error.message` is `vars["$error"].message`), and any other `$` root names the flow\'s own ' +
      'variable, written without the `$` (`$source.id` is `source.id`).',
    'The run user, `$User.Id`, is `current_user.id`. In a flow that can run without a user (a ' +
      'schedule, or a record change made by a system write) `current_user` is `null` and that read ' +
      'fails the run, so write `current_user != null ? current_user.id : null` there; the guarded form ' +
      'writes `null` where the template wrote nothing, which on `update_record` clears a stored value ' +
      'the template left alone. In a text slot, compute it into a variable with an `assignment` node ' +
      '(`assignments: { v: { dialect: \'cel\', source: \'current_user.id\' } }`) and write `{{ v }}`. ' +
      'Any other `$User` path never resolved: `current_user` carries only `id`, `positions`, ' +
      '`organizationId` and `isPlatformAdmin`, so read the user record by `current_user.id` with a ' +
      '`get_record` node (`objectName: \'sys_user\'`) and read the field off its `outputVariable`.',
    FLOW_NO_ENVELOPE_POSITIONS,
    FLOW_CEL_CAVEATS,
    FLOW_FILTER_OPERAND,
    FLOW_LITERALS,
  ],
};

// ── Flow anti-patterns (`lint-flow-patterns.ts`) ─────────────────────────────

/** The minimal `catch` region, shared by the two containment entries; its `fix:` lines spell the same region. */
const FLOW_MINIMAL_CATCH =
  'A `catch` region cannot be empty: its `nodes` is `.min(1)`, so `catch: {}` and `catch: { nodes: [] }` are ' +
  'both refused by the parse. The shortest handler that works is one bare `assignment` node with no `config`, ' +
  '`catch: { nodes: [ { id: \'handled\', type: \'assignment\', label: \'Handled\' } ] }`; the region\'s `edges` ' +
  'may be omitted, and so may the `try_catch` node\'s `errorVariable`, which defaults to `$error`.';

/** Where the containment pattern is written out, shared by the two containment entries. */
const FLOW_CONTAINMENT_DOCS =
  'The pattern is written out in content/docs/automation/flows.mdx §"Per-iteration containment".';

const FLOW_LOOP_BODY_UNCONTAINED_EXPLANATION: RuleExplanation = {
  rule: 'flow-loop-body-uncontained',
  covers: 'why a loop body needs its own `try_catch`',
  paragraphs: [
    'A node counts as one that can fail when its executor can end a run for a reason not knowable at ' +
      'authoring time (an absent row, a refused write, a 500, a connector outage, a child flow that died): ' +
      '`get_record`, `create_record`, `update_record`, `delete_record`, `http`, `notify`, ' +
      '`connector_action`, `script`, `subflow`, `map` and `approval`. A node type outside that list, a ' +
      'plugin\'s included, is not judged.',
    'Containment is judged by ancestry, not depth: a `try_catch` anywhere between the loop and the node ' +
      'contains it, a `parallel` branch is walked through, and a nested `loop` is judged on its own, so each ' +
      'node is reported once, against its innermost loop. A `try_catch` with no `catch` counts as containment ' +
      'here, because `flow-try-catch-without-catch` reports it and names the missing key. A `loop` with no ' +
      '`body` (the legacy flat-graph form) is not judged.',
    FLOW_MINIMAL_CATCH + ' Measured with that handler, a 5-item sweep whose 3rd item fails processes all 5 ' +
      'items and the run completes.',
    'A loop that is meant to stop at its first failure is a legitimate reading, so this is a warning and ' +
      'never fails a build. ' + FLOW_CONTAINMENT_DOCS,
  ],
};

const FLOW_TRY_CATCH_WITHOUT_CATCH_EXPLANATION: RuleExplanation = {
  rule: 'flow-try-catch-without-catch',
  covers: 'why a `try_catch` with no `catch` contains nothing',
  paragraphs: [
    'Reported wherever the node sits, at any depth of the flow. A `catch` that is present but malformed is ' +
      'refused by the parse itself, with the schema\'s own message, so it is not reported here. Inside a ' +
      '`loop` body, `flow-loop-body-uncontained` counts any enclosing `try_catch` as containment, so a ' +
      'catch-less one is reported once, here, where the missing key can be named.',
    FLOW_MINIMAL_CATCH,
    'If failing loudly is the intent, a `try_catch` with only `try` (and optionally `retry`) is a legitimate ' +
      'retry-then-fail shape, so this is a warning and never fails a build. ' + FLOW_CONTAINMENT_DOCS,
  ],
};

const FLOW_MULTI_WRITE_UNFILTERED_EXPLANATION: RuleExplanation = {
  rule: 'flow-multi-write-unfiltered',
  covers: 'when a bulk write is bounded by nothing',
  paragraphs: [
    'A filter carries no condition when the key is absent, when it is `{}`, or when the Filter Protocol\'s ' +
      'identity reduction (the one the SQL, MongoDB and memory drivers execute) resolves it to true, such as ' +
      '`{ $and: [] }`; a filter the reduction cannot resolve is not reported. Only `multi: true` itself ' +
      'declares bulk intent: a `multi: \'true\'` string is refused by the parse.',
    'The worked example is examples/app-showcase `showcase_inquiry_purge`, whose bulk delete is bounded by ' +
      'a predicate. If emptying or rewriting the whole object really is the intent, keep the node: ' +
      '`multi: true` is how a flow declares bulk intent, and the engine admits a whole-object write declared ' +
      'that way, so this is a warning, not a gate, and the run-time path stays open.',
    'Distinct from the run-time erased-condition guard, which REFUSES this node at run time when a condition ' +
      'you WROTE evaluated to nothing: that guard is keyed on "a written condition is gone" and deliberately ' +
      'not on "the filter is empty", which is the fact this rule judges at authoring time.',
  ],
};

const FLOW_DECISION_INCLUSIVE_OVERLAP_EXPLANATION: RuleExplanation = {
  rule: 'flow-decision-inclusive-overlap',
  covers: 'when an inclusive decision runs more than one branch',
  paragraphs: [
    'An edge-branched decision is exclusive by default: with `mode` omitted, the first out-edge whose ' +
      'condition holds, in declaration order, wins, and an `isDefault: true` edge runs only when none did. ' +
      'Keep `mode: \'inclusive\'` only where running every matching branch is the intent. The rule cannot ' +
      'prove the conditions disjoint over CEL, so it is a warning and never fails a build.',
    'Counted over conditioned out-edges only: a `fault` edge is error routing, and an `isDefault` edge opens ' +
      'only when nothing else did, so one conditioned edge beside a default is not reported (there the two ' +
      'modes cannot differ).',
    // Named as the bare command, the way descriptive prose names it: a quoted
    // `--from N` marker is judged as a prescription by the spec class pin
    // `shared/retired-key-migrate-sentence.test.ts`, and this is not one.
    'A flow authored against protocol major 17 and converted by `os migrate meta` carries ' +
      '`mode: \'inclusive\'` wherever two or more conditioned out-edges left a decision (the ' +
      '`flow-decision-mode-inclusive-explicit` conversion writes it so the run does not change ' +
      'silently): delete it where the branches partition.',
  ],
};

const FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED_EXPLANATION: RuleExplanation = {
  rule: 'flow-approval-revise-target-not-service-owned',
  covers: 'why the revise window is an `approval_revise` node',
  paragraphs: [
    'The revise window is ended by `POST /api/v1/approvals/requests/:id/resubmit`, not by a signal, so a ' +
      '`waitEventConfig` on it has nothing to wait for: drop it when retyping the node.',
    'ADR-0044 D3 originally said `wait` here; its 2026-07-28 amendment reversed that, because a `wait` is ' +
      'resumable by anyone with the run id, while the run-resume route continues a pause on a service-owned ' +
      'node type only through the service that owns it. `sendBack` refuses any other target before it ' +
      'changes anything, which is why this fails the build.',
    'The whole loop: the `revise` edge reaches the `approval_revise` node, whose resubmit edge returns to ' +
      'the approval marked `type: \'back\'`, and `maxRevisions` bounds it. examples/app-showcase ' +
      '`showcase_budget_approval` is the reference shape.',
  ],
};

const FLOW_TIME_RELATIVE_ANTIPATTERN_EXPLANATION: RuleExplanation = {
  rule: 'flow-time-relative-antipattern',
  covers: 'why a date equality on a record trigger misfires',
  paragraphs: [
    'Reported on a `record-*` trigger whose start condition puts a time function (`daysFromNow`, `daysAgo`, ' +
      '`today`, `now`, `date`, `datetime`) beside `==` or `!=`, on either side. Range comparisons (`>=`, ' +
      '`<=`) are not reported: they are the building block of the correct shape. A `schedule` trigger is not ' +
      'judged.',
    'The robust shape is a daily sweep. Declared, it is a `schedule` flow whose start node carries a ' +
      '`config.timeRelative` descriptor (the object, the date field, and `withinDays` or `offsetDays`): it is ' +
      'swept daily and runs once per record whose date falls in the window. Hand-written, it is a daily ' +
      '`schedule` flow whose `get_record` filters the date field with a range (`$gte` / `$lt`), never an ' +
      'equality (`os explain flow-date-equality-filter`).',
    'Either way the run has no trigger user, so a sweep that reads or writes records declares ' +
      '`runAs: \'system\'` (`os explain flow-runas-unscoped`).',
  ],
};

const FLOW_DATE_EQUALITY_FILTER_EXPLANATION: RuleExplanation = {
  rule: 'flow-date-equality-filter',
  covers: 'why a date filter needs a window, not an equality',
  paragraphs: [
    'Reported for a field bound directly to a time-function value (an implicit equality), or through `$eq` ' +
      'or `$in`, inside `$and` / `$or` too. Range operators (`$gte`, `$gt`, `$lte`, `$lt`) and `$ne` are the ' +
      'correct shape and are never reported.',
    'A one-day window, `{ $gte: daysFromNow(N), $lt: daysFromNow(N+1) }`, matches the whole day, and ' +
      'abutting windows tile the timeline, so with several tiers wrapped in `$or` each row matches exactly ' +
      'once.',
    'A T-minus rule can declare the sweep instead: a `schedule` flow whose start node carries a ' +
      '`config.timeRelative` descriptor with `offsetDays` runs once per record on each offset day.',
  ],
};

const FLOW_RUNAS_UNSCOPED_EXPLANATION: RuleExplanation = {
  rule: 'flow-runas-unscoped',
  covers: 'why a flow with no trigger user runs as `system`',
  paragraphs: [
    '`runAs` is enforced (ADR-0049, ADR-0073 D5): `\'user\'`, the default when none is declared, scopes each ' +
      'data operation to the triggering user\'s grants, and with no trigger user the runtime refuses the ' +
      'operation rather than run it unscoped. A schedule, time-relative or api trigger provably resolves no ' +
      'user, so a flow with a data node anywhere in it, a `loop` body included, can never complete; that is ' +
      'why this fails the build. A flow with no data node is not reported.',
    '`runAs: \'system\'` makes the elevation explicit: the run reads and writes every record. Except behind an ' +
      'anonymous door: publish refuses `system` on a flow that an `authRequired: false` endpoint of type ' +
      '`flow` triggers (ADR-0138 D2b); serve that caller through an authenticated endpoint, the flow\'s ' +
      'signed inbound hook, or a public form.',
    'A record-change flow fired by a write that carried no user meets the same refusal, but whether a write ' +
      'carries a user is not knowable at authoring time, so that case is refused at run time only.',
  ],
};

const FLOW_DECISION_MODE_INVALID_EXPLANATION: RuleExplanation = {
  rule: 'flow-decision-mode-invalid',
  covers: 'which `mode` a decision takes',
  paragraphs: [
    'With `mode` omitted, an edge-branched decision is exclusive: the first out-edge whose condition holds, ' +
      'in declaration order, wins. `mode: \'inclusive\'` takes every out-edge whose condition holds. A ' +
      '`conditions` list is first-match on its own and takes no `mode`, so a legal `mode` beside a non-empty ' +
      '`conditions` list is refused as well: it would be accepted and never read.',
    'The finding is the spec\'s own `DecisionConfigSchema` issue, and `registerFlow` refuses this flow with ' +
      'the same sentence, so it can never arm; that is why this fails the build. Fix the node in the flow ' +
      'definition.',
  ],
};

const FLOW_DECISION_UNCONDITIONAL_BRANCH_EXPLANATION: RuleExplanation = {
  rule: 'flow-decision-unconditional-branch',
  covers: 'how a decision gates its out-edges',
  paragraphs: [
    'An out-edge is gated by a `condition`, by `isDefault: true` (taken only when no sibling condition ' +
      'matched, the BPMN default flow), or by a `label` the decision selects through a matching ' +
      '`config.conditions[].label`. Declare the branching one way and one way only.',
    'If the unconditional fan-out is what you meant, drop `type: \'decision\'` and use the node it already ' +
      'behaves as. Both shapes stay warnings: one guarded and one unconditional out-edge is a legal "maybe ' +
      'notify, always continue" fan-out, and an all-unconditional decision is that same fan-out under a ' +
      'mis-chosen node type.',
    'Not reported here: a decision routing by `config.conditions[]` labels alone has declared its branching ' +
      'on the node, and a declared label no out-edge carries is `flow-branch-label-unmatched`. A `fault` edge ' +
      'is error routing and never counts as a branch.',
  ],
};

const FLOW_ERROR_LABEL_NOT_FAULT_EXPLANATION: RuleExplanation = {
  rule: 'flow-error-label-not-fault',
  covers: 'which failures a `fault` edge routes',
  paragraphs: [
    'Only runtime failures route through a `fault` edge. A guard refusal (a filter token that resolved to ' +
      'nothing, a missing required config key, an unscoped run) stays fatal by design and must be fixed in ' +
      'the metadata, not handled.',
    'The labels read as an error path are `error`, `fault`, `failure`, `failed`, `catch`, `on_error`, ' +
      '`onerror` and `on error`, compared trimmed and case-insensitively. Not reported: an edge that is ' +
      'already `type: \'fault\'`, an edge with a `condition`, and an edge out of a `decision`, `approval`, ' +
      '`screen` or `try_catch` node, which picks its out-edge by label, so the label is load-bearing there.',
  ],
};

const FLOW_BRANCH_LABEL_UNMATCHED_EXPLANATION: RuleExplanation = {
  rule: 'flow-branch-label-unmatched',
  covers: 'how a decision label selects its out-edge',
  paragraphs: [
    'Labels are compared trimmed and case-insensitively. Use one mechanism per decision, never both: ' +
      '`config.conditions[]` with an out-edge whose `label` matches each declared branch, or branching on the ' +
      'out-edges themselves (a `condition` per branch plus `isDefault: true` on the fallback).',
    'No reading of this metadata routes what it says, on any run, and the run completes green having taken ' +
      'the wrong path, so this fails the build. A stored flow authored before the rule still reaches run ' +
      'time, where the engine warns when it meets the shape.',
  ],
};

// ── Name-bound action references (`validate-action-name-refs.ts`) ──────────

const ACTION_NAME_UNDEFINED_EXPLANATION: RuleExplanation = {
  rule: 'action-name-undefined',
  covers: 'which surfaces bind an action by name, and how it resolves',
  paragraphs: [
    // The surfaces are held to the rule by its test, each fired.
    'These surfaces bind an action by NAME rather than by its `locations`, each through a plain ' +
      'string the schema cannot check: a list view\'s `rowActions`, `bulkActions` and each ' +
      '`bulkActionDefs` entry with `execution: \'aggregate\'` (on a view\'s default `list`, each ' +
      '`listViews` entry, and an object\'s own `listViews`); a `record:quick_actions` component\'s ' +
      '`actionNames`; a `record:alert` call-to-action (`action.actionName`); a `page:header`\'s ' +
      '`actions`; a `record:related_list`\'s `actions`; an `action` nav entry\'s ' +
      '`actionDef.actionName`; and an `object` nav entry\'s deep-link `runAction`.',
    'A name resolves when any action in the stack carries it: a `stack.actions` entry or an entry ' +
      'of any object\'s `actions`. The runtime ships no built-in action names (`list_toolbar` and ' +
      '`list_item` are locations, not actions), so a name that resolves nowhere is dead: most ' +
      'surfaces draw a button that does nothing when clicked, the alert drops its call-to-action ' +
      'without a word, and the header draws no button, with only a browser-console warning. An ' +
      'error: there is no cross-package escape to soften it with, and an action another installed ' +
      'package contributes is the one legitimate miss.',
    'To fix a miss, define the action — a `stack.actions` entry or an entry of the object\'s `actions` — ' +
      'placed where the surface looks for it, or remove the reference. A `page:header` draws only actions ' +
      'placed at `record_header` or `record_more`, so a header action needs one of the two in its ' +
      '`locations`; the selection bar and an alert\'s call-to-action place an action by name, with no ' +
      '`locations` entry.',
    // The drawn locations are held to the rule by its test, over every location.
    'A `record:related_list` is the exception, and resolves the way its renderer does: against the ' +
      'RELATED object\'s own actions (written on it, or a `stack.actions` entry bound to it by ' +
      '`objectName`), never the page\'s object or a global action, and only an action placed at a ' +
      'location the list draws (`list_toolbar` as a header button, `list_item` and `record_related` ' +
      'as a row-menu item): naming it in `actions` is not a placement. An id that misses either test ' +
      'draws no button, only a refusal notice above the list. So define the action on the related ' +
      'object (in its `actions`, or in `stack.actions` with `objectName` naming it) with one of those ' +
      'locations, or name one of the related object\'s own actions; ignore the error only if another ' +
      'installed package binds the action to that object. A related object this stack does not ' +
      'define is not judged: its actions live in another package.',
    'Not judged elsewhere: whether a view\'s action belongs to the view\'s own object, and whether ' +
      'it declares the location the surface filters on. Both are real but distinct questions, and ' +
      'only the related list answers them itself.',
  ],
};

// ── Import mapping targets (`validate-mapping-target-fields.ts`) ───────────

const MAPPING_TARGET_FIELD_UNKNOWN_EXPLANATION: RuleExplanation = {
  rule: 'mapping-target-field-unknown',
  covers: 'what an import mapping target may name',
  paragraphs: [
    'An import mapping\'s `fieldMapping[].target` names the field of its `targetObject` a column ' +
      'is written into. The import endpoint refuses a mapping with a target it cannot write before ' +
      'any row, on the dry run and the commit alike (`INVALID_FIELD`), so the mapping imports ' +
      'nothing; this rule reports the same target when the mapping is written, so the author meets ' +
      'the refusal at `os validate` rather than at the first import. An error: no reading of the ' +
      'mapping behaves as written.',
    'One verdict, two doors: what a target may name is decided by `unknownImportMappingTargets` ' +
      '(`@objectstack/spec/data`), which the import endpoint calls too, so the two never disagree ' +
      'about a name. A target may name a field the object declares (fields an `objectExtensions` ' +
      'entry merges into it included, from this stack or a sibling package of the same artifact), a ' +
      'column the platform provisions on it (`id`, `owner_id`, `organization_id`, the audit ' +
      'family), or a declared PART of a compound field (`mailing_address.street`): the endpoint ' +
      'assembles the parts one row maps into the field\'s one value.',
    'Refused besides a name that is no field: a part the field\'s value does not declare, a dotted ' +
      'target on a field with no parts (a dotted target never traverses a reference: map the column ' +
      'to the reference field with transform `lookup`, which resolves the cell\'s display text to a ' +
      'record id), and a part of a field the same mapping also writes whole (one row carries one ' +
      'value for a field, so the two collide). Not judged: a mapping whose `targetObject` this ' +
      'stack does not define, an object with no readable field map, and fields plugin code injects ' +
      'at run time, which the import endpoint still judges.',
  ],
};

// ── View container shape (`validate-view-containers.ts`) ───────────────────

const VIEW_CONTAINER_SHAPE_EXPLANATION: RuleExplanation = {
  rule: 'view-container-shape',
  covers: 'what the stack views collection carries',
  paragraphs: [
    'The stack\'s `views:` collection carries view CONTAINERS (`defineView`): `{ list, form, ' +
      'listViews, formViews }`, every slot optional. A container with none of them set is ' +
      'schema-valid, the loader expands no view from it, and the Console renders nothing for it ' +
      '(no switcher entry).',
    'A flat list-view object (`{ name, type, columns, data }` where the slots belong) and a ViewItem ' +
      'record (`viewKind` with `config`) are single views, not containers. `ViewSchema` is strict, ' +
      'so `defineStack` refuses either by name, and the registration loop refuses them too ' +
      '(`isViewContainerShaped`, 422 `INVALID_METADATA`): the stack schema, this rule and the loop ' +
      'hold `views:` to one container-only contract. This rule needs no parsed stack, so it speaks ' +
      'on the doors the parse never reaches: `os lint` on a raw config, ' +
      '`defineStack(config, { strict: false })` and direct API callers.',
    '`viewItems:` is the machine-assembled channel for non-container view artifacts in a ' +
      'runtime-assembled manifest (a package export, an environment artifact), never an authoring ' +
      'surface: the stack schema types it `never`, and a hand-authored one is reported here for the ' +
      'doors that do not parse. A standalone view is authored through the metadata door (Studio or ' +
      '`PUT /api/v1/meta/view`), not in stack source.',
  ],
};

// ── Source-tier page styling (`validate-page-source-styling.ts`) ────────────

const PAGE_SOURCE_CLASSNAME_TAILWIND_EXPLANATION: RuleExplanation = {
  rule: 'page-source-className-tailwind',
  covers: 'why Tailwind classes in page source produce no CSS',
  paragraphs: [
    'A `kind: \'html\'` or `\'react\'` page\'s `source` is runtime metadata, and the ' +
      'Console\'s Tailwind build scans only the renderer\'s own source, never an authored page string. ' +
      'So a Tailwind `className` in page source produces no CSS (ADR-0065): it styles the page only by ' +
      'coincidence, when the class happens to be one the renderer already ships.',
    'On a react page, style with an inline `style={{…}}` object that uses the theme\'s tokens as ' +
      '`hsl(var(--token))` — `color: \'hsl(var(--foreground))\'`, `background: \'hsl(var(--card))\'` — ' +
      'so the page follows the theme. Render a drawer or a modal through ' +
      '`ObjectForm` with `formType="drawer"` or `formType="modal"` rather than a hand-rolled overlay.',
    'On an html page, lay out with the components\' structured props (`flex` with `direction` and ' +
      '`gap`, `grid` with `columns`) and add CSS through a JSON style object, ' +
      '`style={{"color":"hsl(var(--foreground))"}}`.',
    'A warning: the page still renders, without the styling the classes asked for. The verdict counts ' +
      'the `className` attributes in the source.',
  ],
};

// ── Interface page visualizations (`validate-page-visualization-bindings.ts`) ──

const PAGE_VISUALIZATION_WITHOUT_BINDING_EXPLANATION: RuleExplanation = {
  rule: 'page/visualization-without-binding',
  covers: 'how a list page binds each visualization it allows',
  paragraphs: [
    'An interface `list` page whitelists visualizations in `appearance.allowedVisualizations`, and ' +
      'its config is a closed shape with no per-visualization binding key: it cannot say which field ' +
      'supplies a calendar\'s date (ADR-0047 leaves those bindings on the object\'s view). So the ' +
      'renderer takes the binding from the view `interfaceConfig.sourceView` names (its `calendar:` ' +
      'block, say), else DERIVES it from the source object\'s fields, and this rule asks the same ' +
      'question at authoring time. `sourceView` is the one schema-legal channel for a binding on this ' +
      'door.',
    // Held to `OBJECTUI_DERIVATION_PREDICATES` by the rule's test.
    'The derivation, first matching field in declaration order, hidden and system fields skipped: ' +
      'kanban `groupByField` from a field typed select / multiselect / radio / enum / boolean, then ' +
      'a name matching /status|stage|state|priority|category|kind/i; calendar and timeline ' +
      '`startDateField` from a field typed date / datetime / time, then a name matching ' +
      '/date|due|start|end|deadline|schedule/i (a view\'s `calendar:` block also binds the ' +
      'timeline); gallery `coverField` from a field typed image / file / attachment / avatar / ' +
      'photo; gantt from two distinct date / datetime / time fields, a start and an end; map ' +
      '`locationField` from a field typed location / geo / geolocation / geopoint / point, then a ' +
      'name matching /location|address|geo|coords?|place|venue/i.',
    'An error when the unbound visualization LEADS `allowedVisualizations`: it becomes the page\'s ' +
      'forced view type, so every visitor lands on the renderer\'s "configuration required" refusal ' +
      'screen. A warning otherwise: the type is filtered out of the visualization switcher SILENTLY, ' +
      'while the switcher still appears (it is shown on the whitelist\'s length), with no message at ' +
      'build time or at run time.',
    'To fix it, point `interfaceConfig.sourceView` at a list view of the source object that declares the ' +
      'visualization\'s block (`sourceView: \'VIEW_KEY\'`), give the object a field the derivation finds ' +
      '(the `fix:` line names the type half; the name fallback above also binds), or drop the visualization ' +
      'from `appearance.allowedVisualizations`.',
    'Not judged: a page that is not `type: \'list\'` or carries no `interfaceConfig`; an object this ' +
      'stack does not define, or one with no readable field map; `grid`, which needs no binding, and ' +
      '`chart`, `tree` and any other value the renderer derives nothing for; and a `sourceView` ' +
      'naming no view this stack declares, which the runtime may still hydrate from a stored body. ' +
      'The derivation is a hand-carried mirror of the renderer\'s, so a change on the renderer\'s ' +
      'side can make this rule wrong in either direction until the mirror follows it.',
  ],
};

// ── Flow credential literals (`lint-flow-credential-literals.ts`) ──────────

const FLOW_CREDENTIAL_LITERAL_EXPLANATION: RuleExplanation = {
  rule: 'flow-credential-literal',
  covers: 'which positions are judged, and where a credential goes',
  paragraphs: [
    // The positions and the region kinds are held to the rule by its test, each fired.
    'A flow definition is served, as authored, to every member who can read flows, and three ' +
      'positions in it are open on that read path: an `http` node\'s `config.headers` entries, the ' +
      'query parameters of an `http` node\'s `config.url`, and a node\'s `connectorConfig.input`, ' +
      'walked to every depth (an array element is judged under its parent\'s key). The read ' +
      'projection that withholds the spec\'s DECLARED credential slots cannot withhold a value here ' +
      'without also breaking the round trip of every ordinary value, so a literal credential in one ' +
      'of them is readable by all of those members. Every node is judged, including one nested in a ' +
      '`try_catch`, `loop` or `parallel` region, because the read path serves it the same way.',
    'The supported home for an outbound credential is a declarative connector, whose ' +
      '`auth.credentialRef` names a secrets-layer reference resolved at boot (an environment ' +
      'variable in the open tier) and never stored in metadata (ADR-0097 §3), called from a ' +
      '`connector_action` node. The fix line routes by shape, to a variant the connector auth schema ' +
      'really has: a header credential to `bearer` or a header `api-key`, a query-string key to ' +
      '`api-key` with `paramName`. A credential in `connectorConfig.input` is dropped instead, ' +
      'because the connector authenticates through its own `auth`. No variant carries a secret in a ' +
      'url path, so a url path is not judged and no fix line promises one.',
    // [#22161] What the fix line stopped saying. The variants are held to the
    // spec's connector auth schema by the rule's test.
    'The `connectors:` entry also names a `provider` (\'rest\' for a plain HTTP API). A Basic pair is ' +
      '`auth: { type: \'basic\', username, credentialRef }`, and `username` is no secret. The connector guide ' +
      'is content/docs/automation/connectors.mdx.',
    'Always a warning, and nothing is refused: the predicate is a heuristic (a value under a name ' +
      'that reads as a credential, or a value that opens with an auth scheme), so a key named ' +
      '`token` can hold something that is not a secret, and a false positive costs a line of ' +
      'reading, never a blocked save. A `{variable}` template is not a literal and draws nothing. ' +
      'The finding names where the value sits and never the value itself, because it travels into ' +
      'CI logs, the runtime gate\'s server log line and the save response.',
  ],
};

// ── AI agent ↔ skill ↔ tool references (`validate-ai-surface-affinity.ts`, `validate-ai-tool-references.ts`) ──

const AI_SKILL_SURFACE_MISMATCH_EXPLANATION: RuleExplanation = {
  rule: 'ai-skill-surface-mismatch',
  covers: 'how an agent and its skills must share a surface',
  paragraphs: [
    // The defaults and the `both` arm are held to the rule by its test.
    'An agent binds one product surface, `ask` or `build` (ADR-0063 §1), and a skill declares the ' +
      'surface it belongs to: `ask`, `build` or `both` (ADR-0063 §3). A skill attaches only to an ' +
      'agent of its own surface, and `both` attaches to either (ADR-0064 §3). Each side defaults to ' +
      '`ask` when its `surface` is absent, as the runtime defaults it.',
    'The runtime treats a mismatch as a fast load error: `resolveActiveSkills()` throws on the ' +
      'first incompatible binding, so an agent carrying one fails at chat time with a 500, after the ' +
      'stack parsed, validated and deployed cleanly. Both sides are declared in the same stack, so ' +
      'the contradiction is provable statically, and this is an error with no false positive by ' +
      'construction.',
    'Judged: each name in an agent\'s `skills` that resolves to a skill this stack declares. A name ' +
      'that resolves to no declared skill is skipped, not reported: kernel skills (`schema_reader`, ' +
      'the `ask` and `build` bundles) are registered at run time and invisible to a static read, so ' +
      'resolving names against `stack.skills` alone would flag every one of them.',
    'To fix it, move the skill to an agent of its own surface, or change the skill\'s `surface` to the ' +
      'agent\'s. Declare `surface: \'both\'` only for a genuinely shared, read-only capability, since ' +
      'a `both` skill attaches to an agent of either surface.',
  ],
};

const AI_SKILL_TOOL_UNRESOLVED_EXPLANATION: RuleExplanation = {
  rule: 'ai-skill-tool-unresolved',
  covers: 'how a skill tool name resolves, and why it only warns',
  paragraphs: [
    // The three sources and the wildcard are held to the rule by its test, each one silencing it.
    'A `skill.tools` entry resolves, in order, against the stack\'s own `stack.tools` names; ' +
      '`PLATFORM_PROVIDED_TOOL_NAMES` (`@objectstack/spec/system`), the tools the cloud AI runtime ' +
      'registers at boot; and the materialised action tools, one `action_<name>` per declarative ' +
      'action in `stack.actions` or any object\'s `actions` (ADR-0109: the default path declares no ' +
      'tool record at all). A trailing-wildcard entry (`action_*`, `crm_*`) resolves when any member ' +
      'of that universe starts with its prefix.',
    // The headless paths are held to the rule by its test, each one materialising.
    'An action materialises as a tool only when it opts in, `ai.exposed: true` with an ' +
      '`ai.description` (ADR-0011) of at least 40 characters, which the model reads, and has a headless ' +
      'path: a declarative `operation: \'update\'`, a `script` action with a target or a body, or an ' +
      '`api` or `flow` action with a target. A `url`, `modal` or `form` action is UI-only and stays ' +
      'human-driven by design: that is a legitimate answer, not a gap, and the skill\'s instructions can ' +
      'recommend the UI action instead. Naming ' +
      '`action_<name>` for an action that exists but never materialises is its own verdict with its ' +
      'own fix (opt it in, or drop the reference), because it is a different mistake from naming a ' +
      'tool that exists nowhere.',
    // Held equal to `PLATFORM_TOOL_FAMILY_PREFIXES` by the rule's test.
    'Family prefixes materialised by the runtime: action_. A materialised tool needs no tool record ' +
      '(the ADR-0109 default path), so backing a name means declaring the action, or referencing a ' +
      'platform tool by its registered name; otherwise remove the name and the instructions that mention ' +
      'it. Ignore the warning only if a runtime plugin outside the platform registry provides the name.',
    'The runtime drops an unresolved name without a word, so the skill\'s instructions promise a ' +
      'capability the agent cannot call, and the assistant improvises or fails when asked to use it. ' +
      'A warning, not an error (ADR-0078\'s advisory-first ratchet): a runtime plugin outside the ' +
      'platform registry can register tools no static read can see, and the runtime tolerates ' +
      'unresolved names on purpose, since a skill may be authored before its tools exist. Judged ' +
      'over the whole stack by `os validate`, `os lint` and `os build`, never at the runtime publish ' +
      'gate, whose per-write snapshot carries neither `stack.tools` nor `stack.actions`.',
  ],
};

// ── Managed-object API methods (`validate-managed-api-methods.ts`) ─────────

const MANAGED_API_METHOD_UNAFFORDABLE_EXPLANATION: RuleExplanation = {
  rule: 'object/managed-api-method-unaffordable',
  covers: 'why an advertised write verb needs its affordance',
  paragraphs: [
    // The verb table is held to `MANAGED_WRITE_VERB_AFFORDANCE` by the rule's test.
    'A managed object (`managedBy` set) resolves its affordances from its bucket\'s default row and ' +
      'its own `userActions` (ADR-0092, ADR-0103), and each generic write verb in ' +
      '`enable.apiMethods` needs one: `create` needs `create`, `update` and `upsert` need `edit`, ' +
      '`delete` and `purge` need `delete`. Reads are never affordance-gated. The verdict comes from ' +
      'the shared predicate `checkManagedApiMethodAffordances` (`@objectstack/spec/data`), the same ' +
      'call objectql\'s registry makes at registration, so the two never disagree about a verb.',
    'The registry strips each refused verb at registration and logs a warning, so the declaration ' +
      'advertises an API surface the object does not serve, and the only trace is a boot-log line ' +
      'read after an incident. Boot stays warn-and-strip on purpose, so a metadata typo cannot kill ' +
      'a control-plane boot; this rule refuses the same contradiction where the author is: at every ' +
      'CLI door, judged before the parse, and at the runtime publish gate for an `object` write.',
    'One finding per object, not per verb: several refused verbs on one object are one mistake and ' +
      'one edit. The fix line offers both ways out: drop the verbs, or open the affordance, and only ' +
      'for a write a user context may really perform, once the guard that enforces it exists ' +
      '(ADR-0092 D4: an affordance never ships ahead of its guard).',
  ],
};

// ── Organization-axis red lines (`validate-org-axis-red-lines.ts`) ─────────

/** What ADR-0105 D6 protects — both org-axis ids. */
const ORG_AXIS_RED_LINES =
  'ADR-0105 makes the organization tree a reporting and grouping dimension, never a permission ' +
  'hierarchy, and D6 draws two red lines to keep it so: no permission inheritance along the ' +
  'organization tree (`org-axis-permission-inheritance`), and business-unit trees stay inside one ' +
  'organization (`org-axis-cross-org-bu-grant`).';

const ORG_AXIS_PERMISSION_INHERITANCE_EXPLANATION: RuleExplanation = {
  rule: 'org-axis-permission-inheritance',
  covers: 'why access never walks the organization tree',
  paragraphs: [
    ORG_AXIS_RED_LINES,
    'An RLS policy (`using` or `check`) or a sharing rule (`condition` or `sharedWith`) that reads ' +
      '`parent_organization_id` builds a second permission hierarchy beside the business-unit tree. It ' +
      'would not grant what it appears to either: a Layer-1 policy cannot widen the engine\'s Layer 0 ' +
      'wall, which it sits behind.',
    'Cross-organization visibility comes from MEMBERSHIP: under the `group` tenancy posture the Layer 0 ' +
      'wall is `organization_id IN accessible_org_ids`, so a user who should see several organizations is ' +
      'made a member of each (ADR-0105 D2). For a hierarchy INSIDE one organization, use the business-unit ' +
      'tree: `unit_and_subordinates` sharing, or a depth scope anchored on `sys_user_position`.',
    'An error: it mirrors a real enforcement property, the Layer 0 wall\'s independence, so the failure ' +
      'moves from a rule that silently grants nothing to an authoring fix.',
  ],
};

const ORG_AXIS_CROSS_ORG_BU_GRANT_EXPLANATION: RuleExplanation = {
  rule: 'org-axis-cross-org-bu-grant',
  covers: 'why business-unit trees stay inside one organization',
  paragraphs: [
    ORG_AXIS_RED_LINES,
    'This is the second line: business-unit trees stay inside one organization. ' +
      '`sys_business_unit` is org-scoped, and every business-unit mechanism (`unit_and_subordinates` ' +
      'sharing, `adminScope` delegation, depth scopes) resolves within one organization.',
    // The recipients and both opt-out spellings are held to the rule by its test.
    'A sharing rule whose `sharedWith` recipient is `business_unit` (that unit\'s members) or ' +
      '`unit_and_subordinates` (that unit plus every descendant unit), on an object that opted out ' +
      'of tenancy (`tenancy.enabled: false`, or `systemFields.tenant: false`), has no organization ' +
      'column to scope against: the grant reaches every organization\'s rows, the ' +
      'cross-organization business-unit tree the ADR rejected, arrived at by accident.',
    'The other recipients are the sanctioned way to share a platform-global object (ADR-0066): ' +
      '`user`, `team` and `position` expand flat, and `field` reads the users a column on the record ' +
      'itself names, so none of them walks a business-unit tree. A platform-global catalog everyone ' +
      'should read wants an organization-wide default of `public_read`, not a business-unit grant. ' +
      'An error: it mirrors a real enforcement property, the org-predicated business-unit resolver, ' +
      'so the failure moves from a silent wrong answer to an authoring fix.',
  ],
};

// ── Retired permission residue (`validate-retired-permission-residue.ts`) ──

const PERMISSION_RETIRED_LIFECYCLE_RESIDUE_EXPLANATION: RuleExplanation = {
  rule: 'permission-retired-lifecycle-residue',
  covers: 'why a retired default is accepted, and why it is flagged',
  paragraphs: [
    // The keys and their residue value are held to the rule by its test.
    '`allowRestore` and `allowPurge` were removed from object permissions in `@objectstack/spec` 17 ' +
      '(ADR-0049). The parse still accepts each at its retired default, `false`, as inert residue ' +
      'and strips it without a word, because real built artifacts carry that residue once per ' +
      'permission entry and a notice per occurrence would be a storm; every other value is refused ' +
      'at the parse, with the prescription attached.',
    'The loud channels for a retired key miss one author: TypeScript\'s `never` reaches only typed ' +
      'sources (`definePermissionSet`), and the ADR-0087 D2 conversion that `os migrate meta` runs ' +
      'speaks only when someone runs it, never on the load path. So a JSON or YAML author who writes ' +
      'the key at its residue value gets a clean parse, no signal, and a line that grants nothing. ' +
      'This rule is that missing signal, judged on the raw authored stack before the parse, where ' +
      'the residue is still attributable to a line somebody wrote.',
    'A warning: the line is harmless, only dead. The fix line is the "Delete the key" sentence of the ' +
      'retirement\'s own prescription, read from the tombstone on `ObjectPermissionSchema` and cut, never ' +
      'retyped, so the parse-time refusal and this finding never word it differently. Deleting the key opens ' +
      'nothing: a dispatched `restore` or `purge` stays denied fail-closed by the permission evaluator\'s ' +
      'destructive-operation backstop, and the bit returns with the M2 lifecycle initiative alongside the ' +
      'operation it gates; `os migrate meta` lists the mechanical edits for existing sources. Judged at every ' +
      'CLI door and at the runtime publish gate for a `permission` write.',
  ],
};

// ── Seed datasets (`validate-seed-replay-safety.ts`, `validate-seed-state-machine.ts`) ──

const SEED_INSERT_MODE_DUPLICATES_ON_REPLAY_EXPLANATION: RuleExplanation = {
  rule: 'seed-insert-mode-duplicates-on-replay',
  covers: 'why a seed dataset must be safe to replay',
  paragraphs: [
    'Seeds are replayed, not applied once: every `data` dataset is loaded again on each dev-server ' +
      'boot and each package re-publish, so a dataset\'s mode must be idempotent. `mode: \'insert\'` ' +
      'is the one that is not: the loader\'s insert path writes every record unconditionally, with no ' +
      'existing-row check, so the table grows by the dataset\'s size on every restart (three rows, ' +
      'then six, then nine).',
    // The modes are held to the rule by its test, each one silent.
    'The fix line names the idempotent modes, `ignore` (skip rows that already exist) and `upsert` ' +
      '(create or update), each matching on the dataset\'s `externalId`: a single natural-key field ' +
      '(`externalId: \'code\'`), ' +
      'or a composite list of fields for a join or junction table with no single natural key ' +
      '(`[\'team\', \'project\']`).',
    'A warning, not a refusal: an insert seed loads and works on a fresh database, and the defect ' +
      'shows only from the second boot on.',
  ],
};

const SEED_VALUE_OUTSIDE_STATE_MACHINE_EXPLANATION: RuleExplanation = {
  rule: 'seed-value-outside-state-machine',
  covers: 'which states a seeded value may name',
  paragraphs: [
    'Seed writes are exempt from the `state_machine` validation rule: a curated seed records ' +
      'established facts, so a record may be born mid-lifecycle (a `completed` project, a ' +
      '`closed_won` opportunity) without the entry guard refusing it. The exemption also skips the ' +
      'machine\'s check that a value is a state at all, and a field-level `select` catches only a ' +
      'value outside its `options`, so a typo on a free-text state field, or a valid option that is ' +
      'no declared state, lands silently.',
    // The three sources of the declared set are held to the rule by its test, each one silencing it.
    'So a seeded value need not be an initial state, but it must be a state the machine DECLARES: ' +
      'the union of its `initialStates`, the keys of its `transitions` map and every transition ' +
      'target. The verdict names the first three declared states in alphabetical order and counts ' +
      'the rest. The exemption lets a seed be born mid-lifecycle; it is not a licence to write an ' +
      'unknown state.',
    'Not judged: an absent or empty value, a value that is not a plain string (an unresolved ' +
      'expression envelope, a number), and a `state_machine` rule that declares no state at all. A ' +
      'warning: a curated value the machine does not know is suspicious, not necessarily wrong.',
  ],
};

// ── Semantic-role provenance (`validate-semantic-roles.ts`) ────────────────

const SEMANTIC_ROLE_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'semantic-role-field-unprovisioned',
  covers: 'why an injected anchor on an external object is blank',
  paragraphs: [
    'An object\'s semantic roles point into its own field map (ADR-0085): `stageField` (stage ' +
      'detection) and each `highlightFields` entry (the default list columns, record cards, ' +
      'previews and the detail highlight strip). A pointer at a system column the registry injects ' +
      '(`owner_id`, `created_by`, `organization_id` and the rest) resolves on every object that gets ' +
      'the column, so naming one is legitimate.',
    // The external arm, the local twin and the declared column are held to the rule by its test.
    'An `external` object (ADR-0015) is the exception: the platform registers the injected anchors, ' +
      'but the remote schema owns the table and no column backs them, so a role pointing at one ' +
      'drives its consumers off a column that is blank on every record. A column the author declares ' +
      'in the object\'s own `fields` (mapped through the external binding\'s `columnMap`) is the ' +
      'author\'s and never reported.',
    'Existence and provenance are separate questions: whether an entry names a field at all is ' +
      '`object-field-ref-unknown` at `highlightFields` and `semantic-role-field-unknown` at ' +
      '`stageField`, and this rule asks only about the storage behind a name that resolves. A ' +
      'warning, like the other semantic-role rules: every consumer degrades to an empty value and ' +
      'nothing breaks.',
  ],
};

// ── Action placement (`validate-action-locations.ts`) ───────────────────────

const ACTION_NO_PLACEMENT_EXPLANATION: RuleExplanation = {
  rule: 'action-no-placement',
  covers: 'where an action can be placed',
  paragraphs: [
    'An action renders at a location only if it DECLARES that location: every console renderer reads ' +
      'the one predicate. An action that omits `locations`, and that no view places by name, parses, ' +
      'publishes and is listed in Setup, and no user can ever click it — the ADR-0078 shape of a ' +
      'declaration that renders nothing.',
    // Held equal to `ACTION_LOCATIONS` (`@objectstack/spec/ui`) by the rule's test.
    'The locations an action can declare: `list_toolbar`, `list_item`, `record_header`, `record_more`, ' +
      '`record_related`, `record_section`. A list view places an action by NAME instead: naming it in ' +
      '`bulkActions` or `bulkActionDefs` puts it on the selection bar, which the view drives, never ' +
      '`locations` (an action that only makes sense over a selection has no single-record location). ' +
      'A name in `rowActions` counts as placement too.',
    '`locations: []` is the documented headless shape and is never reported: the action stays callable ' +
      'over REST, MCP and AI and keeps its capability gate, params contract and audit trail while ' +
      'claiming no UI surface. ADR-0110 D3 refuses an undeclared handler, so a headless declaration is ' +
      'the legal way to expose such an action; only a MISSING key is unstated placement.',
    'A warning, not an error: a view in another installed package can place the action by name. The ' +
      'rule asks only whether anyone placed the action; whether a declared location is one a renderer ' +
      'serves, and whether a name resolves (`action-name-undefined`), are other rules\' questions.',
  ],
};

// ── Dashboard widget options (`validate-dashboard-widget-options.ts`) ───────
// The id is `@objectstack/sdui-parser`'s diagnostic code: the rule forwards that
// package's check unchanged, and the SDUI save gate emits the same code.

const UNCONSUMED_WIDGET_OPTION_EXPLANATION: RuleExplanation = {
  rule: 'unconsumed-widget-option',
  covers: 'which widget options a renderer reads',
  paragraphs: [
    'A widget\'s `options` bag is declared open (the spec\'s `DashboardWidgetOptionsSchema` passes ' +
      'extra keys through), so any key parses, validates and publishes, including one no renderer ' +
      'reads. Every spec-legal widget renders through the dataset-bound path, whose read set is the ' +
      'warning\'s list, so a key outside it styles nothing and the widget renders as if it were absent. ' +
      'Open extras stay open; they stop being silent. The rule is a warning, at this door as at the ' +
      'SDUI save gate, which runs the same check under the same code.',
    'Presentation has declared homes instead: a number\'s face is the dataset measure\'s `format` and ' +
      '`currency`, a tile\'s accent is the widget\'s `colorVariant`, and a chart\'s look is the ' +
      'widget\'s `chartConfig`. `format` and `thresholds` in `options` are the keys most often ' +
      'believed to work; both draw this warning.',
    'Not reported: a widget with no `dataset` (a legacy inline form), one in the legacy `component` ' +
      'format, an expression-valued `options`, and a widget carrying ' +
      '`suppressWarnings: [\'unconsumed-widget-option\']`, which is how a key with a genuine consumer ' +
      'outside the renderer says so in metadata.',
  ],
};

// ── Rule ids `@objectstack/cli` produces ────────────────────────────────────
// The CLI's own checks, which `os explain` reads from this one table. The CLI
// depends on this package, so their id constants cannot be imported here:
// `rule-explanations.test.ts` lists these ids, and the CLI's
// `test/explain-rule-id.test.ts` fires each one from its producer.

// `packages/cli/src/lint/hook-body-lowering.ts` (`os lint`).

const HOOK_BODY_NOT_LOWERABLE_EXPLANATION: RuleExplanation = {
  rule: 'hook-body/not-lowerable',
  covers: 'what lowering needs and how to bundle on purpose',
  paragraphs: [
    'A hook handler or an action `target` written as an inline function is lowered by `os build` ' +
      'into a metadata-only `body`, which the runtime evaluates in a sandbox with no module scope. When ' +
      'the function names something that sandbox does not have, the extractor refuses it and the build ' +
      'ships the function through the bundled runtime module instead, and still exits 0.',
    'The handler keeps working, so behaviour does not change; the deployment shape does: the app is ' +
      'no longer shippable as pure metadata. This rule is the `error` that says so, so a gate that runs ' +
      '`os lint` can fail on it, while `os build` keeps accepting the bundle.',
    'The remedy depends on the name, and the `fix:` line names the one that applies. A module-scope ' +
      'const, helper or import can be inlined into the handler or reached through `ctx`. A global the ' +
      'Node host provides and the sandbox does not, such as `Intl`, cannot be inlined at all: keep the ' +
      'check in a string handler ref, or move it to a validation rule.',
    'If a bundled closure is what you want, say so and this rule stays silent: give the hook an ' +
      'explicit `body`, or move the function into the top-level `functions:` map and reference it by ' +
      'name (`handler: \'fn_name\'`). Neither is lowered to a metadata body.',
    'The rule calls the extractor `os build` calls, on the same input, so it reports exactly the ' +
      'handlers the build bundles; `os build --strict-body` makes each one a build failure.',
  ],
};

const HOOK_BODY_BUNDLED_FALLBACK_EXPLANATION: RuleExplanation = {
  rule: 'hook-body/bundled-fallback',
  covers: 'what the sandbox cannot run',
  paragraphs: [
    'Some constructs can never run in the sandbox a metadata-only body is evaluated in: network, ' +
      'module and process access, dynamic code, a member only the in-process host provides (such as ' +
      '`sudo()`, a repository\'s `create()` or `ctx.submitted`), or a hook parameter list the build ' +
      'cannot rebind to `ctx`. A handler that uses one is refused by the ' +
      'extractor and shipped through the bundled runtime module, where it runs in-process.',
    'That is the designed fallback, so this rule is a `warning`, never an error: writing such a ' +
      'construct is choosing a bundled closure. The app is not pure metadata while the handler is ' +
      'bundled.',
    'The verdict quotes the first clause of the extractor\'s refusal. `os build` prints the whole ' +
      'refusal line for every bundled handler, with the remedy it names, and `os build --strict-body` ' +
      'prints the full diagnostic and makes a missing body fatal.',
    'To ship the handler as metadata instead, remove the construct the refusal names; a network call ' +
      'becomes a Connector recipe. To keep the bundle, nothing is required.',
  ],
};

const HOOK_BODY_UNPARSEABLE_EXPLANATION: RuleExplanation = {
  rule: 'hook-body/unparseable',
  covers: 'what an unparseable handler means',
  paragraphs: [
    'The extractor found no function body it could judge: the handler\'s source text is not a single ' +
      'arrow function or named function expression it can parse. This is a limit of the instrument, ' +
      'not a verdict about the handler: it does not mean a bundled closure was chosen, and whether the ' +
      'body could ship as pure metadata is undetermined.',
    '`os build` still ships the handler through the bundled runtime module, so it keeps working. ' +
      'Rewriting it as a single arrow function or named function expression lets the extractor judge it.',
    'It is reported under its own rule, never as `hook-body/bundled-fallback`, whose verdict asserts ' +
      'that the body uses something the sandbox cannot provide.',
  ],
};

const HOOK_BODY_EXTRACTION_FAILED_EXPLANATION: RuleExplanation = {
  rule: 'hook-body/extraction-failed',
  covers: 'what an extractor failure means',
  paragraphs: [
    'The extraction instrument itself threw while reading the handler, with an error that is not one ' +
      'of its refusals. Like `hook-body/unparseable`, this is not a verdict about the handler: nothing ' +
      'is known about whether its body could ship as pure metadata.',
    '`os build` still ships the handler through the bundled runtime module. The verdict quotes the ' +
      'first line of the thrown error, and `os build --strict-body` prints it whole; an extractor that ' +
      'throws on an ordinary handler is a defect in the instrument.',
    'It is kept apart from `hook-body/unparseable` on purpose: a broken instrument and a limited ' +
      'instrument are different events.',
  ],
};

// `packages/cli/src/utils/collect-docs.ts` (`os build`, `os validate`, `os lint`).

const DOCS_UNCOLLECTED_DIRECTORY_EXPLANATION: RuleExplanation = {
  rule: 'docs/uncollected-directory',
  covers: 'where package docs are read from',
  paragraphs: [
    'Package docs are collected from `src/docs/*.md` (ADR-0046 §3.2) and, in an artifact that declares ' +
      '`packages[]`, from the `docs/` directory inside whichever directory under `src/` a package ' +
      'answers to, at no fixed depth (ADR-0130 D4). Markdown files in a `docs/` directory that neither ' +
      'reads are not ' +
      'collected: they are absent from the artifact\'s `docs[]` and from every book that includes ' +
      'them, while the build still succeeds. This warning names them, because a build that keeps none ' +
      'of an author\'s docs and says nothing is the defect.',
    'A directory answers to a package when its name is the package\'s `id` or the last dot-separated ' +
      'segment of that `id`. Neither the package\'s display `name` nor its `namespace` resolves one: ' +
      'packages of one artifact may share a namespace (ADR-0130 D1).',
    'The collector never guesses. A directory that names no package, one that names more than one, ' +
      'and a package that answers to more than one docs directory are each reported and collected from ' +
      'nowhere.',
    'To fix it, keep one docs directory per package and name it after the package (two packages need ' +
      'distinct ids, and their last segments must differ too); or move the files into `src/docs/` — doc ' +
      'names carry the package namespace prefix, so packages do not collide there; or declare the docs ' +
      'inline as `defineStack({ docs })` on the package that owns them; or delete them if they are not ' +
      'package docs. A stack with no `packages[]` reads `src/docs/` only.',
  ],
};

const DOCS_DUPLICATE_NAME_EXPLANATION: RuleExplanation = {
  rule: 'docs/duplicate-name',
  covers: 'why a doc name may appear once',
  paragraphs: [
    'Within one package, inline `defineStack({ docs })` entries and `src/docs/*.md` files share one ' +
      'set of doc names, and a name may appear in it once.',
    'Across the packages of one artifact the same name is refused too, as authoring hygiene: doc names ' +
      'carry the package namespace prefix, but packages of one artifact may share a namespace ' +
      '(ADR-0130 D1), so the prefix does not keep two packages\' docs apart. The runtime keys a packaged ' +
      'doc by package and name (ADR-0048), so this is a refusal of the authored artifact, not of a ' +
      'registration collision.',
    'To fix it, rename one of the two docs, and its `src/docs/*.md` file with it.',
  ],
};

const DOCS_NAV_TARGET_EXPLANATION: RuleExplanation = {
  rule: 'docs/nav-target',
  covers: 'what a doc navigation item can open',
  paragraphs: [
    'A navigation item of `type: \'doc\'` opens a book (`book`) or a single page (`doc`) of this ' +
      'package, and one whose target names nothing the package has is refused. It is judged in app ' +
      '`navigation`, `areas[].navigation` and `manifest.navigationContributions`, during the docs ' +
      'step, because that is where the docs read from `src/docs/*.md` join the artifact.',
    '`book` resolves against the books declared in `books`, on the stack and on each package body, ' +
      'and against a package id, which opens that package\'s implicit book. `doc` resolves against the ' +
      'docs the package carries: the filename stem of a `src/docs/*.md` file, or an entry declared in ' +
      '`docs`. The item and app are named by the finding\'s path.',
    'The verdict names the nearest existing name when one is close. To fix it, correct the name, or ' +
      'open the other kind of target: remove `doc` and open the whole book with `book`, or remove ' +
      '`book` and open a single page with `doc`.',
  ],
};

const DOCS_FRONTMATTER_TAGS_EXPLANATION: RuleExplanation = {
  rule: 'docs/frontmatter-tags',
  covers: 'how doc tags are read',
  paragraphs: [
    'A doc\'s frontmatter `tags:` is what a book group\'s `include: { tag }` matches. The reader ' +
      'understands two YAML spellings and no others: an inline list (`tags: [tutorial, beginner]`) or a ' +
      'block of `- item` lines under `tags:`. Anything else under the key, such as a bare scalar, an ' +
      'unterminated inline list, a key with nothing under it, nested or mapping items, a block scalar or ' +
      'a quoted item containing a comma, is reported instead of half-read, and the doc is collected ' +
      'without tags.',
    'Tags belong to the doc, not to one translation, so they are read from the base file only: a ' +
      'locale variant (`NAME.LOCALE.md`) that declares `tags:` is reported and its tags are not ' +
      'collected. Move them to the base file.',
    'Reported, never dropped: a tag that silently fails to parse leaves a book group rendering empty ' +
      'with nothing saying why.',
  ],
};

// `packages/cli/src/utils/picklist-references.ts` (`os build`, `os validate`).

const PICKLIST_REFERENCE_UNVERIFIED_EXPLANATION: RuleExplanation = {
  rule: 'picklist-reference-unverified',
  covers: 'why a picklist reference is not judged',
  paragraphs: [
    'A field\'s `picklist` and a picklist extension\'s `extend` name a shared option list. `os ' +
      'validate` and `os build` resolve the name against every picklist the stack declares (every ' +
      '`packages[]` body\'s `picklists`, or the top-level `picklists`) and refuse one that resolves ' +
      'nowhere, as `picklist-reference-unknown`.',
    'When the package that declares the reference depends on a package this stack does not carry, the ' +
      'list could live there, and this command cannot read it: `manifest.dependencies` maps package ids ' +
      'to version ranges the installer resolves, and nothing maps such an id to a file the CLI could ' +
      'open. So the reference gets this notice instead of a refusal: it is not judged, and the notice ' +
      'never gates a run, not even under `--strict`.',
    'If one of the named dependencies declares the list, nothing is wrong. Otherwise declare the list ' +
      'in this stack, or correct the name. A reference saved at runtime through Studio or the REST ' +
      'metadata API is not judged here.',
  ],
};

/**
 * Every rule explanation this package ships, keyed by rule id. `os explain
 * <rule-id>` reads this table and nothing else.
 */
export const RULE_EXPLANATIONS: Readonly<Record<string, RuleExplanation>> = Object.freeze({
  [FIELD_NO_CONSUMERS_EXPLANATION.rule]: FIELD_NO_CONSUMERS_EXPLANATION,
  [SECURITY_OWD_UNSET_EXPLANATION.rule]: SECURITY_OWD_UNSET_EXPLANATION,
  [FIELD_SUMMARY_WITHOUT_OPERATIONS_EXPLANATION.rule]: FIELD_SUMMARY_WITHOUT_OPERATIONS_EXPLANATION,
  [FIELD_FORMULA_WITHOUT_EXPRESSION_EXPLANATION.rule]: FIELD_FORMULA_WITHOUT_EXPRESSION_EXPLANATION,
  [FIELD_RELATIONSHIP_WITHOUT_REFERENCE_EXPLANATION.rule]: FIELD_RELATIONSHIP_WITHOUT_REFERENCE_EXPLANATION,
  [FIELD_CHOICE_WITHOUT_OPTIONS_EXPLANATION.rule]: FIELD_CHOICE_WITHOUT_OPTIONS_EXPLANATION,
  [VIEW_LAYOUT_WITHOUT_BINDING_EXPLANATION.rule]: VIEW_LAYOUT_WITHOUT_BINDING_EXPLANATION,
  [VIEW_TREE_WITHOUT_PARENT_FIELD_EXPLANATION.rule]: VIEW_TREE_WITHOUT_PARENT_FIELD_EXPLANATION,
  [VIEW_ROW_COLOR_WITHOUT_COLORS_EXPLANATION.rule]: VIEW_ROW_COLOR_WITHOUT_COLORS_EXPLANATION,
  [VIEW_ROW_COLOR_UNRESOLVABLE_VALUE_EXPLANATION.rule]: VIEW_ROW_COLOR_UNRESOLVABLE_VALUE_EXPLANATION,
  [WEBHOOK_WITHOUT_TRIGGERS_EXPLANATION.rule]: WEBHOOK_WITHOUT_TRIGGERS_EXPLANATION,
  [WIDGET_LEGACY_ANALYTICS_UNRENDERABLE_EXPLANATION.rule]: WIDGET_LEGACY_ANALYTICS_UNRENDERABLE_EXPLANATION,
  [WIDGET_LEGACY_ANALYTICS_SHAPE_EXPLANATION.rule]: WIDGET_LEGACY_ANALYTICS_SHAPE_EXPLANATION,
  [DASHBOARD_FILTER_FIELD_UNKNOWN_EXPLANATION.rule]: DASHBOARD_FILTER_FIELD_UNKNOWN_EXPLANATION,
  [DASHBOARD_FILTER_FIELD_NOT_INCLUDED_EXPLANATION.rule]: DASHBOARD_FILTER_FIELD_NOT_INCLUDED_EXPLANATION,
  [DASHBOARD_FILTER_FIELD_UNPROVISIONED_EXPLANATION.rule]: DASHBOARD_FILTER_FIELD_UNPROVISIONED_EXPLANATION,
  [WIDGET_FILTER_FIELD_UNKNOWN_EXPLANATION.rule]: WIDGET_FILTER_FIELD_UNKNOWN_EXPLANATION,
  [WIDGET_FILTER_FIELD_NOT_INCLUDED_EXPLANATION.rule]: WIDGET_FILTER_FIELD_NOT_INCLUDED_EXPLANATION,
  [WIDGET_SORTBY_UNSELECTED_EXPLANATION.rule]: WIDGET_SORTBY_UNSELECTED_EXPLANATION,
  [CHART_FIELD_UNKNOWN_EXPLANATION.rule]: CHART_FIELD_UNKNOWN_EXPLANATION,
  [CHART_MEASURES_MISSING_EXPLANATION.rule]: CHART_MEASURES_MISSING_EXPLANATION,
  [WIDGET_MEASURES_MISSING_EXPLANATION.rule]: WIDGET_MEASURES_MISSING_EXPLANATION,
  [CHART_DIMENSIONS_MISSING_EXPLANATION.rule]: CHART_DIMENSIONS_MISSING_EXPLANATION,
  [TABLE_COUNT_ONLY_EXPLANATION.rule]: TABLE_COUNT_ONLY_EXPLANATION,
  [DATASET_INCLUDE_UNKNOWN_EXPLANATION.rule]: DATASET_INCLUDE_UNKNOWN_EXPLANATION,
  [DATASET_FIELD_UNKNOWN_EXPLANATION.rule]: DATASET_FIELD_UNKNOWN_EXPLANATION,
  [DATASET_FIELD_NOT_INCLUDED_EXPLANATION.rule]: DATASET_FIELD_NOT_INCLUDED_EXPLANATION,
  [DATASET_FILTER_FIELD_UNKNOWN_EXPLANATION.rule]: DATASET_FILTER_FIELD_UNKNOWN_EXPLANATION,
  [SECURITY_CBP_AMBIGUOUS_RELATION_EXPLANATION.rule]: SECURITY_CBP_AMBIGUOUS_RELATION_EXPLANATION,
  [SECURITY_CBP_NO_RELATION_EXPLANATION.rule]: SECURITY_CBP_NO_RELATION_EXPLANATION,
  [SECURITY_FLS_UNKNOWN_FIELD_EXPLANATION.rule]: SECURITY_FLS_UNKNOWN_FIELD_EXPLANATION,
  [SECURITY_MASTER_DETAIL_UNGRANTED_EXPLANATION.rule]: SECURITY_MASTER_DETAIL_UNGRANTED_EXPLANATION,
  [SECURITY_WILDCARD_VAMA_EXPLANATION.rule]: SECURITY_WILDCARD_VAMA_EXPLANATION,
  [SECURITY_OWD_ALIAS_EXPLANATION.rule]: SECURITY_OWD_ALIAS_EXPLANATION,
  [SECURITY_DELEGATION_MISSING_REASON_EXPLANATION.rule]: SECURITY_DELEGATION_MISSING_REASON_EXPLANATION,
  [VISIBILITY_ROOT_MISLAYERED_EXPLANATION.rule]: VISIBILITY_ROOT_MISLAYERED_EXPLANATION,
  [VISIBILITY_PREDICATE_OVER_BUDGET_EXPLANATION.rule]: VISIBILITY_PREDICATE_OVER_BUDGET_EXPLANATION,
  [VISIBILITY_PREDICATE_SYNTAX_EXPLANATION.rule]: VISIBILITY_PREDICATE_SYNTAX_EXPLANATION,
  [VISIBILITY_PREDICATE_UNKNOWN_FUNCTION_EXPLANATION.rule]: VISIBILITY_PREDICATE_UNKNOWN_FUNCTION_EXPLANATION,
  [VISIBILITY_PREDICATE_HAS_ARGUMENT_EXPLANATION.rule]: VISIBILITY_PREDICATE_HAS_ARGUMENT_EXPLANATION,
  [VISIBILITY_BARE_IDENTIFIER_EXPLANATION.rule]: VISIBILITY_BARE_IDENTIFIER_EXPLANATION,
  [HOOK_BODY_WRITE_UNKNOWN_FIELD_EXPLANATION.rule]: HOOK_BODY_WRITE_UNKNOWN_FIELD_EXPLANATION,
  [HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION.rule]: HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION,
  [HOOK_BODY_SOURCE_UNPARSEABLE_EXPLANATION.rule]: HOOK_BODY_SOURCE_UNPARSEABLE_EXPLANATION,
  [ACTION_BODY_WRITE_UNKNOWN_FIELD_EXPLANATION.rule]: ACTION_BODY_WRITE_UNKNOWN_FIELD_EXPLANATION,
  [ACTION_RECORD_WRITE_DISCARDED_EXPLANATION.rule]: ACTION_RECORD_WRITE_DISCARDED_EXPLANATION,
  [ACTION_BODY_SOURCE_UNPARSEABLE_EXPLANATION.rule]: ACTION_BODY_SOURCE_UNPARSEABLE_EXPLANATION,
  [ACTION_BODY_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION.rule]: ACTION_BODY_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION,
  [FLOW_NODE_WRITE_UNKNOWN_FIELD_EXPLANATION.rule]: FLOW_NODE_WRITE_UNKNOWN_FIELD_EXPLANATION,
  [FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION.rule]: FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR_EXPLANATION,
  [FLOW_UPDATE_READONLY_FIELD_EXPLANATION.rule]: FLOW_UPDATE_READONLY_FIELD_EXPLANATION,
  [FLOW_UPDATE_READONLY_WHEN_FIELD_EXPLANATION.rule]: FLOW_UPDATE_READONLY_WHEN_FIELD_EXPLANATION,
  [HOOK_API_UPDATE_READONLY_FIELD_EXPLANATION.rule]: HOOK_API_UPDATE_READONLY_FIELD_EXPLANATION,
  [HOOK_API_UPDATE_READONLY_WHEN_FIELD_EXPLANATION.rule]: HOOK_API_UPDATE_READONLY_WHEN_FIELD_EXPLANATION,
  [ACTION_API_UPDATE_READONLY_WHEN_FIELD_EXPLANATION.rule]: ACTION_API_UPDATE_READONLY_WHEN_FIELD_EXPLANATION,
  [RLS_PREDICATE_UNPARSEABLE_EXPLANATION.rule]: RLS_PREDICATE_UNPARSEABLE_EXPLANATION,
  [RLS_PREDICATE_OVER_BUDGET_EXPLANATION.rule]: RLS_PREDICATE_OVER_BUDGET_EXPLANATION,
  [RLS_PREDICATE_UNENFORCEABLE_EXPLANATION.rule]: RLS_PREDICATE_UNENFORCEABLE_EXPLANATION,
  [RLS_PREDICATE_UNKNOWN_FIELD_EXPLANATION.rule]: RLS_PREDICATE_UNKNOWN_FIELD_EXPLANATION,
  [RLS_PREDICATE_UNKNOWN_USER_VARIABLE_EXPLANATION.rule]: RLS_PREDICATE_UNKNOWN_USER_VARIABLE_EXPLANATION,
  [RLS_PREDICATE_MEMBERSHIP_KEY_TARGET_EXPLANATION.rule]: RLS_PREDICATE_MEMBERSHIP_KEY_TARGET_EXPLANATION,
  [MEMBERSHIP_KEY_USER_FIELD_INVALID_EXPLANATION.rule]: MEMBERSHIP_KEY_USER_FIELD_INVALID_EXPLANATION,
  [MEMBERSHIP_KEY_VALUE_FIELD_INVALID_EXPLANATION.rule]: MEMBERSHIP_KEY_VALUE_FIELD_INVALID_EXPLANATION,
  [MEMBERSHIP_KEY_DECLARED_TWICE_EXPLANATION.rule]: MEMBERSHIP_KEY_DECLARED_TWICE_EXPLANATION,
  [MEMBERSHIP_KEY_RESOLVER_COLLISION_EXPLANATION.rule]: MEMBERSHIP_KEY_RESOLVER_COLLISION_EXPLANATION,
  [SHARING_RULE_UNLOWERABLE_CONDITION_EXPLANATION.rule]: SHARING_RULE_UNLOWERABLE_CONDITION_EXPLANATION,
  [SHARING_RULE_RUNTIME_VARIABLE_CONDITION_EXPLANATION.rule]: SHARING_RULE_RUNTIME_VARIABLE_CONDITION_EXPLANATION,
  [SHARING_RULE_OBJECT_NOT_SHAREABLE_EXPLANATION.rule]: SHARING_RULE_OBJECT_NOT_SHAREABLE_EXPLANATION,
  [SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT_EXPLANATION.rule]: SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT_EXPLANATION,
  [FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID_EXPLANATION.rule]: FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID_EXPLANATION,
  [FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE_EXPLANATION.rule]: FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE_EXPLANATION,
  [FLOW_TRIGGER_UNROUTABLE_EXPLANATION.rule]: FLOW_TRIGGER_UNROUTABLE_EXPLANATION,
  [FLOW_TRIGGER_UNKNOWN_EVENT_EXPLANATION.rule]: FLOW_TRIGGER_UNKNOWN_EVENT_EXPLANATION,
  [FLOW_API_TRIGGER_SECRET_MISSING_EXPLANATION.rule]: FLOW_API_TRIGGER_SECRET_MISSING_EXPLANATION,
  [FLOW_TRIGGER_UNKNOWN_OBJECT_EXPLANATION.rule]: FLOW_TRIGGER_UNKNOWN_OBJECT_EXPLANATION,
  [VALIDATION_RULE_REGEX_UNCOMPILABLE_EXPLANATION.rule]: VALIDATION_RULE_REGEX_UNCOMPILABLE_EXPLANATION,
  [VALIDATION_RULE_JSON_SCHEMA_UNCOMPILABLE_EXPLANATION.rule]: VALIDATION_RULE_JSON_SCHEMA_UNCOMPILABLE_EXPLANATION,
  [VALIDATION_RULE_JSON_SCHEMA_UNKNOWN_FORMAT_EXPLANATION.rule]: VALIDATION_RULE_JSON_SCHEMA_UNKNOWN_FORMAT_EXPLANATION,
  [MEASURE_AGGREGATE_FIELD_TYPE_REFUSED_EXPLANATION.rule]: MEASURE_AGGREGATE_FIELD_TYPE_REFUSED_EXPLANATION,
  [DIMENSION_JSON_STORED_FIELD_REFUSED_EXPLANATION.rule]: DIMENSION_JSON_STORED_FIELD_REFUSED_EXPLANATION,
  [REACT_CHART_DRILLDOWN_INVALID_EXPLANATION.rule]: REACT_CHART_DRILLDOWN_INVALID_EXPLANATION,
  [REACT_CHART_AGGREGATE_INVALID_EXPLANATION.rule]: REACT_CHART_AGGREGATE_INVALID_EXPLANATION,
  [REACT_CHART_FIELD_UNPROVISIONED_EXPLANATION.rule]: REACT_CHART_FIELD_UNPROVISIONED_EXPLANATION,
  [REACT_BLOCK_NEEDS_RECORD_CONTEXT_EXPLANATION.rule]: REACT_BLOCK_NEEDS_RECORD_CONTEXT_EXPLANATION,
  [REACT_PAGE_SOURCE_UNPARSEABLE_EXPLANATION.rule]: REACT_PAGE_SOURCE_UNPARSEABLE_EXPLANATION,
  [SORT_FIELD_UNKNOWN_EXPLANATION.rule]: SORT_FIELD_UNKNOWN_EXPLANATION,
  [SORT_FIELD_UNSORTABLE_EXPLANATION.rule]: SORT_FIELD_UNSORTABLE_EXPLANATION,
  [SORT_FIELD_UNPROVISIONED_EXPLANATION.rule]: SORT_FIELD_UNPROVISIONED_EXPLANATION,
  [SEARCHABLE_FIELD_UNKNOWN_EXPLANATION.rule]: SEARCHABLE_FIELD_UNKNOWN_EXPLANATION,
  [SEARCHABLE_FIELD_UNSEARCHABLE_EXPLANATION.rule]: SEARCHABLE_FIELD_UNSEARCHABLE_EXPLANATION,
  [SEARCHABLE_FIELD_UNPROVISIONED_EXPLANATION.rule]: SEARCHABLE_FIELD_UNPROVISIONED_EXPLANATION,
  [PREDICATE_PATH_UNRESOLVED_EXPLANATION.rule]: PREDICATE_PATH_UNRESOLVED_EXPLANATION,
  [PREDICATE_PATH_UNROOTED_EXPLANATION.rule]: PREDICATE_PATH_UNROOTED_EXPLANATION,
  [PREDICATE_RHS_PATH_SHAPED_EXPLANATION.rule]: PREDICATE_RHS_PATH_SHAPED_EXPLANATION,
  [ACTION_DISPATCH_CONTRACT_MISMATCH_EXPLANATION.rule]: ACTION_DISPATCH_CONTRACT_MISMATCH_EXPLANATION,
  [COMPONENT_TYPE_UNKNOWN_EXPLANATION.rule]: COMPONENT_TYPE_UNKNOWN_EXPLANATION,
  [COMPONENT_PROPS_INVALID_EXPLANATION.rule]: COMPONENT_PROPS_INVALID_EXPLANATION,
  [PRINT_PAGE_BLOCK_UNPRINTABLE_EXPLANATION.rule]: PRINT_PAGE_BLOCK_UNPRINTABLE_EXPLANATION,
  [FILTER_PRESET_COMPARAND_EXPLANATION.rule]: FILTER_PRESET_COMPARAND_EXPLANATION,
  [FILTER_TOKEN_UNKNOWN_EXPLANATION.rule]: FILTER_TOKEN_UNKNOWN_EXPLANATION,
  [APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY_EXPLANATION.rule]: APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY_EXPLANATION,
  [APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER_EXPLANATION.rule]: APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER_EXPLANATION,
  [APPROVAL_EXPRESSION_INVALID_EXPLANATION.rule]: APPROVAL_EXPRESSION_INVALID_EXPLANATION,
  [APPROVAL_EXPRESSION_NO_EMPTY_POLICY_EXPLANATION.rule]: APPROVAL_EXPRESSION_NO_EMPTY_POLICY_EXPLANATION,
  [TITLE_FORMAT_RETIRED_EXPLANATION.rule]: TITLE_FORMAT_RETIRED_EXPLANATION,
  [TITLE_UNRESOLVABLE_EXPLANATION.rule]: TITLE_UNRESOLVABLE_EXPLANATION,
  [UNIQUE_LEGACY_ORGANIZATION_COMPOSITE_EXPLANATION.rule]: UNIQUE_LEGACY_ORGANIZATION_COMPOSITE_EXPLANATION,
  [UNIQUE_UNSCOPED_DECLARED_INDEX_EXPLANATION.rule]: UNIQUE_UNSCOPED_DECLARED_INDEX_EXPLANATION,
  [UNIQUE_DOUBLE_DECLARATION_EXPLANATION.rule]: UNIQUE_DOUBLE_DECLARATION_EXPLANATION,
  [RELATIONSHIP_MASTER_DETAIL_REQUIRED_EXPLANATION.rule]: RELATIONSHIP_MASTER_DETAIL_REQUIRED_EXPLANATION,
  [ROLLUP_NON_NUMERIC_AGGREGAND_EXPLANATION.rule]: ROLLUP_NON_NUMERIC_AGGREGAND_EXPLANATION,
  [RELATIONSHIP_DELETE_BEHAVIOR_EXPLANATION.rule]: RELATIONSHIP_DELETE_BEHAVIOR_EXPLANATION,
  [DEFAULT_AGENT_LEGACY_ALIAS_EXPLANATION.rule]: DEFAULT_AGENT_LEGACY_ALIAS_EXPLANATION,
  [DEFAULT_AGENT_OUTSIDE_ROSTER_EXPLANATION.rule]: DEFAULT_AGENT_OUTSIDE_ROSTER_EXPLANATION,
  [AGENT_AUTHORING_WITHDRAWN_EXPLANATION.rule]: AGENT_AUTHORING_WITHDRAWN_EXPLANATION,
  [VIEW_REF_NAV_VIEW_MISSING_EXPLANATION.rule]: VIEW_REF_NAV_VIEW_MISSING_EXPLANATION,
  [VIEW_KEY_COLLISION_EXPLANATION.rule]: VIEW_KEY_COLLISION_EXPLANATION,
  [CHART_MEASURE_UNKNOWN_EXPLANATION.rule]: CHART_MEASURE_UNKNOWN_EXPLANATION,
  [CHART_AXIS_NOT_SELECTED_EXPLANATION.rule]: CHART_AXIS_NOT_SELECTED_EXPLANATION,
  [DASHBOARD_ACTION_TARGET_UNDEFINED_EXPLANATION.rule]: DASHBOARD_ACTION_TARGET_UNDEFINED_EXPLANATION,
  [DASHBOARD_ACTION_ROUTE_UNRESOLVED_EXPLANATION.rule]: DASHBOARD_ACTION_ROUTE_UNRESOLVED_EXPLANATION,
  [FILTER_EMPTY_COMBINATOR_EXPLANATION.rule]: FILTER_EMPTY_COMBINATOR_EXPLANATION,
  [FILTER_EMPTY_NODE_EXPLANATION.rule]: FILTER_EMPTY_NODE_EXPLANATION,
  [LIST_VIEW_FIELD_UNKNOWN_EXPLANATION.rule]: LIST_VIEW_FIELD_UNKNOWN_EXPLANATION,
  [LIST_VIEW_FIELD_DOTTED_EXPLANATION.rule]: LIST_VIEW_FIELD_DOTTED_EXPLANATION,
  [LIST_VIEW_OBJECT_OUTSIDE_CLOSURE_EXPLANATION.rule]: LIST_VIEW_OBJECT_OUTSIDE_CLOSURE_EXPLANATION,
  [LIST_VIEW_OBJECT_UNKNOWN_EXPLANATION.rule]: LIST_VIEW_OBJECT_UNKNOWN_EXPLANATION,
  [TRANSLATION_TARGET_UNKNOWN_EXPLANATION.rule]: TRANSLATION_TARGET_UNKNOWN_EXPLANATION,
  [TRANSLATION_OPTION_KEY_UNKNOWN_EXPLANATION.rule]: TRANSLATION_OPTION_KEY_UNKNOWN_EXPLANATION,
  [TRANSLATION_SECTION_NAME_MISSING_EXPLANATION.rule]: TRANSLATION_SECTION_NAME_MISSING_EXPLANATION,
  [NAV_OBJECT_UNGRANTED_EXPLANATION.rule]: NAV_OBJECT_UNGRANTED_EXPLANATION,
  [NAV_OBJECT_UNSERVABLE_EXPLANATION.rule]: NAV_OBJECT_UNSERVABLE_EXPLANATION,
  [NAV_TARGET_UNRESOLVED_EXPLANATION.rule]: NAV_TARGET_UNRESOLVED_EXPLANATION,
  [OBJECT_FIELD_REF_UNKNOWN_EXPLANATION.rule]: OBJECT_FIELD_REF_UNKNOWN_EXPLANATION,
  [OBJECT_REFERENCE_UNKNOWN_EXPLANATION.rule]: OBJECT_REFERENCE_UNKNOWN_EXPLANATION,
  [OBJECT_REFERENCE_UNREGISTERED_PLATFORM_EXPLANATION.rule]: OBJECT_REFERENCE_UNREGISTERED_PLATFORM_EXPLANATION,
  [CAPABILITY_REFERENCE_UNKNOWN_EXPLANATION.rule]: CAPABILITY_REFERENCE_UNKNOWN_EXPLANATION,
  [LIST_VIEW_FILTERS_IN_VIEWS_MODE_EXPLANATION.rule]: LIST_VIEW_FILTERS_IN_VIEWS_MODE_EXPLANATION,
  [LIVENESS_LEDGER_UNREADABLE_EXPLANATION.rule]: LIVENESS_LEDGER_UNREADABLE_EXPLANATION,
  [PAGE_FIELD_UNKNOWN_EXPLANATION.rule]: PAGE_FIELD_UNKNOWN_EXPLANATION,
  [PAGE_SECTION_COUNT_NOT_MULTI_VALUE_EXPLANATION.rule]: PAGE_SECTION_COUNT_NOT_MULTI_VALUE_EXPLANATION,
  [PAGE_FIELD_UNPROVISIONED_EXPLANATION.rule]: PAGE_FIELD_UNPROVISIONED_EXPLANATION,
  [PAGE_SECTION_GROUP_UNKNOWN_EXPLANATION.rule]: PAGE_SECTION_GROUP_UNKNOWN_EXPLANATION,
  [FORM_SECTION_GROUP_UNKNOWN_EXPLANATION.rule]: FORM_SECTION_GROUP_UNKNOWN_EXPLANATION,
  [FLOW_TEMPLATE_FIELD_UNPROVISIONED_EXPLANATION.rule]: FLOW_TEMPLATE_FIELD_UNPROVISIONED_EXPLANATION,
  [FLOW_TEMPLATE_LOOKUP_TRAVERSAL_EXPLANATION.rule]: FLOW_TEMPLATE_LOOKUP_TRAVERSAL_EXPLANATION,
  [FLOW_DOUBLE_BRACE_INTERPOLATION_EXPLANATION.rule]: FLOW_DOUBLE_BRACE_INTERPOLATION_EXPLANATION,
  [FLOW_BARE_DOLLAR_REFERENCE_EXPLANATION.rule]: FLOW_BARE_DOLLAR_REFERENCE_EXPLANATION,
  [FLOW_LOOP_BODY_UNCONTAINED_EXPLANATION.rule]: FLOW_LOOP_BODY_UNCONTAINED_EXPLANATION,
  [FLOW_TRY_CATCH_WITHOUT_CATCH_EXPLANATION.rule]: FLOW_TRY_CATCH_WITHOUT_CATCH_EXPLANATION,
  [FLOW_MULTI_WRITE_UNFILTERED_EXPLANATION.rule]: FLOW_MULTI_WRITE_UNFILTERED_EXPLANATION,
  [FLOW_DECISION_INCLUSIVE_OVERLAP_EXPLANATION.rule]: FLOW_DECISION_INCLUSIVE_OVERLAP_EXPLANATION,
  [FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED_EXPLANATION.rule]: FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED_EXPLANATION,
  [FLOW_TIME_RELATIVE_ANTIPATTERN_EXPLANATION.rule]: FLOW_TIME_RELATIVE_ANTIPATTERN_EXPLANATION,
  [FLOW_DATE_EQUALITY_FILTER_EXPLANATION.rule]: FLOW_DATE_EQUALITY_FILTER_EXPLANATION,
  [FLOW_RUNAS_UNSCOPED_EXPLANATION.rule]: FLOW_RUNAS_UNSCOPED_EXPLANATION,
  [FLOW_DECISION_MODE_INVALID_EXPLANATION.rule]: FLOW_DECISION_MODE_INVALID_EXPLANATION,
  [FLOW_DECISION_UNCONDITIONAL_BRANCH_EXPLANATION.rule]: FLOW_DECISION_UNCONDITIONAL_BRANCH_EXPLANATION,
  [FLOW_ERROR_LABEL_NOT_FAULT_EXPLANATION.rule]: FLOW_ERROR_LABEL_NOT_FAULT_EXPLANATION,
  [FLOW_BRANCH_LABEL_UNMATCHED_EXPLANATION.rule]: FLOW_BRANCH_LABEL_UNMATCHED_EXPLANATION,
  [ACTION_NAME_UNDEFINED_EXPLANATION.rule]: ACTION_NAME_UNDEFINED_EXPLANATION,
  [MAPPING_TARGET_FIELD_UNKNOWN_EXPLANATION.rule]: MAPPING_TARGET_FIELD_UNKNOWN_EXPLANATION,
  [VIEW_CONTAINER_SHAPE_EXPLANATION.rule]: VIEW_CONTAINER_SHAPE_EXPLANATION,
  [PAGE_SOURCE_CLASSNAME_TAILWIND_EXPLANATION.rule]: PAGE_SOURCE_CLASSNAME_TAILWIND_EXPLANATION,
  [PAGE_VISUALIZATION_WITHOUT_BINDING_EXPLANATION.rule]: PAGE_VISUALIZATION_WITHOUT_BINDING_EXPLANATION,
  [FLOW_CREDENTIAL_LITERAL_EXPLANATION.rule]: FLOW_CREDENTIAL_LITERAL_EXPLANATION,
  [AI_SKILL_SURFACE_MISMATCH_EXPLANATION.rule]: AI_SKILL_SURFACE_MISMATCH_EXPLANATION,
  [AI_SKILL_TOOL_UNRESOLVED_EXPLANATION.rule]: AI_SKILL_TOOL_UNRESOLVED_EXPLANATION,
  [MANAGED_API_METHOD_UNAFFORDABLE_EXPLANATION.rule]: MANAGED_API_METHOD_UNAFFORDABLE_EXPLANATION,
  [ORG_AXIS_PERMISSION_INHERITANCE_EXPLANATION.rule]: ORG_AXIS_PERMISSION_INHERITANCE_EXPLANATION,
  [ORG_AXIS_CROSS_ORG_BU_GRANT_EXPLANATION.rule]: ORG_AXIS_CROSS_ORG_BU_GRANT_EXPLANATION,
  [PERMISSION_RETIRED_LIFECYCLE_RESIDUE_EXPLANATION.rule]: PERMISSION_RETIRED_LIFECYCLE_RESIDUE_EXPLANATION,
  [SEED_INSERT_MODE_DUPLICATES_ON_REPLAY_EXPLANATION.rule]: SEED_INSERT_MODE_DUPLICATES_ON_REPLAY_EXPLANATION,
  [SEED_VALUE_OUTSIDE_STATE_MACHINE_EXPLANATION.rule]: SEED_VALUE_OUTSIDE_STATE_MACHINE_EXPLANATION,
  [SEMANTIC_ROLE_FIELD_UNPROVISIONED_EXPLANATION.rule]: SEMANTIC_ROLE_FIELD_UNPROVISIONED_EXPLANATION,
  [ACTION_NO_PLACEMENT_EXPLANATION.rule]: ACTION_NO_PLACEMENT_EXPLANATION,
  [UNCONSUMED_WIDGET_OPTION_EXPLANATION.rule]: UNCONSUMED_WIDGET_OPTION_EXPLANATION,
  [HOOK_BODY_NOT_LOWERABLE_EXPLANATION.rule]: HOOK_BODY_NOT_LOWERABLE_EXPLANATION,
  [HOOK_BODY_BUNDLED_FALLBACK_EXPLANATION.rule]: HOOK_BODY_BUNDLED_FALLBACK_EXPLANATION,
  [HOOK_BODY_UNPARSEABLE_EXPLANATION.rule]: HOOK_BODY_UNPARSEABLE_EXPLANATION,
  [HOOK_BODY_EXTRACTION_FAILED_EXPLANATION.rule]: HOOK_BODY_EXTRACTION_FAILED_EXPLANATION,
  [DOCS_UNCOLLECTED_DIRECTORY_EXPLANATION.rule]: DOCS_UNCOLLECTED_DIRECTORY_EXPLANATION,
  [DOCS_DUPLICATE_NAME_EXPLANATION.rule]: DOCS_DUPLICATE_NAME_EXPLANATION,
  [DOCS_NAV_TARGET_EXPLANATION.rule]: DOCS_NAV_TARGET_EXPLANATION,
  [DOCS_FRONTMATTER_TAGS_EXPLANATION.rule]: DOCS_FRONTMATTER_TAGS_EXPLANATION,
  [PICKLIST_REFERENCE_UNVERIFIED_EXPLANATION.rule]: PICKLIST_REFERENCE_UNVERIFIED_EXPLANATION,
});

/** The explanation for `rule`, or `undefined` when the rule has none. Exact id match. */
export function explainRule(rule: string): RuleExplanation | undefined {
  return Object.prototype.hasOwnProperty.call(RULE_EXPLANATIONS, rule) ? RULE_EXPLANATIONS[rule] : undefined;
}
