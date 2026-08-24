// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { PageSchema } from '@objectstack/spec/ui';

import { TaskMapPage } from '../src/ui/pages/task-visualizations.pages.js';
import { TaskViews } from '../src/ui/views/task.view.js';

/**
 * Regression pin for the showcase Work Map's placeholder marker titles.
 *
 * `InterfacePageConfigSchema` is a CLOSED shape with no `map` (or `kanban` /
 * `calendar` / …) key of its own — a per-visualization field binding cannot
 * be declared directly on `interfaceConfig`. The one schema-legal channel is
 * `sourceView`, which objectui's `InterfaceListPage` resolves against the
 * source object's OWN named view and (since objectui#5908) forwards that
 * view's `map` block verbatim to the renderer. `showcase_task` already
 * declares the correct binding on its `map` listView (task.view.ts, #9340);
 * this page has to REFERENCE it, or the renderer's `titleField || 'name'`
 * fallback finds no `name` field on `showcase_task` and every marker title
 * renders as a placeholder.
 */
describe('showcase Work Map — marker title binding (#11443)', () => {
  it('references the object\'s `map` listView via sourceView', () => {
    expect(TaskMapPage.interfaceConfig?.sourceView).toBe('map');
  });

  it('the referenced `map` listView still carries the title/location binding', () => {
    const mapView = (TaskViews.listViews as Record<string, any>).map;
    expect(mapView).toBeDefined();
    expect(mapView.type).toBe('map');
    expect(mapView.map).toEqual({ titleField: 'title', locationField: 'location' });
  });

  it('a `map` block declared directly on interfaceConfig is rejected — documents the schema boundary this page works around', () => {
    const attempt = () =>
      PageSchema.parse({
        type: 'list',
        object: 'showcase_task',
        kind: 'full',
        template: 'default',
        isDefault: false,
        regions: [],
        name: 'showcase_task_map_direct_probe',
        label: 'Work Map (direct-block probe)',
        interfaceConfig: {
          source: 'showcase_task',
          columns: ['title', 'location'],
          appearance: { showDescription: true, allowedVisualizations: ['map'] },
          // `map` is not a key `InterfacePageConfigSchema` declares — the
          // input TS type does not close over it (no excess-property error),
          // but `.parse()` rejects it at runtime as an unrecognized key. That
          // runtime rejection is exactly what this test pins.
          map: { titleField: 'title', locationField: 'location' },
        },
      });
    expect(attempt).toThrow(/[Uu]nrecognized key/);
  });
});
