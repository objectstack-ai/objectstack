// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Scenario-card schema — the SHAPE of one card under `docs/qa/scenarios/`.
 *
 * This file answers "is the card well-formed?" field by field. Everything
 * that needs more than one field to judge — a lookup naming an object the
 * card never lists, a question reading a field no seed row carries, a
 * capability area that is not a checklist area — is judged by the loader's
 * semantic pass (`loader.ts`), which reports with the same file + path shape.
 *
 * Every object is STRICT: an unknown key is refused, never dropped. A card is
 * authored by people and by AI; a misspelt key that parsed silently would make
 * a scenario assert less than its author meant, with nothing red anywhere.
 *
 * Not a protocol: this format lives in a private devx package on purpose and
 * `packages/spec` carries no obligation for it.
 */

import { z } from 'zod';

/** A machine name: snake_case, the convention for data values in this repo. */
export const MachineNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case machine name (^[a-z][a-z0-9_]*$)');

/** Text in one or both languages; at least one must be present. */
export const LocalizedTextSchema = z
  .strictObject({
    zh: z.string().min(1).optional(),
    en: z.string().min(1).optional(),
  })
  .refine((t) => t.zh !== undefined || t.en !== undefined, {
    message: 'needs at least one language (zh or en)',
  });
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

// ── Layer 1: prompt ─────────────────────────────────────────────────────────

export const PromptSchema = z.strictObject({
  short: LocalizedTextSchema,
  detailed: LocalizedTextSchema,
});

// ── Layer 2: expect ─────────────────────────────────────────────────────────
//
// ⛔ Field-for-field the shape the deterministic scorer reads (the scorer port
// in packages/cli shares it). Do not rename a key or add a REQUIRED one here
// without changing the scorer in the same change.

export const SelectFieldExpectationSchema = z.strictObject({
  object: MachineNameSchema,
  field: MachineNameSchema,
  minOptions: z.number().int().min(1),
});

export const LookupExpectationSchema = z.strictObject({
  object: MachineNameSchema,
  field: MachineNameSchema,
  to: MachineNameSchema,
});

export const ExpectSchema = z.strictObject({
  objects: z.array(MachineNameSchema).min(1),
  minFieldsPerObject: z.number().int().min(1).optional(),
  selectFields: z.array(SelectFieldExpectationSchema).optional(),
  lookups: z.array(LookupExpectationSchema).optional(),
  dashboards: z.array(MachineNameSchema).optional(),
  appNavTargets: z.array(MachineNameSchema).optional(),
});
export type ScenarioExpect = z.infer<typeof ExpectSchema>;

// ── Layer 3: capabilities + category ────────────────────────────────────────

/**
 * `<area>.<name>`. The AREA half is a closed set read from the tree
 * (`docs/qa/platform-checklist/areas/*.json` basenames) by the loader; the
 * shape is checked here.
 */
export const CapabilityTagSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[-_][a-z0-9]+)*$/,
    'must be `<area>.<name>`, e.g. `records-forms.master-detail`',
  );

/** The cloud marketplace taxonomy — a closed enum. */
export const SCENARIO_CATEGORIES = [
  'app',
  'crm',
  'sales',
  'marketing',
  'finance',
  'hr',
  'operations',
  'project',
  'productivity',
  'data',
  'integrations',
  'devtools',
  'utility',
  'other',
] as const;
export const CategorySchema = z.enum(SCENARIO_CATEGORIES);

// ── Layer 4: run.seed / run.questions / run.personas ────────────────────────

export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof ScalarSchema>;

/**
 * One seed row. `id` is the row's key: a lookup field's value in another row
 * names it, and a ranking without `groupBy` reports it.
 */
export const SeedRowSchema = z
  .object({ id: z.string().min(1) })
  .catchall(ScalarSchema)
  .superRefine((row, ctx) => {
    for (const key of Object.keys(row)) {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'a seed field name must be snake_case' });
      }
    }
  });
export type SeedRow = z.infer<typeof SeedRowSchema>;

export const FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const;

