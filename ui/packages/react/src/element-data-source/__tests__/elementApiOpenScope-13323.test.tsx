/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ElementApiOpenScope` — one read per open (objectui#13323).
 *
 * Two elements bound to the same URL, the second mounted after the first's
 * read has SETTLED (so no request is in flight to share), through the real
 * `SchemaRenderer` and the host fetch on `SchemaRendererContext.apiFetch`:
 *
 *  - inside one open, the second takes the first's answer: one call;
 *  - a scope that names another open reads again;
 *  - CONTROL: with no scope, each element reads, as before.
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
import { ElementApiOpenScope } from '../useElementApiDataSource';

function OpenProbe({ schema }: { schema: { id?: string; properties?: Record<string, unknown> } }) {
  return <span data-testid={`open-probe-${schema.id}`}>{String(schema.properties?.content ?? '')}</span>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let urlSeq = 0;
function freshUrl(): string {
  urlSeq += 1;
  return `/api/v1/open-scope-probe/${urlSeq}`;
}

function element(id: string, url: string) {
  return {
    type: 'open-probe',
    id,
    dataSource: { provider: 'api', read: { url }, path: 'data' },
    properties: { content: '${data.total}' },
  } as never;
}

/** The first element now; the second once `later` is set. */
function Tree({ url, open, later }: { url: string; open: string | null; later: boolean }) {
  const tree = (
    <>
      <SchemaRenderer schema={element('first', url)} />
      {later && <SchemaRenderer schema={element('second', url)} />}
    </>
  );
  return open === null ? tree : <ElementApiOpenScope open={open}>{tree}</ElementApiOpenScope>;
}

function mount(url: string, apiFetch: ApiFetch, open: string | null) {
  const host = (later: boolean, openName: string | null) => (
    <SchemaRendererContext.Provider value={{ dataSource: null as DataSource | null, apiFetch }}>
      <Tree url={url} open={openName} later={later} />
    </SchemaRendererContext.Provider>
  );
  const view = render(host(false, open));
  return { mountSecond: (inOpen: string | null = open) => act(() => view.rerender(host(true, inOpen))) };
}

describe('ElementApiOpenScope — one read per open (objectui#13323)', () => {
  beforeEach(() => {
    ComponentRegistry.register('open-probe', OpenProbe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('open-probe');
  });

  it('a second element in the same open takes the settled answer: one call', async () => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total: 7 } }));
    const { mountSecond } = mount(url, apiFetch, 'open-1');
    await waitFor(() => expect(screen.getByTestId('open-probe-first').textContent).toBe('7'));
    mountSecond();
    await waitFor(() => expect(screen.getByTestId('open-probe-second').textContent).toBe('7'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('a scope that names another open reads again', async () => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total: 7 } }));
    const { mountSecond } = mount(url, apiFetch, 'open-1');
    await waitFor(() => expect(screen.getByTestId('open-probe-first').textContent).toBe('7'));
    mountSecond('open-2');
    await waitFor(() => expect(screen.getByTestId('open-probe-second').textContent).toBe('7'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('CONTROL: with no scope, each element reads', async () => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total: 7 } }));
    const { mountSecond } = mount(url, apiFetch, null);
    await waitFor(() => expect(screen.getByTestId('open-probe-first').textContent).toBe('7'));
    mountSecond();
    await waitFor(() => expect(screen.getByTestId('open-probe-second').textContent).toBe('7'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
