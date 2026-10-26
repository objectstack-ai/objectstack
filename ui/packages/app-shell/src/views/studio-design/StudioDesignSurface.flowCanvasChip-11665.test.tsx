// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11665 — Studio's automation canvas header names the open flow by
 * its LABEL, in zh and in en, and keeps the API name on the tooltip.
 *
 * The residual of objectui#11659 ruling 6: with a flow open, the header
 * printed the literal chip `flow · NAME` in every locale, so a zh author read
 * the English metadata type word and an API name beside the pillar's
 * plain-language copy. The ruling: the header shows no `flow` token, shows the
 * flow's label, and hovering shows the API name; en follows the same rule.
 *
 * The pillar is the real `AutomationsPillar` with the real registered
 * `FlowPreview`, so the neighbouring chip is the one an author sees
 * (`canvasHint`, not the "no designers registered" line, which names a flow in
 * English). The client is a server double. The flow's API name is chosen to
 * carry no `flow` token, so "the header holds no `flow`" cannot be satisfied
 * by the name alone.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const PKG = 'com.acme.app';
const API_NAME = 'nightly_digest';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The pillar's `/automation/_status` probe and the inspector's action-catalog
// read go through the global `fetch`; one module-scope double answers "absent"
// so each keeps its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

beforeEach(() => {
  server.active.clear();
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
});

afterEach(cleanup);

function serve(label: string): void {
  server.active.set(`flow/${API_NAME}`, {
    name: API_NAME,
    label,
    type: 'autolaunched',
    status: 'active',
    nodes: NODES,
    edges: EDGES,
  });
}

function renderPillar(language: 'zh' | 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The canvas caption of the open flow, and the header strip that holds it. */
async function caption(): Promise<{ chip: HTMLElement; header: HTMLElement }> {
  const chip = await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 });
  return { chip, header: chip.parentElement as HTMLElement };
}

/** The metadata type word, as a whole word in any case: `flow`, `Flow`, `FLOW`. */
const TYPE_WORD = /\bflow\b/i;

describe('the automation canvas header names the open flow by its label (objectui#11665)', () => {
  it('zh: the header prints the flow label, no `flow` token, and the tooltip names the API name', async () => {
    serve('每日摘要');
    renderPillar('zh');
    const { chip, header } = await caption();

    expect(chip).toHaveTextContent(/^每日摘要$/);
    expect(chip).toHaveAttribute('title', `API 名称: ${API_NAME}`);
    // The neighbouring chip is the real zh `canvasHint`, so the header read is the whole strip.
    expect(header).toHaveTextContent('点选画布上的节点即可配置');
    expect(header.textContent ?? '').not.toMatch(TYPE_WORD);
    expect(header.textContent ?? '').not.toContain(API_NAME);
    expect(chip.getAttribute('title') ?? '').not.toMatch(TYPE_WORD);
  });

  it('en: the header follows the same rule', async () => {
    serve('Nightly digest');
    renderPillar('en');
    const { chip, header } = await caption();

    expect(chip).toHaveTextContent(/^Nightly digest$/);
    expect(chip).toHaveAttribute('title', `API name: ${API_NAME}`);
    expect(header).toHaveTextContent('Visual orchestration');
    expect(header.textContent ?? '').not.toMatch(TYPE_WORD);
    expect(header.textContent ?? '').not.toContain(API_NAME);
    expect(chip.getAttribute('title') ?? '').not.toMatch(TYPE_WORD);
  });

  it('a label that resolves to nothing falls back to the API name rather than an empty chip', async () => {
    serve('');
    renderPillar('zh');
    const { chip, header } = await caption();

    expect(chip).toHaveTextContent(new RegExp(`^${API_NAME}$`));
    expect(header.textContent ?? '').not.toMatch(TYPE_WORD);
  });

  it('the type-word pattern sees what it is meant to catch (positive control)', () => {
    expect(TYPE_WORD.test('flow · nightly_digest')).toBe(true);
    expect(TYPE_WORD.test('Flow')).toBe(true);
    expect(TYPE_WORD.test('每日摘要 flow')).toBe(true);
    expect(TYPE_WORD.test('每日摘要')).toBe(false);
    expect(TYPE_WORD.test('nightly_digest')).toBe(false);
  });
});
