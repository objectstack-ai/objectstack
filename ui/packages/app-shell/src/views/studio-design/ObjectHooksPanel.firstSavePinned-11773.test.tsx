// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — a hook's first draft save after the panel's load is pinned
 * to what that load read for it.
 *
 * The panel installs its buffer from a LIST, not from one item read: the
 * package's published hooks plus each draft this package's drafts ledger
 * lists. So the list load records one pin per hook (`recordRead`):
 *
 *  - a hook with a pending draft: the `version` its draft read served, read at
 *    the package the save writes;
 *  - a hook the ledger does not list: "no draft row", `If-None-Match: *`;
 *  - an unreadable ledger says nothing, and pins nothing (the save goes
 *    unpinned, as before).
 *
 * The door double answers as the published 18.0.0-next.0 door was measured to
 * (readings on the pull request); the guard keeps each hook's own pin, so a
 * hook saved, left and re-opened is still pinned to its last receipt.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const PKG = 'com.example.showcase';
const guard = { name: 'guard_hook', label: 'Guard', object: 'invoice', events: ['beforeInsert'], handler: 'guard_fn' };
const audit = { name: 'audit_hook', label: 'Audit', object: 'invoice', events: ['afterInsert'], handler: 'audit_fn' };

interface Sent {
  name: string;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
}

const door = {
  drafts: new Map<string, { body: Record<string, unknown>; version: string }>(),
  ledgerFails: false,
  sent: [] as Sent[],
  seq: 0,
};

const mockClient = {
  list: vi.fn(async () => [guard, audit]),
  listDrafts: vi.fn(async () => {
    if (door.ledgerFails) throw new Error('403 drafts ledger');
    return [...door.drafts.keys()].map((name) => ({ type: 'hook', name }));
  }),
  getDraft: vi.fn(async (_type: string, name: string, _options?: { packageId?: string }) => {
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
      door.seq += 1;
      const version = `hmac-sha256:v${door.seq}`;
      door.drafts.set(name, { body: JSON.parse(JSON.stringify(body)), version });
      return { success: true, version, seq: door.seq, state: 'draft' };
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

beforeEach(() => {
  door.drafts.clear();
  door.ledgerFails = false;
  door.sent.length = 0;
  door.seq = 0;
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

/** Open a hook by its label and send one edit through the autosave. */
async function editAndSave(label: string, condition: string): Promise<Sent> {
  fireEvent.click(await screen.findByText(label));
  fireEvent.click(await screen.findByText('Expression'));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  const before = door.sent.length;
  fireEvent.change(box, { target: { value: condition } });
  await waitFor(() => expect(door.sent.length).toBe(before + 1), AUTOSAVE);
  await waitFor(() => expect(screen.getByTestId('hooks-saved-at')).toBeInTheDocument());
  return door.sent[door.sent.length - 1]!;
}

function openPanel() {
  render(<ObjectHooksPanel objectName="invoice" packageId={PKG} />);
}

describe('ObjectHooksPanel — the first save after the list load is pinned (objectui#11773)', () => {
  it('a published hook this package holds no draft of: the first save sends If-None-Match: *', async () => {
    openPanel();
    const first = await editAndSave('Guard', "record.status == 'open'");
    expect(first).toEqual({ name: 'guard_hook', ifMatch: undefined, ifNoneMatch: '*' });
  });

  it('a hook with a pending draft: the first save sends If-Match with the version its draft read served', async () => {
    door.drafts.set('guard_hook', { body: { ...guard, label: 'Guard' }, version: 'hmac-sha256:pending' });
    openPanel();
    const first = await editAndSave('Guard', "record.status == 'open'");
    expect(first).toEqual({ name: 'guard_hook', ifMatch: 'hmac-sha256:pending', ifNoneMatch: undefined });
    // Read at the package the save writes.
    expect(mockClient.getDraft).toHaveBeenCalledWith('hook', 'guard_hook', { packageId: PKG });
  });

  it('each hook keeps its own pin: a hook saved, left and re-opened is pinned to its last receipt', async () => {
    openPanel();
    const g1 = await editAndSave('Guard', "record.status == 'open'");
    const a1 = await editAndSave('Audit', "record.status == 'closed'");
    const g2 = await editAndSave('Guard', "record.status == 'void'");
    expect([g1, a1, g2]).toEqual([
      { name: 'guard_hook', ifMatch: undefined, ifNoneMatch: '*' },
      { name: 'audit_hook', ifMatch: undefined, ifNoneMatch: '*' },
      { name: 'guard_hook', ifMatch: 'hmac-sha256:v1', ifNoneMatch: undefined },
    ]);
  });

  it('control: an unreadable drafts ledger pins nothing, and the first save goes unpinned as before', async () => {
    door.ledgerFails = true;
    openPanel();
    const first = await editAndSave('Guard', "record.status == 'open'");
    expect(first).toEqual({ name: 'guard_hook', ifMatch: undefined, ifNoneMatch: undefined });
  });

  it('a new hook is created with the first-write pin', async () => {
    openPanel();
    await screen.findByText('Guard');
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    await waitFor(() => expect(door.sent).toHaveLength(1));
    expect(door.sent[0]).toMatchObject({ ifMatch: undefined, ifNoneMatch: '*' });
  });
});
