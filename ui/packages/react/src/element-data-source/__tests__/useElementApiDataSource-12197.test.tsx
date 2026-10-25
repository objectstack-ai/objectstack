/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The spec's API binding of a page element, rendered (objectui#12197).
 *
 * `ElementApiDataSourceSchema` declares that a node with
 * `dataSource: { provider: 'api', read: { url }, path? }` reads that one
 * same-origin endpoint with the host's signed-in fetch and binds the selected
 * value "which the element reads as `data` in its expression holes and its
 * `visibleWhen`". These cases drive the real `SchemaRenderer` with the host
 * fetch on `SchemaRendererContext.apiFetch`, the seat `ConsoleShell` fills.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import type { BaseSchema, DataSource } from '@object-ui/types';
import type { ElementApiDataSource } from '@objectstack/spec/ui';
import { SchemaRenderer } from '../../SchemaRenderer';
import { SchemaRendererContext, type ApiFetch } from '../../context/SchemaRendererContext';
import { useConfigBagEvaluator } from '../../hooks/useConfigBagEvaluator';
import { selectElementApiPath } from '../useElementApiDataSource';

type ApiProbeNode = BaseSchema & {
  type: 'api-probe';
  properties?: Record<string, unknown>;
  dataSource?: ElementApiDataSource | Record<string, unknown>;
  visibleWhen?: string;
};

declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'api-probe': ApiProbeNode;
  }
}

/** Draws its evaluated `content`, and a member bag evaluated one level down. */
function ApiProbe({ schema }: { schema: { properties?: Record<string, unknown> } }) {
  const evaluateMember = useConfigBagEvaluator();
  const member = evaluateMember(schema.properties?.member) as Record<string, unknown> | undefined;
  return (
    <div data-testid="api-probe">
      <span data-testid="api-probe-content">{String(schema.properties?.content ?? '')}</span>
      <span data-testid="api-probe-member">{String(member?.value ?? '')}</span>
    </div>
  );
}

const HOME = { success: true, data: { environments: [{ hostname: 'acme.objectos.app' }], members: { count: 3 } } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderWithFetch(schema: ApiProbeNode, apiFetch: ApiFetch) {
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: null as DataSource | null, apiFetch }}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererContext.Provider>,
  );
}

