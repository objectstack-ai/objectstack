// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The import-coercion vocabulary** (#4173, closing out #3786).
 *
 * Two ends re-check the same contract: the server's `/import` coercion
 * (`import-coerce.ts` in `@objectstack/rest`) decides what a spreadsheet cell
 * may contain, and objectui's Import Wizard preview re-checks it client-side so
 * a cell is flagged red exactly when the server would reject it. Until #4173
 * the token tables lived only in the server file, so the preview carried a
 * hand-copy behind a pinned-inventory tripwire — the last hand-copied list the
 * #3786 sweep left standing, guarded but not derived.
 *
 * Constants only — the coercion LOGIC (trimming, number handling, id
 * resolution) stays in `@objectstack/rest`, per the no-business-logic rule for
 * this package. Every token here must be lower-case and trimmed, because both
 * consumers compare after `trim().toLowerCase()`; `import-coercion.test.ts`
 * enforces that, plus disjointness of the two boolean sets.
 */

import { REFERENCE_VALUE_TYPES } from './field-value.zod';

/**
 * Truthy tokens the boolean cell coercion accepts (compared after
 * `trim().toLowerCase()`). The Chinese and check-mark entries exist because
 * real spreadsheets carry 是/对 and ✓/√ — see the server's `parseBooleanCell`.
 */
export const IMPORT_BOOLEAN_TRUE_TOKENS: ReadonlySet<string> = new Set([
  'true', 't', 'yes', 'y', '1', 'on', '是', '对', '✓', '√',
]);

/** Falsy tokens the boolean cell coercion accepts. */
export const IMPORT_BOOLEAN_FALSE_TOKENS: ReadonlySet<string> = new Set([
  'false', 'f', 'no', 'n', '0', 'off', '否', '错', '✗', '×',
]);

/**
 * Field types the server resolves from display text to record ids during
 * `/import` — the spec's reference-shaped value types plus the generic
 * `'reference'` spelling legacy metadata still carries. Both ends used to
 * append `'reference'` to {@link REFERENCE_VALUE_TYPES} themselves; publishing
 * the completed set retires those two literals.
 */
export const IMPORT_REFERENCE_TYPES: ReadonlySet<string> = new Set([
  ...REFERENCE_VALUE_TYPES,
  'reference',
]);
