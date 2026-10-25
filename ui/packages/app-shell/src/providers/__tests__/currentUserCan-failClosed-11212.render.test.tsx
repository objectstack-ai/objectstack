/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11212 — Rider 1 of objectui#4421 on the legs that used to fail SOFT.
 *
 * The ruling, verbatim: "permission-shaped bindings are **fail-closed while the
 * permissions payload has not loaded** — the opposite of the predicate default
 * — or the first-paint leak reappears. Pin this."
 *
 * `currentUserCan-4421.render.test.tsx` pins the legs that already evaluated
 * `visible` fail-closed (the row menu, `page:header`'s `visible`,
 * `action:button`). This file pins the rest, through the same real providers:
 * `MePermissionsProvider` holding a `/auth/me/permissions` payload,
 * `ExpressionProvider` publishing the predicate scope, and an `ActionProvider`
 * under it — the console's shape. Each leg is driven through the three states
 * on ONE verb (`delete`):
 *
 *   1. NOT LOADED — no permission provider answers (a mount outside
 *      `MePermissionsProvider`: the console's `/forms/:name` route, a
 *      standalone embed). The engine refuses `can()`, the leg's fault policy
 *      applies, and the console says so.
 *   2. LOADED, GRANTED.
 *   3. LOADED, DENIED — a verdict, not a fault: nothing is reported.
 *
 * | leg                                                 | not loaded | granted | denied   |
 * |:----------------------------------------------------|:-----------|:--------|:---------|
 * | `action:group` inline member `visible`              | hidden     | shown   | hidden   |
 * | `action:group` dropdown member `visible`            | hidden     | shown   | hidden   |
 * | `action:group` host `visible`                       | hidden     | shown   | hidden   |
 * | `action:icon` `visible`                             | hidden     | shown   | hidden   |
 * | related-list toolbar (`RelatedToolbarButton`)       | hidden     | shown   | hidden   |
 * | `record:quick_actions` `visible` (ActionRunner bag) | hidden     | shown   | hidden   |
 * | `page:header` `disabled: !current_user.can(…)`      | DISABLED   | enabled | disabled |
 *
 * Before objectui#11212 the first five rows answered SHOWN while not loaded
 * (their `visible` leg failed soft to `true`), `record:quick_actions` answered
 * hidden in EVERY state (the `ActionRunner` bag bound `user` / `ctx.user` but
 * never `current_user`, so the call faulted even for a grant holder), and the
 * header's `disabled` leg answered ENABLED while not loaded (a faulting
 * `disabled` fell back to "not disabled").
 *
 * Every arm carries an ungated companion, so "hidden" can never mean "nothing
 * rendered", and one action NAME per arm: every fault report on these legs is
 * warn-once per (locator, predicate) for the life of the module, and the
 * locator carries the name, so a shared name would let the NOT-LOADED report
 * silence the DENIED arm's "nothing reported" for the wrong reason.
 *
 * The last block pins that the policy is per KEY, not a `can()` special case:
 * a predicate that faults for an unrelated reason (an unbound root) gets the
 * same answer on the same legs.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { ExpressionProvider } from '../ExpressionProvider';
// Module-scope side-effect imports: the registry renderers must be registered
// before the first render (AGENTS.md §测试纪律 — import phase, not a hook).
// Deep paths into `src`, the same module instances the aliases resolve — the
// convention `currentUserCan-4421.render.test.tsx` set.
import '../../../../components/src/renderers/action/action-group';
import '../../../../components/src/renderers/action/action-icon';
import '../../../../components/src/renderers/layout/containers';
import { RelatedToolbarButton } from '../../../../plugin-detail/src/RelatedList';
import { RecordQuickActionsRenderer } from '../../../../plugin-detail/src/renderers/record-quick-actions';

const h = React.createElement;

type State = 'not-loaded' | 'granted' | 'denied';

/** The logical delete an app ships in place of the built-in Delete. */
const CAN_DELETE = { dialect: 'cel', source: "current_user.can('account', 'delete')" };
/** The same verdict as a `disabled` gate: greyed out unless the caller may delete. */
const CANNOT_DELETE = { dialect: 'cel', source: "!current_user.can('account', 'delete')" };
/** A predicate that faults for a reason that has nothing to do with permissions. */
const UNBOUND = { dialect: 'cel', source: 'nope.deep == 1' };

const LABEL = 'Void account';
const COMPANION_LABEL = 'Print';

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
    // edit for delete) would show the action in the denied state.
    objects: { account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete } },
    fields: {},
  };
}

