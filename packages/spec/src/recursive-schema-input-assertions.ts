// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Compile-level pins for the INPUT half of every recursive schema (#3786).
 *
 * A recursive Zod schema cannot infer its own type, so it carries a hand-written
 * `z.ZodType<...>` annotation. `z.ZodType` takes TWO type parameters,
 * `<Output, Input>`, and **`Input` defaults to `unknown`**. Naming only the
 * first is the path of least resistance, it compiles, it validates correctly at
 * runtime — and it silently un-types every authoring path through the schema,
 * because `unknown` accepts everything.
 *
 * That has now happened twice in this package, and the second time is the reason
 * this file exists:
 *
 * 1. #4171 found `z.ZodType<any>` on the nav union and replaced it with
 *    `z.ZodType<NavigationItem>` — fixing the OUTPUT half and leaving `Input` at
 *    its default. `check-exported-any.ts` was built to hold that fix, and it
 *    reads output only, so it reported green over the remaining half.
 * 2. #4221 found the consequence: `defineApp(config: z.input<typeof AppSchema>)`,
 *    the documented authoring entry point, compiled
 *    `navigation: [{ totally: 'made up' }, 42, 'nonsense']` clean. #4227 then
 *    named both parameters on the six remaining recursive schemas.
 *
 * ## Why probes and not a scanner
 *
 * #4227 considered a `.d.ts`-level gate and declined it, correctly: separating a
 * deliberate `z.ZodType<T>` (the generic parameter in `contracts/llm-adapter.ts`
 * takes a caller-supplied schema, where the input side is genuinely nobody's
 * business) from an omission needs heuristics on emitted type names, and
 * `check-exported-any.ts`'s own rule is zero false positives so red keeps
 * meaning broken. Its commit nominated #4221's assertion pattern instead. This
 * is that pattern, applied to the eight schemas #4221 did not cover.
 *
 * Each schema gets two probes. The **negative** one is load-bearing: it is a
 * value `unknown` would accept and the real input type rejects, so the moment a
 * type parameter goes missing the suppression becomes unused and `tsc` fails on
 * this line. The positive one guards the opposite error — an input type so tight
 * that legitimate authoring stops compiling.
 *
 * Why a plain src module and not a test: `packages/spec/tsconfig.json` excludes
 * every test file, and the CI gate for this package is `tsc --noEmit` over the
 * `src` tree (lint.yml), so probes must live in a non-test src file to be checked
 * at all. Nothing imports this module and no barrel re-exports it, so it adds
 * nothing to any build.
 *
 * `NavigationItemSchema` is deliberately absent — `ui/app.nav-type-assertions.ts`
 * covers it in more detail, including its per-branch recursion knot.
 */

import type { z } from 'zod';

import type { FormFieldInput, FormFieldSchema } from './ui/view.zod';
import type { StateNodeConfig, StateNodeSchema } from './automation/state-machine.zod';
import type { BaseValidationRuleShape, ValidationRuleSchema } from './data/validation.zod';
import type {
  FilterCondition,
  FilterConditionSchema,
  NormalizedFilter,
  NormalizedFilterSchema,
} from './data/filter.zod';
import type {
  FieldNode,
  FieldNodeSchema,
  QueryInput,
  QuerySchema,
} from './data/query.zod';

/* ── data/query.zod.ts ─────────────────────────────────────────────────────── */

/**
 * The authoring shape: only `object` is required, `expand` recurses.
 *
 * The projection names the object's OWN columns, and keeps the foreign key
 * (`owner_id`) that `expand` resolves through — this pin doubles as the one
 * canonical query in the file, so it spells the shape the spec prescribes
 * (#7601) rather than the dotted path the ingress refuses (#7532).
 */
export const queryInput: QueryInput = {
  object: 'account',
  fields: ['name', 'owner_id'],
  expand: { owner_id: { object: 'user', fields: ['name'] } },
};

// @ts-expect-error — a query is not a string (`unknown` would take it)
export const queryNotAString: QueryInput = 'not a query at all';

// @ts-expect-error — `object` is required; nothing else can stand in for it
export const queryNeedsObject: QueryInput = { fields: ['name'] };

// `JoinNodeSchema` probes removed with the join cluster (#4286): `query.joins`
// is tombstoned and the schema — the package's other recursive knot through
// `QuerySchema` — is gone, so there is no input half left to pin.

/**
 * A select entry is a field name — one of the queried object's own columns.
 *
 * `FieldNode` stopped being recursive in #4196 — the `{ field, fields, alias }`
 * member it used to carry was declared-but-inert and is gone, so
 * `FieldNodeSchema` infers both halves itself rather than carrying a
 * `z.ZodType<Output, Input>` annotation. The probes stay: this file's job is that
 * the input side is CHECKED, and a `z.string()` that someone re-widens to
 * `z.ZodType<FieldNode>` fails here exactly as a dropped type parameter would.
 *
 * ## The dotted probe is a NON-NARROWING guard, not an endorsement (#7601)
 *
 * A dotted string still satisfies `FieldNode`, and that must stay true: the
 * refusal of dotted projections (#7532) is a SEMANTIC verdict at the ingress
 * gate (`assertProjectionFieldsExist`, `400 INVALID_FIELD`), where the field map
 * is available to judge against — not a SHAPE check. `FieldNodeSchema` stays
 * `z.string()`, so every input valid before #7601 parses byte-identically after
 * it. The probe below pins exactly that: it fails if someone "fixes" the docs
 * defect by narrowing the type, which would move a semantic verdict into the
 * shape check and refuse the registry-less internal callers the ingress
 * deliberately tolerates. It does NOT assert that a dotted path RESOLVES —
 * no driver ever implemented that, which is the defect #7601 corrected in the
 * prose. Named for what it guards so it stops reading as a feature pin.
 */
