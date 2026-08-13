// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The **editability boundary** on the shapes that have no editability (#7887,
 * #8201)
 *
 * Maintainer ruling, 2026-08-12: `FormSectionSchema` (`ui/view.zod.ts`) and
 * `PageComponentSchema` (`ui/page.zod.ts`) gate **visibility only**; editability
 * lives on fields. No `disabled` / `readonly` / `readonlyWhen` slot is added to
 * either shape, and no alias row is registered for them — an alias names a key
 * the shape must then accept, and one the runtime does not honour is the
 * ADR-0049 declared-but-unenforced class this repo is retiring elsewhere.
 *
 * What the ruling *does* buy the author is this module: the rejection stops
 * being bare and starts naming where the key belongs.
 *
 * ## The third shape — `SelectOptionSchema` (#8201)
 *
 * `data/field.zod.ts`'s `SelectOptionSchema` was outside the ruling's scope, so
 * #8199 left it bare while its two siblings gained the prescription. It has the
 * ruling now, on a **re-measured** version of the ruling's own premise rather
 * than by analogy — the premise that carries it is "no editability semantics
 * exist here to enforce", and for an option that is a fact about the renderer,
 * not an argument. Measured on objectui `origin/main` @ `aca27fa`: the
 * object-field pipeline these options actually feed has **zero** per-option
 * `disabled` consumers — `packages/fields/src/widgets/SelectField.tsx:161`
 * calls the root-level `disabled` "the single authority" in its own comment,
 * and `RadioField.tsx:124` reads only `props.disabled`. A shown-but-unselectable
 * option does exist in objectui's **SDUI** family
 * (`packages/components/src/renderers/form/select.tsx:62`), but on that
 * package's own select-option vocabulary in `packages/types` — a different
 * shape from this one, so it makes no key here enforced.
 *
 * The prescription it gets is NOT the siblings' text, because the siblings'
 * destination does not exist here: a section's answer is "write `readonly` on
 * the fields inside", and an option has nothing inside it. Its answer is to
 * withdraw the option itself, which per-option `visibleWhen` really does
 * (ADR-0068 binds `current_user` on that surface, and the rule validator
 * refuses a write of a value whose predicate is false) — see
 * {@link SELECT_OPTION_EDITABILITY_GUIDANCE}.
 *
 * **What is true today, not forever.** Triage left real product pull for
 * non-selectable field options open as a maintainer decision that would widen
 * the accepted set. Both prescriptions below say what the platform reads today
 * and why; neither claims the answer can never change, and the way to change it
 * is a spec decision, not a key an author writes.
 *
 * ## Package-internal on purpose — this module is NOT in `shared/index.ts`
 *
 * It sits beside `strict-object.ts` and `alias-probe.ts` in the set of shared
 * modules the barrel deliberately does not re-export. An unknown-key options
 * table is machinery for declaring schemas in *this* package, and its own type
 * (`StrictObjectOptions`) is not public either — a published const of an
 * unpublishable type is an export no consumer can even annotate.
 *
 * It also keeps the #7887 claim exactly true: the card's whole deliverable is
 * that nothing observable moves except the sentence an author reads, and the
 * package's public API surface (`check:api-surface`) does not move at all.
 */

import type { StrictObjectOptions } from './strict-object';
import type { KeySetGuidance } from './suggestions.zod';
import { VISIBILITY_STRICT_OPTIONS } from './visibility';

