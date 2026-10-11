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
 * `@objectstack/spec`) and each such list to the rule's own constant, so
 * neither can drift from the rule it explains.
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
      '`carrier-only` when only carriers do — then the warning lists each carrier site, because ' +
      'removing the declaration means cleaning them too. Verdicts are per object: a consumer of the ' +
      'same field name on another object does not cover this declaration.',
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
 * `sort-field-unprovisioned`, `searchable-field-unprovisioned`).
 * The rule files share its verdict clause, `unprovisionedAnchorVerdict()`.
 */
const UNPROVISIONED_ANCHOR_CAUSE =
  'The registry injects system columns — the ownership and audit anchors such as `owner_id`, ' +
  '`created_at` and `created_by` — into objects. On an ADR-0015 external object the remote ' +
  'database owns the schema, so the platform registers these anchors without provisioning a ' +
  'column: the name resolves, but no storage stands behind it.';

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
    'To fix it, select at least one measure of the dataset by name in `values`. Suppress with ' +
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
      'of the dataset by name in `values`. Suppress with `suppressWarnings: [\'widget-measures-missing\']` ' +
      'while the widget is still being authored.',
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
    'To fix it, plot the chart against a dataset dimension (`dimensions`), or, if a single value IS ' +
      'what the tile should show, declare it as a `metric` or `kpi` widget so the type matches what ' +
      'renders. Suppress with `suppressWarnings: [\'chart-dimensions-missing\']`.',
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
      'every dimension or measure written against that prefix addresses nothing.',
    'Resolution is the shared object graph\'s, injected columns included: `owner_id` reads as the ' +
      'lookup it is and joins, `created_at` reads as a datetime and does not. Not reported: a dataset ' +
      'whose base object this stack does not define or cannot read the fields of.',
    'To fix it, declare a relationship that exists on the join chain from the dataset\'s object, or ' +
      'drop the entry. Declaring `a.b` implicitly includes `a`.',
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
      'and the verdict names the hop that failed. Not reported: an object this stack does not define, ' +
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
  covers: 'how the master relation is chosen',
  paragraphs: [
    'A `controlled_by_parent` object derives every row\'s record-level access from a master record. ' +
      'ADR-0055 resolves the master through three tiers, in order — a required master_detail, then any ' +
      'master_detail, then a required lookup, each of which must also name a `reference` target — and ' +
      'takes the FIRST match in the tier that wins.',
    'When two or more fields tie in the winning tier, which object this one derives its access from ' +
      'is decided by FIELD DECLARATION ORDER. Moving a field up or down the schema reads as a cosmetic ' +
      'edit in review, and it silently moves that security boundary to another object; the runtime ' +
      'reports nothing when it does, because it does not refuse, it picks. Author time is the only ' +
      'place this can surface, so the rule is an error. A tie in a lower tier is masked by a higher ' +
      'tier\'s single winner and is not reported.',
    'To fix it, leave exactly ONE candidate in the winning tier: promote the intended master into a ' +
      'higher tier (make it the object\'s only required master_detail), or demote the others (drop ' +
      '`required`, or change the relation type). System objects are judged too: the ambiguity is a ' +
      'property of the document.',
  ],
};

