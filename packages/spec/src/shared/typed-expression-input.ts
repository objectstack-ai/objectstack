// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one constructor of a TYPED expression input — the shape
 * `CronExpressionInputSchema` and `TemplateExpressionInputSchema`
 * (`./expression.zod.ts`) are built from, and that a slot whose refusal must
 * prescribe something else builds its own copy of.
 *
 * ## ⛔ Package-internal — NOT a public export
 *
 * Deliberately absent from `shared/index.ts` and from the root barrel, like
 * `./refinement-projection.ts`: its callers are `./expression.zod.ts` and the
 * notify node config (`../automation/io-node-config.zod.ts`), both inside
 * `@objectstack/spec`, and a published factory with no consumer outside the
 * package would widen the public face for nothing. `api-surface/` and
 * `export-origins/` must not move for it.
 *
 * ## Why `ExpressionSchema` is a PARAMETER, not an import
 *
 * `./expression.zod.ts` builds its two typed schemas from this module, so a
 * runtime import back into `./expression.zod.ts` would be a module cycle — the
 * shape that crashed entries under `OS_EAGER_SCHEMAS=1` before
 * (`./index.ts`'s note on `field-type-suggestion`). The caller hands the
 * persistence envelope in, and this module imports from `./expression.zod.ts`
 * as TYPES only (`import type` is erased, so no runtime edge exists). Each
 * dialect's envelope arm is still spelled once, here.
 */

import { z } from 'zod';
import { NON_BLANK_STRING } from './refinement-projection';
import type { ExpressionSchema, TypedExpressionDialect } from './expression.zod';

/** The two sentences one typed slot refuses with. */
export interface TypedExpressionRefusals {
  /** Refuses a blank bare string (empty or whitespace-only). */
  readonly sourceRequired: string;
  /** Refuses a foreign-dialect envelope and any value that is neither a string nor an envelope. */
  readonly dialectOnly: string;
}

/**
 * The typed input for `dialect`, around its own envelope arm: a bare, non-blank
 * string (shorthand for `{ dialect, source }`) or that envelope, refusing
 * everything else with the sentences it is given. The two exported
 * constructors below are the only callers; each builds its envelope arm with a
 * CONCRETE `z.literal`, because `safeExtend` cannot check a literal over a
 * generic dialect (`ZodLiteral<D>` is not provably assignable to the
 * `ExpressionDialect` key it narrows — TS2322, measured).
 *
 * The accept set is fixed by the dialect alone; `refusals` moves only the text.
 * That is the point of taking them as an argument: a refusal is the one place
 * an author is told exactly what to write, so it must prescribe the spelling
 * the slot's renderer reads. The shared `template` sentence prescribes
 * `{{record.name}}`, which the notify executor's single-brace interpolator
 * would leave inside a stray pair of braces, so the notify `title` / `message`
 * pass sentences prescribing `{record.name}` instead.
 *
 * The refusal shape is measured, not assumed (zod 4.4): a union reports the
 * one arm that did not abort, else `invalid_union`. Both arms abort on a
 * foreign value — the string arm is a pipe, whose transform aborts the arm on
 * any issue, and the envelope arm's `z.literal` aborts on a foreign dialect —
 * so every refusal is ONE `invalid_union` at the slot, and the union's own
 * error map is where the message lives: `sourceRequired` for a string input,
 * `dialectOnly` for everything else. A `.refine` on the envelope arm would
 * surface as `custom` at `dialect` instead, but would leave the input TYPE,
 * the JSON Schema and the generated reference page declaring every dialect on
 * a typed slot; the literal keeps all four surfaces saying one thing. The one
 * refusal `ExpressionSchema` carries — neither `source` nor `ast` — still
 * surfaces on its own, with its own message: that arm does not abort on it.
 *
 * The string arm carries `sourceRequired` too, not only the union: the union's
 * message is not the only text an author sees, because `formatZodIssue` and
 * the wire mapper expand an `invalid_union`'s branches beneath it, so a branch
 * message naming another slot's spelling would reach the author under the
 * right one.
 *
 * The string arm's transform returns the narrowed `{ dialect, source }`, not
 * the wide `Expression`: the parsed value of a typed slot must stay assignable
 * to its own input type (`ObjectStackDefinitionSchema.parse` output is handed
 * to validators typed with the input shape), and it is — a same-dialect
 * envelope is both.
 */
function typedExpressionUnion<D extends TypedExpressionDialect, E extends z.ZodType>(
  dialect: D,
  envelope: E,
  refusals: TypedExpressionRefusals,
) {
  return z.union([
    z.string()
      .refine(NON_BLANK_STRING, { message: refusals.sourceRequired })
      .transform((source) => ({ dialect, source })),
    envelope,
  ], {
    error: (issue: { input?: unknown }) => (typeof issue.input === 'string' ? refusals.sourceRequired : refusals.dialectOnly),
  });
}

/**
 * The cron-typed input, refusing with `refusals` — `CronExpressionInputSchema`
 * is this with the shared cron sentences.
 *
 * @param expression - `ExpressionSchema` (see the module note for why it is passed in).
 */
export function cronExpressionInput(expression: typeof ExpressionSchema, refusals: TypedExpressionRefusals) {
  return typedExpressionUnion('cron', expression.safeExtend({ dialect: z.literal('cron') }), refusals);
}

/**
 * The template-typed input, refusing with `refusals` —
 * `TemplateExpressionInputSchema` is this with the shared `{{record.name}}`
 * sentences, and a notify node's `title` / `message` are this with sentences
 * prescribing `{record.name}`.
 *
 * @param expression - `ExpressionSchema` (see the module note for why it is passed in).
 */
export function templateExpressionInput(expression: typeof ExpressionSchema, refusals: TypedExpressionRefusals) {
  return typedExpressionUnion('template', expression.safeExtend({ dialect: z.literal('template') }), refusals);
}
