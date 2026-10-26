// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DeclaredActionsBar (objectui#2678 P2-4) — renders + executes an object's
 * SERVER-DECLARED actions for a single record at a location, with no
 * per-action host code. Coverage:
 *   • filters declared actions by `location`;
 *   • renders nothing when nothing matches (graceful degrade);
 *   • dispatches with the record stashed under `params._rowRecord` (so the api
 *     handler resolves `{id}`) and a `params` ARRAY surfaced as `actionParams`
 *     (the runner's param-dialog input).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Capture the execute dispatch from the shared runner.
const executeSpy = vi.fn().mockResolvedValue({ success: true });

// Only the action DISPATCH is doubled here. The predicate entry
// (`useCondition` / `toPredicateInput`) is the REAL one (objectui#3835).
//
// It used to be stubbed constant-true, with a comment saying our test actions
// omit `visible` "so this is unused" — which made the component's `visible`
// gate unreachable from this suite for as long as it existed, so the truthiness
// bug objectui#3835 reports lived here untouched (the objectstack#4984 family: a
// fixture keeping a broken rule green). A re-spelled stub would not fix that:
// `visible: false` only reaches "hidden" if `toPredicateInput` passes the
// boolean through and `evaluateCondition` short-circuits it, so a stub is a
// second copy of exactly the semantics under test. `@object-ui/react`'s barrel
// is cheap for the light `dom` project (`packages/components`' own gate suite
// imports it unmocked), so the gate below is judged by the shipped evaluation
// entry instead.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAction: () => ({ execute: executeSpy }),
  };
});

// The runtime is exercised in its own suite; here it's an inert shell so the
// bar mounts without the full auth/i18n/router provider stack.
vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({ actionProviderProps: {}, dialogs: null }),
}));

vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../providers/MetadataProvider', () => ({
  // The tests pass `actions` explicitly, so the metadata fetch is skipped.
  useMetadataItem: () => ({ item: null, loading: false, error: null }),
}));

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

// Declared metadata resolves through `useObjectLabel` (falling back to the
// authored literal, which is what the render assertions below expect); the
// bar's OWN chrome resolves through `t`. Marking `t` output makes it visible
// whether a string went through the locale bundle or was baked in English.
// (`useActionTextLocalizer` — the shared action-text resolver the bar calls
// since objectui#4265 — is the REAL one from `@object-ui/react`; it reads these
// three resolvers plus `pickLocalized`, so the double has to carry all four.)
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    actionLabel: (_o: unknown, _n: unknown, fallback: string) => fallback,
    actionConfirm: (_o: unknown, _n: unknown, fallback?: string) => fallback,
    actionSuccess: (_o: unknown, _n: unknown, fallback?: string) => fallback,
  }),
  useObjectTranslation: () => ({ t: (key: string) => `t:${key}`, language: 'en' }),
  pickLocalized: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

// The components barrel is INHERITED (objectui#6892 slice 6) and only the two
// primitives this suite drives are overridden, so `hasDeclaredVisibilityGate`
// now arrives as the real barrel's re-export — the ONE definition objectui#3492
// established and PR #3816 / #3825 / #3836 spread across the other four
// member-action gates. It used to be pulled from its source module by a deep
// relative path, which the doubled barrel made necessary; the reason that
// mattered has not changed. A re-spelled `v != null && v !== ''` here would be a
// fifth copy of it living in a test double, and would keep this suite green no
// matter what the shipped predicate does (objectui#3142 is what copies of one
// answer cost).
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Button: ({ children, onClick, ...props }: any) => (
      <button onClick={onClick} {...props}>{children}</button>
    ),
    Separator: () => <hr />,
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
  };
});

import { DeclaredActionsBar } from '../DeclaredActionsBar';
// The real provider — the `@object-ui/react` double above spreads `actual`, so
// the ambient predicate scope the objectui#4080 no-row case needs is the
// shipped one, not a stand-in for it.
import { MetadataCtx, PredicateScopeProvider } from '@object-ui/react';

const REQUEST = { id: 'req_1', status: 'pending', record_id: 'proj_9' };

