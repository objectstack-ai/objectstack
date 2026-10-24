// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13333 — the history timeline's Rollback is asked in the console's
 * in-app AlertDialog, whose title names the item and the version, never
 * through the browser's native `confirm()`.
 *
 * Also the grep pin the card's "Done when" names: no native `confirm()` call
 * is left in the four Setup metadata surfaces this card covers. Comments are
 * masked first, so a comment that names `confirm()` is not a call.
 */

import * as React from 'react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';
import { HistoryPanel } from './ResourceHistoryPage';

const mask: (source: string) => string = maskComments;
const here = path.dirname(fileURLToPath(import.meta.url));

function fakeClient() {
  return {
    history: vi.fn(async () => ({
      events: [
        { seq: 2, op: 'update', version: 2, actor: 'ada' },
        { seq: 1, op: 'create', version: 1, actor: 'ada' },
      ],
    })),
    rollback: vi.fn(async () => ({ success: true })),
  };
}

const nativeConfirm = vi.fn(() => true);
beforeEach(() => {
  nativeConfirm.mockClear();
  vi.stubGlobal('confirm', nativeConfirm);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openRollback(client: ReturnType<typeof fakeClient>, onRollback = vi.fn()) {
  render(
    <HistoryPanel
      type="object"
      name="showcase_account"
      client={client as never}
      locale="en-US"
      onRollback={onRollback}
      rollbackLabel="Rollback to this version"
      rollbackConfirm={(v) => `Restore version ${v}? Custom body.`}
    />,
  );
  const buttons = await screen.findAllByTitle('Rollback to this version');
  // Newest first: the second button is version 1.
  fireEvent.click(buttons[1]!);
  return await screen.findByRole('alertdialog');
}

describe('HistoryPanel — Rollback is confirmed in-app and names the item (objectui#13333)', () => {
  it('the title names the item and the version, the body is the host copy; accepting rolls back once', async () => {
    const client = fakeClient();
    const onRollback = vi.fn();
    const dialog = await openRollback(client, onRollback);
    expect(within(dialog).getByRole('heading').textContent).toBe(
      'Restore object/showcase_account to version 1?',
    );
    expect(dialog.textContent).toContain('Restore version 1? Custom body.');
    expect(client.rollback).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('history-rollback-confirm-action'));
    await waitFor(() => expect(client.rollback).toHaveBeenCalledWith('object', 'showcase_account', 1));
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith(1));
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('CONTROL: Cancel rolls nothing back', async () => {
    const client = fakeClient();
    const dialog = await openRollback(client);
    fireEvent.click(within(dialog).getByTestId('history-rollback-confirm-cancel'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(client.rollback).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});

describe('Setup metadata surfaces call no native confirm() (objectui#13333)', () => {
  const FILES = [
    'ResourceEditPage.tsx',
    'MetadataTypeActions.tsx',
    'ResourceHistoryPage.tsx',
    'datasource/DatasourceResourcePage.tsx',
  ];
  // A call of the global: bare `confirm(`, or `window.` / `globalThis.` before
  // it. A member call such as `recordDelete.confirm(` is not the global.
  const NATIVE_CONFIRM = /(?:^|[^.\w$])(?:window\.|globalThis\.)?confirm\s*\(/;

  it.each(FILES)('%s', (file) => {
    const source = mask(readFileSync(path.join(here, file), 'utf8'));
    expect(source.length).toBeGreaterThan(0);
    const hits = source.split('\n').filter((line) => NATIVE_CONFIRM.test(line));
    expect(hits).toEqual([]);
  });

  it('CONTROL: the pattern does see a native confirm call', () => {
    expect(NATIVE_CONFIRM.test("if (!window.confirm('x')) return;")).toBe(true);
    expect(NATIVE_CONFIRM.test("if (!confirm('x')) return;")).toBe(true);
    expect(NATIVE_CONFIRM.test('recordDelete.confirm(x)')).toBe(false);
  });
});
