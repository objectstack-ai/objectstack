/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35551 — what `ListView` hands its Options menu.
 *
 *   - Fields: the grid's column order is the order the Fields level shows, and
 *     moving a field writes the whole order through `onColumnStateChange`,
 *     the door a header drag writes through, keeping the widths beside it.
 *   - Row height on a gallery picks its card size by name, and it is
 *     remembered for the object (the toolbar's density key).
 *
 * The view's name and the host's 保存 / 恢复默认 are pinned beside the
 * reset rules in `ListView.personalization-28950.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView, type ListViewProps } from '../ListView';

const OBJECT_DEF = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'number', label: 'Amount' },
  },
};

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', stage: 'won', amount: 3 }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_DEF),
  };
}

function mount(schema: Partial<ListViewSchema>, props: Partial<ListViewProps> = {}) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView
        schema={{
          type: 'list-view',
          objectName: 'account',
          viewType: 'grid',
          fields: ['name', 'stage', 'amount'],
          userActions: { hideFields: true, density: true },
          ...schema,
        } as ListViewSchema}
        dataSource={dataSource as never}
        {...props}
      />
    </SchemaRendererProvider>,
  );
}

const previous: Record<string, ReturnType<typeof ComponentRegistry.get>> = {};

beforeEach(() => {
  for (const type of ['object-grid', 'object-gallery']) {
    previous[type] = ComponentRegistry.get(type);
    ComponentRegistry.register(type, () => <div data-testid={`${type}-stub`} />);
  }
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
  for (const [type, component] of Object.entries(previous)) {
    if (component) ComponentRegistry.register(type, component as never);
  }
});

describe('Options — Fields writes the column order (objectstack#35551)', () => {
  it('shows the grid\'s column order, and a move writes the whole order beside the widths', async () => {
    const onColumnStateChange = vi.fn();
    mount(
      { columnState: { order: ['amount', 'name', 'stage'], widths: { name: 120 } } } as Partial<ListViewSchema>,
      { onColumnStateChange },
    );
    await screen.findByTestId('object-grid-stub');
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-fields'));
    const shown = Array.from(document.querySelectorAll('[data-testid^="options-fields-move-"]'))
      .map((el) => el.getAttribute('data-testid')!.replace('options-fields-move-', ''));
    expect(shown).toEqual(['amount', 'name', 'stage']);
    fireEvent.keyDown(screen.getByTestId('options-fields-move-amount'), { key: 'ArrowDown' });
    expect(onColumnStateChange).toHaveBeenCalledWith({ order: ['name', 'amount', 'stage'], widths: { name: 120 } });
  });

  it('CONTROL: without a host to write the order, nothing is draggable', async () => {
    mount({});
    await screen.findByTestId('object-grid-stub');
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-fields'));
    expect(screen.queryByTestId('options-fields-move-name')).toBeNull();
  });
});

describe('Options — Row height on a gallery (objectstack#35551)', () => {
  it('picks the card size by name, and the pick is remembered for the object', async () => {
    mount({ viewType: 'gallery' } as Partial<ListViewSchema>);
    await screen.findByTestId('object-gallery-stub');
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-row-height'));
    fireEvent.click(screen.getByTestId('options-row-height-spacious'));
    expect(window.localStorage.getItem('objectui:gallery:density:account')).toBe('large');
    // The level stays open on the pick, which it marks.
    expect(screen.getByTestId('options-row-height-spacious')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('options-row-height-compact'));
    expect(screen.getByTestId('options-row-height-compact')).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('objectui:gallery:density:account')).toBe('small');
  });
});
