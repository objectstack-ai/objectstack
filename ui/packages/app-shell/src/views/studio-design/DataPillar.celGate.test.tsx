// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Save draft" must refuse a formula that does not parse — objectui#4306.
 *
 * This is the card's literal repro, end to end in the host that owns the
 * button: metadata designer, Data pillar, a formula field, `record.est_hours *`
 * in the formula box. Before the fix that button stayed enabled, the PUT
 * returned 200 with a success toast, and publishing made the malformed
 * expression the live field definition.
 *
 * The inspector-side aggregation is pinned in
 * {@link file://../metadata-admin/inspectors/ObjectFieldInspector.celGate.test.tsx};
 * what this suite adds is the half that only the HOST can prove:
 *
 *  - the count actually reaches the button and disables it, with the same
 *    message the RLS editor already shows;
 *  - the host RESETS its own count when the selection changes or the inspector
 *    unmounts (ruling sub-decision A) — writability must never depend on a
 *    child's teardown running, or closing the panel on a faulty formula leaves
 *    Save wedged shut with no editor on screen to fix it.
 *
 * The engine is stubbed so the verdict is deterministic; the live lint is
 * CelPredicateField.test.tsx's job.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'est_hours', label: 'Est hours', type: 'number' },
    { name: 'total', label: 'Total', type: 'formula' },
  ],
};

const mockClient = {
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


// objectui#5813 — the advanced tabs live in a Radix DropdownMenu; these suites
// measure the CEL gate, not radix's open/close machinery, so the menu renders
// as plain passthroughs (same convention as AppSwitcher.publishState.test.tsx).
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...mod,
    DropdownMenu: (p: any) => <div>{p.children}</div>,
    DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
    DropdownMenuContent: (p: any) => <div>{p.children}</div>,
    DropdownMenuItem: (p: any) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
    // objectui#11794 — the Advanced items are radio items (the menu checks the open panel).
    DropdownMenuRadioGroup: (p: any) => <div>{p.children}</div>,
    DropdownMenuRadioItem: (p: any) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
  };
});

// objectui#8620: the records grid calls `find()` on this adapter. `{}` had no
// `find()`, so `ListView`'s fetch threw and its `catch` swallowed the error.
// `dataSource` is an empty-backend `DataSource`, created once below the imports
// so every render gets the same object.
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The right rail resolves the field inspector through the registry.
registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  mockClient.save.mockClear();
});

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
      introspectScope: () => ({ fields: ['est_hours'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'number' as const,
    }),
  );
}


/** Open the Data pillar's form tab and select the formula field. */
async function openFormulaField() {
  stubEngine();
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  const card = (await screen.findByText('Total')).closest('.cursor-grab') as HTMLElement;
  fireEvent.click(card);
  const label = await screen.findByText('Formula (CEL)');
  return label.parentElement!.querySelector('[role="combobox"]') as HTMLTextAreaElement;
}

// objectui#5813 retired the 保存草稿 button for debounced AUTO-save; the CEL
// gate now guards the TIMER (the objectui#4306 rule verbatim: gating only a
// button would let the timer persist the malformed definition a second later).
// The observable is therefore client.save itself.
describe('DataPillar — auto-save is gated on the field inspector’s CEL verdict (#4306/#5813)', () => {
  it("refuses the card's repro: a dangling operator blocks the auto-save", async () => {
    const box = await openFormulaField();

    // A valid formula first: the auto-save fires — pins the must-not-change
    // half (a good formula never blocks) and clears the dirty window.
    fireEvent.change(box, { target: { value: 'record.est_hours * 2' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
    mockClient.save.mockClear();

    // Now the card's exact input: well past the debounce, still no save.
    fireEvent.change(box, { target: { value: 'record.est_hours *' } });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('re-arms the auto-save once the formula parses again', async () => {
    const box = await openFormulaField();

    fireEvent.change(box, { target: { value: 'record.est_hours *' } });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: 'record.est_hours * 2' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
  });

  /**
   * Sub-decision A. Closing the panel unmounts the inspector, so nothing will
   * ever report `0` for it — the host must drop the count on its own, or the
   * dirty draft stays wedged UNSAVED forever with no editor on screen to fix.
   */
  it('drops the count when the inspector closes, so the draft cannot wedge unsaved', async () => {
    const box = await openFormulaField();

    fireEvent.change(box, { target: { value: 'record.est_hours *' } });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();

    // Two "Close" buttons dismiss the panel — the rail header's and the
    // inspector shell's own; either clears the selection (and the block).
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByText('Formula (CEL)')).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
  });
});
