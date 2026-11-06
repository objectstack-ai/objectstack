// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29793 — with the console in Chinese, the metadata editor
 * (Setup's object editor) edits an object as its author wrote it, not as it is
 * served.
 *
 * The client is a double of a zh-CN server, shaped as measured on a live stack:
 * `?state=draft` (`getDraft`) answers the pending draft TRANSLATED and GOVERNED
 * (the platform's injected columns in `fields`); `/layers` (`layered`) answers
 * the stored draft as `draft` and the stored row as `overlay` (untranslated, no
 * injected columns) and `effective` governed. Before the fix the buffer was the
 * served draft (or `effective`), so one edit PUT the translations as source
 * labels and the injected columns as author fields.
 *
 * The editor's canvas is a stub that prints the buffer and patches one field
 * label, so the page's own load, autosave and publish refreshes are what is
 * under test.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

type Row = Record<string, unknown>;

const OBJECT = 'showcase_custom_ticket';

/** The object as its author wrote it: source labels, author fields only. */
const AUTHORED: Row = {
  name: OBJECT,
  label: 'Ticket',
  pluralLabel: 'Tickets',
  sharingModel: 'private',
  fields: {
    title: { type: 'text', label: 'Title' },
    severity: { type: 'text', label: 'Severity' },
  },
};

const INJECTED_NAMES = ['organization_id', 'created_at', 'owner_id', 'queue', '__search'];

/** What a governed read serves for a document, in a zh-CN read when `zh`. */
function governed(doc: Row, zh: boolean): Row {
  const zhLabel: Record<string, string> = { title: '标题', severity: '严重程度' };
  const fields = doc.fields as Record<string, Row>;
  return {
    ...doc,
    ...(zh ? { label: '工单', pluralLabel: '工单' } : {}),
    fields: {
      organization_id: { type: 'lookup', reference: 'sys_organization', label: zh ? '组织' : 'Organization', system: true, hidden: true },
      created_at: { type: 'datetime', label: zh ? '创建时间' : 'Created At', system: true, readonly: true },
      owner_id: { type: 'lookup', reference: 'sys_user', label: zh ? '负责人' : 'Owner', system: true },
      queue: { type: 'text', label: zh ? '队列' : 'Queue', system: true, hidden: true },
      __search: { type: 'text', label: 'Search Index', system: true, hidden: true },
      ...Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, zh && zhLabel[k] && v.label === ({ title: 'Title', severity: 'Severity' } as Row)[k] ? { ...v, label: zhLabel[k] } : v]),
      ),
    },
  };
}

const wire = (doc: unknown): Row => JSON.parse(JSON.stringify(doc)) as Row;

const srv = vi.hoisted(() => ({
  overlay: null as Record<string, unknown> | null,
  draft: null as Record<string, unknown> | null,
  /** `false` models a server that does not serve the `draft` layer to this caller. */
  servesDraftLayer: true,
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> | undefined }>,
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  getDraft: vi.fn(async (): Promise<unknown> => null),
  save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
    const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    srv.saves.push({ type, name, body, opts });
    if (opts?.mode === 'draft') srv.draft = body;
    else srv.overlay = body;
    return { type, name, item: body };
  }),
  publish: vi.fn(async () => {
    srv.overlay = srv.draft;
    srv.draft = null;
    return { success: true, version: 2 };
  }),
  reset: vi.fn(async () => ({})),
}));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'object', name: 'object', label: 'Object', allowEnvironmentOverlay: true, schema: { required: [] } }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';
import { t } from './i18n';

await loadStudioCatalogue('zh');

/** Canvas stand-in: prints the buffer, and relabels one field through the page's own patch door. */
function StubCanvas({ draft, onPatch }: { draft: Row; onPatch?: (patch: Row) => void }) {
  const fields = (draft.fields ?? {}) as Record<string, Row>;
  return (
    <>
      <pre data-testid="editor-draft">{JSON.stringify(draft)}</pre>
      <button
        type="button"
        onClick={() => onPatch?.({ fields: { ...fields, severity: { ...fields.severity, label: 'Level' } } })}
      >
        relabel severity
      </button>
    </>
  );
}

const realPreview = getMetadataPreview('object');

