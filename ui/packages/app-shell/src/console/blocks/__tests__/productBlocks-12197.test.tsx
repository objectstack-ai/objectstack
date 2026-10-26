/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The five product-page blocks (objectui#12197) — `hero`, `stat`, `usage-bar`,
 * `checklist`, `tile-grid` — each rendered through the real `SchemaRenderer`
 * from a fixture node, once with its props authored and once with them read
 * from the spec's API binding (`dataSource: { provider: 'api', … }`) through
 * the host fetch on `SchemaRendererContext.apiFetch`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
// The basic renderers, for the `element:button` nodes a hero and a checklist
// step carry as their actions.
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer, SchemaRendererContext } from '@object-ui/react';
import type { ChecklistBlockItem, DeclaredNode } from '@object-ui/types';
import '../productBlocks';
import { usageBarPercent } from '../productBlocks';

const HOME = {
  success: true,
  data: {
    environments: [{ hostname: 'acme.objectos.app', status: 'active' }],
    members: { count: 3 },
    storage: { usedMb: 256, limitMb: 1024 },
    checklist: { environment: true, firstApp: false, teammate: true },
    apps: [
      { label: 'CRM', href: '/apps/crm', icon: 'briefcase' },
      { label: 'Helpdesk', href: '/apps/helpdesk', caption: 'Support' },
    ],
  },
};

const BINDING = { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data' } as const;

function renderBlock(schema: DeclaredNode, apiFetch = vi.fn(async () => new Response(JSON.stringify(HOME), { status: 200 }))) {
  const utils = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter>
        <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch }}>
          <SchemaRenderer schema={schema} />
        </SchemaRendererContext.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return { ...utils, apiFetch };
}

afterEach(() => cleanup());

describe('product-page blocks are registered under product-neutral names (objectui#12197)', () => {
  it('registers the five blocks, each with declared inputs and the API binding input', () => {
    for (const type of ['hero', 'stat', 'usage-bar', 'checklist', 'tile-grid']) {
      const config = ComponentRegistry.getConfig(type);
      expect(config, type).toBeTruthy();
      const names = (config?.inputs ?? []).map((input) => input.name);
      expect(names, type).toContain('dataSource');
      expect(names.length, type).toBeGreaterThan(1);
      for (const input of config?.inputs ?? []) expect(input.description, `${type}.${input.name}`).toBeTruthy();
    }
  });
});

