// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FieldSchema } from '../data/field.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { retiredKey } from '../shared/retired-key';

// ⛔ #4001 批 16 — EVERY shape in this file is `no door`. Do NOT `.strict()` them.
//
// The ledger scheduled this file as `authorable (p)` / 9 sites. Resolving the
// `(p)` found no authoring door at all, measured three independent ways on
// 2026-08-04, with positive AND negative controls in the same run:
//
//  1. **No carrier key.** Nothing under `packages/spec/src` imports this module
//     except the `ui/index.ts` barrel, so no schema anywhere declares a key
//     whose value is a widget shape. `field.widget` is a `z.string()` naming a
//     registered *component*; it has never referenced `WidgetManifest`.
//  2. **Unreachable.** A BFS over this build's in-memory Zod graph from all 24
//     metadata-type roots plus `defineStack`'s `ObjectStackSchema` (4 766 nodes)
//     reaches none of them, while `PageSchema` / `ObjectListViewSchema` resolve
//     in the same run and a synthetic carrier flips every one of them to
//     reachable — so the verdict is a fact about the graph, not a broken walker.
//  3. **Never parsed.** No `.parse()` / `.safeParse()` on any of these exists in
//     `objectstack`, `objectui` or `cloud` outside this file's own unit tests.
//     objectui re-exports the inferred TYPES only, under different names
//     (`RuntimeWidgetManifest` / `FieldWidgetComponentProps`, #4115 / #3161).
//
// `.strict()` is a property of a PARSE. With no parse it enforces nothing and
// only makes a dead slot look load-bearing — "a precisely validated dead slot,
// the more convincing lie" (#4583). The live question here is ADR-0049
// enforce-or-remove, filed as #5055 (same class as #4988), NOT this ratchet.
//
// ⚠️ The campaign's own BFS reported `WidgetManifestSchema` as REACHABLE on the
// first run. That was a false positive in the walker's derived-clone bridge, not
// a door: zod's `.describe()` returns a clone that SHARES the original `_zod.def`
// object, so `WidgetManifestSchema.name` (a described `SnakeCaseIdentifierSchema`)
// and `.label` (a described `I18nLabelSchema`) are def-identical to the same
// leaves on live schemas, and a bridge that fires on ANY one shared property
// under a shared name links two unrelated shapes. Filed as #5056; `widget.test.ts`
// pins the corrected (whole-shape overlap) form. Same verdict recorded in the
// ui/ row of `docs/audits/2026-07-unknown-key-strictness-ledger.md`.

/**
 * Widget Lifecycle Hooks Schema
 * 
 * Defines lifecycle callbacks for custom widgets inspired by Web Components and React.
 * These hooks allow widgets to perform initialization, cleanup, and respond to changes.
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_components
 * @see https://react.dev/reference/react/Component#component-lifecycle
 * 
 * @example
 * ```typescript
 * const widget = {
 *   lifecycle: {
 *     onMount: "console.log('Widget mounted')",
 *     onUpdate: "if (prevProps.value !== props.value) { updateUI() }",
 *     onUnmount: "cleanup()",
 *     onValidate: "return value.length > 0 ? null : 'Required field'"
 *   }
 * }
 * ```
 */
import { lazySchema } from '../shared/lazy-schema';
export const WidgetLifecycleSchema = lazySchema(() => z.object({
  /**
   * Called when widget is mounted/rendered for the first time
   * Use for initialization, setting up event listeners, loading data, etc.
   * 
   * @example "initializeDatePicker(); loadOptions();"
   */
  onMount: z.string().optional().describe('Initialization code when widget mounts'),

  /**
   * Called when widget props change
   * Receives previous props for comparison
   * 
   * @example "if (prevProps.value !== props.value) { updateDisplay() }"
   */
  onUpdate: z.string().optional().describe('Code to run when props change'),

  /**
   * Called when widget is about to be removed from DOM
   * Use for cleanup, removing event listeners, canceling timers, etc.
   * 
   * @example "destroyDatePicker(); cancelPendingRequests();"
   */
  onUnmount: z.string().optional().describe('Cleanup code when widget unmounts'),

  /**
   * Custom validation logic for this widget
   * Should return error message string if invalid, null/undefined if valid
   * 
   * @example "return value && value.length >= 10 ? null : 'Minimum 10 characters'"
   */
  onValidate: z.string().optional().describe('Custom validation logic'),

  /**
   * Called when widget receives focus
   * 
   * @example "highlightField(); logFocusEvent();"
   */
  onFocus: z.string().optional().describe('Code to run on focus'),

  /**
   * Called when widget loses focus
   * 
   * @example "validateField(); saveFieldState();"
   */
  onBlur: z.string().optional().describe('Code to run on blur'),

  /**
   * Called on any error in the widget
   * 
   * @example "logError(error); showErrorNotification();"
   */
  onError: z.string().optional().describe('Error handling code'),
}));

