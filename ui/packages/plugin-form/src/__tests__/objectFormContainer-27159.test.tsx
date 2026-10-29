/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#27159 — ADR-0050 Decision 4, the renderer half: `ObjectForm`
 * lays a form out and never chooses where it opens. The `object-form` BLOCK is
 * the caller that opens a `drawer` / `modal` form, through
 * `ObjectFormContainer`; a host that mounts `<ObjectForm>` itself gets the
 * inline form and owns its own container.
 *
 * Pinned here, through the registered renderer (`SchemaRenderer`), not a
 * component import, because the block route is the claim:
 *   1. a `drawer` / `modal` block opens a dialog holding the form;
 *   2. a layout block (`tabbed`) renders inline, with no dialog;
 *   3. a `drawer` / `modal` node handed straight to `<ObjectForm>` renders
 *      inline — the container is the caller's;
 *   4. the #1890 pin: a tabbed layout inside a modal still renders its tabs.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold `object-form` and the
// field widgets it renders into before the first render (AGENTS.md §测试纪律).
import '@object-ui/components';
import '@object-ui/fields';
import '../index';
import { ObjectForm } from '../ObjectForm';
import { ObjectFormContainer } from '../ObjectFormContainer';

const TASK_SCHEMA = {
  name: 'task',
  label: 'Task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    status: { name: 'status', type: 'text', label: 'Status' },
  },
};

const SECTIONS = [
  { name: 'main', label: 'Main', fields: ['title'] },
  { name: 'more', label: 'More', fields: ['status'] },
];

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: '1' }),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(TASK_SCHEMA),
  };
}

function renderBlock(properties: Record<string, unknown>) {
  const adapter = makeAdapter();
  const utils = render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={{ type: 'object-form', properties: { objectName: 'task', mode: 'create', ...properties } }} />
    </SchemaRendererProvider>,
  );
  return { adapter, ...utils };
}

beforeEach(() => cleanup());

describe('objectstack#27159 — the `object-form` block opens its own container', () => {
  it.each(['drawer', 'modal'] as const)('a `%s` block opens a dialog holding the form', async (formType) => {
    renderBlock({ formType, title: 'New task' });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Title'));
    expect(dialog.textContent).toContain('New task');
  });

  it('a `tabbed` block renders inline — no dialog', async () => {
    const { container } = renderBlock({ formType: 'tabbed', sections: SECTIONS });
    await waitFor(() => expect(container.textContent).toContain('Main'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Main', 'More']);
  });

  it.each(['drawer', 'modal'] as const)('a `%s` node handed straight to `<ObjectForm>` renders inline: the container is the caller\'s', async (formType) => {
    const adapter = makeAdapter();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'create', formType } as any}
        dataSource={adapter as any}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('Title'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelectorAll('form')).toHaveLength(1);
  });

  it('the #1890 pin: a tabbed layout inside the modal container still draws its tabs', async () => {
    const adapter = makeAdapter();
    render(
      <ObjectFormContainer
        schema={{
          type: 'object-form',
          objectName: 'task',
          mode: 'create',
          formType: 'modal',
          contentLayout: 'tabbed',
          sections: SECTIONS,
        } as any}
        dataSource={adapter as any}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelectorAll('[role="tab"]')).toHaveLength(2));
    expect([...dialog.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Main', 'More']);
  });

  it('CONTROL: a layout `formType` handed to the container falls back to the inline form', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <ObjectFormContainer
        schema={{ type: 'object-form', objectName: 'task', mode: 'create', formType: 'simple' } as any}
        dataSource={adapter as any}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('Title'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