describe('hero', () => {
  it('draws its heading, line, status chip, copyable value and actions from `properties`', () => {
    renderBlock({
      type: 'hero',
      properties: {
        title: { en: 'Your workspace', 'zh-CN': '你的工作区' },
        subtitle: 'Production environment',
        meta: 'acme.objectos.app',
        status: 'Active',
        statusTone: 'success',
        primary: { type: 'element:button', properties: { label: 'Open' } },
        secondary: { type: 'element:button', properties: { label: 'Install app', variant: 'secondary' } },
      },
    });
    expect(screen.getByRole('heading', { name: 'Your workspace' })).toBeInTheDocument();
    expect(screen.getByText('Production environment')).toBeInTheDocument();
    expect(screen.getByTestId('hero-status').textContent).toBe('Active');
    expect(screen.getByTestId('hero-meta').textContent).toBe('acme.objectos.app');
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
    const actions = screen.getByTestId('hero-actions');
    expect(within(actions).getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Install app' })).toBeInTheDocument();
  });

  it('reads its copyable value from the bound response', async () => {
    renderBlock({
      type: 'hero',
      dataSource: BINDING,
      properties: { title: 'Your workspace', meta: '${data.environments[0].hostname}' },
    });
    expect(await screen.findByTestId('hero-meta')).toHaveTextContent('acme.objectos.app');
  });
});

describe('stat', () => {
  it('draws a number in the viewer\'s locale, its label and hint', () => {
    renderBlock({ type: 'stat', properties: { label: 'Seats', value: 12500, hint: 'this month' } });
    expect(screen.getByText('Seats')).toBeInTheDocument();
    expect(screen.getByTestId('stat-value').textContent).toBe('12,500');
    expect(screen.getByText('this month')).toBeInTheDocument();
  });

  it('reads its value from the bound response', async () => {
    renderBlock({ type: 'stat', dataSource: BINDING, properties: { label: 'Members', value: '${data.members.count}' } });
    expect(await screen.findByTestId('stat-value')).toHaveTextContent('3');
  });
});

describe('usage-bar', () => {
  it('computes the bar from used / limit', () => {
    renderBlock({ type: 'usage-bar', properties: { label: 'Storage', used: 256, limit: 1024, unit: 'MB' } });
    expect(screen.getByTestId('usage-bar-amount').textContent).toBe('256 MB / 1,024 MB');
    expect(screen.getByTestId('usage-bar-progress')).toHaveAttribute('aria-valuenow', '25');
  });

  it('draws no bar for an unlimited (0 or absent) limit', () => {
    renderBlock({ type: 'usage-bar', properties: { label: 'Storage', used: 256, limit: 0, unit: 'MB' } });
    expect(screen.getByTestId('usage-bar-amount').textContent).toBe('256 MB');
    expect(screen.queryByTestId('usage-bar-progress')).toBeNull();
  });

  it('reads used and limit from the bound response', async () => {
    renderBlock({
      type: 'usage-bar',
      dataSource: BINDING,
      properties: { label: 'Storage', used: '${data.storage.usedMb}', limit: '${data.storage.limitMb}', unit: 'MB' },
    });
    expect(await screen.findByTestId('usage-bar-progress')).toHaveAttribute('aria-valuenow', '25');
  });

  it('states its width rule: unlimited, unreported, clamped', () => {
    expect(usageBarPercent(5, undefined)).toBeUndefined();
    expect(usageBarPercent(5, 0)).toBeUndefined();
    expect(usageBarPercent(undefined, 10)).toBe(0);
    expect(usageBarPercent(5, 10)).toBe(50);
    expect(usageBarPercent(50, 10)).toBe(100);
  });
});

describe('checklist', () => {
  const ITEMS: ChecklistBlockItem[] = [
    { label: 'Create an environment', done: true },
    { label: 'Invite a teammate', done: false, action: { type: 'element:button', properties: { label: 'Invite' } } },
  ];

  it('ticks done steps and offers an open step\'s action', () => {
    renderBlock({ type: 'checklist', properties: { items: ITEMS } });
    expect(screen.getByTestId('checklist-item-0')).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId('checklist-item-1')).toHaveAttribute('data-done', 'false');
    expect(within(screen.getByTestId('checklist-item-1')).getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('reads each step\'s `done` from the bound response', async () => {
    renderBlock({
      type: 'checklist',
      dataSource: BINDING,
      properties: {
        items: [
          { label: 'Environment', done: '${data.checklist.environment}' },
          { label: 'First app', done: '${data.checklist.firstApp}' },
        ],
      },
    });
    expect(await screen.findByTestId('checklist-item-0')).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId('checklist-item-1')).toHaveAttribute('data-done', 'false');
  });

  it('collapsedWhenDone draws nothing once every step is done', () => {
    const { container } = renderBlock({
      type: 'checklist',
      properties: { collapsedWhenDone: true, items: [{ label: 'A', done: true }, { label: 'B', done: true }] },
    });
    expect(screen.queryByTestId('checklist-block')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('collapsedWhenDone keeps the list while a step is open', () => {
    renderBlock({ type: 'checklist', properties: { collapsedWhenDone: true, items: ITEMS } });
    expect(screen.getByTestId('checklist-block')).toBeInTheDocument();
  });

  it('keeps a finished list without collapsedWhenDone', () => {
    renderBlock({ type: 'checklist', properties: { items: [{ label: 'A', done: true }] } });
    expect(screen.getByTestId('checklist-block')).toBeInTheDocument();
  });
});

describe('tile-grid', () => {
  it('draws the launcher tile for each item, as a link, and the add tile', () => {
    renderBlock({
      type: 'tile-grid',
      properties: {
        items: [{ label: 'CRM', href: '/apps/crm', icon: 'briefcase', caption: 'Sales' }],
        addTile: { label: 'Add app', href: '/marketplace' },
      },
    });
    const tile = screen.getByTestId('tile-grid-tile-0');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/apps/crm');
    expect(tile.textContent).toContain('CRM');
    expect(tile.textContent).toContain('Sales');
    expect(tile.className).toContain('w-28');
    expect(screen.getByTestId('tile-grid-add')).toHaveAttribute('href', '/marketplace');
  });

  it('reads its tiles from the bound response', async () => {
    renderBlock({ type: 'tile-grid', dataSource: BINDING, properties: { items: '${data.apps}' } });
    await waitFor(() => expect(screen.getByTestId('tile-grid-tile-1')).toHaveAttribute('href', '/apps/helpdesk'));
    expect(screen.getByTestId('tile-grid-tile-0').textContent).toContain('CRM');
  });
});
