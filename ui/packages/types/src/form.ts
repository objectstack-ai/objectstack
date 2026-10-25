/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Form Component Schemas
 * 
 * Type definitions for form input and interactive components.
 * 
 * @module form
 * @packageDocumentation
 */

import type { BaseSchema, SchemaNode } from './base.js';
import type { SelectOptionBase } from './select-option.js';
import type { GridFieldMetadata } from './field-types.js';
// objectui#11070 — the field-metadata members `FormField` declares by
// reference to the spec's `FieldSchema`. Type-only: no runtime edge.
import type { Field as SpecField, SelectOption as SpecSelectOption } from '@objectstack/spec/data';
// objectui#12736 — the spec's FORM-VIEW option, read by reference to bound the
// SDUI form-option face below. Type-only: no runtime edge.
import type { FormSelectOption as SpecFormSelectOption } from '@objectstack/spec/ui';

/**
 * Button component
 */
export interface ButtonSchema extends BaseSchema {
  type: 'button';
  /**
   * Button text label
   */
  label?: string;
  /**
   * Button variant/style
   * @default 'default'
   */
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  /**
   * Button size
   * @default 'default'
   */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /**
   * Whether button is in loading state
   */
  loading?: boolean;
  /**
   * Icon to display (lucide-react icon name)
   */
  icon?: string;
  /**
   * Icon position
   * @default 'left'
   */
  iconPosition?: 'left' | 'right';
  /**
   * Click handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * forwarded to the DOM `<button>` by `toFormControlDomProps` (`onClick` is on
   * `SDUI_DOM_PASS_THROUGH_KEYS`).
   */
  onClick?: () => void | Promise<void>;
  /**
   * Button type
   * @default 'button'
   */
  buttonType?: 'button' | 'submit' | 'reset';
  /**
   * Child components (for custom content)
   */
  children?: SchemaNode | SchemaNode[];
}

/**
 * Text input component
 */
