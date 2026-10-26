// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11785 — on the Studio Automations page, a server refusal names the
 * step and the input it is about, instead of printing a raw issue path.
 *
 * The card's measured case: a 422 on `nodes.2.config.title` printed
 * "nodes.2.config.title — …" as the banner. The strip now says which step
 * (node 2, by its label) and which input (its Title, by the inspector's own
 * label), offers "Show me" to open that step, and keeps the raw line under a
 * closed "Details" disclosure. A path it cannot place stays under Details.
 *
 * The canvas and inspector are the real registered `FlowPreview` and
 * `FlowInspector`; the client is a server double whose `save` refuses, driven
 * through the header switch, which saves at once (as in
 * `StudioDesignSurface.automationsReadOnly-11124.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'route', type: 'decision', label: 'Route' },
    { id: 'tell', type: 'notify', label: 'Notify approver', config: { recipients: ['owner'] } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'route' },
    { id: 'e2', source: 'route', target: 'tell' },
    { id: 'e3', source: 'tell', target: 'end' },
  ],
};

const MISSING = 'Invalid input: expected string, received undefined';

const server = vi.hoisted(() => ({
  /** The issues the next draft save is refused with. */
  issues: [] as Array<{ path: string; message: string }>,
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [{ name: 'approval', label: 'Approval' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: JSON.parse(JSON.stringify(FLOW)),
    editable: true,
    deletable: true,
    resettable: false,
    lock: 'none',
  })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async () => {
    // The client's parsed `MetadataError`: a headline, a status, a code and
    // the structured issues the server returned.
    throw Object.assign(new Error(`flow/approval failed spec validation (${server.issues.length})`), {
      status: 422,
      code: 'INVALID_METADATA',
      issues: server.issues,
    });
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

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
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

// The pillar's `/automation/_status` probe and the inspector's catalog reads go
// through the global `fetch`; "absent" keeps each on its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

beforeEach(() => {
  server.issues = [];
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
});

afterEach(cleanup);

/** Open the flow, then flip the header switch: a save that the server refuses. */
async function refusedSave(issues: Array<{ path: string; message: string }>): Promise<HTMLElement> {
  server.issues = issues;
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
  const toggle = await screen.findByRole('switch', undefined, { timeout: 8000 });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
  return screen.findByTestId('studio-refusal');
}

describe('Automations page — a server refusal names the step and its input (objectui#11785)', () => {
  it('`nodes.2.config.title` names node 2\'s Title, with the raw path under Details', async () => {
    const strip = await refusedSave([{ path: 'nodes.2.config.title', message: MISSING }]);

    const message = within(strip).getByTestId('studio-refusal-message');
    expect(message).toHaveTextContent(
      tFormat('engine.studio.refusal.issue', 'en', {
        where: tFormat('engine.studio.refusal.stepInput', 'en', { input: 'Title', step: 'Notify approver' }),
        problem: t('engine.validation.expectedStringUndefined', 'en'),
      }),
    );
    expect(message.textContent).not.toMatch(/nodes\.\d|config\.title/);

    const details = within(strip).getByTestId('studio-refusal-detail') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('pre')).toHaveTextContent(`• nodes.2.config.title — ${MISSING}`);
  });

  it('"Show me" opens that step in the inspector', async () => {
    const strip = await refusedSave([{ path: 'nodes.2.config.title', message: MISSING }]);
    fireEvent.click(within(strip).getByRole('button', { name: t('engine.studio.refusal.show', 'en') }));

    const rail = screen.getByRole('complementary');
    const label = (await within(rail).findByLabelText('Label', undefined, { timeout: 8000 })) as HTMLInputElement;
    expect(label.value).toBe('Notify approver');
    expect(within(rail).getByLabelText('ID')).toHaveValue('tell');
  });

  it('a path it cannot place stays reachable under Details', async () => {
    const strip = await refusedSave([{ path: 'variables.0.name', message: 'Invalid input' }]);

    expect(within(strip).getByTestId('studio-refusal-message')).toHaveTextContent(
      t('engine.studio.refusal.unlocated', 'en'),
    );
    expect(within(strip).queryByRole('button', { name: t('engine.studio.refusal.show', 'en') })).toBeNull();
    expect(within(strip).getByTestId('studio-refusal-detail').querySelector('pre')).toHaveTextContent(
      '• variables.0.name — Invalid input',
    );
  });
});
