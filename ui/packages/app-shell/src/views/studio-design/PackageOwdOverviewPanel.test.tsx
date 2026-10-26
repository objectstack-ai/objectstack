// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0054 testability proofs for the package OWD overview (objectui#2505):
 *   1. list render     — every package object appears with its OWD baseline.
 *   2. edit → draft     — a changed row saves as that object's package draft.
 *   3. controlled_by_parent — master link shown.
 *   4. read-only        — badges only, no editing affordances.
 *   5. deep-link        — the highlighted object's row is marked.
 *
 * Drives the REAL component against a fake metadata client that behaves like
 * the server (list ∪ drafts, layered read-back, save records the payload).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

const en = (key: string) => t(key, 'en-US');

/** What each dial lists an OWD value under; the dials are the shared Select (objectui#11865). */
const OWD_LABEL: Record<string, string> = {
  '': en('engine.studio.settings.sharingUnset'),
  private: en('engine.studio.settings.sharingPrivate'),
  public_read: en('engine.studio.settings.sharingPublicRead'),
  public_read_write: en('engine.studio.settings.sharingPublicReadWrite'),
};

/** Pick a dial's option by its label, through the trigger, as a user does. */
async function pickOwd(testId: string, label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
}

interface Server {
  /** Merged object bodies keyed by name (what layered() returns as `effective`). */
  objects: Record<string, Record<string, unknown>>;
  /** Draft-only object names (appear via listDrafts, not list). */
  draftOnly: string[];
  saved: Array<{ name: string; body: Record<string, unknown>; opts?: Record<string, unknown> }>;
}

function makeClient(server: Server) {
  return {
    list: async (type: string) => {
      if (type !== 'object') return [];
      return Object.entries(server.objects).map(([name, body]) => ({ name, label: body.label ?? name }));
    },
    listDrafts: async () => server.draftOnly.map((name) => ({ name })),
    layered: async (_type: string, name: string) => ({ effective: server.objects[name] ?? {}, code: null }),
    getDraft: async () => null,
    save: async (_type: string, name: string, body: Record<string, unknown>, opts?: Record<string, unknown>) => {
      server.saved.push({ name, body, opts });
      server.objects[name] = body; // reopen reads it back
      return body;
    },
  } as any;
}

function freshServer(): Server {
  return {
    objects: {
      crm_account: { name: 'crm_account', label: 'Account', sharingModel: 'public_read_write' },
      crm_contact: { name: 'crm_contact', label: 'Contact', sharingModel: 'private' },
      crm_case: {
        name: 'crm_case',
        label: 'Case',
        sharingModel: 'controlled_by_parent',
        fields: { account: { type: 'master_detail', reference: 'crm_account', required: true } },
      },
    },
    draftOnly: [],
    saved: [],
  };
}

function renderPanel(server: Server, extra: Partial<React.ComponentProps<typeof PackageOwdOverviewPanel>> = {}) {
  return render(
    <PackageOwdOverviewPanel
      client={makeClient(server)}
      packageId="com.example.showcase"
      locale="en-US"
      {...extra}
    />,
  );
}

beforeEach(() => {
  // jsdom has no layout — stub the scroll used by the deep-link highlight.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('PackageOwdOverviewPanel — list render', () => {
  it('lists every package object with its OWD baseline value', async () => {
    renderPanel(freshServer());
    await screen.findByTestId('owd-row-crm_account');
    expect(screen.getByTestId('owd-row-crm_contact')).toBeTruthy();
    expect(screen.getByTestId('owd-row-crm_case')).toBeTruthy();
    expect(screen.getByTestId('owd-internal-crm_account').textContent).toBe(OWD_LABEL.public_read_write);
    expect(screen.getByTestId('owd-internal-crm_contact').textContent).toBe(OWD_LABEL.private);
  });

  it('includes draft-only objects from listDrafts', async () => {
    const server = freshServer();
    server.draftOnly = ['crm_new'];
    server.objects.crm_new = {}; // no published baseline, but layered returns {} → row still renders
    renderPanel(server);
    expect(await screen.findByTestId('owd-row-crm_new')).toBeTruthy();
  });
});

