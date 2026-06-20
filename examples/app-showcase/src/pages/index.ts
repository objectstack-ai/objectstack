// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

export { ProjectWorkspacePage } from './project-workspace.page.js';
export { ProjectDetailPage } from './project-detail.page.js';
export { TaskWorkbenchPage } from './task-workbench.page.js';
export { TaskTriagePage } from './task-triage.page.js';
export { ActiveProjectsPage } from './active-projects.page.js';
export { TaskDetailPage } from './task-detail.page.js';
export { AccountDetailPage } from './account-detail.page.js';
export { ReviewQueuePage } from './review-queue.page.js';
export { NewProjectWizardPage } from './new-project-wizard.page.js';
export { MyWorkPage } from './my-work.page.js';
export { SettingsPage } from './settings.page.js';
export {
  TaskBoardPage,
  TaskCalendarPage,
  TaskGalleryPage,
  TaskSchedulePage,
  TaskTimelinePage,
  TaskMapPage,
  TaskAllViewsPage,
} from './task-visualizations.pages.js';

/**
 * Showcase home — a clean welcome landing. A live KPI grid (object-metric in
 * the layout `grid`) over the seeded data, an intro, and a primary action.
 * Deliberately avoids components that render as placeholders/empty in a page
 * region (ai:input, oversized element:image, page:card body) so the first
 * impression is polished, not a debug canvas.
 */
export const ComponentGalleryPage: Page = {
  name: 'showcase_component_gallery',
  label: 'Component Gallery',
  type: 'home',
  template: 'header-sidebar-main',
  isDefault: true,
  kind: 'full',
  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        {
          type: 'page:header',
          properties: {
            title: 'ObjectStack Showcase',
            subtitle: 'Every metadata type, every view, every chart — in one workspace.',
          },
        },
      ],
    },
    {
      name: 'main',
      width: 'large',
      components: [
        { type: 'element:text', properties: { content: 'A working project-delivery workspace that exercises every metadata type, view, chart, and capability chain. Use the navigation to explore — start with My Work, the Delivery Operations dashboard, or the eight Task visualizations.' } },
        // Live KPI row over the seeded data (object-metric in the layout grid).
        {
          type: 'grid',
          properties: {
            columns: 4,
            gap: 4,
            children: [
              { type: 'object-metric', properties: { objectName: 'showcase_project', label: 'Projects', icon: 'folder-kanban', colorVariant: 'blue', description: 'active & planned', aggregate: { field: 'id', function: 'count' } } },
              { type: 'object-metric', properties: { objectName: 'showcase_task', label: 'Tasks', icon: 'check-square', colorVariant: 'purple', description: 'all states', aggregate: { field: 'id', function: 'count' } } },
              { type: 'object-metric', properties: { objectName: 'showcase_account', label: 'Accounts', icon: 'building', colorVariant: 'teal', description: 'customers', aggregate: { field: 'id', function: 'count' } } },
              { type: 'object-metric', properties: { objectName: 'showcase_task', label: 'Open Tasks', icon: 'list-checks', colorVariant: 'warning', description: 'not done', aggregate: { field: 'id', function: 'count' }, filter: { status: { $ne: 'done' } } } },
            ],
          },
        },
        { type: 'element:button', properties: { label: 'Create Task', actionName: 'showcase_new_task' } },
      ],
    },
    {
      name: 'sidebar',
      width: 'small',
      components: [
        { type: 'element:text', properties: { content: 'Explore' } },
        { type: 'element:text', properties: { content: '• My Work — your queue & live KPIs' } },
        { type: 'element:text', properties: { content: '• Delivery Operations — org dashboard' } },
        { type: 'element:text', properties: { content: '• Tasks → All Views — 8 visualizations' } },
        { type: 'element:text', properties: { content: '• Field Zoo — every field type' } },
      ],
    },
  ],
};
