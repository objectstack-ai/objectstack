/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid`'s authored empty state draws its declared `link`
 * (objectui#12270).
 *
 * The spec's `object-grid` row takes the list view's `EmptyStateSchema` by
 * reference, so the `link: { label, url }` that schema gained reaches this
 * block too. `ObjectGrid` read `title`, `message` and `icon` only, so the link
 * parsed and was never drawn. It is now drawn through the one shared
 * `EmptyStateLink` that `ListView`'s empty state uses, and the click is the
 * action runner's navigation (`classifyNavigationTarget`): ⛔ no scheme test in
 * the grid.
 *
 * Each row mounts the `{ type, properties }` document a page carries through
 * the real `SchemaRenderer` and the registered block, over a grid with no
 * record, under an `ActionProvider` wired as the console wires it
 * (`onNavigate` + `onToast`). A refusal is read off a bare runner for the same
 * target, not restated here. The shared component's own rows are
 * `empty-state-link-12270.test.tsx` in `@object-ui/components`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ActionRunner } from '@object-ui/core';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Registers `object-grid`, the block under test.
import '../index';

const LINK_LABEL = 'Read the guide';

const doc = (emptyState: unknown, items: Record<string, unknown>[] = []) => ({
  type: 'object-grid',
  properties: {
    objectName: 'contacts',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items },
    emptyState,
  },
});

function mount(emptyState: unknown, items: Record<string, unknown>[] = []) {
  const onNavigate = vi.fn();
  const onToast = vi.fn();
  const result = render(
    <ActionProvider onNavigate={onNavigate} onToast={onToast}>
      <SchemaRenderer schema={doc(emptyState, items) as never} />
    </ActionProvider>,
  );
  return { ...result, onNavigate, onToast };
}

async function emptyStateOf(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('[data-testid="object-grid-empty-state"]')).not.toBeNull());
  return container.querySelector('[data-testid="object-grid-empty-state"]') as HTMLElement;
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

describe('object-grid draws the declared empty-state link through the action runner (objectui#12270)', () => {
  it('an in-app path is drawn with its label and followed in place', async () => {
    const url = '/apps/crm/docs/contacts';
    const { container, onNavigate, onToast } = mount({ title: 'No contacts yet', link: { label: LINK_LABEL, url } });
    const state = await emptyStateOf(container);
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

  it('an https:// link goes out as the runner sends an external target', async () => {
    const url = 'https://example.com/how-to';
    const { container, onNavigate } = mount({ link: { label: LINK_LABEL, url } });
    fireEvent.click(linkIn(await emptyStateOf(container))!);
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(url, expect.objectContaining({ external: true, newTab: true })),
    );
  });

  it('a value the runner refuses navigates nowhere, and the refusal shown is the runner\'s', async () => {
    const url = '//cdn.example.com/x';
    const expected = await new ActionRunner({}).execute({ type: 'url', target: url });
    expect(expected.success).toBe(false);

    const { container, onNavigate, onToast } = mount({ link: { label: LINK_LABEL, url } });
    fireEvent.click(linkIn(await emptyStateOf(container))!);
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expected.error, expect.objectContaining({ type: 'error' })),
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: an authored empty state with no link draws no link', async () => {
    const { container } = mount({ title: 'No contacts yet' });
    expect(linkIn(await emptyStateOf(container))).toBeNull();
  });
});
