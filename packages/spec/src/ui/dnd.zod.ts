// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { lazySchema } from '../shared/lazy-schema';

// ---------------------------------------------------------------------------
// NOT CLOSED AGAINST UNKNOWN KEYS -- AND THAT IS THE MEASURED VERDICT
// (#4001 batch 13 / 批 13, ADR-0078). Read this before "finishing" the file.
//
// The strictness ledger scheduled this file's 4 object sites as `authorable
// (p)` -- provisional. #4001's own rule is verify-before-tightening, and here
// the verification came back NEGATIVE: no metadata document is ever parsed
// against these shapes, because nothing in the protocol carries them.
//
// Three independent measurements, 2026-08-03:
//
//   1. STATIC -- nothing under `packages/spec/src` imports this module except
//      the `ui/index.ts` barrel. No schema anywhere declares a `component.dnd / view.dnd`
//      slot, so there is no key an author can write to reach these shapes.
//   2. GRAPH -- a BFS over this build's in-memory Zod graph from all 24
//      metadata-type roots (`listMetadataTypeSchemaTypes`) plus
//      `ObjectStackSchema` (`defineStack`) -- the closure `build-schemas.ts`
//      uses for the #4650 deletion check -- reaches none of them. Its three
//      positive controls resolve `root-graph` in the same run: `PageSchema`,
//      `WebhookSchema` (batch 11's `defineStack({ webhooks })` door) and
//      `StateMachineSchema` (batch 10's `agent.lifecycle` door). So
//      "unreachable" is a fact about the graph, not a broken instrument.
//   3. CALL SITES -- no `.parse()` / `.safeParse()` on any schema here exists
//      in `objectstack`, `objectui` or the example apps, outside this file's
//      own unit test. objectui re-exports the inferred TYPES only and says so
//      (`@object-ui/types`, the #2561 note: the validators are deliberately
//      NOT re-exported).
//
// `.strict()` would therefore gate nothing -- strictness is a property of a
// PARSE, and there is no parse. Adding it would spend a v17 breaking change to
// make this file LOOK finished, and leave behind the artefact the ledger
// itself warns about: "a *precisely validated* dead slot is the more
// convincing lie" (#4583). The real question is ADR-0049 enforce-or-remove --
// retire this vocabulary or give it a carrier -- filed as #4988, with the same
// verdict recorded in this file's ledger row.
//
// DO NOT convert these sites to `strictObject` before #4988 is decided: a
// strict shape reads as load-bearing and makes the retirement harder, which is
// the opposite of what the measurement asks for.
// ---------------------------------------------------------------------------

/**
 * Drag Handle Schema
 * Defines how a drag interaction is initiated on an element.
 */
export const DragHandleSchema = lazySchema(() => z.enum([
  'element',
  'handle',
  'grip_icon',
]).describe('Drag initiation method'));

export type DragHandle = z.infer<typeof DragHandleSchema>;

/**
 * Drop Effect Schema
 * Visual feedback indicating the result of a drop operation.
 */
export const DropEffectSchema = lazySchema(() => z.enum([
  'move',
  'copy',
  'link',
  'none',
]).describe('Drop operation effect'));

export type DropEffect = z.infer<typeof DropEffectSchema>;

/**
 * Drag Constraint Schema
 * Constrains drag movement along axes, within bounds, or to a grid.
 */
export const DragConstraintSchema = lazySchema(() => z.object({
  axis: z.enum(['x', 'y', 'both']).default('both').describe('Constrain drag axis'),
  bounds: z.enum(['parent', 'viewport', 'none']).default('none').describe('Constrain within bounds'),
  grid: z.tuple([z.number(), z.number()]).optional().describe('Snap to grid [x, y] in pixels'),
}).describe('Drag movement constraints'));

export type DragConstraint = z.infer<typeof DragConstraintSchema>;

/**
 * Drop Zone Schema
 * Configures a container that accepts dragged items.
 */
export const DropZoneSchema = lazySchema(() => z.object({
  label: I18nLabelSchema.optional().describe('Accessible label for the drop zone'),
  accept: z.array(z.string()).describe('Accepted drag item types'),
  maxItems: z.number().optional().describe('Maximum items allowed in drop zone'),
  highlightOnDragOver: z.boolean().default(true).describe('Highlight drop zone when dragging over'),
  dropEffect: DropEffectSchema.default('move').describe('Visual effect on drop'),
}).merge(AriaPropsSchema.partial())
  // `.strip()` is LOAD-BEARING (#4001 批 16): `AriaPropsSchema` became `strictObject` and
  // `.merge()` adopts the incoming schema's unknown-key posture, so without this the shape
  // would silently become `.strict()` — with zod's generic message, not the campaign's — and
  // would contradict this file's measured `no door` verdict (#4988: nothing parses it, so a
  // strict shell enforces nothing). Keep it until #4988 says what happens to this file.
  .strip()
  .describe('Drop zone configuration'));

export type DropZone = z.infer<typeof DropZoneSchema>;

/**
 * Drag Item Schema
 * Configures a draggable element including handle, constraints, and preview.
 */
export const DragItemSchema = lazySchema(() => z.object({
  type: z.string().describe('Drag item type identifier for matching with drop zones'),
  label: I18nLabelSchema.optional().describe('Accessible label describing the draggable item'),
  handle: DragHandleSchema.default('element').describe('How to initiate drag'),
  constraint: DragConstraintSchema.optional().describe('Drag movement constraints'),
  preview: z.enum(['element', 'custom', 'none']).default('element').describe('Drag preview type'),
  disabled: z.boolean().default(false).describe('Disable dragging'),
}).merge(AriaPropsSchema.partial())
  // `.strip()` is LOAD-BEARING (#4001 批 16): `AriaPropsSchema` became `strictObject` and
  // `.merge()` adopts the incoming schema's unknown-key posture, so without this the shape
  // would silently become `.strict()` — with zod's generic message, not the campaign's — and
  // would contradict this file's measured `no door` verdict (#4988: nothing parses it, so a
  // strict shell enforces nothing). Keep it until #4988 says what happens to this file.
  .strip()
  .describe('Draggable item configuration'));

export type DragItem = z.infer<typeof DragItemSchema>;

/**
 * Drag and Drop Configuration Schema
 * Top-level drag-and-drop interaction configuration for a component.
 */
export const DndConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable drag and drop'),
  dragItem: DragItemSchema.optional().describe('Configuration for draggable item'),
  dropZone: DropZoneSchema.optional().describe('Configuration for drop target'),
  sortable: z.boolean().default(false).describe('Enable sortable list behavior'),
  autoScroll: z.boolean().default(true).describe('Auto-scroll during drag near edges'),
  touchDelay: z.number().default(200).describe('Delay in ms before drag starts on touch devices'),
}).describe('Drag and drop interaction configuration'));

export type DndConfig = z.infer<typeof DndConfigSchema>;
