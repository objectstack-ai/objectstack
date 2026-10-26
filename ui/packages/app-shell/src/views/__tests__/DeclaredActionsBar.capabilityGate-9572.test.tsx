// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DeclaredActionsBar — the ADR-0066 D4 capability mirror (objectui#9572).
 *
 * `@objectstack/spec` declares `requiredPermissions` as "enforced with 403 on
 * the platform action route … and MIRRORED AS A UI HIDE". Every other
 * object-bound surface mirrors it — `action:bar`, the grid row menu, the
 * selection bar, and (objectui#9623) the data-table row menu. This bar drew
 * `objectDef.actions[]` with no gate at all, so the declared key was INERT on
 * the one surface whose actions are entirely server-declared.
 *
 * ⚠️ Nothing here moves ENFORCEMENT into the UI, and these assertions are
 * written so they cannot be satisfied by something that does: the server stays
 * the sole authority (it still 403s), and what is pinned is only the MIRROR.
 *
 * The four arms, and why each is here:
 *
 *   1. held set does NOT contain the declared capability ⇒ hidden. An EMPTY
 *      held array is "holds nothing", not "unknown", so it gates normally.
 *   2. held set DOES contain it ⇒ shown. Guards against a fix tightened into
 *      hiding everything.
 *   3. capabilities UNKNOWN (no `systemPermissions` at all) ⇒ still shown.
 *      This is the fail-OPEN arm `useCapabilityGate` documents, and the arm a
 *      careless fix breaks: the card's own warning is that this bar's `visible`
 *      leg is fail-CLOSED while the gate is fail-OPEN. The two compose by AND,
 *      so the composition can only ever HIDE more than today — never show
 *      something that is hidden today.
 *   4. the `can_override` arm (objectui#5178) is untouched: an override-only
 *      viewer still gets the override affordance for an action that declares no
 *      capability, and does NOT get an exemption from one that does.
 *
 * ⭐ PLACEMENT is pinned, not incidental. The held capabilities below are
 * supplied ONLY through `useConsoleActionRuntime().actionProviderProps.context`
 * — i.e. only through the `<ActionProvider>` THIS BAR MOUNTS ITSELF. There is
 * deliberately no ambient `ActionProvider` and no `PredicateScopeProvider`
 * above these renders. `useCapabilityGate` reads the nearest provider ABOVE its
 * caller, so a gate called in the bar's outer body would read `undefined` here,
 * fail open, and pass nothing — the phantom-gate shape. Every assertion below
 * therefore fails unless the gate is evaluated INSIDE the bar's own provider,
 * which is also the only placement that mirrors the capabilities the dispatch
 * this bar makes will actually carry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/**
 * The runner context the bar's OWN `<ActionProvider>` publishes. Hoisted so the
 * module factory below can read it at render time rather than at import time.
 */
const harness = vi.hoisted(() => ({ runnerContext: {} as Record<string, unknown> }));

// The runtime is exercised in its own suite. Here it is an inert shell EXCEPT
// for `context`, which is the single channel this file supplies capabilities
// through — see the placement note in the docblock.
vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({
    actionProviderProps: { context: harness.runnerContext },
    dialogs: null,
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

// ⛔ `@object-ui/react` is NOT doubled in this file — not `ActionProvider`, not
// `useAction`, not `useCapabilityGate`, not the predicate entry. A doubled
// `ActionProvider` (what the two sibling DeclaredActionsBar suites use, for
// reasons that do not apply here) would erase the very context this file exists
// to prove the gate reads, and every assertion would pass on a phantom gate.

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    actionLabel: (_o: unknown, _n: unknown, fallback: string) => fallback,
    actionConfirm: (_o: unknown, _n: unknown, fallback?: string) => fallback,
    actionSuccess: (_o: unknown, _n: unknown, fallback?: string) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) =>
      String(options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_m: string, name: string) => String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
  pickLocalized: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

// The components barrel is INHERITED and only the primitives this suite drives
// are overridden, so `hasDeclaredVisibilityGate` arrives as the real barrel's
// re-export rather than a test-double re-spelling of it (objectui#3492).
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Button: ({ children, onClick, ...props }: any) => (
      <button onClick={onClick} {...props}>{children}</button>
    ),
    Separator: () => <hr data-testid="bar-separator" />,
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
  };
});

import { DeclaredActionsBar } from '../DeclaredActionsBar';

/** The capability the gated fixtures declare. Held by nobody unless granted. */
const CAP = 'manage_platform_settings';

/** Declares a capability — the action the mirror must hide. */
const GATED = {
  name: 'approval_force',
  type: 'api',
  label: 'Force decide',
  target: '/api/v1/approvals/requests/{id}/force',
  locations: ['record_section'],
  requiredPermissions: [CAP],
};

/**
 * Declares none — the lit control. "Not found" for the gated action must mean
 * the gate said no, not that the bar failed to render at all.
 */
const UNGATED = {
  name: 'approval_approve',
  type: 'api',
  label: 'Approve',
  target: '/api/v1/approvals/requests/{id}/approve',
  locations: ['record_section'],
};

