// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data pillar's "Save draft" must refuse an object whose VALIDATION RULE
 * guard does not parse — objectui#4527 phase 2.
 *
 * #4536 gated this same button on the field inspector's CEL verdict
 * ({@link file://./DataPillar.celGate.test.tsx}). The pillar hosts three more
 * CEL-bearing surfaces that write through the very same draft and were left
 * ungated: the validations panel (rule guards), the actions panel (an action's
 * visible/disabled predicates) and the settings panel. None of them owns a Save
 * — their own headers say the Data pillar's Save draft owns the write — so the
 * pillar holds a SECOND stamped count for the panel family and folds it into
 * the same button.
 *
 * The stamp is the panel TAB: only one panel is mounted at a time, so leaving
 * the tab unmounts the reporter and it can never retract its last verdict.
 * Deriving the count against the live tab is what stops a fault authored under
 * "Rules" from wedging Save shut while the author is looking at "Fields".
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
  mockClient.save.mockClear();
});


/** Open the pillar's Rules tab and put the selected rule's guard into raw CEL. */
async function openRuleGuard() {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  // objectui#12450 — the flat tab; the passthrough menu draws the folded
  // entry as a second button of the same name.
  fireEvent.click(await screen.findByTestId('data-tab-flat-rules'));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

// objectui#5813 retired the 保存草稿 button for debounced AUTO-save; the gate
// now guards the TIMER (objectui#4306's own rule), so the observable is
// client.save itself.
describe('DataPillar — auto-save is gated on the validations panel’s CEL verdict (#4527/#5813)', () => {
  it('refuses a rule guard that does not parse', async () => {
    const box = await openRuleGuard();

    // A valid guard first — the auto-save fires; pins that a good guard never
    // blocks, and clears the dirty window.
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
    mockClient.save.mockClear();

    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('re-arms the auto-save once the guard parses again', async () => {
    const box = await openRuleGuard();

    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
  });

  /**
   * The tab stamp. Leaving Rules unmounts the panel, so it can never report
   * `0`; without deriving the count against the live tab, the dirty draft
   * would stay wedged UNSAVED on a surface with no CEL editor on screen.
   */
  it('expires the panel count when the author leaves the Rules tab', async () => {
    const box = await openRuleGuard();

    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await new Promise((r) => setTimeout(r, 2300));
    expect(mockClient.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
  });
});
