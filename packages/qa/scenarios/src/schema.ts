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

import { ErrorCode } from '@objectstack/spec/api';
import { MarketplaceBusinessFunctionsSchema } from '@objectstack/spec/marketplace';
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

// ── Layer 3: capabilities + business functions ────────────────────────────────────────

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

/**
 * The tag whose check judges a persona's row `scope` in the build. The loader
 * requires it on every card with a scoped persona, and the scorer keys its
 * check by it, so the two can never spell it apart.
 */
export const ROW_SCOPE_TAG = 'access-security.row-scope';

/**
 * A card's business functions — the marketplace taxonomy's business-function
 * facet, read from `@objectstack/spec/marketplace` and never restated here:
 * 1-3 distinct values, the primary one first. A card graduates into a
 * marketplace template, so it is classified the way the template will be
 * listed. (This used to be a hand copy of the cloud catalog's single-category
 * list; the taxonomy now lives once, in the spec.)
 */
export const BusinessFunctionsSchema = MarketplaceBusinessFunctionsSchema;

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

/**
 * A field of the question's object, or a RELATION PATH through lookup fields
 * declared in `expect.lookups` (`invoice.status`, `order.account.region`),
 * resolved through the seed rows' lookup ids by the loader.
 */
export const FieldPathSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/, 'must be a snake_case field or a dotted relation path');

/** A window relative to the card's fixed `asOf` date, so a truth stays deterministic. */
export const WindowSchema = z.discriminatedUnion('kind', [
  /** The `days` days ending on `asOf`, inclusive. */
  z.strictObject({ kind: z.literal('last_days'), days: z.number().int().min(1) }),
  z.strictObject({
    kind: z.literal('calendar'),
    period: z.enum(['this_month', 'previous_month', 'this_year', 'previous_year']),
  }),
]);
export type Window = z.infer<typeof WindowSchema>;

export const FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'in_window'] as const;

export const FilterSchema = z
  .strictObject({
    field: FieldPathSchema,
    op: z.enum(FILTER_OPS),
    value: z.union([ScalarSchema, z.array(ScalarSchema).min(1), WindowSchema]),
  })
  .superRefine((f, ctx) => {
    const isList = Array.isArray(f.value);
    const isWindow = typeof f.value === 'object' && f.value !== null && !isList;
    if ((f.op === 'in_window') !== isWindow) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: '`in_window`, and only it, takes a window value' });
      return;
    }
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
    groupBy: FieldPathSchema.optional(),
    order: z.enum(ORDERS).optional(),
  });
}

/**
 * The DECLARATIVE truth of a question. The loader evaluates it over the seed
 * rows; a question's answer is computed by code, never typed by hand.
 *
 * `kind` is a closed enum — count | sum | avg | min | max | topN | unanswerable.
 * `unanswerable` means the seed cannot answer: a correct reply says so.
 */
export const TruthSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unanswerable'), reason: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('count'),
    filter: filterList,
    groupBy: FieldPathSchema.optional(),
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
      groupBy: FieldPathSchema.optional(),
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
  /** Also compute the truth AS each of these personas (their row scope and hidden fields applied). */
  personas: z.array(MachineNameSchema).min(1).optional(),
});

export const FieldRefSchema = z.strictObject({
  object: MachineNameSchema,
  field: MachineNameSchema,
});

/**
 * The field of a persona's person record (`personas[].record`) that holds the
 * persona's user: fixed by name, so no card chooses it.
 */
export const PERSON_USER_FIELD = 'user';