export interface InputSchema extends BaseSchema {
  type: 'input';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Input label
   */
  label?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Input type
   * @default 'text'
   */
  inputType?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'date' | 'time' | 'datetime-local';
  /**
   * Default value
   */
  defaultValue?: string | number;
  /**
   * Controlled value
   */
  value?: string | number;
  /**
   * Whether field is required
   */
  required?: boolean;
  /**
   * Whether field is readonly
   */
  readOnly?: boolean;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `input` renderer as `props.onChange(e.target.value)` after
   * `SchemaRenderer` spreads it.
   */
  onChange?: (value: string | number) => void;
  /**
   * Input wrapper CSS class
   */
  wrapperClass?: string;
  /**
   * Minimum value (for number type)
   */
  min?: number;
  /**
   * Maximum value (for number type)
   */
  max?: number;
  /**
   * Step value (for number type)
   */
  step?: number;
  /**
   * Maximum length
   */
  maxLength?: number;
  /**
   * Pattern for validation
   */
  pattern?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `input` reads NEITHER content
   * channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but that refusal
   * names `children` as the remedy, and `input` does not read `children`
   * either. It is restated here so the refusal names what `input` renders
   * instead.
   *
   * @deprecated Not a channel `input` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `input` reads NEITHER content
   * channel, so an authored child list here rendered NOTHING: no render-time
   * error or warning and no element; only the parser tier's `not-a-container`
   * warning (objectui#9910) noticed it.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. Every `body` / `children` read is filed
   * under the TYPE of the object it is read from; this declaration carries
   * none, while the same instrument sees it as the receiver of every key the
   * renderer reads: `defaultValue`, `description`, `error`, `id`, `inputType`,
   * `label`, `max`, `maxLength`, `min`, `name`, `pattern`, `placeholder`,
   * `readOnly`, `required`, `step`, `value`, `wrapperClass` (in
   * `packages/components/src/renderers/form/input.tsx`). `ui:input` is the only
   * registration claiming the bare `input` key, and it hands the node straight
   * to that renderer. `SchemaRenderer` strips both keys out of the props bag it
   * spreads, the renderer forwards only the form-control DOM keys to the native
   * element, and the registration declares no `children` slot (objectui#9910).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT, AND WHAT CHANGED. {@link InputShorthandSchema}
   * inherits from this interface, and its heritage used to be a plain `Omit`,
   * which collapsed into `BaseSchema`'s index signature — so a tombstone here
   * reached neither the `email` nor the `password` face. objectui#9256's E3
   * slice re-spelled that heritage as the index-signature-safe `OmitDeclared`,
   * after which this pair reaches both shorthand faces on the TypeScript side;
   * the shorthand restates it with guidance naming its own node.
   *
   * What it renders instead: one input field — `label`, `placeholder`,
   * `inputType`, `value` / `defaultValue`, `description`, `error`, `required`.
   *
   * @deprecated Not a channel `input` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Textarea component
 */
export interface TextareaSchema extends BaseSchema {
  type: 'textarea';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Textarea label
   */
  label?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Default value
   */
  defaultValue?: string;
  /**
   * Controlled value
   */
  value?: string;
  /**
   * Number of visible rows
   */
  rows?: number;
  /**
   * Whether field is required
   */
  required?: boolean;
  /**
   * Whether field is readonly
   */
  readOnly?: boolean;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * Classes on the wrapper `div` around the textarea and its label.
   *
   * READ SITE: `packages/components/src/renderers/form/textarea.tsx:37` —
   * `cn("grid w-full gap-1.5", schema.wrapperClass)`. Undeclared until
   * objectui#7722, surviving only on `BaseSchema`'s index signature: the same
   * key, on the same class of read, that `CheckboxSchema` (`b74a8598d`),
   * `FileUploadSchema` and `FilterBuilderSchema` (objectui#6150) declare.
   * Distinct from `className`, which the renderer hands to the inner control.
   */
  wrapperClass?: string;
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `textarea` renderer as `props.onChange(e.target.value)` after
   * `SchemaRenderer` spreads it.
   */
  onChange?: (value: string) => void;
  /**
   * Maximum length
   */
  maxLength?: number;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `textarea` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `id`, `label`, `name`, `placeholder`, `readOnly`,
   * `required`, `rows`, `value`, `wrapperClass` (in
   * `packages/components/src/renderers/form/textarea.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `textarea` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `textarea` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `id`, `label`, `name`, `placeholder`, `readOnly`,
   * `required`, `rows`, `value`, `wrapperClass` (in
   * `packages/components/src/renderers/form/textarea.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `textarea` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Select dropdown component
 */
export interface SelectSchema extends BaseSchema {
  type: 'select';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Select label
   */
  label?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Default selected value
   */
  defaultValue?: string | number | boolean;
  /**
   * Controlled value
   */
  value?: string | number | boolean;
  /**
   * Select options
   */
  options: SelectOption[];
  /**
   * Whether field is required
   */
  required?: boolean;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * Classes on the wrapper `div` around the trigger and its label.
   *
   * READ SITE: `packages/components/src/renderers/form/select.tsx:45` —
   * `cn("grid w-full items-center gap-1.5", schema.wrapperClass)`. Undeclared until
   * objectui#7722, surviving only on `BaseSchema`'s index signature: the same
   * key, on the same class of read, that `CheckboxSchema` (`b74a8598d`),
   * `FileUploadSchema` and `FilterBuilderSchema` (objectui#6150) declare.
   * Distinct from `className`, which the renderer hands to the inner control.
   */
  wrapperClass?: string;
  /**
   * Change handler. Receives the AUTHORED option value — a numeric/boolean
   * option arrives with its type intact (#3090), not stringified by the
   * underlying control.
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `select` renderer as `props.onChange(matchOptionValue(…))`
   * after `SchemaRenderer` spreads it.
   */
  onChange?: (value: string | number | boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `select` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `label`, `name`, `options`, `placeholder`, `required`,
   * `value`, `wrapperClass` (in
   * `packages/components/src/renderers/form/select.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `select` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `select` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `label`, `name`, `options`, `placeholder`, `required`,
   * `value`, `wrapperClass` (in
   * `packages/components/src/renderers/form/select.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `select` reads — nothing renders it.
   */
  children?: never;
}

/**
 * The keys the spec's OBJECT-field option takes and its FORM-VIEW option leaves
 * out (objectui#12736) — `default` and `kind` on `@objectstack/spec` 18, which
 * belong to the object field: the pre-selected choice and the lifecycle
 * category are the object definition's, and a form view's option list relabels
 * or subsets that field without owning either.
 *
 * DERIVED, never listed: the set difference of the spec's own two option types,
 * so a key the spec moves between its faces moves here with no edit. The zod
 * twin refuses the same set, derived the same way from the two spec schemas.
 */
type ObjectFieldOnlyOptionKey = Exclude<keyof SpecSelectOption, keyof SpecFormSelectOption>;

/**
 * Select option — the SDUI FORM face of the one select-option contract
 * (`98d4108a2`), bounded by the spec's FORM-VIEW option (`FormSelectOption`,
 * `@objectstack/spec/ui`; objectui#12736). It extends {@link SelectOptionBase},
 * which derives the spec keys from `@objectstack/spec/data` by reference and
 * carries objectui's `visibleWhen` wire shape plus the two objectui-only keys
 * `disabled` and `icon`, and then drops the keys the form-view option leaves
 * out ({@link ObjectFieldOnlyOptionKey}). So the spec-owned keys this face
 * carries are exactly `FormSelectOption`'s, and every other difference is a
 * named divergence:
 *
 *   - `value` — widened for standalone forms (the member below);
 *   - `visibleWhen` — objectui's wire shape, carried by the base;
 *   - `disabled`, `icon` — objectui-only, carried by the base.
 *
 * A form option carrying `default` or `kind` used to type-check and parse
 * clean, and nothing on the form path read either: the option default is
 * seeded from the OBJECT field's options, and the stage renderers read `kind`
 * off the object field. Both are now refused — an excess property on a typed
 * literal here, a named refusal at the zod twin.
 *
 * Its zod twin, `SelectOptionSchema` in `./zod/form.zod`, is the same
 * derivation on the runtime side and diverges on the same keys.
 */
export interface SelectOption extends Omit<SelectOptionBase, 'value' | ObjectFieldOnlyOptionKey> {
  /**
   * Option value (submitted in form).
   *
   * Widened beyond the spec's lowercase machine identifier (#3090): standalone
   * UI forms legitimately bind numeric/boolean values, and this package's zod
   * twin has always accepted them. The renderers stringify for the
   * string-speaking controls and map the selection back to the authored value
   * (`matchOptionValue`), so the authored type survives the round trip instead
   * of morphing to `"2"`.
   *
   * This is the ONE key on which the SDUI form face is wider than the
   * object-metadata face (`SelectOptionMetadata` in `./field-types`), which
   * keeps the spec's `string`. Authored OBJECT metadata is validated against
   * the spec, so a numeric option value belongs to standalone forms only.
   */
  value: string | number | boolean;
}

/**
 * Checkbox component
 */
export interface CheckboxSchema extends BaseSchema {
  type: 'checkbox';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Checkbox label
   */
  label?: string;
  /**
   * Default checked state
   */
  defaultChecked?: boolean;
  /**
   * Controlled checked state
   */
  checked?: boolean;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * Whether the box must be checked — drives a VISIBLE affordance, not just
   * form semantics.
   *
   * READ SITES, both in `packages/components/src/renderers/form/checkbox.tsx`:
   * `required={schema.required}` on the Radix `Checkbox`, and the label's
   * required marker it gates — the label turns `text-destructive` and carries a
   * real `aria-hidden` `*` span (`data-required-marker`). Not CSS generated
   * content: the label names the checkbox, and an `::after` asterisk enters
   * that accessible name ("Title*"), where `aria-hidden` cannot reach a
   * pseudo-element (objectui#10368).
   *
   * Declared by objectui#6150; one of the two behavioural keys in that census.
   */
  required?: boolean;
  /**
   * Classes on the wrapper `div` around the box and its label.
   *
   * READ SITE: `packages/components/src/renderers/form/checkbox.tsx:36` —
   * `cn("flex items-center space-x-2", schema.wrapperClass)`. Undeclared until
   * `b74a8598d`, surviving only on `BaseSchema`'s index signature: the same
   * key, on the same class of read, that `FileUploadSchema` and
   * `FilterBuilderSchema` declare (objectui#6150) — left out here only because
   * the checkbox doc page's schema block is a six-line summary.
   */
  wrapperClass?: string;
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `checkbox` renderer as `props.onChange(checked)` after
   * `SchemaRenderer` spreads it.
   */
  onChange?: (checked: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `checkbox` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `checked`, `defaultChecked`, `id`, `label`, `name`, `required`,
   * `wrapperClass` (in `packages/components/src/renderers/form/checkbox.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `checkbox` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `checkbox` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `checked`, `defaultChecked`, `id`, `label`, `name`, `required`,
   * `wrapperClass` (in `packages/components/src/renderers/form/checkbox.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `checkbox` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Radio group component
 */
export interface RadioGroupSchema extends BaseSchema {
  type: 'radio-group';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Radio group label
   */
  label?: string;
  /**
   * Default selected value
   */
  defaultValue?: string | number;
  /**
   * Controlled value
   */
  value?: string | number;
  /**
   * Radio options
   */
  options: RadioOption[];
  /**
   * Radio group orientation
   * @default 'vertical'
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `radio-group` renderer forwards only `toFormControlDomProps`'s whitelist,
   * which drops it. The zod twin refuses it by name; author behaviour as a node
   * type (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onChange?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `radio-group` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `id`, `options`, `orientation` (in
   * `packages/components/src/renderers/form/radio-group.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `radio-group` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `radio-group` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `id`, `options`, `orientation` (in
   * `packages/components/src/renderers/form/radio-group.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `radio-group` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Radio option
 */
export interface RadioOption {
  /**
   * Option label
   */
  label: string;
  /**
   * Option value. Widened beyond `string` (#3090) to match
   * `RadioOptionSchema`, which has always accepted numbers.
   */
  value: string | number;
  /**
   * Whether option is disabled
   */
  disabled?: boolean;
  /**
   * Option description
   */
  description?: string;
}

/**
 * Switch/Toggle component
 */
export interface SwitchSchema extends BaseSchema {
  type: 'switch';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Switch label
   */
  label?: string;
  /**
   * Default checked state
   */
  defaultChecked?: boolean;
  /**
   * Controlled checked state
   */
  checked?: boolean;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Classes on the wrapper `div` around the switch and its label.
   *
   * READ SITE: `packages/components/src/renderers/form/switch.tsx:26` —
   * `` `flex items-center space-x-2 ${schema.wrapperClass || ''}` ``. Undeclared until
   * objectui#7722, surviving only on `BaseSchema`'s index signature: the same
   * key, on the same class of read, that `CheckboxSchema` (`b74a8598d`),
   * `FileUploadSchema` and `FilterBuilderSchema` (objectui#6150) declare.
   * Distinct from `className`, which the renderer hands to the inner control.
   */
  wrapperClass?: string;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `switch` renderer forwards only `toFormControlDomProps`'s whitelist, which
   * drops it. The zod twin refuses it by name; author behaviour as a node type
   * (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onChange?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `switch` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `id`, `label`, `wrapperClass` (in
   * `packages/components/src/renderers/form/switch.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `switch` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `switch` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `id`, `label`, `wrapperClass` (in
   * `packages/components/src/renderers/form/switch.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `switch` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Toggle button component
 */
export interface ToggleSchema extends BaseSchema {
  type: 'toggle';
  /**
   * Toggle label
   */
  label?: string;
  /**
   * Default pressed state
   */
  defaultPressed?: boolean;
  /**
   * Controlled pressed state
   */
  pressed?: boolean;
  /**
   * Toggle variant
   * @default 'default'
   */
  variant?: 'default' | 'outline';
  /**
   * Toggle size
   * @default 'default'
   */
  size?: 'default' | 'sm' | 'lg';
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `toggle` renderer forwards only `toFormControlDomProps`'s whitelist, which
   * drops it. The zod twin refuses it by name; author behaviour as a node type
   * (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onChange?: never;
  /**
   * Child content
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `toggle` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/form/toggle.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `toggle` reads — author `children`.
   */
  body?: never;
}

/**
 * Slider component
 */
export interface SliderSchema extends BaseSchema {
  type: 'slider';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Slider label
   */
  label?: string;
  /**
   * Default value(s) — a single number or one number per thumb.
   *
   * READ SITE: `packages/components/src/renderers/form/slider.tsx`, which wraps
   * a scalar into a one-element list on purpose ("Ensure defaultValue is an
   * array for backward compatibility"). Both spellings therefore render, and
   * this declaration states both, matching its zod mirror (objectui#10280,
   * objectui#7759 group B: an objectui-own key follows its read site).
   */
  defaultValue?: number | number[];
  /**
   * RETIRED (objectui#10280, ADR-0049) — no read site. The `slider` renderer
   * reads `defaultValue`, `max`, `min` and `step` off the node and nothing
   * else; `value` reaching it through the props spread is dropped by the
   * form-control DOM whitelist. An authored `value` rendered nothing. The zod
   * twin refuses it by name; author `defaultValue` for the initial position.
   * @deprecated Not part of this contract — the value was inert.
   */
  value?: never;
  /**
   * Minimum value
   * @default 0
   */
  min?: number;
  /**
   * Maximum value
   * @default 100
   */
  max?: number;
  /**
   * Step increment
   * @default 1
   */
  step?: number;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `slider` renderer forwards only `toFormControlDomProps`'s whitelist, which
   * drops it. The zod twin refuses it by name; author behaviour as a node type
   * (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onChange?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `slider` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `max`, `min`, `step` (in
   * `packages/components/src/renderers/form/slider.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `slider` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `slider` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `defaultValue`, `max`, `min`, `step` (in
   * `packages/components/src/renderers/form/slider.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `slider` reads — nothing renders it.
   */
  children?: never;
}

/**
 * File upload component
 */
export interface FileUploadSchema extends BaseSchema {
  type: 'file-upload';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Upload label
   */
  label?: string;
  /**
   * Accepted file types
   * @example 'image/*', '.pdf,.doc'
   */
  accept?: string;
  /**
   * Allow multiple files
   * @default false
   */
  multiple?: boolean;
  /**
   * Maximum file size in bytes
   */
  maxSize?: number;
  /**
   * Maximum number of files (for multiple)
   */
  maxFiles?: number;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * Label on the drop zone / upload button.
   *
   * READ SITE: `packages/components/src/renderers/form/file-upload.tsx:123` —
   * `{isUploading ? "…" : (schema.buttonText || "DROP PAYLOAD OR CLICK TO UPLOAD")}`.
   */
  buttonText?: string;
  /**
   * Tailwind classes appended to the outer wrapper `div`.
   *
   * READ SITE: `renderers/form/file-upload.tsx:78` — appended to the
   * renderer's own grid classes as
   * `` `grid w-full … ${schema.wrapperClass || ''}` ``.
   */
  wrapperClass?: string;
  /**
   * Change handler (receives FileList or File[])
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `file-upload` renderer as `props.onChange(files)` after
   * `SchemaRenderer` spreads it.
   */
  onChange?: (files: FileList | File[]) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `file-upload` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `accept`, `buttonText`, `id`, `label`, `multiple`, `wrapperClass` (in
   * `packages/components/src/renderers/form/file-upload.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `file-upload` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `file-upload` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `accept`, `buttonText`, `id`, `label`, `multiple`, `wrapperClass` (in
   * `packages/components/src/renderers/form/file-upload.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `file-upload` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Date picker component
 */
export interface DatePickerSchema extends BaseSchema {
  type: 'date-picker';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Date picker label
   */
  label?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Default value (Date object or ISO string)
   */
  defaultValue?: Date | string;
  /**
   * Controlled value
   */
  value?: Date | string;
  /**
   * Minimum selectable date
   */
  minDate?: Date | string;
  /**
   * Maximum selectable date
   */
  maxDate?: Date | string;
  /**
   * Date format
   * @default 'PPP'
   */
  format?: string;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * Classes on the wrapper `div` around the popover trigger and its label.
   *
   * READ SITE: `packages/components/src/renderers/form/date-picker.tsx:35` —
   * `` `grid w-full max-w-sm items-center gap-1.5 ${schema.wrapperClass || ''}` ``. Undeclared until
   * objectui#7722, surviving only on `BaseSchema`'s index signature: the same
   * key, on the same class of read, that `CheckboxSchema` (`b74a8598d`),
   * `FileUploadSchema` and `FilterBuilderSchema` (objectui#6150) declare.
   * Distinct from `className`, which the renderer hands to the inner control.
   */
  wrapperClass?: string;
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `date-picker` renderer as `props.onChange(date)` after
   * `SchemaRenderer` spreads it.
   */
  onChange?: (date: Date | undefined) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `date-picker` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `format`, `id`, `label`, `placeholder`, `wrapperClass` (in
   * `packages/components/src/renderers/form/date-picker.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `date-picker` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `date-picker` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `format`, `id`, `label`, `placeholder`, `wrapperClass` (in
   * `packages/components/src/renderers/form/date-picker.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `date-picker` reads — nothing renders it.
   */
  children?: never;
}

/**
 * One calendar day as authored: an ISO 8601 date string (the JSON authoring
 * type) or a `Date` (in-process callers). The `calendar` renderer coerces a
 * string to a `Date` at its read site; a date-only string (`2026-09-15`)
 * selects the day it names in every zone (objectui#10293).
 */
type CalendarDay = Date | string;

/**
 * A `mode: 'range'` selection (objectui#10304): the `{ from, to }` pair the
 * range picker reads. `to` is optional — a range whose end is not chosen yet.
 */
interface CalendarDayRange {
  from: CalendarDay;
  to?: CalendarDay;
}

/**
 * Calendar component
 */
export interface CalendarSchema extends BaseSchema {
  type: 'calendar';
  /**
   * Default selection. Its shape follows {@link CalendarSchema.mode}
   * (objectui#10304), because that is what the date picker reads:
   * - `single` (and `mode` absent): one day, an ISO 8601 string or a `Date`;
   * - `multiple`: a list of days;
   * - `range`: `{ from, to }`, `to` optional.
   *
   * ⚠️ This declaration admits every shape on every mode: the pairing is a
   * property of the node, not of this key, and the MIRROR enforces it —
   * `zod/form.zod.ts#CalendarSchema` refuses a value whose shape does not
   * fit its mode. The renderer coerces every string day through the shared
   * date parse (objectui#10293).
   */
  defaultValue?: CalendarDay | CalendarDay[] | CalendarDayRange;
  /**
   * Controlled selection, shaped by {@link CalendarSchema.mode} exactly as
   * {@link CalendarSchema.defaultValue} is.
   */
  value?: CalendarDay | CalendarDay[] | CalendarDayRange;
  /**
   * Selection mode. It also decides the shape of `value` / `defaultValue`:
   * one day, a list of days, or a `{ from, to }` range (objectui#10304).
   * @default 'single'
   */
  mode?: 'single' | 'multiple' | 'range';
  /**
   * Minimum selectable date
   */
  minDate?: Date | string;
  /**
   * Maximum selectable date
   */
  maxDate?: Date | string;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `calendar` renderer spreads it onto `DayPicker`, whose selection callback
   * is `onSelect`; nothing calls it. The zod twin refuses it by name; author
   * behaviour as a node type (`{ "type": "toast" }`, an `action:button` node)
   * instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onChange?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `calendar` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `defaultValue`, `mode`, `value` (in `packages/components/src/renderers/form/calendar.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "calendar" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `view:calendar`
   * as the SOLE claimant of the bare key, because `ui:calendar` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * ⚠️ TWO readers, and both answer NEITHER. The bare `calendar` key resolves to
   * plugin-calendar's full CRUD calendar VIEW (`view:calendar`, the renderer in
   * `packages/plugin-calendar/src/index.tsx`), which reads its declared view
   * surface — `objectName`, `calendar`, `filter`, `sort`, `defaultView`,
   * `locale`, `data`, `staticData`, `loading` — and neither content channel.
   * This declaration's own key set describes the date-picker primitive reached
   * at `ui:calendar` only (`packages/components/src/renderers/form/calendar.tsx`),
   * which reads `defaultValue`, `mode` and `value` and neither content channel.
   *
   * The tombstone reaches {@link UiCalendarSchema} on BOTH faces. On this one
   * it did not until objectui#9256's E3 slice: `UiCalendarSchema` was declared
   * as a plain `Omit` of this interface, and because {@link BaseSchema} carried
   * an index signature that `Omit` resolved through `Exclude<string, 'type'>` =
   * `string` and collapsed every member into the signature — the checker
   * answered `any` for `UiCalendarSchema['body']` and for
   * `UiCalendarSchema['mode']` alike. Its heritage is now the index-signature-safe
   * `OmitDeclared`, so it carries this key set; the mirror always did, because
   * `zod/form.zod.ts` builds it with `.extend()`. The TypeScript half is pinned
   * in `__tests__/content-channel-e3-residual-9256.test.ts`, the mirror half as
   * a refusal row in `__tests__/content-channel-family-d-9256.test.ts`.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `calendar` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `calendar` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `defaultValue`, `mode`, `value` (in `packages/components/src/renderers/form/calendar.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "calendar" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `view:calendar`
   * as the SOLE claimant of the bare key, because `ui:calendar` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * ⚠️ TWO readers, and both answer NEITHER. The bare `calendar` key resolves to
   * plugin-calendar's full CRUD calendar VIEW (`view:calendar`, the renderer in
   * `packages/plugin-calendar/src/index.tsx`), which reads its declared view
   * surface — `objectName`, `calendar`, `filter`, `sort`, `defaultView`,
   * `locale`, `data`, `staticData`, `loading` — and neither content channel.
   * This declaration's own key set describes the date-picker primitive reached
   * at `ui:calendar` only (`packages/components/src/renderers/form/calendar.tsx`),
   * which reads `defaultValue`, `mode` and `value` and neither content channel.
   *
   * The tombstone reaches {@link UiCalendarSchema} on BOTH faces. On this one
   * it did not until objectui#9256's E3 slice: `UiCalendarSchema` was declared
   * as a plain `Omit` of this interface, and because {@link BaseSchema} carried
   * an index signature that `Omit` resolved through `Exclude<string, 'type'>` =
   * `string` and collapsed every member into the signature — the checker
   * answered `any` for `UiCalendarSchema['body']` and for
   * `UiCalendarSchema['mode']` alike. Its heritage is now the index-signature-safe
   * `OmitDeclared`, so it carries this key set; the mirror always did, because
   * `zod/form.zod.ts` builds it with `.extend()`. The TypeScript half is pinned
   * in `__tests__/content-channel-e3-residual-9256.test.ts`, the mirror half as
   * a refusal row in `__tests__/content-channel-family-d-9256.test.ts`.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `calendar` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Input OTP component
 */
export interface InputOTPSchema extends BaseSchema {
  type: 'input-otp';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * OTP input label
   */
  label?: string;
  /**
   * Number of OTP digits
   *
   * READ SITE: `packages/components/src/renderers/form/input-otp.tsx`, as the
   * slot count. Inert until objectui#11347: the renderer read an undeclared
   * `maxLength` and drew six slots whatever `length` said, while every
   * catalog entry and the docs page author `length`. The read moved to this
   * spelling with no alias, which also makes the `@default` below true.
   * @default 6
   */
  length?: number;
  /**
   * Draw a visual separator between two halves of the slots
   *
   * READ SITE: `packages/components/src/renderers/form/input-otp.tsx`. `true`
   * splits the {@link InputOTPSchema.length} slots into two groups at the
   * midpoint and draws one separator (`role="separator"`) between them; an odd
   * `length` puts the extra slot in the first group, and a single slot has
   * nothing to separate. Absent or `false` draws one group. Declared by
   * objectui#11365: the docs page and two catalog entries authored it while no
   * type declared it and the renderer read nothing for it.
   * @default false
   */
  separator?: boolean;
  /**
   * Default value
   */
  defaultValue?: string;
  /**
   * Controlled value
   */
  value?: string;
  /**
   * Help text or description
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `input-otp` renderer as `props.onChange(val)` after
   * `SchemaRenderer` spreads it.
   */
  onChange?: (value: string) => void;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `input-otp` renderer forwards only `toFormControlDomProps`'s whitelist,
   * which drops it. The zod twin refuses it by name; author behaviour as a node
   * type (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onComplete?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `input-otp` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `maxLength`, `value` (in
   * `packages/components/src/renderers/form/input-otp.tsx`). The undeclared
   * `maxLength` read has since moved to the declared {@link InputOTPSchema.length}
   * (objectui#11347), and objectui#11365 added a read of the declared
   * {@link InputOTPSchema.separator}.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `input-otp` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `input-otp` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `maxLength`, `value` (in
   * `packages/components/src/renderers/form/input-otp.tsx`). The undeclared
   * `maxLength` read has since moved to the declared {@link InputOTPSchema.length}
   * (objectui#11347), and objectui#11365 added a read of the declared
   * {@link InputOTPSchema.separator}.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `input-otp` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Form validation rule
 */
export interface FieldValidationRules {
  /**
   * Required field validation
   */
  required?: string | boolean;
  /**
   * Minimum length validation
   */
  minLength?: { value: number; message: string };
  /**
   * Maximum length validation
   */
  maxLength?: { value: number; message: string };
  /**
   * Minimum value validation (for numbers)
   */
  min?: { value: number; message: string };
  /**
   * Maximum value validation (for numbers)
   */
  max?: { value: number; message: string };
  /**
   * Pattern validation (regex)
   *
   * `value` must be a compiled `RegExp` on this hand-written surface — never a
   * string. react-hook-form's field validator applies `pattern` only when
   * `value instanceof RegExp` (verified against the installed 7.85.0 bundle),
   * so a string here type-checked and then validated NOTHING, silently: the
   * form looked validated while the rule never ran (objectui#5099, maintainer
   * ruling 2026-08-18). No path compiles a string into one: a regex declared
   * as object METADATA is the object's `format` validation rule
   * (`validations[]`), which the server runs on save — the field-level
   * `pattern` that `buildValidationRules` in `@object-ui/fields` used to
   * compile is retired (objectui#12242; `FieldSchema` refuses it by name).
   * The renderer deliberately does NOT compile strings at its read point —
   * that consumer-side tolerance would harden the ambiguous declaration into
   * contract (AGENTS.md #0.1); the declaration is narrowed at the producer
   * instead.
   */
  pattern?: { value: RegExp; message: string };
  /**
   * Custom validation function
   *
   * RUNTIME SLOT (objectui#7759 group E, objectui#6124 shape) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name. Kept callable here because the form renderer
   * spreads `validation` into react-hook-form's `rules` and keeps a supplied
   * `validate` running beside its own `required` entry.
   * @param value - The field value to validate
   * @returns true if valid, false or error message if invalid
   */
  validate?: (value: string | number | boolean | null | undefined) => boolean | string | Promise<boolean | string>;
}

/**
 * Form field condition for conditional rendering
 */
export interface FieldCondition {
  /**
   * Field to watch
   */
  field: string;
  /**
   * Show when field equals this value
   */
  equals?: any;
  /**
   * Show when field does not equal this value
   */
  notEquals?: any;
  /**
   * Show when field value is in this array
   */
  in?: any[];
  /**
   * RETIRED (objectui#7759 group E, objectui#6124 shape, ADR-0049) — JSON has no
   * function value, and nothing reads this key: the form renderer translates
   * `condition` to CEL from `field` / `equals` / `notEquals` / `in` only, so a
   * supplied function never ran. The zod twin refuses it by name; express the
   * condition with those keys, or with the field's `visibleWhen` CEL predicate.
   * @deprecated Not part of this contract — the value was inert.
   */
  custom?: never;
}

/**
 * One tab of a tabbed field layout (see `FormSchema.fieldTabs`).
 *
 * A tab claims a SUBSET of the form's `fields` by name. The form renderer still
 * renders exactly ONE `<form>` element / react-hook-form instance and merely
 * distributes the fields across tab panels that ALL STAY MOUNTED, so switching
 * tabs can neither destroy the values nor skip the validation of the tabs the
 * user is not currently looking at (objectui#2959).
 */
export interface FormFieldTab {
  /**
   * Stable tab key — the Radix `Tabs` value, also used for the panel's
   * `data-testid` (`form-tab-panel:{key}`).
   */
  key: string;
  /**
   * Tab trigger text. Falls back to `key`.
   */
  label?: string;
  /**
   * Optional blurb rendered above the tab's fields.
   */
  description?: string;
  /**
   * Names of the fields (as declared in `FormSchema.fields`) that belong to
   * this tab, in render order. Unknown names are ignored; fields claimed by no
   * tab render in a leading block above the tab strip (never dropped).
   */
  fields: string[];
  /**
   * Override the tab panel's field-grid classes (same role as
   * `FormSchema.fieldContainerClass`, scoped to this tab).
   */
  containerClass?: string;
  /**
   * The tab's predicate slot (objectui#6237) — the tabbed arm of the grouping
   * contract objectui#6236 landed for `section-divider` rows, so a section
   * rendered as a tab can carry the same authored `FormSection.visibleWhen` a
   * stacked section can. Evaluated by the form renderer on the canonical
   * engine with the live record and the host predicate scope bound (#6010),
   * exactly like a field's own `visibleWhen`; a broken predicate fails OPEN
   * (the tab stays visible).
   *
   * When it resolves FALSE the renderer draws neither the tab's trigger nor
   * its panel. Ruled semantics (maintainer, 2026-08-27 — the same ruling for
   * tabs as for sections): visibility decides what is DRAWN and nothing else —
   * a hidden tab's values still submit — and a hidden tab's fields SKIP
   * client-side validation, so a user is never blocked by an error pointing at
   * a control they cannot see; the server-side contract remains the loud floor
   * for genuinely-required data. Both semantics ride the unmount mechanism a
   * field's own false predicate already uses.
   *
   * The layout decision stays structural: whether the tabbed arm engages at
   * all is judged on the DECLARED tabs, so a predicate hiding all but one tab
   * filters what is drawn without collapsing the strip mid-interaction. A tab
   * without this key keeps the pre-#6237 contract (always drawn).
   */
  visibleWhen?: string | { dialect?: string; source: string };
  /**
   * The fault direction of {@link visibleWhen}: `'hidden'` hides the tab
   * (trigger and panel) when its predicate cannot be evaluated; `'shown'` or
   * absent keeps the fail-open default described above. A runtime hand-off,
   * not an authoring key — carried from the section the tab was built from,
   * where only the field-group derivation writes it
   * (`ObjectFormSection.visibleWhenFault`, objectui#13055).
   */
  visibleWhenFault?: 'hidden' | 'shown';
}

/**
 * One pane of a split field layout (see `FormSchema.fieldPanes`).
 *
 * Like {@link FormFieldTab}, a pane claims a SUBSET of the form's `fields` by
 * name, and the form renderer still renders exactly ONE `<form>` element /
 * react-hook-form instance — it merely places each pane's fields in its own
 * resizable panel. The `<form>` wraps the whole panel group, which is what lets
 * a submit from anywhere collect every pane's values and lets a condition in one
 * pane read a field in another (objectui#2153).
 */
export interface FormFieldPane {
  /**
   * Stable pane key — used for the panel's `data-testid`
   * (`form-pane:{key}`).
   */
  key: string;
  /**
   * Names of the fields (as declared in `FormSchema.fields`) that belong to
   * this pane, in render order. Unknown names are ignored; fields claimed by no
   * pane render in a leading block above the panel group (never dropped).
   */
  fields: string[];
  /**
   * Initial pane size, as a percentage of the group (1–99). Defaults to an even
   * split.
   */
  defaultSize?: number;
  /**
   * Minimum pane size, as a percentage of the group.
   * @default 20
   */
  minSize?: number;
  /**
   * Override the pane's field-grid classes (same role as
   * `FormSchema.fieldContainerClass`, scoped to this pane).
   */
  containerClass?: string;
}

/**
 * A field's `dependsOn` as authored: a bare parent-field name, or a list of
 * names / lookup-parameter entries `{ field, param }`.
 *
 * This is the single source of truth for the shape (framework#4074).
 * `@object-ui/core`'s `resolveDependsOnFields` / `resolveCascadingOptions` —
 * the runtime readers — type their parameter with this import and re-export it,
 * so the authoring surface and the reader can no longer disagree the way they
 * did (the reader accepted arrays for as long as it has existed, while
 * `FormField.dependsOn` said `string`).
 */
export type DependsOnInput =
  | string
  | Array<string | { field: string; param?: string }>
  | undefined
  | null;

/**
 * Form field configuration
 */
export interface FormField {
  /**
   * Unique field identifier
   */
  id?: string;
  /**
   * Field name for form submission
   */
  name: string;
  /**
   * Field label
   */
  label?: string;
  /**
   * Field description
   */
  description?: string;
  /**
   * Field type/component
   */
  type?: string;
  /**
   * Input type (for input fields)
   */
  inputType?: string;
  /**
   * Whether field is required
   */
  required?: boolean;
  /**
   * Whether field is disabled
   */
  disabled?: boolean;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Select options (for select/radio)
   */
  options?: SelectOption[] | RadioOption[];
  /**
   * Validation rules
   */
  validation?: FieldValidationRules;
  /**
   * Conditional rendering
   */
  condition?: FieldCondition;
  /**
   * Custom widget/component name override.
   * Aligns with @objectstack/spec FormField.widget.
   * When set, the form renderer uses this widget type instead of auto-detecting.
   * @example 'rich-text', 'code-editor', 'rating'
   */
  widget?: string;
  /**
   * Parent field(s) for cascading/dependent fields.
   * Aligns with @objectstack/spec FormField.dependsOn.
   * When a parent field value changes, this field is re-evaluated.
   *
   * The runtime reader (`resolveCascadingOptions` in `@object-ui/core`) has
   * always accepted a bare name, a list of names, or lookup-parameter entries
   * `{ field, param }` — its parameter type is exactly {@link DependsOnInput}.
   * This property used to say `string` only, so array-authored metadata
   * type-errored while working, and the form renderer read the key through
   * `(f as any).dependsOn` to get past its own type (framework#4074).
   * @example 'country' (field 'state' dependsOn 'country')
   * @example ['industry'] (multi-parent gating)
   */
  dependsOn?: DependsOnInput;
  /**
   * Visibility condition expression (view-level, from the form view's
   * FormField). Aligns with @objectstack/spec FormField.visibleOn — the wire
   * shape is either a bare CEL string or the spec Expression object
   * `{ dialect, source }`. Evaluated against the live record via the
   * canonical `@objectstack/formula` engine (same as `visibleWhen`); a broken
   * predicate fails open (field stays visible).
   * @example "record.priority == 'urgent'"
   */
  visibleOn?: string | { dialect?: string; source: string };
  /**
   * Whether the field is hidden.
   * Aligns with @objectstack/spec FormField.hidden.
   * @default false
   */
  hidden?: boolean;
  /**
   * Whether the field is read-only.
   * Aligns with @objectstack/spec FormField.readonly.
   * @default false
   */
  readonly?: boolean;
  /**
   * CEL predicate: when it evaluates TRUE for the live record the field is
   * shown, when FALSE it is hidden. Aligns with @objectstack/spec
   * Field.visibleWhen and is enforced client-side via the canonical
   * `@objectstack/formula` engine (same dialect the server uses). A broken
   * predicate fails open (field stays visible).
   * @example "record.status == 'sent'"
   */
  visibleWhen?: string | { dialect?: string; source: string };
  /**
   * CEL predicate: when TRUE the field becomes read-only (the server also
   * strips matching writes via `stripReadonlyWhenFields`). Aligns with
   * @objectstack/spec Field.readonlyWhen. Fails open (field stays editable).
   * @example "record.status == 'paid'"
   */
  readonlyWhen?: string | { dialect?: string; source: string };
  /**
   * CEL predicate: when TRUE the field is required (the server enforces the
   * same rule in its rule-validator). Aligns with @objectstack/spec
   * Field.requiredWhen. Fails open (field is not required).
   * @example "record.status == 'sent'"
   */
  requiredWhen?: string | { dialect?: string; source: string };
  /**
   * The resolved object-field metadata **object** (typically a
   * {@link FieldMetadata} / server-served field definition), stashed by the
   * object-bound form paths so widgets can read `precision`, `currency`,
   * `reference`, `dependsOn`, … It feeds the field-widget `field` prop.
   *
   * ⚠️ Same key, different layer: in the SPEC form-view vocabulary `field` is
   * a **string** (the referenced object-field name). That authored shape ends
   * at the `normalizeSectionField` chokepoint in `@object-ui/plugin-form` —
   * on a runtime FormField this slot is never a string, and its tripwire test
   * pins that. Declared (rather than ridden through the index signature) so
   * assigning a string here is a compile error instead of a latent pun
   * (#3090). Typed loosely because the stash's source is the server-served
   * object schema, whose key set is wider than the designer-oriented
   * {@link FieldMetadata} union.
   */
  field?: Record<string, any>;
  /**
   * Additional field-specific props
   */
  [key: string]: any;
  /**
   * Column span for grid layouts (1-4). Legacy — prefer `span`.
   * Aligns with @objectstack/spec FormField.colSpan. The renderer clamps it to
   * the current (per-surface derived) column count so it can never overflow.
   * @default 1
   */
  colSpan?: number;
  /**
   * Relative field width, decoupled from the (auto-derived) column count so it
   * stays correct at 1/2/3/4 columns (objectstack-ai/objectstack#2578). `'auto'` (default): width from
   * the widget type × current columns (wide widgets take the whole row);
   * `'full'`: whole row at any column count. Aligns with
   * @objectstack/spec FormField.span. Prefer this over `colSpan`.
   */
  span?: 'auto' | 'full';
  /**
   * Section grouping claim (objectui#6236) — `type: 'section-divider'` rows
   * only. Names of the fields (as declared in `FormSchema.fields`) that belong
   * to the section this divider heads: the same membership-claim shape
   * {@link FormFieldTab.fields} and {@link FormFieldPane.fields} already model,
   * so tabs, panes and sections share ONE grouping contract (the tabbed arm's
   * predicate slot is objectui#6237).
   *
   * A divider that carries this claim gates its WHOLE group: when the
   * divider's own visibility verdict (`visibleWhen` / `visibleOn` / legacy
   * `condition`) resolves FALSE, the renderer draws neither the heading nor
   * the claimed fields. Ruled semantics (maintainer, 2026-08-27, following the
   * console precedent of 2026-08-22 after #5594): visibility decides what is
   * DRAWN and nothing else — a hidden section's values still submit — and a
   * hidden section's fields SKIP client-side validation, so a user is never
   * blocked by an error pointing at a control they cannot see (the
   * objectui#6110 defect shape); the server-side contract remains the loud
   * floor for genuinely-required data.
   *
   * Unknown names are ignored (FormFieldTab parity). A field should be claimed
   * by at most one divider; when several claim it, any hidden claimer hides
   * it. A divider WITHOUT this claim keeps the pre-#6236 contract — a
   * presentational row whose predicate gates only the heading. On a
   * non-divider row the key has no meaning and is ignored by the renderer.
   */
  fields?: string[];
  /**
   * The fault direction of a `section-divider` row's `visibleWhen` —
   * `type: 'section-divider'` rows only, ignored on every other row (a
   * field's own `visibleWhen` keeps the triad's fail-open, ADR-0137 D3).
   * `'hidden'`: a predicate that cannot be evaluated hides the row and every
   * claimed field ({@link fields}), exactly as a FALSE verdict does — values
   * still submit, validation is skipped — and the one-time diagnostic names
   * `false` as the default taken. `'shown'` or absent: today's fail-open.
   *
   * A runtime hand-off, not an authoring key: `projectSectionDivider`
   * (`@object-ui/plugin-form`) copies it off the section it projects, where
   * only the field-group derivation writes it
   * (`ObjectFormSection.visibleWhenFault`, objectui#13055).
   */
  visibleWhenFault?: 'hidden' | 'shown';

  // ── Field metadata written on the entry itself (objectui#11070) ─────────
  //
  // A hand-authored `form` has no object schema behind it, so nothing is
  // stashed on `field` above: the renderer hands each field widget the ENTRY
  // ITSELF as its metadata carrier (`field: field.field || field`, the one
  // `renderFieldComponent` call in `renderers/form/form.tsx`), and the
  // built-in `input` / `textarea` branches spread the entry's remaining keys
  // onto the native control. The members below are the keys that path reads
  // off the entry. Each one `@objectstack/spec` declares on `FieldSchema` is
  // typed BY REFERENCE to that member, so the two cannot drift; `pattern` is
  // the one the spec does not declare.
  //
  // ⛔ Not every key a widget reads off the carrier is declared here. No
  // widget reads a snake_case second spelling of a spec key any more: the
  // length readers read ONLY the spec's `minLength` / `maxLength` (below),
  // the lookup and user widgets ONLY the spec's `reference`, the formula
  // widget ONLY the spec's `returnType`, and the summary widget no roll-up
  // key at all (objectui#11752). Their snake_case forms (`min_length`, `max_length`, `reference_to`,
  // `return_type`, `summary_type`, …) are retired, read by nothing and
  // refused by the strict face (objectui#11070). The grid field's `columns`
  // is the spec's inline grid column list, by reference (below).

  /**
   * Hold several values instead of one. Read by the `file`, `image`,
   * `lookup` and `user` field widgets off their metadata carrier: the upload
   * widgets put `multiple` on their file `<input>`, the pickers switch to
   * multi-value selection. The built-in `select` branch does not read it.
   */
  multiple?: SpecField['multiple'];
  /**
   * Height of the inline editor, in text rows. The built-in `textarea` branch
   * spreads it onto the `<textarea>` as `rows`; the `markdown` widget reads
   * it for its inline editor (default 8).
   */
  rows?: SpecField['rows'];
  /**
   * Upload types the file picker offers, as MIME types or extensions
   * (e.g. `["image/*", ".pdf"]`). The `file` widget joins them into its
   * `<input type="file">`'s `accept` attribute.
   */
  accept?: SpecField['accept'];
  /**
   * Vector dimensionality. The `vector` widget prints it beside the value
   * (`(768D)`), falling back to the value's own length when absent.
   */
  dimensions?: SpecField['dimensions'];
  /**
   * Target object of a `lookup` / `user` field, as `@objectstack/spec`'s
   * `FieldSchema` spells it. The `lookup` widget resolves its target from
   * this key alone and the `user` widget likewise (falling back to
   * `sys_user`), so this is the object the picker queries through the
   * injected adapter. The retired `reference_to` spelling is read by neither
   * and is ⛔ NOT declared: the strict face refuses it by name
   * (objectui#11070).
   */
  reference?: SpecField['reference'];
  /**
   * Minimum value. The `number` widget and the built-in `input` branch put it
   * on the native control as `min`, which the browser enforces at submit
   * (the form sets no `noValidate`). For a react-hook-form rule with its own
   * message, write `validation.min` instead.
   */
  min?: SpecField['min'];
  /**
   * Maximum value. Read like {@link FormField.min}, as the native `max`.
   */
  max?: SpecField['max'];
  /**
   * Decimal places, a non-negative integer of at most 100. The `number`
   * widget reads it as its `step` and its read-only width, the `percent`
   * widget as the decimals of the percentage-point value (`scale: 2` reads
   * 12.34%), and the `formula` and `summary` widgets when they draw a number;
   * each resolves an absent `scale` through the spec's `resolveFieldScale`.
   *
   * ⛔ Not on a `currency` field. The `currency` widget does not read it: an
   * amount's decimal places are its currency's ISO 4217 minor unit. So the
   * zod face refuses `scale` on an entry of `type: 'currency'`, as the
   * spec's `FieldSchema` refuses it (objectstack-ai/objectstack#19629),
   * keyed on `type` as the spec keys it. A typed literal cannot refuse it,
   * because this interface keeps an index signature (objectui#11070).
   */
  scale?: SpecField['scale'];
  /**
   * The currency of a `currency` field: `{ currencyMode: 'fixed',
   * defaultCurrency: 'EUR' }` gives the field one currency. The `currency`
   * widget resolves its code through `resolveFieldCurrency`
   * (`@object-ui/i18n`), which reads `defaultCurrency` only under
   * `currencyMode: 'fixed'`. Under `dynamic`, the spec's mode when none is
   * written, the amount shows in the tenant default currency.
   *
   * A `currency` code written on the entry itself is still read first by
   * `resolveFieldCurrency`, but the spec's `FieldSchema` refuses it as a
   * field key, so it is ⛔ NOT declared here and the strict face refuses it
   * (objectui#11070).
   */
  currencyConfig?: SpecField['currencyConfig'];
  /**
   * Minimum character length. The built-in `input` and `textarea` branches
   * put it on the native control as `minlength`, which the browser enforces
   * at submit. For a react-hook-form rule with its own message, write
   * `validation.minLength` instead.
   */
  minLength?: SpecField['minLength'];
  /**
   * Maximum character length. The built-in `input` and `textarea` branches
   * resolve it as the control's `maxLength` ceiling (the `textarea` branch
   * also draws its `{n}/{max}` counter).
   */
  maxLength?: SpecField['maxLength'];
  /**
   * Regular expression the value must match, as a STRING — JSON has no
   * `RegExp`. The built-in `input` branch puts it on the native control as
   * `pattern`, which the browser enforces at submit. This is the spelling
   * the `validation.pattern` refusal directs JSON authors to: that rule's
   * `value` must be a compiled `RegExp` (objectui#5099), which a document
   * cannot carry.
   */
  pattern?: string;
  /**
   * The value type a `formula` field computes (`number` / `text` /
   * `boolean` / `date`). The `formula` widget draws the value by it, by the
   * same rule as the formula table cell, so one stored value reads the same
   * in a form and in a table (objectui#11748): a number formatted as a
   * `number` field formats it (the viewer's display locale, at the width a
   * `scale` on the field sets); a boolean as the UI language's Yes / No
   * word, where any value that is not a JS boolean reads as empty; a date
   * in `formatDate`'s default face, the date field's read-only face; and
   * text as text, in monospace. With no `returnType`, a JS number is drawn
   * as a number and anything else as text. The retired snake_case
   * `return_type` is read by nothing and refused.
   */
  returnType?: SpecField['returnType'];
  /**
   * The roll-up definition of a `summary` field: the child `object`, the
   * child `field` and the aggregation `function`, plus an optional
   * `relationshipField` and `filter`. The backend computes the value from
   * it; the `summary` widget does not read it to format. Whatever the
   * `function`, the widget draws the value by the same rule as the summary
   * table cell, so one stored value reads the same in a form and in a table
   * (objectui#11752): a number formatted as a `number` field formats it (the
   * viewer's display locale, at the width a `scale` on the field sets, at its
   * natural precision with none, so a `count` reads whole), and anything else
   * as text. The retired snake_case `summary_object` / `summary_field` /
   * `summary_type` are read by nothing and refused.
   */
  summaryOperations?: SpecField['summaryOperations'];
  /**
   * The columns of a `grid` field: `@objectstack/spec`'s
   * `FieldSchema.inlineColumns`, by reference — an array of the spec's strict,
   * `name`-keyed inline grid column (`{ name, label?, type?, width?, … }`).
   * The `grid` widget reads `columns` off its metadata carrier and each column
   * by exactly the spec's keys, so a column the spec refuses (the retired
   * `field` spelling, a `title`, a `type` outside its nine cell controls) is
   * refused here too rather than rendered as an empty or plain-text cell. The
   * spec spells the list `inlineColumns` on a `master_detail` field; a `grid`
   * field is objectui's own type, whose key is `columns` (objectui#11070).
   */
  columns?: SpecField['inlineColumns'];

  // ── The `grid` widget's field-level keys (objectui#11070 round 10) ──────
  //
  // A `form` `fields[]` entry of `type: 'grid'` is the authored path to the
  // `grid` widget, which reads its field-level keys off that entry (its
  // metadata carrier, as for `columns` above). Each member below is
  // `GridFieldMetadata`'s own member BY REFERENCE, so the form-field face and
  // the grid field's published type cannot drift; the meaning of each key is
  // documented there. Only the `grid` widget reads them: on any other field
  // type they are accepted and read by nothing. objectui#11610 renamed all
  // eight from snake_case to camelCase.

  /** The grid's minimum row count: {@link GridFieldMetadata.minRows}. */
  minRows?: GridFieldMetadata['minRows'];
  /** The grid's maximum row count: {@link GridFieldMetadata.maxRows}. */
  maxRows?: GridFieldMetadata['maxRows'];
  /** Whether the grid offers Add (on unless `false`): {@link GridFieldMetadata.allowAdd}. */
  allowAdd?: GridFieldMetadata['allowAdd'];
  /** Whether the grid offers Delete (on unless `false`): {@link GridFieldMetadata.allowDelete}. */
  allowDelete?: GridFieldMetadata['allowDelete'];
  /** Whether rows can be drag-reordered (on unless `false`): {@link GridFieldMetadata.allowReorder}. */
  allowReorder?: GridFieldMetadata['allowReorder'];
  /** The CHILD column summed into the footer total: {@link GridFieldMetadata.totalField}. */
  totalField?: GridFieldMetadata['totalField'];
  /** The Add button's label: {@link GridFieldMetadata.addLabel}. */
  addLabel?: GridFieldMetadata['addLabel'];
  /** The row field stamped with each row's index: {@link GridFieldMetadata.sortField}. */
  sortField?: GridFieldMetadata['sortField'];

  // ── Their retired snake_case spellings (objectui#11610) ─────────────────
  //
  // REFUSED BY NAME, as on `GridFieldMetadata` (where the retirement is
  // documented): each is a `?: never` tombstone here (a declared member, so
  // it outranks the index signature above), and an alias refusal naming the
  // camelCase key on the zod mirror. `GRID_FIELD_RETIRED_KEYS` maps each to
  // its replacement.

  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.minRows}.
   * @deprecated Write `minRows`. Nothing reads this spelling.
   */
  min_rows?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.maxRows}.
   * @deprecated Write `maxRows`. Nothing reads this spelling.
   */
  max_rows?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.allowAdd}.
   * @deprecated Write `allowAdd`. Nothing reads this spelling.
   */
  allow_add?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.allowDelete}.
   * @deprecated Write `allowDelete`. Nothing reads this spelling.
   */
  allow_delete?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.allowReorder}.
   * @deprecated Write `allowReorder`. Nothing reads this spelling.
   */
  allow_reorder?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.totalField}.
   * @deprecated Write `totalField`. Nothing reads this spelling.
   */
  total_field?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.addLabel}.
   * @deprecated Write `addLabel`. Nothing reads this spelling.
   */
  add_label?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link FormField.sortField}.
   * @deprecated Write `sortField`. Nothing reads this spelling.
   */
  sort_field?: never;

  // ── The rest of the entry's field metadata (objectui#12130) ─────────────
  //
  // objectui#11070 graded the channel above from a source read, and missed
  // keys on it. objectui#12130 measured it at runtime through the real
  // `SchemaRenderer`: `examples/schema-catalog/test/form-field-channel-census-12130.test.tsx`
  // records every key of the entry a reader asks for by name, and
  // `form-field-channel-effects-12130.test.tsx` beside it renders each one
  // with and without. Every member below is read by the widget or branch its
  // note names and changes what it does; where no note names a field type, it
  // is accepted and read by nothing. The spec's `FieldSchema` members are
  // typed by reference (`step` among them), and `idField` / `picker` /
  // `subtitle`, `capture`, `crop`, `defaultName`, `avatarField` and
  // `className` are typed as they are read. `idField` / `picker` / `subtitle`
  // were the field metadata types' members by reference until objectui#12242
  // moved them off that authoring face (the spec's `FieldSchema` refuses all
  // three by name): this entry is the face that declares them now, and
  // `LookupField` reads them through it.
  //
  // ⛔ Not declared: `defaultValue` and `defaultChecked`. No reader asks for
  // either, and neither becomes the field's value (the effects file measures
  // both). A form's initial values are {@link FormSchema.defaultValues}.
  //
  // ⛔ Not declared: `avatar_field`, the snake_case second spelling of
  // `avatarField` that the `lookup` and `user` widgets still read first. The
  // face declares one spelling, camelCase like its other keys (AGENTS.md
  // #0.1; objectui#11610), and the census ledger records the read.
  //
  // `step` is the spec's number, so HTML's `'any'` is refused here. No
  // producer writes `'any'`: the control that draws a number derives it
  // itself when the field declares neither `step` nor `scale`
  // (objectui#12130; `ObjectForm` wrote it until then).

  /**
   * Language of a `code` field, e.g. `python`. The `code` widget's editor
   * asks for code in it (default `javascript`).
   */
  language?: SpecField['language'];
  /**
   * Largest file a `file` or `image` field accepts, in bytes. The widget
   * refuses a larger pick before any upload starts.
   */
  maxSize?: SpecField['maxSize'];
  /**
   * Camera capture mode of a `file` field: `'environment'` or `'user'` adds a
   * camera input in that mode, `false` never offers one. Without it, the
   * widget offers the rear camera on a touch device when the field accepts
   * images. Typed as the `file` widget reads it.
   */
  capture?: 'environment' | 'user' | false;
  /**
   * `false` turns off inline cropping on an `image` field: the crop action
   * is not drawn on the field's images. Cropping is on unless this is `false`.
   */
  crop?: boolean;
  /**
   * The name an empty `avatar` field draws its initials from (default: the
   * field's `label`).
   */
  defaultName?: string;
  /**
   * Whether a `lookup` field offers to create the referenced record from an
   * empty result. On by default for a user-facing reference; `false` turns
   * the offer off.
   */
  allowCreate?: SpecField['allowCreate'];
  /**
   * Record field shown under each candidate's label in a `lookup` field's
   * quick-select.
   */
  descriptionField?: SpecField['descriptionField'];
  /**
   * Record field each candidate of a `lookup` or `user` field is labelled
   * by, in the quick-select and the browse-all dialog.
   */
  displayField?: SpecField['displayField'];
  /**
   * Record field a `lookup` field's pick commits as the value (default `id`),
   * e.g. `name` for a reference stored by machine name
   * (objectstack-ai/objectstack#3508). Picker configuration, not object
   * metadata: `FieldSchema` refuses it by name (objectui#12242).
   */
  idField?: string;
  /**
   * Columns of a `lookup` field's browse-all dialog.
   */
  lookupColumns?: SpecField['lookupColumns'];
  /**
   * Base filters of every candidate query of a `lookup` or `user` field.
   */
  lookupFilters?: SpecField['lookupFilters'];
  /**
   * Page size of a `lookup` field's browse-all dialog (default 10).
   */
  lookupPageSize?: SpecField['lookupPageSize'];
  /**
   * Picker of a `lookup` or `user` field: `'search'` is the search-first
   * people picker, which replaces the quick-select and the browse-all dialog;
   * `'default'` is the classic record-picker dialog. A `user` field with no
   * `picker` gets the search picker. Picker configuration, not object
   * metadata: `FieldSchema` refuses it by name (objectui#12242).
   */
  picker?: 'search' | 'default';
  /**
   * Dotted record-field paths shown beside each candidate of the search
   * picker (`picker: 'search'`); relation paths expand, e.g.
   * `primary_business_unit_id.name`. Picker configuration, not object
   * metadata: `FieldSchema` refuses it by name (objectui#12242).
   */
  subtitle?: string[];
  /**
   * Record field each candidate of the search picker (`picker: 'search'`) of
   * a `lookup` or `user` field draws its avatar image from (default `image`).
   * Typed as the widgets read it: the spec's `FieldSchema` declares neither
   * spelling, and `UserFieldMetadata` declares only the snake_case one,
   * which this face refuses.
   */
  avatarField?: string;
  /**
   * Step of the field's number input: the spec's `FieldSchema.step`, a
   * number (never HTML's `'any'`). The `number` widget and the form
   * renderer's own number input (an entry with `inputType: 'number'`) put it
   * on the `<input>`; without it they derive `10^-scale` from
   * {@link FormField.scale}, else `'any'`, so decimals stay accepted. The
   * `slider` widget steps by it (default 1).
   */
  step?: SpecField['step'];
  /**
   * Classes for the element this field's type renders, joined with the
   * classes that element already has (`cn`, so a conflicting utility written
   * here wins). That is the control a built-in branch (`input`, `textarea`,
   * `checkbox`, `switch`, `select`, and the default for an unregistered
   * widget) draws, the element a registered field widget renders, or a
   * `section-divider` row's divider. Never the field row: its width is
   * {@link FormField.colSpan} / {@link FormField.span}, and the grid is
   * {@link FormSchema.fieldContainerClass}. Some widgets draw no class from
   * it, and most read-only displays draw none.
   * `form-field-channel-effects-12130.test.tsx` measures where it lands.
   */
  className?: string;
}

/**
 * Complete form component
 */
export interface FormSchema extends BaseSchema {
  type: 'form';
  /**
   * Owning object name. When set, the renderer derives metadata-based field
   * locators `data-testid="field:{objectName}.{field}"` (ADR-0054 C4).
   */
  objectName?: string;
  /**
   * Form fields configuration
   */
  fields?: FormField[];
  /**
   * Default form values
   */
  defaultValues?: Record<string, any>;
  /**
   * The PERSISTED record this form is editing, as read before the user
   * touched it. Set by an edit-mode host only — its ABSENCE is what tells the
   * renderer "this is an insert" (objectui#3484).
   *
   * Two things depend on it, both to keep the client's verdict identical to
   * the server's (`@objectstack/objectql` `stripReadonlyWhenFields`):
   *
   *  1. It binds `previous` for field-rule CEL predicates, so a
   *     `readonlyWhen: previous.status != 'draft'` locks the field in the form
   *     instead of faulting on an unbound root and failing OPEN — which let a
   *     user edit a locked field and have the change silently dropped on save.
   *  2. It is overlaid UNDER the live form values to form the `record`
   *     binding, mirroring the server's `merged = { ...previous, ...data }`, so
   *     a predicate may reference a record field this form does not render.
   *
   * Never send it anywhere: it is evaluation context, not form state.
   */
  previousValues?: Record<string, any>;
  /**
   * Submit button label
   * @default 'Submit'
   */
  submitLabel?: string;
  /**
   * Cancel button label
   * @default 'Cancel'
   */
  cancelLabel?: string;
  /**
   * Show cancel button
   * @default false
   */
  showCancel?: boolean;
  /**
   * Show the submit button (objectui#11070).
   *
   * The `form` renderer destructures this off the node with a `true` default
   * and draws its submit button only while it holds (`{showSubmit && (` in
   * `renderers/form/form.tsx`), so `false` renders the fields with no submit
   * button — the display-only form the `fields-*` catalog examples author.
   * Declared on both faces because the strict authoring face refused it as
   * undeclared while the renderer read it.
   * @default true
   */
  showSubmit?: boolean;
  /**
   * Form layout
   * @default 'vertical'
   */
  layout?: 'vertical' | 'horizontal';
  /**
   * Number of columns for multi-column layout
   * @default 1
   */
  columns?: number;
  /**
   * Validation mode
   * @default 'onSubmit'
   */
  validationMode?: 'onSubmit' | 'onBlur' | 'onChange' | 'onTouched' | 'all';
  /**
   * Reset form after successful submission
   * @default false
   */
  resetOnSubmit?: boolean;
  /**
   * RETIRED (objectui#10286, ADR-0049) under the objectui#7759 ruling, item
   * D1-(ii): both faces dead and no spec declaration, so the key retires.
   *
   * `@objectstack/spec` declares no `form` node, so this is an objectui-own
   * key whose read site is the truth, and it has none: the `form` renderer
   * reads no `mode`, and the forms that build a `form` node (`ObjectForm`,
   * `ModalForm`, `DrawerForm`) consume their OWN `mode` and never set this
   * one. Measured through the real `SchemaRenderer`, every spelling rendered
   * the same form as its absence. The two faces had also drifted apart — this
   * declaration offered `edit | read | disabled`, the zod mirror `create |
   * edit | view` — and neither vocabulary was honoured.
   *
   * The live create / edit / view mode is `ObjectFormSchema.mode`
   * (`../objectql.ts`): author an `object-form` node for that. To make a
   * plain form non-editable, use `disabled` (inherited from `BaseSchema`).
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  mode?: never;
  /**
   * Custom action buttons (replaces default submit/cancel)
   */
  actions?: SchemaNode[];
  /**
   * Submit handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * destructured off `schema` by `renderers/form/form.tsx` and awaited from
   * `handleSubmit`.
   */
  onSubmit?: (data: Record<string, any>) => void | Promise<void>;
  /**
   * Change handler (called on any field change)
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * destructured off `schema` by `renderers/form/form.tsx` and subscribed to
   * the form values (objectui#4259).
   */
  onChange?: (data: Record<string, any>) => void;
  /**
   * Dirty-state handler — fires whenever the form transitions between
   * pristine and edited (react-hook-form's `formState.isDirty`). Overlay
   * hosts (modal/drawer) use this to guard against accidentally discarding
   * unsaved input when the user clicks the backdrop, presses Escape, or hits
   * the close/cancel button.
   */
  onDirtyChange?: (isDirty: boolean) => void;
  /**
   * Cancel handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * destructured off `schema` by `renderers/form/form.tsx` and called from the
   * cancel action.
   */
  onCancel?: () => void;
  /**
   * Show form action buttons
   * @default true
   */
  showActions?: boolean;
  /**
   * Mobile UX (round 3): when true, the form's Submit/Cancel action row
   * becomes `position: sticky; bottom: 0` on small viewports — keeping the
   * primary action reachable on long mobile forms without an extra scroll.
   *
   * No-op on desktop (≥ md). Pairs with `ObjectFormSchema.mobile.stickyActions`.
   */
  mobileStickyActions?: boolean;
  /**
   * Field container CSS class
   */
  fieldContainerClass?: string;
  /**
   * Tabbed field layout (objectui#2959): each entry claims a subset of `fields`
   * and renders it in its own tab panel — inside the SAME `<form>` /
   * react-hook-form instance as every other tab. Panels are force-mounted (only
   * CSS-hidden), so a tab the user has left keeps both its values and its
   * validation, and a failed submit activates the tab holding the first
   * offending field.
   *
   * Ignored when `children` is set or fewer than two tabs are given (the form
   * then renders as a plain field list).
   */
  fieldTabs?: FormFieldTab[];
  /**
   * Initially active `fieldTabs` key. Defaults to the first tab.
   */
  defaultFieldTab?: string;
  /**
   * Where the `fieldTabs` strip sits relative to the panels.
   * @default 'top'
   */
  fieldTabsPosition?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * Split field layout (objectui#2153): each entry claims a subset of `fields`
   * and renders it in its own resizable panel — inside the SAME `<form>` /
   * react-hook-form instance as every other pane, because the `<form>` wraps the
   * whole panel group. That is what a form PER panel could not do: its submit
   * reached only its own panel's fields, and its conditions could not see the
   * fields on the other side of the divider.
   *
   * Ignored when `children` or `fieldTabs` is set, or when fewer than two panes
   * are given (the form then renders as a plain field list).
   */
  fieldPanes?: FormFieldPane[];
  /**
   * Direction the `fieldPanes` are laid out in: `horizontal` = side by side,
   * `vertical` = stacked.
   * @default 'horizontal'
   */
  fieldPanesOrientation?: 'horizontal' | 'vertical';
  /**
   * Whether the `fieldPanes` divider offers a drag handle.
   * @default true
   */
  fieldPanesResizable?: boolean;
  /**
   * Child components (alternative to fields array)
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `form` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/form/form.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `form` reads — author `children`.
   */
  body?: never;
}

/**
 * Label component
 */
export interface LabelSchema extends BaseSchema {
  type: 'label';
  /**
   * Label text content
   */
  text?: string;
  /**
    * Legacy label property
    */
  label?: string;
  /**
   * RETIRED (objectui#6152 round 4, ADR-0049) — a THIRD spelling of the label's
   * text, beside {@link LabelSchema.text} and {@link LabelSchema.label}.
   *
   * The `label` renderer read it last, as `schema.text || schema.label ||
   * schema.content`, and that read is dropped in the same change. No document
   * authored it: the authored census over every tracked JSON file, Markdown JSON
   * fence and `type: 'label'` object literal found it once, in a components test,
   * against `label` 48 times and `text` 5 times. Honouring three spellings keeps
   * one fact writable three ways (AGENTS.md #0.1), so it is retired at once, with
   * no alias window. Which of `text` / `label` is canonical is a separate question
   * and is not decided here.
   *
   * `?: never` rather than deleted: this interface carried `BaseSchema`'s index
   * signature, so a deleted member would type-check silently (since
   * objectui#8347, through a widened value only), while a tombstone
   * makes presence a `tsc` error, and the zod twin refuses the key by name.
   *
   * @deprecated RETIRED (objectui#6152) — write the text as `text` (or `label`).
   */
  content?: never;
  /**
   * HTML for attribute
   */
  htmlFor?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `label` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `label`, `text` (in
   * `packages/components/src/renderers/form/label.tsx`; its third read,
   * `content`, is retired by objectui#6152 round 4).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `label` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `label` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `label`, `text` (in
   * `packages/components/src/renderers/form/label.tsx`; its third read,
   * `content`, is retired by objectui#6152 round 4).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `label` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Combobox option
 */
export interface ComboboxOption {
  /**
   * Option value
   */
  value: string;
  /**
   * Option label (displayed to user)
   */
  label: string;
  /**
   * Whether option is disabled
   */
  disabled?: boolean;
}

/**
 * Combobox component (searchable select)
 */
export interface ComboboxSchema extends BaseSchema {
  type: 'combobox';
  /**
   * Field name for form submission
   */
  name?: string;
  /**
   * Combobox label
   */
  label?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Combobox options
   */
  options?: ComboboxOption[];
  /**
   * ADR-0049 RETIREMENT TOMBSTONE (objectui#8140) — `defaultValue` on a
   * `combobox`. Write {@link ComboboxSchema.value} instead.
   *
   * Retired, rather than implemented to match the sibling `select` renderer,
   * because the two nodes differ in the one property that gives a "default
   * value" a meaning distinct from a value. MEASURED on the retiring PR's base,
   * not inherited from the card that named it:
   *
   *  - `combobox` is a STANDALONE node type only. It is absent from
   *    `renderFieldComponent`'s `BUILTIN_FIELD_TYPES` and no `field:combobox`
   *    widget is registered anywhere in the tree, so a form field authored
   *    `type: 'combobox'` — or `field:combobox`, or `ui:combobox` — takes that
   *    switch's `default:` arm and renders a plain text `<input>`. The node
   *    renderer is never on the form-field path, and on the form-field path a
   *    field's `defaultValue` is already honoured by the form's own value
   *    plumbing, which reads the field metadata and never this key.
   *  - On the node path the selection is FROZEN. The renderer passes no
   *    `onValueChange`, and `toFormControlDomProps` forwards neither `onChange`
   *    nor `onValueChange`, so no host can supply one: selecting a different
   *    option leaves the trigger showing `value`. `select` is not a precedent
   *    here — its renderer DOES pass a change handler, which is exactly why
   *    `select.tsx`'s `defaultValue` is a real initial value there.
   *
   * On a control whose selection cannot change, "what it starts at" and "what
   * it shows" are one question, so honouring this key could only have added a
   * second spelling of `value` — the consumer-side alias AGENTS.md #0.1 forbids.
   * Kept declared and unwritable rather than deleted, for the reason every
   * tombstone in this package states: `BaseSchema` is a passthrough mirror, so a
   * DELETED member parses green and is silently ignored — one silent no-op
   * traded for another. `?: never` makes authoring it a `tsc` error here, and
   * `retirementTombstone()` on the Zod twin (`zod/form.zod.ts`) makes it a NAMED
   * parse refusal carrying this remedy.
   *
   * @deprecated Not part of this contract — write `value`.
   */
  defaultValue?: never;
  /**
   * Controlled value
   */
  value?: string;
  /**
   * Help text or description — rendered as a paragraph BELOW the control and
   * tied to the trigger with `aria-describedby`, so assistive tech announces it
   * with the field (objectui#8140, the shape objectui#5735 established for
   * `element:text_input`). Omitted entirely when the key is absent.
   */
  description?: string;
  /**
   * Error message
   */
  error?: string;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `combobox` renderer forwards only `toFormControlDomProps`'s whitelist,
   * which drops it. The zod twin refuses it by name; author behaviour as a node
   * type (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onChange?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `combobox` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `description`, `options`, `placeholder`, `value` (in
   * `packages/components/src/renderers/form/combobox.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `combobox` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `combobox` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `description`, `options`, `placeholder`, `value` (in
   * `packages/components/src/renderers/form/combobox.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `combobox` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Command menu item
 */
export interface CommandItem {
  /**
   * Item value
   */
  value: string;
  /**
   * Item label (displayed to user)
   */
  label: string;
  /**
   * Item icon
   */
  icon?: string;
}

/**
 * Command menu group
 */
export interface CommandGroup {
  /**
   * Group heading
   */
  heading?: string;
  /**
   * Group items
   */
  items: CommandItem[];
}

/**
 * Command component (command palette)
 */
export interface CommandSchema extends BaseSchema {
  type: 'command';
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Empty state text
   */
  emptyText?: string;
  /**
   * Command groups
   */
  groups?: CommandGroup[];
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `command` renderer spreads it onto cmdk's root `<div>`, where React fires
   * it with a SyntheticEvent on keystrokes — a different contract from `(value:
   * string) => void`, not a consumer of it. The zod twin refuses it by name;
   * author behaviour as a node type (`{ "type": "toast" }`, an `action:button`
   * node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onChange?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `command` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `emptyText`, `groups`, `placeholder` (in
   * `packages/components/src/renderers/form/command.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `command` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `command` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `emptyText`, `groups`, `placeholder` (in
   * `packages/components/src/renderers/form/command.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `command` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Code editor component (`code-editor`), rendered by `@object-ui/plugin-editor`
 * over Monaco.
 *
 * Declared here — rather than only in the plugin — for the reason `markdown`
 * and `kanban` already are: `AnyComponentSchema` in `./zod/index.zod.ts` is the
 * union whose strict twin `objectui validate` and `objectui check` read, and a registered
 * component type absent from it validates as nothing at all (objectui#6318).
 * `@object-ui/types` has zero dependencies, so it cannot import the plugin's
 * own `CodeEditorSchema`; this is the same twin-declaration shape `markdown`
 * carries, and the zod mirror below it is pinned to THIS declaration.
 *
 * ⚠️ Every key is taken from a READ SITE, not from a view of what a code editor
 * ought to accept — `packages/plugin-editor/src/index.tsx:43-49` forwards
 * exactly `value`, `language`, `theme`, `height`, `onChange`, `readOnly` and
 * `className` into the lazy Monaco implementation, and the registration's own
 * `inputs`/`defaultProps` (same file, 64-77) name the same set.
 */
export interface CodeEditorSchema extends BaseSchema {
  type: 'code-editor';
  /**
   * The code content shown in the editor.
   *
   * Read at `plugin-editor/src/index.tsx:43` as `value ?? schema.value` — the
   * host prop wins, so this is the authored default rather than a controlled
   * value.
   */
  value?: string;
  /**
   * Monaco language id for syntax highlighting.
   *
   * Deliberately a bare `string` and not an enum: the renderer forwards it
   * verbatim to Monaco, which resolves any registered language id, and the
   * plugin's own declaration already widens its six-name list with `| string`.
   * The registration's `inputs` offer `javascript`, `typescript`, `python`,
   * `json`, `html` and `css` as the authoring shortlist — that is a picker
   * hint, not the accepted set.
   *
   * @default 'javascript'
   */
  language?: string;
  /**
   * Editor colour theme. Closed, unlike `language`: these are the two spellings
   * the plugin's `CodeEditorSchema` declares and the registration offers.
   *
   * @default 'vs-dark'
   */
  theme?: 'vs-dark' | 'light';
  /**
   * Editor height, forwarded to Monaco as a CSS length.
   *
   * @default '400px'
   */
  height?: string;
  /**
   * Whether the editor refuses edits.
   *
   * @default false
   */
  readOnly?: boolean;
  /**
   * Change handler. A runtime slot, not an authorable key — no JSON document
   * can carry a function.
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * read by `plugin-editor` (`onChange ?? schema.onChange`).
   */
  onChange?: (value: string | undefined) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `code-editor` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `code-editor` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `code-editor` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `code-editor` registration (`@object-ui/plugin-editor`) reads the node
   * through `CodeEditorRenderer`'s inline props type, which forwards `value`,
   * `language`, `theme`, `height`, `readOnly`, `className` and the `onChange`
   * callback to Monaco; none of them is the node's `body` or `children`.
   * `SchemaRenderer` strips `body` and `children` out of the props bag it
   * spreads, so neither reaches the component by another route, and the
   * registration declares no `children` slot (objectui#9910).
   *
   * What it renders instead: a Monaco editor over `value`, in `language` and
   * `theme`.
   *
   * @deprecated Not a channel `code-editor` reads — nothing renders it.
   */
  children?: never;
}

/**
 * `Omit` that KEEPS the named members of a type carrying an index signature
 * (objectui#9256, the `Omit` erasure the maintainer's ruling on objectui#8284
 * moved onto that card).
 *
 * The built-in `Omit<T, K>` is `Pick<T, Exclude<keyof T, K>>`, and `keyof T` on
 * a type carrying a string index signature (as every {@link BaseSchema}
 * extender did until objectui#8347) is `string | number`:
 * the literal member names are absorbed, `Exclude` leaves `string`, and the
 * `Pick` rebuilds the index signature and NONE of the named members (the same
 * mechanism objectui#6151 and objectui#6269 measured at other positions). The
 * two shorthand faces below were spelled that way, so every member they meant
 * to inherit — `BaseSchema`'s `body` refusal and `CalendarSchema`'s family-D
 * tombstones included — answered `any` on the published face.
 *
 * A key-remapping mapped type iterates the NAMED members and the index
 * signature separately, so filtering by name drops exactly `K`: every other
 * named member survives with its own type and modifiers, and the index
 * signature survives as itself. Not exported — it exists to spell these two
 * heritage clauses, and `__tests__/content-channel-e3-residual-9256.test.ts`
 * pins what it delivers on both faces.
 */
type OmitDeclared<T, K extends PropertyKey> = {
  [P in keyof T as P extends K ? never : P]: T[P];
};

/**
 * The `email` / `password` input shorthands
 * `packages/components/src/renderers/form/input.tsx` registers (objectui#8499).
 *
 * Both are the SAME renderer as `input`, wrapped so `inputType` is pinned:
 * `<InputRenderer {...props} schema={{ ...props.schema, inputType: 'password' }} />`.
 *
 * ⛔ `inputType` is therefore not a member here, and that is the whole
 * difference from {@link InputSchema}. The wrapper spreads its own value LAST,
 * so an authored `inputType` never reaches the renderer. Write
 * `{ type: 'input', inputType: 'email' }` when the input type is the choice.
 *
 * ⚠️ objectui#8499 shipped this interface with the key merely OMITTED, and
 * recorded why that was not enough: {@link BaseSchema} carried an index
 * signature then and its mirror is `.passthrough()`, so `inputType` rode through
 * both faces unchallenged while the renderer threw the value away. objectui#8762
 * closes that — the key is DECLARED and unwritable on both faces, so `tsc`
 * refuses it at the authoring site and the zod twin refuses it BY NAME with
 * guidance pointing at `{ type: 'input', inputType: 'email' }`.
 *
 * Mirror: `zod/form.zod.ts#InputShorthandSchema`.
 */
export interface InputShorthandSchema extends OmitDeclared<InputSchema, 'type' | 'inputType'> {
  type: 'email' | 'password';
  /**
   * ⛔ UNWRITABLE at this position (objectui#8762). The `email` / `password`
   * registration wrapper pins `inputType` itself and spreads it LAST, so an
   * authored value is discarded — `{ type: 'password', inputType: 'text' }`
   * renders a MASKED field. Write `{ type: 'input', inputType: 'email' }`
   * instead. The zod twin refuses it by name and carries the same guidance.
   *
   * ⚠️ Not a retirement of `inputType`: the key is alive and honoured on
   * {@link InputSchema}, and on the FORM FIELD path an authored `inputType`
   * still wins. It is this POSITION that cannot author it.
   */
  inputType?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `email` / `password` read
   * NEITHER content channel; see `children` below for the measurement.
   *
   * ⚠️ TYPE-REDUNDANT, KEPT ON PURPOSE. {@link InputSchema} declares the same
   * `?: never` pair since objectui#9256's `input` slice, and this interface's
   * `OmitDeclared` heritage carries it here, so the member below changes no
   * type. It stays because both faces of this arm speak for THIS node: the zod
   * twin's refusal message names `email` / `password` and the wrapper route
   * that reaches the `input` renderer, which the inherited `input` message does
   * not, and this docblock is what an editor shows on these two types.
   *
   * @deprecated Not a channel `email` / `password` read — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `email` / `password` read
   * NEITHER content channel, so an authored child list here rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: both registrations
   * spread the node into the `input` renderer with `inputType` pinned, and that
   * renderer reads it as {@link InputSchema} — no `body` / `children` read is
   * filed under that declaration, while the same instrument does see it as the
   * receiver of every key the renderer reads. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, and neither registration declares a
   * `children` slot (objectui#9910).
   *
   * What it renders instead: one input field — `label`, `placeholder`,
   * `value` / `defaultValue`, `description`, `error`, `required`.
   *
   * Type-redundant with the {@link InputSchema} member this interface inherits,
   * and kept for the reason given on `body` above.
   *
   * @deprecated Not a channel `email` / `password` read — nothing renders it.
   */
  children?: never;
}

/**
 * The date-picker primitive `packages/components/src/renderers/form/calendar.tsx`
 * registers, reachable at `ui:calendar` ONLY (objectui#8499).
 *
 * ⚠️ `ui:calendar` and `calendar` are DIFFERENT components. That registration
 * carries `skipFallback: true` because "`calendar` collides with the
 * plugin-calendar full CRUD calendar VIEW, which owns the bare `type: 'calendar'`
 * schema keyword; this date-picker primitive is reached via `ui:calendar` only."
 * So the namespaced spelling is not a stylistic variant of {@link CalendarSchema}
 * — it is the only spelling that resolves to this renderer.
 *
 * Five catalog fixtures under
 * `examples/schema-catalog/src/schemas/components-form-calendar/` author it; every
 * one rendered and every one was refused by `AnyComponentSchema` until this arm.
 *
 * Every member is {@link CalendarSchema}'s — `mode`, the selection keys and its
 * two content-channel tombstones included — through {@link OmitDeclared}. The
 * heritage used to be a plain `Omit`, which collapsed into `BaseSchema`'s index
 * signature and left this face declaring `type` alone (objectui#9256). Nothing
 * new is refused here: this face now carries what `CalendarSchema` already
 * declared and what the mirror, a `.extend()` of it, already refused.
 *
 * Mirror: `zod/form.zod.ts#UiCalendarSchema`.
 */
export interface UiCalendarSchema extends OmitDeclared<CalendarSchema, 'type'> {
  type: 'ui:calendar';
}

/**
 * Union type of all form schemas
 */
export type FormComponentSchema =
  | ButtonSchema
  | InputSchema
  | TextareaSchema
  | SelectSchema
  | CheckboxSchema
  | RadioGroupSchema
  | SwitchSchema
  | ToggleSchema
  | SliderSchema
  | FileUploadSchema
  | DatePickerSchema
  | CalendarSchema
  | InputOTPSchema
  | FormSchema
  | LabelSchema
  | ComboboxSchema
  | CommandSchema
  | CodeEditorSchema
  | InputShorthandSchema
  | UiCalendarSchema;

