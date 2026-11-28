// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36660 — a row of the OWD overview edits one object's sharing
 * model over that object's pending draft as-is, and its Save publishes the
 * object: the whole draft goes live, not only the dial. When the AI assistant
 * (copilot or MCP) wrote that draft, the row says the object has the AI's
 * unpublished changes, and its discard drops that object's draft at the
 * package, asking first only over the row's own unsaved edit; the other rows
 * keep theirs. A person's own draft keeps the plain "unpublished" chip.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';

const PKG = 'com.example.showcase';
const en = (key: string) => t(key, 'en-US');
const PUBLIC_READ = en('engine.studio.settings.sharingPublicRead');

type Body = Record<string, unknown>;
type Change = { path: string[]; by: string; actor?: string; at: string };

interface Server {
  published: Map<string, Body>;
  drafts: Map<string, { body: Body; changes?: Change[] }>;
  saves: Array<{ name: string; body: Body }>;
  publishes: string[];
  resets: Array<{ name: string; opts: unknown }>;
}

let server: Server;

function makeClient() {
  return {
    list: vi.fn(async (type: string) =>
      type === 'object' ? [...server.published.values()].map((b) => ({ name: b.name, label: b.label })) : [],
    ),
    listDrafts: vi.fn(async () => [...server.drafts.keys()].map((name) => ({ type: 'object', name }))),
    layered: vi.fn(async (_type: string, name: string) => {
      const pub = server.published.get(name) ?? null;
      return { effective: pub, code: null, overlay: pub };
    }),
    getDraft: vi.fn(async (_type: string, name: string) => {
      const row = server.drafts.get(name);
      if (!row) return null;
      return { type: 'object', name, item: structuredClone(row.body), version: `draft:${name}`, ...(row.changes ? { draftChanges: row.changes } : {}) };
    }),
    save: vi.fn(async (_type: string, name: string, body: Body) => {
      server.saves.push({ name, body: structuredClone(body) });
      server.drafts.set(name, { body: structuredClone(body), changes: server.drafts.get(name)?.changes });
      return { success: true, version: `draft:${name}:2`, state: 'draft' };
    }),
    publish: vi.fn(async (_type: string, name: string) => {
      server.publishes.push(name);
      const d = server.drafts.get(name);
      if (d) server.published.set(name, d.body);
      server.drafts.delete(name);
      return { success: true };
    }),
    reset: vi.fn(async (_type: string, name: string, opts?: unknown) => {
      server.resets.push({ name, opts });
      server.drafts.delete(name);
      return { success: true };
    }),
  };
}

const AI_CHANGE: Change = { path: ['fields', 'notes'], by: 'copilot', actor: 'u1', at: '2026-11-27T10:00:00.000Z' };

function freshServer(changes: Change[] | null = [AI_CHANGE]): Server {
  const account = { name: 'crm_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text' } } };
  const contact = { name: 'crm_contact', label: 'Contact', sharingModel: 'private' };
  return {
    published: new Map<string, Body>([
      ['crm_account', account],
      ['crm_contact', contact],
    ]),
    // The AI added a field to Account: its draft is the whole object.
    drafts: new Map([
      ['crm_account', { body: { ...account, fields: { ...account.fields, notes: { type: 'textarea' } } }, changes: changes ?? undefined }],
    ]),
    saves: [],
    publishes: [],
    resets: [],
  };
}

let client: ReturnType<typeof makeClient>;
const confirmSpy = vi.fn((_message?: string) => true);

function renderPanel() {
  client = makeClient();
  render(
    <StudioSaveHarness>
      <PackageOwdOverviewPanel client={client as never} packageId={PKG} locale="en-US" />
    </StudioSaveHarness>,
  );
}

async function pickOwd(testId: string, label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
}

