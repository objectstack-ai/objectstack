// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Access pillar — unsaved-changes guard on rail-driven surface swaps.
 *
 * The permission matrix in the main panel is keyed by the selected set
 * (`key={current}`) and unmounts entirely when the OWD overview swaps in, so
 * before this guard existed a rail click silently REMOUNTED the matrix and
 * discarded any unsaved cell edits. The OWD overview batch-editor holds
 * unsaved rows the same way and unmounts when a set swaps back in
 * (objectui#2600). The pillar now holds both editors' reported dirty state
 * (`onDirtyChange`) and gates every swap on a native confirm:
 *
 *   • dirty + switch to another set → confirm; cancel keeps the edits,
 *   • dirty + swap to the OWD overview → same confirm,
 *   • dirty OWD rows + swap to a set / create flow → same confirm,
 *   • clean switches never prompt,
 *   • re-clicking the already-open set / overview never prompts (nothing
 *     remounts),
 *   • a confirmed discard clears the guard (the editor resets on unmount).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let clientImpl: any;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => clientImpl,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});

// Rail siblings that are irrelevant to the guard — keep the render light.
// (The OWD overview is NOT mocked: its dirty report is under test.)
vi.mock('../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => null,
}));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({
  AccessExplainPanel: () => null,
}));
vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: () => null,
}));

import { t } from '../metadata-admin/i18n';
import { AccessPillar } from './StudioDesignSurface';

// jsdom has no matchMedia — useIsMobile (rail overlay) needs a stub.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as any;

interface Server {
  byName: Record<string, Record<string, unknown>>;
  saved: Array<Record<string, unknown>>;
}

function freshServer(): Server {
  return {
    saved: [],
    byName: {
      set_a: {
        name: 'set_a',
        label: 'Set A',
        objects: { a_account: { allowRead: true } },
        fields: {},
      },
      set_b: {
        name: 'set_b',
        label: 'Set B',
        objects: { a_account: {} },
        fields: {},
      },
    },
  };
}

