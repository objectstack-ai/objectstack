// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29793 — with the console in Chinese, Studio's Data pillar edits
 * the object as its author wrote it, not the object as it is served.
 *
 * The client is a double of a zh-CN server, shaped as measured on a live stack:
 * `?state=draft` (`getDraft`) answers the pending draft TRANSLATED (`工单`,
 * `标题`) and GOVERNED (the platform's injected `owner_id`, `queue` and
 * scope/audit columns in `fields`); `/layers` (`layered`) answers the stored
 * draft as `draft`, the stored row as `overlay` (both untranslated, no injected
 * columns), and `effective` governed. Before the fix the buffer was the served
 * draft, so a one-field edit PUT the translations as source labels and the
 * injected columns as author fields.
 *
 * Pinned: the PUT body is the authored document plus the one edit; the header
 * still counts the served object's platform columns as system fields (not 0,
 * and `owner_id` never as an own field); the records grid keeps the served
 * object's `owner_id` column; and a served draft whose stored copy the layers
 * do not carry installs no buffer and sends nothing.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

const PKG = 'com.example.showcase.custom';
const OBJECT = 'showcase_custom_ticket';

/** The object as its author wrote it: source labels, author fields only. */
const AUTHORED = {
  name: OBJECT,
  label: 'Ticket',
  pluralLabel: 'Tickets',
  sharingModel: 'private',
  fields: {
    title: { type: 'text', label: 'Title' },
    severity: { type: 'text', label: 'Severity' },
  },
};

/** The platform's injected columns, as the governed reads serve them. */
const INJECTED = (zh: boolean) => ({
  organization_id: { type: 'lookup', reference: 'sys_organization', label: zh ? '组织' : 'Organization', system: true, hidden: true, readonly: true },
  created_at: { type: 'datetime', label: zh ? '创建时间' : 'Created At', system: true, readonly: true },
  owner_id: { type: 'lookup', reference: 'sys_user', label: zh ? '负责人' : 'Owner', system: true, readonly: false },
  queue: { type: 'text', label: zh ? '队列' : 'Queue', system: true, hidden: true, readonly: false },
  __search: { type: 'text', label: 'Search Index', system: true, hidden: true, readonly: true },
});
const INJECTED_NAMES = Object.keys(INJECTED(false));

/** What a governed read serves for a document: injected columns lead. */
const governed = (doc: typeof AUTHORED, zh: boolean) => ({
  ...doc,
  ...(zh ? { label: '工单', pluralLabel: '工单' } : {}),
  fields: {
    ...INJECTED(zh),
    ...Object.fromEntries(
      Object.entries(doc.fields).map(([k, v]) => [
        k,
        zh ? { ...v, label: ({ title: '标题', severity: '严重程度' } as Record<string, string>)[k] ?? v.label } : v,
      ]),
    ),
  },
});

const wire = <T,>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T;

const srv = vi.hoisted(() => ({
  overlay: null as Record<string, unknown> | null,
  draft: null as Record<string, unknown> | null,
  /** `false` models a server that does not serve the `draft` layer to this caller. */
  servesDraftLayer: true,
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> | undefined }>,
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'showcase_custom_ticket', label: '工单' }] : [])),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  getDraft: vi.fn(async (): Promise<unknown> => null),
  save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
    const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    srv.saves.push({ type, name, body, opts });
    if (opts?.mode === 'draft') srv.draft = body;
    return { type, name, item: body, version: `v${srv.saves.length + 1}`, state: 'draft' };
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
  return { ...mod, useAdapter: () => ({}) };
});

/** The records grid stand-in: prints the columns the pillar asked for. */
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  function GridDouble({ schema }: { schema?: { table?: { fields?: string[] } } }) {
    return <pre data-testid="grid-columns">{JSON.stringify(schema?.table?.fields ?? null)}</pre>;
  }
  return { ...mod, ObjectView: GridDouble };
});

import { DataPillar } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';

registerMetadataInspector('object', ObjectFieldInspector);
await loadStudioCatalogue('zh');