export const PersonaSchema = z
  .strictObject({
    id: MachineNameSchema,
    role: z.string().min(1),
    hidden: z.strictObject({
      objects: z.array(MachineNameSchema).optional(),
      fields: z.array(FieldRefSchema).optional(),
    }),
    /**
     * ROW scope: of each named object the persona sees only the rows whose
     * `field` (a field or relation path) equals `value` — a rep sees their own
     * rows (`owner`), a manager their department's (`owner.department`). The
     * field a rule ends on is `id`, a declared lookup or select, or a declared
     * user-handle field (`run.userHandleFields`); the loader refuses any other.
     */
    scope: z
      .array(z.strictObject({ object: MachineNameSchema, field: FieldPathSchema, value: ScalarSchema }))
      .min(1)
      .optional(),
    /**
     * The seed row that IS this person (`{ object: 'employee', id: 'e06' }`):
     * the person record the persona signs in as. Required for a persona with a
     * `scope`, unless that persona is named through a user-handle field instead
     * (a direct scope rule on a `run.userHandleFields` field, `owner: u_sam`);
     * optional for a global one. The loader refuses a record naming no seed row.
     * The person object's user field is `user` by name ({@link PERSON_USER_FIELD}),
     * never chosen per card.
     */
    record: z.strictObject({ object: MachineNameSchema, id: z.string().min(1) }).optional(),
  })
  .refine((p) => (p.hidden.objects?.length ?? 0) + (p.hidden.fields?.length ?? 0) > 0, {
    path: ['hidden'],
    message: 'a persona names at least one object or field it must NOT see',
  });

// ── Layer 5: run.operations + run.guardrails ────────────────────────────────

export const OPERATION_KINDS = ['create', 'update', 'delete'] as const;

/** A record as the data API should read it after an applied write. */
export const PostStateSchema = z
  .strictObject({
    object: MachineNameSchema,
    /** A seeded row's id — or, for a row the write creates, `where` matches it. */
    id: z.string().min(1).optional(),
    where: z.record(MachineNameSchema, ScalarSchema).optional(),
    values: z.record(MachineNameSchema, ScalarSchema).optional(),
    absent: z.literal(true).optional(),
  })
  .superRefine((s, ctx) => {
    if ((s.id === undefined) === (s.where === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'a post-state names its row by exactly one of `id` or `where`' });
    }
    if ((s.values === undefined) === (s.absent === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'a post-state carries exactly one of `values` or `absent`' });
    }
  });

/** What a write must come to — declared, so grading reads it with code only. */
export const OutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('applied'),
    state: z.array(PostStateSchema).min(1),
    /** The persona the audit trail must name as the actor. */
    auditActor: MachineNameSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('refused'),
    // A code the platform really answers: the spec's closed catalogue
    // (StandardErrorCode + the registered ledger, ADR-0112), never restated here.
    code: ErrorCode,
  }),
  /** The agent asks first and writes nothing until confirmed. */
  z.strictObject({ kind: z.literal('pending_confirmation') }),
]);