/** The console's shape: permissions above the predicate scope, a runner under it. */
function withState(state: State, surface: React.ReactNode) {
  const tree = (
    <ExpressionProvider user={USER}>
      <ActionProvider context={{ user: { id: USER.id, name: USER.name } }}>{surface}</ActionProvider>
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

/** Radix opens a menu on `pointerdown`; the portal mounts on the next tick. */
async function openMenu(name: RegExp) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByText(COMPANION_LABEL)).toBeInTheDocument());
}

function warnings(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
}

/** The `useCondition` `throwOnError` leg's report (it names the predicate, not the engine reason). */
const threw = (source: string) =>
  new RegExp(`was hidden/disabled: its predicate threw — CEL predicate failed to evaluate: ${escape(source)}`);
/** `ActionEngine.getActionsForLocation`'s report, for the `ActionRunner` bag. */
const engineThrew = (source: string) =>
  new RegExp(`hidden: its \`visible\` predicate threw — CEL predicate failed to evaluate: ${escape(source)}`);
/** `evalRowPredicate`'s labelled report, which forwards the engine's own reason. */
const ENGINE_REASON = /carries no permission data/;
function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface VisibleLeg {
  /** Mount the gated action (named per arm) and its ungated companion. */
  mount: (name: string, gate: unknown) => React.ReactNode;
  /** Reveal what the leg draws when it is behind a menu trigger. */
  open?: () => Promise<void>;
  present: () => boolean;
  companion: () => boolean;
  fault: (source: string) => RegExp;
}

const byText = (text: string) => () => screen.queryByText(text) !== null;

