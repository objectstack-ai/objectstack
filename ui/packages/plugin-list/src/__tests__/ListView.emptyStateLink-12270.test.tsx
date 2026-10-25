/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView`'s empty state draws the view's declared `emptyState.link`
 * (objectui#12270).
 *
 * The spec's `EmptyStateSchema` declares one optional `link`, `{ label, url }`,
 * for "one plain sentence and one action" on an empty page. `ListView`'s empty
 * branch (the `grid` and `gallery` visualizations) handed `ListEmptyState` the
 * `title`, `message` and `icon` and nothing else, so the link parsed and was
 * never drawn. It is now drawn through the one shared `EmptyStateLink`, and the
 * click is the action runner's navigation (`classifyNavigationTarget`): ⛔ no
 * scheme test in `ListView`.
 *
 * Each row mounts the real `ListView` over a data source that answers no rows,
 * under an `ActionProvider` wired as the console wires it (`onNavigate` +
 * `onToast`), with the real runner behind it. A refusal is read off the runner
 * (what a bare runner answers for the same target), not restated here. The
 * shared component's own rows, `mailto:` and the provider-less hand-off among
 * them, are `empty-state-link-12270.test.tsx` in `@object-ui/components`.
 */

import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ActionRunner } from '@object-ui/core';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const LINK_LABEL = 'Read the guide';

const emptyDataSource = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
});

async function mountEmpty(viewType: 'grid' | 'gallery', extra: Partial<ListViewSchema>) {
  const ds = emptyDataSource();
  const onNavigate = vi.fn();
  const onToast = vi.fn();
  const schema = {
    type: 'list-view',
    objectName: 'tasks',
    viewType,
    columns: ['name'],
    ...extra,
  } as ListViewSchema;
  const { container } = render(
    <ActionProvider onNavigate={onNavigate} onToast={onToast}>
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <ListView schema={schema} dataSource={ds as unknown as DataSource} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  await waitFor(() => expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull());
  const state = container.querySelector('[data-testid="empty-state"]') as HTMLElement;
  return { state, onNavigate, onToast };
}

const linkIn = (state: HTMLElement) => state.querySelector('[data-testid="empty-state-link"]') as HTMLElement | null;

let openSpy: MockInstance<typeof window.open>;
beforeEach(() => {
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  cleanup();
  openSpy.mockRestore();
});

describe('ListView draws the declared empty-state link through the action runner (objectui#12270)', () => {
  it('grid: the link is drawn beside the add-record action, and an in-app path is followed in place', async () => {
    const url = '/apps/crm/docs/connect';
    const { state, onNavigate, onToast } = await mountEmpty('grid', {
      addRecord: { enabled: true },
      emptyState: { title: 'No tasks yet', link: { label: LINK_LABEL, url } },
    });
    // The spec keeps the two apart, so both are drawn.
    expect(state.querySelector('[data-testid="empty-state-add-record"]')).not.toBeNull();
    const link = linkIn(state);
    expect(link?.textContent).toBe(LINK_LABEL);

    fireEvent.click(link!);
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(url, expect.objectContaining({ external: false, newTab: false })),
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onToast).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('gallery: an https:// link goes out as the runner sends an external target', async () => {
    const url = 'https://example.com/how-to';
    const { state, onNavigate, onToast } = await mountEmpty('gallery', {
      emptyState: { link: { label: LINK_LABEL, url } },
    });
    fireEvent.click(linkIn(state)!);
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(url, expect.objectContaining({ external: true, newTab: true })),
    );
    expect(onToast).not.toHaveBeenCalled();
  });

  it('a value the runner refuses navigates nowhere, and the refusal shown is the runner\'s', async () => {
    const url = 'thanks';
    const expected = await new ActionRunner({}).execute({ type: 'url', target: url });
    expect(expected.success).toBe(false);

    const { state, onNavigate, onToast } = await mountEmpty('grid', {
      emptyState: { link: { label: LINK_LABEL, url } },
    });
    fireEvent.click(linkIn(state)!);
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expected.error, expect.objectContaining({ type: 'error' })),
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: an empty state that declares no link draws none, and its add-record action as before', async () => {
    const { state } = await mountEmpty('grid', {
      addRecord: { enabled: true },
      emptyState: { title: 'No tasks yet' },
    });
    expect(linkIn(state)).toBeNull();
    expect(state.querySelector('[data-testid="empty-state-add-record"]')).not.toBeNull();
  });
});
