// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36648 — an edit made right after a Save is the author's, even
 * when it lands before the Save's re-read.
 *
 * A Save's publish sends the live-metadata pulse; the Data pillar holds it
 * while the object's buffer carries work (`useMetadataRefreshNonce(hold)`) and
 * releases it the moment the Save ends, and the release re-reads the object.
 * A keystroke between that release and the re-read's effect used to be
 * dropped: the effect cleared the dirty flag as it started, the read then saw
 * nothing held and installed the server's body over the edit, and the top
 * bar's Save was gone with the edit (the merge-queue red of
 * `DataPillar.panelGate`'s first case, which types into exactly that window
 * on a loaded runner).
 *
 * The window is a scheduler gap, too narrow to hit on purpose with real
 * timing, so the hook is wrapped to report its release and the case types in
 * the microtask right after it: before the re-read's effect, deterministically.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'status', label: 'Status', type: 'text' }],
  validations: [
    {
      type: 'script',
      name: 'rule_a',
      label: 'Rule A',
      message: 'nope',
      severity: 'error',
      active: true,
    },
  ],
};

const mockClient = {
  publish: vi.fn(async () => ({})), reset: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// The advanced tabs live in a Radix DropdownMenu; rendered as passthroughs, as
// in DataPillar.panelGate.test.tsx.
type PassthroughProps = { children?: React.ReactNode; onSelect?: () => void };
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...mod,
    DropdownMenu: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuTrigger: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuContent: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
    DropdownMenuRadioGroup: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuRadioItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

/** What runs in the microtask right after the next pulse release, once. */
const onRelease: { next: (() => void) | null } = { next: null };

// The real hook, word for word, plus the report of its release.
vi.mock('./useMetadataRefreshNonce', async () => {
  const { useEffect, useState } = await import('react');
  const { subscribeMetadataRefresh } = await import('../../assistant/assistantBus.js');
  return {
    useMetadataRefreshNonce(hold = false): number {
      const [received, setReceived] = useState(0);
      const [released, setReleased] = useState(0);
      useEffect(() => subscribeMetadataRefresh(() => setReceived((n) => n + 1)), []);
      useEffect(() => {
        if (hold) return;
        setReleased((cur) => (cur === received ? cur : received));
        if (released !== received && onRelease.next) {
          const run = onRelease.next;
          onRelease.next = null;
          queueMicrotask(run);
        }
      }, [hold, received, released]);
      return released;
    },
  };
});

// The source reaches a dynamic import of it: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';
import * as React from 'react';
import { DataPillar } from './StudioDesignSurface';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerBuiltinInspectors();

const DANGLING = /[*+\-/&|=<>]\s*$/;

beforeEach(() => {
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
});
afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  onRelease.next = null;
  mockClient.save.mockClear();
});

async function openRuleGuard(): Promise<HTMLTextAreaElement> {
  render(
    <StudioSaveHarness><MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter></StudioSaveHarness>,
  );
  fireEvent.click(await screen.findByTestId('data-tab-flat-rules'));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

/** Save the guard `first`, and type `next` the moment the Save's pulse is released. */
async function saveThenTypeAtRelease(box: HTMLTextAreaElement, first: string, next: string): Promise<void> {
  fireEvent.change(box, { target: { value: first } });
  let typed = false;
  onRelease.next = () => {
    typed = true;
    fireEvent.change(box, { target: { value: next } });
  };
  await pressStudioSave();
  await waitFor(() => expect(typed).toBe(true), { timeout: 4000 });
  expect(mockClient.save).toHaveBeenCalledTimes(1);
  mockClient.save.mockClear();
}

describe('DataPillar — an edit made as a Save ends survives its re-read (objectstack#36648)', () => {
  it('keeps a guard typed before the re-read, and its Save sends it', async () => {
    const box = await openRuleGuard();
    await saveThenTypeAtRelease(box, "record.status == 'open'", "record.status == 'closed'");

    // The edit is still on the page, and the top bar still offers its Save.
    expect(box).toBeInTheDocument();
    expect(box.value).toBe("record.status == 'closed'");
    await pressStudioSave();
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(JSON.stringify(mockClient.save.mock.calls[0])).toContain("record.status == 'closed'");
  });

  it('keeps a guard that does not parse held, not dropped', async () => {
    const box = await openRuleGuard();
    await saveThenTypeAtRelease(box, "record.status == 'open'", 'record.status ==');

    expect(box).toBeInTheDocument();
    expect(box.value).toBe('record.status ==');
    await pressStudioSave();
    expect(mockClient.save).not.toHaveBeenCalled();
  });
});
