// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29676 — the Studio form view canvas honours the view's `layout`.
 *
 * A form view stores `config.layout: 'horizontal'` (the label beside its
 * control). The renderer draws that since objectstack#26843, and the console's
 * form hosts forward it, but `ViewPreview`'s form route built its
 * `object-form` schema from `type` / `sections` / `fields` alone, so Studio
 * Design and Run (one route, `designMode` only changes the hint) drew every
 * label stacked above its control.
 *
 * Asserted on the renderer's own arrangement: a field item under
 * `horizontal` carries the label-column grid classes (`sm:grid`, the
 * two-column template), and one under `vertical` or no layout carries none.
 * Pixel positions are the live measurement's (PR body), not jsdom's.
 */

import '@testing-library/jest-dom/vitest';
import '@object-ui/plugin-form';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { ViewPreview } from './ViewPreview';

afterEach(cleanup);

const objectDef = {
  name: 'task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

function createDataSource(): DataSource {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectDef),
  } as unknown as DataSource;
}

/** A published form view; `layout` is set only when the case names one. */
function formView(layout?: 'horizontal' | 'vertical', type = 'simple') {
  return {
    name: 'task.intake',
    object: 'task',
    viewKind: 'form',
    label: 'Task intake',
    config: {
      type,
      ...(layout ? { layout } : {}),
      sections: [{ name: 'overview', label: 'Overview', fields: ['title', 'status'] }],
    },
  };
}

/** The field item the renderer draws for `name`, once the object schema loads. */
async function renderItem(draft: ReturnType<typeof formView>, editing = false): Promise<HTMLElement> {
  const { container } = render(
    <SchemaRendererProvider dataSource={createDataSource()}>
      <ViewPreview type="view" name="task.intake" draft={draft} locale="en-US" editing={editing} />
    </SchemaRendererProvider>,
  );
  let item: HTMLElement | null = null;
  await waitFor(() => {
    item = container.querySelector<HTMLElement>('[data-field="title"]');
    expect(item).not.toBeNull();
  });
  return item!;
}

/** The renderer's horizontal arrangement (`HORIZONTAL_FIELD_ITEM_CLASS`). */
const isHorizontal = (item: HTMLElement) =>
  item.classList.contains('sm:grid') && item.classList.contains('sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]');

describe('objectstack#29676 — the form view canvas honours layout', () => {
  it('horizontal: the field item draws the label column beside its control (Run)', async () => {
    const item = await renderItem(formView('horizontal'));
    expect(isHorizontal(item)).toBe(true);
    // The label is still the item's own, the one the vertical item carries.
    expect(item.querySelector('label')).toHaveTextContent('Title');
  });

  it('horizontal: the same in Design, which renders through the same route', async () => {
    const item = await renderItem(formView('horizontal'), true);
    expect(isHorizontal(item)).toBe(true);
  });

  it('horizontal reaches a tabbed view too (its layout reads the same key)', async () => {
    const item = await renderItem(formView('horizontal', 'tabbed'));
    expect(isHorizontal(item)).toBe(true);
  });

  it('CONTROL: vertical draws the stacked item it always drew', async () => {
    const item = await renderItem(formView('vertical'));
    expect(isHorizontal(item)).toBe(false);
    expect(item.className).not.toContain('sm:grid');
  });

  it('CONTROL: no layout draws the stacked item it always drew', async () => {
    const item = await renderItem(formView());
    expect(isHorizontal(item)).toBe(false);
    expect(item.className).not.toContain('sm:grid');
  });
});
