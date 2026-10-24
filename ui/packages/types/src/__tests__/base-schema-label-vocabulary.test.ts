// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `BaseSchema` label/state vocabulary, named and declared (objectui#4581).
 *
 * Sibling of `base-schema-visible-predicate.test.ts`, which pinned `visible`
 * in PR #4593. This file pins the three remaining slots that PR measured and
 * escalated, under the rulings recorded on objectui#4580 (comment 5284007579).
 *
 * ## `ariaLabel` declares the KEYED vocabulary (ruling Q2-B)
 *
 * `packages/react/src/SchemaRenderer.tsx:111` reads:
 *
 *   ```ts
 *   if (schema.ariaLabel) {
 *     aria['aria-label'] = resolveKeyedI18nLabel(schema.ariaLabel);
 *   }
 *   ```
 *
 * `resolveKeyedI18nLabel` (`packages/react/src/utils/i18n.ts`) accepts the
 * KEYED form — `{ key, defaultValue?, params? }`, a reference INTO a
 * translation bundle. It is NOT the spec's `I18nLabel`, which since
 * `@objectstack/spec` 17.0.0-rc.6 is the INLINE LOCALE MAP
 * `string | Record<string, string>` resolved by the spec's own
 * `resolveI18nLabel(label, locale)`.
 *
 * The original #4581 text asked for `string | I18nLabel`. PR #4593 measured
 * that spelling and it was wrong in three separate ways, which is why the
 * ruling withdrew it:
 *
 *   - the shipped keyed fixture `{ key, defaultValue }` was accepted *for the
 *     wrong reason* — as a locale map whose "locales" are named `key` and
 *     `defaultValue`;
 *   - the same keyed label carrying `params` was REJECTED
 *     (`Type '{ name: string; }' is not assignable to type 'string'`);
 *   - a genuine inline map `{ en: 'Owner' }` type-checked while
 *     `resolveKeyedI18nLabel` returns `undefined` for it at runtime, rendering
 *     an EMPTY `aria-label`.
 *
 * So the declared vocabulary here is the keyed one, and it gets a NAME —
 * `KeyedI18nLabel` — rather than a fourth inline copy of the same object
 * literal. The three that existed before this card
 * (`packages/react/src/utils/i18n.ts`, `packages/layout/src/NavigationRenderer.tsx`,
 * `packages/app-shell/src/utils/index.ts`) were verified byte-for-byte
 * identical in their object half before the name was minted.
 *
 * ## `disabled` accepts the predicate string (ruling Q3-A)
 *
 * Exactly the `visible` evidence, one slot over: `SchemaRenderer.tsx:466`
 * evaluates it through the same `evaluateCondition`
 * (`(condition: string | boolean | undefined, context?) => boolean`), and the
 * `disabledOn?: string` sibling exists for the same reason. The asymmetry with
 * `visible` was accidental, not deliberate.
 *
 * ## `label` / `description` — PIN MOVED (objectui#4580 revised Q1)
 *
 * ⚠️ **This section records a ruling that has since been REVISED, and the two
 * pins below moved with it. The history is kept rather than rewritten, because
 * the pins did exactly what they were built to do.**
 *
 * As written for #4581, these two slots STAYED `string` under ruling Q1-B: the
 * two spec bridges hand them the spec's INLINE `I18nLabel` (#4593's canary:
 * TS2322 at `list-view.ts:180` and `:224`), and Q1-B resolved that at the
 * BRIDGE rather than by widening the declarations. The note below read: *"a
 * future card that 'fixes' the bridge defect by widening `BaseSchema.label`
 * turns them red on purpose."*
 *
 * That is what happened, on the very next card. PR #4603's seat measured
 * Q1-B's premise FALSE on every leg — the bridge is a plain class method that
 * cannot call `useDisplayLocale()`, `BridgeContext` declares no locale,
 * `updateContext()` has zero callers, and `SpecBridge` has zero in-repo
 * production consumers — so resolving there would freeze one audience's
 * language into the node tree. The PM revised the ruling to **option A**
 * (comment 5284973826): `label`/`description` widen to `string | I18nLabel`
 * and resolution happens at READ time against the display locale.
 *
 * So these two pins turned red **on purpose, as designed**, and they are moved
 * here to pin the widened unions. Their value as a pin is unchanged: they are
 * still the ruling written down, just a different ruling — and the confusability
 * they now guard is larger, because `label`/`description` (INLINE map) and
 * `ariaLabel` (KEYED ref) now sit two properties apart on one interface.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * Against `origin/main` (`52d878a3b`), `tsc -p packages/types/tsconfig.test.json`
 * must report:
 *
 *   1. the `KeyedI18nLabel` import — TS2305, `Module '"../base"' has no
 *      exported member 'KeyedI18nLabel'` (the name does not exist yet).
 *   2. `keyedAriaLabelIsAuthorable` / `keyedAriaLabelWithParamsIsAuthorable` —
 *      TS2322, an object is not assignable to `string`. The explicit
 *      `ariaLabel?: string` member won over `BaseSchema`'s
 *      `[key: string]: any` index signature (removed by objectui#8347), which is
 *      precisely why the shipped
 *      fixture in `SchemaRenderer.aria.test.tsx` needed
 *      `as unknown as BaseSchema`.
 *   3. `disabledPredicateStringIsAuthorable` — TS2322, `Type 'string' is not
 *      assignable to type 'boolean | undefined'`.
 *   4. `assertionDisabled` — TS2344, `Type 'false' does not satisfy the
 *      constraint 'true'`.
 *   5. `assertionAriaLabel` and `assertionKeyedShape` — expected TS2344 as
 *      well, but for a DERIVED reason: after the TS2305 above, the unresolved
 *      import degrades to an error type, so what these two report pre-fix is
 *      not independent evidence. They are listed for completeness, and the
 *      load-bearing pre-fix reds are 1-4.
 *   6. `assertionLabel` / `assertionDescription` — NO error, pre-fix and
 *      post-fix. See the `label`/`description` section above.
 *      ⚠️ SUPERSEDED by #4580's revised Q1 — see the PIN MOVED record below.
 *
 * MEASURED (`52d878a3b`, before the fix) — 1, 2, 3, 4 and 6 held exactly:
 *
 * ```
 * base-schema-label-vocabulary.test.ts(103,27): error TS2305: Module '"../base"' has no exported member 'KeyedI18nLabel'.
 * base-schema-label-vocabulary.test.ts(120,3): error TS2344: Type 'false' does not satisfy the constraint 'true'.
 * base-schema-label-vocabulary.test.ts(130,3): error TS2344: Type 'false' does not satisfy the constraint 'true'.
 * base-schema-label-vocabulary.test.ts(143,3): error TS2322: Type '{ key: string; defaultValue: string; }' is not assignable to type 'string'.
 * base-schema-label-vocabulary.test.ts(149,3): error TS2322: Type '{ key: string; defaultValue: string; params: { name: string; }; }' is not assignable to type 'string'.
 * base-schema-label-vocabulary.test.ts(161,3): error TS2322: Type 'string' is not assignable to type 'boolean | undefined'.
 * ```
 *
 * Prediction 5 was half wrong, and it is left standing rather than rewritten to
 * match: `assertionKeyedShape` (120) DID report, but `assertionAriaLabel` (126)
 * reported NOTHING — TypeScript suppresses the cascade once the import is an
 * error type. Which is exactly why 5 was flagged as non-independent evidence in
 * advance: a pin whose pre-fix silence is a compiler artifact proves nothing on
 * its own. Its value is post-fix, where it pins the union for real.
 *
 * After the fix, all of it compiles clean (`tsc -p tsconfig.test.json`, exit 0).
 *
 * Every `Equal` below is INVARIANT for the reason
 * `base-schema-visible-predicate.test.ts` spells out and this card inherits: a
 * `satisfies`-style or one-way `extends` check is VACUOUS for a widening in
 * both directions — the narrow `string` is assignable to the wide
 * `string | KeyedI18nLabel`, so a widening that never happened AND a widening
 * that overshot to `any` would both stay green. `BaseSchema`'s
 * `[key: string]: any` made the overshoot live rather than hypothetical until
 * objectui#8347: deleting a declared property altogether left it typed `any`
 * and every fixture below still compiled.
 */

import { describe, it, expect } from 'vitest';
import type { BaseSchema, KeyedI18nLabel } from '../base';
// The INLINE vocabulary, bound from the spec by reference (never re-declared
// locally) — the same binding `packages/types/src/index.ts` re-exports.
import type { I18nLabel } from '@objectstack/spec/ui';
import type { ExpressionWire } from '../expression';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The named vocabulary is exactly the shape the resolver accepts ──────── */

/**
 * The census shape, spelled out literally rather than referenced, so this pin
 * fails if the named type ever drifts from what the three retired inline copies
 * agreed on and what `resolveKeyedI18nLabel` destructures.
 */
export type assertionKeyedShape = Expect<
  Equal< KeyedI18nLabel, { key: string; defaultValue?: string; params?: Record<string, any> } >
>;

/* ── The declared slots ──────────────────────────────────────────────────── */

export type assertionAriaLabel = Expect<
  Equal< BaseSchema['ariaLabel'], string | KeyedI18nLabel | undefined >
>;

// `boolean | string` until objectui#7530 declared the CEL envelope on all three
// predicate keys through the shared `ExpressionWire`.
export type assertionDisabled = Expect<
  Equal< BaseSchema['disabled'], boolean | ExpressionWire | undefined >
>;

/* ── PIN MOVED (objectui#4580 revised Q1) ────────────────────────────────── */

/**
 * **PIN MOVED (objectui#4580 revised Q1).** These two pinned
 * `BaseSchema['label' | 'description'] === string | undefined` under ruling
 * Q1-B, and turned red exactly as this file predicted when the revised ruling
 * (comment 5284973826) widened them instead. Measured red before the move,
 * verbatim:
 *
 * ```
 * base-schema-label-vocabulary.test.ts(153,38): error TS2344: Type 'false' does not satisfy the constraint 'true'.
 * base-schema-label-vocabulary.test.ts(154,44): error TS2344: Type 'false' does not satisfy the constraint 'true'.
 * ```
 *
 * They now pin the widened unions. `I18nLabel` is the spec's INLINE locale map
 * (`string | Record<string, string>` in `@objectstack/spec` 17.0.0-rc.6),
 * resolved at READ time by `resolveI18nLabel(label, locale)` — NOT
 * `ariaLabel`'s keyed `resolveKeyedI18nLabel`, two properties away on this same
 * interface.
 *
 * `Equal` is INVARIANT here for the reason PR #4593 spelled out and this file
 * inherits: a one-way `extends` is vacuous for a widening in BOTH directions —
 * the narrow `string` is assignable to the wide `string | I18nLabel`, so a
 * widening that never happened AND one that overshot to `any` would both stay
 * green. `BaseSchema`'s `[key: string]: any` made the overshoot live until
 * objectui#8347.
 */
export type assertionLabel = Expect<
  Equal< BaseSchema['label'], string | I18nLabel | undefined >
>;
export type assertionDescription = Expect<
  Equal< BaseSchema['description'], string | I18nLabel | undefined >
>;

/**
 * The two vocabularies do NOT collapse into each other. Without this, a future
 * edit that "simplified" `label` to `ariaLabel`'s union — or vice versa — would
 * leave both `Equal` pins above green while silently swapping which resolver
 * owns the slot. This is objectui#4167's confusability hazard, pinned.
 */
export type assertionVocabulariesAreDistinct = Expect<
  Equal< Equal< BaseSchema['label'], BaseSchema['ariaLabel'] >, false >
>;

/** The inline map an author writes into `label` — the spec producer's shape. */
export const inlineLocaleMapLabelIsAuthorable: BaseSchema = {
  type: 'test-widget',
  label: { en: 'Owner', 'zh-CN': '负责人' },
  description: { en: 'Record owner', 'zh-CN': '记录所有者' },
};

/** A plain string stays authorable in both slots — the widening ADDS, never replaces. */
export const plainStringLabelIsStillAuthorable: BaseSchema = {
  type: 'test-widget',
  label: 'Owner',
  description: 'Record owner',
};

/* ── Authorable fixtures ─────────────────────────────────────────────────── */

/** The exact shape the shipped aria fixture had to cast past. */
export const keyedAriaLabelIsAuthorable: BaseSchema = {
  type: 'test-widget',
  ariaLabel: { key: 'dialog.close', defaultValue: 'Close dialog' },
};

/** `params` — the limb the withdrawn `string | I18nLabel` spelling REJECTED. */
export const keyedAriaLabelWithParamsIsAuthorable: BaseSchema = {
  type: 'test-widget',
  ariaLabel: { key: 'greeting.hello', defaultValue: 'Hello, {{name}}', params: { name: 'Ada' } },
};

/** The plain string form is untouched — this is a widening, not a replacement. */
export const plainAriaLabelIsStillAuthorable: BaseSchema = {
  type: 'test-widget',
  ariaLabel: 'Close dialog',
};

/** The capability `SchemaRenderer.tsx:466` implements, now declared. */
export const disabledPredicateStringIsAuthorable: BaseSchema = {
  type: 'test-component',
  disabled: '${data.status === "locked"}',
};

/** The boolean form is untouched. */
export const disabledBooleanIsStillAuthorable: BaseSchema = {
  type: 'test-component',
  disabled: true,
};

/* ── Runtime companion ───────────────────────────────────────────────────── */

describe('BaseSchema label vocabulary (objectui#4581)', () => {
  it('type-level: ariaLabel is string | KeyedI18nLabel, disabled is boolean | string', () => {
    // Erased at runtime; `tsc -p tsconfig.test.json` is the checker, chained
    // from this package's `type-check` script. The runtime case exists so a
    // green vitest run is not mistaken for the proof.
    expect((keyedAriaLabelWithParamsIsAuthorable.ariaLabel as KeyedI18nLabel).params).toEqual({
      name: 'Ada',
    });
    expect(plainAriaLabelIsStillAuthorable.ariaLabel).toBe('Close dialog');
    expect(disabledPredicateStringIsAuthorable.disabled).toBe('${data.status === "locked"}');
    expect(disabledBooleanIsStillAuthorable.disabled).toBe(true);
  });
});