export type WidgetLifecycle = z.infer<typeof WidgetLifecycleSchema>;

/**
 * Widget Event Schema
 * 
 * Defines custom events that widgets can emit, inspired by DOM Events and Lightning Web Components.
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/Events/Creating_and_triggering_events
 * @see https://developer.salesforce.com/docs/component-library/documentation/en/lwc/lwc.events
 * 
 * @example
 * ```typescript
 * const searchEvent = {
 *   name: 'search',
 *   bubbles: true,
 *   cancelable: false,
 *   payload: {
 *     query: 'string',
 *     filters: 'object'
 *   }
 * }
 * ```
 */
export const WidgetEventSchema = lazySchema(() => z.object({
  /**
   * Event name
   * Should be lowercase, dash-separated for consistency
   * 
   * @example "value-change", "item-selected", "search-complete"
   */
  name: z.string().describe('Event name'),

  /**
   * Event label for documentation
   */
  label: I18nLabelSchema.optional().describe('Human-readable event label'),

  /**
   * Event description
   */
  description: I18nLabelSchema.optional().describe('Event description and usage'),

  /**
   * Whether event bubbles up through the DOM hierarchy
   * 
   * @default false
   */
  bubbles: z.boolean().default(false).describe('Whether event bubbles'),

  /**
   * Whether event can be cancelled
   * 
   * @default false
   */
  cancelable: z.boolean().default(false).describe('Whether event is cancelable'),

  /**
   * Event payload schema
   * Defines the data structure sent with the event
   * 
   * @example { userId: 'string', timestamp: 'number' }
   */
  payload: z.record(z.string(), z.unknown()).optional().describe('Event payload schema'),
}));

export type WidgetEvent = z.infer<typeof WidgetEventSchema>;
/** Post-parse shape of {@link WidgetEvent} — defaults applied, transforms run (ADR-0122). */
export type WidgetEventParsed = z.infer<typeof WidgetEventSchema>;

/**
 * Widget Property Definition Schema
 * 
 * Defines the contract for widget configuration properties.
 * Inspired by React PropTypes and Web Component attributes.
 * 
 * @see https://react.dev/reference/react/Component#static-proptypes
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements
 * 
 * @example
 * ```typescript
 * const widgetProps = {
 *   maxLength: {
 *     type: 'number',
 *     required: false,
 *     default: 100,
 *     description: 'Maximum input length'
 *   }
 * }
 * ```
 */
export const WidgetPropertySchema = lazySchema(() => z.object({
  /**
   * Property name
   * Should be camelCase following ObjectStack conventions
   */
  name: z.string().describe('Property name (camelCase)'),

  /**
   * Property label for UI
   */
  label: I18nLabelSchema.optional().describe('Human-readable label'),

  /**
   * Property data type
   * 
   * @example "string", "number", "boolean", "array", "object", "function"
   */
  type: z.enum(['string', 'number', 'boolean', 'array', 'object', 'function', 'any'])
    .describe('TypeScript type'),

  /**
   * Whether property is required
   * 
   * @default false
   */
  required: z.boolean().default(false).describe('Whether property is required'),

  /**
   * Default value for the property
   */
  default: z.unknown().optional().describe('Default value'),

  /**
   * Property description
   */
  description: I18nLabelSchema.optional().describe('Property description'),

  /**
   * Property validation schema
   * Can include min/max, regex, enum values, etc.
   */
  validation: z.record(z.string(), z.unknown()).optional().describe('Validation rules'),

  /**
   * Property category for grouping in UI
   */
  category: z.string().optional().describe('Property category'),
}));

export type WidgetProperty = z.infer<typeof WidgetPropertySchema>;
/** Post-parse shape of {@link WidgetProperty} — defaults applied, transforms run (ADR-0122). */
export type WidgetPropertyParsed = z.infer<typeof WidgetPropertySchema>;

/**
 * Widget Manifest Schema
 * 
 * Complete definition for a custom widget including metadata, lifecycle, events, and props.
 * This is used for widget registration and discovery.
 * 
 * @example
 * ```typescript
 * const customWidget = {
 *   name: 'custom_date_picker',
 *   label: 'Custom Date Picker',
 *   version: '1.0.0',
 *   author: 'Company Name',
 *   fieldTypes: ['date', 'datetime'],
 *   lifecycle: { ... },
 *   events: [ ... ],
 *   properties: [ ... ]
 * }
 * ```
 */
