/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - DnD Protocol Bridge
 *
 * Converts spec-aligned DnD configuration schemas into runtime-usable
 * component props and CSS constraint styles for drag-and-drop interactions.
 *
 * @module protocols/DndProtocol
 * @packageDocumentation
 */

// ============================================================================
// DnD Vocabulary (formerly `@objectstack/spec/ui`)
// ============================================================================
// `@objectstack/spec` 17.0.0-rc.3 deleted the whole `ui/dnd` module along with
// the four other interaction-config modules (objectstack#4988, PR
// objectstack#5321): none of them had an authoring door, so no metadata
// document could ever carry a dnd block and the platform stopped publishing
// vocabulary nothing could author.
//
// The declarations below are that vocabulary moved here verbatim — same keys,
// same members, same optionality as the retired `z.infer` types this module
// used to import through `@object-ui/types`. This bridge is the only consumer
// of the semantics, so it is now their owner, which is the remediation the
// spec's retirement ledger prescribes for a client that consumed these as
// types. Nothing about the resolver behaviour changes.
//
// NOTE for objectui#3363: that card recorded `DndProtocol.ts` /
// `KeyboardProtocol.ts` as same-name LOCAL declarations that never imported the
// spec ("命名巧合,不是耦合,不动"). That measurement was taken against direct
// `@objectstack/spec` imports only — both files reached the very same spec types
// INDIRECTLY, through `@object-ui/types`' re-export block, and so went red on
// this upgrade. Corrected here rather than left for the card.

/** How a drag is initiated. */
export type DragHandle = 'element' | 'handle' | 'grip_icon';

/** The `dropEffect` advertised to assistive technology and DnD libraries. */
export type DropEffect = 'none' | 'link' | 'move' | 'copy';

/** Movement constraints applied to a drag. */
export interface DragConstraint {
  axis: 'x' | 'y' | 'both';
  bounds: 'none' | 'parent' | 'viewport';
  grid?: [number, number];
}

/** A draggable item's declaration. */
export interface DragItem {
  type: string;
  label?: string;
  handle: DragHandle;
  constraint?: DragConstraint;
  preview: 'custom' | 'none' | 'element';
  disabled: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  role?: string;
}

/** A drop target's declaration. */
export interface DropZone {
  label?: string;
  accept: string[];
  maxItems?: number;
  highlightOnDragOver: boolean;
  dropEffect: DropEffect;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  role?: string;
}

/** Top-level drag-and-drop configuration. */
export interface DndConfig {
  enabled: boolean;
  dragItem?: DragItem;
  dropZone?: DropZone;
  sortable: boolean;
  autoScroll: boolean;
  touchDelay: number;
}

// ============================================================================
// Resolved Types
// ============================================================================

/** Fully resolved DnD configuration with all defaults applied. */
export interface ResolvedDndConfig {
  enabled: boolean;
  sortable: boolean;
  autoScroll: boolean;
  touchDelay: number;
  dragItem?: DragItem;
  dropZone?: DropZone;
}

/** Component props for a draggable element. */
export interface DragItemProps {
  draggable: boolean;
  'aria-roledescription': string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  role: string;
  'data-drag-type': string;
  'data-drag-handle': string;
  'data-drag-disabled': string;
}

/** Component props for a droppable area. */
export interface DropZoneProps {
  'aria-dropeffect': string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  role: string;
  'data-drop-accept': string;
  'data-drop-max-items'?: number;
  'data-drop-highlight': string;
}

/** CSS constraint styles for drag movement. */
export interface DragConstraintStyles {
  position: string;
  touchAction: string;
  [key: string]: string | number | undefined;
}

// ============================================================================
// DnD Config Resolution
// ============================================================================

/**
 * Resolve a DnD configuration by applying spec defaults to missing fields.
 *
 * @param config - Partial DnD configuration from the spec
 * @returns Fully resolved DnD configuration
 */
export function resolveDndConfig(config: DndConfig): ResolvedDndConfig {
  return {
    enabled: config.enabled ?? false,
    sortable: config.sortable ?? false,
    autoScroll: config.autoScroll ?? true,
    touchDelay: config.touchDelay ?? 200,
    dragItem: config.dragItem,
    dropZone: config.dropZone,
  };
}

// ============================================================================
// Drag Item Props
// ============================================================================

/**
 * Convert a spec DragItem to component props suitable for a draggable element.
 * Produces `draggable`, ARIA attributes, and data attributes for DnD libraries.
 *
 * @param item - DragItem configuration from the spec
 * @returns Component props object for a draggable element
 */
export function createDragItemProps(item: DragItem): DragItemProps {
  return {
    draggable: !(item.disabled ?? false),
    'aria-roledescription': 'draggable',
    'aria-label': item.ariaLabel ?? item.label,
    'aria-describedby': item.ariaDescribedBy,
    role: item.role ?? 'listitem',
    'data-drag-type': item.type,
    'data-drag-handle': item.handle ?? 'element',
    'data-drag-disabled': String(item.disabled ?? false),
  };
}

// ============================================================================
// Drop Zone Props
// ============================================================================

/**
 * Convert a spec DropZone to component props suitable for a droppable area.
 * Produces ARIA attributes and data attributes for DnD libraries.
 *
 * @param zone - DropZone configuration from the spec
 * @returns Component props object for a droppable area
 */
export function createDropZoneProps(zone: DropZone): DropZoneProps {
  return {
    'aria-dropeffect': zone.dropEffect ?? 'move',
    'aria-label': zone.ariaLabel ?? zone.label,
    'aria-describedby': zone.ariaDescribedBy,
    role: zone.role ?? 'list',
    'data-drop-accept': zone.accept.join(','),
    'data-drop-max-items': zone.maxItems,
    'data-drop-highlight': String(zone.highlightOnDragOver ?? true),
  };
}

// ============================================================================
// Drag Constraint Styles
// ============================================================================

/**
 * Resolve a DragConstraint into CSS style properties that restrict
 * drag movement along an axis or within bounds.
 *
 * @param constraint - DragConstraint configuration from the spec
 * @returns CSS styles object for constraining drag movement
 */
export function resolveDragConstraints(constraint: DragConstraint): DragConstraintStyles {
  const styles: DragConstraintStyles = {
    position: 'relative',
    touchAction: 'none',
  };

  const axis = constraint.axis ?? 'both';
  if (axis === 'x') {
    styles.touchAction = 'pan-y';
  } else if (axis === 'y') {
    styles.touchAction = 'pan-x';
  }

  const bounds = constraint.bounds ?? 'none';
  if (bounds === 'parent') {
    styles.overflow = 'hidden';
  }

  if (constraint.grid) {
    styles['--drag-grid-x'] = `${constraint.grid[0]}px`;
    styles['--drag-grid-y'] = `${constraint.grid[1]}px`;
  }

  return styles;
}
