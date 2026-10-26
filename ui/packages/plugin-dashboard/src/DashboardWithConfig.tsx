/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { cn, Button } from '@object-ui/components';
import type { DashboardComponentSchema } from '@object-ui/types';
import { isSlotComponentEntry, type DashboardWidgetSlotEntry } from './widgetDispatch';
import { completeWidgetLayout, defaultWidgetPlacement } from '@object-ui/types';

import { DashboardRenderer } from './DashboardRenderer';
import { DashboardConfigPanel } from './DashboardConfigPanel';
import { WidgetConfigPanel } from './WidgetConfigPanel';
import type { WidgetDatasetCatalogEntry } from './dataset-catalog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DashboardWithConfigProps {
  /** Dashboard schema for rendering */
  schema: DashboardComponentSchema;
  /** Current dashboard configuration (for the config panel) */
  config: Record<string, any>;
  /** Called when config panel saves dashboard-level changes */
  onConfigSave: (config: Record<string, any>) => void;
  /** Called when widget config panel saves widget-level changes */
  onWidgetSave?: (widgetId: string, config: Record<string, any>) => void;
  /** Callback invoked when dashboard refresh is triggered */
  onRefresh?: () => void;
  /** Total record count */
  recordCount?: number;
  /** Whether the config panel is open initially */
  defaultConfigOpen?: boolean;
  /** Additional CSS class name for the container */
  className?: string;
  /**
   * Analytics dataset catalog (ADR-0021), forwarded to the widget config
   * panel so its dataset / dimensions / values pickers bind to the live
   * schema. Hosts resolve it (e.g. via the metadata client's
   * `list('dataset')`); absent → free-text authoring still works.
   */
  datasets?: WidgetDatasetCatalogEntry[];
  /** Whether the dataset catalog is still loading. */
  datasetsLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DashboardWithConfig — Composite component combining a DashboardRenderer
 * with a DashboardConfigPanel sidebar.
 *
 * Supports:
 * - Toggle config panel visibility via a Settings button
 * - Dashboard-level configuration editing
 * - Click-to-select a widget → sidebar switches to WidgetConfigPanel
 * - Back navigation from widget config to dashboard config
 * - Live preview: widget config changes are reflected in real time
 */
