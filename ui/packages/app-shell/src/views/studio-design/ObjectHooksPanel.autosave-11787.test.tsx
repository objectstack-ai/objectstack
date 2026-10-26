// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11787 — a hook autosaves to its draft like the other Studio
 * editors, and its saves reach the surface's pending-changes count.
 *
 * The *Save hook* button was the third save model in Studio (beside the
 * pillars' autosave and the permission matrix's Save). The panel now runs the
 * shared autosave: an edit is sent 1.5s after the last change, a save that
 * lands reports to the surface (`onDraftSaved`) so the header's count
 * refreshes, and an edit taken while a save is in flight is kept and sent next
 * (the objectui#11204 rule every pillar keeps). A hook keeps the name it was
 * created with: the inspector commits the name on every keystroke and the draft
 * is stored under it, so a rename is held rather than staged as one more hook
 * per pause while typing. The held half — a blocking CEL
 * verdict holds the autosave — is pinned beside it in
 * `ObjectHooksPanel.celGate.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const hook = {
  name: 'guard_hook',
  label: 'Guard',
  object: 'invoice',
  events: ['beforeInsert'],
  handler: 'guard_fn',
};

/** Bodies the panel sent, copied at the moment of the call. */
const sent: Array<Record<string, unknown>> = [];
/** When set, the first save waits on it: a save held in flight. */
let holdFirstSave: Promise<void> | null = null;

const mockClient = {
  list: vi.fn(async () => [hook]),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
  save: vi.fn(async (_type: string, _name: string, body: Record<string, unknown>) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    if (sent.length === 1 && holdFirstSave) await holdFirstSave;
    return {};
  }),
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
  sent.length = 0;
  holdFirstSave = null;
  mockClient.save.mockClear();
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
const pause = (ms: number) => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

async function openGuard(onDraftSaved?: () => void) {
  render(<ObjectHooksPanel objectName="invoice" packageId="com.example.showcase" onDraftSaved={onDraftSaved} />);
  fireEvent.click(await screen.findByText('Guard'));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

describe('ObjectHooksPanel — a hook autosaves to its draft (objectui#11787)', () => {
  it('sends an edit after the pause, with no Save hook button, and tells the surface', async () => {
    const onDraftSaved = vi.fn();
    const box = await openGuard(onDraftSaved);
    expect(screen.queryByRole('button', { name: /Save/i })).toBeNull();

    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    // Debounced, not per keystroke.
    expect(mockClient.save).not.toHaveBeenCalled();

    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), AUTOSAVE);
    expect(mockClient.save).toHaveBeenCalledWith(
      'hook',
      'guard_hook',
      expect.objectContaining({ object: 'invoice', handler: 'guard_fn' }),
      expect.objectContaining({ mode: 'draft', packageId: 'com.example.showcase' }),
    );
    await waitFor(() => expect(onDraftSaved).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('hooks-saved-at')).toBeInTheDocument();
  });

  it('"+ New" is a draft save too: the surface hears of it', async () => {
    const onDraftSaved = vi.fn();
    render(<ObjectHooksPanel objectName="invoice" packageId="com.example.showcase" onDraftSaved={onDraftSaved} />);
    await screen.findByText('Guard');

    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDraftSaved).toHaveBeenCalledTimes(1));
  });

  it('holds a rename typed with a pause between its parts, and saves once the name is back', async () => {
    render(<ObjectHooksPanel objectName="invoice" packageId="com.example.showcase" />);
    fireEvent.click(await screen.findByText('Guard'));
    const name = () => screen.getByTestId('hook-name') as HTMLInputElement;
    await screen.findByTestId('hook-name');
    expect(name().value).toBe('guard_hook');

    // Typed in two parts, with a pause longer than the autosave's between them.
    fireEvent.change(name(), { target: { value: 'audit' } });
    await pause(1600);
    fireEvent.change(name(), { target: { value: 'audit_trail' } });
    await pause(2300);

    // No draft staged under either typed name: the probe on the head before
    // this pin measured two, `hook/audit` and `hook/audit_trail`.
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('hooks-rename-held')).toHaveTextContent('guard_hook');

    // CONTROL: the same edit path saves once the hook has its own name again,
    // under that name.
    fireEvent.change(name(), { target: { value: 'guard_hook' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), AUTOSAVE);
    expect(mockClient.save.mock.calls[0][1]).toBe('guard_hook');
    expect(screen.queryByTestId('hooks-rename-held')).toBeNull();
  });

  it('keeps an edit taken while the autosave is in flight, and sends it next (objectui#11204)', async () => {
    let release!: () => void;
    holdFirstSave = new Promise<void>((resolve) => {
      release = resolve;
    });
    const box = await openGuard();

    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(sent).toHaveLength(1), AUTOSAVE);
    expect(await screen.findByTestId('hooks-autosaving')).toBeInTheDocument();

    // A second edit while the first save is on the wire.
    fireEvent.change(box, { target: { value: "record.status == 'closed'" } });
    release();

    // The landed save does not put its own body back over the newer edit…
    await waitFor(() => expect(screen.queryByTestId('hooks-autosaving')).toBeNull());
    expect(box).toHaveValue("record.status == 'closed'");
    // …and the edit, still unsent, goes out next.
    await waitFor(() => expect(sent).toHaveLength(2), AUTOSAVE);
    expect(JSON.stringify(sent[0])).toContain("record.status == 'open'");
    expect(JSON.stringify(sent[1])).toContain("record.status == 'closed'");
  });
});
