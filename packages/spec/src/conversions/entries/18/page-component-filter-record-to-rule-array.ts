// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-component-filter-record-to-rule-array` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helpers
// `RULE_ARRAY_FILTER_BLOCK_TYPES`, `MappedFilterRule`,
// `ruleOperatorForFilterOperator`, `FilterMapping`, `firstSentence`,
// `quoteKeys`, `dollarKeysReason`, `recordFilterToRules`, `astFilterToRules`,
// `legacyFilterToRuleArray` are read by this conversion alone). A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageComponentFilterRecordToRuleArray` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import {
  FILTER_ARRAY_LOGIC_KEYWORDS,
  FILTER_OPERATORS,
  LOGICAL_OPERATORS,
  isFilterAST,
  parseFilterAST,
} from '../../../data/filter.zod.js';
import { isRecordForm } from '../../../ui/filter-rule-array.js';
import {
  VIEW_FILTER_OPERATORS,
  ViewFilterRuleSchema,
  normalizeFilterOperator,
  type ViewFilterOperator,
} from '../../../ui/view.zod.js';
import { type Dict, describeBlock, isDict } from '../shared.js';

/**
 * The page-component types whose `properties.filter` is a converged rule-array
 * door: every `ComponentPropsMap` row whose `filter` answers the record form
 * with `ruleArrayFilterError`'s prescription (`ui/filter-rule-array.ts`).
 * `page-component-filter-record-to-rule-array.test.ts` derives that set from
 * the schema and holds this list equal to it, so a door that joins the family
 * without this conversion learning of it goes red there rather than being
 * silently skipped at rest.
 */
const RULE_ARRAY_FILTER_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'object-grid',
  'object-metric',
  'object-kanban',
  'object-calendar',
  'object-map',
  'object-gantt',
  'object-tree',
  'object-timeline',
]);
// `element:number` and `element:record_picker` left this list, and the
// `object-grid` `properties.defaultFilters` arm left this entry, with #11509:
// those three flat keys retired in v18, and the two entries that remove them
// (`element-flat-data-binding-to-data-source`, `object-grid-default-filters-removed`)
// run before this one, so a record form they carry reaches this entry at the
// door it moved to — `dataSource.filter`, or the grid's own `filter`.

/** One rule a legacy filter maps to — the rule array's authored element. */
interface MappedFilterRule {
  field: string;
  operator: ViewFilterOperator;
  value?: unknown;
}

/**
 * A FilterCondition `$` operator → the rule operator that lowers back to it,
 * or `undefined` when the rule vocabulary has no such word.
 *
 * Read off the two tables that already exist, never a third: the operator must
 * be a declared FilterCondition field operator (`FILTER_OPERATORS`, so a
 * mis-cased `$Gt` or an unknown `$regex` is not a match), and its name without
 * the `$` must fold through `normalizeFilterOperator` — the fold every rule
 * door runs on `operator` — to a canonical `VIEW_FILTER_OPERATORS` member.
 * That maps the fourteen comparison, set, range and text operators
 * (`$gt` → `greater_than`, `$nin` → `not_in`, `$notContains` → `not_contains`,
 * …) and declines the three whose meaning lives in their VALUE (`$null`,
 * `$exists`, and — in `FILTER_OPERATORS` since #20446 — `$empty`, whose
 * `true` / `false` is `is_empty` / `is_not_empty`); the lowering of every
 * mapped rule back to the same `$` operator is pinned per operator against
 * `parseFilterAST` by the test.
 */
function ruleOperatorForFilterOperator(op: string): ViewFilterOperator | undefined {
  if (!(FILTER_OPERATORS as readonly string[]).includes(op)) return undefined;
  const folded = normalizeFilterOperator(op.slice(1));
  return (VIEW_FILTER_OPERATORS as readonly string[]).includes(folded)
    ? (folded as ViewFilterOperator)
    : undefined;
}

