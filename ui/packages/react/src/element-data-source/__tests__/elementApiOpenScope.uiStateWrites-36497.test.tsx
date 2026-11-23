/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ElementApiOpenScope` keeps an open's reads across the shell's own UI-state
 * writes (objectstack#36497).
 *
 * During an open the console writes the person's own UI state through its data
 * source: the recent items (`ui.recent`) and the last app (`ui.app.last`) are
 * `sys_user_preference` rows, and `useMutationInvalidationBridge` reports each
 * save on the data-invalidation bus. When such a save landed between the
 * navigation's read of a bound URL and the page element's mount, the scope
 * dropped the navigation's answer and the element asked the same URL again,
 * breaking one read per open (objectui#13323).
 *
 * Mounted over the real bridge (a data source that emits what the ObjectStack
 * adapter emits after a write), the real scope, a navigation reader that reads
 * the way the nav gate does (`readElementApi` with the open it is in) and the
 * real `SchemaRenderer` for the page element, mounted only once the test says
 * so:
 *
 *  - a preference save between the navigation read and the page mount: the
 *    URL is asked once (an update of a known row, and a create of a new one);
 *  - the save still reaches the readers of `sys_user_preference` itself (the
 *    User page's Preferences list), which is why the bridge keeps reporting it;
 *  - CONTROL: a save to any other object in the same window ends the reuse, and
 *    the element asks again, as the scope has always done.
 *
 * Each case uses its own URL: `readElementApi` shares a pending request per URL
 * for the life of the module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { SchemaRenderer } from '../../SchemaRenderer';
import { SchemaRendererContext, type ApiFetch } from '../../context/SchemaRendererContext';
import { useDataInvalidation, useMutationInvalidationBridge } from '../../data-invalidation';
import { ElementApiOpenScope, readElementApi, useElementApiOpen } from '../useElementApiDataSource';

type MutationEvent = { type: 'create' | 'update' | 'delete'; resource: string; id?: string };

/** A data source that reports its writes the way the ObjectStack adapter does. */
function writingDataSource() {
  const listeners = new Set<(event: MutationEvent) => void>();
  return {
    onMutation(listener: (event: MutationEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A write through the data source has landed. */
    wrote(event: MutationEvent) {
      for (const listener of Array.from(listeners)) listener(event);
    },
  };
}

function Probe({ schema }: { schema: { id?: string; properties?: Record<string, unknown> } }) {
  return <span data-testid={`ui-state-probe-${schema.id}`}>{String(schema.properties?.content ?? '')}</span>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let urlSeq = 0;
function freshUrl(): string {
  urlSeq += 1;
  return `/api/v1/ui-state-write-probe/${urlSeq}`;
}

/** Reads `url` the way the nav gate does: once, in the open it is in. */
function NavRead({ url, apiFetch }: { url: string; apiFetch: ApiFetch }) {
  const open = useElementApiOpen();
  const [answer, setAnswer] = useState('');
  useEffect(() => {
    readElementApi(url, apiFetch, open).then(
      (body) => setAnswer(String((body as { data: { total: number } }).data.total)),
      () => setAnswer('failed'),
    );
    // One read per mount, as the gate asks it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return <span data-testid="ui-state-probe-nav">{answer}</span>;
}

function Bridge({ dataSource }: { dataSource: unknown }) {
  useMutationInvalidationBridge(dataSource);
  return null;
}

function pageElement(url: string) {
  return {
    type: 'ui-state-probe',
    id: 'page',
    dataSource: { provider: 'api', read: { url }, path: 'data' },
    properties: { content: '${data.total}' },
  } as never;
}

function mount(url: string, apiFetch: ApiFetch) {
  const dataSource = writingDataSource();
  const host = (pageMounted: boolean) => (
    <SchemaRendererContext.Provider value={{ dataSource: null as DataSource | null, apiFetch }}>
      <Bridge dataSource={dataSource} />
      <ElementApiOpenScope open="open-1">
        <NavRead url={url} apiFetch={apiFetch} />
        {pageMounted && <SchemaRenderer schema={pageElement(url)} />}
      </ElementApiOpenScope>
    </SchemaRendererContext.Provider>
  );
  const view = render(host(false));
  return {
    dataSource,
    navSettled: () => waitFor(() => expect(screen.getByTestId('ui-state-probe-nav').textContent).not.toBe('')),
    mountPage: async (expected: string) => {
      act(() => view.rerender(host(true)));
      await waitFor(() => expect(screen.getByTestId('ui-state-probe-page').textContent).toBe(expected));
    },
  };
}

function callsFor(apiFetch: ReturnType<typeof vi.fn>, url: string): number {
  return apiFetch.mock.calls.filter((call) => String(call[0]) === url).length;
}

describe('ElementApiOpenScope — the shell\'s UI-state writes keep the open\'s reads (objectstack#36497)', () => {
  beforeEach(() => {
    ComponentRegistry.register('ui-state-probe', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('ui-state-probe');
  });

  it.each<[string, MutationEvent]>([
    ['the recent items row is updated', { type: 'update', resource: 'sys_user_preference', id: 'pref_recent' }],
    ['the last-app row is created', { type: 'create', resource: 'sys_user_preference' }],
  ])('a preference save between the nav read and the page mount asks the URL once: %s', async (_label, event) => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total: 3 } }));
    const { dataSource, navSettled, mountPage } = mount(url, apiFetch);
    await navSettled();
    act(() => dataSource.wrote(event));
    await mountPage('3');
    expect(callsFor(apiFetch, url), 'the page element asked the URL the navigation already read').toBe(1);
  });

  it('the preference save still reaches the readers of sys_user_preference', () => {
    const dataSource = writingDataSource();
    renderHook(() => useMutationInvalidationBridge(dataSource));
    const { result } = renderHook(() => useDataInvalidation('sys_user_preference'));
    expect(result.current).toBe(0);
    act(() => dataSource.wrote({ type: 'update', resource: 'sys_user_preference', id: 'pref_recent' }));
    expect(result.current).toBe(1);
  });

  it('CONTROL: a save to another object in the same window ends the reuse: the element asks again', async () => {
    const url = freshUrl();
    let total = 3;
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total } }));
    const { dataSource, navSettled, mountPage } = mount(url, apiFetch);
    await navSettled();
    total = 5;
    act(() => dataSource.wrote({ type: 'update', resource: 'account', id: 'acc_1' }));
    await mountPage('5');
    expect(callsFor(apiFetch, url)).toBe(2);
  });
});
