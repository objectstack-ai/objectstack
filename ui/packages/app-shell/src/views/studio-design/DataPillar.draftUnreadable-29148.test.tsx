// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29148 — on a read-only base's object the Data pillar edits the
 * customer's extension of it in the base's paired `<base>.custom` package
 * (objectstack#28575). A pending extension draft the server refuses to read
 * (`403 PERMISSION_DENIED`) is not "no draft": no extension buffer is seeded
 * from the published row (or a new `{ extend }`) over it, so Add field is not
 * offered, the strip says why with the server's sentence behind Details, and
 * no extension save is sent over the draft it never read.
 *
 * The REAL `DataPillar` over the #28575 harness: a metadata client double
 * whose pair extension draft read refuses as the metadata client throws a
 * refused read (an `Error` carrying `status` and `code`), and resolves `null`
 * for no draft (the client's reading of a 404).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';
const OBJECT = 'crm_account';
const GATE_REFUSAL = "You do not have permission to read the pending extension of 'crm_account'.";

const srv = vi.hoisted(() => ({
  /** The object as the base serves it (the pair's PUBLISHED extension already merged in). */
  served: {} as Record<string, unknown>,
  /** The pair's published extension row of the object, `null` when it has none. */
  publishedExt: null as Record<string, unknown> | null,
  /** The pair's pending extension draft, `null` when it has none. */
  draftExt: null as Record<string, unknown> | null,
  /** The pair's extension draft read is refused as the audience gate refuses it. */
  gated: false,
}));

const baseServed = () => ({
  name: OBJECT,
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Account Name', required: true },
    industry: { type: 'select', label: 'Industry', options: [{ value: 'technology', label: 'Technology' }] },
  },
});

const mockClient = {
  list: vi.fn(async (_type: string, opts?: { packageId?: string }) =>
    opts?.packageId === PAIR ? [] : [{ name: OBJECT, label: 'Account' }],
  ),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: srv.served, code: srv.served })),
  getDraft: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) => {
    if (type === 'object_extension' && srv.gated) {
      throw Object.assign(new Error(GATE_REFUSAL), {
        status: 403,
        code: 'PERMISSION_DENIED',
        body: { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } },
      });
    }
    return type === 'object_extension' && name === OBJECT && opts?.packageId === PAIR && srv.draftExt
      ? { type, name, item: srv.draftExt }
      : null;
  }),
  get: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) =>
    type === 'object_extension' && name === OBJECT && opts?.packageId === PAIR ? srv.publishedExt : null,
  ),
  save: vi.fn(async (_type: string, _name: string, _body: unknown, _opts?: { packageId?: string }) => ({
    ok: true,
    version: 'v2',
    state: 'draft',
  })),
};

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
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble() {
    const authoring = useGridFieldAuthoring();
    return (
      <div data-testid="records-panel">
        {authoring?.onAddColumn && (
          <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
            Add column
          </button>
        )}
      </div>
    );
  }
  return { ...mod, ObjectView: GridDouble };
});

import { DataPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';

registerMetadataInspector('object', ObjectFieldInspector);

const FORM = t('engine.studio.data.tab.form', 'en');

const ensure = vi.fn(async (): Promise<string> => PAIR);

function customizationOf(over: Partial<StudioBaseCustomization> = {}): StudioBaseCustomization {
  return {
    base: BASE,
    baseLabel: 'HotCRM',
    basedOn: '4.0.0',
    walled: false,
    pairId: PAIR,
    ensure,
    ensurePackage: vi.fn(async () => ({
      basePackageId: BASE,
      packageId: PAIR,
      namespace: 'hotcrm_custom',
      dependencyRange: '^4',
      created: false,
      writable: true,
    })) as unknown as StudioBaseCustomization['ensurePackage'],
    marks: { status: 'off' },
    ...over,
  };
}

beforeEach(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
  srv.served = baseServed();
  srv.publishedExt = null;
  srv.draftExt = null;
  srv.gated = false;
  ensure.mockImplementation(async () => PAIR);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderBase(over: Partial<StudioBaseCustomization> = {}) {
  render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/data`]}>
      <DataPillar packageId={BASE} readOnly customization={customizationOf(over)} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
}

async function openForm() {
  await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
  await screen.findByRole('button', { name: 'Layout', pressed: true });
}

type SaveCall = [string, string, Record<string, unknown>, { packageId?: string; mode?: string }];
const extensionSaves = () =>
  (mockClient.save.mock.calls as unknown as SaveCall[]).filter(([type]) => type === 'object_extension');

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

describe('DataPillar — a pair extension draft the server refuses to read is not "no draft" (objectstack#29148)', () => {
  it('no extension buffer over the refused draft: the strip says why, Add field is not offered, and no save is sent', async () => {
    srv.draftExt = { extend: OBJECT, fields: { tier__c: { type: 'text', label: 'Tier' } }, requiredPermissions: ['crm.export_data'] };
    srv.gated = true;
    await renderBase();

    await waitFor(
      () => expect(mockClient.getDraft).toHaveBeenCalledWith('object_extension', OBJECT, { packageId: PAIR }),
      { timeout: 8000 },
    );
    // Red on base: the refusal was read as "no draft", and a new extension
    // buffer was opened to add fields into, over the draft it never read.
    const message = await screen.findByText(t('engine.studio.refusal.draftUnreadable', 'en'), undefined, { timeout: 8000 });
    expect(message).toHaveAttribute('data-testid', 'studio-refusal-message');
    // The server's own sentence stays reachable, behind Details.
    expect(screen.getByTestId('studio-refusal-detail')).toHaveTextContent(GATE_REFUSAL);
    // Neither door to add a field is offered: the Records grid's "+", the Form toolbar's.
    expect(screen.queryByTestId('grid-add-column')).toBeNull();
    await openForm();
    expect(screen.queryByTestId('data-form-add-extension-field')).toBeNull();

    await pastTheAutosave();
    expect(extensionSaves()).toEqual([]);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('CONTROL: with no pending extension draft Add field is offered, and its add saves at the pair', async () => {
    await renderBase();
    await openForm();
    expect(screen.queryByText(t('engine.studio.refusal.draftUnreadable', 'en'))).toBeNull();
    await userEvent.click(await screen.findByTestId('data-form-add-extension-field'));
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Region');
    await userEvent.click(within(popover).getByTestId('add-field-create'));
    await waitFor(() => expect(extensionSaves()).toHaveLength(1), { timeout: 8000 });
    expect(extensionSaves()[0]![3]).toMatchObject({ mode: 'draft', packageId: PAIR });
  });
});
