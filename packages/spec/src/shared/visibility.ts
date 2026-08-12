// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { StrictObjectOptions } from './strict-object';
import type { KeySetGuidance } from './suggestions.zod';

/**
 * # Conditional-visibility predicate normalization (ADR-0089)
 *
 * One concept — *"show this only when the CEL predicate is TRUE"* — used to be
 * spelled three different ways depending on the layer:
 *
 * | Layer                         | Legacy key   | Canonical    |
 * |:------------------------------|:-------------|:-------------|
 * | Data field / field option     | `visibleWhen`| `visibleWhen`|
 * | View form section / field     | `visibleOn`  | `visibleWhen`|
 * | Page component                | `visibility` | `visibleWhen`|
 *
 * ADR-0089 makes **`visibleWhen`** the single canonical key across all layers
 * (aligning with the `readonlyWhen` / `requiredWhen` family and the resolved
 * `conditionalRequired → requiredWhen` precedent). `visibleOn` and `visibility`
 * stay accepted as `@deprecated` aliases and are folded into `visibleWhen`
 * **once, at the schema boundary** (a zod `.transform()`), so no renderer or
 * validator has to re-implement the fallback.
 *
 * The *binding root* is still determined by the layer — runtime record surfaces
 * bind `record` + `current_user`; metadata-editing forms bind `data` — this
 * unifies the *name*, not the environment.
 */

/** Deprecated alias keys folded into the canonical `visibleWhen`. */
export const VISIBILITY_ALIAS_KEYS = ['visibleOn', 'visibility'] as const;

/** Object carrying the canonical key and/or its deprecated aliases. */
type WithVisibilityAliases = {
  visibleWhen?: unknown;
  visibleOn?: unknown;
  visibility?: unknown;
};

/**
 * Fold the deprecated `visibleOn` / `visibility` aliases into the canonical
 * `visibleWhen` and drop the aliases from the output (ADR-0089 D2). The
 * canonical key wins when present; otherwise the first defined alias is used.
 *
 * Designed to be used as a zod `.transform()` on any object schema that carries
 * a conditional-visibility predicate:
 *
 * ```ts
 * strictObject(VISIBILITY_STRICT_OPTIONS, { ..., visibleWhen: Expr.optional() })
 *   .transform(normalizeVisibleWhen)
 * ```
 */
export function normalizeVisibleWhen<T extends WithVisibilityAliases>(
  input: T,
): Omit<T, 'visibleOn' | 'visibility'> {
  const { visibleOn, visibility, ...rest } = input;
  const canonical =
    rest.visibleWhen !== undefined
      ? rest.visibleWhen
      : visibleOn !== undefined
        ? visibleOn
        : visibility;

  if (canonical === undefined) {
    // Nothing to fold — strip the (absent) aliases and return as-is.
    return rest as Omit<T, 'visibleOn' | 'visibility'>;
  }
  return { ...rest, visibleWhen: canonical } as Omit<T, 'visibleOn' | 'visibility'>;
}

/**
 * A key that is (or is a likely mis-spelling of) the visibility predicate.
 *
 * **Deliberately a pattern and not a list.** The keys this has to answer are the
 * ones nobody enumerated: `visibleWhenn`, `visibleIf`, `hiddenWhen`, `conceal`,
 * `showWhen`, a `visibility` pasted onto a view form. Enumerating them is the
 * shape of guess this family exists to stop the author making.
 *
 * It also matches the CANONICAL `visibleWhen` and both deprecated aliases, and
 * that is harmless by construction: a key the shape declares is recognised, so
 * it never reaches the `unrecognized_keys` path this pattern is consulted from.
 * It is the reason the audit asks a pattern about {@link
 * VISIBILITY_STRICT_OPTIONS}'s `examples` rather than about the shape's declared
 * keys — see `KeySetGuidance`.
 */
const VISIBILITY_KEY_PATTERN = /vis|conceal|hidden|show.?when/i;

/**
 * The shared `strictObject` options for every `.strict()` view/page schema that
 * carries a conditional-visibility predicate (ADR-0089 D3a).
 *
 * With the shape closed, a key these schemas do not declare — a stale
 * `visibleOn` past removal, a `visibleWhen` typo, or a wrong-layer paste — is a
 * **loud parse error** instead of a silent strip (ADR-0049 enforce-or-remove,
 * ADR-0078 no-silently-inert). The rejection is *fixable*: it names the
 * offending key(s), points a visibility-shaped key at the canonical
 * `visibleWhen`, and — new with the fold below — suggests the closest declared
 * key for everything else.
 *
 * ```ts
 * strictObject(VISIBILITY_STRICT_OPTIONS, { ..., visibleWhen: Expr.optional() })
 *   .transform(normalizeVisibleWhen)
 * ```
 *
 * ## Folded out of a hand-written `$ZodErrorMap` (#6619, #6416 direction 2)
 *
 * This used to be `strictVisibilityError`, a bespoke map that re-implemented
 * the front matter, the prescription branch and the trailing history sentence
 * by hand. Being hand-written is what put it out of reach of #5955 (the shared
 * template's reorder) and #5593 (the `strictObject` migration) — and, the
 * reason this card was worth doing, out of reach of `alias-integrity.test.ts`:
 * a hand-rolled map registers in no registry, so its prescription was
 * **unmeasured rather than clean**. Declared here, it is judged with every
 * other table in the package.
 *
 * The emission ORDER the pins in `ui/view.test.ts` encode is the template's own
 * and unchanged: front matter → fix channels → the explanatory sentence last.
 * What changed in the bytes is that the prescription is now rendered as the
 * template's `\n  • ` bullet rather than joined inline with a space, which is
 * how every other closed surface in this package already reads it.
 */
