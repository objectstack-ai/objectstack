// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Translation Type Generation Utilities
 *
 * Provides strict TypeScript types that enforce translation completeness
 * at compile time. Use with `satisfies` to ensure every field and every
 * select option in an object definition has a corresponding translation.
 *
 * @example
 * ```typescript
 * import type { StrictObjectTranslation } from '@objectstack/spec/system';
 * import { Task } from '../objects/task.object';
 *
 * type TaskTranslation = StrictObjectTranslation<typeof Task>;
 *
 * const zhTask = {
 *   label: '任务',
 *   fields: {
 *     subject: { label: '主题' },
 *     status: { label: '状态', options: { not_started: '未开始', ... } },
 *     // ... every field must be present
 *   },
 * } satisfies TaskTranslation;
 * ```
 */

// ────────────────────────────────────────────────────────────────────────────
// Option Value Extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the union of option `value` literals from a field definition.
 *
 * Works with:
 * - Inline readonly tuples: `{ options: readonly [{ value: 'a' }, { value: 'b' }] }`
 * - Mutable arrays: `{ options: Array<{ value: string }> }`
 * - Field.select() output
 */
type ExtractOptionValues<F> =
  F extends { options: ReadonlyArray<infer O> }
    ? O extends { value: infer V extends string } ? V : never
    : never;

// ────────────────────────────────────────────────────────────────────────────
// Per-Field Translation Shape
// ────────────────────────────────────────────────────────────────────────────

/**
 * Base translation properties for any field.
 */
interface BaseFieldTranslation {
  label: string;
  help?: string;
  placeholder?: string;
}

/**
 * Translation shape for a select/multiselect field.
 * Requires `options` to map **every** option value to a translated string.
 */
interface SelectFieldTranslation<Values extends string> extends BaseFieldTranslation {
  options: Record<Values, string>;
}

/**
 * Determines the correct translation shape for a field.
 * - Fields with `options` → requires `options` map with all values
 * - Other fields → only `label` (+ optional help/placeholder)
 */
type FieldTranslationFor<F> =
  [ExtractOptionValues<F>] extends [never]
    ? BaseFieldTranslation
    : SelectFieldTranslation<ExtractOptionValues<F>>;

// ────────────────────────────────────────────────────────────────────────────
// Object-Level Strict Translation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Requires a translation entry for **every** field key in `Fields`.
 * The `-?` modifier removes optionality — each field is mandatory.
 */
type StrictFieldTranslations<Fields> = {
  [K in keyof Fields]-?: FieldTranslationFor<Fields[K]>;
};

/**
 * Strict translation type for a full object definition.
 *
 * Given an object type `Obj` with a `fields` record, derives
 * a translation type where:
 * - `label` is required
 * - `pluralLabel` is optional
 * - Every field key becomes a required entry in `fields`
 * - Select fields additionally require an `options` map covering all values
 *
 * @typeParam Obj - The object definition type (e.g. `typeof Task`)
 *
 * @example
 * ```typescript
 * type TaskTranslation = StrictObjectTranslation<typeof Task>;
 * // TaskTranslation.fields.status.options must include all 5 status values
 * ```
 */
export type StrictObjectTranslation<Obj extends { fields: Record<string, unknown> }> = {
  label: string;
  pluralLabel?: string;
  fields: StrictFieldTranslations<Obj['fields']>;
  /**
   * View translations keyed by view name — the `_views` slot
   * `ObjectTranslationDataSchema` already permits. Not derivable from `Obj`
   * (views are declared separately from the object), so it stays optional and
   * loosely keyed rather than enumerated like `fields`. Without it, `satisfies
   * StrictObjectTranslation<…>` rejects the very translations the view
   * coverage gate asks for.
   */
  _views?: Record<
    string,
    {
      label?: string;
      description?: string;
      emptyState?: { title?: string; message?: string };
    }
  >;
};
