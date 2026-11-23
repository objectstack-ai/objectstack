// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — a hook saves with the top bar's Save and Cancel, and a
 * Save is live at once.
 *
 * - An edit sends nothing: no draft write leaves before Save is pressed, however
 *   long the page waits (the hook's 1.5 s autosave is gone).
 * - Save writes the hook's draft at its package, then publishes that one hook at
 *   the same package (`POST /meta/hook/NAME/publish?package=`). The batch door
 *   (`/packages/:id/publish-drafts`) is never called.
 * - "+ New" writes nothing either; its Save is the first-write pin
 *   (`If-None-Match: *`), then the same single-item publish.
 * - Cancel sends nothing and puts the hook back as the server holds it.
 * - A refused publish keeps the edit unsaved and takes back the draft it wrote.
 * - A rename holds the whole Save, naming the stored name.
 *
 * The buffer is the one the Data pillar keeps (`useObjectHooksBuffer`), mounted
 * with the panel inside the top bar's coordinator. The client is a real
 * `MetadataClient`; only its transport and its reads are doubles, so each
 * write's URL is what the server would read.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const PACKAGE = 'com.example.showcase';
const hook = {
  name: 'guard_hook',
  label: 'Guard',
  object: 'invoice',
  events: ['beforeInsert'],
  handler: 'guard_fn',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Write {
  method: string;
  url: URL;
  headers: Headers;
  body: Record<string, unknown> | null;
}
const writes: Write[] = [];
const server = { refusePublish: false };

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  if (method === 'GET') return json(404, null);
  writes.push({
    method,
    url: new URL(url),
    headers: new Headers(init?.headers),
    body: init?.body ? JSON.parse(String(init.body)) : null,
  });
  if (method === 'POST' && server.refusePublish) {
    return json(422, { success: false, error: { code: 'INVALID_METADATA', message: 'The hook names no handler that is live.' } });
  }
  return json(200, { success: true, version: 'v1' });
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async (type: string) => (type === 'hook' ? [hook] : [{ name: 'invoice', label: 'Invoice' }])),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async () => null),
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { toast } from 'sonner';
import { ObjectHooksPanel } from './ObjectHooksPanel';
import { useObjectHooksBuffer } from './objectHooksBuffer';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from './__tests__/studioSaveHarness';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';
import { tFormat } from '../metadata-admin/i18n';

registerBuiltinInspectors();

function HooksHost(): React.ReactElement {
  const buffer = useObjectHooksBuffer({ objectName: 'invoice', packageId: PACKAGE, active: true });
  return (
    <>
      {buffer.dialog}
      <ObjectHooksPanel buffer={buffer} />
    </>
  );
}

beforeEach(() => {
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
      introspectScope: () => ({ fields: ['status'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
});
afterEach(() => {
  cleanup();
  writes.length = 0;
  server.refusePublish = false;
  __setCelFormulaLoader(undefined);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

const describeWrite = (w: Write) => `${w.method} ${w.url.pathname}${w.url.search}`;

/** Past the retired autosave's 1.5 s debounce and a round trip. */
async function waitPastTheOldAutosave(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

function mount(): void {
  render(
    <StudioSaveHarness>
      <HooksHost />
    </StudioSaveHarness>,
  );
}

async function openGuardExpression(): Promise<HTMLTextAreaElement> {
  mount();
  fireEvent.click(await screen.findByText('Guard'));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

describe('Hooks — Save and Cancel in the top bar, live at once (objectstack#36511)', () => {
  it('an edit sends nothing until Save; Save writes the draft, then publishes that hook at its package', async () => {
    const box = await openGuardExpression();
    expect(screen.queryByTestId('studio-save'), 'no edit, no Save').toBeNull();

    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    expect(await screen.findByTestId('studio-save')).toBeInTheDocument();
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite), 'no write before Save').toEqual([]);

    await pressStudioSave();
    await waitFor(() => expect(writes).toHaveLength(2), { timeout: 4000 });
    const [draft, publish] = writes;
    expect(draft.method).toBe('PUT');
    expect(draft.url.pathname).toBe('/api/v1/meta/hook/guard_hook');
    expect(draft.url.searchParams.get('mode')).toBe('draft');
    expect(draft.url.searchParams.get('package')).toBe(PACKAGE);
    expect(JSON.stringify(draft.body)).toContain("record.status == 'open'");
    expect(publish.method).toBe('POST');
    expect(publish.url.pathname).toBe('/api/v1/meta/hook/guard_hook/publish');
    expect(publish.url.searchParams.get('package')).toBe(PACKAGE);
    expect(writes.some((w) => w.url.pathname.includes('publish-drafts'))).toBe(false);

    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith(tFormat('engine.studio.save.done', 'en', { items: 'Guard' }), { id: 'studio-save' });
  });

  it('Cancel sends nothing and puts the hook back as the server holds it', async () => {
    const box = await openGuardExpression();
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await screen.findByTestId('studio-save');
    expect(screen.getByDisplayValue("record.status == 'open'")).toBeInTheDocument();

    await pressStudioCancel();
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
    // The hook as the server holds it: no condition, the edit gone from the page.
    expect(screen.queryByDisplayValue("record.status == 'open'")).toBeNull();
    expect(screen.getByTestId('hook-name')).toHaveValue('guard_hook');
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite)).toEqual([]);
  });

  it('"+ New" writes nothing; its Save is the first write (If-None-Match: *), then that hook is published', async () => {
    mount();
    await screen.findByText('Guard');
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    expect(await screen.findByTestId('studio-save')).toBeInTheDocument();
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite), 'a new hook is not written before Save').toEqual([]);

    await pressStudioSave();
    await waitFor(() => expect(writes).toHaveLength(2), { timeout: 4000 });
    const [create, publish] = writes;
    expect(create.method).toBe('PUT');
    expect(create.url.searchParams.get('mode')).toBe('draft');
    expect(create.headers.get('If-None-Match')).toBe('*');
    expect(create.body?.object).toBe('invoice');
    expect(publish.method).toBe('POST');
    expect(publish.url.pathname).toBe(`${create.url.pathname}/publish`);
    expect(publish.url.searchParams.get('package')).toBe(PACKAGE);
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
  });

  it('a refused publish keeps the edit unsaved, says why, and takes back the draft it wrote', async () => {
    server.refusePublish = true;
    const box = await openGuardExpression();
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await pressStudioSave();
    await waitFor(() => expect(writes.map((w) => w.method)).toEqual(['PUT', 'POST', 'DELETE']), { timeout: 4000 });
    const discard = writes[2];
    expect(discard.url.pathname).toBe('/api/v1/meta/hook/guard_hook');
    expect(discard.url.searchParams.get('state')).toBe('draft');
    expect(discard.url.searchParams.get('package')).toBe(PACKAGE);
    expect(box).toHaveValue("record.status == 'open'");
    expect(screen.getByTestId('studio-save'), 'still offered to Save').toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      tFormat('engine.studio.save.refused', 'en', { items: 'Guard' }),
      expect.objectContaining({ description: expect.stringContaining('The hook names no handler that is live.') }),
    );
  });

  it('a rename holds the whole Save and names the stored name', async () => {
    mount();
    fireEvent.click(await screen.findByText('Guard'));
    const name = (await screen.findByTestId('hook-name')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'audit_trail' } });
    await pressStudioSave();
    const clause = tFormat('engine.studio.held.hookRename', 'en', { name: 'guard_hook' });
    expect(toast.error).toHaveBeenCalledWith(tFormat('engine.studio.save.held', 'en', { clause }));
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite)).toEqual([]);
  });
});