const ACTIONS = [
  {
    name: 'approval_approve', type: 'api', label: 'Approve',
    target: '/api/v1/approvals/requests/{id}/approve',
    locations: ['record_section'],
  },
  {
    name: 'approval_reassign', type: 'api', label: 'Reassign',
    target: '/api/v1/approvals/requests/{id}/reassign',
    locations: ['record_section'],
    params: [{ name: 'to', label: 'To', type: 'text' }],
  },
  {
    name: 'approval_bulk', type: 'api', label: 'Bulk',
    target: '/api/v1/approvals/bulk',
    locations: ['list_toolbar'],
  },
];

beforeEach(() => executeSpy.mockClear());

describe('DeclaredActionsBar', () => {
  it('renders only the actions declared at the requested location', () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        actions={ACTIONS as any}
      />,
    );
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
    expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
    // `list_toolbar`-only action must not surface at `record_section`.
    expect(screen.queryByTestId('declared-action-approval_bulk')).toBeNull();
  });

  it('drops `exclude`d actions so a host can keep some in its own UI', () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        actions={ACTIONS as any}
        exclude={['approval_approve']}
      />,
    );
    // Excluded by name — the host renders approve itself.
    expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull();
    // The rest still render.
    expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
  });

  it('renders nothing (no chrome) when `exclude` empties the located set', () => {
    const { container } = render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        label="Actions"
        actions={[ACTIONS[0]] as any}
        exclude={['approval_approve']}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no declared action matches the location', () => {
    const { container } = render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_header"
        actions={ACTIONS as any}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('dispatches with the record under params._rowRecord so {id} resolves', async () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        actions={ACTIONS as any}
      />,
    );
    fireEvent.click(screen.getByTestId('declared-action-approval_approve'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const dispatch = executeSpy.mock.calls[0][0];
    expect(dispatch).toMatchObject({
      name: 'approval_approve',
      type: 'api',
      objectName: 'sys_approval_request',
      target: '/api/v1/approvals/requests/{id}/approve',
      params: { _rowRecord: REQUEST },
    });
    // No collection params → no `actionParams`.
    expect(dispatch.actionParams).toBeUndefined();
  });

  it('surfaces a `params` array as `actionParams` for the param dialog', async () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        actions={ACTIONS as any}
      />,
    );
    fireEvent.click(screen.getByTestId('declared-action-approval_reassign'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const dispatch = executeSpy.mock.calls[0][0];
    expect(dispatch.actionParams).toEqual([{ name: 'to', label: 'To', type: 'text' }]);
    // The array is NOT left on `params` (which is reserved for the row stash).
    expect(dispatch.params).toEqual({ _rowRecord: REQUEST });
  });

  it('maps the spec action `variant` onto Button variants', () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        actions={[
          { name: 'a_primary', type: 'api', label: 'P', target: '/x', locations: ['record_section'], variant: 'primary' },
          { name: 'a_danger', type: 'api', label: 'D', target: '/x', locations: ['record_section'], variant: 'danger' },
          { name: 'a_plain', type: 'api', label: 'N', target: '/x', locations: ['record_section'] },
          { name: 'a_ghost', type: 'api', label: 'G', target: '/x', locations: ['record_section'], variant: 'ghost' },
        ] as any}
      />,
    );
    // primary → the filled default; danger → destructive (the two names the
    // spec enum and Button component spell differently); undeclared → outline;
    // the rest pass through unchanged.
    expect(screen.getByTestId('declared-action-a_primary')).toHaveAttribute('variant', 'default');
    expect(screen.getByTestId('declared-action-a_danger')).toHaveAttribute('variant', 'destructive');
    expect(screen.getByTestId('declared-action-a_plain')).toHaveAttribute('variant', 'outline');
    expect(screen.getByTestId('declared-action-a_ghost')).toHaveAttribute('variant', 'ghost');
  });

  it('renders a labeled divider only when actions are present', () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        label="Actions"
        actions={ACTIONS as any}
      />,
    );
    expect(screen.getByText('Actions')).toBeInTheDocument();
    // Empty location → no divider/label chrome at all.
    const { container: empty } = render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_header"
        label="Actions"
        actions={ACTIONS as any}
      />,
    );
    expect(empty.firstChild).toBeNull();
  });
});

