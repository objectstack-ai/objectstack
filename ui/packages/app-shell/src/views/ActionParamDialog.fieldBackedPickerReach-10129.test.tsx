/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10129 — a field-backed LOOKUP action param reaches its picker, and a
 * param whose backing field cannot be read is REFUSED instead of rendered.
 *
 * ## The defect, as measured on this tree
 *
 * `resolveActionParams()` resolves a field-backed param (`{ field: 'x' }`)
 * against the `objects` list its CALLER happens to hold. Two of the console's
 * own callers cannot hold the right one: `ConsoleShell`'s root action runtime —
 * the provider that exists so a `type: 'flow'` `action:button` works anywhere —
 * passes NO objects at all, and `DeclaredActionsBar` passes exactly ONE (none
 * when it is driven by an `actions` prop). When the owner is absent the param
 * takes the resolver's last-resort shape, and for a field-backed param that
 * shape is `text`: it declares no inline `type`, so there is nothing else to
 * fall back to.
 *
 * ⭐ The load-bearing half is that the degradation was ANONYMOUS. By the time
 * `paramToField()` sees such a param it IS a `text` param, so
 * `paramDegradesWithoutTarget()` answers **false**, no "no reference target"
 * warning fires, and even the #3405 "paste a record id" placeholder and help
 * text — the affordances that exist for exactly this dead end — do not apply.
 * The user gets an unannotated empty box: no dropdown, no typeahead, and no
 * request for the referenced object on the wire, because no picker was ever
 * built. `legA — the silent shape, named` pins that reading directly, because a
 * test that only asserted "the widget is not a lookup" would have passed
 * against the defect AND against a fix that merely restored the hints.
 *
 * ## Every leg has a lit control beside it
 *
 * A picker that renders and a dialog that refuses are both shapes a broken
 * fixture produces for free, so neither is asserted alone:
 *
 *  - leg A resolves the SAME param twice, differing only in whether the owner
 *    object is in the list;
 *  - leg C renders the refusal beside a sibling param that must still render
 *    its own input, and beside the identical declaration resolved WITH its
 *    owner, which must produce a real picker and an enabled Confirm;
 *  - leg D drives the console runtime with the supply `ConsoleShell` really
 *    uses (`objects` absent) and reads the picker's QUERY off the dataSource,
 *    with the record-form reading of the same field def as the control — the
 *    card's claim is that the field works there in this same build, and that
 *    claim is measured here rather than inherited.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { ActionParamDef } from '@object-ui/core';
