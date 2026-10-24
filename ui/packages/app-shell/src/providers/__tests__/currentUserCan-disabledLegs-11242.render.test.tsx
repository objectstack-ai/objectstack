/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11242 — Rider 1 of objectui#4421 on the last authored-action
 * `disabled` legs, and on the shared action runner's bag.
 *
 * The ruling, verbatim: "permission-shaped bindings are **fail-closed while the
 * permissions payload has not loaded** — the opposite of the predicate default
 * — or the first-paint leak reappears. Pin this." For a `disabled` gate, closed
 * means DISABLED: the direction objectui#11212 gave `page:header`'s `disabled`
 * leg (`currentUserCan-failClosed-11212.render.test.tsx` pins it), applied here
 * by the same mechanism — the caller passes its key's own fail direction to the
 * row-predicate entry, and an absent gate is still "not disabled".
 *
 * Everything on the path is real: `MePermissionsProvider` holding a
 * `/auth/me/permissions` payload, `ExpressionProvider` publishing the predicate
 * scope, an `ActionProvider` under it (the console's per-view shape), and the
 * production renderers. Each leg is driven through the three states on ONE verb
 * (`delete`):
 *
 *   1. NOT LOADED — no permission provider answers (a mount outside
 *      `MePermissionsProvider`: the console's `/forms/:name` route, a
 *      standalone embed). The engine refuses `can()` and the leg's fault
 *      policy applies.
 *   2. LOADED, GRANTED.
 *   3. LOADED, DENIED — a verdict, not a fault: nothing is reported.
 *
 * | leg                                                        | not loaded | granted | denied   |
 * |:-----------------------------------------------------------|:-----------|:--------|:---------|
 * | row menu item (`RowActionMenu`) `disabled`                 | DISABLED   | enabled | disabled |
 * | data-table row action (`data-table`) `disabled`            | DISABLED   | enabled | disabled |
 * | built-in Delete `disabledWhen`, both menus — the CONTROL   | enabled    | enabled | disabled |
 * | runner `disabled` re-check, no action-engine block on page | refused    | RUNS    | refused  |
 * | `record:quick_actions` `visible` with NO `ActionProvider`  | hidden     | shown   | hidden   |
 *
 * Before objectui#11242 the two authored `disabled` legs answered ENABLED while
 * not loaded (a faulting `disabled` fell back to "not disabled"), and the
 * runner's `disabled` re-check refused a grant holder on any page that mounted
 * no `record:quick_actions` / `record:alert` / dashboard block: only
 * `useActionEngine` wrote `current_user` onto the provider's runner, so the
 * gate faulted, and a faulting `disabled` blocks.
 *
 * The built-in `disabledWhen` is the control: its fail-soft posture is
 * documented and pinned (PR objectui#4515), so while not loaded it stays
 * ENABLED — the server hook is its enforcement, and the built-in Edit / Delete
 * are already gated by the affordance rules.
 *
 * The last `record:quick_actions` block is the half of `useActionEngine`'s
 * binding that stays: with no `ActionProvider` above it there is no provider
 * to bind the scope's subject, so the engine binds it on its own runner.
 *
 * Every arm carries an ungated companion, so "disabled" or "hidden" can never
 * mean "nothing rendered", and one action NAME per arm: the fault reports are
 * warn-once per (locator, predicate) for the life of the module, and the
 * locator carries the name.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry, type ActionResult } from '@object-ui/core';
import { ActionProvider, RecordContextProvider, useAction } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { ExpressionProvider } from '../ExpressionProvider';
// Module-scope side-effect imports: the registry renderers must be registered
// before the first render (AGENTS.md §测试纪律 — import phase, not a hook).
// Deep paths into `src`, the same module instances the aliases resolve — the
// convention `currentUserCan-4421.render.test.tsx` set.
import '../../../../components/src/renderers/complex/data-table';
import '../../../../components/src/renderers/layout/containers';
import { RowActionMenu } from '../../../../plugin-grid/src/components/RowActionMenu';
import { RecordQuickActionsRenderer } from '../../../../plugin-detail/src/renderers/record-quick-actions';

const h = React.createElement;

type State = 'not-loaded' | 'granted' | 'denied';
const STATES: State[] = ['not-loaded', 'granted', 'denied'];

/** Greyed out unless the caller may delete. */
const CANNOT_DELETE = { dialect: 'cel', source: "!current_user.can('account', 'delete')" };
/** The `visible` spelling of the same verdict. */
const CAN_DELETE = { dialect: 'cel', source: "current_user.can('account', 'delete')" };
/** A predicate that faults for a reason that has nothing to do with permissions. */
const UNBOUND = { dialect: 'cel', source: 'nope.deep == 1' };

const LABEL = 'Void account';
const COMPANION_LABEL = 'Print';
/** The handler the runner dispatches the gated action to. */
const HANDLER = 'void_account';

/** One action name per arm — see the file header. */
const nameOf = (leg: string, state: State | 'unbound') => `void_${leg}_${state.replace('-', '_')}`;

const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['everyone'] };
const RECORD = { id: 'acc_1', name: 'Northwind', status: 'open' };