function makeClient(server: Server) {
  return {
    // Serves BOTH the pillar rail (list('permission', { packageId })) and the
    // embedded matrix (list('object', { packageId }) + list('permission', {})
    // for the assignable-set allowlist).
    list: async (type: string) => {
      if (type === 'permission') {
        return Object.values(server.byName).map((s) => ({ name: s.name, label: s.label }));
      }
      if (type === 'object') return [{ name: 'a_account' }];
      return [];
    },
    listDrafts: async () => [],
    layered: async (_type: string, name: string) => ({
      effective: server.byName[name],
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    get: async (type: string) =>
      type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
    save: async (_t: string, name: string, payload: Record<string, unknown>) => {
      server.saved.push(payload);
      // Register the set so the post-create reload can list and open it.
      server.byName[name] = payload;
      return payload;
    },
  } as any;
}

// This jsdom environment ships no window.confirm at all — install a mock
// outright rather than spying.
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clientImpl = makeClient(freshServer());
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(cleanup);

async function renderPillarOnSetA() {
  render(
    <MemoryRouter>
      <AccessPillar packageId="app.a" />
    </MemoryRouter>,
  );
  // First set auto-selects; wait for its matrix row so the whole editor (not
  // just the breadcrumb) has loaded before a test flips a cell.
  await screen.findByText('a_account');
}

/**
 * objectui#11862 — the rail shows each set's machine name as secondary text, so
 * an open set's name is on the page more than once. objectui#12456 — the open
 * set's api name is its item header's mono chip (the Delegated admin tab, kept
 * mounted, lists every set name too), so "the matrix shows set X" is asked of
 * that header alone.
 */
const inSetHeader = () => within(screen.getByTestId('access-item-header'));
// The header is re-queried on each retry: the pillar's own header stands in
// while no set is open, and the set's header replaces it once the page loads.
const findInSetHeader = (text: string) => waitFor(() => inSetHeader().getByText(text));

/** Flip a cell in the open matrix so the editor reports dirty. */
function dirtyTheMatrix() {
  const row = screen.getByText('a_account').closest('tr')!;
  // objectui#12456 — the bulk strip draws on the row under the pointer.
  fireEvent.mouseEnter(row);
  fireEvent.click(within(row).getByRole('button', { name: 'None' }));
}

describe('AccessPillar — unsaved matrix edits guard', () => {
  it('asks before switching sets when dirty; cancel keeps the edits in place', async () => {
    await renderPillarOnSetA();
    dirtyTheMatrix();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Set B' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Still on set A, and the edit survived (row "None" left Read unchecked —
    // a remount would have reloaded allowRead: true).
    expect(inSetHeader().getByText('set_a')).toBeInTheDocument();
    const row = screen.getByText('a_account').closest('tr')!;
    expect(within(row).getByRole('checkbox', { name: 'a_account Read' })).not.toBeChecked();

    // Confirming the same switch discards and loads set B.
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Set B' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await findInSetHeader('set_b');
  });

  it('switches sets without prompting when the matrix is clean', async () => {
    await renderPillarOnSetA();

    fireEvent.click(screen.getByRole('button', { name: 'Set B' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await findInSetHeader('set_b');
  });

  it('gates the OWD overview swap too, and a confirmed discard clears the guard', async () => {
    await renderPillarOnSetA();
    dirtyTheMatrix();

    // Cancel keeps the matrix mounted.
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Record sharing (OWD)' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('owd-overview')).not.toBeInTheDocument();

    // Confirm swaps to the overview (matrix unmounts → guard resets).
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Record sharing (OWD)' }));
    expect(await screen.findByTestId('owd-overview')).toBeInTheDocument();

    // Back to a set: the discarded editor must NOT have left the guard armed.
    fireEvent.click(screen.getByRole('button', { name: 'Set A' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await findInSetHeader('set_a');
  });

  it('never prompts when re-clicking the already-open set (nothing remounts)', async () => {
    await renderPillarOnSetA();
    dirtyTheMatrix();

    fireEvent.click(screen.getByRole('button', { name: 'Set A' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    // Not remounted — the unsaved edit is still visible.
    const row = screen.getByText('a_account').closest('tr')!;
    expect(within(row).getByRole('checkbox', { name: 'a_account Read' })).not.toBeChecked();
  });
});

/** Swap the main panel to the (real) OWD overview and edit a row so the panel
 * reports dirty. Assumes the open matrix is clean, so the swap never prompts. */
async function openAndDirtyTheOwd() {
  fireEvent.click(screen.getByRole('button', { name: 'Record sharing (OWD)' }));
  await screen.findByTestId('owd-internal-a_account');
  // The dial is the shared Select (objectui#11865): open it and pick, as a user does.
  fireEvent.keyDown(screen.getByTestId('owd-internal-a_account'), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: OWD_PRIVATE }));
  await screen.findByTestId('owd-dirty-a_account');
}

const OWD_PRIVATE = t('engine.studio.settings.sharingPrivate', 'en-US');
const OWD_UNSET = t('engine.studio.settings.sharingUnset', 'en-US');

/** What the dial's trigger shows. */
const owdInternalValue = () => screen.getByTestId('owd-internal-a_account').textContent;

describe('AccessPillar — unsaved OWD overview edits guard (#2600)', () => {
  it('asks before swapping a dirty overview for a set; cancel keeps the edits', async () => {
    await renderPillarOnSetA();
    await openAndDirtyTheOwd();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Set A' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Still on the overview, edit intact.
    expect(owdInternalValue()).toBe(OWD_PRIVATE);

    // Confirming the same swap discards and mounts the set A matrix.
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Set A' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await findInSetHeader('set_a');

    // The discarded panel reset the guard on unmount — swapping back to the
    // overview must NOT prompt, and it reloads the untouched baseline.
    fireEvent.click(screen.getByRole('button', { name: 'Record sharing (OWD)' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByTestId('owd-internal-a_account');
    expect(owdInternalValue()).toBe(OWD_UNSET);
  });

  it('never prompts when re-clicking the OWD rail entry (nothing remounts)', async () => {
    await renderPillarOnSetA();
    await openAndDirtyTheOwd();

    fireEvent.click(screen.getByRole('button', { name: 'Record sharing (OWD)' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    // Not remounted — the unsaved edit is still visible.
    expect(owdInternalValue()).toBe(OWD_PRIVATE);
  });

  it('gates the create-set flow, and creating lands on the new set matrix', async () => {
    await renderPillarOnSetA();
    await openAndDirtyTheOwd();

    // Cancel keeps the overview (and its edits) — no dialog.
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'New permission set' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(owdInternalValue()).toBe(OWD_PRIVATE);

    // Confirm opens the creator; submitting swaps the overview out for the
    // new set's matrix (the discard the gate warned about).
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'New permission set' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Display name (e.g. Sales permissions)'), {
      target: { value: 'Set C' },
    });
    // objectui#11787 — the create dialog's one label: it writes a draft.
    fireEvent.click(within(dialog).getByRole('button', { name: t('engine.studio.createDraft', 'en-US') }));

    await findInSetHeader('set_c');
    expect(screen.queryByTestId('owd-overview')).not.toBeInTheDocument();
  });
});
