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

const DASHBOARD_FILTER_FIELD_UNPROVISIONED_EXPLANATION: RuleExplanation = {
  rule: 'dashboard-filter-field-unprovisioned',
  covers: 'why a filter on an unprovisioned anchor matches nothing',
  paragraphs: [
    'The registry injects system columns — the ownership and audit anchors such as `owner_id`, ' +
      '`created_at` and `created_by` — into objects. On an ADR-0015 external object the remote ' +
      'database owns the schema, so the platform registers these anchors without provisioning a ' +
      'column: the name resolves, but no storage stands behind it.',
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
});

/** The explanation for `rule`, or `undefined` when the rule has none. Exact id match. */
export function explainRule(rule: string): RuleExplanation | undefined {
  return Object.prototype.hasOwnProperty.call(RULE_EXPLANATIONS, rule) ? RULE_EXPLANATIONS[rule] : undefined;
}
