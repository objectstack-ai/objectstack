/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12621 — the list toolbar's Display menu closes once a layout is
 * chosen, and on Escape, returning focus to the Display trigger. The panel's
 * toggles keep it open: the control below flips Row numbers and density and
 * finds the panel still drawn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won', closes: '2026-10-16', cover: 'x.png' }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: RECORDS, total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'opportunity', fields: {} }),
  };
}

/** Two visualizations: the switcher draws as a segmented control. */
const TWO: ListViewSchema = {
  type: 'list-view',
  objectName: 'opportunity',
  viewType: 'grid',
  fields: ['name', 'stage'],
  kanban: { groupByField: 'stage' },
  appearance: { allowedVisualizations: ['grid', 'kanban'] },
} as ListViewSchema;

/** Five visualizations: the switcher draws as a nested dropdown. */
const FIVE: ListViewSchema = {
  ...TWO,
  gallery: { coverField: 'cover' },
  calendar: { startDateField: 'closes' },
  timeline: { startDateField: 'closes' },
  appearance: { allowedVisualizations: ['grid', 'kanban', 'gallery', 'calendar', 'timeline'] },
} as ListViewSchema;

const STUBBED = ['object-grid', 'object-kanban', 'object-gallery', 'object-calendar', 'object-timeline'];
let previous: Array<[string, ReturnType<typeof ComponentRegistry.get>]> = [];

beforeEach(() => {
  previous = STUBBED.map((type) => [type, ComponentRegistry.get(type)]);
  for (const type of STUBBED) {
    ComponentRegistry.register(type, () => <div data-testid={`${type}-stub`} />);
  }
});

afterEach(() => {
  cleanup();
  for (const [type, impl] of previous) if (impl) ComponentRegistry.register(type, impl as any);
});

function mount(schema: ListViewSchema) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={schema} dataSource={dataSource as never} showViewSwitcher onInlineEditChange={vi.fn()} />
    </SchemaRendererProvider>,
  );
}

async function openDisplay(): Promise<{ trigger: HTMLElement; content: HTMLElement }> {
  await screen.findByTestId('object-grid-stub');
  const trigger = screen.getByTestId('toolbar-display-trigger');
  fireEvent.click(trigger);
  const content = await screen.findByTestId('view-settings-content');
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return { trigger, content };
}

async function expectClosedWithFocusOn(trigger: HTMLElement) {
  await waitFor(() => expect(screen.queryByTestId('view-settings-content')).toBeNull());
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
}

describe('the Display menu closes when its work is done (objectui#12621)', () => {
  it('choosing Kanban in the segmented Layout row closes the menu and focuses the trigger', async () => {
    mount(TWO);
    const { trigger, content } = await openDisplay();
    const row = within(content).getByTestId('display-layout-row');
    fireEvent.click(within(row).getByRole('tab', { name: 'Kanban' }));
    await screen.findByTestId('object-kanban-stub');
    await expectClosedWithFocusOn(trigger);
  });

  it('choosing Kanban in the nested Layout dropdown closes the menu and focuses the trigger', async () => {
    mount(FIVE);
    const { trigger, content } = await openDisplay();
    const row = within(content).getByTestId('display-layout-row');
    fireEvent.click(within(row).getByTestId('view-switcher-dropdown'));
    fireEvent.click(await screen.findByRole('button', { name: 'Kanban' }));
    await screen.findByTestId('object-kanban-stub');
    await expectClosedWithFocusOn(trigger);
  });

  it('Escape closes the menu and focuses the trigger', async () => {
    mount(TWO);
    const { trigger, content } = await openDisplay();
    fireEvent.keyDown(within(content).getByTestId('display-row-numbers-toggle'), { key: 'Escape' });
    await expectClosedWithFocusOn(trigger);
  });

  it('control: toggling Row numbers and cycling density keep the menu open', async () => {
    mount(TWO);
    const { trigger, content } = await openDisplay();
    const toggle = within(content).getByTestId('display-row-numbers-toggle');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(within(content).getByTestId('view-settings-density-cycle'));
    await waitFor(() => expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('view-settings-content')).toBe(content);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