describe('PackageOwdOverviewPanel — edit → per-object draft', () => {
  it('saves only the changed object as a package-scoped draft', async () => {
    const server = freshServer();
    renderPanel(server);
    await screen.findByTestId('owd-row-crm_contact');

    // No changes → Save disabled.
    expect((screen.getByTestId('owd-save') as HTMLButtonElement).disabled).toBe(true);

    // Widen crm_contact private → public_read.
    await pickOwd('owd-internal-crm_contact', OWD_LABEL.public_read);
    expect(screen.getByTestId('owd-dirty-crm_contact')).toBeTruthy();
    expect((screen.getByTestId('owd-save') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('owd-save'));
    await waitFor(() => expect(server.saved.length).toBe(1));
    expect(server.saved[0].name).toBe('crm_contact');
    expect(server.saved[0].body.sharingModel).toBe('public_read');
    expect(server.saved[0].opts).toMatchObject({ mode: 'draft', packageId: 'com.example.showcase' });
    // Untouched objects are not written.
    expect(server.saved.every((s) => s.name !== 'crm_account')).toBe(true);
  });

  it('drops the key when a model is cleared back to unset', async () => {
    const server = freshServer();
    renderPanel(server);
    await screen.findByTestId('owd-row-crm_account');
    await pickOwd('owd-internal-crm_account', OWD_LABEL['']);
    fireEvent.click(screen.getByTestId('owd-save'));
    await waitFor(() => expect(server.saved.length).toBe(1));
    expect('sharingModel' in server.saved[0].body).toBe(false);
  });
});

describe('PackageOwdOverviewPanel — controlled_by_parent', () => {
  it('shows the master link', async () => {
    renderPanel(freshServer());
    await screen.findByTestId('owd-row-crm_case');
    const master = screen.getByTestId('owd-master-crm_case');
    expect(master.textContent).toMatch(/crm_account/);
  });
});

describe('PackageOwdOverviewPanel — read-only', () => {
  it('renders badges only, with no editing affordances', async () => {
    renderPanel(freshServer(), { readOnly: true });
    await screen.findByTestId('owd-row-crm_account');
    expect(screen.queryByTestId('owd-save')).toBeNull();
    expect(screen.queryByTestId('owd-internal-crm_account')).toBeNull();
    // The value is still shown as text.
    const row = within(screen.getByTestId('owd-row-crm_account'));
    expect(row.getByText(/Public read\/write/)).toBeTruthy();
  });
});

describe('PackageOwdOverviewPanel — deep-link highlight', () => {
  it('marks the highlighted object row', async () => {
    renderPanel(freshServer(), { highlightObject: 'crm_contact' });
    const row = await screen.findByTestId('owd-row-crm_contact');
    expect(row.className).toMatch(/bg-primary/);
  });
});

describe('PackageOwdOverviewPanel — onDirtyChange contract (objectui#2600)', () => {
  it('reports dirty transitions and resets to clean on unmount', async () => {
    const onDirtyChange = vi.fn();
    const { unmount } = renderPanel(freshServer(), { onDirtyChange });
    await screen.findByTestId('owd-row-crm_contact');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await pickOwd('owd-internal-crm_contact', OWD_LABEL.public_read);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    // Reverting the edit back to the baseline reports clean again.
    await pickOwd('owd-internal-crm_contact', OWD_LABEL.private);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    // Dirty again, then unmount — a deliberately-discarded panel must clear
    // the host's guard by itself (same contract as PermissionMatrixEditPage).
    await pickOwd('owd-internal-crm_contact', OWD_LABEL.public_read);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('reports clean after a successful save (edits become the new baseline)', async () => {
    const onDirtyChange = vi.fn();
    const server = freshServer();
    renderPanel(server, { onDirtyChange });
    await screen.findByTestId('owd-row-crm_contact');

    await pickOwd('owd-internal-crm_contact', OWD_LABEL.public_read);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByTestId('owd-save'));
    await waitFor(() => expect(server.saved.length).toBe(1));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});
