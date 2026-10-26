/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4421 — a custom action gated on `current_user.can(object, verb)`,
 * the card's own shape: an app turns the built-in Delete off and ships a
 * logical delete (archive / void) in its place, and wants it gated by the SAME
 * verdict the Delete it replaced was gated by.
 *
 * Everything on the path is real: `MePermissionsProvider` holding a
 * `/auth/me/permissions` payload, `ExpressionProvider` publishing the predicate
 * scope, and three action surfaces, one per evaluation family:
 *
 *   - the row menu (`RowActionMenu`, `@object-ui/plugin-grid`) — the
 *     `evalRowPredicate` family, `fallback: false`;
 *   - the record header (`page:header`, `@object-ui/components`) — the same
 *     family, reached through its own merged scope (`headerPredicateScope`);
 *   - `action:button` (`@object-ui/components`) — the `useCondition` family,
 *     `throwOnError: true`.
 *
 * Each surface is driven through the three states on ONE verb (`delete`):
 *
 *   1. NOT LOADED — no permission provider answers, which is the state a
 *      mount outside `MePermissionsProvider` is in permanently (the console's
 *      `/forms/:name` route, a standalone embed). Rider 1 of the ruling: the
 *      action is HIDDEN, and the console says why.
 *   2. LOADED, GRANTED — shown.
 *   3. LOADED, DENIED — hidden, and SILENTLY: a denial is a verdict, not a
 *      fault. That is what keeps state 1 from collapsing into state 3 — the
 *      same hidden button, told apart by whether the engine reported a missing
 *      payload.
 *
 * State 1 is also checked against the built-in affordances' own answer in the
 * same tree: `usePermissions().can` with no provider is `true` (the embed
 * contract `rowCrudAffordances.ts` documents), and the binding does NOT
 * inherit it.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Drop the `permissions` hand-off in `evalFieldPredicate` (`fieldRules.ts`):
 * every GRANTED arm goes red (the engine refuses `can` with no data, so the
 * fail-closed surfaces hide the action for a grant holder too), and every
 * DENIED arm goes red through its SILENCE assertion only — the action is
 * hidden either way, and it is the reported fault that tells the ablated tree
 * apart. The NOT-LOADED arms stay green: nothing was handed off there to drop.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { MePermissionsProvider, usePermissions, type MePermissionsResponse } from '@object-ui/permissions';
import { ExpressionProvider } from '../ExpressionProvider';
// Module-scope side-effect imports: the two registry renderers must be
// registered before the first render (AGENTS.md §测试纪律 — import phase, not a
// hook). Deep paths into `src`, the same module instances the aliases resolve.
import '../../../../components/src/renderers/action/action-button';
import '../../../../components/src/renderers/layout/containers';
import { RowActionMenu } from '../../../../plugin-grid/src/components/RowActionMenu';

const h = React.createElement;

/** The logical delete the app ships in place of the built-in Delete. */
const CAN_DELETE = { dialect: 'cel', source: "current_user.can('account', 'delete')" };
/**
 * One action NAME per arm, the predicate text identical in all three. Every
 * fault report on these surfaces is warn-once per (locator, predicate) for the
 * life of the module, and the locator carries the action name — so with one
 * shared name, the NOT-LOADED arm's report would silence the same report in
 * any later arm, and the DENIED arm's "nothing reported" would pass for a
 * reason that has nothing to do with the verdict.
 */
function logicalDelete(state: State) {
  return { name: `account_void_${state.replace('-', '_')}`, label: 'Void account', visible: CAN_DELETE };
}
/** An ungated companion, so "not rendered" can never mean "nothing rendered". */
const COMPANION = { name: 'print', label: 'Print' };

const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['everyone'] };
const RECORD = { id: 'acc_1', name: 'Northwind', status: 'open' };

type State = 'not-loaded' | 'granted' | 'denied';

function payload(allowDelete: boolean): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: ['account_clerk'],
    // `allowEdit` is granted in BOTH loaded states, so a verb mix-up (reading
    // edit for delete) would show the action in the denied state.
    objects: { account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete } },
    fields: {},
  };
}

/** What the built-in affordances would answer for the same verb in the same tree. */
function BuiltinVerdict() {
  const { can, isLoaded } = usePermissions();
  return h('output', { 'data-testid': 'builtin-verdict' }, `${String(isLoaded)}:${String(can('account', 'delete'))}`);
}

