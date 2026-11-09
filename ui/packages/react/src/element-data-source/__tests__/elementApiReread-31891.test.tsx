/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ElementApiRereadScope`: a page's `api`-bound elements read again when the
 * page asks them to (objectstack#31891), through the real `SchemaRenderer` and
 * the host fetch on `SchemaRendererContext.apiFetch`.
 *
 *  - `reread()` makes one more GET; the answer on screen stays while it is in
 *    flight (no loading panel), then the new one replaces it in place;
 *  - a request in flight when `reread()` is called is not joined;
 *  - a reader outside the scope does not read again, and a change declared on
 *    the data-invalidation bus alone reads nothing.
 *
 * Each case uses its own URL: `readElementApi` shares a pending request per URL
 * for the life of the module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { SchemaRenderer } from '../../SchemaRenderer';
import { SchemaRendererContext, type ApiFetch } from '../../context/SchemaRendererContext';
import { notifyDataChanged } from '../../data-invalidation';
import { ElementApiOpenScope, ElementApiRereadScope, createElementApiReread, type ElementApiReread } from '../useElementApiDataSource';

function RereadProbe({ schema }: { schema: { id?: string; properties?: Record<string, unknown> } }) {
  // A remount would draw a new instance id: the re-read must not rebuild the node.
  const [instance] = React.useState(() => Math.random().toString(36).slice(2));
  return (
    <span data-testid={`reread-probe-${schema.id}`} data-instance={instance}>
      {String(schema.properties?.content ?? '')}
    </span>
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let urlSeq = 0;
function freshUrl(): string {
  urlSeq += 1;
  return `/api/v1/reread-probe/${urlSeq}`;
}

function element(id: string, url: string) {
  return {
    type: 'reread-probe',
    id,
    dataSource: { provider: 'api', read: { url }, path: 'data' },
    properties: { content: '${data.state}' },
  } as never;
}

/** Answers each GET from `answers` in turn, holding any answer that is a pending promise. */
function scriptedFetch(answers: Array<unknown | Promise<unknown>>) {
  let call = 0;
  return vi.fn<ApiFetch>(async () => {
    const answer = await answers[Math.min(call++, answers.length - 1)];
    return jsonResponse({ data: { state: answer } });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** `inside` reads under the page's re-read scope (and the console's open); `outside` does not. */
function mount(url: string, apiFetch: ApiFetch, reread: ElementApiReread, withOutside = false) {
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: null as DataSource | null, apiFetch }}>
      <ElementApiOpenScope open="open-1">
        <ElementApiRereadScope reread={reread}>
          <SchemaRenderer schema={element('inside', url)} />
        </ElementApiRereadScope>
        {withOutside && <SchemaRenderer schema={element('outside', `${url}/outside`)} />}
      </ElementApiOpenScope>
    </SchemaRendererContext.Provider>,
  );
}

const text = (id: string) => screen.getByTestId(`reread-probe-${id}`).textContent;
const loadingPanel = () => document.body.querySelector('[data-testid="reread-probe-resolving-view"]');

describe('ElementApiRereadScope — the page asks its api-bound elements to read again (objectstack#31891)', () => {
  beforeEach(() => {
    ComponentRegistry.register('reread-probe', RereadProbe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('reread-probe');
  });

  it('reread() makes one more GET; the old answer stays on screen while it is in flight, then the new one renders in place', async () => {
    const url = freshUrl();
    const second = deferred<string>();
    const apiFetch = scriptedFetch(['on', second.promise]);
    const reread = createElementApiReread();
    mount(url, apiFetch, reread);
    await waitFor(() => expect(text('inside')).toBe('on'));
    const instance = screen.getByTestId('reread-probe-inside').dataset.instance;
    expect(apiFetch).toHaveBeenCalledTimes(1);

    act(() => reread.reread());

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(loadingPanel(), 'the element fell back to its loading panel during the re-read').toBeNull();
    expect(text('inside'), 'the answer on screen must stay until the new one lands').toBe('on');

    await act(async () => second.resolve('off'));
    await waitFor(() => expect(text('inside')).toBe('off'));
    expect(screen.getByTestId('reread-probe-inside').dataset.instance, 'the re-read remounted the element').toBe(instance);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('a request in flight when reread() is called is not joined: the reader asks again and shows the later answer', async () => {
    const url = freshUrl();
    const first = deferred<string>();
    const apiFetch = scriptedFetch([first.promise, 'after-write']);
    const reread = createElementApiReread();
    mount(url, apiFetch, reread);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    act(() => reread.reread());

    await waitFor(() => expect(apiFetch, 'the re-read joined the request asked before it').toHaveBeenCalledTimes(2));
    await waitFor(() => expect(text('inside')).toBe('after-write'));
    await act(async () => first.resolve('before-write'));
    expect(text('inside'), 'the answer asked before the write replaced the later one').toBe('after-write');
  });

  it('CONTROL: a reader outside the scope does not read again, and a bus change alone reads nothing', async () => {
    const url = freshUrl();
    const apiFetch = scriptedFetch(['on']);
    const reread = createElementApiReread();
    mount(url, apiFetch, reread, true);
    await waitFor(() => expect(text('inside')).toBe('on'));
    await waitFor(() => expect(text('outside')).toBe('on'));
    expect(apiFetch).toHaveBeenCalledTimes(2);

    act(() => notifyDataChanged({ objectName: '*' }));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(apiFetch, 'a change declared on the bus alone made a reader read again').toHaveBeenCalledTimes(2);

    act(() => reread.reread());
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    const urls = apiFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u === url), 'the reader inside the scope did not read again exactly once').toHaveLength(2);
    expect(urls.filter((u) => u === `${url}/outside`), 'the reader outside the scope read again').toHaveLength(1);
  });
});
