// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Expression-bindable text keys — the CLOSED vocabulary of top-level text keys
 * a SchemaRenderer evaluation memo evaluates, and the per-component carriage
 * map that says which component types carry which of them.
 *
 * ## Provenance (not re-litigable here)
 *
 * objectui#4795 measured the hole: apart from `content`, no top-level text key
 * on a rendered SDUI node was BOTH evaluated by the renderer's expression memo
 * AND read back by the component renderer — `statistic.value: '${data.n}'`
 * rendered the literal `${data.n}`, and the `props`-envelope workaround
 * rendered blank. The 2026-08-17 maintainer ruling on that card deferred the
 * fix (Direction 1) behind a restart condition and pre-defined its terms,
 * verbatim: *"the key set is declared in `@objectstack/spec`/types as a closed
 * enum, never inferred"*. On 2026-08-18 the maintainer ruled the restart
 * condition met by product intent (a metadata-authored live dashboard is a
 * basic requirement), reopening Direction 1 on those terms. This module is the
 * spec half (objectstack#9599); the objectui half extends the evaluation memo
 * to CONSUME these exports (it rides objectui#4795) instead of hard-coding a
 * twin list.
 *
 * Related, and deliberately out of this module's reach:
 *
 *   - ⛔ Direction 2 (merging the `props` envelope into the node) is
 *     permanently rejected (same 08-17 ruling) — nothing here re-legalizes the
 *     envelope shape the objectui#4786 teaching rewrite retired.
 *   - `content` is NOT a member. It already has its own evaluation leg in the
 *     memo and its own read-back contract; adding it here would give one key
 *     two declared evaluation paths.
 *   - The `properties` / `props` config bags are evaluated per-value by their
 *     own memo legs (objectui#4799 / #5122) — this vocabulary is only about
 *     keys authored at the NODE'S TOP LEVEL.
 *
 * ## The contract
 *
 * For a component type with a row in
 * {@link EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT}, the renderer's
 * evaluation memo evaluates exactly the listed keys (when the authored value
 * is an expression-bearing string); every other key stays inert text. For a
 * component type with NO row, the answer is the empty set — closed and
 * mechanically answerable in both directions, never inferred from what a
 * renderer happens to read.
 *
 * ## Why these rows (measured, not inferred)
 *
 * Rows are a RECORD of what each component renderer already reads back from
 * the node's top level, measured at the objectui pin (`.objectui-sha`
 * `82a9417`, re-verified identical at objectui `origin/main` `6c68b13` on
 * 2026-08-18) — declaring a key a renderer does not read back would recreate
 * the evaluated-but-blank half of the objectui#4795 table:
 *
 *   | type        | renderer read points (top level, within the closed set) |
 *   |-------------|----------------------------------------------------------|
 *   | `statistic` | `schema.label`, `schema.value`, `schema.description` (`data-display/statistic.tsx`) |
 *   | `card`      | `schema.title`, `schema.description` (`layout/card.tsx`) |
 *   | `button`    | `schema.label` (`form/button.tsx`, `action/action-button.tsx`) |
 *
 * These are the measured motivating cases from objectui#4795 (dashboard
 * workhorses). Other registered renderers also read keys from this closed set
 * at the top level (`alert`/`empty`/`dialog` `title`+`description`, `badge`
 * `label`, form inputs' `value`/`label`, …) — those rows are deliberately NOT
 * declared yet: form-control `value` is interactive state rather than display
 * text, and each row is an accept-surface widening that should arrive with its
 * own measurement, not ride this one (startup scope discipline). Adding a row
 * is additive and spec-first; do it here, never as a renderer-side inference.
 */

import { z } from 'zod';

/**
 * The closed key vocabulary, per the 08-17 ruling's terms. Order is the
 * ruling's own listing order; the enum is CLOSED — growing it is a maintainer
 * decision (a new ruling), not a patch.
 */
export const EXPRESSION_BINDABLE_TEXT_KEYS = [
  'title',
  'label',
  'value',
  'description',
] as const;

export type ExpressionBindableTextKey =
  (typeof EXPRESSION_BINDABLE_TEXT_KEYS)[number];

/** Validating face of the closed vocabulary. */
export const ExpressionBindableTextKeySchema = z
  .enum(EXPRESSION_BINDABLE_TEXT_KEYS)
  .describe(
    'One of the closed set of expression-bindable text keys — the top-level node keys a SchemaRenderer evaluation memo may evaluate (objectui#4795 Direction 1; carriage per component type is EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT).'
  );

export function isExpressionBindableTextKey(
  key: string
): key is ExpressionBindableTextKey {
  return (EXPRESSION_BINDABLE_TEXT_KEYS as readonly string[]).includes(key);
}

/**
 * Component type → the subset of {@link EXPRESSION_BINDABLE_TEXT_KEYS} its
 * renderer both evaluates and reads back. Runtime-readable on purpose: the
 * objectui memo consumes this map (via {@link expressionBindableTextKeysFor}),
 * it does not keep a twin list. Frozen — the map IS the contract, and a
 * consumer mutating its copy would fork it silently.
 */
export const EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT = Object.freeze({
  statistic: Object.freeze(['label', 'value', 'description'] as const),
  card: Object.freeze(['title', 'description'] as const),
  button: Object.freeze(['label'] as const),
}) satisfies Readonly<
  Record<string, readonly ExpressionBindableTextKey[]>
>;

const NO_EXPRESSION_BINDABLE_TEXT_KEYS: readonly ExpressionBindableTextKey[] =
  Object.freeze([]);

/**
 * The mechanical per-component answer: which of the closed keys does the
 * evaluation memo evaluate for `componentType`? Unlisted types get the frozen
 * empty set — that IS the contract for them (closed, never inferred), not a
 * tolerant fallback. Guarded with an own-property check so prototype-chain
 * names (`'constructor'`, `'toString'`, …) arriving as author-controlled type
 * strings cannot answer with a function off `Object.prototype`.
 */
export function expressionBindableTextKeysFor(
  componentType: string
): readonly ExpressionBindableTextKey[] {
  if (
    Object.prototype.hasOwnProperty.call(
      EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT,
      componentType
    )
  ) {
    return EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT[
      componentType as keyof typeof EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT
    ];
  }
  return NO_EXPRESSION_BINDABLE_TEXT_KEYS;
}