// objectui#2762 P0-3. The declared action LABELS localize via `useObjectLabel`,
// but two strings the bar authors itself were baked in English and bypassed
// i18n entirely — so a zh-CN workspace got 通过 / 拒绝 buttons sitting inside an
// "Actions" toolbar, with English help text under the decision-output fields.
//
// The help text is the subtler one: those params are synthesized here from the
// record's `decision_output_defs`, so their key path (`outputs.<key>`) is
// dynamic and no `_actions.<action>.params.*` bundle entry can ever match it.
// The runtime's `actionParamText` pass therefore always falls through to the
// literal — the literal IS what renders, every time.
describe('DeclaredActionsBar chrome localization (objectui#2762)', () => {
  it('localizes the toolbar aria-label instead of hardcoding "Actions"', () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        actions={ACTIONS as any}
      />,
    );
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', 't:common.actions');
  });

  it('still prefers a host-supplied label over the translated default', () => {
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={REQUEST}
        location="record_section"
        label="决策"
        actions={ACTIONS as any}
      />,
    );
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', '决策');
  });

  it.each([
    ['/api/v1/approvals/requests/{id}/approve', true],
    ['/api/v1/approvals/requests/{id}/reject', false],
  ])('marks a required output required on %s → %s', async (target, expected) => {
    // The server enforces `required` on approve and never on reject; the two
    // dialogs must differ in exactly that flag (objectui#2955).
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={{
          ...REQUEST,
          decision_output_defs: [{ key: 'parallel_positions', type: 'position', required: true }],
        }}
        location="record_section"
        actions={[{
          name: 'decide', type: 'api', label: 'Decide', target, locations: ['record_section'],
        }] as any}
      />,
    );
    fireEvent.click(screen.getByText('Decide'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalled());
    const params = executeSpy.mock.calls[0][0].actionParams as Array<Record<string, unknown>>;
    expect(params[0].required).toBe(expected);
  });

  it('hands the picker target under `reference`, the key that survives resolution', async () => {
    // objectui#2955: the params are spelled for `resolveActionParams`, which
    // rebuilds an inline param from a fixed key list and reads the target from
    // `reference`. Spelled `referenceTo` the target was dropped, and the
    // Approval Center rendered a "paste a record id" text box where a
    // sys_position multi-select belonged. The full round trip is pinned in
    // `utils/decisionOutputParams.test.ts`; this pins what the BAR emits for a
    // record kind (a `position` output lists the registry since objectui#7611 —
    // pinned below).
    const decideAction = {
      name: 'approval_approve',
      type: 'api',
      label: 'Approve',
      target: '/api/v1/approvals/requests/{id}/approve',
      locations: ['record_section'],
    };
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={{
          ...REQUEST,
          decision_output_defs: [
            { key: 'owning_teams', label: '负责团队', type: 'team', multiple: true },
          ],
        }}
        location="record_section"
        actions={[decideAction] as any}
      />,
    );

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalled());

    const params = executeSpy.mock.calls[0][0].actionParams as Array<Record<string, unknown>>;
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({
      name: 'outputs.owning_teams',
      label: '负责团队',
      type: 'lookup',
      reference: 'sys_team',
      multiple: true,
    });
    expect(params[0].referenceTo).toBeUndefined();
  });

  it('lists the position registry for a position output and offers names (objectui#7611)', async () => {
    // ADR-0131 D3/D4: positions live in the environment registry and are
    // referenced by machine name. The bar reads the registry through the
    // console's metadata store — the reader `RecipientPickerField` lists the
    // same registry through — and hands the dialog a select whose values are
    // the names the engine routes by. A fresh database has no `sys_position`
    // rows, so the lookup this replaces offered nothing.
    const ensureType = vi.fn(async (type: string) =>
      type === 'position'
        ? [{ name: 'manager', label: 'Project Manager' }, { name: 'auditor', label: 'Auditor' }]
        : [],
    );
    const store = { ensureType } as unknown as React.ContextType<typeof MetadataCtx>;
    render(
      <MetadataCtx.Provider value={store}>
        <DeclaredActionsBar
          objectName="sys_approval_request"
          record={{
            ...REQUEST,
            decision_output_defs: [
              { key: 'parallel_positions', label: '并行会审岗位', type: 'position', multiple: true },
            ],
          }}
          location="record_section"
          actions={[{
            name: 'approval_approve', type: 'api', label: 'Approve',
            target: '/api/v1/approvals/requests/{id}/approve', locations: ['record_section'],
          }] as any}
        />
      </MetadataCtx.Provider>,
    );

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalled());

    expect(ensureType.mock.calls).toEqual([['position']]);
    const params = executeSpy.mock.calls[0][0].actionParams as Array<Record<string, unknown>>;
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({
      name: 'outputs.parallel_positions',
      label: '并行会审岗位',
      type: 'select',
      multiple: true,
      options: [
        { value: 'auditor', label: 'Auditor' },
        { value: 'manager', label: 'Project Manager' },
      ],
    });
    expect(params[0].reference).toBeUndefined();
  });

  it('dispatches in the click\'s own tick when no output lists the registry (objectui#7611)', () => {
    // Only a decision with a catalog output waits for the registry read; every
    // other decision dispatches synchronously, as it did before — a store is
    // mounted here, so it is the OUTPUTS that decide, not the store's absence.
    const ensureType = vi.fn(async () => []);
    const store = { ensureType } as unknown as React.ContextType<typeof MetadataCtx>;
    render(
      <MetadataCtx.Provider value={store}>
        <DeclaredActionsBar
          objectName="sys_approval_request"
          record={{ ...REQUEST, decision_output_defs: [{ key: 'owning_team', type: 'team' }] }}
          location="record_section"
          actions={[{
            name: 'approval_approve', type: 'api', label: 'Approve',
            target: '/api/v1/approvals/requests/{id}/approve', locations: ['record_section'],
          }] as any}
        />
      </MetadataCtx.Provider>,
    );

    fireEvent.click(screen.getByText('Approve'));

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(ensureType).not.toHaveBeenCalled();
  });

  it('localizes the decision-output help text', async () => {
    const decideAction = {
      name: 'approval_approve',
      type: 'api',
      label: 'Approve',
      target: '/api/v1/approvals/requests/{id}/approve',
      locations: ['record_section'],
    };
    render(
      <DeclaredActionsBar
        objectName="sys_approval_request"
        record={{
          ...REQUEST,
          decision_output_defs: [
            { key: 'reviewer', type: 'user' },
            { key: 'owning_team', type: 'team' },
            { key: 'notes' },
          ],
        }}
        location="record_section"
        actions={[decideAction] as any}
      />,
    );

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(executeSpy).toHaveBeenCalled());

    const params = executeSpy.mock.calls[0][0].actionParams as Array<Record<string, unknown>>;
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(byName['outputs.reviewer'].helpText).toBe('t:actions.decisionOutput.help');
    expect(byName['outputs.owning_team'].helpText).toBe('t:actions.decisionOutput.help');
    // The free-text variant carries the extra comma-separation sentence.
    expect(byName['outputs.notes'].helpText).toBe('t:actions.decisionOutput.helpMultiValue');
  });
});

