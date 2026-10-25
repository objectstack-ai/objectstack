// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two developer pages read a `client.meta.getItems()` answer as the
 * metadata API DECLARES it — and do NOT read `value` (objectui#6917 arm B).
 *
 * ── The seam is NOT `DataSource.find()`, and that changed the measurement ──
 * objectui#6917 filed these two sites as "the same arm objectui#6840 removed",
 * i.e. a non-`QueryResult` key at the `DataSource.find()` seam. They are not.
 * `QueryResult` (`@object-ui/types`) never reaches here: these pages call
 * `client.meta.getItems(type)`, whose envelope is `{ type, items: [...] }`, or
 * a bare array on the ADR-0037 preview path. `data` is not one of its members
 * either — `MetadataProvider.extractItems` pins `{ data: [...] }` to `[]`.
 *
 * That is objectui#6917's own central rule turned on the card: a zero measured
 * at one seam says nothing about another. So the census below was run on the
 * `meta.getItems` JOIN, not on the `find()` join the card named:
 *
 *   CELL      every `meta.getItems` producer body in the repo ....  28 producers
 *   CONTROL   `items` emitted as an envelope member .............   18 producers
 *   SUBJECT   `value` emitted as an envelope member ............     0 producers
 *
 * Superset sweep, so a shape assembled outside a producer body still surfaces:
 * of the 25 files holding a producer, 6 contain the token `value:` anywhere,
 * and all 6 are filter-condition values, select options, a DOM helper
 * parameter or a storage shim — none an envelope member. The control sits on
 * the JOIN (same cell, same pass, same extraction), so the zero is a reading.
 *
 * The two canonical in-repo readers of this envelope agree and neither has ever
 * had a `value` arm: `MetadataProvider.extractItems` (bare array | `items`) and
 * `MetadataService.getItems` (`items` only).
 *
 * ⛔ The fix is the deletion, NOT widening any published type to bless `value`
 * — the floor objectui#6726, #6840 and #6839 all held.
 *
 * The live arms are pinned beside the dead one, because live-versus-dead is the
 * whole distinction. No precedence case appears here: `value` sat LAST, behind
 * both live arms, so no ordering was ever observable at these two sites. (The
 * one site on this card that DID invert is `packages/fields`, pinned there.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
// The page asks the router where the anonymous route is served (objectui#11769),
// so it renders inside one, as it does in the app.
import { MemoryRouter } from 'react-router-dom';

/**
 * One mutable answer, read by BOTH pages' `meta.getItems`. A stable singleton
 * adapter: a fresh object per render loops the pages' load effects. Its client
 * is a singleton too, as the real adapter's `getClient()` is: Flow Runs keys its
 * flow and run loads on the client, so a fresh one per call re-ran them on
 * every render, and the flow picker's shared `Select` (objectui#11865) never
 * settled long enough to show its value.
 */
const { ADAPTER, state } = vi.hoisted(() => {
  const state: { answer: unknown } = { answer: [] };
  const client = {
    meta: {
      getItems: async () => state.answer,
      saveItem: vi.fn(async () => ({ ok: true })),
    },
    automation: { execute: vi.fn(), listRuns: async () => ({ runs: [] }) },
  };
  const ADAPTER = { getClient: () => client };
  return { ADAPTER, state };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported AFTER the mocks so the pages pick them up.
import { FlowRunsPage } from './FlowRunsPage';
import { PublicFormsPage } from './PublicFormsPage';

/** A flow definition, as `meta.getItems('flow')` rows carry it: the item IS
 *  the definition, flattened, with no `spec` member (objectui#12829). */
const FLOW = {
  name: 'reassign_wizard',
  label: 'Reassign',
  variables: [{ name: 'recordId', type: 'text', isInput: true }],
};

/** A published public form, on the `ViewItem` shape `GET /meta/view` serves:
 *  the form under `config`, opened to anonymous intake by the server's rule
 *  (`sharing.enabled`, `allowAnonymous` and a `publicLink`; objectui#11545). */
const FORM = {
  name: 'showcase_task.public',
  label: 'Log Time',
  object: 'showcase_task',
  viewKind: 'form',
  config: {
    type: 'simple',
    sections: [{ label: 'Task', fields: ['title'] }],
    sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/log-time' },
  },
};

beforeEach(() => {
  state.answer = [];
});
afterEach(cleanup);

describe('FlowRunsPage — meta.getItems envelope (objectui#6917)', () => {
  it("still reads the envelope's `items` member", async () => {
    state.answer = { items: [FLOW] };
    render(<FlowRunsPage />);
    await waitFor(() => {
      expect(screen.getByText('Reassign (reassign_wizard)')).toBeInTheDocument();
    });
  });

  it('still reads a bare array — the ADR-0037 preview path answers with one', async () => {
    state.answer = [FLOW];
    render(<FlowRunsPage />);
    await waitFor(() => {
      expect(screen.getByText('Reassign (reassign_wizard)')).toBeInTheDocument();
    });
  });

  it('does NOT read `value` — not a member of this envelope', async () => {
    // Before the fix this listed the flow. The page now reports the honest
    // "nothing here" rather than legitimising a second de-facto contract.
    state.answer = { value: [FLOW] };
    render(<FlowRunsPage />);
    await waitFor(() => {
      expect(screen.getByText('No flow definitions found.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Reassign (reassign_wizard)')).not.toBeInTheDocument();
  });

  it('does NOT read `data` either — `extractItems` pins that to empty as well', async () => {
    // The caricature guard: a reader that returned the first array it could
    // find in the envelope, whatever the key, would list the flow here.
    state.answer = { data: [FLOW] };
    render(<FlowRunsPage />);
    await waitFor(() => {
      expect(screen.getByText('No flow definitions found.')).toBeInTheDocument();
    });
  });
});

describe('PublicFormsPage — meta.getItems envelope (objectui#6917)', () => {
  it("still reads the envelope's `items` member", async () => {
    state.answer = { items: [FORM] };
    render(<PublicFormsPage />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Log Time')).toBeInTheDocument();
    });
  });

  it('still reads a bare array', async () => {
    state.answer = [FORM];
    render(<PublicFormsPage />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Log Time')).toBeInTheDocument();
    });
  });

  it('does NOT read `value` — not a member of this envelope', async () => {
    state.answer = { value: [FORM] };
    render(<PublicFormsPage />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('No public forms yet')).toBeInTheDocument();
    });
    expect(screen.queryByText('Log Time')).not.toBeInTheDocument();
  });
});
