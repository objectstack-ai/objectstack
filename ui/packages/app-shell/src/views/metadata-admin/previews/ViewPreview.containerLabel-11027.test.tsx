// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11027: the Studio view preview shows the view's own `label` as its
 * heading.
 *
 * `ViewPreview` relays the view's `label` as the label of the one named
 * listView it injects into `object-view`. `ObjectView` draws its named-view tab
 * strip only for two or more entries, so on this route that copy reached no
 * human. The card's direction is a heading, ⛔ not a one-entry tab strip.
 *
 * The list case runs the real stack: the real `ViewPreview`, `SchemaRenderer`
 * and registry, and the registered `object-view` renderer over a stub data
 * source. The readings are the rendered DOM.
 *
 * The cases:
 *   - authored: the label is the preview's heading, on the list and the form
 *     route alike;
 *   - absent: no heading is drawn, and nothing stands in for the label (the
 *     heading set is the authored one minus the label);
 *   - locale map: the label resolves in the designer `locale`, never as
 *     `[object Object]`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
// Module scope, not a hook: this import IS the `object-view` registration the
// preview's `SchemaRenderer` resolves.
import '@object-ui/plugin-view';
import { ViewPreview } from './ViewPreview';

afterEach(cleanup);

const objectDef = {
  name: 'task',
  label: 'Task',
  fields: {
    name: { name: 'name', type: 'text', label: 'Task Name' },
    stage: { name: 'stage', type: 'text', label: 'Pipeline Stage' },
  },
};

/** A stub adapter: the members this route calls, not the whole `DataSource` surface. */
function createDataSource(): DataSource {
  return {
    find: vi.fn(async () => ({ data: [{ id: 't1', name: 'Alpha', stage: 'open' }], total: 1 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectDef),
  } as unknown as DataSource;
}

/** `ObjectGrid` asks the explain engine for row verdicts; a 501 reads fail-open. */
const apiFetch = vi.fn(async () => new Response(null, { status: 501 }));

/** Mount the Studio preview of one stored grid view, the way the editor does. */
async function renderListView(label: unknown, locale = 'en-US') {
  const draft: Record<string, unknown> = {
    name: 'task.open_tasks',
    object: 'task',
    viewKind: 'list',
    config: { type: 'grid', columns: ['name', 'stage'] },
  };
  if (label !== undefined) draft.label = label;
  render(
    <SchemaRendererProvider dataSource={createDataSource()} apiFetch={apiFetch}>
      <ViewPreview type="view" name="open_tasks" draft={draft} locale={locale} />
    </SchemaRendererProvider>,
  );
  // The grid has drawn its row: the object-view route is up.
  await screen.findByText('Alpha', undefined, { timeout: 5000 });
}

/** The text of every heading on the page, in document order. */
function headingTexts(): string[] {
  return screen.queryAllByRole('heading').map((h) => (h.textContent ?? '').trim());
}

describe('ViewPreview shows the view label as its heading (objectui#11027)', () => {
  it('renders an authored label as the list preview heading', async () => {
    await renderListView('Open tasks');
    expect(screen.getByRole('heading', { name: 'Open tasks' })).toBeTruthy();
  });

  it('draws no heading and no stand-in when the label is not authored', async () => {
    await renderListView('Open tasks');
    const authored = headingTexts();
    expect(authored).toContain('Open tasks');
    cleanup();

    await renderListView(undefined);
    expect(headingTexts()).toEqual(authored.filter((h) => h !== 'Open tasks'));
  });

  it('resolves a locale-map label in the designer locale', async () => {
    const label = { en: 'Open tasks', 'zh-CN': '未完成任务' };

    await renderListView(label, 'zh-CN');
    expect(screen.getByRole('heading', { name: '未完成任务' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('[object Object]');
    cleanup();

    await renderListView(label, 'en-US');
    expect(screen.getByRole('heading', { name: 'Open tasks' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('renders the label on the form route too', () => {
    render(
      <SchemaRendererProvider dataSource={createDataSource()}>
        <ViewPreview
          type="view"
          name="task_form"
          draft={{
            name: 'task.task_form',
            object: 'task',
            viewKind: 'form',
            label: 'Task intake',
            config: { type: 'simple', sections: [{ fields: [{ field: 'name' }] }] },
          }}
          locale="en-US"
        />
      </SchemaRendererProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Task intake' })).toBeTruthy();
  });
});
