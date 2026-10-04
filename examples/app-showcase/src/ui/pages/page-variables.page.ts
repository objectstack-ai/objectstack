// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Page Variables — master/detail driven by page-local state (PageSchema.variables).
 *
 * Demonstrates the end-to-end page-variable loop:
 *   1. `variables` declares `selectedProjectId`, fed by the component whose id
 *      is `project_picker` (PageVariableSchema.source = that component id).
 *   2. `element:record_picker` (id: project_picker) writes the chosen project's
 *      id into that variable on selection.
 *   3. Sibling components gate on `page.selectedProjectId` via `visibleWhen`:
 *      the empty-state hint shows while nothing is picked; the detail panel
 *      appears the moment a project is chosen — re-evaluated live, no reload.
 *
 * This is the canonical low-code "filtered detail" pattern: one picker drives
 * what the rest of the page shows, with no custom code.
 */
export const PageVariablesPage = definePage({
  name: 'showcase_page_variables',
  label: 'Page Variables (Master/Detail)',
  icon: 'mouse-pointer-click',
  type: 'app',
  template: 'header-sidebar-main',
  isDefault: false,
  // Page-local state. `selectedProjectId` is written by the `project_picker`
  // element (source = its component id) and read by predicates as `page.selectedProjectId`.
  variables: [
    { name: 'selectedProjectId', type: 'record_id', source: 'project_picker' },
  ],
  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        {
          type: 'page:header',
          properties: {
            title: 'Page Variables',
            subtitle: 'Pick a project — page-local state drives what shows below, live.',
          },
        },
      ],
    },
    {
      name: 'main',
      width: 'large',
      components: [
        {
          type: 'element:text',
          properties: {
            content:
              'This page declares a `selectedProjectId` variable. The record picker writes the selected project into it; the detail panel below is gated on `page.selectedProjectId` and only appears once you choose. No custom code — just metadata.',
            variant: 'body',
          },
        },
        {
          type: 'element:record_picker',
          id: 'project_picker',
          dataSource: { object: 'showcase_project', limit: 50 },
          properties: {
            label: 'Project',
            labelField: 'name',
            placeholder: 'Choose a project…',
          },
        },
        // Empty state — visible until a project is chosen.
        {
          type: 'element:text',
          id: 'empty_hint',
          visibleWhen: "page.selectedProjectId == ''",
          properties: {
            content: '↑ Select a project above to reveal its detail panel.',
            variant: 'caption',
          },
        },
        // Detail panel — gated on the page variable. Appears once a project is picked.
        {
          type: 'element:divider',
          id: 'detail_divider',
          visibleWhen: "page.selectedProjectId != ''",
        },
        {
          type: 'element:text',
          id: 'detail_heading',
          visibleWhen: "page.selectedProjectId != ''",
          properties: {
            content: '✓ Project selected',
            variant: 'h3',
          },
        },
        {
          type: 'element:text',
          id: 'detail_body',
          visibleWhen: "page.selectedProjectId != ''",
          properties: {
            content:
              'This panel is gated on `page.selectedProjectId != ""`. It became visible the instant the picker wrote the variable — the same page-local state any other component (or its data filter) can read.',
            variant: 'body',
          },
        },
      ],
    },
  ],
});
