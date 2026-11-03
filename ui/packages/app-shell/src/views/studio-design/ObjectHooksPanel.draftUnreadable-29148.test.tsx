// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29148 — the Data pillar's Hooks view reads one draft per hook
 * its package's drafts ledger lists. A draft the server refuses to read (`403
 * PERMISSION_DENIED`) is never taken for "no draft": that hook opens no
 * buffer, so its published row is not offered to edit, the strip says why
 * with the server's sentence behind Details, and the autosave sends nothing.
 *
 * A PARTIAL refusal holds only the refused hook: the other hooks of the list,
 * with or without a readable draft, load, edit and save as before.
 *
 * The door double refuses a gated draft read as the metadata client throws a
 * refused read (an `Error` carrying `status` and `code`), and resolves `null`
 * for no draft (the client's reading of a 404).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { t } from '../metadata-admin/i18n';

const PKG = 'com.example.showcase';
const GATE_REFUSAL = "You do not have permission to read the pending draft of 'guard_hook'.";
const guard = { name: 'guard_hook', label: 'Guard', object: 'invoice', events: ['beforeInsert'], handler: 'guard_fn' };
const audit = { name: 'audit_hook', label: 'Audit', object: 'invoice', events: ['afterInsert'], handler: 'audit_fn' };

interface Sent {
  name: string;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
}

const door = {
  drafts: new Map<string, { body: Record<string, unknown>; version: string }>(),
  /** Draft rows whose read is refused as the read gate refuses it. */
  gated: new Set<string>(),
  sent: [] as Sent[],
};

const mockClient = {
  list: vi.fn(async () => [guard, audit]),
  listDrafts: vi.fn(async () => [...door.drafts.keys()].map((name) => ({ type: 'hook', name }))),
  getDraft: vi.fn(async (_type: string, name: string, _options?: { packageId?: string }) => {
    if (door.gated.has(name)) {
      throw Object.assign(new Error(GATE_REFUSAL), {
        status: 403,
        code: 'PERMISSION_DENIED',
        body: { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } },
      });
    }
    const row = door.drafts.get(name);
    return row ? { type: 'hook', name, item: JSON.parse(JSON.stringify(row.body)), version: row.version } : null;
  }),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
  save: vi.fn(
    async (_type: string, name: string, body: Record<string, unknown>, options?: { ifMatch?: string; ifNoneMatch?: string }) => {
      door.sent.push({ name, ifMatch: options?.ifMatch, ifNoneMatch: options?.ifNoneMatch });
      door.drafts.set(name, { body: JSON.parse(JSON.stringify(body)), version: 'hmac-sha256:receipt' });
      return { success: true, version: 'hmac-sha256:receipt', state: 'draft' };
    },
  ),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { ObjectHooksPanel } from './ObjectHooksPanel';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

registerBuiltinInspectors();

/** The pending draft of `guard_hook`: its published row plus a change nobody here may read. */
const GATED_GUARD = { ...guard, label: 'Guard (draft)', condition: "record.status == 'held'" };

beforeEach(() => {
  door.drafts.clear();
  door.gated.clear();
  door.sent.length = 0;
  for (const fn of [mockClient.list, mockClient.listDrafts, mockClient.getDraft, mockClient.save]) fn.mockClear();
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
  __setCelFormulaLoader(undefined);
});

const AUTOSAVE = { timeout: 4000 };

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

function openPanel() {
  render(<ObjectHooksPanel objectName="invoice" packageId={PKG} />);
}

describe('ObjectHooksPanel — a hook draft the server refuses to read is not "no draft" (objectstack#29148)', () => {
  it('the refused hook opens no buffer: the strip says why, nothing is editable, and no save is sent', async () => {
    door.drafts.set('guard_hook', { body: GATED_GUARD, version: 'hmac-sha256:pending' });
    door.gated.add('guard_hook');
    openPanel();

    // The hook stays listed by its published row.
    fireEvent.click(await screen.findByText('Guard', undefined, { timeout: 8000 }));
    // Red on base: the refusal was read as "no draft", and the published row
    // was installed as the buffer and handed to the inspector to edit.
    const strip = await screen.findByTestId('hooks-draft-unreadable');
    expect(strip).toHaveTextContent(t('engine.studio.refusal.draftUnreadable', 'en-US'));
    // The server's own sentence stays reachable, behind Details.
    expect(strip.querySelector('details')).toHaveTextContent(GATE_REFUSAL);
    expect(screen.queryByText('Expression')).toBeNull();
    expect(mockClient.getDraft).toHaveBeenCalledWith('hook', 'guard_hook', { packageId: PKG });

    await pastTheAutosave();
    expect(door.sent).toEqual([]);
    expect(door.drafts.get('guard_hook')?.body).toStrictEqual(GATED_GUARD);
  });

  it('a partial refusal holds only the refused hook: another hook opens, and its edit saves pinned to "no draft row"', async () => {
    door.drafts.set('guard_hook', { body: GATED_GUARD, version: 'hmac-sha256:pending' });
    door.gated.add('guard_hook');
    openPanel();

    fireEvent.click(await screen.findByText('Audit', undefined, { timeout: 8000 }));
    fireEvent.click(await screen.findByText('Expression'));
    expect(screen.queryByTestId('hooks-draft-unreadable')).toBeNull();
    const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "record.status == 'closed'" } });
    await waitFor(() => expect(door.sent).toHaveLength(1), AUTOSAVE);
    expect(door.sent[0]).toEqual({ name: 'audit_hook', ifMatch: undefined, ifNoneMatch: '*' });
    // The refused one is still held.
    expect(door.drafts.get('guard_hook')?.body).toStrictEqual(GATED_GUARD);
  });

  it('CONTROL: with no pending draft the published hook opens, and an edit saves pinned to "no draft row"', async () => {
    openPanel();

    fireEvent.click(await screen.findByText('Guard', undefined, { timeout: 8000 }));
    fireEvent.click(await screen.findByText('Expression'));
    expect(screen.queryByTestId('hooks-draft-unreadable')).toBeNull();
    const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(door.sent).toHaveLength(1), AUTOSAVE);
    expect(door.sent[0]).toEqual({ name: 'guard_hook', ifMatch: undefined, ifNoneMatch: '*' });
  });
});
