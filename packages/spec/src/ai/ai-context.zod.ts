// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Context pack (`ai_context`) — ADR-0160 D1
 *
 * A context pack says which material of ONE record is handed to a model: the
 * root object's fields, the child lists that point at the record, and the one
 * long-text field read as the record's body. It is its own metadata kind, it
 * names its root object itself, and the object knows nothing of it (ADR-0160
 * D2): several packs may root on one object, and removing a pack changes no
 * object, no permission and no other pack.
 *
 * A pack grants nothing and locks nothing. Its one reader is the render
 * service behind the `get_record_context` tool
 * (`@objectstack/service-record-context`), which reads every part of it AS
 * THE CALLER: a field, a list or a row the caller cannot read is never
 * carried (ADR-0160 D3).
 *
 * ## Bounds, refused at parse
 *
 * A pack over a bound is refused when it is authored, so nothing is cut at
 * call time. The bounds stand against the record tools' per-call caps:
 *
 * - `related` holds at most {@link AI_CONTEXT_MAX_RELATED} lists — the most
 *   child lists one `get_record` call reads;
 * - `fields` holds at most {@link AI_CONTEXT_MAX_FIELDS} names, and every
 *   lookup among them is expanded as `query_records`' `expand` expands one, in
 *   ONE read of the root: the record tools cap a caller's `expand` at 3 names
 *   because the caller types them, while a pack's lookups are fixed by its
 *   author and bounded here;
 * - each `related[].fields` holds at most {@link AI_CONTEXT_MAX_RELATED_FIELDS}
 *   columns, its lookups expanded in the one read of that list.
 *
 * - a related list carries at most {@link AI_CONTEXT_MAX_RELATED_ROWS} rows: the
 *   render service's row cap, and the bound of the entry's own `limit` — one
 *   number, read by both, so a `limit` over the cap is refused here and never
 *   lowered at call time.
 *
 * ## Filter, order and limit on a related list (ADR-0160 D1, second amendment)
 *
 * A `related` entry may choose, order and cut its rows: `where` (the object
 * filter form on the child's OWN fields, {@link AI_CONTEXT_WHERE_OPERATORS}
 * joined by {@link AI_CONTEXT_WHERE_COMBINATORS}, literal comparands only),
 * `orderBy` (`{ field, order }[]`) and `limit`. They run inside the one
 * capped child query, as the caller, joined to the link filter with `$and`:
 * they grant nothing and add no object to the call's read set (D4).
 */

import { FILTER_TOKEN_WRAPPED_RE } from '../data/context-tokens.zod';
import { FilterConditionSchema, type FilterCondition, type FilterOperatorKey } from '../data/filter.zod';
import { SortNodeSchema } from '../data/query.zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { ROUTER_ADDRESSABLE_NAME_MESSAGE, ROUTER_ADDRESSABLE_NAME_PATTERN } from '../kernel/address-grammar';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { UNIQUE_SCALAR_ITEMS } from '../shared/refinement-projection';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

/** The most root fields one pack lists. */
export const AI_CONTEXT_MAX_FIELDS = 30;

/** The most child lists one pack reads — `get_record`'s own cap on `related`. */
export const AI_CONTEXT_MAX_RELATED = 3;

/** The most columns one child list of a pack reads. */
export const AI_CONTEXT_MAX_RELATED_FIELDS = 10;

/**
 * The most rows one related list of a pack carries: the render service's row
 * cap (`RECORD_CONTEXT_RELATED_MAX_ROWS` in `@objectstack/service-record-context`
 * is this number) and the bound of a `related` entry's `limit`. A list with
 * more rows is cut and the answer says so (ADR-0160 D3).
 */
export const AI_CONTEXT_MAX_RELATED_ROWS = 20;

/**
 * The operators a related list's `where` admits on a field (ADR-0160 D1,
 * second amendment). Every other operator of the object filter form is
 * refused at parse.
 */
export const AI_CONTEXT_WHERE_OPERATORS = [
  '$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$null', '$exists',
] as const satisfies readonly FilterOperatorKey[];

/** The combinators that join a related list's `where` conditions. `$not` is not admitted. */
export const AI_CONTEXT_WHERE_COMBINATORS = ['$and', '$or'] as const;

/**
 * The field types a pack's `body` may name: the long-text types, the ones a
 * record's prose is written in.
 */
export const AI_CONTEXT_BODY_FIELD_TYPES = ['textarea', 'markdown', 'html', 'richtext'] as const;

const BORN_CLOSED = 'Declared closed from its first day: an unrecognized key is refused, never dropped.';

