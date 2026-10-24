/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Legacy string `rowActions` must reach the ActionRunner as a real action DEF
 * (objectui#2960).
 *
 * A view declaring `rowActions: ['convert_lead']` used to dispatch the action
 * NAME in the runner's `type` slot — `{ type: 'convert_lead' }`. That matches
 * no built-in type and no registered handler, so it fell through the runner's
 * schema fallback: zero requests, then a green "Action completed successfully"
 * toast. And because an object action declaring `locations: ['list_item']`
 * also injects its own (working) entry, the same action could render twice —
 * one live, one dead.
 *
 * These drive the REAL ObjectGrid through a real ActionProvider and assert the
 * user-visible outcome: the click issues the action's request, and the menu
 * carries one entry per action rather than a working/dead pair.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'lead';
const ROWS = [{ id: '1', name: 'Alice' }];

/**
 * The object's own `convert_lead` action — an api call to a custom route. The
 * label is deliberately NOT the humanization of the name ("Convert Lead"), so
 * an assertion on it can tell the resolved def apart from the legacy path,
 * which could only ever render `formatActionLabel(name)`.
 */
const CONVERT_LEAD = {
  name: 'convert_lead',
  label: 'Convert to Account',
  type: 'api',
  target: '/api/v1/leads/convert',
  locations: ['record_header'],
};

let fetchMock: ReturnType<typeof vi.fn>;

function renderGrid(opts: {
  objectActions?: unknown[];
  schema?: Record<string, unknown>;
  /** Wired only by the canonical-name cases below (objectui#8071 slice 12). */
  onEdit?: (record: any) => void;
  onDelete?: (record: any) => void;
}) {
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
      ...(opts.objectActions ? { actions: opts.objectActions } : {}),
    }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ROWS },
    ...opts.schema,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid
          schema={schema}
          dataSource={dataSource}
          {...(opts.onEdit ? { onEdit: opts.onEdit } : {})}
          {...(opts.onDelete ? { onDelete: opts.onDelete } : {})}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Render, wait for the async schema fetch to settle, then open the row kebab. */