const REQUEST = { id: 'req_1', status: 'pending', record_id: 'proj_9' };

/**
 * The decision gate in the reduced spelling the sibling suites use: the shipped
 * predicate is `cel` with `has(...)` guards, which needs the formula engine a
 * bare string does not reach. What matters here is the `can_override` term,
 * which survives the reduction — `utils/approvalOverride.test.ts` pins the
 * reader against the VERBATIM shipped predicate.
 */
const DECISION_VISIBLE = 'record.viewer.can_act || record.viewer.can_override';

function renderBar(
  actions: unknown[],
  opts: { held?: string[] | undefined; user?: boolean; record?: Record<string, unknown>; label?: string } = {},
) {
  const { held, user = true, record = REQUEST, label } = opts;
  harness.runnerContext = user
    ? { user: { id: 'u_1', name: 'Viewer', ...(held === undefined ? {} : { systemPermissions: held }) } }
    : {};
  return render(
    <DeclaredActionsBar
      objectName="sys_approval_request"
      record={record}
      location="record_section"
      actions={actions as never}
      label={label}
    />,
  );
}

beforeEach(() => {
  harness.runnerContext = {};
});

describe('DeclaredActionsBar — ADR-0066 D4 `requiredPermissions` mirror (objectui#9572)', () => {
  it('hides an action whose declared capability the viewer does not hold', () => {
    renderBar([GATED, UNGATED], { held: [] });
    // An EMPTY held array is "holds nothing", NOT "unknown" — it gates.
    expect(screen.queryByTestId('declared-action-approval_force')).toBeNull();
    // Lit control: the bar itself rendered.
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('hides it when the held set is non-empty but missing the declared capability', () => {
    renderBar([GATED, UNGATED], { held: ['setup.access'] });
    expect(screen.queryByTestId('declared-action-approval_force')).toBeNull();
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('shows it when the capability IS held', () => {
    renderBar([GATED, UNGATED], { held: [CAP, 'setup.access'] });
    expect(screen.getByTestId('declared-action-approval_force')).toBeInTheDocument();
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('requires ALL declared capabilities, not any', () => {
    renderBar([{ ...GATED, requiredPermissions: [CAP, 'setup.access'] }, UNGATED], { held: [CAP] });
    expect(screen.queryByTestId('declared-action-approval_force')).toBeNull();
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('fails OPEN when the host never reported `systemPermissions` (unknown ≠ denied)', () => {
    // The arm a careless fix breaks. The server still 403s; hiding a permitted
    // viewer's button on missing client data is the worse failure.
    renderBar([GATED, UNGATED], { held: undefined });
    expect(screen.getByTestId('declared-action-approval_force')).toBeInTheDocument();
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('fails OPEN when there is no user in the runner context at all', () => {
    renderBar([GATED, UNGATED], { user: false });
    expect(screen.getByTestId('declared-action-approval_force')).toBeInTheDocument();
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('renders no orphan chrome when every located action is gated out', () => {
    // The whole component returns null when empty, so a host never gets a
    // divider + label with nothing under it. The gate has to be applied to the
    // list the chrome decision reads, not per button.
    renderBar([GATED], { held: [], label: 'Actions' });
    expect(screen.queryByTestId('declared-action-approval_force')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByTestId('bar-separator')).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('keeps the chrome when at least one action survives the gate', () => {
    renderBar([GATED, UNGATED], { held: [], label: 'Actions' });
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });
});

describe('DeclaredActionsBar — the capability mirror and the `can_override` arm (objectui#5178)', () => {
  const OVERRIDE_VIEWER = { ...REQUEST, viewer: { can_act: false, can_override: true } };

  it('leaves the admin-override affordance intact for an action that declares no capability', () => {
    renderBar([{ ...UNGATED, visible: DECISION_VISIBLE }], { held: [], record: OVERRIDE_VIEWER });
    const btn = screen.getByTestId('declared-action-approval_approve');
    expect(btn).toBeInTheDocument();
    // Still the override treatment, not the declared one.
    expect(btn.getAttribute('data-override-decision')).toBe('true');
  });

  it('gives an override-only viewer NO exemption from a declared capability', () => {
    // `can_override` is a per-RECORD viewer flag the action's own `visible` CEL
    // reads; `requiredPermissions` is a per-CALLER capability list. They are
    // ANDed, and the override door does not open the capability one.
    renderBar([{ ...GATED, visible: DECISION_VISIBLE }, UNGATED], {
      held: [],
      record: OVERRIDE_VIEWER,
    });
    expect(screen.queryByTestId('declared-action-approval_force')).toBeNull();
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('the composition can only ever hide: a `visible`-hidden action stays hidden when the capability IS held', () => {
    renderBar([{ ...GATED, visible: DECISION_VISIBLE }, UNGATED], {
      held: [CAP],
      record: { ...REQUEST, viewer: { can_act: false, can_override: false } },
    });
    expect(screen.queryByTestId('declared-action-approval_force')).toBeNull();
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });
});