/**
 * A legacy filter's verdict: the rule array it maps to losslessly, or — when
 * some part of it has no lossless rule spelling — why not.
 *
 * `declined` completes the sentence "this filter …" and names the part that
 * blocks the rewrite. It is what the entry's structured TODO carries
 * (`context.reportTodo`, ADR-0087 D3: a TODO where the conversion is not
 * lossless, never silence), so an operator reading `os migrate meta --stored`
 * learns which site was left as stored and what the hand rewrite must decide.
 * The verdict itself is unchanged by it: a declined filter is left exactly as
 * stored, as it always was.
 */
type FilterMapping = { rules: MappedFilterRule[] } | { declined: string };

/** A refusal's first sentence, without its full stop — a TODO reason quotes only that much. */
function firstSentence(message: string): string {
  const end = message.search(/\.(\s|$)/);
  return (end === -1 ? message : message.slice(0, end)).trim();
}

/** `` `a` `` / `` `a` and `b` `` — key names as a TODO reason quotes them. */
function quoteKeys(keys: readonly string[]): string {
  return keys.map((key) => `\`${key}\``).join(' and ');
}

/**
 * Why a record with top-level `$` keys is left as stored — the combinators
 * named first, because naming them is what the ruling asks of the TODO.
 */
function dollarKeysReason(keys: readonly string[]): string {
  const combinators = keys.filter((key) => (LOGICAL_OPERATORS as readonly string[]).includes(key));
  const others = keys.filter((key) => !combinators.includes(key));
  if (combinators.length > 0) {
    const alsoNotFields = others.length === 0
      ? ''
      : ` (its top-level ${quoteKeys(others)} ${others.length === 1 ? 'is' : 'are'} not a field either)`;
    return `carries the combinator${combinators.length === 1 ? '' : 's'} ${quoteKeys(combinators)}`
      + `${alsoNotFields}: a rule array's elements AND, so \`$and\` is only the separate rules it `
      + 'joins, `$or` over flat rules only an any-of group element `{ or: [rule, ...] }` that this '
      + 'conversion does not write, and `$not` has no rule '
      + 'spelling; a combinator is never flattened — '
      + 'that would change which rows the filter selects. Decide which rows it should select, and '
      + 'write the rules that select exactly those';
  }
  return `carries the top-level key${others.length === 1 ? '' : 's'} ${quoteKeys(others)}, which `
    + `${others.length === 1 ? 'is' : 'are'} not a field — a rule names a field, so there is no rule `
    + `spelling for ${others.length === 1 ? 'it' : 'them'}`;
}

/**
 * The record form `{ field: value | { $op: value, … }, … }` → rules, or why
 * some part of it has no lossless rule spelling.
 *
 * All-or-nothing on purpose: the rules AND, so converting the keys that map and
 * leaving the rest out would WIDEN what the filter selects. A top-level `$` key
 * — `$and` / `$or` / `$not` above all — is not a field, so its record is left
 * alone; that is the ruled boundary, and flattening a combinator into the AND
 * list is exactly the silent selection change it excludes. A `null` value is
 * declined too, and not for a schema reason: at the `.objectui-sha` pin the key
 * selects different rows on different blocks, so no one rule keeps it. Where a
 * block queries an object, `convertFiltersToAST` SKIPS a record key whose value
 * is null, so the key constrains nothing; where a block's rows are inline,
 * `ValueDataSource.find` matches the record through `comparandEquals`, so the
 * key selects the rows whose value is null. This entry never reads where a
 * block's rows come from, so its reason states both and advises neither
 * rewrite: it names the `is_null` rule for the rows with no value, and leaves
 * which rows the filter should select to the author. An empty operator object
 * is declined for a different reason: it names a field and no operator, so no
 * rule spells it. At the same pin the renderer refuses it rather than ignoring
 * it — where a block queries an object, `convertFiltersToAST` throws through
 * `refuseEmptyOperatorMap` (`INVALID_FILTER`, 400); where a block's rows are
 * inline, `ValueDataSource.find` answers no rows through
 * `zeroKeyConditionRefusal`. Its reason says both and keeps the renderer's own
 * remedy, dropping the key.
 *
 * Every top-level `$` key is judged before any field key, so the reason names
 * the combinator even when a field key beside it would decline as well. The
 * order moves only the reason, never the verdict: any declined part leaves the
 * whole record as stored.
 */