/**
 * Widget Source Schema
 * Defines how the widget code is loaded.
 */
export const WidgetSourceSchema = lazySchema(() => z.discriminatedUnion('type', [
  // NPM Registry (standard)
  z.object({
    type: z.literal('npm'),
    packageName: z.string().describe('NPM package name'),
    version: z.string().default('latest'),
    exportName: z.string().optional().describe('Named export (default: default)'),
  }),
  // Module Federation (Remote)
  z.object({
    type: z.literal('remote'),
    url: z.string().url().describe('Remote entry URL (.js)'),
    moduleName: z.string().describe('Exposed module name'),
    scope: z.string().describe('Remote scope name'),
  }),
  // Inline Code (Simple scripts)
  z.object({
    type: z.literal('inline'),
    code: z.string().describe('JavaScript code body'),
  }),
]));

export type WidgetSource = z.infer<typeof WidgetSourceSchema>;
/** Post-parse shape of {@link WidgetSource} — defaults applied, transforms run (ADR-0122). */
export type WidgetSourceParsed = z.infer<typeof WidgetSourceSchema>;

export const WidgetManifestSchema = lazySchema(() => z.object({
  /**
   * Widget identifier (snake_case)
   */
  name: SnakeCaseIdentifierSchema
    .describe('Widget identifier (snake_case)'),

  /**
   * Human-readable widget name
   */
  label: I18nLabelSchema.describe('Widget display name'),

  /**
   * Widget description
   */
  description: I18nLabelSchema.optional().describe('Widget description'),

  /**
   * Widget version (semver)
   */
  version: z.string().optional().describe('Widget version (semver)'),

  /**
   * Widget author/organization
   */
  author: z.string().optional().describe('Widget author'),

  /**
   * Icon name or URL
   */
  icon: z.string().optional().describe('Widget icon'),

  /**
   * Field types this widget supports
   * 
   * @example ["text", "email", "url"]
   */
  fieldTypes: z.array(z.string()).optional().describe('Supported field types'),

  /**
   * Widget category for organization
   */
  category: z.enum(['input', 'display', 'picker', 'editor', 'custom'])
    .default('custom')
    .describe('Widget category'),

  /**
   * Widget lifecycle hooks
   */
  lifecycle: WidgetLifecycleSchema.optional().describe('Lifecycle hooks'),

  /**
   * Custom events this widget emits
   */
  events: z.array(WidgetEventSchema).optional().describe('Custom events'),

  /**
   * Widget configuration properties
   */
  properties: z.array(WidgetPropertySchema).optional().describe('Configuration properties'),

  /**
   * Widget implementation
   * Defines how to load the widget code
   */
  implementation: WidgetSourceSchema.optional().describe('Widget implementation source'),

  /**
   * Widget dependencies
   * External libraries or scripts needed
   */
  dependencies: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
    url: z.string().url().optional(),
  })).optional().describe('Widget dependencies'),

  /**
   * Widget screenshots for showcase
   */
  screenshots: z.array(z.string().url()).optional().describe('Screenshot URLs'),

  /**
   * Widget documentation URL
   */
  documentation: z.string().url().optional().describe('Documentation URL'),

  /**
   * License information
   */
  license: z.string().optional().describe('License (SPDX identifier)'),

  /**
   * Tags for discovery
   */
  tags: z.array(z.string()).optional().describe('Tags for categorization'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),

  /** Performance optimization settings */
  // `performance` REMOVED (#3896 audit close-out): call-graph closed across
  // both repos — zero readers (objectui's virtual scrolling reads the LIVE
  // top-level `virtualScroll` key, never performance.virtualScroll).
  performance: retiredKey(
    '`widget.performance` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'no renderer or runtime ever read it. Delete the key. Virtual scrolling is the live ' +
    'top-level `virtualScroll` on list-shaped views.',
  ),
}));

export type WidgetManifest = z.infer<typeof WidgetManifestSchema>;
/** Post-parse shape of {@link WidgetManifest} — defaults applied, transforms run (ADR-0122). */
export type WidgetManifestParsed = z.infer<typeof WidgetManifestSchema>;

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
export type FieldWidgetProps = z.infer<typeof FieldWidgetPropsSchema>;
/** Post-parse shape of {@link FieldWidgetProps} — defaults applied, transforms run (ADR-0122). */
export type FieldWidgetPropsParsed = z.infer<typeof FieldWidgetPropsSchema>;
