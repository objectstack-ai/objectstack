// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Flow Runs flow picker is the shared `Select` (objectui#11865).
 *
 * The page picked the flow to test with a browser-native select, beside the
 * shared Radix `Select` the rest of the console picks with. The card asks for
 * one control for one kind of choice, surface by surface.
 *
 * What is pinned:
 *   - the picker IS the primitive (a Radix combobox trigger), shows the picked
 *     flow, and no native select is left;
 *   - the trigger's accessible name is what the native control's was;
 *   - every flow, picked, is the one Run Flow executes and whose runs are
 *     listed, the same calls the native control led to, compared as JSON text;
 *   - a flow a Refresh no longer lists is what the trigger shows;
 *   - the keyboard alone opens the picker and selects.
 *
 * Read-only: the page has no such state.
 *
 * DIRECTION, observed against the native control: every pin here but the name
 * pin is red there, because each one reads the picker as the primitive's
 * trigger. What makes the call pins guards of "the conversion changed nothing
 * the page runs" is the literal each compares against: a `change` event on the
 * pre-conversion page's native control, then the same Run Flow click, led to
 * those same calls, read once on that page with these fixtures. The name and
 * the Refresh reading were taken there the same way.
 *
 * A pick reloads the flow list (the page's `loadFlows` depends on the picked
 * name), so the picker unmounts while the list loads and mounts again: each
 * case finds the trigger afresh after a pick, as a user's next look would.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { execute, listRuns, catalog, ADAPTER } = vi.hoisted(() => {
  const catalog = { flows: [] as Array<Record<string, unknown>> };
  const execute = vi.fn(async () => ({ success: true, status: 'completed', durationMs: 1 }));
  const listRuns = vi.fn(async () => ({ runs: [] }));
  // A STABLE singleton: a fresh object per render loops the page's fetch effects.
  const client = {
    meta: { getItems: async (type: string) => (type === 'flow' ? catalog.flows : []) },
    automation: { execute, listRuns },
  };
  return { execute, listRuns, catalog, ADAPTER: { getClient: () => client } };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
}));

// Imported AFTER the mocks so the page picks them up.
import { FlowRunsPage } from './FlowRunsPage';

// Flows as the server lists them: flattened, `name` and `label` on the item (objectui#12829).
const REASSIGN = { name: 'reassign_wizard', label: 'Reassign', variables: [] };
const NIGHTLY = { name: 'nightly_sync', variables: [] };

beforeEach(() => {
  catalog.flows = [REASSIGN, NIGHTLY];
  execute.mockClear();
  listRuns.mockClear();
});
afterEach(cleanup);

/** The picker, once the flow list has loaded (again). */
async function picker(): Promise<HTMLElement> {
  await screen.findByRole('button', { name: /Run Flow/i });
  return screen.findByRole('combobox');
}

/** Open the picker from the keyboard and return the options it lists, in order. */
async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(label: string): Promise<void> {
  const options = await openPicker(await picker());
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`no "${label}" listed: ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('the flow picker is the shared Select (objectui#11865)', () => {
  it('renders the picker as the Radix combobox trigger, showing the first flow', async () => {
    render(<FlowRunsPage />);
    const trigger = await picker();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveTextContent('Reassign (reassign_wizard)');
    expect(document.querySelector('select')).toBeNull();
  });

  it('lists the flows in the order the native control did', async () => {
    render(<FlowRunsPage />);
    expect((await openPicker(await picker())).map((o) => o.textContent)).toEqual([
      'Reassign (reassign_wizard)',
      'nightly_sync',
    ]);
  });

  // Green against the native control too, by design. That control had no
  // label, id or aria-label, so its accessible name was empty; the swap keeps
  // that, and adds none.
  it('keeps the accessible name the native control had: none', async () => {
    render(<FlowRunsPage />);
    const trigger = await picker();
    expect(screen.getByRole('combobox', { name: '' })).toBe(trigger);
  });
});

/**
 * [the flow picked away from, its label, option label, Run Flow's `execute`
 * calls, the panel's `listRuns` calls once the pick has settled].
 */
const RUN_WRITES: ReadonlyArray<
  readonly [from: string, fromLabel: string, label: string, execute: string, listRuns: string]
> = [
  ['nightly_sync', 'nightly_sync', 'Reassign (reassign_wizard)', '[["reassign_wizard",{"params":{}}]]', '[["reassign_wizard",{"limit":20}]]'],
  ['reassign_wizard', 'Reassign (reassign_wizard)', 'nightly_sync', '[["nightly_sync",{"params":{}}]]', '[["nightly_sync",{"limit":20}]]'],
];

describe('every flow, picked, is the one the page runs', () => {
  it.each(RUN_WRITES)('from %s (shown as %s), picking %s', async (from, fromLabel, label, executed, listed) => {
    render(<FlowRunsPage />);
    await picker();
    if (from !== 'reassign_wizard') await pick(fromLabel);
    // Settled on the flow picked away from before anything is counted.
    expect(await picker()).toHaveTextContent(fromLabel);
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(from, { limit: 20 }));
    execute.mockClear();
    listRuns.mockClear();
    await pick(label);
    await waitFor(() => expect(listRuns).toHaveBeenCalled());
    expect(await picker()).toHaveTextContent(label);
    fireEvent.click(screen.getByRole('button', { name: /Run Flow/i }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(execute.mock.calls)).toBe(executed);
    expect(JSON.stringify(listRuns.mock.calls)).toBe(listed);
  });
});

describe('a flow no option carries is what the trigger shows', () => {
  it('a picked flow a Refresh no longer lists: shown, not the first flow, and re-picking it runs nothing', async () => {
    render(<FlowRunsPage />);
    await pick('nightly_sync');
    await picker();
    catalog.flows = [REASSIGN];
    fireEvent.click(screen.getAllByRole('button', { name: /Refresh/i })[0]);
    // The page still holds `nightly_sync` and shows no runner for it. The
    // native control showed "Reassign (reassign_wizard)" here.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Run Flow/i })).not.toBeInTheDocument());
    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveTextContent('nightly_sync');
    const listed = (await openPicker(trigger)).map((o) => o.textContent);
    expect(listed).toEqual(['nightly_sync', 'Reassign (reassign_wizard)']);
    execute.mockClear();
    listRuns.mockClear();
    fireEvent.click(screen.getAllByRole('option')[0]);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveTextContent('nightly_sync');
    expect(screen.queryByRole('button', { name: /Run Flow/i })).not.toBeInTheDocument();
    expect(listRuns).not.toHaveBeenCalled();
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens the picker and Enter on a flow selects it', async () => {
    render(<FlowRunsPage />);
    fireEvent.keyDown(await picker(), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'nightly_sync' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(await picker()).toHaveTextContent('nightly_sync');
    fireEvent.click(screen.getByRole('button', { name: /Run Flow/i }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith('nightly_sync', { params: {} }));
  });
});