/**
 * objectui#3835 — the declared-action `visible` gate. Fifth and hottest member
 * of the objectui#3492 family: `if (action.visible && !isVisible) return null`
 * asked TRUTHINESS, so `visible: false` — the most explicit "never show this" an
 * author can write — was classified as "no gate declared", the verdict was never
 * consulted, and the action rendered for everyone.
 *
 * Why this surface is the hot one, and why the family's mitigation does not
 * cover it:
 *
 *   • The actions are SERVER-DECLARED (`objectDef.actions[]` /
 *     `sys_approval_request`), not hand-written view JSON, so "spec's
 *     `ExpressionInputSchema` has no boolean member, `objectstack build` cannot
 *     emit one" does not apply — the def arrives from server metadata and
 *     in-process construction, where a boolean is the natural spelling.
 *   • `DeclaredActionsBar` is mounted as plain JSX by its hosts
 *     (`apps/console/src/pages/system/ApprovalsInboxPage.tsx:2014` and `:2055`),
 *     so `packages/react`'s `SchemaRenderer` — which hides a node whose
 *     `visible !== undefined` evaluates false, and which made the component-level
 *     gates of objectui#3812 dormant — is not on this path at all. This gate is
 *     the only one there.
 *   • What renders is the approvals inbox's record-section bar: Approve / Reject
 *     / Reassign. A `visible: false` approval action rendered as a live button is
 *     one click away from a real approve/reject call.
 *
 * The gate now asks `hasDeclaredVisibilityGate` (`!= null && !== ''`), imported
 * from `@object-ui/components` rather than re-spelled — the verdict stays with
 * the evaluation entry, which short-circuits a boolean instead of calling the
 * expression engine.
 *
 * All FOUR shapes are asserted, and each one is load-bearing in a different
 * direction:
 *   • `false` hides — the defect itself (red before the fix);
 *   • `true` renders and undeclared renders — the anti-mutation guards: "hide
 *     the action unconditionally" satisfies every `visible: false` assertion on
 *     its own and would otherwise leave the suite green;
 *   • `''` renders — green BEFORE and AFTER the fix, and (measured, not assumed)
 *     green even under a gate mutated to `visible !== undefined`. On THIS
 *     surface `''` is covered twice: over-tightening the gate hands `''` to the
 *     evaluation entry, and `toPredicateInput('')` is `undefined`, which
 *     `evaluateCondition` reads as "no condition → visible". So this case
 *     documents the intended semantics; it is not a mutation detector here, and
 *     a reader should not mistake its passing for proof that the gate's `!== ''`
 *     limb is exercised (the limb itself is pinned in `packages/components`,
 *     next to the definition).
 * Every case carries the ungated `COMPANION`, so a passing "not rendered" can
 * never mean "the whole bar returned null" (the bar renders nothing at all when
 * its located set is empty — a distinct code path, two lines away).
 */