describe('the API binding of a page element (objectui#12197)', () => {
  beforeEach(() => {
    ComponentRegistry.register('api-probe', ApiProbe);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('api-probe');
  });

  it('reads a same-origin endpoint through the host fetch and binds the selected value as `data`', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse(HOME));
    renderWithFetch(
      {
        type: 'api-probe',
        dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data' },
        properties: { content: '${data.environments[0].hostname}', member: { value: '${data.members.count}' } },
      },
      apiFetch,
    );
    // The binding's loading state stands in for the node until the read answers.
    expect(screen.getByRole('status')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('api-probe-content').textContent).toBe('acme.objectos.app'));
    // A member evaluated one level down sees the same `data` (the subtree scope).
    expect(screen.getByTestId('api-probe-member').textContent).toBe('3');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/cloud/home');
    expect(apiFetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('decides `visibleWhen` against the bound `data`', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse(HOME));
    const { container } = renderWithFetch(
      {
        type: 'api-probe',
        dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home-hidden' }, path: 'data' },
        visibleWhen: '${data.members.count > 5}',
        properties: { content: 'shown' },
      },
      apiFetch,
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull());
    expect(screen.queryByTestId('api-probe')).toBeNull();
    expect(screen.queryByTestId('api-probe-datasource-error')).toBeNull();
  });

  it('shows the node when `visibleWhen` holds against the bound `data` (control)', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse(HOME));
    renderWithFetch(
      {
        type: 'api-probe',
        dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home-shown' }, path: 'data' },
        visibleWhen: '${data.members.count > 1}',
        properties: { content: 'shown' },
      },
      apiFetch,
    );
    await waitFor(() => expect(screen.getByTestId('api-probe-content').textContent).toBe('shown'));
  });

  it('refuses a cross-origin `url` with the spec\'s message and sends no request', () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse(HOME));
    renderWithFetch(
      {
        type: 'api-probe',
        dataSource: { provider: 'api', read: { url: 'https://evil.example/api/v1/cloud/home' } },
        properties: { content: 'x' },
      },
      apiFetch,
    );
    const panel = screen.getByTestId('api-probe-datasource-error');
    expect(panel.textContent).toContain('same-origin');
    expect(screen.queryByTestId('api-probe')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('refuses a protocol-relative `url` too', () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse(HOME));
    renderWithFetch(
      { type: 'api-probe', dataSource: { provider: 'api', read: { url: '//evil.example/x' } } },
      apiFetch,
    );
    expect(screen.getByTestId('api-probe-datasource-error')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('reports a failed read instead of rendering the node without its data', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ error: 'nope' }, 503));
    renderWithFetch(
      { type: 'api-probe', dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home-503' } } },
      apiFetch,
    );
    const panel = await screen.findByTestId('api-probe-datasource-error');
    expect(panel.textContent).toContain('503');
    expect(screen.queryByTestId('api-probe')).toBeNull();
  });

  it('reports a `path` that selects nothing, naming the missing segment', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse(HOME));
    renderWithFetch(
      {
        type: 'api-probe',
        dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home-path' }, path: 'data.storage' },
      },
      apiFetch,
    );
    const panel = await screen.findByTestId('api-probe-datasource-error');
    expect(panel.textContent).toContain('"storage"');
  });

  it('leaves a node without an API binding untouched: no request, no `data` root', () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse(HOME));
    renderWithFetch({ type: 'api-probe', properties: { content: 'plain' } }, apiFetch);
    expect(screen.getByTestId('api-probe-content').textContent).toBe('plain');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('the API binding\'s panel titles read the page\'s language (objectui#12197)', () => {
  beforeEach(() => {
    ComponentRegistry.register('api-probe', ApiProbe);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('api-probe');
  });

  const renderIn = (language: string, schema: ApiProbeNode, apiFetch: ApiFetch) =>
    render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <SchemaRendererContext.Provider value={{ dataSource: null as DataSource | null, apiFetch }}>
          <SchemaRenderer schema={schema} />
        </SchemaRendererContext.Provider>
      </I18nProvider>,
    );
  const heading = () => screen.getByTestId('api-probe-datasource-error').querySelector('p.font-medium')?.textContent;

  it('titles a refused binding in zh-CN', () => {
    renderIn(
      'zh-CN',
      { type: 'api-probe', dataSource: { provider: 'api', read: { url: 'https://evil.example/x' } } },
      vi.fn<ApiFetch>(async () => jsonResponse(HOME)),
    );
    expect(heading()).toBe('此组件的 API 数据源被拒绝');
  });

  it('titles a failed read in zh-CN', async () => {
    renderIn(
      'zh-CN',
      { type: 'api-probe', dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home-zh-503' } } },
      vi.fn<ApiFetch>(async () => jsonResponse({}, 503)),
    );
    await screen.findByTestId('api-probe-datasource-error');
    expect(heading()).toBe('无法读取此组件的 API 数据源');
  });

  it('CONTROL: under en, the titles are the en pack values', () => {
    renderIn(
      'en',
      { type: 'api-probe', dataSource: { provider: 'api', read: { url: '//evil.example/x' } } },
      vi.fn<ApiFetch>(async () => jsonResponse(HOME)),
    );
    expect(heading()).toBe('This component’s API data source is refused');
  });
});

describe('selectElementApiPath', () => {
  it('walks dotted keys and numeric array segments', () => {
    expect(selectElementApiPath(HOME, 'data.environments.0.hostname')).toEqual({ found: true, value: 'acme.objectos.app' });
    expect(selectElementApiPath(HOME, undefined)).toEqual({ found: true, value: HOME });
  });

  it('answers not-found for an absent key or an index past the end', () => {
    expect(selectElementApiPath(HOME, 'data.nope')).toEqual({ found: false, segment: 'nope' });
    expect(selectElementApiPath(HOME, 'data.environments.4')).toEqual({ found: false, segment: '4' });
  });
});
