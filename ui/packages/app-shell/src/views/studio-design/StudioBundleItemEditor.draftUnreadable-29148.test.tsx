// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29148 — the All metadata area's form editor (email template,
 * translation) takes a pending draft the server refuses to read (`403
 * PERMISSION_DENIED`) for what it is, never for "no draft". It installs no
 * buffer over it: the published body is not offered to edit, the strip says
 * why with the server's sentence behind Details, and the autosave sends
 * nothing, so the draft keeps its keys and its audience gate.
 *
 * Through the mounted editor, its real autosave and version pin, and Setup's
 * real form (`SchemaForm` over `default-schemas.ts`'s entry). The metadata
 * client is a server double: `getDraft` serves the stored draft, resolves
 * `null` for none (the client's reading of a 404), or refuses it as the read
 * gate does (an `Error` carrying `status` and `code`, the shape the metadata
 * client throws).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { t } from '../metadata-admin/i18n';

const PKG = 'com.example.crm';
const GATE_REFUSAL = "You do not have permission to open the 'welcome' email template.";

const srv = vi.hoisted(() => ({
  published: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Draft rows whose read is refused as the audience gate refuses it. */
  gated: new Set<string>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> }>,
}));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async (type: string, name: string) => {
    const key = `${type}/${name}`;
    if (srv.gated.has(key)) {
      throw Object.assign(new Error(GATE_REFUSAL), {
        status: 403,
        code: 'PERMISSION_DENIED',
        body: { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } },
      });
    }
    const row = srv.drafts.get(key);
    return row ? { type, name, item: clone(row), version: 'v1' } : null;
  }),
  layered: vi.fn(async (type: string, name: string) => {
    const row = srv.published.get(`${type}/${name}`) ?? null;
    return { code: row ? clone(row) : null, overlay: null, overlayScope: null, effective: row ? clone(row) : null };
  }),
  save: vi.fn(async (type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
    srv.saves.push({ type, name, body: clone(item) as Record<string, unknown>, opts: clone(opts) });
    srv.drafts.set(`${type}/${name}`, clone(item) as Record<string, unknown>);
    return { success: true, version: 'v2', state: 'draft' };
  }),
  reset: vi.fn(async () => ({ success: true })),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { StudioBundleItemEditor } from './StudioBundleItemEditor';
import { registerDefaultMetadataSchemas } from '../metadata-admin/default-schemas';

const WELCOME = { name: 'welcome', label: 'Welcome', locale: 'en-US', subject: 'Welcome', bodyHtml: '<p>Hello</p>' };
/** The pending draft: the published body plus an audience gate the author does not hold. */
const GATED_DRAFT = { ...WELCOME, subject: 'Welcome (draft)', requiredPermissions: ['crm.export_data'] };

beforeAll(() => {
  registerDefaultMetadataSchemas();
});

beforeEach(() => {
  srv.published.clear();
  srv.drafts.clear();
  srv.gated.clear();
  srv.saves.length = 0;
  for (const fn of Object.values(mockClient)) fn.mockClear();
  srv.published.set('email_template/welcome', clone(WELCOME));
});

afterEach(() => {
  cleanup();
});

function mount() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/metadata/email_template/welcome`]}>
      <StudioBundleItemEditor
        packageId={PKG}
        type="email_template"
        name="welcome"
        member="en-US"
        readOnly={false}
        basePath={`/studio/${PKG}/metadata`}
      />
    </MemoryRouter>,
  );
}

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

describe('StudioBundleItemEditor — a draft the server refuses to read is not "no draft" (objectstack#29148)', () => {
  it('opens no buffer over the refused draft: the strip says why, nothing is editable, and no save is sent', async () => {
    srv.drafts.set('email_template/welcome', clone(GATED_DRAFT));
    srv.gated.add('email_template/welcome');

    mount();

    // Red on base: the refusal was read as "no draft", and the published body
    // was installed as the buffer and offered to edit.
    expect(
      await screen.findByText(t('engine.studio.refusal.draftUnreadable', 'en-US'), undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(mockClient.getDraft).toHaveBeenCalledWith('email_template', 'welcome', { packageId: PKG, member: 'en-US' });
    // The server's own sentence stays reachable, behind Details.
    expect(screen.getByTestId('studio-bundle-editor-error-detail')).toHaveTextContent(GATE_REFUSAL);
    expect(screen.queryByTestId('studio-bundle-editor-form')).toBeNull();
    expect(screen.queryByLabelText(/^Subject\b/)).toBeNull();
    // The published layer is never read to stand in for the draft.
    expect(mockClient.layered).not.toHaveBeenCalled();

    await pastTheAutosave();
    expect(srv.saves).toEqual([]);
    expect(srv.drafts.get('email_template/welcome')).toStrictEqual(GATED_DRAFT);
  });

  it('CONTROL: with no pending draft the published body opens, and an edit saves pinned to "no draft row"', async () => {
    mount();

    const subject = (await screen.findByLabelText(/^Subject\b/, undefined, { timeout: 8000 })) as HTMLInputElement;
    expect(subject).toHaveValue('Welcome');
    expect(screen.queryByText(t('engine.studio.refusal.draftUnreadable', 'en-US'))).toBeNull();

    fireEvent.change(subject, { target: { value: 'Welcome aboard' } });
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 5000 });
    const [save] = srv.saves;
    expect(save).toMatchObject({ type: 'email_template', name: 'welcome' });
    expect(save!.body).toMatchObject({ subject: 'Welcome aboard' });
    expect(save!.opts).toMatchObject({ mode: 'draft', packageId: PKG, ifNoneMatch: '*' });
    expect(save!.opts).not.toHaveProperty('ifMatch');
  });
});