export const OperationSchema = z
  .strictObject({
    id: MachineNameSchema,
    kind: z.enum(OPERATION_KINDS),
    object: MachineNameSchema,
    ask: LocalizedTextSchema,
    target: z.string().min(1).optional(),
    values: z.record(MachineNameSchema, ScalarSchema).optional(),
    /** The persona the agent acts for. */
    actingAs: MachineNameSchema,
    outcome: OutcomeSchema,
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

/** A business action an agent may call; `confirm` actions ask before acting. */
export const AgentActionSchema = z.strictObject({
  name: MachineNameSchema,
  object: MachineNameSchema,
  summary: z.string().min(1),
  confirm: z.boolean(),
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

// ── The app code and its namespace ──────────────────────────────────────────

/**
 * The card's app code: 2–8 lowercase letters, no digit, no underscore. The
 * loader also refuses two cards sharing one (uniqueness is a property of the
 * library, so it is judged across the directory, never by this schema).
 */
export const AppCodeSchema = z
  .string({ error: (issue) => (issue.input === undefined ? 'a card names its app `code`: 2–8 lowercase letters, e.g. `crm`' : undefined) })
  .regex(/^[a-z]{2,8}$/, 'must be 2–8 lowercase letters (no digit, no underscore), e.g. `crm`');

// ── The tier: what a card is for ────────────────────────────────────────────

/**
 * What a card is FOR — a closed set, and every card names one:
 *
 *   control   an internal quality check (the small golden cases): never
 *             exported, never shown in the gallery, whatever it scores;
 *   starter   a gallery starter template (the mid-tier scenarios);
 *   delivery  a delivery-grade scenario.
 *
 * A card-level key, outside `expect`: the scorer never reads it. The loader
 * holds a {@link GALLERY_TIERS} card to its floor (`GALLERY_FLOOR` in
 * `loader.ts`); a `control` card has no floor. The gallery exporter exports a
 * {@link GALLERY_TIERS} card only, and only a `generic` one
 * ({@link SCENARIO_ORIGINS}; `src/export/generic.ts`).
 */
export const SCENARIO_TIERS = ['control', 'starter', 'delivery'] as const;
export type ScenarioTier = (typeof SCENARIO_TIERS)[number];

export const ScenarioTierSchema = z.enum(SCENARIO_TIERS, {
  error: (issue) =>
    issue.input === undefined
      ? 'a card names its `tier`: `control` (an internal check, never exported), `starter` or `delivery`'
      : undefined,
});

/** The tiers a gallery export may carry: every tier but `control`. */
export const GALLERY_TIERS = ['starter', 'delivery'] as const satisfies readonly ScenarioTier[];

export function isGalleryTier(tier: ScenarioTier): tier is (typeof GALLERY_TIERS)[number] {
  return (GALLERY_TIERS as readonly ScenarioTier[]).includes(tier);
}

// ── The origin: where a card comes from ─────────────────────────────────────

/**
 * Where a card COMES FROM — a closed set, and every card names one:
 *
 *   generic           written from the domain alone, by anyone; the only
 *                     origin the open library (`docs/qa/scenarios/`) holds and
 *                     the only one the gallery exporter exports;
 *   customer-derived  derived from a customer's app, data or wording: lives in
 *                     the private overlay, never exported;
 *   held-out          withheld from the open set, so a score on it is not one
 *                     anything was tuned against: lives in the private
 *                     overlay, never exported.
 *
 * The explicit marker the exporter reads. Neither `provenance` (free prose)
 * nor the card's directory is one: the loader reads whatever directory it is
 * handed. What the loader does know is which library its caller says it is
 * loading (`LoadOptions.library` in `loader.ts`), and it refuses a `generic`
 * card in the private overlay and any other card in the open library.
 */
export const SCENARIO_ORIGINS = ['generic', 'customer-derived', 'held-out'] as const;
export type ScenarioOrigin = (typeof SCENARIO_ORIGINS)[number];

export const ScenarioOriginSchema = z.enum(SCENARIO_ORIGINS, {
  error: (issue) =>
    issue.input === undefined
      ? 'a card names its `origin`: `generic` (written from the domain alone), `customer-derived` or `held-out` (both private, never exported)'
      : undefined,
});

// ── The title ───────────────────────────────────────────────────────────────

const titleText = z.string().regex(/\S/, 'must not be blank');

/**
 * The card's title in both languages, each non-empty: the gallery lists every
 * app with a Chinese and an English title. A reader picks one explicitly
 * (`title.en`, `title.zh`); the object is never printed whole.
 */
export const CardTitleSchema = z.strictObject(
  { zh: titleText, en: titleText },
  {
    error: (issue) =>
      issue.code === 'invalid_type' ? 'a card names its `title` as `{ zh, en }`, both non-empty' : undefined,
  },
);
export type CardTitle = z.infer<typeof CardTitleSchema>;

/** What every scenario app's namespace starts with. */
export const SCENARIO_NAMESPACE_PREFIX = 'demo';

/**
 * The namespace a card's app lives in, wherever it is built, scored or
 * exported: `demo` + the card's code (`democrm`). Every item the app declares
 * is named `<namespace>_<short>`, and the card's own names (`account`) are read
 * relative to it (ruling A on #30292).
 */
export function scenarioNamespace(card: { code: string }): string {
  return `${SCENARIO_NAMESPACE_PREFIX}${card.code}`;
}

/**
 * The permission set a persona signs in with, in an app of `namespace`:
 * `<namespace>_<persona id>` (`democrm_sdr`). The runner grants it to the
 * persona's user, the build prompt asks for it by this name, and the scorer
 * reads its row-level security from it.
 */
export function personaPermissionSetName(namespace: string, persona: string): string {
  return `${namespace}_${persona}`;
}

// ── The card ────────────────────────────────────────────────────────────────

export const ScenarioCardSchema = z.strictObject({
  $comment: z.string().optional(),
  /** Equals the file's basename. */
  id: MachineNameSchema,
  /** The app code; the app's namespace is {@link scenarioNamespace}. */
  code: AppCodeSchema,
  /** What the card is for: {@link SCENARIO_TIERS}. */
  tier: ScenarioTierSchema,
  /** Where the card comes from: {@link SCENARIO_ORIGINS}. */
  origin: ScenarioOriginSchema,
  /** {@link CardTitleSchema}: `{ zh, en }`. */
  title: CardTitleSchema,
  /** Where the scenario comes from, in prose — read by people; {@link SCENARIO_ORIGINS} is the marker code reads. */
  provenance: z.string().min(1),
  prompt: PromptSchema,
  expect: ExpectSchema,
  /** The fixed "today" relative windows are computed against (`YYYY-MM-DD`). */
  asOf: z.iso.date().optional(),
  capabilities: z.array(CapabilityTagSchema).min(1),
  businessFunctions: BusinessFunctionsSchema,
  run: z.strictObject({
    seed: z.record(MachineNameSchema, z.array(SeedRowSchema).min(1)),
    /**
     * The seed fields whose values are user HANDLES (`account.owner` = `u_sam`):
     * the text stands for a user, so the runner loads each such cell with that
     * user's id and never the text. Declared, never inferred: a field neither
     * listed here nor a declared lookup or select holds its seed value verbatim.
     */
    userHandleFields: z.array(FieldRefSchema).min(1).optional(),
    questions: z.array(QuestionSchema).min(5),
    personas: z.array(PersonaSchema).min(2),
    operations: z.array(OperationSchema).min(2),
    guardrails: z.array(GuardrailSchema).min(GUARDRAIL_CHECKS.length),
    /** Why the card runs fewer than 8 questions or 4 operations; required then. */
    countsReason: z.string().min(1).optional(),
    agentActions: z.array(AgentActionSchema).min(3).optional(),
  }),
  iterate: IterateSchema,
});
export type ScenarioCard = z.infer<typeof ScenarioCardSchema>;

/**
 * The operation a card's `write_validation` guardrail names (a `refused`
 * create or update; the loader holds that). The runner probes it with its own
 * write of the declared values after the agent's turn, and the grader judges
 * the agent and the probe as two halves (#30883 item 2).
 */
export function isWriteValidationOperation(card: Pick<ScenarioCard, 'run'>, operationId: string): boolean {
  return card.run.guardrails.some((g) => g.check === 'write_validation' && g.operation === operationId);
}

/**
 * The operations the runner probes after the agent's turn, by sending the
 * declared write itself as the acting persona, and the grader judges in an
 * agent half and a platform half: the {@link isWriteValidationOperation} one,
 * and every other `refused` create or update — a permission overstep, whose
 * platform answer an agent that declines without touching the door would
 * otherwise hide (#31145 item 4). A refused `delete` is not probed: the runner
 * sends no delete of its own.
 */
export function isProbedOperation(card: Pick<ScenarioCard, 'run'>, operationId: string): boolean {
  const op = card.run.operations.find((o) => o.id === operationId);
  return op !== undefined && op.outcome.kind === 'refused' && op.kind !== 'delete';
}
