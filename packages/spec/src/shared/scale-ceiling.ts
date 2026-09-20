// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The platform ceiling on decimal places (#18972, #19088)
 *
 * Every renderer that turns a declared `scale` into fraction digits reaches one
 * of two platform primitives, and BOTH refuse above 100. Measured first-hand on
 * node v22.22.2:
 *
 *   (1.5).toFixed(100)                                       -> '1.5000...'  (ok)
 *   (1.5).toFixed(101)                                       -> RangeError: toFixed() digits argument must be between 0 and 100
 *   new Intl.NumberFormat(u, { maximumFractionDigits: 100 }) -> ok
 *   new Intl.NumberFormat(u, { maximumFractionDigits: 101 }) -> RangeError: maximumFractionDigits value is out of range.
 *
 * So the bound is the PLATFORM's, not a policy: it is the largest value every
 * conforming consumer can render, and a declaration past it is unrenderable
 * rather than merely large. The literal is never trusted on its own — the pins
 * beside each consuming schema re-measure both primitives on every run and
 * assert the schema's own accept/refuse boundary sits on the same number, so a
 * runtime that moves either limit turns the pin red instead of silently
 * shifting what authors may write.
 *
 * ## Why this module exists, and why it exports nothing to consumers
 *
 * #18972 minted this fact inside `data/field.zod.ts` as a module-private
 * `MAX_RENDERABLE_SCALE`, for the two `scale` declarations that file carries.
 * #19088 is the third site — `FormFieldBaseSchema.scale` in `ui/view.zod.ts`,
 * the form-row override — which reaches the same `Intl.NumberFormat` reader
 * through plugin-form. Measured in the sibling checkout at the `.objectui-sha`
 * pin `53ded82bf7`:
 *
 *   packages/plugin-form/src/sectionFields.ts:220
 *     if (fd.scale != null) base.scale = fd.scale;   // form row -> runtime field
 *   packages/fields/src/index.tsx:661-667
 *     maximumFractionDigits: scale ?? 20             // runtime field -> Intl
 *
 * ⛔ Do NOT cite an objectui "spec bridge" (`form-view.ts` `mapField`) here.
 * That route is RETIRED at this pin — the tree carries
 * `.changeset/retire-spec-bridge-6366.md`, there is no `spec-bridge/`
 * directory, and the only `mapField` hits are `mapFieldTypeToFormType` in
 * `app-shell`, a different symbol. The citation survives in this repo's older
 * neighbouring comments (the #12174 block in `ui/view.zod.ts` and its test),
 * inherited from `liveness/view.json`'s 2026-08-26 reading at objectui@f7c52e2;
 * it was carried forward once into this card and corrected here. The
 * plugin-form route above carries the premise on its own.
 *
 * A second file needing the same number left three ways to share it, each with
 * its own price:
 *
 * 1. **Duplicate the literal** in `view.zod.ts` — cheapest edit, and it records
 *    one platform fact in a second place with nothing holding the two equal.
 * 2. **Promote `MAX_RENDERABLE_SCALE` out of `field.zod.ts` as a published
 *    export** — `data/index.ts` re-exports that file with `export *`, so the
 *    constant would land on the `@objectstack/spec/data` surface: a new export
 *    (`Clause-②: yes`, at least `minor`, and a contract-tier review) bought for
 *    one bound, on a file another card holds.
 * 3. **This module** — a `src/shared/` leaf that is deliberately absent from
 *    `shared/index.ts`, so it reaches no package entry and no `api-surface`
 *    snapshot. It is the established shape for spec-internal constants
 *    (`strict-object.ts`, `editability-boundary.ts`, `union-branch-policy.ts`
 *    are the same kind), it imports nothing so it cannot participate in a
 *    cycle, and adopting it costs a consumer one import line.
 *
 * Route 3 is what landed. `data/field.zod.ts` still carries its own private
 * copy of both values, because the surface #19088 was dispatched against is
 * `ui/view.zod.ts` alone — this module is the home that copy can move into
 * later as a pure delete-and-import, with no export and no review to buy. Until
 * it does, the two are held equal from the other end: the pin beside
 * `FormFieldBaseSchema.scale` asserts its refusal text is byte-identical to the
 * one `FieldSchema.scale` produces, so a drift between the copies is a red
 * test rather than two divergent messages for one platform limit.
 *
 * The consumer-side half of the same fact lives in `packages/objectql` as its
 * module-private `MAX_FORMULA_SCALE` (it skips formula rounding past the
 * ceiling so a display declaration can never fail a read). That one is
 * deliberately not folded in here either: `packages/spec` may not depend on a
 * consumer package.
 */

/**
 * The largest `scale` (decimal places) every conforming renderer can honour.
 * Both platform primitives throw `RangeError` above it.
 */
export const MAX_RENDERABLE_SCALE = 100;

/**
 * The refusal text for a `scale` past {@link MAX_RENDERABLE_SCALE}. It names
 * WHY, so an author reads a platform limit they can verify rather than an
 * arbitrary cap somebody chose. Every occurrence of the number is derived from
 * the constant, so the prose cannot drift from the bound it explains.
 */
export const SCALE_UPPER_BOUND_MESSAGE =
  'Decimal places cannot exceed ' + MAX_RENDERABLE_SCALE + ' — the limit is the renderers\', not a policy: every consumer '
  + 'turns `scale` into fraction digits, and both `Number.prototype.toFixed` and '
  + '`Intl.NumberFormat`\'s `maximumFractionDigits` throw a RangeError above ' + MAX_RENDERABLE_SCALE + ', so a larger '
  + 'declaration is unrenderable rather than merely large. Declare at most ' + MAX_RENDERABLE_SCALE + ' (an IEEE-754 '
  + 'double carries ~17 significant digits, so a meaningful display precision is far below it).';