/** A field name on an object: lowercase snake_case. */
const FieldNameSchema = SnakeCaseIdentifierSchema;

/** A list of field names with no name twice. */
function distinctFieldNames(max: number, what: string) {
  return z
    .array(FieldNameSchema)
    .min(1)
    .max(max, { message: `${what} lists at most ${max} fields` })
    // Published as `uniqueItems: true` (the closed `unique-items` arm).
    .refine(UNIQUE_SCALAR_ITEMS, { message: `${what} names a field twice` });
}

/** A field name a `where` key or a sort node names: one of the child's own fields, never a dotted path. */
const OWN_FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/;

const WHERE_OPERATOR_SET: ReadonlySet<string> = new Set(AI_CONTEXT_WHERE_OPERATORS);
const WHERE_ADMITTED =
  `a related list's \`where\` admits ${AI_CONTEXT_WHERE_OPERATORS.join(', ')} on the child's own fields, `
  + `joined by ${AI_CONTEXT_WHERE_COMBINATORS.join(' / ')}`;

function isPlainNode(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Why `value` is not a literal comparand of a related list's `where`, or `undefined` when it is one. */
function comparandRefusal(value: unknown): string | undefined {
  if (value === null || typeof value === 'boolean' || value instanceof Date) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : 'a number comparand must be finite';
  if (typeof value === 'string') {
    return FILTER_TOKEN_WRAPPED_RE.test(value)
      ? `'${value}' is a whole {…} placeholder, which the data engine would resolve at call time; a related list's `
        + '`where` takes literal values only (placeholders resolved at call time are later work)'
      : undefined;
  }
  if (Array.isArray(value)) return 'a list is a comparand of $in and $nin only, and its members are literal values';
  if (isPlainNode(value) && '$field' in value) {
    return 'a field-to-field comparand ({ $field }) is not admitted: compare the field with a literal value';
  }
  if (isPlainNode(value) && '$now' in value) {
    return 'a $now anchor is not admitted: a related list\'s selection never reads the clock';
  }
  return 'a comparand is a literal value (a string, number, boolean or null), never a formula, an anchor or a reference';
}

/**
 * [ADR-0160 D1, second amendment] The one walk that holds a related list's
 * `where` to its admitted subset of the object filter form: field keys that
 * are the child's own fields (no dotted path, no condition on a lookup's
 * target), the ten {@link AI_CONTEXT_WHERE_OPERATORS}, `$and` / `$or`, and
 * literal comparands. A bare value is `$eq`, as the filter form reads it.
 */
function checkRelatedWhere(node: unknown, ctx: z.RefinementCtx, path: (string | number)[]): void {
  if (!isPlainNode(node)) {
    ctx.addIssue({ code: 'custom', path, message: `A condition is an object of field conditions; ${WHERE_ADMITTED}` });
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const at = [...path, key];
    if ((AI_CONTEXT_WHERE_COMBINATORS as readonly string[]).includes(key)) {
      if (!Array.isArray(value)) {
        ctx.addIssue({ code: 'custom', path: at, message: `\`${key}\` takes a list of conditions` });
        continue;
      }
      value.forEach((member, i) => checkRelatedWhere(member, ctx, [...at, i]));
      continue;
    }
    if (key.startsWith('$')) {
      ctx.addIssue({ code: 'custom', path: at, message: `\`${key}\` is not admitted here: ${WHERE_ADMITTED}` });
      continue;
    }
    if (!OWN_FIELD_NAME_RE.test(key)) {
      ctx.addIssue({
        code: 'custom',
        path: at,
        message: key.includes('.')
          ? `'${key}' is a dotted path: a related list's \`where\` reads the child's own fields only (reads through a `
            + 'lookup are later work)'
          : `'${key}' is not a field name (lowercase snake_case)`,
      });
      continue;
    }
    if (!isPlainNode(value)) {
      // A bare value: read as `$eq`.
      const why = comparandRefusal(value);
      if (why) ctx.addIssue({ code: 'custom', path: at, message: `'${key}': ${why}` });
      continue;
    }
    const ops = Object.keys(value);
    if (ops.length > 0 && !ops.some((op) => op.startsWith('$'))) {
      ctx.addIssue({
        code: 'custom',
        path: at,
        message: `'${key}' holds a condition on the record its lookup points at: a related list's \`where\` reads the `
          + 'child\'s own fields only (relation traversal is later work)',
      });
      continue;
    }
    if (ops.length === 0 || '$field' in value || '$now' in value) {
      const why = ops.length === 0 ? 'a field condition names at least one operator' : comparandRefusal(value);
      ctx.addIssue({ code: 'custom', path: at, message: `'${key}': ${why}` });
      continue;
    }
    for (const op of ops) {
      const opAt = [...at, op];
      if (!WHERE_OPERATOR_SET.has(op)) {
        ctx.addIssue({ code: 'custom', path: opAt, message: `\`${op}\` is not admitted on '${key}': ${WHERE_ADMITTED}` });
        continue;
      }
      const comparand = value[op];
      if (op === '$in' || op === '$nin') {
        if (!Array.isArray(comparand)) {
          ctx.addIssue({ code: 'custom', path: opAt, message: `\`${op}\` on '${key}' takes a list of literal values` });
          continue;
        }
        comparand.forEach((member, i) => {
          const why = Array.isArray(member) ? 'a list member is a literal value, never a list' : comparandRefusal(member);
          if (why) ctx.addIssue({ code: 'custom', path: [...opAt, i], message: `'${key}' ${op}: ${why}` });
        });
        continue;
      }
      if (op === '$null' || op === '$exists') {
        if (typeof comparand !== 'boolean') {
          ctx.addIssue({ code: 'custom', path: opAt, message: `\`${op}\` on '${key}' takes true or false` });
        }
        continue;
      }
      const why = comparandRefusal(comparand);
      if (why) ctx.addIssue({ code: 'custom', path: opAt, message: `'${key}' ${op}: ${why}` });
    }
  }
}

/**
 * The child fields a related list's `where` names, each once, in first-named
 * order — walked through `$and` / `$or`. Safe on any shape: a value that is
 * no condition names no field. The render service judges each one against
 * the caller's queryable fields before it reads, and the author surfaces
 * report one the child does not define (ADR-0160 D1, D3).
 */
export function aiContextWhereFields(where: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 32 || !isPlainNode(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if ((AI_CONTEXT_WHERE_COMBINATORS as readonly string[]).includes(key)) {
        if (Array.isArray(value)) for (const member of value) walk(member, depth + 1);
      } else if (!key.startsWith('$') && !out.includes(key)) {
        out.push(key);
      }
    }
  };
  walk(where, 0);
  return out;
}