const SECURITY_CBP_NO_RELATION_EXPLANATION: RuleExplanation = {
  rule: 'security-controlled-by-parent-no-relation',
  covers: 'why the object is unusable without a master',
  paragraphs: [
    'A `controlled_by_parent` object says its access comes from its master. ADR-0055 resolves the ' +
      'master through a required master_detail, then any master_detail, then a required lookup — each ' +
      'of which must also name a `reference` target — and an object that matches none of the three has ' +
      'nothing to derive access from.',
    'Both runtime halves refuse it: every read is DENIED, and every write is refused with 422 ' +
      'INVALID_METADATA — as a metadata defect rather than a permission denial — so the object is ' +
      'unusable rather than merely locked down. System objects are judged too, because the runtime ' +
      'refusal does not exempt them.',
    'To fix it, add the master relation this object is derived from, a `master_detail` field with a ' +
      '`reference` and `required: true`. An object with no master decides its own baseline: ' +
      '\'private\', \'public_read\' or \'public_read_write\'.',
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
      'and if the field was renamed the mask has been off since that rename.',
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
      'its master the way the runtime does (a required lookup included). The rule is a warning, and it ' +
      'stays silent when the stack authors no permission sets or a `\'*\'` wildcard grant covers every ' +
      'object; one set granting the child while another forgets it is out of scope.',
    'To fix it, grant the object in at least one permission set that already grants its master — ' +
      'allowRead, allowCreate and allowEdit. A table no role should ever touch is named `sys_*` or set ' +
      '`isSystem: true`.',
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
      'just not on \'sharingModel\' or \'externalSharingModel\'. Its fix-it offers \'public_read_write\'.',
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
      '(`const r = ctx.record`) counts as an escape; a property read does not.',
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
      'conditional lock, and `sudo()` is not marshalled into the sandbox in any case.',
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
 * What a dropped `using` does. The INSERT half: the ADR-0058 D4 write check
 * takes its set from `writeCheckPolicies`, so when no applicable policy for the
 * insert declares a `check`, every applicable policy's `using` is compiled as
 * its check. Measured through the real `SecurityPlugin` on an `insert` and an
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
  'permission set. When other policies also apply, this one just vanishes from the OR and grants none of the ' +
  'access it appears to. On an `insert` or `all` policy the same `using` is also the single-record INSERT check ' +
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

const RLS_PREDICATE_UNPARSEABLE_EXPLANATION: RuleExplanation = {
  rule: 'rls-predicate-unparseable',
  covers: 'why a predicate that does not parse is dropped',
  paragraphs: [
    'An RLS predicate is CEL (ADR-0058 D1). Before parsing, a legacy SQL bridge rewrites the historic subset ' +
      'it covers — a bare `=` to `==` and `IN` to `in`, never inside a quoted literal — and everything else must ' +
      'already be CEL: SQL `AND` / `OR` / `LIKE`, a subquery or a stray operator does not parse.',
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
      'The finding quotes the verdict half of the compiler\'s own refusal.',
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
    'The same per-request drop, with the same signal, follows a lowered comparand the platform\'s shared filter ' +
      'check refuses — a `null` list member or a `null` ordering bound, which no two backends agree on: ' +
      '`RLSCompiler` runs that check on every compiled policy filter before any backend sees it.',
    RLS_DROPPED_USING,
    RLS_DROPPED_CHECK,
    LIST_HOLDING_COMPARISON,
    CROSS_CLASS_COMPARISON,
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
    'The compiler answers `unresolved-variable` for it in EVERY position — including under `!` and in a ' +
      'trailing `||` arm — so `RLSCompiler` DROPS the policy at request time, and one WARN line is the only ' +
      'signal.',
    RLS_DROPPED_USING,
    'The object then disappears not because its readers were denied, but because the narrowing they were ' +
      'granted resolves to nothing.',
    RLS_DROPPED_CHECK,
    'An unknown key in a membership position (`field in current_user.KEY`) is never reported: there it is ' +
      'indistinguishable from a correct §7.3.1 reference an app stages.',
  ],
};

/** What happens to a declared sharing rule whose `condition` does not lower — the two condition ids. */
const SHARING_RULE_SKIPPED =
  'A declared sharing rule\'s `condition` is compiled ONCE, at boot: `bootstrapDeclaredSharingRules` lowers it ' +
  'to a static `criteria_json` filter with no variables bound. A condition that does not lower is not ' +
  'degraded, partially applied or deferred — the rule is SKIPPED: it is never written to `sys_sharing_rule`, ' +
  'no `sys_record_share` grant is ever materialised, and the only signal is one WARN line in the boot log. An ' +
  'unlowerable condition is never seeded as a permissive match-all (ADR-0049), so the rule is declared and ' +
  'grants nothing.';

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
    SHARING_RULE_SKIPPED,
    LIST_HOLDING_COMPARISON,
    CROSS_CLASS_COMPARISON,
    'Such a comparison lowers, so the rule IS seeded into `sys_sharing_rule`, but every criteria query it runs ' +
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
    'A criteria sharing rule is MATERIALISED: the seeder compiles one static `criteria_json` per rule and the ' +
      'evaluator writes `sys_record_share` rows from it, so there is no "current user" at compile time and the ' +
      'compiler refuses a `current_user.*` read.',
    SHARING_RULE_SKIPPED,
    'The fix is a different mechanism, not a different spelling, and which one depends on the anchor object\'s ' +
      '`sharingModel`; the `fix:` line names both.',
  ],
};