/**
 * The editability vocabulary an author reaches for on a shape that gates
 * **visibility only**.
 *
 * Every spelling here is rejected by `FormSectionSchema`, `PageComponentSchema`
 * and — since #8201 — `SelectOptionSchema` today, and stays rejected: this set
 * changes the MESSAGE, never the verdict. `readOnly` sits alongside `readonly`
 * because set membership is matched case-sensitively (the rename channel is
 * what folds case, and a set match `continue`s past it).
 *
 * One list, two prescriptions ({@link EDITABILITY_BOUNDARY_GUIDANCE} for the
 * containers, {@link SELECT_OPTION_EDITABILITY_GUIDANCE} for an option): the
 * vocabulary an author reaches for is the same everywhere, so a spelling added
 * here is answered on every shape that has no editability semantics, while the
 * answer stays specific to the shape that gives it.
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
 * The ruling rendered as the thing an author actually reads: **boundary, not
 * gap.**
 *
 * Deliberately points at **`readonlyWhen`** and not at `disabledWhen`:
 * `field.zod.ts` renames `disabled → readonly` and records in its own comment
 * that "a field has `readonlyWhen`, not `disabledWhen`" (#7832). Naming
 * `disabledWhen` here would send an author to a key that exists on no field
 * surface at all — a rejection that hands them their next rejection.
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
 * The same ruling on `SelectOptionSchema`, with the destination that is true for
 * an OPTION rather than the one that is true for a container (#8201).
 *
 * Shares {@link EDITABILITY_BOUNDARY_KEYS} — one vocabulary, so a spelling
 * added to the family is answered on every shape that has no editability — and
 * nothing else: the prescription is written per-shape because the *answer* is
 * per-shape. A section's is "put the key on the fields inside"; an option has
 * no inside, so its answer is to withdraw the option.
 *
 * Filed on the option's own table (`data/field.zod.ts`) rather than shared with
 * the two view/page shapes for the placement reason #8199 established: a shared
 * table may carry only what is true of all its consumers, and this text is true
 * of exactly one of them. It cannot collide with that table's rename channel
 * either — `SelectOptionSchema`'s aliases answer `text` / `name` / `title` /
 * `key` / `id` / `isDefault` / `selected` / `colour` / `visible` / `showWhen`,
 * and no member of this set is among them, so no alias row is consumed
 * (`alias-integrity.test.ts`'s #7889 reachability check).
 */
export const SELECT_OPTION_EDITABILITY_GUIDANCE: KeySetGuidance = {
  name: 'SELECT_OPTION_EDITABILITY_BOUNDARY_KEYS',
  keys: EDITABILITY_BOUNDARY_KEYS,
  prescription:
    'Editability is not a per-OPTION concern — a deliberate boundary, not a missing '
    + 'key (#8201): an option declares WHICH value may be picked and WHEN it is offered, '
    + 'and nothing in the field pipeline reads a per-option enabled/disabled flag today '
    + '(the select and radio widgets treat the FIELD-level state as the single '
    + 'authority), so a key here would be metadata the renderer never honours '
    + '(ADR-0049). To withdraw ONE option, give it the per-option `visibleWhen` '
    + 'predicate — the one `*When` surface that also binds `current_user` (ADR-0068), '
    + 'so an option can be withheld per record or per role, and the rule validator '
    + 'refuses a write of a value whose predicate is false. To freeze the WHOLE picker, '
    + 'write `readonly: true` (or the conditional `readonlyWhen` predicate) on the field '
    + 'that owns these options. If a shown-but-unselectable option ever earns a reader, '
    + 'that is a spec decision to ask for — not a key to write here.',
};

/**
 * {@link VISIBILITY_STRICT_OPTIONS} for the two shapes that gate visibility and
 * **nothing else** — `FormSectionSchema` and `PageComponentSchema`.
 *
 * ⚠️ Carries the family's `surface` string, which both consumers **override**
 * with their own name (`'this form section'` / `'this page component'`, #8202):
 * this table is shared by two shapes, so it can no more carry one shape's name
 * than the table above it can carry one shape's prescription. Pinned in
 * `editability-boundary.test.ts` so a third consumer cannot inherit the family
 * string in silence.
 *
 * ## Why the boundary prescription is filed HERE and not in the shared table
 *
 * `VISIBILITY_STRICT_OPTIONS` has **three** consumers, and the third —
 * `FormFieldSchema` — is the one view/page shape that *does* answer `disabled`,
 * through its own `aliases: { disabled: 'readonly' }` row (`view.zod.ts`, whose
 * comment at that site rejects shared-table filing for exactly this reason).
 * Adding `EDITABILITY_BOUNDARY_KEYS` to the shared options would land it on that
 * table too, and the consequences are not cosmetic:
 *
 * - `strictUnknownKeyError` consults exact `guidance` → `guidanceSets` →
 *   `aliases`, and a set match `continue`s past the rename. The field author who
 *   writes `disabled` would stop seeing *"Did you mean `disabled` → `readonly`?"*
 *   and start being told editability is somewhere else — on the one surface
 *   where it is right there.
 * - `alias-integrity.test.ts` would go **red**, not quietly wrong, in two
 *   places: its #7889 check fails any alias row a guidanceSet on the same table
 *   already consumes, and its #6619 check fails a set member the shape
 *   *declares* — which `readonly` is, on `FormFieldSchema`.
 *
 * So the two visibility-only shapes take these options and `FormFieldSchema`
 * keeps the bare ones. The prescription text is written once, here.
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
