// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The section / page-component **editability boundary** (#7887)
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
 * {@link VISIBILITY_STRICT_OPTIONS} for the two shapes that gate visibility and
 * **nothing else** — `FormSectionSchema` and `PageComponentSchema`.
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