export const fieldNodeString: FieldNode = 'name';
export const fieldNodeDottedNotNarrowed: FieldNode = 'owner.email';

// @ts-expect-error — a select entry is not a number
export const fieldNodeNotANumber: FieldNode = 42;

// @ts-expect-error — nor the nested-select object form retired in #4196
export const fieldNodeNotTheRetiredForm: FieldNode = { field: 'owner', fields: ['email'] };

/* ── data/filter.zod.ts ────────────────────────────────────────────────────── */

/**
 * NOTE the weak pin here. `FilterCondition` carries `[key: string]: any` because
 * implicit equality (`{ name: 'x' }`) genuinely accepts any value, so the type
 * admits every object shape. What it still rejects — and what these probes
 * therefore assert — is a non-object. That is enough to catch the regression
 * this file guards (`unknown` accepts primitives too) and no more; the index
 * signature is a separate, pre-existing looseness.
 */
export const filterInput: FilterCondition = {
  name: 'Acme',
  amount: { $gt: 100 },
  $or: [{ stage: 'won' }, { stage: 'lost' }],
};

// @ts-expect-error — a filter is not a number
export const filterNotANumber: FilterCondition = 42;

/** The normalized AST is properly closed — a stronger pin than the above. */
export const normalizedInput: NormalizedFilter = {
  $and: [{ name: { $eq: 'Acme' } }, { $or: [{ stage: { $eq: 'won' } }] }],
};

// @ts-expect-error — a normalized filter is not a string
export const normalizedNotAString: NormalizedFilter = 'nope';

// @ts-expect-error — only `$and` / `$or` / `$not` are declared at this level
export const normalizedBadKey: NormalizedFilter = { $nand: [] };

/* ── automation/state-machine.zod.ts ───────────────────────────────────────── */

/** Every key is optional; `states` recurses. */
export const stateInput: StateNodeConfig = {
  type: 'compound',
  initial: 'draft',
  states: {
    draft: { type: 'atomic', on: { SUBMIT: 'review' } },
    review: { type: 'final' },
  },
};

// @ts-expect-error — a state node is not a string
export const stateNotAString: StateNodeConfig = 'draft';

// @ts-expect-error — `type` must be one of the five declared state kinds
export const stateBadType: StateNodeConfig = { type: 'pending' };

/* ── data/validation.zod.ts ────────────────────────────────────────────────── */

/**
 * `type` / `name` / `message` are required. Like `FilterCondition`, this shape
 * carries an index signature (`[key: string]: unknown`), so it types the known
 * keys and admits others — the required three are what the pin can assert.
 */
export const validationInput: BaseValidationRuleShape = {
  type: 'expression',
  name: 'amount_positive',
  message: 'Amount must be positive',
  severity: 'error',
};

// @ts-expect-error — a validation rule is not a number
export const validationNotANumber: BaseValidationRuleShape = 42;

// @ts-expect-error — `message` is required alongside `type` and `name`
export const validationNeedsMessage: BaseValidationRuleShape = {
  type: 'expression',
  name: 'amount_positive',
};

/* ── ui/view.zod.ts ────────────────────────────────────────────────────────── */

/** Only `field` is required; `fields` recurses for composite/repeater types. */
export const formFieldInput: FormFieldInput = {
  field: 'line_items',
  type: 'repeater',
  fields: [{ field: 'product' }, { field: 'qty' }],
};

// @ts-expect-error — a form field is not a string
export const formFieldNotAString: FormFieldInput = 'line_items';

// @ts-expect-error — `field` is required
export const formFieldNeedsField: FormFieldInput = { type: 'text' };

/* ── The wiring ────────────────────────────────────────────────────────────────
 *
 * Everything above pins the exported input TYPES. None of it pins the thing that
 * actually broke twice: whether each SCHEMA is annotated with its input type at
 * all. A perfectly-written `QueryInput` that `QuerySchema` does not reference
 * leaves `z.input<typeof QuerySchema>` at `unknown` and every authoring path
 * unchecked — the exact state #4221 and #4227 fixed.
 *
 * So these go through `z.input<typeof Schema>`, the way a consumer reaches it.
 * Dropping a second type parameter turns each into an unused suppression.
 * ──────────────────────────────────────────────────────────────────────────── */

// @ts-expect-error — QuerySchema's input is checked, not `unknown`
export const wiredQuery: z.input<typeof QuerySchema> = 42;

// @ts-expect-error — FieldNodeSchema's input is checked
export const wiredFieldNode: z.input<typeof FieldNodeSchema> = 42;

// @ts-expect-error — FilterConditionSchema's input is checked
export const wiredFilter: z.input<typeof FilterConditionSchema> = 42;

// @ts-expect-error — NormalizedFilterSchema's input is checked
export const wiredNormalized: z.input<typeof NormalizedFilterSchema> = 42;

// @ts-expect-error — StateNodeSchema's input is checked
export const wiredState: z.input<typeof StateNodeSchema> = 42;

// @ts-expect-error — ValidationRuleSchema's input is checked
export const wiredValidation: z.input<typeof ValidationRuleSchema> = 42;

// @ts-expect-error — FormFieldSchema's input is checked
export const wiredFormField: z.input<typeof FormFieldSchema> = 42;