function recordFilterToRules(record: Record<string, unknown>): FilterMapping {
  const dollarKeys = Object.keys(record).filter((key) => key.startsWith('$'));
  if (dollarKeys.length > 0) return { declined: dollarKeysReason(dollarKeys) };
  const equals = normalizeFilterOperator('eq') as ViewFilterOperator;
  const rules: MappedFilterRule[] = [];
  for (const [field, value] of Object.entries(record)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      rules.push({ field, operator: equals, value });
      continue;
    }
    if (value === null) {
      const isNull = 'is_null' satisfies ViewFilterOperator;
      return {
        declined: `has the key \`${field}\` set to null, and what that key selects depends on where `
          + 'the block\'s rows come from, so no one rule keeps it: where the block queries an object, '
          + 'the renderer skips a null-valued key, so it constrains nothing; where its rows are inline '
          + '(`data: { provider: \'value\' }` or `staticData`), it selects the rows whose '
          + `\`${field}\` is null. Decide which rows it should select: the rows with no \`${field}\` `
          + `value are the rule \`${JSON.stringify({ field, operator: isNull })}\`, and a filter that `
          + `leaves \`${field}\` unconstrained has no rule for it`,
      };
    }
    if (!isRecordForm(value)) {
      return {
        declined: `has the key \`${field}\` set to `
          + `${Array.isArray(value) ? 'an array' : 'a value that is neither a scalar nor an operator object'}, `
          + `which has no lossless \`${equals}\` rule`,
      };
    }
    const operators = Object.entries(value);
    if (operators.length === 0) {
      return {
        declined: `has the key \`${field}\` set to an empty operator object, which names the field `
          + 'and no operator, so no rule spells it. The renderer does not ignore it today: where the '
          + 'block queries an object, it refuses the filter (`INVALID_FILTER`, 400); where its rows '
          + 'are inline, it answers no rows. Drop the key',
      };
    }
    for (const [op, comparand] of operators) {
      const operator = ruleOperatorForFilterOperator(op);
      if (!operator) {
        return {
          declined: op.startsWith('$')
            ? `compares \`${field}\` with \`${op}\`, which has no rule operator that lowers back to it`
            : `has the key \`${field}\` set to a nested object whose key \`${op}\` is not a filter operator`,
        };
      }
      rules.push({ field, operator, value: comparand });
    }
  }
  return { rules };
}

/**
 * A single-level ObjectQL AST — one comparison `[field, op, value]`, or a flat
 * list of them (implicit AND) — → rules, or why not; `undefined` when the
 * value is not an AST at all, so it is not this conversion's form.
 *
 * `isFilterAST` is the recogniser (the spec's own, so an array of rule objects
 * is never mistaken for one). An `and` / `or` group, or a list nesting one, is
 * a combinator and is left alone for the record-form reason above. The
 * operator folds through `normalizeFilterOperator` first; an infix spelling the
 * rule vocabulary has no word for (`=`, `!=`, `>`, `<=`, …) is lowered through
 * `parseFilterAST` — the AST's one sink, which the renderer's lowering of the
 * rule reaches too — and read back from the `$` operator it produced, so
 * neither table is copied here.
 */