const VISIBLE_LEGS: Record<string, VisibleLeg> = {
  'action:group inline member': {
    mount: (name, gate) =>
      h(registered('action:group'), {
        schema: {
          type: 'action:group',
          display: 'inline',
          actions: [
            { name, label: LABEL, type: 'script', visible: gate },
            { name: 'print', label: COMPANION_LABEL, type: 'script' },
          ],
        },
        data: RECORD,
      }),
    present: byText(LABEL),
    companion: byText(COMPANION_LABEL),
    fault: threw,
  },
  'action:group dropdown member': {
    mount: (name, gate) =>
      h(registered('action:group'), {
        schema: {
          type: 'action:group',
          display: 'dropdown',
          label: 'More',
          actions: [
            { name, label: LABEL, type: 'script', visible: gate },
            { name: 'print', label: COMPANION_LABEL, type: 'script' },
          ],
        },
        data: RECORD,
      }),
    open: () => openMenu(/More/),
    present: byText(LABEL),
    companion: byText(COMPANION_LABEL),
    fault: threw,
  },
  'action:group host': {
    // The group's OWN gate hides the whole group, so the companion is a
    // second, ungated group beside it. The host label is per arm for the same
    // warn-once reason as the member names.
    mount: (name, gate) =>
      h(
        React.Fragment,
        null,
        h(registered('action:group'), {
          schema: {
            type: 'action:group',
            display: 'inline',
            label: name,
            visible: gate,
            actions: [{ name, label: LABEL, type: 'script' }],
          },
          data: RECORD,
        }),
        h(registered('action:group'), {
          schema: { type: 'action:group', display: 'inline', actions: [{ name: 'print', label: COMPANION_LABEL, type: 'script' }] },
          data: RECORD,
        }),
      ),
    present: byText(LABEL),
    companion: byText(COMPANION_LABEL),
    fault: threw,
  },
  'action:icon': {
    mount: (name, gate) =>
      h(
        React.Fragment,
        null,
        h(registered('action:icon'), { schema: { type: 'action:icon', actionType: 'script', name, label: LABEL, visible: gate }, data: RECORD }),
        h(registered('action:icon'), { schema: { type: 'action:icon', actionType: 'script', name: 'print', label: COMPANION_LABEL }, data: RECORD }),
      ),
    present: () => screen.queryByLabelText(LABEL) !== null,
    companion: () => screen.queryByLabelText(COMPANION_LABEL) !== null,
    fault: threw,
  },
  'related-list toolbar (RelatedToolbarButton)': {
    mount: (name, gate) =>
      h(
        React.Fragment,
        null,
        h(RelatedToolbarButton, { action: { name, label: LABEL, visible: gate } as never, onToolbarAction: () => {} }),
        h(RelatedToolbarButton, { action: { name: 'print', label: COMPANION_LABEL } as never, onToolbarAction: () => {} }),
      ),
    present: byText(LABEL),
    companion: byText(COMPANION_LABEL),
    fault: threw,
  },
  'record:quick_actions (the ActionRunner bag, via useActionEngine)': {
    mount: (name, gate) =>
      h(
        RecordContextProvider,
        { objectName: 'account', recordId: RECORD.id, data: RECORD } as never,
        h(RecordQuickActionsRenderer, {
          schema: {
            actions: [
              { name, label: LABEL, type: 'script', locations: ['record_header'], visible: gate },
              { name: 'print', label: COMPANION_LABEL, type: 'script', locations: ['record_header'] },
            ],
          } as never,
        }),
      ),
    present: byText(LABEL),
    companion: byText(COMPANION_LABEL),
    fault: engineThrew,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(Object.entries(VISIBLE_LEGS))(
  'current_user.can on the %s `visible` leg — fail-closed while not loaded (objectui#11212)',
  (legName, leg) => {
    const leg$ = legName.replace(/[^a-z]+/gi, '_');

    it('NOT LOADED: hidden, and reported', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(withState('not-loaded', leg.mount(nameOf(leg$, 'not-loaded'), CAN_DELETE)));
      if (leg.open) await leg.open();
      expect(leg.companion()).toBe(true);
      expect(leg.present()).toBe(false);
      expect(warnings(warn)).toMatch(leg.fault(CAN_DELETE.source));
    });

    it('LOADED, GRANTED: shown', async () => {
      render(withState('granted', leg.mount(nameOf(leg$, 'granted'), CAN_DELETE)));
      if (leg.open) await leg.open();
      expect(leg.companion()).toBe(true);
      expect(leg.present()).toBe(true);
    });

    it('LOADED, DENIED: hidden, with nothing reported — a verdict, not a fault', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(withState('denied', leg.mount(nameOf(leg$, 'denied'), CAN_DELETE)));
      if (leg.open) await leg.open();
      expect(leg.companion()).toBe(true);
      expect(leg.present()).toBe(false);
      expect(warnings(warn)).not.toMatch(/permission data|can\(|predicate threw/);
    });
  },
);

/** `page:header` with the gated action and an ungated companion, both inline. */
function header(name: string, gate: unknown) {
  return h(
    RecordContextProvider,
    { objectName: 'account', recordId: RECORD.id, data: RECORD, objectSchema: { name: 'account', fields: {} } } as never,
    h(registered('page:header'), {
      schema: {
        type: 'page:header',
        title: 'Northwind',
        maxVisible: 10,
        actions: [
          { name, label: LABEL, type: 'api', locations: ['record_header'], disabled: gate },
          { name: 'print', label: COMPANION_LABEL, type: 'api', locations: ['record_header'] },
        ],
      },
    }),
  );
}
const headerButton = () => screen.getByText(LABEL).closest('button');

describe('current_user.can on the record header `disabled` leg — DISABLED while not loaded (objectui#11212)', () => {
  it('NOT LOADED: rendered DISABLED, and reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(withState('not-loaded', header(nameOf('header', 'not-loaded'), CANNOT_DELETE)));
    expect(screen.getByText(COMPANION_LABEL)).toBeInTheDocument();
    expect(headerButton()).toBeDisabled();
    expect(warnings(warn)).toMatch(ENGINE_REASON);
  });

  it('LOADED, GRANTED: enabled', () => {
    render(withState('granted', header(nameOf('header', 'granted'), CANNOT_DELETE)));
    expect(headerButton()).not.toBeDisabled();
  });

  it('LOADED, DENIED: disabled, with nothing reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(withState('denied', header(nameOf('header', 'denied'), CANNOT_DELETE)));
    expect(headerButton()).toBeDisabled();
    expect(warnings(warn)).not.toMatch(/permission data|can\(|failed to evaluate/);
  });
});

describe('the policy is per KEY, not a `can()` special case: an unrelated fault gets the same answer (objectui#11212)', () => {
  it.each(Object.entries(VISIBLE_LEGS))('%s — a `visible` that faults on an unbound root is hidden', async (legName, leg) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const leg$ = legName.replace(/[^a-z]+/gi, '_');
    render(withState('granted', leg.mount(nameOf(leg$, 'unbound'), UNBOUND)));
    if (leg.open) await leg.open();
    expect(leg.companion()).toBe(true);
    expect(leg.present()).toBe(false);
  });

  it('record header — a `disabled` that faults on an unbound root renders DISABLED', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(withState('granted', header(nameOf('header', 'unbound'), UNBOUND)));
    expect(headerButton()).toBeDisabled();
  });
});