import { MetadataCtx, SchemaRendererProvider } from '@object-ui/react';
// Module scope, per AGENTS.md 测试纪律: the dialog reaches `LookupField` through
// a `React.lazy` factory inside `@object-ui/fields`, and a first dynamic
// import() under a saturated transform pipeline can eat most of RTL's 1s
// `findBy` budget. This barrel statically re-exports those widget modules.
import '@object-ui/fields';
import { getLazyFieldWidget } from '@object-ui/fields';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { ActionParamDialog } from './ActionParamDialog';
import { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime';
import {
  resolveActionParams,
  withKnownObjects,
  type RawActionParam,
} from '@object-ui/fields';
import { paramToField, paramDegradesWithoutTarget } from '../utils/paramToField';

/* ────────────────────────────────────────────────────────────────────────── */
/* The card's metadata, spelled the way the protocol declares it              */
/* ────────────────────────────────────────────────────────────────────────── */

/** The reported object: a contract whose type is a lookup at another object. */
const CLM_CONTRACT = {
  name: 'clm_contract',
  fields: {
    title: { type: 'text', label: 'Title' },
    // `reference` is the ONE spelling `@objectstack/spec`'s `FieldSchema`
    // declares for a relationship target — the same def the record form reads.
    contract_type: {
      type: 'lookup',
      label: 'Contract Type',
      required: true,
      reference: 'clm_contract_type',
    },
  },
};

/** The action's declaration: field-backed, carrying NO inline `type`. */
const FIELD_BACKED: RawActionParam[] = [{ field: 'contract_type' }];

const ctxWith = (objects: unknown[]) => ({
  objectName: 'clm_contract',
  objects: objects as never,
  fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg A — the resolver                                        CONTRACT       */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#10129 leg A — the resolver names the field it could not read', () => {
  it('CONTROL — with the owner object in the list the param carries its picker target', () => {
    const [p] = resolveActionParams(FIELD_BACKED, ctxWith([CLM_CONTRACT]));
    expect(p.type).toBe('lookup');
    expect(p.referenceTo).toBe('clm_contract_type');
    expect(p.unresolvedField).toBeUndefined();
    expect(paramToField(p).type).toBe('lookup');
  });

  it('⭐ legA — the silent shape, named: without the owner the param is `text`, and NOTHING else used to say so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [p] = resolveActionParams(FIELD_BACKED, ctxWith([]));

    // The shape the user met. Unchanged by this fix — a partially-cached
    // console must not crash — and pinned so the next reader can see that the
    // widget really is a bare text input.
    expect(p.type).toBe('text');
    expect(p.referenceTo).toBeUndefined();
    expect(paramToField(p).type).toBe('text');

    // ⭐ And the reason it was invisible: every EXISTING reader of "this param
    // degraded" answers no, because by now it is a `text` param and text params
    // do not degrade. These two lines are the defect, not a side note.
    expect(paramDegradesWithoutTarget(p)).toBe(false);
    expect(paramToField(p).placeholder).toBeUndefined();

    // What this change adds: the pair that could not be resolved, by name.
    expect(p.unresolvedField).toBe('clm_contract.contract_type');
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('clm_contract.contract_type');
    warn.mockRestore();
  });

  it('a cross-object param names the object it was resolved AGAINST, not the page object', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [p] = resolveActionParams(
      [{ field: 'contract_type', objectOverride: 'clm_request' }],
      ctxWith([CLM_CONTRACT]),
    );
    expect(p.unresolvedField).toBe('clm_request.contract_type');
    warn.mockRestore();
  });

  it('an INLINE picker is untouched — it never needed the object list', () => {
    const [p] = resolveActionParams(
      [{ name: 'contract_type', type: 'lookup', reference: 'clm_contract_type', required: true }],
      ctxWith([]),
    );
    expect(p.referenceTo).toBe('clm_contract_type');
    expect(p.unresolvedField).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg B — the supply helper                                   CONTRACT       */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#10129 leg B — `withKnownObjects` fills the gap without overruling the caller', () => {
  it('the store contributes an object the caller never held', () => {
    const merged = withKnownObjects([], [CLM_CONTRACT]);
    expect(merged.map((o: any) => o.name)).toEqual(['clm_contract']);
  });

  it('⭐ the CALLER wins on a name they both carry — a draft overlay is not replaced by its published twin', () => {
    const draft = { name: 'clm_contract', fields: { contract_type: { type: 'text' } } };
    const merged = withKnownObjects([draft], [CLM_CONTRACT]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(draft);
  });

  it('an absent caller list is the ConsoleShell case, and is not an error', () => {
    expect(withKnownObjects(undefined, [CLM_CONTRACT]).map((o: any) => o.name)).toEqual([
      'clm_contract',
    ]);
    expect(withKnownObjects(undefined, undefined)).toEqual([]);
  });

  it('entries with no usable name are kept from the caller and skipped from the store', () => {
    const anon = { fields: {} };
    const merged = withKnownObjects([anon], [{ fields: {} }, CLM_CONTRACT]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(anon);
    expect((merged[1] as any).name).toBe('clm_contract');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg C — the dialog refuses, loudly                          CONTRACT       */
/* ────────────────────────────────────────────────────────────────────────── */

/** A sibling param that resolves cleanly — the control for every leg-C claim. */
const SIBLING: ActionParamDef = { name: 'note', label: 'Note', type: 'text' };

function openDialog(params: ActionParamDef[], dataSource?: unknown) {
  const dialog = (
    <ActionParamDialog
      state={{ open: true, params, title: 'Launch contract', resolve: () => {} }}
      onOpenChange={() => {}}
    />
  );
  return render(
    dataSource
      ? <SchemaRendererProvider dataSource={dataSource as never}>{dialog}</SchemaRendererProvider>
      : dialog,
  );
}

describe('objectui#10129 leg C — an unreadable param is refused, a readable one is not', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => cleanup());

  it('⭐ the refusal replaces the input, names the object and field, and disables Confirm', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolved = resolveActionParams(FIELD_BACKED, ctxWith([]));
    openDialog([...resolved, SIBLING]);

    const alert = await screen.findByTestId('param-unresolved-contract_type');
    expect(alert).toHaveTextContent('clm_contract.contract_type');
    // ⛔ No input for it — an empty box is exactly what this replaces.
    expect(screen.queryByLabelText('Contract Type')).toBeNull();
    // CONTROL — the sibling param is untouched and still collectable. `findBy`
    // because its widget is lazy: a `getBy` here reads the Suspense fallback and
    // fails for a reason that has nothing to do with the refusal.
    expect(await screen.findByLabelText('Note')).toBeInTheDocument();
    // The action cannot be launched while a param cannot be read.
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();

    // Loud, and in every build — the console line names the action and the pair.
    await waitFor(() => expect(error).toHaveBeenCalled());
    const said = error.mock.calls.flat().join(' ');
    expect(said).toContain('Launch contract');
    expect(said).toContain('clm_contract.contract_type');

    warn.mockRestore();
    error.mockRestore();
  });

  it('CONTROL — the SAME declaration, resolved with its owner, renders a real picker and an enabled Confirm', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolved = resolveActionParams(FIELD_BACKED, ctxWith([CLM_CONTRACT]));
    openDialog([...resolved, SIBLING], makeDataSource());

    expect(await screen.findByTestId('lookup-trigger-contract_type')).toBeInTheDocument();
    expect(screen.queryByTestId('param-unresolved-contract_type')).toBeNull();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg D — end to end, through the runtime ConsoleShell really mounts         */
/* ────────────────────────────────────────────────────────────────────────── */

type QueryParams = { $filter?: Record<string, unknown> };

const CONTRACT_TYPES = [
  { id: 't1', name: 'Master services agreement' },
  { id: 't2', name: 'Statement of work' },
];

function makeDataSource() {
  const queries: Array<{ objectName: string; params: QueryParams }> = [];
  return {
    queries,
    find: vi.fn(async (objectName: string, params: QueryParams) => {
      queries.push({ objectName, params });
      return { data: CONTRACT_TYPES, total: CONTRACT_TYPES.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_o: string, id: string) =>
      CONTRACT_TYPES.find((c) => c.id === id) ?? null),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  };
}

/** A metadata store that HAS the object — the state the console is really in. */
const metadataWith = (objects: unknown[]) => ({
  apps: [], objects, dashboards: [], reports: [], pages: [],
  loading: false, error: null,
  refresh: async () => {}, invalidate: () => {},
  ensureType: async () => objects,
  getItem: async () => null, getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
}) as never;

/**
 * `ConsoleShell`'s root runtime verbatim: `useConsoleActionRuntime({ dataSource })`
 * — ⛔ no `objects`, ⛔ no `objectName`. That is the supply under test.
 */
function ConsoleHarness({ dataSource, onReady }: { dataSource: unknown; onReady: (fn: any) => void }) {
  const runtime = useConsoleActionRuntime({ dataSource } as never);
  const handler = runtime.paramCollectionHandler;
  React.useEffect(() => { onReady(handler); }, [onReady, handler]);
  return <>{runtime.dialogs}</>;
}

async function openViaConsoleRuntime(objects: unknown[], dataSource: unknown) {
  let handler: any;
  const onReady = (fn: any) => { handler = fn; };
  render(
    <MemoryRouter initialEntries={['/app/demo']}>
      <MetadataCtx.Provider value={metadataWith(objects)}>
        <SchemaRendererProvider dataSource={dataSource as never}>
          <ConsoleHarness dataSource={dataSource} onReady={onReady} />
        </SchemaRendererProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(handler).toBeTruthy());
  await act(async () => {
    void handler(FIELD_BACKED as never, {
      name: 'contract_intake',
      label: 'Launch contract',
      objectName: 'clm_contract',
    } as never);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('objectui#10129 leg D — the console runtime resolves a field-backed picker off the metadata store', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => cleanup());

  it('⭐ the picker renders and QUERIES the referenced object, from the supply ConsoleShell really uses', async () => {
    const ds = makeDataSource();
    await openViaConsoleRuntime([CLM_CONTRACT], ds);

    expect(screen.queryByTestId('param-unresolved-contract_type')).toBeNull();
    fireEvent.click(await screen.findByTestId('lookup-trigger-contract_type'));

    // The card's two load-bearing symptoms, inverted: options ARE offered, and a
    // request for the referenced object DOES appear. ⛔ Asserted on the object
    // NAME, not on a call count — a picker that queried the wrong object would
    // satisfy a bare count.
    await waitFor(() => expect(screen.getByText('Master services agreement')).toBeInTheDocument());
    expect(ds.queries.some((q) => q.objectName === 'clm_contract_type')).toBe(true);
  });

  it('CONTROL — the same field def renders the same picker on a record form, off the same def', async () => {
    const ds = makeDataSource();
    // The record-form path: the object field def reaches the shared widget
    // renderer as-is. This is the card's "it works there in this same build",
    // measured rather than quoted.
    const Widget = getLazyFieldWidget('lookup');
    render(
      <SchemaRendererProvider dataSource={ds as never}>
        <React.Suspense fallback={null}>
          <Widget
            id="contract_type"
            value={null}
            onChange={() => {}}
            field={{ name: 'contract_type', ...CLM_CONTRACT.fields.contract_type, reference: 'clm_contract_type' } as never}
            dataSource={ds as never}
          />
        </React.Suspense>
      </SchemaRendererProvider>,
    );
    fireEvent.click(await screen.findByTestId('lookup-trigger-contract_type'));
    await waitFor(() => expect(screen.getByText('Master services agreement')).toBeInTheDocument());
    expect(ds.queries.some((q) => q.objectName === 'clm_contract_type')).toBe(true);
  });

  it('⛔ NEGATIVE control — a store that really does NOT have the object still refuses, it does not invent a picker', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource();
    await openViaConsoleRuntime([], ds);

    expect(await screen.findByTestId('param-unresolved-contract_type')).toBeInTheDocument();
    expect(screen.queryByTestId('lookup-trigger-contract_type')).toBeNull();
    expect(ds.queries.some((q) => q.objectName === 'clm_contract_type')).toBe(false);
  });
});