export const VISIBILITY_STRICT_OPTIONS: StrictObjectOptions = {
  surface: 'this view/page schema',
  history:
    'Before ADR-0089 D3a these were dropped silently, shipping inert metadata; '
    + 'a mis-layered or stale key is now a loud parse error.',
  guidanceSets: [
    {
      name: 'VISIBILITY_KEY_PATTERN',
      keys: VISIBILITY_KEY_PATTERN,
      // The spellings the pattern is FOR — the audit asserts each really
      // matches and that none is a key the shape declares, which is the
      // answerable half of the dead-entry claim for an open family.
      examples: ['visibleWhenn', 'visibleIf', 'hiddenWhen', 'conceal', 'showWhen'],
      prescription:
        'If this is the conditional-visibility predicate, the canonical key is '
        + '`visibleWhen` (ADR-0089) — `visibleOn` (view form) and `visibility` (page '
        + 'component) are still accepted as deprecated aliases.',
    },
  ],
};

/**
 * The editability vocabulary an author reaches for on a shape that gates
 * **visibility only** (#7887).
 *
 * Every spelling here is rejected by `FormSectionSchema` and
 * `PageComponentSchema` today and stays rejected: this set changes the MESSAGE,
 * never the verdict. `readOnly` sits alongside `readonly` because set
 * membership is matched case-sensitively (the rename channel is what folds
 * case, and a set match `continue`s past it).
 */
const EDITABILITY_BOUNDARY_KEYS = [
  'disabled',
  'disabledWhen',
  'readonly',
  'readOnly',
  'readonlyWhen',
  'editable',
] as const;

/**
 * The maintainer's 2026-08-12 ruling on #7887, rendered as the thing an author
 * actually reads: **boundary, not gap.**
 *
 * A form section and a page component gate *visibility*; **editability lives on
 * fields**. No `disabled` / `readonly` / `readonlyWhen` slot is added to either
 * shape, and no alias row is registered for them either — an alias names a key
 * the shape must then accept, and one the runtime does not honour is the
 * ADR-0049 declared-but-unenforced class this repo is retiring. What the author
 * gets instead is a prescription telling them where the key *does* belong.
 *
 * Deliberately points at **`readonlyWhen`** and not at `disabledWhen`:
 * `field.zod.ts` renames `disabled → readonly` and records in its own comment
 * that "a field has `readonlyWhen`, not `disabledWhen`" (#7832). Naming
 * `disabledWhen` here would send an author to a key that exists on no field
 * surface at all.
 */
const EDITABILITY_BOUNDARY_GUIDANCE: KeySetGuidance = {
  name: 'EDITABILITY_BOUNDARY_KEYS',
  keys: EDITABILITY_BOUNDARY_KEYS,
  prescription:
    'Editability is a FIELD-level concern. This shape gates VISIBILITY only — a '
    + 'deliberate boundary, not a missing key (#7887): a section / page component has '
    + 'no read-only semantics of its own to enforce. Write `readonly: true` (or the '
    + 'conditional `readonlyWhen` predicate) on the form field(s) inside it instead; to '
    + 'hide the whole section or component, use `visibleWhen`.',
};

/**
 * {@link VISIBILITY_STRICT_OPTIONS} for the two shapes that gate visibility and
 * **nothing else** — `FormSectionSchema` (`ui/view.zod.ts`) and
 * `PageComponentSchema` (`ui/page.zod.ts`).
 *
 * ## Why the boundary prescription is filed HERE and not in the shared table
 *
 * `VISIBILITY_STRICT_OPTIONS` has **three** consumers, and the third —
 * `FormFieldSchema` — is the one view/page shape that *does* answer `disabled`,
 * through its own `aliases: { disabled: 'readonly' }` row (`view.zod.ts`, the
 * comment at that site rejects shared-table filing for exactly this reason).
 * Adding `EDITABILITY_BOUNDARY_KEYS` to the shared options would land it on that
 * table too, and the consequences are not cosmetic:
 *
 * - `strictUnknownKeyError` consults exact `guidance` → `guidanceSets` →
 *   `aliases`, and a set match `continue`s past the rename. The field author who
 *   writes `disabled` would stop seeing *"Did you mean `disabled` → `readonly`?"*
 *   and start being told editability is somewhere else — on the one surface
 *   where it is right there.
 * - `alias-integrity.test.ts` would go **red**, not quietly wrong: its #7889
 *   check fails any alias row a guidanceSet on the same table already consumes.
 *
 * So the two visibility-only shapes take these options and `FormFieldSchema`
 * keeps the bare ones. The prescription text itself is written once, here.
 */
export const VISIBILITY_ONLY_STRICT_OPTIONS: StrictObjectOptions = {
  ...VISIBILITY_STRICT_OPTIONS,
  guidanceSets: [
    // Declaration order decides among sets. Nothing in
    // `EDITABILITY_BOUNDARY_KEYS` matches `VISIBILITY_KEY_PATTERN`
    // (`/vis|conceal|hidden|show.?when/i`), so the order is not load-bearing —
    // pinned in `editability-boundary.test.ts` so it cannot quietly become so.
    ...(VISIBILITY_STRICT_OPTIONS.guidanceSets ?? []),
    EDITABILITY_BOUNDARY_GUIDANCE,
  ],
};