beforeEach(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
  srv.overlay = wire(AUTHORED);
  srv.draft = null;
  srv.servesDraftLayer = true;
  srv.saves.length = 0;
  // `GET …/layers` — not translated; `effective` governed, `overlay`/`draft` as stored.
  mockClient.layered.mockImplementation(async () => ({
    code: null,
    overlay: srv.overlay,
    overlayScope: srv.overlay ? 'env' : null,
    effective: srv.overlay ? governed(srv.overlay as typeof AUTHORED, false) : null,
    ...(srv.servesDraftLayer ? { draft: srv.draft } : {}),
    lock: 'none',
    editable: true,
    deletable: true,
    resettable: false,
  }));
  // `GET …?state=draft` in a zh-CN console — translated and governed.
  mockClient.getDraft.mockImplementation(async () =>
    srv.draft ? { type: 'object', name: OBJECT, item: governed(srv.draft as typeof AUTHORED, true), version: 'v1' } : null,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderZh() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <DataPillar packageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

const objectSaves = () => srv.saves.filter((s) => s.type === 'object');

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

/** Form tab, the field card labelled `label`, then its label input set to `next`. */
async function relabel(label: string, next: string) {
  await userEvent.click((await screen.findAllByRole('button', { name: t('engine.studio.data.tab.form', 'zh-CN') }, { timeout: 8000 }))[0]);
  const card = await screen.findByLabelText(tFormat('engine.studio.designer.fieldAria', 'zh-CN', { label }), undefined, { timeout: 8000 });
  await userEvent.click(card);
  const inspector = await screen.findByTestId('data-field-inspector', undefined, { timeout: 8000 });
  const input = within(inspector).getByTestId('field-label-input');
  await userEvent.clear(input);
  await userEvent.type(input, next);
  await userEvent.tab();
}

function expectAuthoredBody(body: Record<string, unknown>, severityLabel: string) {
  expect(body.label).toBe('Ticket');
  expect(body.pluralLabel).toBe('Tickets');
  const fields = body.fields as Record<string, Record<string, unknown>>;
  expect(Object.keys(fields)).toEqual(['title', 'severity']);
  for (const injected of INJECTED_NAMES) expect(fields).not.toHaveProperty(injected);
  expect(fields.title.label).toBe('Title');
  expect(fields.severity.label).toBe(severityLabel);
}

describe('DataPillar in a zh-CN console — the object buffer is the authored document (objectstack#29793)', () => {
  it('a pending draft: one field edit PUTs the stored draft with that edit, in source labels, with no injected column', async () => {
    srv.draft = wire({ ...AUTHORED, description: 'draft only' });
    renderZh();

    await relabel('Severity', 'Level');
    await waitFor(() => expect(objectSaves().length).toBeGreaterThan(0), { timeout: 8000 });
    const { name, body, opts } = objectSaves().at(-1)!;
    expect(name).toBe(OBJECT);
    expect(opts).toMatchObject({ mode: 'draft', packageId: PKG });
    expectAuthoredBody(body, 'Level');
    // The stored draft's own key rides along: the buffer is the draft, not the overlay.
    expect(body.description).toBe('draft only');
  });

  it('no pending draft: the buffer is the stored row (`overlay`), and the edit PUTs it in source labels, with no injected column', async () => {
    renderZh();

    await relabel('Severity', 'Level');
    await waitFor(() => expect(objectSaves().length).toBeGreaterThan(0), { timeout: 8000 });
    expectAuthoredBody(objectSaves().at(-1)!.body, 'Level');
  });

  it("the header counts the served object's platform columns as system fields, and the grid keeps the served owner column", async () => {
    srv.draft = wire(AUTHORED);
    renderZh();

    // Own fields: title, severity. System: the five injected columns the
    // served object carries — `owner_id` among them, never an own field.
    const own = tFormat('engine.studio.data.fieldCount', 'zh-CN', { count: 2 });
    const system = tFormat('engine.studio.data.systemFieldCount', 'zh-CN', { count: 5 });
    await screen.findByText(`${own} ${system}`, undefined, { timeout: 8000 });
    // The grid shows the records as the server has them: the served `owner_id`
    // column leads, the author's columns follow; hidden ones stay out.
    await waitFor(
      () => expect(JSON.parse(screen.getByTestId('grid-columns').textContent ?? 'null')).toEqual(['owner_id', 'title', 'severity']),
      { timeout: 8000 },
    );
  });

  it('a served draft whose stored copy the layers do not carry installs no buffer: the strip says why and nothing is sent', async () => {
    srv.draft = wire(AUTHORED);
    srv.servesDraftLayer = false;
    renderZh();

    await screen.findByText(t('engine.studio.refusal.draftUnreadable', 'zh-CN'), undefined, { timeout: 8000 });
    await pastTheAutosave();
    expect(objectSaves()).toEqual([]);
  });
});
