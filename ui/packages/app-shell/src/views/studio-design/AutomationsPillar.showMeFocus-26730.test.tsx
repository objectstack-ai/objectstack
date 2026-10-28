// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26730 — the Automations strip's "Show me" ends on the input.
 *
 * Measured before this card: "Show me" selected the step the refusal names
 * and stopped there, so the focus stayed on the button and the author still
 * had to find the input. It now ends on the input the sentence names: the
 * step's Title for `nodes.2.config.title`, and the step's first input when
 * the sentence names the step alone.
 *
 * The harness is `AutomationsPillar.authorRefusal-11785.test.tsx`'s: the real
 * registered `FlowPreview` and `FlowInspector`, and a server double whose
 * `save` refuses, driven through the header switch.
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
import { t } from '../metadata-admin/i18n';

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

describe('Automations page — "Show me" puts the focus on the input the refusal names (objectstack#26730)', () => {
  it('`nodes.2.config.title`: the focus lands on the step\'s Title', async () => {
    const strip = await refusedSave([{ path: 'nodes.2.config.title', message: MISSING }]);
    const show = within(strip).getByRole('button', { name: t('engine.studio.refusal.show', 'en') });
    show.focus();
    fireEvent.click(show);

    const rail = screen.getByTestId('auto-config-aside');
    // The Title box, by the placeholder the notify table gives it (its label
    // heads the row rather than naming the box).
    const title = await within(rail).findByPlaceholderText('Your request was approved', undefined, { timeout: 8000 });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(within(rail).getByLabelText('ID')).toHaveValue('tell');
  });

  it('a sentence naming the step alone: the focus lands in that step\'s inspector', async () => {
    const strip = await refusedSave([{ path: 'nodes.2', message: MISSING }]);
    fireEvent.click(within(strip).getByRole('button', { name: t('engine.studio.refusal.show', 'en') }));

    const rail = screen.getByTestId('auto-config-aside');
    await within(rail).findByLabelText('ID', undefined, { timeout: 8000 });
    await waitFor(() => expect(rail.contains(document.activeElement)).toBe(true));
  });
});