/**
 * [ADR-0160 D1, second amendment] A related list's `where`: the object filter
 * form ({@link FilterConditionSchema}) held to its admitted subset by
 * {@link checkRelatedWhere}.
 */
export const AiContextRelatedWhereSchema: z.ZodType<FilterCondition, FilterCondition> = z.lazy(() =>
  FilterConditionSchema.superRefine((node, ctx) => checkRelatedWhere(node, ctx, [])),
);

/**
 * One child list of a pack: the records of `object` whose reference field
 * points at the pack's root record. One level, child lists only — the shape of
 * `get_record`'s `related`.
 */
export const AiContextRelatedSchema = lazySchema(() => strictObject(
  {
    surface: 'a context pack `related` entry',
    history: BORN_CLOSED,
    aliases: {
      objectName: 'object',
      link: 'field',
      linkField: 'field',
      columns: 'fields',
      filter: 'where',
      sort: 'orderBy',
      sortBy: 'orderBy',
    },
  },
  {
    object: SnakeCaseIdentifierSchema.describe(
      'A child object with a reference field (lookup, master-detail, user or tree) that points at the pack\'s root object',
    ),
    field: FieldNameSchema.optional().describe(
      'The child\'s reference field that points at the root. Required when the child has several such fields; with '
      + 'one, it may be omitted. Resolved once, on the published definition',
    ),
    fields: distinctFieldNames(AI_CONTEXT_MAX_RELATED_FIELDS, 'A related list').optional().describe(
      `The columns read for each row, in order (at most ${AI_CONTEXT_MAX_RELATED_FIELDS}). A lookup among them is `
      + 'answered with the name of the record it points at. Omit to read the row\'s name only',
    ),
    where: AiContextRelatedWhereSchema.optional().describe(
      'Which child rows the list carries: a filter on the child\'s own fields, in the object filter form. A bare '
      + `value is \`$eq\`; the operators are ${AI_CONTEXT_WHERE_OPERATORS.join(', ')}, joined by `
      + `${AI_CONTEXT_WHERE_COMBINATORS.join(' / ')}. Comparands are literal values: no dotted path, no field-to-field `
      + 'comparand, no $now anchor and no {…} placeholder. Joined to the link with $and and read as the caller, so '
      + 'it grants nothing',
    ),
    orderBy: z
      .array(SortNodeSchema)
      .min(1)
      .superRefine((nodes, ctx) => {
        nodes.forEach((node, i) => {
          if (typeof node?.field === 'string' && !OWN_FIELD_NAME_RE.test(node.field)) {
            ctx.addIssue({
              code: 'custom',
              path: [i, 'field'],
              message: `'${node.field}' is not one of the child's own fields: \`orderBy\` names a field of the list's `
                + 'own object (lowercase snake_case, no dotted path)',
            });
          }
        });
      })
      .optional()
      .describe(
        'The order of the rows: `{ field, order }[]` on the child\'s own fields, `order` `asc` (the default) or '
        + '`desc`. Without it the rows come in the data engine\'s order',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AI_CONTEXT_MAX_RELATED_ROWS, {
        message: `A related list carries at most ${AI_CONTEXT_MAX_RELATED_ROWS} rows (the render service's row cap)`,
      })
      .optional()
      .describe(
        `The most rows the list carries (at most ${AI_CONTEXT_MAX_RELATED_ROWS}, the default). A list cut at it says `
        + 'so in the answer',
      ),
  },
));