export const FilterSchema = z
  .strictObject({
    field: MachineNameSchema,
    op: z.enum(FILTER_OPS),
    value: z.union([ScalarSchema, z.array(ScalarSchema).min(1)]),
  })
  .superRefine((f, ctx) => {
    const isList = Array.isArray(f.value);
    if (f.op === 'in' && !isList) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: '`in` needs a non-empty list value' });
    }
    if (f.op !== 'in' && isList) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `\`${f.op}\` needs a single value, not a list` });
    }
    if (['gt', 'gte', 'lt', 'lte'].includes(f.op) && typeof f.value !== 'number' && typeof f.value !== 'string') {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `\`${f.op}\` compares a number or a string` });
    }
  });
export type Filter = z.infer<typeof FilterSchema>;

export const ORDERS = ['asc', 'desc'] as const;

const filterList = z.array(FilterSchema).optional();

/** The aggregate a truth spec — or a ranking's measure — computes. */
export const MeasureSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('count') }),
  z.strictObject({ kind: z.literal('sum'), field: MachineNameSchema }),
  z.strictObject({ kind: z.literal('avg'), field: MachineNameSchema }),
  z.strictObject({ kind: z.literal('min'), field: MachineNameSchema }),
  z.strictObject({ kind: z.literal('max'), field: MachineNameSchema }),
]);
export type Measure = z.infer<typeof MeasureSchema>;

function fieldAggregate<K extends 'sum' | 'avg' | 'min' | 'max'>(kind: K) {
  return z.strictObject({
    kind: z.literal(kind),
    field: MachineNameSchema,
    filter: filterList,
    groupBy: MachineNameSchema.optional(),
    order: z.enum(ORDERS).optional(),
  });
}

/**
 * The DECLARATIVE truth of a question. The loader evaluates it over the seed
 * rows; a question's answer is computed by code, never typed by hand.
 *
 * `kind` is a closed enum — count | sum | avg | min | max | topN.
 */
export const TruthSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('count'),
    filter: filterList,
    groupBy: MachineNameSchema.optional(),
    order: z.enum(ORDERS).optional(),
  }),
  fieldAggregate('sum'),
  fieldAggregate('avg'),
  fieldAggregate('min'),
  fieldAggregate('max'),
  z
    .strictObject({
      kind: z.literal('topN'),
      n: z.number().int().min(1),
      order: z.enum(ORDERS),
      filter: filterList,
      // With `groupBy`: rank the groups by `measure`.
      groupBy: MachineNameSchema.optional(),
      measure: MeasureSchema.optional(),
      // Without `groupBy`: rank the rows by `field`.
      field: MachineNameSchema.optional(),
    })
    .superRefine((t, ctx) => {
      if (t.groupBy !== undefined) {
        if (t.measure === undefined) {
          ctx.addIssue({ code: 'custom', path: ['measure'], message: 'a grouped topN ranks groups by a `measure`' });
        }
        if (t.field !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['field'], message: 'a grouped topN ranks by `measure`, not `field`' });
        }
      } else {
        if (t.field === undefined) {
          ctx.addIssue({ code: 'custom', path: ['field'], message: 'an ungrouped topN ranks rows by a numeric `field`' });
        }
        if (t.measure !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['measure'], message: '`measure` needs a `groupBy`' });
        }
      }
    }),
]);
export type TruthSpec = z.infer<typeof TruthSpecSchema>;

export const QuestionSchema = z.strictObject({
  id: MachineNameSchema,
  ask: LocalizedTextSchema,
  object: MachineNameSchema,
  truth: TruthSpecSchema,
});

export const FieldRefSchema = z.strictObject({
  object: MachineNameSchema,
  field: MachineNameSchema,
});

export const PersonaSchema = z
  .strictObject({
    id: MachineNameSchema,
    role: z.string().min(1),
    hidden: z.strictObject({
      objects: z.array(MachineNameSchema).optional(),
      fields: z.array(FieldRefSchema).optional(),
    }),
  })
  .refine((p) => (p.hidden.objects?.length ?? 0) + (p.hidden.fields?.length ?? 0) > 0, {
    path: ['hidden'],
    message: 'a persona names at least one object or field it must NOT see',
  });

