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
});

/** The explanation for `rule`, or `undefined` when the rule has none. Exact id match. */
export function explainRule(rule: string): RuleExplanation | undefined {
  return Object.prototype.hasOwnProperty.call(RULE_EXPLANATIONS, rule) ? RULE_EXPLANATIONS[rule] : undefined;
}
