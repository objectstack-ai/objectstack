/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The scan button on text and lookup fields, offered by the ObjectStack
 * mobile shell's `scan()` bridge method (objectstack-ai/mobile
 * `docs/HYBRID-SHELL.md`, "Scanning codes").
 *
 * The stub below is `window.ObjectStackNative` with the members the fields
 * read. The control cases are the ones a desktop browser and an older shell
 * take: no global at all, and a global whose `has('scan')` says no. Both must
 * render no button.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from '@object-ui/components';
import { TextField } from './TextField';
import { LookupField } from './LookupField';

const GLOBAL = 'ObjectStackNative';

type ScanAnswer = string | null | Error;

function installShell(opts: { capabilities?: string[]; answer?: ScanAnswer } = {}) {
  const capabilities = opts.capabilities ?? ['haptic', 'scan'];
  const scan = vi.fn(async () => {
    const answer = opts.answer === undefined ? 'ASSET-0042' : opts.answer;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  (window as unknown as Record<string, unknown>)[GLOBAL] = {
    version: 1,
    platform: 'ios',
    appVersion: '2.1.0',
    capabilities,
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    has: (c: string) => capabilities.includes(c),
    haptic: vi.fn(async () => null),
    scan,
    ready: vi.fn(),
    routeChanged: vi.fn(),
  };
  return scan;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>)[GLOBAL];
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

const scanButton = () => screen.queryByRole('button', { name: 'Scan code' });

async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}

async function tapScan(): Promise<void> {
  await act(async () => {
    fireEvent.click(scanButton()!);
  });
  await settle();
}

function renderText(props: Record<string, unknown> = {}, field: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(
    <TextField
      value=""
      onChange={onChange}
      field={{ name: 'asset_tag', type: 'text', ...field } as never}
      {...props}
    />,
  );
  return onChange;
}

describe('text field scan button', () => {
  it('control: a plain browser (no shell global) renders no scan button', () => {
    renderText();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(scanButton()).toBeNull();
  });

  it("control: an older shell whose has('scan') is false renders no scan button", () => {
    const scan = installShell({ capabilities: ['haptic'] });
    renderText();
    expect(scanButton()).toBeNull();
    expect(scan).not.toHaveBeenCalled();
  });

  it("a shell with has('scan') renders the button on an editable text field", () => {
    installShell();
    renderText();
    expect(scanButton()).toBeInTheDocument();
  });

  it('a read-only, a disabled and a password field render no scan button', () => {
    installShell();
    renderText({ readonly: true });
    expect(scanButton()).toBeNull();
    cleanup();
    renderText({ disabled: true });
    expect(scanButton()).toBeNull();
    cleanup();
    renderText({}, { type: 'password' });
    expect(scanButton()).toBeNull();
  });

  it('the decoded value lands through onChange', async () => {
    const scan = installShell({ answer: 'ASSET-0042' });
    const onChange = renderText();
    await tapScan();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ASSET-0042');
  });

  it('null (the user closed the scanner) changes nothing and shows no toast', async () => {
    const error = vi.spyOn(toast, 'error');
    const scan = installShell({ answer: null });
    const onChange = renderText();
    await tapScan();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("a failed scan raises the error toast with the shell's message and changes nothing", async () => {
    const error = vi.spyOn(toast, 'error');
    installShell({ answer: Object.assign(new Error('Camera permission denied'), { code: 'failed' }) });
    const onChange = renderText();
    await tapScan();
    expect(onChange).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Could not scan', { description: 'Camera permission denied' });
  });
});

const ROWS: Record<string, unknown>[] = [
  { id: 'a1', name: 'ASSET-0042 Forklift' },
  { id: 'a2', name: 'ASSET-0077 Pallet jack' },
  { id: 'a3', name: 'ASSET-0099 Scissor lift' },
];

function makeBackend() {
  const find = vi.fn(async (_objectName: string, params?: { $search?: string; $filter?: { id?: { $in?: unknown[] } } }) => {
    const wanted = params?.$filter?.id?.$in;
    if (wanted) {
      const rows = ROWS.filter((r) => wanted.includes(r.id));
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }
    const term = params?.$search;
    const rows = term ? ROWS.filter((r) => String(r.name).includes(term)) : ROWS;
    return { data: rows.map((r) => ({ ...r })), total: rows.length };
  });
  const findOne = vi.fn(async (_o: string, id: string) => ROWS.find((r) => r.id === id) ?? null);
  return { find, findOne };
}

function renderLookup(ds: ReturnType<typeof makeBackend>, field: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  render(
    <LookupField
      value={null}
      onChange={() => {}}
      dataSource={ds as never}
      field={{ name: 'asset', reference: 'asset', label: 'Asset', ...field } as never}
      {...props}
    />,
  );
}

const searchedTerms = (ds: ReturnType<typeof makeBackend>) =>
  ds.find.mock.calls.map((c) => c[1]?.$search).filter(Boolean);

describe('lookup field scan button', () => {
  it('control: a plain browser renders no scan button on a lookup', async () => {
    const ds = makeBackend();
    renderLookup(ds);
    await settle();
    expect(screen.getByTestId('lookup-trigger-asset')).toBeInTheDocument();
    expect(scanButton()).toBeNull();
  });

  it("control: an older shell whose has('scan') is false renders no scan button on a lookup", async () => {
    installShell({ capabilities: ['haptic'] });
    const ds = makeBackend();
    renderLookup(ds);
    await settle();
    expect(scanButton()).toBeNull();
  });

  it('a disabled lookup renders no scan button', async () => {
    installShell();
    const ds = makeBackend();
    renderLookup(ds, {}, { disabled: true });
    await settle();
    expect(scanButton()).toBeNull();
  });

  it('the decoded value opens the dropdown and drives its search', async () => {
    installShell({ answer: 'ASSET-0042' });
    const ds = makeBackend();
    renderLookup(ds);
    await settle();
    await tapScan();
    expect(screen.getByRole('combobox')).toHaveValue('ASSET-0042');
    await settle(70);
    await waitFor(() => expect(searchedTerms(ds)).toContain('ASSET-0042'));
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.getAttribute('title'))).toEqual(['ASSET-0042 Forklift']));
  });

  it('null leaves a lookup closed and unsearched', async () => {
    installShell({ answer: null });
    const ds = makeBackend();
    renderLookup(ds);
    await settle();
    await tapScan();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(searchedTerms(ds)).toEqual([]);
  });

  it("the search-first variant opens its picker seeded with the decoded value", async () => {
    installShell({ answer: 'ASSET-0077' });
    const ds = makeBackend();
    renderLookup(ds, { picker: 'search' });
    await settle();
    await tapScan();
    const box = await screen.findByTestId('people-picker-search');
    expect(box).toHaveValue('ASSET-0077');
    await settle(70);
    await waitFor(() => expect(searchedTerms(ds)).toContain('ASSET-0077'));
  });
});
