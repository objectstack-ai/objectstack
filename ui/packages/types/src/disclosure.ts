/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Disclosure Component Schemas
 * 
 * Type definitions for collapsible and expandable components.
 * 
 * @module disclosure
 * @packageDocumentation
 */

import type { BaseSchema, SchemaNode } from './base.js';

/**
 * Accordion item
 */
export interface AccordionItem {
  /**
   * Unique item identifier
   */
  value: string;
  /**
   * Item title/trigger
   */
  title: string;
  /**
   * Item content
   */
  content: SchemaNode | SchemaNode[];
  /**
   * Whether item is disabled
   *
   * Forwarded to the underlying accordion item by the `accordion` renderer,
   * matching the item-level `disabled` that `tabs`, `select`, `dropdown-menu`,
   * `menubar`, `context-menu` and `toggle-group` already honor.
   */
  disabled?: boolean;
}

/**
 * Accordion component
 */
export interface AccordionSchema extends BaseSchema {
  type: 'accordion';
  /**
   * Accordion items
   */
  items: AccordionItem[];
  /**
   * Accordion type
   * @default 'single'
   */
  accordionType?: 'single' | 'multiple';
  /**
   * Whether items are collapsible
   * @default true
   */
  collapsible?: boolean;
  /**
   * Default expanded item values
   */
  defaultValue?: string | string[];
  /**
   * Controlled expanded item values
   */
  value?: string | string[];
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `Accordion` root by the renderer's `{...props}`.
   */
  onValueChange?: (value: string | string[]) => void;
  /**
   * Accordion variant
   * @default 'default'
   */
  variant?: 'default' | 'bordered' | 'separated';
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `accordion` reads NEITHER content
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
   * off this node: `accordionType`, `collapsible`, `items` (in `packages/components/src/renderers/disclosure/accordion.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "accordion" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:accordion`
   * as the SOLE claimant of the bare key, because `page:accordion` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
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
   * @deprecated Not a channel `accordion` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `accordion` reads NEITHER content
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
   * off this node: `accordionType`, `collapsible`, `items` (in `packages/components/src/renderers/disclosure/accordion.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "accordion" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:accordion`
   * as the SOLE claimant of the bare key, because `page:accordion` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
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
   * @deprecated Not a channel `accordion` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Collapsible component
 */
export interface CollapsibleSchema extends BaseSchema {
  type: 'collapsible';
  /**
   * Trigger content/label -- a node OR a node array.
   *
   * READ SITE: `packages/components/src/renderers/disclosure/collapsible.tsx:25`
   * -- `renderChildren(schema.trigger)` inside `CollapsibleTrigger`, whose
   * `Array.isArray` branch (`packages/components/src/lib/utils.tsx:23`) serves
   * the array form, and the registration's own `defaultProps.trigger` in that
   * same file SHIPS that array. The same spelling the overlay family's
   * `trigger` declares since objectui#7081, carried onto this eighth member by
   * objectui#7767.
   *
   * The `string |` this used to carry was redundant, not an extra: `SchemaNode`
   * (`./base`) is `BaseSchema | string | number | boolean | null | undefined`,
   * so `string | SchemaNode` collapses to `SchemaNode`.
   */
  trigger: SchemaNode | SchemaNode[];
  /**
   * Collapsible content
   */
  content: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * RETIRED (objectui#8236, ADR-0049 enforce-or-remove; maintainer ruling
   * 2026-09-17 「9593 A,其他同意」, step 2 of two).
   *
   * ⚠️ This key was never inert, and the card that filed it as inert was WRONG
   * in the dangerous direction — read this before "restoring" it.
   * `SchemaRenderer` spreads every non-metadata node key as a React prop, and
   * the `collapsible` renderer forwarded that spread onto the Radix root
   * LAST — after the `defaultOpen` it writes explicitly. So an authored `open`
   * made the primitive CONTROLLED without any `schema.open` read existing
   * anywhere: MEASURED through the real renderer and the real registry, in both
   * polarities, `open: true` froze the trigger open and `open: false` froze it
   * shut and beat `defaultOpen: true`
   * (`packages/components/src/__tests__/collapsible-open-intercept-8236.test.tsx`).
   *
   * The other half of controlled state cannot be authored: {@link
   * CollapsibleSchema.onOpenChange} is a RUNTIME SLOT refused by name on the
   * zod face (objectui#6124), and JSON has no function value — so a document
   * that wrote `open` could never write the handler that moves it. That is the
   * whole content of the refusal message, and it is why 「author `defaultOpen`
   * instead」 is NOT an equivalent: `defaultOpen` seeds the INITIAL state and
   * then hands control back to the user, which is a different capability.
   *
   * ⚠️ Retiring this declaration does NOT by itself stop the takeover — the
   * render path runs no `safeParse` (`ee70287e4`'s pin measures it NOT GATED), so a
   * refused key still rides the spread. The renderer-side named exclusion
   * landed FIRST, in the same change, for exactly that reason; ⛔ do not remove
   * it on the strength of this tombstone.
   *
   * `?: never` is the twin of `zod/disclosure.zod.ts`'s `retirementTombstone`
   * arm: the pair is what `__tests__/zod-mirror-parity.test.ts` compares, and it
   * is what makes `tsc` refuse the key at the authoring site before anything
   * runs.
   * @deprecated Not authorable in SDUI — use `defaultOpen` for the initial state.
   */
  open?: never;
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `Collapsible` root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `collapsible` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `trigger` (in
   * `packages/components/src/renderers/disclosure/collapsible.tsx`).
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
   * @deprecated Not a channel `collapsible` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `collapsible` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `trigger` (in
   * `packages/components/src/renderers/disclosure/collapsible.tsx`).
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
   * @deprecated Not a channel `collapsible` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Toggle group item
 */
export interface ToggleGroupItem {
  /**
   * Item value
   */
  value: string;
  /**
   * Item label
   */
  label: string;
  /**
   * Whether item is disabled
   *
   * Forwarded to the underlying toggle item by the `toggle-group` renderer,
   * matching the item-level `disabled` that `tabs`, `select`, `dropdown-menu`,
   * `menubar` and `context-menu` already honor.
   */
  disabled?: boolean;
}

/**
 * Toggle group component
 */
export interface ToggleGroupSchema extends BaseSchema {
  type: 'toggle-group';
  /**
   * Toggle group selection mode
   * @default 'single'
   */
  selectionType?: 'single' | 'multiple';
  /**
   * Toggle group variant
   * @default 'default'
   */
  variant?: 'default' | 'outline';
  /**
   * Toggle group size
   * @default 'default'
   */
  size?: 'default' | 'sm' | 'lg';
  /**
   * Toggle group items
   */
  items?: ToggleGroupItem[];
  /**
   * Default selected value(s)
   */
  defaultValue?: string | string[];
  /**
   * Controlled selected value(s)
   */
  value?: string | string[];
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `ToggleGroup` root by the renderer's
   * `{...toggleGroupProps}`.
   */
  onValueChange?: (value: string | string[]) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `toggle-group` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `items`, `selectionType`, `size`, `value`, `variant` (in
   * `packages/components/src/renderers/disclosure/toggle-group.tsx`).
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
   * @deprecated Not a channel `toggle-group` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `toggle-group` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `items`, `selectionType`, `size`, `value`, `variant` (in
   * `packages/components/src/renderers/disclosure/toggle-group.tsx`).
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
   * @deprecated Not a channel `toggle-group` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Union type of all disclosure schemas
 */
export type DisclosureSchema =
  | AccordionSchema
  | CollapsibleSchema
  | ToggleGroupSchema;