const accountRow = () => screen.getByTestId('owd-row-crm_account');
const contactRow = () => screen.getByTestId('owd-row-crm_contact');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal('confirm', confirmSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PackageOwdOverviewPanel — an object whose pending draft is the AI assistant\'s (objectstack#36660)', () => {
  it('the row says the object has the AI\'s unpublished changes, and its Save makes all of them live', async () => {
    server = freshServer();
    renderPanel();
    await screen.findByTestId('owd-row-crm_account');
    expect(within(accountRow()).getByTestId('studio-ai-draft-notice')).toHaveTextContent(en('engine.studio.owd.aiDraftNotice'));
    expect(within(contactRow()).queryByTestId('studio-ai-draft-notice')).toBeNull();

    await pickOwd('owd-internal-crm_account', PUBLIC_READ);
    await pressStudioSave();
    await waitFor(() => expect(server.publishes).toEqual(['crm_account']));
    // The row's Save carried the AI's field, as the notice said.
    expect(server.saves[0]!.body).toMatchObject({ sharingModel: 'public_read', fields: { notes: { type: 'textarea' } } });
    await waitFor(() => expect(within(accountRow()).queryByTestId('studio-ai-draft-notice')).toBeNull());
  });

  it('an MCP-written draft is the AI\'s too', async () => {
    server = freshServer([{ ...AI_CHANGE, by: 'mcp' }]);
    renderPanel();
    await screen.findByTestId('owd-row-crm_account');
    expect(within(accountRow()).getByTestId('studio-ai-draft-notice')).toBeInTheDocument();
  });

  it('a person\'s own draft, or one whose read recorded nothing, keeps the plain unpublished chip and no AI line', async () => {
    for (const changes of [[{ ...AI_CHANGE, by: 'studio' }], null]) {
      server = freshServer(changes);
      renderPanel();
      await screen.findByTestId('owd-row-crm_account');
      expect(within(accountRow()).queryByTestId('studio-ai-draft-notice')).toBeNull();
      expect(within(accountRow()).getByText(en('engine.studio.unpublishedDraft'))).toBeInTheDocument();
      cleanup();
    }
  });

  it('discard with the row unedited asks nothing and drops that object\'s draft at the package; another row keeps its edit', async () => {
    server = freshServer();
    renderPanel();
    await screen.findByTestId('owd-row-crm_account');
    await pickOwd('owd-internal-crm_contact', PUBLIC_READ);
    fireEvent.click(within(accountRow()).getByTestId('studio-ai-draft-discard'));
    await waitFor(() => expect(server.resets).toHaveLength(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(server.resets[0]).toEqual({ name: 'crm_account', opts: { state: 'draft', packageId: PKG } });
    expect(server.publishes).toEqual([]);
    await waitFor(() => expect(within(accountRow()).queryByTestId('studio-ai-draft-notice')).toBeNull());
    expect(screen.getByTestId('owd-dirty-crm_contact')).toBeInTheDocument();
    expect(screen.getByTestId('owd-internal-crm_contact')).toHaveTextContent(PUBLIC_READ);
  });

  it('discard over the row\'s own unsaved edit asks first; declined, nothing is sent and the edit stays', async () => {
    server = freshServer();
    confirmSpy.mockReturnValue(false);
    renderPanel();
    await screen.findByTestId('owd-row-crm_account');
    await pickOwd('owd-internal-crm_account', PUBLIC_READ);
    fireEvent.click(within(accountRow()).getByTestId('studio-ai-draft-discard'));
    expect(confirmSpy).toHaveBeenCalledWith(en('engine.studio.owd.aiDraftDiscardConfirmUnsaved'));
    expect(client.reset).not.toHaveBeenCalled();
    expect(screen.getByTestId('owd-dirty-crm_account')).toBeInTheDocument();
  });

  it('discard over the row\'s own unsaved edit, confirmed: the draft and the edit go', async () => {
    server = freshServer();
    renderPanel();
    await screen.findByTestId('owd-row-crm_account');
    await pickOwd('owd-internal-crm_account', PUBLIC_READ);
    fireEvent.click(within(accountRow()).getByTestId('studio-ai-draft-discard'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(server.resets).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-crm_account')).toBeNull());
    expect(within(accountRow()).queryByTestId('studio-ai-draft-notice')).toBeNull();
  });
});