const COMPANION = {
  name: 'approval_reassign',
  type: 'api',
  label: 'Reassign',
  target: '/api/v1/approvals/requests/{id}/reassign',
  locations: ['record_section'],
};

function renderWithGate(action: Record<string, unknown>, record: Record<string, unknown> = REQUEST) {
  return render(
    <DeclaredActionsBar
      objectName="sys_approval_request"
      record={record}
      location="record_section"
      actions={[action, COMPANION] as any}
    />,
  );
}

describe('DeclaredActionsBar — declared `visible` on a server-declared action (objectui#3835)', () => {
  const APPROVE = {
    name: 'approval_approve',
    type: 'api',
    label: 'Approve',
    target: '/api/v1/approvals/requests/{id}/approve',
    locations: ['record_section'],
  };

  it('visible:false → the declared action does not render', () => {
    renderWithGate({ ...APPROVE, visible: false });
    expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull();
    // The bar itself rendered — the assertion above is about the gate, not about
    // an empty located set.
    expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
  });

  it('visible:true → the declared action renders', () => {
    renderWithGate({ ...APPROVE, visible: true });
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
    expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
  });

  it('no `visible` at all → the declared action renders (ungated stays ungated)', () => {
    renderWithGate({ ...APPROVE });
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('an empty-string `visible` is not a declared gate — the action still renders', () => {
    renderWithGate({ ...APPROVE, visible: '' });
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('an expression-valued `visible` keeps its verdict — false hides, true shows', () => {
    const gated = { ...APPROVE, visible: 'record.status == "pending"' };
    const { unmount } = renderWithGate(gated, { ...REQUEST, status: 'approved' });
    expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull();
    expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
    unmount();
    renderWithGate(gated, { ...REQUEST, status: 'pending' });
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('a bare-field `visible` no longer discriminates (objectui#5741) — hidden on BOTH rows, reported once', () => {
    // Phase 2 of the objectui#5330 canon: the row is bound as `record.*` only,
    // so `status` is an unknown variable. This leg opts into `throwOnError`, so
    // its EXISTING policy is fail-closed: the same verdict on the holding row
    // and the failing one, and one console line naming the variable. The
    // ungated companion proves the bar rendered.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const gated = { ...APPROVE, visible: 'status == "pending"' };
      const { unmount } = renderWithGate(gated, { ...REQUEST, status: 'pending' });
      expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull();
      expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
      unmount();
      renderWithGate(gated, { ...REQUEST, status: 'approved' });
      expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull();
      expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
      const reports = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('was hidden/disabled: its predicate threw'));
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('status is not defined');
      expect(reports[0]).toContain('declared action "approval_approve" (visible)');
    } finally {
      warn.mockRestore();
    }
  });

  it('a `${…}`-spelled `visible` keeps its verdict — true shows, false hides (objectui#3871)', () => {
    // This leg opts into `throwOnError`, so the double wrap did not read as
    // truthy here: `'${${…}}'` THREW inside the evaluator and `useCondition`'s
    // fail-closed branch turned that into "hidden". Measured before the fix:
    // Approve was absent in BOTH halves below, i.e. a server-declared approval
    // action gated with the documented template spelling was invisible to every
    // approver even while its gate held. That is the direction objectui#3871's
    // card did not predict (it expected a constant "shown", which is what the
    // fail-SOFT legs in `packages/components` did).
    //
    // Reverse verification: the `pending` half is the detector; the `approved`
    // half stays green either way (hidden is hidden), and the companion
    // assertion is what keeps that half from meaning "the bar vanished".
    const gated = { ...APPROVE, visible: '${record.status === "pending"}' };
    const { unmount } = renderWithGate(gated, { ...REQUEST, status: 'approved' });
    expect(screen.queryByTestId('declared-action-approval_approve')).toBeNull();
    expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
    unmount();
    renderWithGate(gated, { ...REQUEST, status: 'pending' });
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });

  it('a hidden action leaves NO clickable surface in the toolbar', async () => {
    // Hiding is not cosmetic on this surface: this component's own click handler
    // is what POSTs the approve/reject call, so what matters is that the gated
    // action contributes no button at all — not merely that a query by testid
    // misses it. Asserting the toolbar's button SET (rather than clicking the
    // companion and counting dispatches) is what makes this case move: an
    // unclicked extra button dispatches nothing either way, so a
    // dispatch-counting version of this test was green before the fix too.
    renderWithGate({ ...APPROVE, visible: false });
    const buttons = screen.getByRole('toolbar').querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('data-testid', 'declared-action-approval_reassign');
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    expect(executeSpy.mock.calls[0][0]).toMatchObject({ name: 'approval_reassign' });
  });
});

/**
 * objectui#3842 — the declared `disabled` gate on the same surface, and the
 * half of the objectui#3492 family where the `''` reasoning INVERTS.
 *
 * The gate asked `(action as any).disabled != null`, so `disabled: ''` counted
 * as "a gate is declared" and the verdict went to the evaluation entry — which
 * reads an empty predicate as "no condition → true"
 * (`toPredicateInput('')` → `undefined` → `evaluateCondition(undefined)` →
 * `true`). Direction is everything: on `visible` that `true` means SHOW, so the
 * over-broad "declared" test and the permissive empty predicate cancel out
 * (which is why the `visible: ''` case above is documentation, not a detector,
 * and says so). On `disabled` the same `true` means DISABLE, so the two
 * compound: an empty predicate stopped meaning "no gate" and started meaning
 * "greyed out forever".
 *
 * What that costs on THIS surface: the actions are server-declared
 * (`objectDef.actions[]`) and the bar's own hosts are the approvals inbox's
 * record sections, so a `disabled: ''` — an authoring form left empty, a
 * template that rendered to an empty string — greys out Approve / Reject with
 * no way for the approver to tell metadata intent from a bug. objectui#3835 was
 * the same surface failing the other way (hidden action still clickable).
 *
 * `''` IS a mutation detector here, unlike on `visible`: restore `!= null` and
 * this block's first case goes red on its own. All four shapes are asserted
 * because "never disable anything" satisfies three of them, and `disabled: true`
 * is what refuses that rewrite.
 *
 * No legacy `enabled` leg on this surface by design (see the component: server-
 * declared actions are spec-shaped and never carried the non-spec key) — that
 * leg's four shapes are pinned in `packages/components`, next to the renderer
 * that has it.
 */
describe('DeclaredActionsBar — declared `disabled` on a server-declared action (objectui#3842)', () => {
  const APPROVE = {
    name: 'approval_approve',
    type: 'api',
    label: 'Approve',
    target: '/api/v1/approvals/requests/{id}/approve',
    locations: ['record_section'],
  };
  const approve = () => screen.getByTestId('declared-action-approval_approve');

  it("an empty-string `disabled` is not a declared gate — Approve stays clickable", () => {
    renderWithGate({ ...APPROVE, disabled: '' });
    expect(approve()).not.toBeDisabled();
  });

  it('disabled:true → Approve is disabled', () => {
    renderWithGate({ ...APPROVE, disabled: true });
    expect(approve()).toBeDisabled();
  });

  it('disabled:false → Approve is not disabled', () => {
    renderWithGate({ ...APPROVE, disabled: false });
    expect(approve()).not.toBeDisabled();
  });

  it('no `disabled` at all → Approve is not disabled (ungated stays ungated)', () => {
    renderWithGate({ ...APPROVE });
    expect(approve()).not.toBeDisabled();
  });

  it('an expression-valued `disabled` keeps its verdict — true disables, false does not', () => {
    const gated = { ...APPROVE, disabled: 'record.status == "approved"' };
    const { unmount } = renderWithGate(gated, { ...REQUEST, status: 'approved' });
    expect(approve()).toBeDisabled();
    unmount();
    renderWithGate(gated, { ...REQUEST, status: 'pending' });
    expect(approve()).not.toBeDisabled();
  });

  it('a bare-field `disabled` no longer discriminates (objectui#5741) — disabled on BOTH rows (fail-soft leg)', () => {
    // The `disabled` leg does not opt into `throwOnError`, so its EXISTING
    // policy is fail-soft `true`: an unbound `status` faults and greys Approve
    // on the holding row and the failing one alike. Pinned as the fail-soft
    // half of the ruling, next to the fail-closed `visible` half above.
    const gated = { ...APPROVE, disabled: 'status == "approved"' };
    const { unmount } = renderWithGate(gated, { ...REQUEST, status: 'approved' });
    expect(approve()).toBeDisabled();
    unmount();
    renderWithGate(gated, { ...REQUEST, status: 'pending' });
    expect(approve()).toBeDisabled();
  });

  it('a `${…}`-spelled `disabled` keeps its verdict — false leaves Approve clickable (objectui#3871)', () => {
    // `toPredicateInput` used to wrap EVERY string, so `'${…}'` — a spelling
    // AGENTS.md §4 documents and this bar's own `visible` sibling accepts —
    // became `'${${…}}'`, unparseable, returned verbatim, `Boolean(…)` = a
    // constant `true`. On THIS key that constant means Approve / Reject greyed
    // out permanently on a server-declared action, with nothing the metadata
    // author could write to un-grey it.
    //
    // Reverse verification: the `pending` half below is the detector (it was
    // disabled before the fix); the `approved` half was green already, since
    // "disabled because the predicate holds" and "disabled because it could not
    // be parsed" look identical from here.
    const gated = { ...APPROVE, disabled: '${record.status === "approved"}' };
    const { unmount } = renderWithGate(gated, { ...REQUEST, status: 'approved' });
    expect(approve()).toBeDisabled();
    unmount();
    renderWithGate(gated, { ...REQUEST, status: 'pending' });
    expect(approve()).not.toBeDisabled();
  });

  it('an empty-string `disabled` leaves an Approve that actually DISPATCHES', async () => {
    // Not-disabled is only the visible half of the claim. The `disabled`
    // attribute is what this component hands its own click handler — the one
    // that POSTs the approve call — so the case worth pinning is that the
    // button reaches `execute`, not merely that an attribute is absent.
    renderWithGate({ ...APPROVE, disabled: '' });
    fireEvent.click(approve());
    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    expect(executeSpy.mock.calls[0][0]).toMatchObject({ name: 'approval_approve' });
  });
});

/**
 * objectui#4080 — the bar binds the row through the SHARED
 * `usePredicateRecordContext`, not through a local copy of that expression.
 *
 * objectui#4077 fixed the root-only binding here with an inline
 * `{ ...row, record: row, data: row }`; objectui#4079 fixed the same fault on
 * the four generic action renderers and gave the rule one name instead of a
 * fifth copy. objectui#5741 (Phase 2 of the objectui#5330 canon) then narrowed
 * that shared rule to `{ record: row }`: the bare-field and `data.*` spellings
 * are no longer bound anywhere, and this bar follows the helper. The two cases
 * below are deliberately different in kind:
 *
 *   • the ROW-PRESENT case pins the helper's CURRENT rule as this bar sees it:
 *     `record.*` discriminates, the two retired spellings reach the SAME
 *     verdict on the holding row and the failing one (they fault, and this
 *     leg's existing policy is fail-closed). It is here so the reachable path
 *     — the only path any host drives today — is pinned against a future edit
 *     to the helper, which owns the verdict for this bar too.
 *   • the NO-ROW case is the CONVERGENCE detector, and the one difference the
 *     two copies ever had. `usePredicateRecordContext` binds NOTHING when there
 *     is no row; the inline copy bound `{ record: {}, data: {} }`. Since
 *     `useCondition` merges this context OVER the ambient predicate scope, the
 *     inline shape blanks out a `record` the HOST put in the scope — a
 *     legitimate pattern, and how `action-group-dropdown-visible.test.tsx`
 *     drives the group's dropdown leaves. No host mounts this bar without a
 *     row today, so this case is unreachable in production; it is exercised
 *     here precisely because it is where the copies part, and it is what goes
 *     red if the inline expression comes back.
 */
describe('DeclaredActionsBar — the row binds through the shared helper (objectui#4080)', () => {
  const APPROVE = {
    name: 'approval_approve',
    type: 'api',
    label: 'Approve',
    target: '/api/v1/approvals/requests/{id}/approve',
    locations: ['record_section'],
  };

  it('with a row present, `record.*` reaches both verdicts through the shared helper', () => {
    // Both halves: "renders" alone is satisfied by a bar that ignores `visible`
    // entirely, which is the mutation objectui#3835 was.
    const visible = 'record.status == "pending"';
    const shown = renderWithGate({ ...APPROVE, visible }, { ...REQUEST, status: 'pending' });
    expect(screen.getByTestId('declared-action-approval_approve'), visible).toBeInTheDocument();
    shown.unmount();

    const hidden = renderWithGate({ ...APPROVE, visible }, { ...REQUEST, status: 'approved' });
    expect(screen.queryByTestId('declared-action-approval_approve'), visible).toBeNull();
    // The ungated companion proves the bar itself rendered — "not found" here
    // must mean the gate said no, not that the located set was empty.
    expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
    hidden.unmount();
  });

  it('with a row present, the two retired spellings reach the SAME verdict on both rows (objectui#5741)', () => {
    // The helper binds `{ record: row }` only, so these fault; the bar's
    // `visible` leg is fail-closed, so "the same verdict" is hidden twice —
    // with the companion present both times, so hidden means the gate faulted,
    // not that the bar vanished.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const visible of ['status == "pending"', 'data.status == "pending"']) {
        const holding = renderWithGate({ ...APPROVE, visible }, { ...REQUEST, status: 'pending' });
        expect(screen.queryByTestId('declared-action-approval_approve'), visible).toBeNull();
        expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
        holding.unmount();

        const failing = renderWithGate({ ...APPROVE, visible }, { ...REQUEST, status: 'approved' });
        expect(screen.queryByTestId('declared-action-approval_approve'), visible).toBeNull();
        expect(screen.getByTestId('declared-action-approval_reassign')).toBeInTheDocument();
        failing.unmount();
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('with NO row of its own, the bar does not shadow a host-supplied ambient `record`', () => {
    render(
      <PredicateScopeProvider scope={{ record: { status: 'pending' } }}>
        <DeclaredActionsBar
          objectName="sys_approval_request"
          record={undefined}
          location="record_section"
          actions={[
            { ...APPROVE, visible: 'record.status == "pending"' },
            COMPANION,
          ] as any}
        />
      </PredicateScopeProvider>,
    );
    // Under the inline copy this was hidden: `record` merged down to `{}`, so
    // the host's row never reached the predicate and a fail-closed `visible`
    // turned that into "hidden".
    expect(screen.getByTestId('declared-action-approval_approve')).toBeInTheDocument();
  });
});
