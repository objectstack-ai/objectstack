// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ruleArrayFilterError` — the refusal a converged rule-array `filter` door
 * gives an author who wrote the record form it used to take.
 *
 * ## Why this exists
 *
 * Seven `filter` doors converged on `z.array(ViewFilterRuleSchema)` in the
 * objectui#6206 family: `ElementDataSourceSchema.filter` (`page.zod.ts`) and
 * the `object-grid` / `object-metric` / `object-kanban` / `object-calendar` /
 * `element:number` / `element:record_picker` rows of `ComponentPropsMap`
 * (`component.zod.ts`). Each one previously accepted the MongoDB-style record
 * (`{ status: 'active' }`), and each now refuses it.
 *
 * The prescription for that transition is written down twice already — in
 * every one of the seven `.describe()` strings, and in full in the three
 * `18.*-filter-rule-array` `SemanticMigration` entries. Neither reaches a
 * parse: nothing bridges `.describe()` into a zod issue, and this package
 * installs no global error map. So the one population these doors changed
 * behaviour for — the authors, human and AI, who wrote the previously-legal
 * form — received `Invalid input: expected array, received object` and nothing
 * else. Their next action is a guess, and the natural second guess (an
 * ObjectQL AST tuple array) earns a second bare `invalid_type`, one level
 * deeper at `filter.0`.
 *
 * ## Why it is a helper and not a sentence
 *
 * `strictObject` is the model this follows, for the reason its own header
 * gives: the candidate list is **read from the shape** rather than transcribed
 * beside it, so the two cannot disagree. A hand-copied sentence at seven call
 * sites is seven copies to drift — and a prescription that fell out of step
 * with a refusal is precisely the defect this module answers.
 *
 * So everything the message can derive, it derives:
 *
 * - the rule shape `[{ field, operator, value }, ...]` is
 *   `Object.keys(ViewFilterRuleSchema)`'s shape, not a literal;
 * - the canonical equality operator is
 *   `normalizeFilterOperator('eq')` — the same fold the door itself runs, so a
 *   renamed canonical renames itself here;
 * - the worked rewrite is computed from **the author's own record**, so the
 *   example names their fields rather than a stranger's.
 *
 * What stays per-call is what carries judgement rather than transcription —
 * the same split `strictObject` draws: `surface` (which door this is) and
 * `migration` (which of the three entries holds this door's conversion table).
 * `filter-rule-array-guidance.test.ts` holds every `migration` passed here
 * equal to a real entry id in the migration registry, so that one string
 * cannot rot either.
 *
 * ## Fall-through is deliberate
 *
 * The map answers **only** the record form and returns `undefined` for
 * everything else, exactly as `flattenedViewOverlayFields()`'s `object` /
 * `viewKind` maps do. A blanket message here would overwrite the element-level
 * issues an array author needs (`filter.0: …`), which is the diagnosis this
 * module exists to protect, not to replace.
 */

import { z } from 'zod';

import { ViewFilterRuleSchema, normalizeFilterOperator } from './view.zod';

/** Per-door facts the message cannot derive. */
export interface RuleArrayFilterErrorOptions {
  /**
   * The authoring surface this door belongs to, worded as `strictObject`'s own
   * `surface` is (it is dropped into "… on this `object-grid`").
   */
  surface: string;
  /**
   * The `SemanticMigration` id whose `replacement` carries the full conversion
   * table for this door. Pinned against the registry by
   * `filter-rule-array-guidance.test.ts`.
   */
  migration: string;
}

/** How many of the author's own keys the worked rewrite spells out. */
const REWRITE_KEY_BUDGET = 3;

/**
 * A plain record — the shape these doors used to take.
 *
 * Deliberately narrower than `typeof input === 'object'`: a `Date`, a `Map` or
 * a class instance at this key is a different mistake, and answering it with
 * the filter-orthography prescription would send that author to the wrong
 * migration entry.
 */
function isRecordForm(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const proto = Object.getPrototypeOf(input);
  return proto === Object.prototype || proto === null;
}

/** Render a scalar the way an author would write it back into the rule. */
function renderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return undefined;
}

/**
 * The declared keys of one rule, read from the schema rather than transcribed.
 *
 * Read on FIRST REFUSAL, never at module load: `ViewFilterRuleSchema` is a
 * `lazySchema` proxy, and touching `_zod` forces its body. Under
 * `OS_EAGER_SCHEMAS=1` (how `build-schemas.ts` runs) a module-load read here
 * would build it while `view.zod` is still initialising — the same import-cycle
 * footgun `strictObjectError` defers around, and for the same reason: the map
 * is needed only when a value is rejected.
 */
function ruleKeys(): readonly string[] {
  const def = (ViewFilterRuleSchema as unknown as { _zod?: { def?: { shape?: object } } })._zod?.def;
  const shape = def?.shape;
  return shape ? Object.keys(shape) : [];
}

/**
 * Build the `{ error }` map for one converged rule-array `filter` door.
 *
 * @example
 * ```ts
 * filter: z.array(ViewFilterRuleSchema, {
 *   error: ruleArrayFilterError({
 *     surface: 'this `object-grid`',
 *     migration: 'element-data-source-and-object-block-filter-rule-array',
 *   }),
 * }).optional().describe('…'),
 * ```
 */
export function ruleArrayFilterError(options: RuleArrayFilterErrorOptions): z.core.$ZodErrorMap {
  const { surface, migration } = options;

  return (issue) => {
    if (issue.code !== 'invalid_type') return undefined;
    if ((issue as { expected?: string }).expected !== 'array') return undefined;
    const input = issue.input;
    if (!isRecordForm(input)) return undefined;

    const keys = ruleKeys();
    const ruleForm = keys.length > 0 ? `[{ ${keys.join(', ')} }, ...]` : '[{ … }, ...]';
    const equals = normalizeFilterOperator('eq');

    const authored = Object.keys(input);
    const shown = authored.slice(0, REWRITE_KEY_BUDGET);
    const rules = shown.map((key) => {
      const rendered = renderValue(input[key]);
      return rendered === undefined
        ? `{ field: '${key}', operator: …, value: … }`
        : `{ field: '${key}', operator: '${equals}', value: ${rendered} }`;
    });
    const ellipsis = authored.length > shown.length ? ', …' : '';
    const rewrite = rules.length > 0 ? `\`[${rules.join(', ')}${ellipsis}]\`` : `\`[]\``;

    const nested = shown.some((key) => renderValue(input[key]) === undefined);

    return (
      `\`filter\` on ${surface} takes the ViewFilterRule ARRAY form \`${ruleForm}\`, `
      + `and this value is the MongoDB-style record form this door took before the `
      + `one-filter-orthography convergence. Write one rule per record key — they AND — `
      + `so this filter becomes ${rewrite}.`
      + (nested
        ? ` A key whose value is an operator object (\`{ amount: { $gt: 100 } }\`) lifts that `
          + `operator into \`operator\`: \`[{ field: 'amount', operator: 'greater_than', value: 100 }]\`.`
        : '')
      + ` Legacy operator shorthands (\`eq\`, \`gt\`, \`notIn\`, …) are accepted and normalized on parse.`
      + ` Full conversion table: migration \`${migration}\`.`
    );
  };
}