const SHARING_RULE_OBJECT_NOT_SHAREABLE_EXPLANATION: RuleExplanation = {
  rule: 'sharing-rule-object-not-shareable',
  covers: 'why a rule on a public object grants nothing',
  paragraphs: [
    'Sharing only ever WIDENS an organization-wide default (OWD) baseline, and on the widest baseline there is ' +
      'nothing left to widen. An object\'s effective sharing model is `public` when it declares ' +
      '`sharingModel: \'public_read_write\'`, or when it declares none and is a system object (`isSystem: true` ' +
      'or a `sys_` name), which ADR-0090 D1 resolves to public. A custom object with no `sharingModel` resolves ' +
      'to private and is not reported.',
    SHARING_INERT_GRANT,
    'Here the refusal reads "\'OBJECT\' is not under record-sharing enforcement". Measured: `buildReadFilter` ' +
      'returns `null` for such an object — NO record-level filter at all — so every principal already reads ' +
      'every row, and the rule advertises a restriction that does not exist.',
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
      '`config.schedule` on the same start node.',
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
      'is one flow per event.',
    FLOW_GATE_REACH,
  ],
};

const FLOW_API_TRIGGER_SECRET_MISSING_EXPLANATION: RuleExplanation = {
  rule: 'flow-api-trigger-secret-missing',
  covers: 'why an inbound api flow needs a secret',
  paragraphs: [
    'An inbound api hook is armed only with a per-flow secret that every post is HMAC-verified against ' +
      '(ADR-0041): the `x-objectstack-signature` header carries \'sha256=\' and the hex HMAC-SHA256 of ' +
      'the raw body. A usable secret is a string that is not blank after trimming, on the start node\'s ' +
      '`config.secret`; absent, blank and non-string are one verdict.',
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
    'The registered names are read off a live instance of that ajv, never written down, so the rule ' +
      'follows `ajv-formats` across an upgrade. Names are case-sensitive and hyphenated (`date-time`, not ' +
      '`datetime`); the `fix:` line names the nearest registered one and lists them all.',
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
      'in an object-metric block.',
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
      'keyword target. The verdict quotes at most three names of a declared set.',
    VIRTUAL_FIELD_STORAGE,
    'A formula entry is refused on EVERY surface, the object\'s own set included: measured, it ' +
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
  ],
};

// ── Metadata-form predicate paths (`validate-predicate-path-refs.ts`) ───────
// A metadata-editing form's `visibleWhen` predicate, judged against the schema
// of the metadata type the form edits; the three ids share the scope.

