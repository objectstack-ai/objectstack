/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/react - Drag and Drop Context
 *
 * Provides a unified DnD configuration system to the component tree.
 * Implements DndConfigSchema, DragItemSchema, DropZoneSchema,
 * DragConstraintSchema, and DropEffectSchema from @objectstack/spec v2.0.7.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** Drop effect types aligned with DropEffectSchema */
export type DropEffectType = 'move' | 'copy' | 'link' | 'none';

/** Drag constraint axis aligned with DragConstraintSchema */
export type DragAxis = 'x' | 'y' | 'both';

/** Drag item metadata */
export interface DragItemData {
  /** Unique identifier for the dragged item */
  id: string;
  /** Type of the dragged item (for drop zone filtering) */
  type: string;
  /** Arbitrary data associated with the drag */
  data?: Record<string, unknown>;
  /** Source container/zone identifier */
  sourceId?: string;
}

/** Drop zone configuration */
export interface DropZoneConfig {
  /** Unique identifier for the drop zone */
  id: string;
  /** Accepted drag item types */
  acceptTypes: string[];
  /** Drop effect to apply */
  effect?: DropEffectType;
  /** Whether the zone is currently disabled */
  disabled?: boolean;
  /** Maximum number of items this zone can hold */
  maxItems?: number;
}

/** Drag constraints configuration */
export interface DragConstraintConfig {
  /** Constrain movement to an axis */
  axis?: DragAxis;
  /** Minimum distance before drag starts (in pixels) */
  activationDistance?: number;
  /** Whether to show a drag handle */
  showHandle?: boolean;
  /** Container bounds (CSS selector) */
  containerId?: string;
}

/** Overall DnD configuration aligned with DndConfigSchema */
export interface DndSystemConfig {
  /** Whether DnD is enabled */
  enabled?: boolean;
  /** Default drag constraints */
  defaultConstraints?: DragConstraintConfig;
  /** Whether to show drag overlay/preview */
  showPreview?: boolean;
  /** Auto-scroll when dragging near edges */
  autoScroll?: boolean;
}

/** Drag event information */
export interface DragEvent {
  /** The dragged item */
  item: DragItemData;
  /** Target drop zone (null if not over a zone) */
  targetZoneId: string | null;
  /** The applied drop effect */
  effect: DropEffectType;
}

export interface DndProviderProps {
  children: React.ReactNode;
  /** System-wide DnD configuration */
  config?: DndSystemConfig;
  /** Called when a drag starts */
  onDragStart?: (event: DragEvent) => void;
  /** Called when an item is dropped */
  onDrop?: (event: DragEvent) => void;
  /** Called when a drag is cancelled */
  onDragCancel?: (event: DragEvent) => void;
}

interface DndContextValue {
  /** System-wide DnD configuration */
  config: DndSystemConfig;
  /** Whether DnD is enabled */
  enabled: boolean;
  /** Currently dragging item (null if not dragging) */
  activeItem: DragItemData | null;
  /** Registered drop zones */
  dropZones: Map<string, DropZoneConfig>;
  /** Start a drag operation */
  startDrag: (item: DragItemData) => void;
  /** End the current drag operation */
  endDrag: (targetZoneId?: string) => void;
  /** Cancel the current drag */
  cancelDrag: () => void;
  /** Register a drop zone */
  registerDropZone: (zone: DropZoneConfig) => void;
  /** Unregister a drop zone */
  unregisterDropZone: (zoneId: string) => void;
  /** Check if a drop zone accepts a drag item type */
  canDrop: (zoneId: string, itemType: string) => boolean;
}

const DndCtx = createContext<DndContextValue | null>(null);

/**
 * DndProvider — Provides a unified DnD system aligned with @objectstack/spec v2.0.7.
 *
 * This is a coordination layer; actual drag mechanics are delegated to
 * libraries like @dnd-kit/core or react-grid-layout in individual plugins.
 *
 * @example
 * ```tsx
 * <DndProvider
 *   config={{ enabled: true, showPreview: true, autoScroll: true }}
 *   onDrop={(event) => handleDrop(event.item, event.targetZoneId)}
 * >
 *   <KanbanBoard />
 * </DndProvider>
 * ```
 */
export const DndProvider: React.FC<DndProviderProps> = ({
  children,
  config: userConfig = {},
  onDragStart,
  onDrop,
  onDragCancel,
}) => {
  const config = useMemo<DndSystemConfig>(
    () => ({
      enabled: true,
      showPreview: true,
      autoScroll: true,
      ...userConfig,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(userConfig)],
  );

  const [activeItem, setActiveItem] = useState<DragItemData | null>(null);
  const [dropZones] = useState<Map<string, DropZoneConfig>>(() => new Map());

  const startDrag = useCallback(
    (item: DragItemData) => {
      if (!config.enabled) return;
      setActiveItem(item);
      onDragStart?.({ item, targetZoneId: null, effect: 'move' });
    },
    [config.enabled, onDragStart],
  );

  const endDrag = useCallback(
    (targetZoneId?: string) => {
      if (!activeItem) return;
      const zone = targetZoneId ? dropZones.get(targetZoneId) : undefined;
      const effect: DropEffectType = zone?.effect ?? 'move';
      onDrop?.({ item: activeItem, targetZoneId: targetZoneId ?? null, effect });
      setActiveItem(null);
    },
    [activeItem, dropZones, onDrop],
  );

  const cancelDrag = useCallback(() => {
    if (!activeItem) return;
    onDragCancel?.({ item: activeItem, targetZoneId: null, effect: 'none' });
    setActiveItem(null);
  }, [activeItem, onDragCancel]);

  const registerDropZone = useCallback(
    (zone: DropZoneConfig) => {
      dropZones.set(zone.id, zone);
    },
    [dropZones],
  );

  const unregisterDropZone = useCallback(
    (zoneId: string) => {
      dropZones.delete(zoneId);
    },
    [dropZones],
  );

  const canDrop = useCallback(
    (zoneId: string, itemType: string): boolean => {
      const zone = dropZones.get(zoneId);
      if (!zone || zone.disabled) return false;
      return zone.acceptTypes.includes(itemType);
    },
    [dropZones],
  );

  const value = useMemo<DndContextValue>(
    () => ({
      config,
      enabled: config.enabled ?? true,
      activeItem,
      dropZones,
      startDrag,
      endDrag,
      cancelDrag,
      registerDropZone,
      unregisterDropZone,
      canDrop,
    }),
    [
      config,
      activeItem,
      dropZones,
      startDrag,
      endDrag,
      cancelDrag,
      registerDropZone,
      unregisterDropZone,
      canDrop,
    ],
  );

  return <DndCtx.Provider value={value}>{children}</DndCtx.Provider>;
};

DndProvider.displayName = 'DndProvider';

/**
 * Hook to consume the DnD context.
 *
 * @throws Error if used outside a DndProvider
 */
export function useDnd(): DndContextValue {
  const ctx = useContext(DndCtx);
  if (!ctx) {
    throw new Error(
      'useDnd must be used within a <DndProvider>. ' +
        'Wrap your app with <DndProvider> to use the drag and drop system.',
    );
  }
  return ctx;
}

/**
 * Hook to check if a DndProvider is available.
 */
export function useHasDndProvider(): boolean {
  return useContext(DndCtx) !== null;
}
