/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13238 — a record drawer stays open on its first open, past the
 * load of its body.
 *
 * MEASURED (showcase Task Desk, a `kind:'react'` page that opens
 * `<ObjectForm formType="drawer" mode="edit" open>` on a row click and closes it
 * only from `onOpenChange(false)` or `onSuccess`, in Chromium against a live
 * showcase backend): on the first open the drawer was unmounted about two
 * seconds in, with NO dismiss event — no Escape, no outside pointer-down, no
 * focus-outside, no `onOpenChange(false)` from the drawer or to the page. The
 * chain, read in order:
 *  1. the read ends and the body is drawn for the first time; its field
 *     widgets are `React.lazy`, so that render suspends;
 *  2. `DrawerForm` had no boundary of its own, so the suspension landed on the
 *     console route's `<Suspense>`: the whole page was swapped for the loading
 *     screen while the chunks loaded;
 *  3. when the route came back, its effects re-ran (`StrictMode`, below), the
 *     page view re-rendered and handed the react page a fresh schema, and the
 *     react page was compiled again and REMOUNTED — its `editId` state reset
 *     to `null`, and the drawer it rendered went with it.
 * A second open stays because the chunks are cached and nothing suspends. The
 * modal does not close because `ModalForm` owns its body's wait
 * (objectui#12559).
 *
 * THE FIX gives the drawer the same boundary (`DrawerFormBodyPending` in
 * `DrawerForm.tsx`): the suspension stays inside the sheet, the host's
 * boundary never shows its fallback, and nothing above the drawer re-runs.
 *
 * THE HOST HERE is the console's shape, reduced to the two links that matter:
 * a route `<Suspense>` whose fallback counts its mounts, and a route component
 * that re-renders when its effects re-run and remounts its page on that render
 * (the page view handing the react page a fresh schema, which recompiles it).
 * The whole is mounted under `StrictMode`, as the console is: the remount in
 * step 3 is driven by React re-running the route's effects as its content
 * reappears, which React does under `StrictMode` (measured: with the console's
 * `StrictMode` removed, the first open stays open on the unfixed drawer, and
 * the route still shows its loading screen for the length of the load). The
 * `url` widget is replaced by one whose chunk resolves only when the test
 * releases it, so the first open's wait is observable instead of racing the
 * module loader.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { Suspense, useEffect, useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectForm } from '../ObjectForm';

registerAllFields();
afterEach(() => cleanup());

type ObjectFormNode = React.ComponentProps<typeof ObjectForm>['schema'];

/** Replace the `url` widget with one whose chunk lands only on `release()`. */
function deferUrlWidget(): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const Deferred = React.lazy(async () => {
    await gate;
    return {
      default: (props: { id?: string; value?: unknown; onChange?: (v: unknown) => void }) => (
        <input
          data-testid="deferred-url-widget"
          id={props.id}
          value={(props.value as string) ?? ''}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      ),
    };
  });
  ComponentRegistry.register('url', Deferred, { namespace: 'field', skipFallback: true });
  return { release: () => act(() => release()) as unknown as void };
}

const TASK = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    link: { type: 'url', label: 'Link' },
  },
};

function dataSource(): DataSource {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(TASK),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue({ id: 'T1', title: 'Warehouse schema', link: 'https://example.com' }),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as DataSource;
}

/** The console's mount, reduced: route boundary → route → page → drawer. */
function mountTaskDesk() {
  const ds = dataSource();
  const counts = { routeFallbackMounts: 0 };
  const onOpenChange = vi.fn();

  function RouteFallback() {
    useEffect(() => { counts.routeFallbackMounts++; }, []);
    return <div data-testid="route-fallback">loading</div>;
  }

  // The task-desk page: a row opens the drawer, and only the drawer's
  // `onOpenChange(false)` closes it.
  function Page() {
    const [editId, setEditId] = useState<string | null>(null);
    return (
      <div>
        <button type="button" onClick={() => setEditId('T1')}>Warehouse schema</button>
        {editId != null ? (
          <ObjectForm
            schema={{
              type: 'object-form',
              formType: 'drawer',
              objectName: 'task',
              mode: 'edit',
              recordId: editId,
              open: true,
              title: 'Edit task',
              onOpenChange: (open: boolean) => {
                onOpenChange(open);
                if (!open) setEditId(null);
              },
            } as unknown as ObjectFormNode}
            dataSource={ds}
          />
        ) : null}
      </div>
    );
  }

  // The route: an effect that re-runs re-renders it, and that render remounts
  // the page — the page view and the react page's recompile, in one link.
  function Route() {
    const [generation, setGeneration] = useState(0);
    useEffect(() => { setGeneration((n) => n + 1); }, []);
    return <Page key={generation} />;
  }

  // Under `StrictMode`, as `apps/console/src/main.tsx` mounts the console.
  render(
    <React.StrictMode>
      <Suspense fallback={<RouteFallback />}>
        <Route />
      </Suspense>
    </React.StrictMode>,
  );
  return { counts, onOpenChange };
}