export function DashboardWithConfig({
  schema,
  config,
  onConfigSave,
  onWidgetSave,
  onRefresh,
  recordCount,
  defaultConfigOpen = false,
  className,
  datasets,
  datasetsLoading,
}: DashboardWithConfigProps) {
  const [configOpen, setConfigOpen] = useState(defaultConfigOpen);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);

  // Internal schema state for live preview during widget editing.
  // Updated on every field change; reset when external schema prop changes.
  const [liveSchema, setLiveSchema] = useState<DashboardComponentSchema>(schema);
  const [configVersion, setConfigVersion] = useState(0);

  useEffect(() => {
    setLiveSchema(schema);
    setConfigVersion((v) => v + 1);
  }, [schema]);

  // Stable widget config for the config panel — only recomputed on
  // widget selection change or save (configVersion), NOT on every live
  // field change. This prevents useConfigDraft from resetting the draft.
  const selectedWidgetConfig = React.useMemo(() => {
    if (!selectedWidgetId || !liveSchema.widgets) return null;
    // Read through the slot's element type (objectui#11514), as every
    // dashboard surface reads a `widgets[]` entry. `title` and `layout` below
    // are declared on both arms: the widget arm's spec `DashboardWidget` row,
    // and the component arm's card heading and the spec's `layout` by reference
    // (objectui#11070 round 11). The component arm
    // (`DashboardWidgetSlotComponentSchema`) is no longer assignable to the
    // widget arm, whose `type` names no component type since objectui#11514.
    const widgets: DashboardWidgetSlotEntry[] = liveSchema.widgets;
    const index = widgets.findIndex(
      (w) => (w.id || w.title) === selectedWidgetId,
    );
    if (index < 0) return null;
    const widget = widgets[index];
    // The panel's width / height sliders start from the same completed box the
    // live writer below stores (objectui#11388), so the dimension an edit
    // leaves alone is the one the slider showed.
    const layout = completeWidgetLayout(widget.layout, {}, defaultWidgetPlacement(index));
    // ADR-0021 dataset shape — the only authoring shape the panel edits.
    // `dataset` / `dimensions` / `values` / `colorVariant` are widget keys,
    // read on the widget arm alone (objectui#11598, N2 A): a component node in
    // the slot (a `metric-card`) declares none of them, so the panel starts it
    // from their empty values. They used to be read off the entry whichever
    // arm it was, the first three through an `as any` cast and `colorVariant`
    // through `BaseSchema`'s index signature.
    const widgetArm = isSlotComponentEntry(widget) ? undefined : widget;
    const dataset = widgetArm?.dataset;
    const dimensions = widgetArm?.dimensions;
    const values = widgetArm?.values;
    return {
      id: widget.id ?? '',
      title: widget.title ?? '',
      description: widget.description ?? '',
      type: widget.type ?? '',
      dataset: typeof dataset === 'string' ? dataset : '',
      dimensions: Array.isArray(dimensions) ? dimensions : [],
      values: Array.isArray(values) ? values : [],
      colorVariant: widgetArm?.colorVariant ?? 'default',
      // No `actionUrl` / `actionType` / `actionIcon`: retired at the widget
      // level in @objectstack/spec 17.0.0-rc.3 (objectstack#5010, ADR-0049 D2)
      // and now `retiredKey` tombstones the spec refuses. Seeding
      // `actionUrl: widget.actionUrl ?? ''` here meant EVERY save from the
      // widget panel emitted `actionUrl: ''` — a parse error — even when the
      // author never opened the Behavior group (objectstack#7129).
      layoutW: layout.w,
      layoutH: layout.h,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWidgetId, configVersion]);

  // `string | null`, not `string`: `DashboardRenderer` calls `onWidgetClick(null)`
  // to DESELECT when a design-mode click lands on the dashboard background, and
  // this handler has always received that `null` at runtime — `selectedWidgetId`
  // is a `useState< string | null >` precisely so it can hold it. The narrower
  // `(widgetId: string)` type-checked only because a `[key: string]: any` on
  // `DashboardRendererProps` erased every declared prop from the resolved type,
  // so this call site was never held to the declared
  // `(widgetId: string | null) => void` (objectui#4528). Widening the annotation
  // is what the contract always said; nothing about the behaviour changes.
  const handleWidgetSelect = useCallback(
    (widgetId: string | null) => {
      setSelectedWidgetId(widgetId);
      setConfigOpen(true);
    },
    [],
  );

  const handleWidgetClose = useCallback(() => {
    setSelectedWidgetId(null);
  }, []);

  // Live-update handler: updates liveSchema so DashboardRenderer re-renders.
  const handleWidgetFieldChange = useCallback(
    (field: string, value: any) => {
      if (!selectedWidgetId) return;
      setLiveSchema((prev) => {
        if (!prev.widgets) return prev;
        return {
          ...prev,
          // The slot's element type, for the reason `selectedWidgetConfig`
          // states (objectui#11514).
          //
          // A slider edits ONE dimension of the spec's four-number `layout`,
          // so it goes through `completeWidgetLayout` (objectui#11388): on a
          // widget with no `layout` the untouched coordinates come from the
          // grid's auto-placement for its index, and the box is whole.
          // Spreading the one number onto an absent box stored `{ w }`, which
          // the spec refuses. `DashboardRenderer` computes no `x` / `y` this
          // component can read, so it seeds from `defaultWidgetPlacement`.
          widgets: prev.widgets.map((w: DashboardWidgetSlotEntry, index: number) => {
            if ((w.id || w.title) !== selectedWidgetId) return w;
            if (field === 'layoutW' || field === 'layoutH') {
              const patch = field === 'layoutW' ? { w: value } : { h: value };
              return { ...w, layout: completeWidgetLayout(w.layout, patch, defaultWidgetPlacement(index)) };
            }
            return { ...w, [field]: value };
          }),
        };
      });
    },
    [selectedWidgetId],
  );

  const handleWidgetSave = useCallback(
    (widgetConfig: Record<string, any>) => {
      if (selectedWidgetId && onWidgetSave) {
        // WidgetConfigPanel already emits the canonical ADR-0021 shape
        // (dataset / dimensions / values) with legacy keys scrubbed, so the
        // config is persisted verbatim.
        onWidgetSave(selectedWidgetId, widgetConfig);
      }
      setSelectedWidgetId(null);
      setConfigVersion((v) => v + 1);
    },
    [selectedWidgetId, onWidgetSave],
  );

  const handleToggleConfig = useCallback(() => {
    setConfigOpen((prev) => !prev);
    setSelectedWidgetId(null);
  }, []);

  return (
    <div
      className={cn('flex h-full w-full', className)}
      data-testid="dashboard-with-config"
    >
      {/* Main dashboard area */}
      <div className="flex-1 min-w-0 overflow-auto relative">
        {/* Settings toggle button */}
        <div className="absolute top-2 right-2 z-10">
          <Button
            size="sm"
            variant={configOpen ? 'default' : 'outline'}
            onClick={handleToggleConfig}
            data-testid="dashboard-config-toggle"
          >
            <Settings className="h-3.5 w-3.5 mr-1" />
            Settings
          </Button>
        </div>

        <DashboardRenderer
          schema={liveSchema}
          onRefresh={onRefresh}
          recordCount={recordCount}
          designMode={configOpen}
          selectedWidgetId={selectedWidgetId}
          onWidgetClick={handleWidgetSelect}
        />
      </div>

      {/* Config panel sidebar */}
      {configOpen && (
        <div className="relative shrink-0">
          {selectedWidgetId && selectedWidgetConfig ? (
            <WidgetConfigPanel
              open={true}
              onClose={handleWidgetClose}
              config={selectedWidgetConfig}
              onSave={handleWidgetSave}
              onFieldChange={handleWidgetFieldChange}
              datasets={datasets}
              datasetsLoading={datasetsLoading}
            />
          ) : (
            <DashboardConfigPanel
              open={true}
              onClose={() => setConfigOpen(false)}
              config={config}
              onSave={onConfigSave}
            />
          )}
        </div>
      )}
    </div>
  );
}
