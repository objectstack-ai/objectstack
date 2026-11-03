// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29015 — a pending dashboard draft the server refuses to read
 * (`403 PERMISSION_DENIED`: its `requiredPermissions` name a capability the
 * author does not hold) is never taken for "no draft". The Interfaces pillar
 * installs no buffer over it: the published layer is not shown to edit, the
 * strip says why, and the autosave sends nothing, so the draft keeps its keys
 * and its audience gate.
 *
 * The client is a server double: `layered` serves the published row,
 * `getDraft` serves the stored draft row raw, or refuses it as the read gate
 * does (an `Error` carrying `status` and `code`, the shape the metadata
 * client throws), and `save` records the wire body and its precondition. The
 * dashboard canvas is a stub that prints the draft it received and offers one
 * edit, so nothing in the pillar itself is stubbed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { t } from '../metadata-admin/i18n';

const PKG = 'com.acme.app';
const NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_board' }];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const PUBLISHED_DASHBOARD = { name: 'sales_board', label: 'Sales', widgets: [] };
/** The pending draft: the published body plus an audience gate the author does not hold. */
const GATED_DRAFT = { ...PUBLISHED_DASHBOARD, requiredPermissions: ['showcase.export_data'] };
const GATE_REFUSAL = "You do not have permission to open the 'sales_board' dashboard.";

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Draft rows whose read is refused as the audience gate refuses it. */
  gated: new Set<string>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> | undefined }>,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const toWire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
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
      if (server.gated.has(k(type, name))) {
        throw Object.assign(new Error(GATE_REFUSAL), {
          status: 403,
          code: 'PERMISSION_DENIED',
          body: { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } },
        });
      }
      const row = server.drafts.get(k(type, name));
      // The client resolves a 404 `NO_DRAFT` read as `null`.
      if (!row) return null;
      return { type, name, version: 'v1', item: { ...row } };
    }),
    save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
      const body = toWire(item);
      server.saves.push({ type, name, body, opts });
      if (opts?.mode === 'draft') server.drafts.set(k(type, name), body);
      else server.active.set(k(type, name), body);
      return { success: true, version: 'v2', state: 'draft' };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
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

import { InterfacesPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview, getMetadataPreview } from '../metadata-admin/preview-registry';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

/** Canvas stand-in: prints the draft it was handed and offers one edit through `onPatch`. */
function StubCanvas({ draft, onPatch }: { draft: Record<string, unknown>; onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <div>
      <pre data-testid="surface-draft">{JSON.stringify(draft)}</pre>
      {onPatch && (
        <button type="button" data-testid="stub-edit" onClick={() => onPatch({ label: 'Sales (edited)' })}>
          edit
        </button>
      )}
    </div>
  );
}

const realPreview = getMetadataPreview('dashboard');
const key = (type: string, name: string) => `${type}/${name}`;
const wire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

function renderPillar() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.gated.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('dashboard', StubCanvas as never);
  server.active.set(key('app', 'acme_app'), wire(APP));
  server.active.set(key('dashboard', 'sales_board'), wire(PUBLISHED_DASHBOARD));
});

afterEach(() => {
  cleanup();
  if (realPreview) registerMetadataPreview('dashboard', realPreview);
});

describe('StudioDesignSurface — a dashboard draft the server refuses to read is not "no draft" (objectstack#29015)', () => {
  it('opens no buffer over the refused draft: the strip says why, nothing is editable, and no save is sent', async () => {
    server.drafts.set(key('dashboard', 'sales_board'), wire(GATED_DRAFT));
    server.gated.add(key('dashboard', 'sales_board'));

    renderPillar();

    // The leaf's draft was asked for, at the address its saves write.
    await waitFor(
      () => expect(mockClient.getDraft).toHaveBeenCalledWith('dashboard', 'sales_board', { packageId: PKG }),
      { timeout: 8000 },
    );
    // Red on base: the refusal was read as "no draft", and the published body
    // was installed as the buffer and handed to the canvas to edit.
    expect(
      await screen.findByText(t('engine.studio.refusal.draftUnreadable', 'en-US'), undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    // The server's own sentence stays reachable, behind Details.
    expect(screen.getByTestId('studio-refusal')).toHaveTextContent(GATE_REFUSAL);
    expect(screen.queryByTestId('surface-draft')).toBeNull();
    expect(screen.queryByTestId('stub-edit')).toBeNull();
    // The published layer is never read to stand in for the draft.
    expect(mockClient.layered).not.toHaveBeenCalledWith('dashboard', 'sales_board', expect.anything());

    await pastTheAutosave();
    expect(server.saves).toEqual([]);
    expect(server.drafts.get(key('dashboard', 'sales_board'))).toStrictEqual(wire(GATED_DRAFT));
  });

  it('CONTROL: with no pending draft the published body opens, and an edit saves pinned to "no draft row"', async () => {
    renderPillar();

    await waitFor(
      () =>
        expect(JSON.parse(screen.getByTestId('surface-draft').textContent ?? '{}')).toStrictEqual(
          wire(PUBLISHED_DASHBOARD),
        ),
      { timeout: 8000 },
    );
    expect(screen.queryByText(t('engine.studio.refusal.draftUnreadable', 'en-US'))).toBeNull();

    await userEvent.click(screen.getByTestId('stub-edit'));
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    const { type, name, body, opts } = server.saves[0]!;
    expect([type, name]).toEqual(['dashboard', 'sales_board']);
    expect(body.label).toBe('Sales (edited)');
    expect(opts).toMatchObject({ mode: 'draft', packageId: PKG, ifNoneMatch: '*' });
    expect(opts).not.toHaveProperty('ifMatch');
  });
});