function payload(allowDelete: boolean): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: ['account_clerk'],
    // `allowEdit` is granted in BOTH loaded states, so a verb mix-up (reading
    // edit for delete) would enable the action in the denied state.
    objects: { account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete } },
    fields: {},
  };
}

function withPermissions(state: State, tree: React.ReactNode) {
  if (state === 'not-loaded') return tree;
  return <MePermissionsProvider initialPermissions={payload(state === 'granted')}>{tree}</MePermissionsProvider>;
}

/**
 * The console's per-view shape: permissions above the predicate scope, a runner
 * under it. The runner is seeded with the host's own `user` and nothing else —
 * no `current_user` — exactly as `useConsoleActionRuntime` seeds it.
 */
function withState(
  state: State,
  surface: React.ReactNode,
  handlers?: Record<string, (action: unknown) => Promise<ActionResult>>,
) {
  return withPermissions(
    state,
    <ExpressionProvider user={USER}>
      <ActionProvider context={{ user: { id: USER.id, name: USER.name } }} handlers={handlers as never}>
        {surface}
      </ActionProvider>
    </ExpressionProvider>,
  );
}

function registered(type: string): React.ComponentType<any> {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R as React.ComponentType<any>;
}

/** Radix opens a menu on `pointerdown`; the portal mounts on the next tick. */
async function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByText(COMPANION_LABEL)).toBeInTheDocument());
}

function warnings(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
}

/** `evalRowPredicate`'s labelled report, which forwards the engine's own reason. */
const ENGINE_REASON = /carries no permission data/;

const isDisabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';

interface DisabledLeg {
  /** The row's "⋮" trigger; both legs render their items behind it. */
  trigger: () => HTMLElement;
}

const DISABLED_LEGS: Record<string, DisabledLeg> = {
  'row menu item (RowActionMenu)': { trigger: () => screen.getByTestId('row-action-trigger') },
  'data-table row action (data-table)': { trigger: () => screen.getByLabelText('Row actions') },
};

const item = (name: string) => screen.getByTestId(`row-action-${name}`);

/** The surface each leg renders, before its menu is opened. */
function legSurface(legName: string, name: string, gate: unknown): React.ReactNode {
  const defs = [
    { name, label: LABEL, type: HANDLER, disabled: gate },
    { name: 'print', label: COMPANION_LABEL, type: 'print' },
  ];
  if (legName.startsWith('row menu')) {
    return h(RowActionMenu, { row: RECORD, rowActionDefs: defs as never, onActionDef: () => {} });
  }
  return h(registered('data-table'), {
    schema: {
      type: 'data-table',
      pagination: false,
      searchable: false,
      rowActions: true,
      columns: [{ header: 'Name', accessorKey: 'name' }],
      data: [RECORD],
      rowActionDefs: defs,
      onRowActionDef: () => {},
    },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(Object.keys(DISABLED_LEGS))(
  'current_user.can on the %s `disabled` leg — DISABLED while not loaded (objectui#11242)',
  (legName) => {
    const leg = DISABLED_LEGS[legName];
    const leg$ = legName.replace(/[^a-z]+/gi, '_');

    it('NOT LOADED: rendered DISABLED, and reported', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const name = nameOf(leg$, 'not-loaded');
      render(withState('not-loaded', legSurface(legName, name, CANNOT_DELETE)));
      await openMenu(leg.trigger());
      expect(isDisabled(screen.getByText(COMPANION_LABEL).closest('[role="menuitem"]') as HTMLElement)).toBe(false);
      expect(isDisabled(item(name))).toBe(true);
      expect(warnings(warn)).toMatch(ENGINE_REASON);
    });

    it('LOADED, GRANTED: enabled', async () => {
      const name = nameOf(leg$, 'granted');
      render(withState('granted', legSurface(legName, name, CANNOT_DELETE)));
      await openMenu(leg.trigger());
      expect(isDisabled(item(name))).toBe(false);
    });

    it('LOADED, DENIED: disabled, with nothing reported — a verdict, not a fault', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const name = nameOf(leg$, 'denied');
      render(withState('denied', legSurface(legName, name, CANNOT_DELETE)));
      await openMenu(leg.trigger());
      expect(isDisabled(item(name))).toBe(true);
      expect(warnings(warn)).not.toMatch(/permission data|can\(|failed to evaluate/);
    });

    it('the policy is per KEY, not a `can()` special case: a `disabled` that faults on an unbound root renders DISABLED', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const name = nameOf(leg$, 'unbound');
      render(withState('granted', legSurface(legName, name, UNBOUND)));
      await openMenu(leg.trigger());
      expect(isDisabled(item(name))).toBe(true);
    });

    it('an ABSENT, empty or blank `disabled` is still "not disabled" — only a declared gate takes the fallback', async () => {
      const blank = ['', '   ', { dialect: 'cel', source: '' }, { dialect: 'cel', source: '   ' }];
      for (const [i, gate] of blank.entries()) {
        const name = `void_${leg$}_blank_${i}`;
        render(withState('not-loaded', legSurface(legName, name, gate)));
        await openMenu(leg.trigger());
        expect(isDisabled(item(name))).toBe(false);
        cleanup();
      }
      const name = `void_${leg$}_absent`;
      render(withState('not-loaded', legSurface(legName, name, undefined)));
      await openMenu(leg.trigger());
      expect(isDisabled(item(name))).toBe(false);
    });
  },
);

/** The built-in Delete, gated by `disabledWhen`, beside an ungated custom companion. */
function builtinSurface(legName: string): React.ReactNode {
  const companion = [{ name: 'print', label: COMPANION_LABEL, type: 'print' }];
  if (legName.startsWith('row menu')) {
    return h(RowActionMenu, {
      row: RECORD,
      rowActionDefs: companion as never,
      onActionDef: () => {},
      canDelete: true,
      onDelete: () => {},
      deletePredicates: { disabledWhen: CANNOT_DELETE } as never,
    });
  }
  return h(registered('data-table'), {
    schema: {
      type: 'data-table',
      pagination: false,
      searchable: false,
      rowActions: true,
      columns: [{ header: 'Name', accessorKey: 'name' }],
      data: [RECORD],
      rowActionDefs: companion,
      onRowActionDef: () => {},
      onRowDelete: () => {},
      rowDeletePredicates: { disabledWhen: CANNOT_DELETE },
    },
  });
}

describe.each(Object.keys(DISABLED_LEGS))(
  'CONTROL — the built-in Delete `disabledWhen` on the %s stays fail-SOFT (PR objectui#4515)',
  (legName) => {
    const leg = DISABLED_LEGS[legName];
    const expected: Record<State, boolean> = { 'not-loaded': false, granted: false, denied: true };

    it.each(STATES)('%s', async (state) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(withState(state, builtinSurface(legName)));
      await openMenu(leg.trigger());
      expect(isDisabled(screen.getByTestId('row-action-builtin-delete'))).toBe(expected[state]);
    });
  },
);