/** The page's own row; the same element before and after means no remount. */
const pageRow = () => screen.getByRole('button', { name: 'Warehouse schema', hidden: true });

const openRow = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Warehouse schema' }));

const titleInput = () =>
  document.body.querySelector('[data-field="title"] input') as HTMLInputElement | null;

/** Let late effects, observers and timers settle before reading state. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

async function openPastTheLoad(user: ReturnType<typeof userEvent.setup>, release?: () => void) {
  await openRow(user);
  const sheet = await screen.findByRole('dialog');
  release?.();
  await screen.findByTestId('deferred-url-widget');
  await waitFor(() => expect(titleInput()?.value).toBe('Warehouse schema'));
  await settle();
  return sheet;
}

describe('a record drawer stays open on its first open (objectui#13238)', () => {
  it('the first open waits for its widgets inside the sheet, stays open past the load, and keeps focus inside', async () => {
    const { release } = deferUrlWidget();
    const user = userEvent.setup();
    const { counts, onOpenChange } = mountTaskDesk();
    await screen.findByRole('button', { name: 'Warehouse schema' });
    const fallbacksBefore = counts.routeFallbackMounts;
    const rowBefore = pageRow();

    await openRow(user);
    const sheet = await screen.findByRole('dialog');
    // Mid-load: read where the body's wait went — inside the sheet, or up to
    // the route — once the read has ended and the body is being drawn.
    await waitFor(() => expect(document.body.querySelector('[data-testid="drawer-form-body-pending"], [data-testid="route-fallback"]')).not.toBeNull());
    const waitedInsideSheet = !!sheet.querySelector('[data-testid="drawer-form-body-pending"]');
    const routeFallbackMidLoad = counts.routeFallbackMounts - fallbacksBefore;

    release();
    await waitFor(() => expect(document.body.querySelector('[data-testid="deferred-url-widget"], [data-testid="route-fallback"]')).not.toBeNull());
    await waitFor(() => expect(screen.queryByTestId('route-fallback')).toBeNull());
    await settle();

    // Each fact on its own line, soft, so a run without the fix names the
    // whole measured chain: the drawer is gone, because the page was
    // remounted, because the route showed its fallback — and the drawer never
    // asked to close.
    expect.soft(screen.queryByRole('dialog'), 'the drawer is still open past the load').toBe(sheet);
    expect.soft(pageRow(), 'the page is the one that opened the drawer (not remounted)').toBe(rowBefore);
    expect.soft(routeFallbackMidLoad, 'route fallback mounts while the body loaded').toBe(0);
    expect.soft(onOpenChange, 'the drawer never asked to close').not.toHaveBeenCalledWith(false);
    expect.soft(waitedInsideSheet, 'the body waited inside the sheet').toBe(true);
    expect(titleInput()?.value).toBe('Warehouse schema');
    expect(screen.queryByTestId('drawer-form-body-pending')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(titleInput()));
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it('Escape still closes it, through onOpenChange(false)', async () => {
    const { release } = deferUrlWidget();
    const user = userEvent.setup();
    const { onOpenChange } = mountTaskDesk();
    await openPastTheLoad(user, release);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('the Close button still closes it, through onOpenChange(false)', async () => {
    const { release } = deferUrlWidget();
    const user = userEvent.setup();
    const { onOpenChange } = mountTaskDesk();
    const sheet = await openPastTheLoad(user, release);

    const close = [...sheet.querySelectorAll('button')].find((b) => /close/i.test(b.textContent ?? ''));
    expect(close).toBeDefined();
    await user.click(close!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a click outside the sheet, on its overlay, still closes it, through onOpenChange(false)', async () => {
    const { release } = deferUrlWidget();
    const user = userEvent.setup();
    const { onOpenChange } = mountTaskDesk();
    const sheet = await openPastTheLoad(user, release);

    // The overlay is the sheet's sibling in the portal: outside the sheet's
    // layer. A modal sheet dismisses an outside press on the click that ends
    // it, so the whole press is sent, as a pointer would.
    const overlay = sheet.previousElementSibling as HTMLElement | null;
    expect(overlay?.getAttribute('data-state')).toBe('open');
    fireEvent.pointerDown(overlay!, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseDown(overlay!, { button: 0 });
    fireEvent.pointerUp(overlay!, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseUp(overlay!, { button: 0 });
    fireEvent.click(overlay!, { button: 0 });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('control: a second open, with the widgets loaded, stays open on its first field as before', async () => {
    const { release } = deferUrlWidget();
    const user = userEvent.setup();
    const { counts, onOpenChange } = mountTaskDesk();
    await openPastTheLoad(user, release);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    onOpenChange.mockClear();
    const fallbacksBefore = counts.routeFallbackMounts;
    const rowBefore = pageRow();

    const sheet = await openPastTheLoad(user);

    expect(screen.getByRole('dialog')).toBe(sheet);
    expect(counts.routeFallbackMounts).toBe(fallbacksBefore);
    expect(pageRow()).toBe(rowBefore);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(document.activeElement).toBe(titleInput()));
  });
});