function withState(state: State, surface: React.ReactNode) {
  const tree = (
    <ExpressionProvider user={USER}>
      <ActionProvider>
        {surface}
        <BuiltinVerdict />
      </ActionProvider>
    </ExpressionProvider>
  );
  if (state === 'not-loaded') return tree;
  return <MePermissionsProvider initialPermissions={payload(state === 'granted')}>{tree}</MePermissionsProvider>;
}

function registered(type: string): React.ComponentType<any> {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R as React.ComponentType<any>;
}

/**
 * What each family's console line says about the NOT-LOADED fault. The
 * `evalRowPredicate` family forwards the engine's own reason; the throwing
 * `useCondition` leg reports only that the predicate threw (its `throwOnError`
 * probe runs the engine with `warn: false` and throws a generic message), so
 * there the line is matched on the predicate it names.
 */
const ENGINE_REASON = /carries no permission data/;
const THREW = /was hidden\/disabled: its predicate threw — CEL predicate failed to evaluate: current_user\.can\('account', 'delete'\)/;

const SURFACES: Record<string, {
  mount: (state: State) => React.ReactNode;
  find: (state: State | 'companion') => HTMLElement | null;
  fault: RegExp;
}> = {
  'row menu (RowActionMenu, evalRowPredicate)': {
    mount: (state) =>
      h(RowActionMenu, {
        row: RECORD,
        onActionDef: () => {},
        // `variant: 'primary'` renders the defs as always-mounted inline
        // buttons, so the assertion does not depend on opening the menu.
        rowActionDefs: [
          { ...logicalDelete(state), variant: 'primary' },
          { ...COMPANION, variant: 'primary' },
        ] as never,
        maxInlineActions: 2,
      }),
    find: (state) =>
      screen.queryByTestId(`row-action-inline-${state === 'companion' ? COMPANION.name : logicalDelete(state).name}`),
    fault: ENGINE_REASON,
  },
  'record header (page:header, evalRowPredicate)': {
    mount: (state) =>
      h(
        RecordContextProvider,
        { objectName: 'account', recordId: RECORD.id, data: RECORD, objectSchema: { name: 'account', fields: {} } } as never,
        h(registered('page:header'), {
          schema: {
            type: 'page:header',
            title: 'Northwind',
            maxVisible: 10,
            actions: [
              { ...logicalDelete(state), type: 'api', locations: ['record_header'] },
              { ...COMPANION, type: 'api', locations: ['record_header'] },
            ],
          },
        }),
      ),
    find: (state) => screen.queryByText(state === 'companion' ? COMPANION.label : 'Void account'),
    fault: ENGINE_REASON,
  },
  'action:button (useCondition, throwOnError)': {
    mount: (state) =>
      h(
        React.Fragment,
        null,
        h(registered('action:button'), {
          schema: { type: 'action:button', actionType: 'script', ...logicalDelete(state) },
        }),
        h(registered('action:button'), {
          schema: { type: 'action:button', actionType: 'script', ...COMPANION },
        }),
      ),
    find: (state) => screen.queryByText(state === 'companion' ? COMPANION.label : 'Void account'),
    fault: THREW,
  },
};

function warnings(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(Object.entries(SURFACES))(
  'current_user.can(object, verb) on the %s (objectui#4421)',
  (_label, surface) => {
    it('NOT LOADED: hidden, reported as a missing payload — the built-in no-provider `true` is not inherited', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(withState('not-loaded', surface.mount('not-loaded')));
      expect(surface.find('companion')).toBeInTheDocument();
      expect(surface.find('not-loaded')).not.toBeInTheDocument();
      expect(warnings(warn)).toMatch(surface.fault);
      // Same tree, same verb: the built-in answer is the fail-open embed default.
      expect(screen.getByTestId('builtin-verdict')).toHaveTextContent('false:true');
    });

    it('LOADED, GRANTED: shown', () => {
      render(withState('granted', surface.mount('granted')));
      expect(surface.find('granted')).toBeInTheDocument();
      expect(screen.getByTestId('builtin-verdict')).toHaveTextContent('true:true');
    });

    it('LOADED, DENIED: hidden, with nothing reported — a verdict, not a fault', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(withState('denied', surface.mount('denied')));
      expect(surface.find('companion')).toBeInTheDocument();
      expect(surface.find('denied')).not.toBeInTheDocument();
      expect(warnings(warn)).not.toMatch(/permission data|can\(|predicate threw/);
      expect(screen.getByTestId('builtin-verdict')).toHaveTextContent('true:false');
    });
  },
);