/**
 * A caller of the shared runner that is NOT an action-engine block: it executes
 * a gated action through `useAction()`, the way every action renderer does, and
 * prints what the runner answered.
 */
function RunnerProbe({ name }: { name: string }) {
  const { execute } = useAction();
  const [out, setOut] = React.useState('idle');
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const r = await execute({ name, type: HANDLER, disabled: CANNOT_DELETE } as never);
          setOut(r.success ? 'ran' : `refused: ${r.error}`);
        }}
      >
        Run
      </button>
      <output data-testid="runner-out">{out}</output>
    </>
  );
}

describe('the runner `disabled` re-check answers current_user on a page with no action-engine block (objectui#11242)', () => {
  const expected: Record<State, RegExp> = {
    'not-loaded': /^refused: Action is disabled$/,
    granted: /^ran$/,
    denied: /^refused: Action is disabled$/,
  };

  it.each(STATES)('%s', async (state) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = vi.fn(async () => ({ success: true }) as ActionResult);
    render(withState(state, <RunnerProbe name={nameOf('runner', state)} />, { [HANDLER]: handler }));
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() => expect(screen.getByTestId('runner-out')).not.toHaveTextContent('idle'));
    expect(screen.getByTestId('runner-out').textContent).toMatch(expected[state]);
    expect(handler).toHaveBeenCalledTimes(state === 'granted' ? 1 : 0);
  });

  it('GRANTED, through a real `page:header` click: the button is enabled AND the runner runs it', async () => {
    const handler = vi.fn(async () => ({ success: true }) as ActionResult);
    render(
      withState(
        'granted',
        h(
          RecordContextProvider,
          { objectName: 'account', recordId: RECORD.id, data: RECORD, objectSchema: { name: 'account', fields: {} } } as never,
          h(registered('page:header'), {
            schema: {
              type: 'page:header',
              title: 'Northwind',
              maxVisible: 10,
              actions: [
                { name: nameOf('header_click', 'granted'), label: LABEL, type: HANDLER, locations: ['record_header'], disabled: CANNOT_DELETE },
              ],
            },
          }),
        ),
        { [HANDLER]: handler },
      ),
    );
    const button = screen.getByText(LABEL).closest('button') as HTMLButtonElement;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });
});

describe('`record:quick_actions` with NO `ActionProvider` above it — the engine binds its own runner (objectui#11242)', () => {
  const expected: Record<State, boolean> = { 'not-loaded': false, granted: true, denied: false };

  it.each(STATES)('%s', (state) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const name = nameOf('standalone_quick', state);
    render(
      withPermissions(
        state,
        <ExpressionProvider user={USER}>
          {h(
            RecordContextProvider,
            { objectName: 'account', recordId: RECORD.id, data: RECORD } as never,
            h(RecordQuickActionsRenderer, {
              schema: {
                actions: [
                  { name, label: LABEL, type: 'script', locations: ['record_header'], visible: CAN_DELETE },
                  { name: 'print', label: COMPANION_LABEL, type: 'script', locations: ['record_header'] },
                ],
              } as never,
            }),
          )}
        </ExpressionProvider>,
      ),
    );
    expect(screen.getByText(COMPANION_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(LABEL) !== null).toBe(expected[state]);
  });
});
