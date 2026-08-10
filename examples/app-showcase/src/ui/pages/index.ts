// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

export { StartHerePage } from './start-here.page.js';
export { CapabilityMapPage } from './capability-map.page.js';
export { ProjectWorkspacePage } from './project-workspace.page.js';
export { ProjectDetailPage } from './project-detail.page.js';
export { TaskWorkbenchPage } from './task-workbench.page.js';
export { TaskTriagePage } from './task-triage.page.js';
export { ActiveProjectsPage } from './active-projects.page.js';
export { TaskDetailPage } from './task-detail.page.js';
export { ReviewQueuePage } from './review-queue.page.js';
export { NewProjectWizardPage } from './new-project-wizard.page.js';
export { MyWorkPage } from './my-work.page.js';
export { SettingsPage } from './settings.page.js';
export { StylingGalleryPage } from './styling-gallery.page.js';
export { CommandCenterPage } from './command-center.page.js';
export { CommandCenterJsxPage } from './command-center-jsx.page.js';
export { CrmWorkbenchPage } from './crm-workbench.page.js';
export { TaskDeskPage } from './task-desk.page.js';
export { PageVariablesPage } from './page-variables.page.js';
export { ContactFormPage } from './contact-form.page.js';
export { RenewalsPipelinePage } from './renewals-pipeline.page.js';
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
export const ComponentGalleryPage = definePage({
  name: 'showcase_component_gallery',
  label: 'Component Gallery',
  type: 'home',
  template: 'header-sidebar-main',
  isDefault: false,
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
        // The page's primary CTA. `element:button` carries an **inline** action
        // (`action`, an InlineActionSchema) — it is NOT a by-name reference to a
        // registered object action; that is `action:button`. This block used to
        // author `actionName: 'showcase_new_task'`, a key `ElementButtonPropsSchema`
        // never declared: the strip-mode parse dropped it, the renderer reads only
        // `props.action`, and its `handleClick` opens with `if (!action) return` —
        // so the button rendered, was clickable, and the click did nothing at all
        // (no request, no dialog, no navigation). #6597.
        //
        // #6597's first fix wrote this as `type: 'modal'` + `target: 'showcase_task'`,
        // relying on objectui `useActionModal.resolveModalTarget` resolving a string
        // target page-first and then falling back to an OBJECT. It is now
        // `type: 'form'` + the object's `edit` FORM view, matching the registered
        // `NewTaskAction` of the same name (src/ui/actions/index.ts) — one action
        // name, one shape, in one corpus.
        //
        // Why the change (maintainer ruling on #6739): a `type: 'modal'` target
        // names a PAGE, only — spec TSDoc, published docs and `defineStack`'s
        // cross-reference walk all agree, and the walk rejects a registered modal
        // action targeting a non-page. The object fallback is consumer leniency the
        // renderer itself labels "Back-compat" and is being retired. This line only
        // ever built because the cross-reference walk visits `config.actions` and
        // never an INLINE action (#6889) — so it depended on a branch under
        // retirement and on a validation hole, both at once.
        { type: 'element:button', properties: { label: 'Create Task', icon: 'plus', action: { name: 'showcase_new_task', type: 'form', target: 'showcase_task.edit', refreshAfter: true } } },
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
});