// ── Layer 5: run.operations + run.guardrails ────────────────────────────────

export const OPERATION_KINDS = ['create', 'update', 'delete'] as const;

export const OperationSchema = z
  .strictObject({
    id: MachineNameSchema,
    kind: z.enum(OPERATION_KINDS),
    object: MachineNameSchema,
    ask: LocalizedTextSchema,
    target: z.string().min(1).optional(),
    values: z.record(MachineNameSchema, ScalarSchema).optional(),
  })
  .superRefine((op, ctx) => {
    if (op.kind !== 'create' && op.target === undefined) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: `an \`${op.kind}\` names the seed row it acts on` });
    }
    if (op.kind === 'create' && op.target !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: 'a `create` has no target row' });
    }
    if (op.kind !== 'delete' && (op.values === undefined || Object.keys(op.values).length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: `a \`${op.kind}\` writes at least one value` });
    }
    if (op.kind === 'delete' && op.values !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'a `delete` writes no values' });
    }
  });

/** The guardrail checks a card asserts — every card asserts all five. */
export const GUARDRAIL_CHECKS = [
  'permission_parity',
  'write_validation',
  'confirm_irreversible',
  'audit_actor',
  'injection_as_data',
] as const;
export type GuardrailCheck = (typeof GUARDRAIL_CHECKS)[number];

export const GuardrailSchema = z.strictObject({
  check: z.enum(GUARDRAIL_CHECKS),
  /** The oracle, one sentence: what must hold. */
  assert: z.string().min(1),
  /** permission_parity: the persona the agent acts as. */
  persona: MachineNameSchema.optional(),
  /** write_validation / confirm_irreversible / audit_actor: the operation. */
  operation: MachineNameSchema.optional(),
  /** injection_as_data: the seed cell carrying the injected text. */
  cell: z.strictObject({ object: MachineNameSchema, id: z.string().min(1), field: MachineNameSchema }).optional(),
});

// ── Layer 6: iterate ────────────────────────────────────────────────────────

/** What one change request is expected to ADD to `expect`. */
export const ExpectDeltaSchema = z
  .strictObject({
    objects: z.array(MachineNameSchema).optional(),
    selectFields: z.array(SelectFieldExpectationSchema).optional(),
    lookups: z.array(LookupExpectationSchema).optional(),
    dashboards: z.array(MachineNameSchema).optional(),
    appNavTargets: z.array(MachineNameSchema).optional(),
  })
  .refine((d) => Object.values(d).some((v) => Array.isArray(v) && v.length > 0), {
    message: 'an expect delta adds at least one entry',
  });
export type ExpectDelta = z.infer<typeof ExpectDeltaSchema>;

export const IterateSchema = z.strictObject({
  change: LocalizedTextSchema,
  expectDelta: ExpectDeltaSchema,
});

// ── The card ────────────────────────────────────────────────────────────────

export const ScenarioCardSchema = z.strictObject({
  $comment: z.string().optional(),
  /** Equals the file's basename. */
  id: MachineNameSchema,
  title: z.string().min(1),
  /** Where the scenario comes from — the open set holds generic scenarios only. */
  provenance: z.string().min(1),
  prompt: PromptSchema,
  expect: ExpectSchema,
  capabilities: z.array(CapabilityTagSchema).min(1),
  category: CategorySchema,
  run: z.strictObject({
    seed: z.record(MachineNameSchema, z.array(SeedRowSchema).min(1)),
    questions: z.array(QuestionSchema).min(3),
    personas: z.array(PersonaSchema).min(2),
    operations: z.array(OperationSchema).min(1),
    guardrails: z.array(GuardrailSchema).min(GUARDRAIL_CHECKS.length),
  }),
  iterate: IterateSchema,
});
export type ScenarioCard = z.infer<typeof ScenarioCardSchema>;