/** Which predicates the three ids judge, and the oracle they ask (all three). */
const PREDICATE_FORM_SCOPE =
  'Judged: the `visibleWhen` (or `visibleOn`) predicates on a metadata-editing form — a `views[]` ' +
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
    'A `data.`-rooted path is walked segment by segment through the target schema; the first segment ' +
      'the schema does not declare at that point is the verdict. The syntax rules cannot see this: ' +
      '`data.tpye == \'formula\'` parses, is rooted, and is rooted on the right root.',
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
      '`data` is the ROW, still spelled `data` — and never flattens its values to top level. A bare ' +
      'identifier that IS a key of the edited schema is that key with its root dropped: it resolves ' +
      'to nothing.',
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
      'readings and the `fix:` line names both spellings. Adding the root in place (`== data.active`) ' +
      'is not one of them: it is a path on the right, this id\'s error arm. For that one position ' +
      '`visibility-bare-identifier` and `predicate-path-unrooted` stand down, so the author gets one ' +
      'prescription rather than three contradicting ones.',
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
    'A RETIRED type (`RETIRED_PAGE_COMPONENT_TYPES`) is reported by exact name, before the namespace ' +
      'check, because a retirement can take its namespace with it: `user:profile` was the `user:` ' +
      'namespace\'s only member. The verdict quotes the head of the retirement\'s prescription. The ' +
      'whole prescription — what replaces the type, or that nothing does — is the parse door\'s ' +
      'refusal of the same name, which `os validate` and `os build` print, and the kept ' +
      '`ComponentPropsMap` row carries it too: one copy, never restated here.',
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
    'The fix is the preset\'s `{date-macro}` window, which the verdict names — a rolling preset is ' +
      '`{ $gte: START }`, a calendar one `{ $between: [START, END] }` — or an ISO date. The schema ' +
      'door refuses the Mongo-shape ordering positions too, with the whole explanation in its ' +
      'refusal; this rule also reaches view filter rules and filter-array triples, which no condition ' +
      'parse touches, and is the one door for the equality arm.',
    'Not judged: a filter no ancestor binds to an object, an object or dataset the stack does not ' +
      'declare, a `time` field, and a field the object does not declare (the `*-filter-field-unknown` ' +
      'rules\' finding).',
  ],
};

// ── Approval approvers (`validate-approval-approvers.ts`) ───────────────────

const APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY_EXPLANATION: RuleExplanation = {
  rule: 'approval-approvers-may-resolve-empty',
  covers: 'why an all-group or all-manager slate can stall',
  paragraphs: [
    'An approval node opens its request on the people its approvers expand to at runtime. When ' +
      'EVERY approver on the node routes to a group whose membership is runtime data — a ' +
      '`position`, a `team` or a `department` — and none is staffed, the request opens on an empty ' +
      '`pending_approvers` slate: no user can act, so it waits forever, and under the default ' +
      '`lockRecord: true` the record stays locked with it, with no in-product recovery. An approver ' +
      'of any other type on the node is a non-group route, so a mixed slate is not judged.',
    'The `manager` arm is the same dead end with a cause the product cannot repair. ' +
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
      'row whose organization column is NULL, which on a single-organization deployment is every ' +
      'row.',
    'Respelled `unique: \'organization\'`, the NULL rows become one platform bucket ' +
      '(`COALESCE(organization_id, \'__global__\')`) that is unique among themselves, which is what ' +
      'closes the hole.',
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
      '`required: true` and refuses an explicit `required: false`. The builder never inspects ' +
      '`readonly` or `system`, and a plain object literal or a raw `.parse()` of stored metadata ' +
      'never runs it, so this rule is where all three shapes meet a refusal at authoring time. One ' +
      'finding per field, located at its first defect.',
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
  [DATASET_INCLUDE_UNKNOWN_EXPLANATION.rule]: DATASET_INCLUDE_UNKNOWN_EXPLANATION,
  [DATASET_FIELD_UNKNOWN_EXPLANATION.rule]: DATASET_FIELD_UNKNOWN_EXPLANATION,
  [DATASET_FIELD_NOT_INCLUDED_EXPLANATION.rule]: DATASET_FIELD_NOT_INCLUDED_EXPLANATION,
  [DATASET_FILTER_FIELD_UNKNOWN_EXPLANATION.rule]: DATASET_FILTER_FIELD_UNKNOWN_EXPLANATION,
  [SECURITY_CBP_AMBIGUOUS_RELATION_EXPLANATION.rule]: SECURITY_CBP_AMBIGUOUS_RELATION_EXPLANATION,
  [SECURITY_CBP_NO_RELATION_EXPLANATION.rule]: SECURITY_CBP_NO_RELATION_EXPLANATION,
  [SECURITY_FLS_UNKNOWN_FIELD_EXPLANATION.rule]: SECURITY_FLS_UNKNOWN_FIELD_EXPLANATION,
  [SECURITY_MASTER_DETAIL_UNGRANTED_EXPLANATION.rule]: SECURITY_MASTER_DETAIL_UNGRANTED_EXPLANATION,
  [SECURITY_OWD_ALIAS_EXPLANATION.rule]: SECURITY_OWD_ALIAS_EXPLANATION,
  [SECURITY_DELEGATION_MISSING_REASON_EXPLANATION.rule]: SECURITY_DELEGATION_MISSING_REASON_EXPLANATION,
  [VISIBILITY_ROOT_MISLAYERED_EXPLANATION.rule]: VISIBILITY_ROOT_MISLAYERED_EXPLANATION,
  [VISIBILITY_PREDICATE_OVER_BUDGET_EXPLANATION.rule]: VISIBILITY_PREDICATE_OVER_BUDGET_EXPLANATION,
  [VISIBILITY_PREDICATE_SYNTAX_EXPLANATION.rule]: VISIBILITY_PREDICATE_SYNTAX_EXPLANATION,
  [VISIBILITY_PREDICATE_UNKNOWN_FUNCTION_EXPLANATION.rule]: VISIBILITY_PREDICATE_UNKNOWN_FUNCTION_EXPLANATION,
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
  [SHARING_RULE_UNLOWERABLE_CONDITION_EXPLANATION.rule]: SHARING_RULE_UNLOWERABLE_CONDITION_EXPLANATION,
  [SHARING_RULE_RUNTIME_VARIABLE_CONDITION_EXPLANATION.rule]: SHARING_RULE_RUNTIME_VARIABLE_CONDITION_EXPLANATION,
  [SHARING_RULE_OBJECT_NOT_SHAREABLE_EXPLANATION.rule]: SHARING_RULE_OBJECT_NOT_SHAREABLE_EXPLANATION,
  [SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT_EXPLANATION.rule]: SHARING_RULE_OBJECT_CONTROLLED_BY_PARENT_EXPLANATION,
  [FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID_EXPLANATION.rule]: FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID_EXPLANATION,
  [FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE_EXPLANATION.rule]: FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE_EXPLANATION,
  [FLOW_TRIGGER_UNROUTABLE_EXPLANATION.rule]: FLOW_TRIGGER_UNROUTABLE_EXPLANATION,
  [FLOW_TRIGGER_UNKNOWN_EVENT_EXPLANATION.rule]: FLOW_TRIGGER_UNKNOWN_EVENT_EXPLANATION,
  [FLOW_API_TRIGGER_SECRET_MISSING_EXPLANATION.rule]: FLOW_API_TRIGGER_SECRET_MISSING_EXPLANATION,
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
  [FILTER_PRESET_COMPARAND_EXPLANATION.rule]: FILTER_PRESET_COMPARAND_EXPLANATION,
  [APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY_EXPLANATION.rule]: APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY_EXPLANATION,
  [APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER_EXPLANATION.rule]: APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER_EXPLANATION,
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
});

/** The explanation for `rule`, or `undefined` when the rule has none. Exact id match. */
export function explainRule(rule: string): RuleExplanation | undefined {
  return Object.prototype.hasOwnProperty.call(RULE_EXPLANATIONS, rule) ? RULE_EXPLANATIONS[rule] : undefined;
}
