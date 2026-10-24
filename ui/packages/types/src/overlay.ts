/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Overlay Component Schemas
 * 
 * Type definitions for modal, dialog, and overlay components.
 * 
 * @module overlay
 * @packageDocumentation
 */

import type { BaseSchema, SchemaNode } from './base.js';

/**
 * Position type for overlays
 */
export type OverlayPosition = 'top' | 'right' | 'bottom' | 'left';

/**
 * Alignment type for overlays
 */
export type OverlayAlignment = 'start' | 'center' | 'end';

/**
 * Dialog component
 */
export interface DialogSchema extends BaseSchema {
  type: 'dialog';
  /**
   * Dialog title
   */
  title?: string;
  /**
   * Dialog description
   */
  description?: string;
  /**
   * Dialog content
   */
  content?: SchemaNode | SchemaNode[];
  /**
   * Dialog trigger (button or element that opens the dialog)
   *
   * READ SITE: `packages/components/src/renderers/overlay/dialog.tsx` —
   * `renderTriggerSlot(DialogTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren` and whose
   * `Array.isArray` branch in `packages/components/src/lib/utils.tsx`
   * serves the array form; the same spelling {@link ContextMenuSchema.trigger}
   * declares (objectui#7081).
   */
  trigger?: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Dialog footer content
   */
  footer?: SchemaNode | SchemaNode[];
  /**
   * Whether dialog is modal (prevents interaction with background)
   * @default true
   */
  modal?: boolean;
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `Dialog` root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `dialog` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `description`, `footer`, `modal`, `title`,
   * `trigger` (in `packages/components/src/renderers/overlay/dialog.tsx`).
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
   * @deprecated Not a channel `dialog` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `dialog` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `description`, `footer`, `modal`, `title`,
   * `trigger` (in `packages/components/src/renderers/overlay/dialog.tsx`).
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
   * @deprecated Not a channel `dialog` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Alert dialog (confirmation dialog)
 */
export interface AlertDialogSchema extends BaseSchema {
  type: 'alert-dialog';
  /**
   * Dialog title
   */
  title?: string;
  /**
   * Dialog description
   */
  description?: string;
  /**
   * Dialog body, rendered between the header (title / description) and the
   * footer — the same slot every sibling overlay declares.
   *
   * Declared for objectui#7104: the `alert-dialog` renderer reads
   * `schema.content` through `renderChildren`; until then the key was accepted
   * only through `BaseSchema`'s index signature.
   */
  content?: SchemaNode | SchemaNode[];
  /**
   * Dialog trigger
   *
   * READ SITE: `packages/components/src/renderers/overlay/alert-dialog.tsx` —
   * `renderTriggerSlot(AlertDialogTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren` and whose
   * `Array.isArray` branch in `packages/components/src/lib/utils.tsx`
   * serves the array form; the same spelling {@link ContextMenuSchema.trigger}
   * declares (objectui#7081).
   */
  trigger?: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Cancel button label. The renderer draws `AlertDialogCancel` ONLY when this
   * is set — omit it and no cancel button renders. There is no renderer
   * default; the designer palette seeds `'Cancel'`.
   *
   * Declared for objectui#7104: this is the key the renderer reads and the key
   * its registered `inputs` and `defaultProps` ship. `cancelLabel` below is the
   * RETIRED twin (objectui#7963) — declared only so an author who writes it is
   * refused by name and pointed back here.
   */
  cancelText?: string;
  /**
   * Confirm (action) button label. The renderer draws `AlertDialogAction` ONLY
   * when this is set — omit it and no confirm button renders. There is no
   * renderer default; the designer palette seeds `'Continue'`.
   *
   * Declared for objectui#7104: this is the key the renderer reads and the key
   * its registered `inputs` and `defaultProps` ship. `confirmLabel` below is the
   * RETIRED twin (objectui#7963) — declared only so an author who writes it is
   * refused by name and pointed back here.
   */
  actionText?: string;
  /**
   * Variant of the confirm (action) button — `'destructive'` for the red
   * confirm a delete dialog wants. Omit it and the button keeps the exact look
   * it has always had.
   *
   * READ SITE: `packages/components/src/renderers/overlay/alert-dialog.tsx` —
   * the renderer turns the value into `buttonVariants({ variant })` and hands
   * it to `AlertDialogAction` as `className`, which `cn()` (tailwind-merge)
   * resolves over the primitive's baked-in `buttonVariants()`. An OVERRIDE
   * rather than a prop because `packages/components/src/ui/**` is a No-Touch
   * zone (AGENTS.md Commandment #7) and `AlertDialogAction` accepts no variant;
   * `packages/components/src/notifications/NotificationAlerts.tsx` already
   * expresses a footer variant on this very button the same way.
   *
   * ⚠️ WHY TWO VALUES AND NOT `ButtonSchema.variant`'s six (`./form.ts`).
   * ⛔ Not deference to the ruling that named these two — a MEASUREMENT of the
   * override channel, re-derived by the pin below rather than recorded here:
   * an override can only displace a baked-in class that shares its
   * tailwind-merge group, and three of the six upstream variants set no
   * background and/or no text colour at all, so the default's `bg-primary` /
   * `text-primary-foreground` survive underneath them. Declaring a value this
   * node cannot actually render is the {@link confirmVariant} disease one level
   * down, at the value instead of the key. The pin measures every declared
   * value AND every undeclared one, so widening the union without widening the
   * mechanism reds.
   *
   * ⭐ The DOM reading, not the wiring, is the contract: the pin
   * `packages/components/src/__tests__/alert-dialog-action-variant-8978.test.tsx`
   * reads the confirm button's own `class` off the rendered dialog, with a
   * firing control on the default. Declared for objectui#8978, which carries
   * the capability decision batch #70 granted after {@link confirmVariant} was
   * measured inert.
   */
  actionVariant?: 'default' | 'destructive';
  /**
   * RETIRED (objectui#7963, ADR-0049 enforce-or-remove; maintainer ruling
   * 2026-09-10) — nothing has ever read this key, so an authored label drew no
   * button at all. Measured on this branch's BASE `72bcd7783` with a
   * POINT-ACCESS probe: `schema.cancelLabel` scores **0** tree-wide, against
   * the FIRING CONTROLS on the very renderer under test
   * (`packages/components/src/renderers/overlay/alert-dialog.tsx`) —
   * `schema.cancelText` = **15**, read at `:37`, and `schema.actionText` =
   * **5**, read at `:38`.
   * ⛔ A bare-word probe is worthless here and would fail towards "live": every
   * OTHER owner of this spelling is a live key on a DIFFERENT declaration —
   * `FormSchema.cancelLabel` (`./form.ts`), `plugin-designer`'s `ConfirmDialog` React
   * prop, and `plugin-form`'s `ModalForm` / `DrawerForm`, which BUILD a local
   * `cancelLabel` FROM `schema.cancelText`. None of them is an
   * `AlertDialogSchema`, and none of them is touched.
   * The key reached the Radix root through the rest-spread and stopped there —
   * that root renders a context provider, not an element, so the prop was
   * dropped before any DOM node
   * (`packages/components/src/__tests__/alert-dialog-footer-keys-liveness-7963.test.tsx`).
   * `BaseSchema` closed with `[key: string]: any` (until objectui#8347), so the
   * value was never refused, only KEPT.
   *
   * Write {@link cancelText} instead — the key the renderer reads.
   *
   * `?: never` is the twin of `zod/overlay.zod.ts`'s `retirementTombstone` arm:
   * the pair is what `__tests__/zod-mirror-parity.test.ts` compares, and it is
   * what makes `tsc` refuse the key at the authoring site before anything runs.
   * @deprecated Not part of this contract — the value was inert. Use `cancelText`.
   */
  cancelLabel?: never;
  /**
   * RETIRED (objectui#7963, ADR-0049 enforce-or-remove; maintainer ruling
   * 2026-09-10) — nothing has ever read this key, so an authored label drew no
   * button at all. Same frame and the same two controls as
   * {@link cancelLabel}: `schema.confirmLabel` scores **0** tree-wide on BASE
   * `72bcd7783`. Its other owners are live keys on other declarations
   * (`objectql.ts`, `plugin-designer`'s `ConfirmDialog` prop, `plugin-grid`'s
   * `def.confirmLabel`), ⛔ none of them an `AlertDialogSchema`.
   *
   * Write {@link actionText} instead — the key the renderer reads.
   * @deprecated Not part of this contract — the value was inert. Use `actionText`.
   */
  confirmLabel?: never;
  /**
   * RETIRED (objectui#7963, ADR-0049 enforce-or-remove; maintainer ruling
   * 2026-09-10) — nothing has ever read this key. `schema.confirmVariant`
   * scores **0** tree-wide on BASE `72bcd7783` under the same two controls, and
   * the DOM reading is sharper still: with the key authored, the confirm
   * button's own `class` is byte-identical to the reading without it, measured
   * against a `VARIANT_INSTRUMENT` control proving that same reading DOES
   * separate the cancel button's variant from the action button's on this very
   * DOM.
   *
   * ⚠️ This key stays RETIRED — ⛔ it was not un-retired when the capability it
   * was supposed to carry arrived. {@link cancelText} / {@link actionText} are
   * the footer's two LABELS and are still NOT it. The separate card the
   * retirement named is objectui#8978, and it answered: the confirm button IS
   * styleable from metadata, under {@link actionVariant} — a spelling in the
   * `action*` dialect this node already uses for that button, chosen so that no
   * published key is retired and then re-added under the same name.
   *
   * Write {@link actionVariant} instead.
   * @deprecated Not part of this contract — the value was inert. Use `actionVariant`.
   */
  confirmVariant?: never;
  /**
   * Confirm (action) button click handler.
   *
   * RUNTIME SLOT (objectui#6124 shape; declared by objectui#7104) — a
   * host-supplied function, NOT authorable metadata: JSON has no function
   * value, so the zod twin refuses this key by name and points at the
   * node-type spelling. Kept callable here because the renderer wires it as
   * `AlertDialogAction`'s `onClick`. It is the live key the retired
   * `onConfirm` below points at.
   */
  onAction?: () => void;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `alert-dialog` renderer wires its action button to `schema.onAction` and
   * never reads it. The zod twin refuses it by name; author behaviour as a node
   * type (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onConfirm?: never;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `alert-dialog` renderer spreads it onto the Radix root, which has no such
   * prop; the cancel button is `AlertDialogCancel`. The zod twin refuses it by
   * name; author behaviour as a node type (`{ "type": "toast" }`, an
   * `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onCancel?: never;
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `AlertDialog` root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `alert-dialog` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `actionText`, `actionVariant`, `cancelText`, `content`, `defaultOpen`,
   * `description`, `onAction`, `title`, `trigger` (in
   * `packages/components/src/renderers/overlay/alert-dialog.tsx`).
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
   * @deprecated Not a channel `alert-dialog` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `alert-dialog` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `actionText`, `actionVariant`, `cancelText`, `content`, `defaultOpen`,
   * `description`, `onAction`, `title`, `trigger` (in
   * `packages/components/src/renderers/overlay/alert-dialog.tsx`).
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
   * @deprecated Not a channel `alert-dialog` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Sheet/Drawer side panel
 */
export interface SheetSchema extends BaseSchema {
  type: 'sheet';
  /**
   * Sheet title
   */
  title?: string;
  /**
   * Sheet description
   */
  description?: string;
  /**
   * Sheet content
   */
  content?: SchemaNode | SchemaNode[];
  /**
   * Sheet trigger
   *
   * READ SITE: `packages/components/src/renderers/overlay/sheet.tsx` —
   * `renderTriggerSlot(SheetTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren` and whose
   * `Array.isArray` branch in `packages/components/src/lib/utils.tsx`
   * serves the array form; the same spelling {@link ContextMenuSchema.trigger}
   * declares (objectui#7081).
   */
  trigger?: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Sheet side
   * @default 'right'
   */
  side?: OverlayPosition;
  /**
   * Sheet footer content
   */
  footer?: SchemaNode | SchemaNode[];
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `Sheet` (Dialog) root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `sheet` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `description`, `footer`, `modal`, `side`,
   * `title`, `trigger` (in
   * `packages/components/src/renderers/overlay/sheet.tsx`).
   * The `modal` read has since been retired (objectui#11347): it was never a
   * member here and no producer authored it.
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
   * @deprecated Not a channel `sheet` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `sheet` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `description`, `footer`, `modal`, `side`,
   * `title`, `trigger` (in
   * `packages/components/src/renderers/overlay/sheet.tsx`).
   * The `modal` read has since been retired (objectui#11347): it was never a
   * member here and no producer authored it.
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
   * @deprecated Not a channel `sheet` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Drawer component (alternative name for Sheet)
 */
export interface DrawerSchema extends BaseSchema {
  type: 'drawer';
  /**
   * Drawer title
   */
  title?: string;
  /**
   * Drawer description
   */
  description?: string;
  /**
   * Drawer content
   */
  content?: SchemaNode | SchemaNode[];
  /**
   * Drawer trigger
   *
   * READ SITE: `packages/components/src/renderers/overlay/drawer.tsx` —
   * `renderTriggerSlot(DrawerTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren` and whose
   * `Array.isArray` branch in `packages/components/src/lib/utils.tsx`
   * serves the array form; the same spelling {@link ContextMenuSchema.trigger}
   * declares (objectui#7081).
   */
  trigger?: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Drawer direction
   * @default 'right'
   */
  direction?: OverlayPosition;
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the vaul `Drawer` root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `drawer` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `description`, `footer`, `shouldScaleBackground`,
   * `showClose`, `title`, `trigger` (in
   * `packages/components/src/renderers/overlay/drawer.tsx`).
   * The `footer`, `shouldScaleBackground` and `showClose` reads have since
   * been retired (objectui#11347): none was ever a member here and no producer
   * authored any of them.
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
   * @deprecated Not a channel `drawer` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `drawer` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `content`, `defaultOpen`, `description`, `footer`, `shouldScaleBackground`,
   * `showClose`, `title`, `trigger` (in
   * `packages/components/src/renderers/overlay/drawer.tsx`).
   * The `footer`, `shouldScaleBackground` and `showClose` reads have since
   * been retired (objectui#11347): none was ever a member here and no producer
   * authored any of them.
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
   * @deprecated Not a channel `drawer` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Popover component
 */
export interface PopoverSchema extends BaseSchema {
  type: 'popover';
  /**
   * Popover content
   */
  content: SchemaNode | SchemaNode[];
  /**
   * Popover trigger
   *
   * READ SITE: `packages/components/src/renderers/overlay/popover.tsx` —
   * `renderTriggerSlot(PopoverTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren` and whose
   * `Array.isArray` branch in `packages/components/src/lib/utils.tsx`
   * serves the array form; the same spelling {@link ContextMenuSchema.trigger}
   * declares (objectui#7081).
   */
  trigger: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Popover side
   * @default 'bottom'
   */
  side?: OverlayPosition;
  /**
   * Popover alignment
   * @default 'center'
   */
  align?: OverlayAlignment;
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `Popover` root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `popover` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `align`, `content`, `defaultOpen`, `modal`, `side`, `trigger` (in
   * `packages/components/src/renderers/overlay/popover.tsx`).
   * The `modal` read has since been retired (objectui#11347): it was never a
   * member here and no producer authored it.
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
   * @deprecated Not a channel `popover` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `popover` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `align`, `content`, `defaultOpen`, `modal`, `side`, `trigger` (in
   * `packages/components/src/renderers/overlay/popover.tsx`).
   * The `modal` read has since been retired (objectui#11347): it was never a
   * member here and no producer authored it.
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
   * @deprecated Not a channel `popover` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Tooltip component
 *
 * ⚠️ This declaration used to REQUIRE `children` and declare neither `trigger`
 * nor a rich-content slot (`bfaa1589c`). The renderer reads `schema.trigger`
 * and `schema.content || renderChildren(…)`
 * (`packages/components/src/renderers/overlay/tooltip.tsx`), and the
 * registration's own `inputs` list `trigger` / `content` / that slot. ⚠️ The
 * slot was spelled `body` from `bfaa1589c` until objectui#6771 retired the
 * spelling; it is `children` on both the read and the published `inputs` now,
 * which is why the tombstones below face the other way round from the ones
 * objectui#8284 first wrote. `children` was legal through {@link BaseSchema}
 * throughout, where it is optional; it is no longer demanded, so nothing that
 * type-checked before
 * stops type-checking.
 *
 * ⛔ Do not move a tooltip's trigger back under `children`: `basic-tooltip`
 * was already moved from `children` to `trigger` on render evidence
 * (objectui#4626 — a measured blank tile) and reverting it is a named
 * regression.
 */
export interface TooltipSchema extends BaseSchema {
  type: 'tooltip';
  /**
   * Element the tooltip attaches to.
   *
   * READ SITE: `packages/components/src/renderers/overlay/tooltip.tsx` —
   * `renderTriggerSlot(TooltipTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren`. The same spelling
   * {@link HoverCardSchema.trigger} declares, which is the settled in-repo
   * shape for this slot.
   */
  trigger?: SchemaNode | SchemaNode[];
  /**
   * Tooltip text — the FIRST half of the content read.
   *
   * READ SITE: `packages/components/src/renderers/overlay/tooltip.tsx` —
   * `schema.content || renderChildren(schema.children)`. Optional because
   * {@link TooltipSchema.children} is the other half of that same read.
   *
   * TEXT ONLY (objectui#10295). The read places `content` raw in a React child
   * position, never through `renderChildren`, so a node here failed to render
   * ("Objects are not valid as a React child"). This key is objectui's own (the
   * spec declares no tooltip node), so it follows its read site: author a node
   * or a list of nodes under {@link TooltipSchema.children}.
   *
   * ⚠️ Precedence, as the read stands: a non-empty `content` WINS and an
   * authored `children` is not rendered at all; an empty string falls through
   * to `children`.
   */
  content?: string;
  /**
   * RETIRED (objectui#6771, maintainer ruling 2026-09-01) — the `body`
   * child-list spelling. Author {@link TooltipSchema.children}.
   *
   * ⭐ `tooltip` was the ONE registration in the whole tree that ADVERTISED
   * this spelling in its `inputs` (a `slot`, labelled "Rich Content"), which
   * made it the most discoverable instance of the dialect on the authoring
   * surface — and the ruled step-2 population never listed it. Leaving it out
   * would have kept the dialect alive precisely where an author was most
   * likely to meet it, so it converged with the rest.
   *
   * @deprecated Retired spelling of `children` — author `children`.
   */
  body?: never;
  /**
   * Rich tooltip content — the FALLBACK half of the same read at
   * `packages/components/src/renderers/overlay/tooltip.tsx`, and the slot the
   * registration publishes as "Rich Content".
   *
   * ⚠️ THIS DECLARATION IS AN INVERSION, not a widening. objectui#8284 (ADR-0049,
   * maintainer ruling summon #17 decision batch #2, 2026-09-07) tombstoned
   * `children` on this node with the measured ground that the renderer read
   * `schema.content || renderChildren(schema.body)` and no read consumed
   * `children`. objectui#6771 changed the READ, not the principle: the same
   * renderer now reads `schema.content || renderChildren(schema.children)`, so
   * the channel this node does not read is `body`, and that is where the
   * tombstone moved. The per-component rule — tombstone the channel the
   * renderer does not read, on both published faces — is unchanged and is
   * still what both of these members express.
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * Tooltip side
   * @default 'top'
   */
  side?: OverlayPosition;
  /**
   * Tooltip alignment
   * @default 'center'
   */
  align?: OverlayAlignment;
  /**
   * Delay before showing (ms)
   * @default 200
   */
  delayDuration?: number;
}

/**
 * Hover card component
 */
export interface HoverCardSchema extends BaseSchema {
  type: 'hover-card';
  /**
   * Hover card content
   */
  content: SchemaNode | SchemaNode[];
  /**
   * Hover trigger element
   *
   * READ SITE: `packages/components/src/renderers/overlay/hover-card.tsx` —
   * `renderTriggerSlot(HoverCardTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren` and whose
   * `Array.isArray` branch in `packages/components/src/lib/utils.tsx`
   * serves the array form; the same spelling {@link ContextMenuSchema.trigger}
   * declares (objectui#7081).
   */
  trigger: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Hover card side
   * @default 'bottom'
   */
  side?: OverlayPosition;
  /**
   * Open delay (ms)
   * @default 200
   */
  openDelay?: number;
  /**
   * Close delay (ms)
   * @default 300
   */
  closeDelay?: number;
  /**
   * Alignment of the card against its trigger.
   *
   * READ SITE: `packages/components/src/renderers/overlay/hover-card.tsx` —
   * `align={schema.align}` on `HoverCardContent`, beside the already-declared
   * `side={schema.side}`.
   *
   * Same vocabulary as {@link DropdownMenuSchema.align} and
   * {@link PopoverSchema.align}; declared by objectui#6150.
   */
  align?: OverlayAlignment;
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `HoverCard` root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `hover-card` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `align`, `closeDelay`, `content`, `openDelay`, `side`, `trigger` (in
   * `packages/components/src/renderers/overlay/hover-card.tsx`).
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
   * @deprecated Not a channel `hover-card` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `hover-card` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `align`, `closeDelay`, `content`, `openDelay`, `side`, `trigger` (in
   * `packages/components/src/renderers/overlay/hover-card.tsx`).
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
   * @deprecated Not a channel `hover-card` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Menu item — a clickable command, or a divider between groups of commands.
 *
 * A discriminated union (objectui#6523): a divider has no label and a command
 * item always has one, so a single object with an optional `label` cannot
 * express "this is a divider" without leaving the divider arm unrepresentable
 * — the shipped renderers' own `defaultProps` for a divider
 * (`{ separator: true }`, no `label`) failed a strict parse against the old
 * shape. `label` stays REQUIRED on the command arm rather than becoming
 * optional, which would have weakened every command item's label protection
 * to solve a problem only the divider arm has.
 *
 * `type` is TOMBSTONED (`?: never`) on both arms. It is not merely
 * undeclared: `dropdown-menu`/`context-menu` used to branch on an undeclared
 * `item.type === 'separator'` (and `=== 'label'`) instead of the declared
 * `separator` key, and a bare (non-strict) zod object silently stripped that
 * key on parse, so no gate ever caught the two renderers reading a spelling
 * the type never declared. Declaring `type?: never` makes authoring it a
 * refusal at parse/type-check time instead of a silent no-op (ADR-0049).
 */
export type MenuItem = MenuCommandItem | MenuDividerItem;

/**
 * The command arm of {@link MenuItem} — a clickable, labelled entry.
 */
export interface MenuCommandItem {
  /**
   * Menu item label
   */
  label: string;
  /**
   * Menu item icon
   */
  icon?: string;
  /**
   * Whether item is disabled
   */
  disabled?: boolean;
  /**
   * Click handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `dropdown-menu` / `context-menu` / `menubar` renderers
   * (`item.onClick?.()`).
   */
  onClick?: () => void;
  /**
   * Keyboard shortcut
   */
  shortcut?: string;
  /**
   * Submenu items
   */
  children?: MenuItem[];
  /**
   * Not a divider — present (typed `false`) only so the union can discriminate
   * on this key without every command item needing to omit it.
   */
  separator?: false;
  /**
   * RETIRED (objectui#6523) — dividers are spelled `{ separator: true }`.
   * `dropdown-menu`/`context-menu` used to read an undeclared `type` key
   * instead (`'separator'` for a divider, `'label'` for a section heading);
   * neither spelling is part of the contract, so authoring `type` is refused
   * rather than silently stripped.
   */
  type?: never;
}

/**
 * The divider arm of {@link MenuItem} — renders as a separator between
 * groups of commands. Deliberately carries no label and no other command
 * fields: a divider is not a command with blank details, it is a different
 * kind of row.
 */
export interface MenuDividerItem {
  /**
   * Renders as a divider (see {@link MenuItem}'s doc comment for why this is
   * a separate arm rather than an optional flag on a single shape).
   */
  separator: true;
  /**
   * RETIRED (objectui#6523) — see {@link MenuCommandItem.type}.
   */
  type?: never;
}

/**
 * Dropdown menu component
 */
export interface DropdownMenuSchema extends BaseSchema {
  type: 'dropdown-menu';
  /**
   * Menu items
   */
  items: MenuItem[];
  /**
   * Menu trigger
   *
   * READ SITE: `packages/components/src/renderers/overlay/dropdown-menu.tsx` —
   * `renderTriggerSlot(DropdownMenuTrigger, schema.trigger)` (objectui#9710), whose
   * shared seam renders the slot through `renderChildren` and whose
   * `Array.isArray` branch in `packages/components/src/lib/utils.tsx`
   * serves the array form; the same spelling {@link ContextMenuSchema.trigger}
   * declares (objectui#7081).
   */
  trigger: SchemaNode | SchemaNode[];
  /**
   * Default open state
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Menu side
   * @default 'bottom'
   */
  side?: OverlayPosition;
  /**
   * Menu alignment
   * @default 'start'
   */
  align?: OverlayAlignment;
  /**
   * Open state change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `DropdownMenu` root by the renderer's `{...props}`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `dropdown-menu` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `align`, `defaultOpen`, `items`, `label`, `modal`, `side`, `trigger` (in
   * `packages/components/src/renderers/overlay/dropdown-menu.tsx`).
   * The `modal` read has since been retired (objectui#11347): it was never a
   * member here and no producer authored it.
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
   * @deprecated Not a channel `dropdown-menu` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `dropdown-menu` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `align`, `defaultOpen`, `items`, `label`, `modal`, `side`, `trigger` (in
   * `packages/components/src/renderers/overlay/dropdown-menu.tsx`).
   * The `modal` read has since been retired (objectui#11347): it was never a
   * member here and no producer authored it.
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
   * @deprecated Not a channel `dropdown-menu` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Context menu component
 *
 * ⚠️ This declaration used to REQUIRE `children`, which no read site consumes
 * (`bfaa1589c`): the renderer reads `schema.trigger` and `schema.items`
 * (`packages/components/src/renderers/overlay/context-menu.tsx:95,99`), so a
 * document authoring its right-clickable area under `children` loses it to the
 * hardcoded placeholder. `children` stays legal through {@link BaseSchema},
 * where it is optional; it is simply no longer demanded.
 */
export interface ContextMenuSchema extends BaseSchema {
  type: 'context-menu';
  /**
   * Menu items
   */
  items: MenuItem[];
  /**
   * The right-clickable area's content.
   *
   * READ SITE: `packages/components/src/renderers/overlay/context-menu.tsx:95`
   * — `renderChildren(schema.trigger || { type: 'text', content: 'Right click here' })`
   * inside `ContextMenuTrigger`. ⚠️ Note the renderer renders `trigger`, NOT
   * `children` — which this member used to sit beside as a REQUIRED key and
   * which no read site consumes (`bfaa1589c` dropped that requirement;
   * `children` is now only {@link BaseSchema}'s optional one).
   *
   * Declared OPTIONAL: the renderer substitutes a placeholder when it is
   * absent, so every document without a `trigger` is legal today and declaring
   * it required would refuse them. Declared by objectui#6150.
   */
  trigger?: SchemaNode | SchemaNode[];
  /**
   * Classes for the right-clickable area.
   *
   * READ SITE: `packages/components/src/renderers/overlay/context-menu.tsx:87`
   * — first in `schema.triggerClassName || className || schema.className ||
   * <a dashed-border default>`. Undeclared until `bfaa1589c`, surviving only
   * on `BaseSchema`'s index signature.
   */
  triggerClassName?: string;
  /**
   * Classes for the menu panel.
   *
   * READ SITE: `packages/components/src/renderers/overlay/context-menu.tsx:88`,
   * applied to `ContextMenuContent` at :98. Undeclared until `bfaa1589c`.
   */
  contentClassName?: string;
  /**
   * Forwarded to the Radix `ContextMenu` root — `modal={schema.modal}` at
   * `packages/components/src/renderers/overlay/context-menu.tsx:91`.
   * Undeclared until `bfaa1589c`.
   */
  modal?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `context-menu` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `contentClassName`, `items`, `modal`, `trigger`,
   * `triggerClassName` (in
   * `packages/components/src/renderers/overlay/context-menu.tsx`).
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
   * @deprecated Not a channel `context-menu` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `context-menu` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `contentClassName`, `items`, `modal`, `trigger`,
   * `triggerClassName` (in
   * `packages/components/src/renderers/overlay/context-menu.tsx`).
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
   * @deprecated Not a channel `context-menu` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Menubar menu
 */
export interface MenubarMenu {
  /**
   * Menu label
   */
  label: string;
  /**
   * Menu items
   */
  items: MenuItem[];
}

/**
 * Menubar component
 */
export interface MenubarSchema extends BaseSchema {
  type: 'menubar';
  /**
   * Menubar menus
   */
  menus?: MenubarMenu[];
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `menubar` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `menus` (in
   * `packages/components/src/renderers/overlay/menubar.tsx`).
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
   * @deprecated Not a channel `menubar` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `menubar` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `menus` (in
   * `packages/components/src/renderers/overlay/menubar.tsx`).
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
   * @deprecated Not a channel `menubar` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Union type of all overlay schemas
 */
export type OverlaySchema =
  | DialogSchema
  | AlertDialogSchema
  | SheetSchema
  | DrawerSchema
  | PopoverSchema
  | TooltipSchema
  | HoverCardSchema
  | DropdownMenuSchema
  | ContextMenuSchema
  | MenubarSchema;