beforeEach(() => {
  srv.overlay = wire(AUTHORED);
  srv.draft = null;
  srv.servesDraftLayer = true;
  srv.saves.length = 0;
  registerMetadataPreview('object', StubCanvas as never);
  mockClient.layered.mockImplementation(async () => ({
    code: null,
    overlay: srv.overlay,
    overlayScope: srv.overlay ? 'env' : null,
    effective: srv.overlay ? governed(srv.overlay, false) : null,
    ...(srv.servesDraftLayer ? { draft: srv.draft } : {}),
    editable: true,
    deletable: true,
    resettable: false,
    lock: 'none',
  }));
  mockClient.getDraft.mockImplementation(async () => {
    if (!srv.draft) throw Object.assign(new Error(`No pending draft exists for object/${OBJECT}.`), { code: 'NO_DRAFT', status: 404 });
    return { type: 'object', name: OBJECT, item: { ...governed(srv.draft, true), _diagnostics: { valid: true, errors: [] } } };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  if (realPreview) registerMetadataPreview('object', realPreview);
  window.history.replaceState(null, '', '/');
});

function renderZh() {
  window.history.replaceState(null, '', `/metadata/object/${OBJECT}`);
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/metadata/object/${OBJECT}`]}>
        <MetadataResourceEditPage type="object" name={OBJECT} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

const editorDraft = (): Row => JSON.parse(screen.getByTestId('editor-draft').textContent ?? '{}') as Row;

function expectAuthored(doc: Row, severityLabel: string) {
  expect(doc.label).toBe('Ticket');
  expect(doc.pluralLabel).toBe('Tickets');
  const fields = doc.fields as Record<string, Row>;
  expect(Object.keys(fields)).toEqual(['title', 'severity']);
  for (const injected of INJECTED_NAMES) expect(fields).not.toHaveProperty(injected);
  expect(fields.title.label).toBe('Title');
  expect(fields.severity.label).toBe(severityLabel);
}

describe('MetadataResourceEditPage in a zh-CN console — an object buffer is the authored document (objectstack#29793)', () => {
  it('a pending draft: the buffer is the stored draft, one edit PUTs it in source labels with no injected column, and the publish refresh stays authored', async () => {
    srv.draft = wire({ ...AUTHORED, description: 'draft only' });
    renderZh();

    await waitFor(() => expect(editorDraft().name).toBe(OBJECT), { timeout: 8000 });
    expect(editorDraft()).toStrictEqual(wire({ ...AUTHORED, description: 'draft only' }));

    fireEvent.click(screen.getByRole('button', { name: 'relabel severity' }));
    await waitFor(() => expect(srv.saves.length).toBeGreaterThan(0), { timeout: 8000 });
    const { body, opts } = srv.saves.at(-1)!;
    expect(opts).toMatchObject({ mode: 'draft' });
    expectAuthored(body, 'Level');
    expect(body.description).toBe('draft only');

    // The refresh after the save installs the stored draft again, not the served one.
    await waitFor(() => expect((editorDraft().fields as Record<string, Row>).severity.label).toBe('Level'), { timeout: 8000 });
    expectAuthored(editorDraft(), 'Level');

    // Publish: the refresh installs the promoted body as authored (`overlay`).
    const publish = await screen.findAllByRole('button', { name: new RegExp(`^${t('engine.edit.publish', 'zh-CN')}$`) }, { timeout: 8000 });
    await waitFor(() => expect(publish[0]).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(publish[0]!);
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalledTimes(1), { timeout: 8000 });
    await waitFor(() => expect(srv.draft).toBeNull(), { timeout: 8000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expectAuthored(editorDraft(), 'Level');
  });

  it('no pending draft: the buffer is the stored row (`overlay`), and one edit PUTs it in source labels with no injected column', async () => {
    renderZh();

    await waitFor(() => expect(editorDraft().name).toBe(OBJECT), { timeout: 8000 });
    expect(editorDraft()).toStrictEqual(wire(AUTHORED));

    fireEvent.click(screen.getByRole('button', { name: 'relabel severity' }));
    await waitFor(() => expect(srv.saves.length).toBeGreaterThan(0), { timeout: 8000 });
    expectAuthored(srv.saves.at(-1)!.body, 'Level');
  });

  it('a served draft whose stored copy the layers do not carry installs no buffer: the page says why and nothing is sent', async () => {
    srv.draft = wire(AUTHORED);
    srv.servesDraftLayer = false;
    renderZh();

    await screen.findByText(t('engine.studio.refusal.draftUnreadable', 'zh-CN'), undefined, { timeout: 8000 });
    expect(screen.queryByTestId('editor-draft')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    expect(srv.saves).toEqual([]);
  });
});
