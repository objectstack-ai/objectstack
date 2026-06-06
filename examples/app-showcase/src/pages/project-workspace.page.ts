// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * Project Workspace — a master-detail (header + line items) entry scenario.
 *
 * Demonstrates the `object-master-detail-form` renderer (ObjectUI ADR-0001):
 * create a Project (parent) together with its Tasks (children) in one screen.
 * `showcase_task.project` is a `master_detail` field, so the children are
 * created with the parent FK set in a single client-orchestrated transaction.
 */
export const ProjectWorkspacePage: Page = {
  name: 'showcase_project_workspace',
  label: 'New Project + Tasks',
  type: 'app',
  template: 'default',
  kind: 'full',
  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        {
          type: 'page:header',
          properties: {
            title: 'New Project + Tasks',
            subtitle:
              'Master-detail entry — fill the project, add its tasks inline, and save them together.',
            icon: 'folder-plus',
          },
        },
      ],
    },
    {
      name: 'main',
      width: 'large',
      components: [
        {
          type: 'object-master-detail-form',
          properties: {
            objectName: 'showcase_project',
            mode: 'create',
            formType: 'simple',
            submitText: 'Create Project + Tasks',
            fields: ['name', 'account', 'status', 'health', 'budget', 'end_date'],
            // Config-driven master-detail: only the child object is named. The
            // relationship FK (showcase_task.project) and the editable grid
            // columns are auto-derived from the child object's metadata — no
            // hand-authored columns block. Add `columns`/`relationshipField`
            // here only to override the derived defaults.
            details: [
              { title: 'Tasks', childObject: 'showcase_task', addLabel: 'Add task' },
            ],
          },
        },
      ],
    },
  ],
};
