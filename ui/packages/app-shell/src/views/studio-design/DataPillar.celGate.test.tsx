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
 *  - objectstack#27485 — the verdict belongs to the DRAFT, not to the
 *    selection: closing the inspector (Close, Escape, another field, another
 *    tab) keeps the hold while the draft still carries the text it judged, and
 *    a switch to another object asks before it drops the held edit. The
 *    maintainer's ruling on #27485 (comment 6500685972, 2026-10-29T15:17Z)
 *    replaced sub-decision A's reset-on-close mechanism with this hold; the
 *    objectui#4306 ruling's sub-decision A stands as its two invariants:
 *    writability never depends on a child's teardown running (the kept verdict
 *    is read off the draft, and an edit, the field's removal or a load ends
 *    it), and Save is never wedged with nothing on screen to fix (the held line
 *    names the field, and its "Show me" reopens the editor).
 *
 * The engine is stubbed so the verdict is deterministic; the live lint is
 * CelPredicateField.test.tsx's job.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const siteDef = { name: 'showcase_site', label: 'Site', fields: [{ name: 'address', label: 'Address', type: 'text' }] };

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async () => [
    { name: 'showcase_task', label: 'Task' },
    { name: 'showcase_site', label: 'Site' },
  ]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, name: string) =>
    name === 'showcase_site' ? { effective: siteDef, code: siteDef } : { effective: objectDef, code: objectDef },
  ),
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

// This environment ships no window.confirm: the pillar's discard question.
let confirmSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  confirmSpy = vi.fn(() => false);
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

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
});

/**
 * objectstack#27485, the switch arm — shared with objectstack#27511's
 * flush-or-ask switch: an edit the CEL verdict holds cannot be sent, so a
 * switch to another object asks before its load replaces the buffer.
 */
describe('DataPillar — a switch to another object over a held formula (objectstack#27485)', () => {
  it('asks; declined, the edit stays; agreed, it is dropped unsent', async () => {
    const box = await openFormulaField();
    fireEvent.change(box, { target: { value: 'record.est_hours *' } });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Site/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(box.value).toBe('record.est_hours *');

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Site/ }));
    await waitFor(() => expect(screen.queryByText('Est hours')).toBeNull(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();
  });
});

/** The ways the field inspector closes (the card's step 4). */
const CLOSERS: Array<[string, () => void]> = [
  ['its Close button', () => fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])],
  ['Escape', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
  ['another field card', () => fireEvent.click((screen.getByText('Est hours').closest('.cursor-grab') as HTMLElement))],
  ['the Records tab', () => fireEvent.click(screen.getByRole('button', { name: 'Records' }))],
];

describe('DataPillar — the CEL hold belongs to the draft, not to the open inspector (objectstack#27485)', () => {
  async function breakFormula(): Promise<HTMLTextAreaElement> {
    const box = await openFormulaField();
    fireEvent.change(box, { target: { value: 'record.est_hours *' } });
    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Total'), { timeout: 3000 });
    return box;
  }

  it.each(CLOSERS)('closing the inspector by %s keeps the hold, and the held line names the field', async (_how, close) => {
    await breakFormula();
    close();
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Total');
  });

  it('"Show me" reopens the field, and fixing it there releases the hold', async () => {
    await breakFormula();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByText('Formula (CEL)')).toBeNull(), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    const label = await screen.findByText('Formula (CEL)');
    const box = label.parentElement!.querySelector('[role="combobox"]') as HTMLTextAreaElement;
    expect(box.value).toBe('record.est_hours *');
    fireEvent.change(box, { target: { value: 'record.est_hours * 2' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  it('removing the field ends the hold: nothing judged is left in the draft', async () => {
    await breakFormula();
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Total”' }));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
    const body = (mockClient.save.mock.calls.at(-1) as unknown[] | undefined)?.[2] as { fields: Array<{ name: string }> };
    expect(body.fields.map((f) => f.name)).toEqual(['est_hours']);
  });
});