/** The one long-text field read as the record's body. */
export const AiContextBodySchema = lazySchema(() => strictObject(
  {
    surface: 'a context pack `body`',
    history: BORN_CLOSED,
    aliases: { name: 'field', fieldName: 'field' },
  },
  {
    field: FieldNameSchema.describe(
      `A long-text field of the root object (${AI_CONTEXT_BODY_FIELD_TYPES.join(', ')}). A body past the render `
      + 'service\'s bound is carried as an outline of its headings, each section read by its anchor',
    ),
  },
));

/**
 * A context pack — the material of one record handed to a model
 * (ADR-0160 D1).
 *
 * @example
 * ```yaml
 * name: policy_document
 * label: Policy document
 * object: policy
 * fields: [title, category, status, effective_date, owner]
 * related:
 *   - object: policy_revision
 *     field: policy
 *     fields: [version, published_at]
 *     where: { is_current: { $eq: true } }
 *     orderBy: [{ field: sort_no, order: asc }]
 *     limit: 5
 * body:
 *   field: content
 * ```
 */
export const AiContextSchema = lazySchema(() => strictObject(
  {
    surface: 'this context pack',
    history: BORN_CLOSED,
    aliases: {
      objectName: 'object',
      root: 'object',
      columns: 'fields',
      children: 'related',
      relatedLists: 'related',
      content: 'body',
    },
    guidance: {
      description:
        'A context pack has no `description` in v1 (ADR-0160 D1): write the purpose in `label`.',
      filter:
        'A context pack reads one record by id; it takes no filter. To choose which rows a related list carries, '
        + 'give that `related` entry its own `where`.',
    },
  },
  {
    name: z.string().regex(ROUTER_ADDRESSABLE_NAME_PATTERN, { message: ROUTER_ADDRESSABLE_NAME_MESSAGE }).describe(
      'Pack machine name (snake_case) — what `get_record_context`\'s `context` argument and a skill\'s `context` key name',
    ),
    label: z.string().min(1).describe('Pack display name — the header of the tool answer'),
    object: SnakeCaseIdentifierSchema.describe('The root object: a pack reads one record of it'),
    fields: distinctFieldNames(AI_CONTEXT_MAX_FIELDS, 'A context pack').optional().describe(
      `The root object's fields handed to the model, in order (at most ${AI_CONTEXT_MAX_FIELDS}). A lookup among `
      + 'them is answered with the name of the record it points at',
    ),
    related: z
      .array(AiContextRelatedSchema)
      .min(1)
      .max(AI_CONTEXT_MAX_RELATED, { message: `A context pack reads at most ${AI_CONTEXT_MAX_RELATED} related lists` })
      .refine(
        (entries) => new Set(entries.map((e) => `${e.object}\u0000${e.field ?? ''}`)).size === entries.length,
        { message: 'A context pack names the same related list twice' },
      )
      .optional()
      .describe(`Child lists that point at the record (at most ${AI_CONTEXT_MAX_RELATED}), one level deep`),
    body: AiContextBodySchema.optional().describe('The one long-text field read as the record\'s body'),
    ...MetadataProtectionFields,
  },
));

export type AiContext = z.input<typeof AiContextSchema>;
export type AiContextParsed = z.infer<typeof AiContextSchema>;
export type AiContextRelated = z.input<typeof AiContextRelatedSchema>;
export type AiContextRelatedParsed = z.infer<typeof AiContextRelatedSchema>;
export type AiContextBody = z.input<typeof AiContextBodySchema>;
export type AiContextBodyParsed = z.infer<typeof AiContextBodySchema>;
export type AiContextRelatedWhere = z.input<typeof AiContextRelatedWhereSchema>;