async function openRowMenu(opts: Parameters<typeof renderGrid>[0]) {
  renderGrid(opts);
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  // The promotion depends on `getObjectSchema`, so an assertion taken before
  // it lands would read the pre-fetch (unresolved) state.
  await waitFor(() => expect(screen.getByTestId('row-action-trigger')).toBeInTheDocument());
  await userEvent.click(screen.getByTestId('row-action-trigger'));
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('legacy string rowActions dispatch (objectui#2960)', () => {
  it('issues the resolved action request instead of no-opping', async () => {
    await openRowMenu({
      objectActions: [CONVERT_LEAD],
      schema: { rowActions: ['convert_lead'] },
    });

    await userEvent.click(screen.getByTestId('row-action-convert_lead'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/leads/convert');
  });

  it('renders the object action label, not the humanized name', async () => {
    await openRowMenu({
      objectActions: [CONVERT_LEAD],
      schema: { rowActions: ['convert_lead'] },
    });

    const item = screen.getByTestId('row-action-convert_lead');
    expect(item).toHaveTextContent('Convert to Account');
    expect(item).not.toHaveTextContent('Convert Lead');
  });

  it('does not render a dead duplicate of a list_item action', async () => {
    const listItemDef = { ...CONVERT_LEAD, locations: ['list_item'], label: 'Convert' };
    await openRowMenu({
      objectActions: [listItemDef],
      // The app-shell derives `rowActionDefs` from `locations: ['list_item']`;
      // a view that ALSO names the action in legacy `rowActions` used to get
      // both a working entry and a dead twin.
      schema: { rowActions: ['convert_lead'], rowActionDefs: [listItemDef] },
    });

    expect(screen.getAllByTestId('row-action-convert_lead')).toHaveLength(1);
  });

  it('leaves a name with no declared action to the by-name handler path', async () => {
    // Consumers may register a runner handler under exactly this name, so the
    // entry must still render and still dispatch.
    await openRowMenu({
      objectActions: [CONVERT_LEAD],
      schema: { rowActions: ['crm_only_handler'] },
    });

    expect(screen.getByTestId('row-action-crm_only_handler')).toBeInTheDocument();
    // Nothing resolvable to call — and with the runner's fallback now failing
    // loudly, no request and no success are reported.
    await userEvent.click(screen.getByTestId('row-action-crm_only_handler'));
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});

/**
 * objectui#8071 slice 12 — the MEMBER contract of `object-grid`'s `rowActions`,
 * registered as this key's member pin.
 *
 * ## What the registration cannot say
 *
 * `rowActions` is registered as an ARRAY-armed input. The arm says "an array",
 * and a reader who stops there concludes the members are interchangeable action
 * names. They are not: TWO spellings — `'edit'` and `'delete'` — are CANONICAL.
 * `ObjectGrid.tsx` tests the list for them, hands the verdict to the same gate
 * `operations.update` / `operations.delete` feed, and then REMOVES them from the
 * list it passes to `resolveLegacyRowActions`. So one member of this array can
 * mean "route through the grid's own `onEdit` callback" while its neighbour
 * means "look this name up on the object and dispatch the def you find".
 *
 * ## The consequence of losing the removal, which is what these cases pin
 *
 * Passing the list on UNFILTERED — the plausible simplification, since the
 * resolver already ignores names it cannot resolve — is silent and visible only
 * in the menu: `'edit'` resolves to nothing, falls through to the by-name
 * handler path (the case above pins that path for a genuine custom name), and
 * renders a SECOND "Edit" entry beside the built-in one. Two identical-looking
 * entries, one wired to `onEdit` and one dispatching a type the runner has no
 * handler for — the working/dead pair objectui#2960 removed for custom names,
 * reappearing for the canonical two.
 *
 * The cases pair each presence with an absence in the SAME opened menu, because
 * "the built-in entry is there" is green in both worlds.
 */
describe('object-grid `rowActions` — the two CANONICAL members (objectui#8071)', () => {
  it('routes `edit` and `delete` to the grid callbacks as BUILT-IN entries, not as generic ones', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    await openRowMenu({
      objectActions: [CONVERT_LEAD],
      schema: { rowActions: ['edit', 'delete'] },
      onEdit,
      onDelete,
    });

    expect(screen.getByTestId('row-action-builtin-edit')).toBeInTheDocument();
    expect(screen.getByTestId('row-action-builtin-delete')).toBeInTheDocument();
    // …and NOT also as generic name-dispatched entries. This is the half the
    // filter carries: without it each canonical name renders a dead twin.
    expect(screen.queryAllByTestId('row-action-edit')).toHaveLength(0);
    expect(screen.queryAllByTestId('row-action-delete')).toHaveLength(0);

    await userEvent.click(screen.getByTestId('row-action-builtin-edit'));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][0]).toMatchObject({ id: '1' });
    // The runner is not involved at all on this path: no action request goes
    // out. (The only traffic is the record-level explain probe #4296 fires for
    // a grid whose rows offer a write, which is not the runner.)
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain(CONVERT_LEAD.target);
  });

  it('reads the canonical members ALONGSIDE an ordinary one in the same array', async () => {
    await openRowMenu({
      objectActions: [CONVERT_LEAD],
      schema: { rowActions: ['edit', 'convert_lead'] },
      // `onDelete` deliberately UNWIRED, so `delete`'s absence below is about
      // the array's membership and the callback both, not about the array
      // alone — the two are ANDed and either one closes the entry.
      onEdit: vi.fn(),
    });

    // The ordinary member still resolves against the object…
    expect(screen.getByTestId('row-action-convert_lead')).toHaveTextContent('Convert to Account');
    // …while the canonical one beside it stays the built-in entry, exactly once.
    expect(screen.getAllByTestId('row-action-builtin-edit')).toHaveLength(1);
    expect(screen.queryAllByTestId('row-action-edit')).toHaveLength(0);
    // `delete` was not a member, so its built-in entry is absent — the control
    // that keeps the line above from reading as "the kebab always has both".
    expect(screen.queryAllByTestId('row-action-builtin-delete')).toHaveLength(0);
  });

  it('reads a NON-ARRAY value as no members at all', async () => {
    // What a stored document or an `as any` bag can carry. `Array.isArray` is
    // the guard; drop it and `'delete'.includes('edit')` is asked of a string —
    // `.filter` is not a string method, so the whole grid throws on render.
    renderGrid({
      objectActions: [CONVERT_LEAD],
      schema: { rowActions: 'convert_lead' },
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    const row = screen.getByText('Alice').closest('tr');
    const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
    // The callbacks alone still open the built-in pair (the `operations`
    // default), and the string contributes no member of its own.
    expect(trigger).not.toBeNull();
    await userEvent.click(trigger!);
    expect(screen.queryAllByTestId('row-action-convert_lead')).toHaveLength(0);
    expect(screen.getByTestId('row-action-builtin-edit')).toBeInTheDocument();
  });
});