function astFilterToRules(ast: readonly unknown[]): FilterMapping | undefined {
  if (!isFilterAST(ast)) return undefined;
  const isLogicKeyword = (token: unknown): boolean =>
    typeof token === 'string'
    && (FILTER_ARRAY_LOGIC_KEYWORDS as readonly string[]).includes(token.toLowerCase());
  const isComparison = (node: unknown): node is readonly [string, string, ...unknown[]] =>
    Array.isArray(node)
    && (node.length === 2 || node.length === 3)
    && typeof node[0] === 'string'
    && !isLogicKeyword(node[0])
    && typeof node[1] === 'string';

  let comparisons: ReadonlyArray<readonly [string, string, ...unknown[]]>;
  if (isComparison(ast)) comparisons = [ast];
  else if (ast.every(isComparison)) comparisons = ast as ReadonlyArray<readonly [string, string, ...unknown[]]>;
  else {
    // Name the groups by walking only the AST's structural positions — a logic
    // node's children and a list's members — so a comparison's own value array
    // is never read as a group.
    const groups = new Set<string>();
    const visit = (node: unknown): void => {
      if (!Array.isArray(node) || node.length === 0) return;
      if (isLogicKeyword(node[0])) {
        groups.add(String(node[0]).toLowerCase());
        node.slice(1).forEach(visit);
      } else if (Array.isArray(node[0])) {
        node.forEach(visit);
      }
    };
    visit(ast);
    return {
      declined: groups.size > 0
        ? `is a nested ObjectQL AST holding ${groups.size === 1 ? 'an ' : ''}${quoteKeys([...groups])} `
          + `group${groups.size === 1 ? '' : 's'}, `
          + 'and only a single-level AST (one comparison, or a flat list of them) has a lossless rule '
          + 'spelling: a combinator is never flattened — that would change which rows the filter '
          + 'selects. Decide which rows it should select, and write the rules that select exactly those'
        : 'is an ObjectQL AST that is neither one comparison `[field, operator, value]` nor a flat '
          + 'list of them, so it has no lossless rule spelling',
    };
  }

  const rules: MappedFilterRule[] = [];
  for (const node of comparisons) {
    const [field, op] = node;
    const unspellable: FilterMapping = {
      declined: `compares \`${field}\` with the AST operator \`${op}\`, which has no rule operator `
        + 'that lowers back to it',
    };
    let operator: ViewFilterOperator | undefined;
    const folded = normalizeFilterOperator(op);
    if ((VIEW_FILTER_OPERATORS as readonly string[]).includes(folded)) {
      operator = folded as ViewFilterOperator;
    } else {
      let lowered: Record<string, unknown> | undefined;
      try {
        lowered = parseFilterAST([...node]) as Record<string, unknown> | undefined;
      } catch (error) {
        return {
          declined: `holds the AST comparison \`${JSON.stringify(node)}\`, which the AST itself does not `
            + `lower (${firstSentence(error instanceof Error ? error.message : String(error))})`,
        };
      }
      if (!lowered || Object.keys(lowered).length !== 1 || !(field in lowered)) return unspellable;
      const condition = lowered[field];
      if (isRecordForm(condition)) {
        const ops = Object.keys(condition);
        operator = ops.length === 1 ? ruleOperatorForFilterOperator(ops[0]!) : undefined;
      } else {
        // A bare comparand is the implicit-equality lowering of `=` / `==`.
        operator = normalizeFilterOperator('eq') as ViewFilterOperator;
      }
      if (!operator) return unspellable;
    }
    rules.push(node.length === 3 ? { field, operator, value: node[2] } : { field, operator });
  }
  return { rules };
}

/**
 * The rule array a legacy `filter` value maps to losslessly, or why a legacy
 * value has none; `undefined` when the value is not a legacy form at all
 * (already a rule array, or some other value the door judges on its own) — the
 * one case that is neither converted nor reported.
 *
 * The last gate is the DOOR's own: every produced rule must parse against
 * `ViewFilterRuleSchema`, so the conversion never writes a value the next save
 * refuses — a comparand shape the operator cannot take, an empty `icontains`,
 * a field-reference object. Such a filter is left exactly as stored.
 */
function legacyFilterToRuleArray(value: unknown): FilterMapping | undefined {
  let mapping: FilterMapping | undefined;
  if (isRecordForm(value)) mapping = recordFilterToRules(value);
  else if (Array.isArray(value)) mapping = astFilterToRules(value);
  if (!mapping || 'declined' in mapping) return mapping;
  for (const rule of mapping.rules) {
    const parsed = ViewFilterRuleSchema.safeParse(rule);
    if (parsed.success) continue;
    const first = parsed.error.issues[0]?.message;
    return {
      declined: `would become the rule \`${JSON.stringify(rule)}\`, which this door refuses itself`
        + (first ? ` (${first.trim().replace(/\.$/, '')})` : ''),
    };
  }
  return mapping;
}

