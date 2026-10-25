// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11786 — Publish refuses while a pillar holds an edit unsent.
 *
 * Studio's autosave now holds an incomplete-but-normal edit (a step added
 * before its required inputs are filled) instead of sending it. A publish
 * promotes the drafts the SERVER holds, which do not carry that edit, so before
 * this card it went around it silently: the red strip was the only warning, and
 * the strip is gone. The surface now refuses the publish, naming the held step,
 * until the edit is complete; a publish with nothing held goes as before.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape, with
 * the real registered `FlowPreview` / `FlowInspector`. The pending-changes sheet
 * is replaced by a probe that keeps the props the surface hands it, so its
 * `onPublish` (the surface's publish) is called directly, as in
 * `StudioDesignSurface.packageLessFlows-11553.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';

const PKG = 'com.acme.app';

const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'obsolete',
  _packageId: PKG,
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [{ name: 'approval', label: 'Approval', _packageId: 'com.acme.app' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async () => ({})),
  publishDraft: vi.fn(async () => ({ success: true })),
  publishPackageDrafts: vi.fn(async () => ({ success: true, failed: [] })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

/** What the surface handed the pending-changes sheet, last render. */
const panel = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (props: Record<string, unknown>) => {
    panel.props = props;
    return null;
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { browserClick } from '../metadata-admin/previews/__tests__/browserClick';
import { tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

// The pending-drafts feed (`/meta/_drafts`) and the rail's `/automation/_status`
// probe; the feed reports one pending flow draft, so there is something to publish.
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown) => {
    if (String(input).startsWith('/api/v1/meta/_drafts')) {
      return new Response(JSON.stringify({ drafts: [{ type: 'flow', name: 'approval', packageId: PKG }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
  }),
);

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

beforeEach(() => {
  panel.props = null;
  mockClient.layered.mockImplementation(async () => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: JSON.parse(JSON.stringify(FLOW)),
  }));
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The surface's publish, as the pending-changes sheet's footer button calls it. */
async function publish(): Promise<void> {
  const onPublish = panel.props?.onPublish as (() => Promise<void>) | undefined;
  expect(onPublish, 'the sheet is handed a publish').toBeTypeOf('function');
  await act(async () => {
    await onPublish!();
  });
}

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

async function openFlow(): Promise<void> {
  renderAt(`/studio/${PKG}/automations`);
  await screen.findByTitle('API name: approval', undefined, { timeout: 8000 });
}

async function addNotify(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Insert node here' }, { timeout: 8000 }));
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith('Notify'));
  browserClick(option!);
  // objectui#12725 — the Configuration aside now sits inside the surface's
  // right slot, itself an `aside`: two complementary landmarks, so the
  // Configuration is found by its own test id.
  await within(screen.getByTestId('auto-config-aside')).findByLabelText('ID', undefined, { timeout: 8000 });
}

describe('Publish refuses while an edit is held, naming it (objectui#11786)', () => {
  it('a new Notify step not yet filled in: Publish refuses naming the step and its input, and publishes nothing', async () => {
    await openFlow();
    await addNotify();
    await outlastDebounce();
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    await publish();
    expect(mockClient.publishPackageDrafts, 'Publish must not go around the held edit').not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      tFormat('engine.studio.held.publish', 'en', {
        clause: tFormat('engine.studio.held.needsInput', 'en', { input: 'Title', step: 'Notify' }),
      }),
    );
  });

  it('once the step is filled in and saved, Publish goes', async () => {
    await openFlow();
    await addNotify();
    const rail = screen.getByTestId('auto-config-aside');
    fireEvent.change(within(rail).getByPlaceholderText('Your request was approved'), {
      target: { value: 'Request approved' },
    });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());

    await publish();
    expect(mockClient.publishPackageDrafts).toHaveBeenCalledWith(PKG);
    expect(toast.error).not.toHaveBeenCalled();
  });

  // CONTROL: nothing held, nothing refused.
  it('with no edit held, Publish publishes as before', async () => {
    await openFlow();
    await publish();
    expect(mockClient.publishPackageDrafts).toHaveBeenCalledWith(PKG);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
