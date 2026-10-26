// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object hooks panel owns its OWN per-hook save (it writes the hook
 * directly with `client.save('hook', …, { mode: 'draft' })` — the object's
 * draft does not cover hooks), so it must refuse to write a guard whose CEL
 * does not parse — objectui#4527 phase 2.
 *
 * Of the four panel hosts the #4547 census surfaced, this is the only one that
 * owns its save; the other three write through the Data pillar's draft and
 * report upward instead. So this suite is the end-to-end proof for the hook
 * branch of the default-inspector family: HookDefaultInspector's verdict has to
 * reach the save itself, not just a callback.
 *
 * objectui#11787 — that save is now the panel's autosave (the shared one every
 * Studio editor runs), so the verdict HOLDS it: a malformed guard is never
 * sent, however long the pause, and the panel says why. Each absence is read
 * against the same harness sending the same hook once the guard parses.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const hook = {
  name: 'guard_hook',
  label: 'Guard',
  object: 'invoice',
  events: ['beforeInsert'],
  handler: 'guard_fn',
};

const mockClient = {
  list: vi.fn(async () => [hook]),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async () => null),
  // The curated hook editor resolves the bound object's field catalog through
  // `useObjectFields` -> `client.withPreviewDrafts(true).get`.
  get: vi.fn(async () => null),
  withPreviewDrafts() { return this; },
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { ObjectHooksPanel } from './ObjectHooksPanel';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

// The panel resolves the curated hook editor through the default registry.
registerBuiltinInspectors();

const DANGLING = /[*+\-/&|=<>]\s*$/;

function stubEngine() {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: (_role: string, input: unknown) => {
        const src = typeof input === 'string' ? input : String((input as { source?: string })?.source ?? '');
        return DANGLING.test(src)
          ? { ok: false, errors: [{ message: 'Parse error: expression ends after an operator' }], warnings: [] }
          : { ok: true, errors: [], warnings: [] };
      },
      introspectScope: () => ({ fields: ['status'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

beforeEach(stubEngine);
afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

/** Longer than the shared autosave's pause (1.5s). */
const PAST_THE_PAUSE = 2200;
const AUTOSAVE = { timeout: 4000 };
const pause = () => new Promise((resolve) => setTimeout(resolve, PAST_THE_PAUSE));

/** Open the panel, select the hook, and switch its guard into raw CEL mode. */
async function openGuard() {
  render(<ObjectHooksPanel objectName="invoice" packageId="com.example.showcase" />);
  fireEvent.click(await screen.findByText('Guard'));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

describe('ObjectHooksPanel — its autosave holds a guard that does not parse (#4527, objectui#11787)', () => {
  beforeEach(() => mockClient.save.mockClear());

  it('holds the malformed hook, and says why', async () => {
    const box = await openGuard();
    // No Save button: the panel autosaves.
    expect(screen.queryByRole('button', { name: /Save/i })).toBeNull();

    fireEvent.change(box, { target: { value: 'record.status ==' } });
    expect(await screen.findByTestId('hooks-autosave-held', undefined, AUTOSAVE)).toBeInTheDocument();
    await pause();
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('sends the hook once the guard parses again', async () => {
    const box = await openGuard();

    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await screen.findByTestId('hooks-autosave-held', undefined, AUTOSAVE);

    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), AUTOSAVE);
    expect(mockClient.save).toHaveBeenCalledWith(
      'hook',
      'guard_hook',
      expect.objectContaining({ object: 'invoice' }),
      expect.objectContaining({ mode: 'draft', packageId: 'com.example.showcase' }),
    );
    expect(screen.queryByTestId('hooks-autosave-held')).toBeNull();
  });

  it('CONTROL — a good guard is sent after the pause, never held', async () => {
    const box = await openGuard();
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), AUTOSAVE);
    expect(screen.queryByTestId('hooks-autosave-held')).toBeNull();
  });
});
