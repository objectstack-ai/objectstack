// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Visualization gallery — one interface page per record visualization, each
 * over the SAME showcase_task object. Demonstrates that a list/interface page
 * can be locked to any single visualization (single-entry
 * `appearance.allowedVisualizations` = no switcher), and that the per-viz
 * field bindings (kanban groupBy, calendar/gantt/timeline dates, gallery cover,
 * map location) are auto-derived from the object — the author only whitelists
 * the type.
 *
 * The last page (All Views) keeps the switcher open across every type, showing
 * the runtime visualization choice ON a page (not just on the object view).
 */
const base = {
  type: 'list' as const,
  object: 'showcase_task',
  kind: 'full' as const,
  template: 'default',
  isDefault: false,
  regions: [],
};

const cols = ['title', 'assignee', 'status', 'priority', 'due_date'];

export const TaskBoardPage = definePage({
  ...base,
  name: 'showcase_task_board',
  label: 'Task Board',
  interfaceConfig: {
    source: 'showcase_task',
    columns: [...cols, 'estimate_hours'],
    appearance: { showDescription: true, allowedVisualizations: ['kanban'] },
    userActions: { sort: true, search: true, filter: false, rowHeight: false, addRecordForm: false },
    showRecordCount: true,
  },
});

export const TaskCalendarPage = definePage({
  ...base,
  name: 'showcase_task_calendar',
  label: 'Task Calendar',
  interfaceConfig: {
    source: 'showcase_task',
    columns: cols,
    appearance: { showDescription: true, allowedVisualizations: ['calendar'] },
    userActions: { sort: false, search: true, filter: false, rowHeight: false, addRecordForm: false },
    showRecordCount: true,
  },
});

export const TaskGalleryPage = definePage({
  ...base,
  name: 'showcase_task_gallery',
  label: 'Task Gallery',
  interfaceConfig: {
    source: 'showcase_task',
    columns: [...cols, 'cover'],
    appearance: { showDescription: true, allowedVisualizations: ['gallery'] },
    userActions: { sort: true, search: true, filter: false, rowHeight: false, addRecordForm: false },
    showRecordCount: true,
  },
});

export const TaskSchedulePage = definePage({
  ...base,
  name: 'showcase_task_schedule',
  label: 'Team Schedule (Gantt)',
  interfaceConfig: {
    source: 'showcase_task',
    columns: [...cols, 'start_date', 'end_date', 'progress'],
    appearance: { showDescription: true, allowedVisualizations: ['gantt'] },
    userActions: { sort: true, search: true, filter: false, rowHeight: false, addRecordForm: false },
    showRecordCount: true,
  },
});

export const TaskTimelinePage = definePage({
  ...base,
  name: 'showcase_task_timeline',
  label: 'Activity Timeline',
  interfaceConfig: {
    source: 'showcase_task',
    columns: [...cols, 'created_at'],
    appearance: { showDescription: true, allowedVisualizations: ['timeline'] },
    userActions: { sort: true, search: true, filter: false, rowHeight: false, addRecordForm: false },
    showRecordCount: true,
  },
});

export const TaskMapPage = definePage({
  ...base,
  name: 'showcase_task_map',
  label: 'Work Map',
  interfaceConfig: {
    source: 'showcase_task',
    // `InterfacePageConfigSchema` is a CLOSED shape with no `map` (or
    // `kanban`/`calendar`/…) key of its own — an author cannot declare a
    // marker-title binding directly here (confirmed: `map: {...}` on this
    // object is rejected as an unrecognized key). The one schema-legal
    // channel for a per-visualization field binding on an interface page is
    // `sourceView`, which `InterfaceListPage`'s `resolveSourceView` resolves
    // against the source object's OWN named view — and `showcase_task`
    // already declares exactly this binding on its `map` listView
    // (task.view.ts, `listViews.map.map: { titleField: 'title',
    // locationField: 'location' }`, from #9340). Referencing it here is a
    // pure forward, not a duplicate declaration.
    sourceView: 'map',
    columns: [...cols, 'location'],
    appearance: { showDescription: true, allowedVisualizations: ['map'] },
    userActions: { sort: false, search: true, filter: false, rowHeight: false, addRecordForm: false },
    showRecordCount: true,
  },
});

export const TaskAllViewsPage = definePage({
  ...base,
  name: 'showcase_task_all_views',
  label: 'All Views',
  interfaceConfig: {
    source: 'showcase_task',
    columns: [...cols, 'cover', 'start_date', 'end_date', 'created_at', 'progress', 'location'],
    // Switcher open across every record visualization — the runtime
    // visualization choice ON an interface page.
    appearance: {
      showDescription: true,
      allowedVisualizations: ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map'],
    },
    userActions: { sort: true, search: true, filter: false, rowHeight: false, addRecordForm: false },
    showRecordCount: true,
  },
});