/**
 * [#17321] The record-form and single-level AST `filter` values the converged
 * rule-array doors refuse become the `ViewFilterRule` array, wherever that
 * mapping is lossless — the D2 half of the one-filter-orthography convergence
 * (objectui#6206). Ruling B of decision batch #121 item 4 (director seat,
 * maintainer 「同意」): convert the mappable subset, leave combinator-carrying
 * rows untouched, never flatten.
 *
 * ## What converts
 *
 * - a flat record `{ status: 'active' }` → `[{ field: 'status', operator:
 *   'equals', value: 'active' }]`, several keys → several rules (they AND);
 * - an operator object `{ amount: { $gt: 100 } }` → the mapped operator,
 *   `[{ field: 'amount', operator: 'greater_than', value: 100 }]` — and an
 *   object carrying several operators on one field (`{ $gte: 1, $lte: 9 }`)
 *   → one rule per operator, which is the same AND;
 * - a single-level ObjectQL AST, `['owner_id', '=', '{current_user_id}']` or a
 *   flat list of such comparisons → one rule per comparison;
 * - `{}` → `[]` (constrains nothing either way).
 *
 * Values are carried verbatim, value placeholders and date macros included.
 *
 * ## What is left exactly as stored — `legacyFilterToRuleArray` answers `declined`
 *
 * A record carrying `$and` / `$or` / `$not` (or any top-level `$` key), an AST
 * `and` / `or` group, an operator the rule vocabulary does not spell (`$null`,
 * `$exists`, `like`, …), a `null` value (skipped where a block queries an
 * object, matched where its rows are inline — no one rule keeps both),
 * an array or object comparand in equality position, and any rule the door
 * would refuse. All-or-nothing per filter: converting part of an AND-list
 * widens it. ⛔ A combinator is never flattened into the AND list — for `$or`
 * and `$not` that changes which rows the page selects, which is the option the
 * ruling excluded. Such a row keeps loading unchanged (the stored-row seam
 * does not validate), and its door's schema refuses the form — but WHERE that
 * refusal lands differs by door, measured through `saveMetaItem`
 * (`protocol.stored-migration.test.ts`): `dataSource.filter` is a declared key
 * of the strict page-component schema, so the row's next save is refused
 * there; `properties.filter` sits in the open
 * `properties` bag the runtime save does not refuse by component type, so there
 * the refusal is the component-props gate's (`@objectstack/lint`, an error at
 * `os validate` / `os build` / `os lint`), and a re-save goes through.
 *
 * ## Every site left as stored is reported — `context.reportTodo`
 *
 * Ruling item 2's other half: each legacy filter this entry leaves as stored
 * is reported as a structured TODO (ADR-0087 D3's model — conversion where
 * lossless, a TODO otherwise), naming its path, the block it sits on, and what
 * blocks the rewrite — the combinator by name, for a combinator.
 * `os migrate meta --stored` lists them under their row, so an operator can
 * answer "did it convert my row" from that output. The one value at a door
 * that is neither converted nor reported is one that is not a legacy form at
 * all — already a rule array, or a value the door judges on its own. Reporting
 * changes nothing that is written: every declined site stays byte-identical.
 *
 * ## Reach
 *
 * Every page component `mapPageComponents` visits (regions, slots, nested
 * containers): `dataSource.filter` on any component (`ElementDataSourceSchema`),
 * and `properties.filter` on {@link RULE_ARRAY_FILTER_BLOCK_TYPES}. The `filter`
 * of any other component type is not this entry's surface and is never
 * touched. Until #11509 the reach also took the `properties.filter` of
 * `element:number` and `element:record_picker` and the `properties.defaultFilters`
 * of `object-grid`; those keys retired in v18, and the entries that move them
 * (`element-flat-data-binding-to-data-source`, `object-grid-default-filters-removed`)
 * run first, so their values arrive here at `dataSource.filter` or at the
 * grid's `filter`.
 *
 * Where a component's rows come from does not move the verdict. A block whose
 * rows ride on the node (`data: { provider: 'value' }`, a `data` array,
 * `staticData`) is rewritten exactly as a block that queries an object:
 * measured at the `.objectui-sha` pin `dd3f7e1be356`, the renderers that match
 * inline rows in memory (`object-map`, `object-tree`, `object-calendar`,
 * `object-gantt`, through `ValueDataSource.find`) take those rows from
 * `data: { provider: 'value' }` or `staticData`, lower a rule array through
 * the grid's own sink before matching, and select the same rows for it as for
 * the stored form — every mapped operator, against a control where the
 * lowering is absent and the rule array selects none. A bare `data` array
 * reaches none of them: `object-calendar` draws it as pre-fetched rows with no
 * filter applied, and `object-map` / `object-gantt` do not take it as a record
 * source.
 *
 * ## Why `retiredFromLoadPath`
 *
 * The ruling is `Clause-②: no` — no accept-set change. Replayed on the
 * authoring funnel (`normalizeStackInput`), this entry would quietly accept the
 * record form again at `defineStack` / `validate`; retired, an author still
 * meets the door and is taught the rule array, while the data-at-rest seams
 * (`applyConversionsToStoredItem`, the artifact-ingestion door) and
 * `os migrate meta` replay it.
 */
