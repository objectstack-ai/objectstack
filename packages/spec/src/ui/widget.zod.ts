// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FieldSchema } from '../data/field.zod';
import { lazySchema } from '../shared/lazy-schema';

// ⛔ This file used to declare a WIDGET-REGISTRATION vocabulary as well. It no
// longer does, and the two halves are worth telling apart before you add to it.
//
// `WidgetManifestSchema` / `WidgetLifecycleSchema` / `WidgetEventSchema` /
// `WidgetPropertySchema` / `WidgetSourceSchema` (with its three `npm` / `remote`
// / `inline` branches) were REMOVED per ADR-0049 enforce-or-remove (#5055,
// maintainer ruling 2026-08-06, window moved to protocol 17 on 2026-08-07).
// Together they were 8 of the 9 sites #4001 批 16 measured in this file, and the
// measurement — re-run on `origin/main` immediately before the removal, controls
// passing in the same run — said the same three things every time:
//
//  1. **No carrier key.** Nothing under `packages/spec/src` imported this module
//     except the `ui/index.ts` barrel, so no schema anywhere declared a key
//     whose value was a widget shape. `field.widget` is a `z.string()` naming a
//     REGISTERED COMPONENT and has never referenced `WidgetManifest`.
//  2. **Unreachable.** A BFS from all 24 metadata-type roots plus `defineStack`'s
//     `ObjectStackSchema` reached none of them, while `PageSchema` /
//     `ObjectListViewSchema` resolved `direct` in the same run and a synthetic
//     carrier flipped every one of them to reachable.
//  3. **Zero parse.** No `.parse()` / `.safeParse()` on any of them in
//     objectstack / objectui / cloud outside this file's own unit tests.
//
// So the published vocabulary described a widget-registration capability the
// platform does not have: a manifest nobody could author, lifecycle hooks
// nobody would run, an implementation-source union nothing would load. That is
// the #3950 shape at its most inviting to an AI author (ADR-0033). objectui's
// widget registry has ALWAYS had its own runtime manifest — `RuntimeWidgetManifest`
// / `RuntimeWidgetSource` in `@object-ui/types` (objectui#3161, #4115) — and it
// models different keys (`source`, `defaultProps`, `inputs`, `isContainer`,
// `capabilities`); it never derived from these.
//
// ⚠️ Route 3 of the retirement playbook ("nothing parses it → neither"): with no
// carrier key there is no shape for a `retiredKey()` tombstone to sit on and no
// author document for a D2 conversion to rewrite. `WidgetManifest.performance`'s
// own tombstone (#3896) went with the shape that carried it — strictly stronger
// than the tombstone, since there is no longer a manifest to author it INTO. The
// declared record is the D3 `SemanticMigration` `ui-widget-i18n-family-retired`
// plus `RETIRED_DEFS_BY_MAJOR`. Same shape as #4988 (batch 13's 22 sites) and
// #4834 (kernel plugin-runtime family).
//
// Widget registration as protocol metadata returns via the ENFORCE route of
// ADR-0049 through a new ADR — registry and loader first, vocabulary second.
//
// ─────────────────────────────────────────────────────────────────────────────
// `FieldWidgetPropsSchema` SURVIVES, and it is not an oversight — it is the one
// site of the nine whose evidence differs (#5055 comment, 2026-08-06 11:40).
//
// It is not authorable metadata at all: it never appears in
// `authorable-surface/` or `json-schema.manifest/` (its `onChange` is a
// `z.function()`, so no JSON Schema is emitted), and it is a REACT PROPS
// CONTRACT — a thing that is implemented by a component, not parsed from a
// document. "Zero `.parse()`" is its design, not its defect, so the
// enforce-or-remove question ADR-0049 asks of an unenforced authorable key does
// not bind it.
//
// And it has a live reader. objectui PR #3289 (merged 2026-08-03, one day before
// 批 16's measurement) resolved objectui#3222 in the direction the contract
// points: `@object-ui/fields` renamed its validation slot from `errorMessage` to
// the spec's `error` with no alias, the form renderer started producing it, and
// `packages/fields/src/__tests__/spec-symbol-batch7.test.ts` pinned all of it
// against `import type { FieldWidgetProps } from '@objectstack/spec/ui'` —
// deliberately, so that "the day the spec stops exporting `FieldWidgetProps`,
// this file stops compiling and the rename's reason is up for re-triage". That
// is a cross-repo, compile-time consumer of this exact shape, and `tsc` is where
// a props contract is enforced. Verified on objectui `origin/main` 2026-08-07.
//
// Before retiring it, re-measure THAT — not this file's parse count.

/**
 * Field Widget Props Schema
 *
 * This defines the contract for custom field components and plugin UI extensions.
 * Third-party developers use this interface to build custom field widgets that integrate
 * seamlessly with the ObjectStack UI system.
 *
 * @example
 * // Custom widget implementation
 * function CustomDatePicker(props: FieldWidgetProps) {
 *   const { value, onChange, readonly, required, error, field, record, options } = props;
 *   // Widget implementation...
 * }
 */
export const FieldWidgetPropsSchema = lazySchema(() => z.object({
  /**
   * Current field value.
   * Type depends on the field type (string, number, boolean, array, object, etc.)
   */
  value: z.unknown().describe('Current field value'),

  /**
   * Callback function to update the field value.
   * Should be called when user interaction changes the value.
   *
   * @param newValue - The new value to set
   */
  onChange: z.function()
    .input(z.tuple([z.unknown()]))
    .output(z.void())
    .describe('Callback to update field value'),

  /**
   * Whether the field is in read-only mode.
   * When true, the widget should display the value but not allow editing.
   */
  readonly: z.boolean().default(false).describe('Read-only mode flag'),

  /**
   * Whether the field is required.
   *
   * The required MARKER (the `*`) is owned by the host's field label, not by
   * the widget — a widget that draws its own produces two markers for one
   * field (objectui#3222, landed in objectui#3289). Validation is likewise the
   * host's: it owns the form state that decides whether the field passes.
   *
   * A widget reflects the state on the control it renders, via
   * `aria-required` — `AriaAttributes` already declares that key, so this
   * needs no additional contract key (objectui#3290).
   */
  required: z.boolean().default(false).describe('Required field flag'),

  /**
   * The active validation message for this field; `undefined` while the field
   * is valid.
   *
   * Consumed as a SIGNAL, not as content: a widget reads it only to drive
   * `aria-invalid` on the control it renders, which is the one element the
   * host cannot reach. The message TEXT is rendered by the host's form message
   * slot (`FormMessage` in objectui); a widget that renders it too
   * double-displays it (objectui#3222, landed in objectui#3289).
   */
  error: z.string().optional().describe('Validation error message'),

  /**
   * Complete field definition from the schema.
   * Contains metadata like type, constraints, options, etc.
   */
  field: FieldSchema.describe('Field schema definition'),

  /**
   * The complete record/document being edited.
   * Useful for conditional logic and cross-field dependencies.
   */
  record: z.record(z.string(), z.unknown()).optional().describe('Complete record data'),

  /**
   * Custom options passed to the widget.
   * Can contain widget-specific configuration like themes, behaviors, etc.
   */
  options: z.record(z.string(), z.unknown()).optional().describe('Custom widget options'),
}));

/**
 * TypeScript type for Field Widget Props
 */
export type FieldWidgetProps = z.input<typeof FieldWidgetPropsSchema>;
/** Post-parse shape of {@link FieldWidgetProps} — defaults applied, transforms run (ADR-0122). */
export type FieldWidgetPropsParsed = z.infer<typeof FieldWidgetPropsSchema>;