const pageComponentFilterRecordToRuleArray: MetadataConversion = {
  id: 'page-component-filter-record-to-rule-array',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface:
    'page.component.dataSource.filter / page.component.properties.filter (the object-* blocks) '
    + '— the record and single-level AST filter forms',
  summary:
    'a record-form or single-level AST filter at a converged rule-array door becomes the '
    + '`[{ field, operator, value }]` rule array wherever the mapping is lossless (flat keys → '
    + '`equals` rules, `{ $op: v }` → the mapped operator, AST comparisons → one rule each); a '
    + 'filter carrying `$and` / `$or` / `$not` or any part with no lossless rule spelling is '
    + 'left exactly as stored — reported as a TODO, which `os migrate meta '
    + '--stored` lists — and is not the form its door declares (one filter '
    + 'orthography platform-wide, the rule array; the migration converts only what maps '
    + 'losslessly and names the rest, because flattening a combinator would silently change '
    + 'what a page selects)',
  apply(stack, emit, context) {
    return mapPageComponents(stack, (component, path) => {
      const block = describeBlock(component);

      const rewrite = (holder: Dict, key: string, basePath: string): Dict => {
        if (!(key in holder)) return holder;
        const value = holder[key];
        const mapping = legacyFilterToRuleArray(value);
        // Not a legacy form (already the rule array, or a value the door judges
        // on its own): neither converted nor reported.
        if (!mapping) return holder;
        const at = `${basePath}.${key}`;
        if ('declined' in mapping) {
          context?.reportTodo?.({
            path: at,
            from: JSON.stringify(value),
            reason: `On ${block}, this filter ${mapping.declined}. Left as stored, it keeps loading unchanged, `
              + 'but it is not the rule-array form its door declares — rewrite it by hand.',
          });
          return holder;
        }
        emit({ from: JSON.stringify(value), to: JSON.stringify(mapping.rules), path: at });
        return { ...holder, [key]: mapping.rules };
      };

      let next = component;

      const dataSource = next.dataSource;
      if (isDict(dataSource)) {
        const converted = rewrite(dataSource, 'filter', `${path}.dataSource`);
        if (converted !== dataSource) next = { ...next, dataSource: converted };
      }

      const type = next.type;
      const properties = next.properties;
      if (typeof type === 'string' && isDict(properties)) {
        let props = properties;
        if (RULE_ARRAY_FILTER_BLOCK_TYPES.has(type)) {
          props = rewrite(props, 'filter', `${path}.properties`);
        }
        if (props !== properties) next = { ...next, properties: props };
      }

      return next;
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'deal_desk',
          label: 'Deal Desk',
          regions: [
            {
              name: 'main',
              components: [
                // The binding and the grid door at once: a flat record with
                // two keys, and an operator object.
                {
                  type: 'object-grid',
                  dataSource: {
                    object: 'deal',
                    filter: { stage: 'open', owner_id: '{current_user_id}' },
                  },
                  properties: {
                    objectName: 'deal',
                    filter: { amount: { $gt: 100, $lte: 5000 } },
                  },
                },
                // An AST tuple array, at another block door. (It sat on the
                // grid's `defaultFilters` until #11509 retired that key in v18
                // and took its door out of this entry's reach.)
                {
                  type: 'object-calendar',
                  properties: {
                    objectName: 'deal',
                    filter: [['owner_id', '=', '{current_user_id}']],
                  },
                },
                // A combinator is never flattened: left byte-identical.
                {
                  type: 'object-kanban',
                  properties: {
                    objectName: 'deal',
                    filter: { $or: [{ stage: 'open' }, { stage: 'won' }] },
                  },
                },
                // Inline rows convert like any other block: the renderer
                // lowers the rule array before matching those rows.
                {
                  type: 'object-map',
                  properties: {
                    objectName: 'deal',
                    data: { provider: 'value', items: [{ stage: 'open' }, { stage: 'won' }] },
                    filter: { stage: 'open' },
                  },
                },
                // Already the rule array: untouched.
                {
                  type: 'object-metric',
                  properties: {
                    objectName: 'deal',
                    filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
                  },
                },
                // Nested inside a container: reached, and a legacy shorthand
                // operator lands on its canonical spelling — at the element's
                // binding, the one door an element carries since #11509
                // retired its flat `filter`.
                {
                  type: 'page:card',
                  properties: {
                    children: [
                      {
                        type: 'element:number',
                        dataSource: {
                          object: 'deal',
                          filter: { stage: { $nin: ['lost', 'void'] } },
                        },
                        properties: { aggregate: 'count' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'deal_desk',
          label: 'Deal Desk',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-grid',
                  dataSource: {
                    object: 'deal',
                    filter: [
                      { field: 'stage', operator: 'equals', value: 'open' },
                      { field: 'owner_id', operator: 'equals', value: '{current_user_id}' },
                    ],
                  },
                  properties: {
                    objectName: 'deal',
                    filter: [
                      { field: 'amount', operator: 'greater_than', value: 100 },
                      { field: 'amount', operator: 'less_than_or_equal', value: 5000 },
                    ],
                  },
                },
                {
                  type: 'object-calendar',
                  properties: {
                    objectName: 'deal',
                    filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
                  },
                },
                {
                  type: 'object-kanban',
                  properties: {
                    objectName: 'deal',
                    filter: { $or: [{ stage: 'open' }, { stage: 'won' }] },
                  },
                },
                {
                  type: 'object-map',
                  properties: {
                    objectName: 'deal',
                    data: { provider: 'value', items: [{ stage: 'open' }, { stage: 'won' }] },
                    filter: [{ field: 'stage', operator: 'equals', value: 'open' }],
                  },
                },
                {
                  type: 'object-metric',
                  properties: {
                    objectName: 'deal',
                    filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
                  },
                },
                {
                  type: 'page:card',
                  properties: {
                    children: [
                      {
                        type: 'element:number',
                        dataSource: {
                          object: 'deal',
                          filter: [{ field: 'stage', operator: 'not_in', value: ['lost', 'void'] }],
                        },
                        properties: { aggregate: 'count' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    // One per converted door: the grid's binding, the grid filter, the
    // calendar's AST filter, the inline-row map's filter, the nested
    // element:number's binding.
    expectedNotices: 5,
  },
};

export { pageComponentFilterRecordToRuleArray };
