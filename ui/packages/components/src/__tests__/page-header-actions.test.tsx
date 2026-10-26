/**
 * Tests for PageHeaderRenderer header actions slot.
 *
 * Custom (authored) record detail pages embed action buttons directly on
 * `page:header.actions` (or `.properties.actions`). Without this slot,
 * actions such as Lead → "Convert Lead" silently disappear.
 */

import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type {
  ActionContext,
  ActionDef,
  ActionResult,
  ParamCollectionHandler,
} from '@object-ui/core';
import {
  ActionProvider,
  RecordContextProvider,
  InlineEditProvider,
  useInlineEdit,
  PredicateScopeProvider,
} from '@object-ui/react';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

function renderHeader(schema: any, opts?: { record?: any; objectSchema?: any; execute?: any; headerSystemActions?: any[]; scope?: any }) {
  const execute = opts?.execute ?? vi.fn(async () => ({ success: true }));
  let ui = (
    <ActionProvider>
      {opts?.record !== undefined ? (
        <RecordContextProvider
          objectName="lead"
          recordId={opts.record?.id ?? null}
          data={opts.record}
          objectSchema={opts?.objectSchema ?? { name: 'lead', label: 'Lead' }}
          headerSystemActions={opts?.headerSystemActions}
        >
          <PageHeader schema={schema} />
        </RecordContextProvider>
      ) : (
        <PageHeader schema={schema} />
      )}
    </ActionProvider>
  );
  if (opts?.scope) {
    ui = <PredicateScopeProvider scope={opts.scope}>{ui}</PredicateScopeProvider>;
  }
  const utils = render(ui);
  return { ...utils, execute };
}

describe('PageHeaderRenderer — actions slot', () => {
  it('renders inline schema.actions as buttons', () => {
    renderHeader({
      type: 'page:header',
      title: 'Lead',
      actions: [
        { name: 'convert', locations: ['record_header'], label: 'Convert Lead', type: 'flow' },
      ],
    });
    expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
  });

  it('renders schema.properties.actions (spec bridge variant)', () => {
    renderHeader({
      type: 'page:header',
      properties: {
        title: 'Lead',
        actions: [
          { name: 'convert', locations: ['record_header'], label: 'Convert Lead', type: 'flow' },
        ],
      },
    });
    expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
  });

  it('skips actions whose locations exclude record_header', () => {
    renderHeader({
      type: 'page:header',
      actions: [
        { name: 'a', label: 'Header Action', locations: ['record_header'] },
        { name: 'b', label: 'List Only', locations: ['list_item'] },
      ],
    });
    expect(screen.getByRole('button', { name: /Header Action/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /List Only/i })).toBeNull();
  });

  // [#3142] An AUTHORED action must declare its placement — the header used to
  // render an undeclared one, alone among the surfaces that draw the same
  // record's actions (RecordDetailView pre-filters strictly, and the
  // synthesizer's own contract already said "must include
  // `locations: ['record_header']` to render"). Host-injected chrome is
  // exempt, which the next test pins.
  it('skips an authored action that declares no placement', () => {
    renderHeader({
      type: 'page:header',
      actions: [
        { name: 'declared', label: 'Declared Action', locations: ['record_header'] },
        { name: 'undeclared', label: 'Undeclared Action' },
        { name: 'empty', label: 'Empty Placement', locations: [] },
      ],
    });
    expect(screen.getByRole('button', { name: /Declared Action/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Undeclared Action/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Empty Placement/i })).toBeNull();
  });

  it('still renders host system actions that declare no placement — chrome is placed by the host', async () => {
    // The host injects Edit/Share/Delete; nobody authored a `locations` for
    // them, and `action:bar` has always exempted its `systemActions` slot for
    // exactly that reason. Before #3142 this renderer filtered them, so the
    // same `sys_delete` obeyed two rules depending on which drew the header.
    renderHeader(
      { type: 'page:header', title: 'Lead' },
      {
        record: { id: '1' },
        headerSystemActions: [{ name: 'sys_delete', label: 'Delete Record' }],
      },
    );
    // A destructive host action renders in the `⋯`, never as an inline
    // button (objectui#12617) — rendered either way, which is this pin.
    expect(screen.queryByRole('button', { name: /Delete Record/i })).toBeNull();
    const trigger = screen.getByRole('button', { name: /More actions/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Delete Record/i })).toBeTruthy());
  });

  it('shows action when visible expression matches record', () => {
    renderHeader(
      {
        type: 'page:header',
        actions: [
          {
            name: 'convert',
            locations: ['record_header'],
            label: 'Convert Lead',
            visible: 'record.status == "qualified"',
          },
        ],
      },
      { record: { id: '1', status: 'qualified' } },
    );
    expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
  });

  it('hides action when visible expression does not match record', () => {
    renderHeader(
      {
        type: 'page:header',
        actions: [
          {
            name: 'convert',
            locations: ['record_header'],
            label: 'Convert Lead',
            visible: 'record.status == "qualified"',
          },
        ],
      },
      { record: { id: '1', status: 'new' } },
    );
    expect(screen.queryByRole('button', { name: /Convert Lead/i })).toBeNull();
  });

  it('honors structured visible: { dialect, source }', () => {
    renderHeader(
      {
        type: 'page:header',
        actions: [
          {
            name: 'convert',
            locations: ['record_header'],
            label: 'Convert Lead',
            visible: { dialect: 'cel', source: 'record.status == "qualified"' },
          },
        ],
      },
      { record: { id: '1', status: 'qualified' } },
    );
    expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
  });

  it('respects hidden: true', () => {
    renderHeader({
      type: 'page:header',
      actions: [
        { name: 'shown', locations: ['record_header'], label: 'Shown' },
        { name: 'gone', locations: ['record_header'], label: 'Hidden Action', hidden: true },
      ],
    });
    expect(screen.getByRole('button', { name: /Shown/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Hidden Action/i })).toBeNull();
  });

  it('emits a toolbar role with aria-label when actions render', () => {
    renderHeader({
      type: 'page:header',
      actions: [{ name: 'a', locations: ['record_header'], label: 'A' }],
    });
    const bar = screen.getByRole('toolbar', { name: /Page header actions/i });
    expect(bar).toBeTruthy();
  });

  it('falls back to the data-page-actions-slot div when no actions provided', () => {
    const { container } = renderHeader({
      type: 'page:header',
      title: 'Empty',
    });
    expect(container.querySelector('[data-page-actions-slot]')).toBeTruthy();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('invokes onClick when an action button is clicked', () => {
    const onClick = vi.fn();
    renderHeader({
      type: 'page:header',
      actions: [{ name: 'a', locations: ['record_header'], label: 'Click Me', onClick }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Click Me/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('appends host-provided headerSystemActions after authored actions', () => {
    renderHeader(
      {
        type: 'page:header',
        actions: [{ name: 'biz', locations: ['record_header'], label: 'Convert Lead' }],
      },
      {
        record: { id: '1' },
        headerSystemActions: [
          { name: 'sys_edit', label: '编辑' },
          { name: 'sys_share', label: '分享' },
          { name: 'sys_delete', label: '删除', variant: 'destructive' },
        ],
      },
    );
    // The host's buttons stay inline beside the authored action and the
    // host's destructive Delete folds into the `⋯` (objectui#12617). We
    // assert the authored action is rendered as a button and the overflow
    // trigger is present (full menu contents are exercised by separate
    // dropdown interaction tests).
    expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
  });

  it('dedupes by name — authored beats host system action with same name', () => {
    renderHeader(
      {
        type: 'page:header',
        actions: [{ name: 'sys_edit', locations: ['record_header'], label: 'Authored Edit' }],
      },
      {
        record: { id: '1' },
        headerSystemActions: [{ name: 'sys_edit', label: 'System Edit' }],
      },
    );
    expect(screen.getByRole('button', { name: /Authored Edit/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^System Edit$/i })).toBeNull();
  });

  it('renders host system actions even when schema has no actions array', () => {
    renderHeader(
      { type: 'page:header', title: 'Lead' },
      {
        record: { id: '1' },
        headerSystemActions: [{ name: 'sys_edit', label: '编辑' }],
      },
    );
    expect(screen.getByRole('button', { name: /编辑/i })).toBeTruthy();
  });
});

describe('PageHeaderRenderer — inline-edit session gate (objectui#2572)', () => {
  // Enters the shared inline-edit session on mount, simulating a user
  // double-clicking a field in the record body.
  function EnterInlineEdit() {
    const inline = useInlineEdit()!;
    useEffect(() => {
      inline.enter();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }

  function renderWithInlineEdit(opts: { editing: boolean; actions: any[] }) {
    return render(
      <ActionProvider>
        <RecordContextProvider
          objectName="proj"
          recordId="1"
          data={{ id: '1' }}
          objectSchema={{ name: 'proj', label: 'Project' }}
          headerSystemActions={opts.actions}
        >
          <InlineEditProvider canEdit>
            {opts.editing && <EnterInlineEdit />}
            <PageHeader schema={{ type: 'page:header', title: 'Project' }} />
          </InlineEditProvider>
        </RecordContextProvider>
      </ActionProvider>,
    );
  }

  const editCta = { name: 'sys_edit', locations: ['record_header'], label: 'Edit', disableDuringInlineEdit: true };

  it('disables a `disableDuringInlineEdit` action while the session is active', () => {
    renderWithInlineEdit({ editing: true, actions: [editCta] });
    expect(screen.getByRole('button', { name: /Edit/i })).toBeDisabled();
  });

  it('keeps the action enabled when no session is active', () => {
    renderWithInlineEdit({ editing: false, actions: [editCta] });
    expect(screen.getByRole('button', { name: /Edit/i })).toBeEnabled();
  });

  it('leaves unflagged actions alone during the session', () => {
    renderWithInlineEdit({
      editing: true,
      actions: [editCta, { name: 'convert', locations: ['record_header'], label: 'Convert' }],
    });
    expect(screen.getByRole('button', { name: /Edit/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Convert/i })).toBeEnabled();
  });
});

describe('PageHeaderRenderer — inline/overflow split (objectui#2361)', () => {
  it('renders up to three actions side-by-side with no overflow menu', () => {
    renderHeader({
      type: 'page:header',
      actions: [
        { name: 'convert', locations: ['record_header'], label: 'Convert Lead' },
        { name: 'assign', locations: ['record_header'], label: 'Assign' },
        { name: 'return', locations: ['record_header'], label: 'Return' },
      ],
    });
    expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Assign/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Return/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More actions/i })).toBeNull();
  });

  it('overflows past the default maxVisible of 3', () => {
    renderHeader({
      type: 'page:header',
      actions: [
        { name: 'a', locations: ['record_header'], label: 'Action A' },
        { name: 'b', locations: ['record_header'], label: 'Action B' },
        { name: 'c', locations: ['record_header'], label: 'Action C' },
        { name: 'd', locations: ['record_header'], label: 'Action D' },
      ],
    });
    expect(screen.getByRole('button', { name: /Action C/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Action D/i })).toBeNull();
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
  });

  it('honors a schema-level maxVisible override', () => {
    renderHeader({
      type: 'page:header',
      maxVisible: 1,
      actions: [
        { name: 'a', locations: ['record_header'], label: 'Action A' },
        { name: 'b', locations: ['record_header'], label: 'Action B' },
      ],
    });
    expect(screen.getByRole('button', { name: /Action A/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Action B/i })).toBeNull();
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
  });

  it('reads maxVisible from properties (spec bridge variant)', () => {
    renderHeader({
      type: 'page:header',
      properties: {
        maxVisible: 4,
        actions: [
          { name: 'a', locations: ['record_header'], label: 'Action A' },
          { name: 'b', locations: ['record_header'], label: 'Action B' },
          { name: 'c', locations: ['record_header'], label: 'Action C' },
          { name: 'd', locations: ['record_header'], label: 'Action D' },
        ],
      },
    });
    expect(screen.getByRole('button', { name: /Action D/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More actions/i })).toBeNull();
  });

  it('promotes a lower `order` into the inline slots (#2339 rule)', () => {
    renderHeader({
      type: 'page:header',
      maxVisible: 1,
      actions: [
        { name: 'a', locations: ['record_header'], label: 'Action A' },
        { name: 'b', locations: ['record_header'], label: 'Action B', order: -1 },
      ],
    });
    expect(screen.getByRole('button', { name: /Action B/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Action A/i })).toBeNull();
  });

  it('prefers variant: primary as a tie-break within equal order', () => {
    renderHeader({
      type: 'page:header',
      maxVisible: 1,
      actions: [
        { name: 'a', locations: ['record_header'], label: 'Action A' },
        { name: 'b', locations: ['record_header'], label: 'Action B', variant: 'primary' },
      ],
    });
    expect(screen.getByRole('button', { name: /Action B/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Action A/i })).toBeNull();
  });

  it('pins component: action:menu actions into the overflow menu even below maxVisible', () => {
    renderHeader({
      type: 'page:header',
      actions: [
        { name: 'convert', locations: ['record_header'], label: 'Convert Lead' },
        { name: 'sys_delete', locations: ['record_header'], label: 'Delete', component: 'action:menu' },
      ],
    });
    expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Delete$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
  });
});

// objectui#5006 — the `maxVisible` / `mobileMaxVisible` VALUE DOMAIN.
//
// Three authorities used to give two answers for the same value. Measured on
// `ComponentPropsMap['page:header']` at @objectstack/spec 17.0.0 (the member
// lives on the `@objectstack/spec/ui` subpath, NOT the package root), both keys
// are a positive safe integer — `{format:'safeint'}` plus
// `{check:'greater_than',value:0,inclusive:false}`:
//
//   value | spec                                  | old readMax
//   ------+---------------------------------------+---------------------------
//   3     | OK                                    | 3
//   0     | REJECT "expected number to be >0"     | 0  (all actions overflowed)
//   -1    | REJECT "expected number to be >0"     | undefined -> default
//   1.5   | REJECT "expected int, received number"| 1  (floored)
//   2^53+2| REJECT "expected int to be <=2^53-1"  | 2^53+2 (nothing overflowed)
//
// The renderer was the loosest of the three, so a value `os validate` rejects
// outright still changed what shipped on screen. `readMax` now enforces the
// contract and a rejected value falls back to the documented default (3 desktop
// / 1 mobile) instead of taking effect.
//
// ⚠️ Scope note for future readers: `readMax` is `page:header`-only and has
// exactly two call sites. `action:bar` reads `schema.maxVisible ?? 3` through a
// wholly separate reader (`renderers/action/action-bar.tsx`) and is NOT in
// `ComponentPropsMap` at all, so its `maxVisible: 0` fixtures are legitimate and
// untouched by this suite. The notification stack's `maxVisible` is a third,
// unrelated reader (provider config).
describe('PageHeaderRenderer — maxVisible contract domain (objectui#5006)', () => {
  const fourActions = [
    { name: 'a', locations: ['record_header'], label: 'Action A' },
    { name: 'b', locations: ['record_header'], label: 'Action B' },
    { name: 'c', locations: ['record_header'], label: 'Action C' },
    { name: 'd', locations: ['record_header'], label: 'Action D' },
  ];

  // Asserts the DEFAULT-3 split: A/B/C inline, D folded into the overflow menu.
  // That is what a contract-rejected override must fall back to.
  function expectDefaultThreeSplit() {
    expect(screen.getByRole('button', { name: /Action A/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Action B/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Action C/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Action D/i })).toBeNull();
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
  }

  it('rejects maxVisible: 0 and falls back to the default (spec rejects 0)', () => {
    // Pre-fix this rendered ZERO inline buttons and swept every action into the
    // overflow menu — the most visible of the divergences, and the one an author
    // was most likely to hit by writing "0 means unlimited".
    renderHeader({ type: 'page:header', maxVisible: 0, actions: fourActions });
    expectDefaultThreeSplit();
  });

  it('rejects a fractional maxVisible instead of flooring it (spec rejects 1.5)', () => {
    // Pre-fix: Math.floor(1.5) === 1, so only Action A stayed inline. Flooring
    // invented a value the contract never accepted.
    renderHeader({ type: 'page:header', maxVisible: 1.5, actions: fourActions });
    expectDefaultThreeSplit();
  });

  it('rejects a maxVisible past Number.MAX_SAFE_INTEGER (spec format is safeint)', () => {
    // Pre-fix this was finite and >= 0, so it passed straight through and every
    // action rendered inline with no overflow button at all. This is the case
    // that makes Number.isSafeInteger — not Number.isInteger — the correct
    // predicate: Number.isInteger(2**53 + 2) is true, but spec rejects it.
    renderHeader({
      type: 'page:header',
      maxVisible: Number.MAX_SAFE_INTEGER + 2,
      actions: fourActions,
    });
    expectDefaultThreeSplit();
  });

  it('applies the same domain to the properties.* spelling (spec bridge variant)', () => {
    // Both spellings flow through the one `readMax`, so the bridge variant must
    // not be a way around the contract.
    renderHeader({
      type: 'page:header',
      properties: { maxVisible: 0, actions: fourActions },
    });
    expectDefaultThreeSplit();
  });

  // ⚠️ The two tests below are GREEN BOTH BEFORE AND AFTER the fix — they pin
  // no part of this change and are recorded as regression guards only. A
  // negative override already fell back (the old guard was `v >= 0`), and a
  // positive safe integer was already honoured. They are kept so the accepted
  // and rejected halves of the domain are both stated in one place.
  it('regression guard (green pre-fix too): a negative maxVisible falls back', () => {
    renderHeader({ type: 'page:header', maxVisible: -1, actions: fourActions });
    expectDefaultThreeSplit();
  });

  it('regression guard (green pre-fix too): a positive safe integer is honoured', () => {
    renderHeader({ type: 'page:header', maxVisible: 2, actions: fourActions });
    expect(screen.getByRole('button', { name: /Action B/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Action C/i })).toBeNull();
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
  });
});

// objectui#3391 — record dispatch shape. A `record_header` / `record_more`
// action must reach the runtime in the SAME shape ObjectGrid row actions and
// DeclaredActionsBar dispatch: the record stashed under `params._rowRecord`
// (the api handler's `{field}` URL-interpolation + record-id source) and a
// spec-shaped `params` ARRAY surfaced as `actionParams`. Before this, a
// `type:'api'` header action targeting `/api/v1/data/:object/{id}` was sent
// with the literal `{id}` (`%7Bid%7D` on the wire) while the same declaration
// interpolated fine from `list_item`.
describe('PageHeaderRenderer — record dispatch shape (objectui#3391)', () => {
  function renderWithApiHandler(opts: {
    action: any;
    record?: any;
    onParamCollection?: (params: any[], action?: any) => Promise<Record<string, any> | null>;
  }) {
    // Typed with the signature the `handlers` prop declares: a bare zero-arity
    // `vi.fn` makes `api.mock.calls[0]` the empty tuple, so every
    // `api.mock.calls[0][0]` below — the dispatched ActionDef, which is what
    // these cases are about — was unchecked (objectui#4040).
    const api = vi.fn<
      (action: ActionDef, ctx: ActionContext) => Promise<ActionResult>
    >(async () => ({ success: true }));
    const header = <PageHeader schema={{ type: 'page:header', title: 'Plan', actions: [opts.action] }} />;
    render(
      <ActionProvider handlers={{ api }} onParamCollection={opts.onParamCollection}>
        {opts.record !== undefined ? (
          <RecordContextProvider
            objectName="os_plan"
            recordId={opts.record?.id ?? null}
            data={opts.record}
            objectSchema={{ name: 'os_plan', label: 'Plan' }}
          >
            {header}
          </RecordContextProvider>
        ) : (
          header
        )}
      </ActionProvider>,
    );
    return { api };
  }

  it('stashes the record under params._rowRecord without mutating the authored node', async () => {
    const record = { id: 'rec-1', status: 'open' };
    const action = {
      name: 'copy_plan_row_3391',
      type: 'api',
      method: 'PATCH',
      locations: ['record_header'],
      label: 'Copy Plan',
      target: '/api/v1/data/os_plan/{id}',
    };
    const { api } = renderWithApiHandler({ action, record });
    fireEvent.click(screen.getByRole('button', { name: /Copy Plan/i }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const dispatched: any = api.mock.calls[0][0];
    expect(dispatched.params._rowRecord).toBe(record);
    expect(dispatched.target).toBe('/api/v1/data/os_plan/{id}');
    // The authored schema node must stay pristine — the runner merges
    // collected params into `action.params` IN PLACE, so dispatching the raw
    // node would pollute the schema between invocations.
    expect(action).not.toHaveProperty('params');
  });

  it('surfaces a spec-shaped params ARRAY as actionParams and keeps the stash through collection', async () => {
    const record = { id: 'rec-2' };
    const paramDefs = [{ name: 'copy_ovr_start', type: 'date', required: true }];
    // Typed for the same reason as `api` above: the assertion below reads
    // `onParamCollection.mock.calls[0][0]` — the param DEFINITIONS the runner
    // handed the collector — which a zero-arity mock types as element 0 of the
    // empty tuple (objectui#4040).
    const onParamCollection = vi.fn<ParamCollectionHandler>(async () => ({
      copy_ovr_start: '2026-01-01',
    }));
    const action = {
      name: 'copy_plan_params_3391',
      type: 'api',
      locations: ['record_header'],
      label: 'Copy With Params',
      target: '/api/v1/data/os_plan/{id}',
      params: paramDefs,
    };
    const { api } = renderWithApiHandler({ action, record, onParamCollection });
    fireEvent.click(screen.getByRole('button', { name: /Copy With Params/i }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(onParamCollection).toHaveBeenCalledTimes(1);
    expect(onParamCollection.mock.calls[0][0]).toEqual(paramDefs);
    const dispatched: any = api.mock.calls[0][0];
    // The runner merged the collected values into `params` while PRESERVING
    // the row stash (ActionRunner's `_rowRecord` carve-out).
    expect(dispatched.params.copy_ovr_start).toBe('2026-01-01');
    expect(dispatched.params._rowRecord).toBe(record);
    expect(dispatched.actionParams).toEqual(paramDefs);
    // Authored node untouched: `params` is still the param-def ARRAY.
    expect(action.params).toBe(paramDefs);
  });

  it('merges the stash into object-shaped params without dropping authored keys', async () => {
    const record = { id: 'rec-3' };
    const action = {
      name: 'object_params_3391',
      type: 'api',
      locations: ['record_header'],
      label: 'Object Params',
      target: '/api/v1/data/os_plan/{id}',
      params: { channel: 'header' },
    };
    const { api } = renderWithApiHandler({ action, record });
    fireEvent.click(screen.getByRole('button', { name: /Object Params/i }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const dispatched: any = api.mock.calls[0][0];
    expect(dispatched.params).toMatchObject({ channel: 'header', _rowRecord: record });
    expect((action.params as any)._rowRecord).toBeUndefined();
  });

  it('dispatches unchanged outside a record context', async () => {
    const action = {
      name: 'no_record_3391',
      type: 'api',
      locations: ['record_header'],
      label: 'No Record',
      target: '/api/v1/misc/ping',
    };
    const { api } = renderWithApiHandler({ action });
    fireEvent.click(screen.getByRole('button', { name: /No Record/i }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const dispatched: any = api.mock.calls[0][0];
    // Value-equal, not reference-equal. Since objectui#4265 every header action
    // is run through the shared action-text localizer before it is rendered or
    // dispatched, so what reaches the runner is always a localized COPY — which
    // is what the record-context branch was already doing deliberately (see
    // `dispatchHeaderAction`: a fresh object keeps the runner's in-place
    // collected-params merge off the authored schema node). This case is about
    // the SHAPE staying untouched outside a record context, and the assertion
    // that carries that is the `params` pin below: no `_rowRecord` stash is
    // added when there is no record. Identity was never the contract — it was
    // how "unchanged" happened to be spelled when only the record branch
    // rebuilt.
    expect(dispatched).toStrictEqual(action);
    expect(dispatched.params).toBeUndefined();
    // …and the authored node itself is not mutated on the way through.
    expect(action).toStrictEqual({
      name: 'no_record_3391',
      type: 'api',
      locations: ['record_header'],
      label: 'No Record',
      target: '/api/v1/misc/ping',
    });
  });
});

// #2358 — the three action-visibility traps. NOTE: the diagnostics warn ONCE
// per (action name, predicate) pair via a module-level Set, so every test
// below uses unique action names/predicates to stay independent.
describe('PageHeaderRenderer — #2358 action visibility traps', () => {
  describe('trap 2: record_more routes to the ⋯ overflow menu', () => {
    it('renders a record_more-only action in the overflow, never inline', () => {
      renderHeader(
        {
          type: 'page:header',
          actions: [
            { name: 'convert2358', locations: ['record_header'], label: 'Convert Lead' },
            { name: 'export_pdf_2358', label: 'Export PDF', locations: ['record_more'] },
          ],
        },
        { record: { id: '1' } },
      );
      // The plain action stays inline; the record_more action must NOT get
      // an inline button — it lives inside the ⋯ dropdown (trigger present).
      expect(screen.getByRole('button', { name: /Convert Lead/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Export PDF/i })).toBeNull();
      expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
    });

    it('renders the ⋯ menu even when a record_more action is the ONLY action', () => {
      renderHeader(
        {
          type: 'page:header',
          actions: [
            { name: 'archive_2358', label: 'Archive Record', locations: ['record_more'] },
          ],
        },
        { record: { id: '1' } },
      );
      expect(screen.queryByRole('button', { name: /Archive Record/i })).toBeNull();
      expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
    });

    it('still excludes locations that are neither record_header nor record_more', () => {
      renderHeader(
        {
          type: 'page:header',
          actions: [
            { name: 'list_only_2358', label: 'List Only', locations: ['list_item'] },
          ],
        },
        { record: { id: '1' } },
      );
      expect(screen.queryByRole('button', { name: /List Only/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /More actions/i })).toBeNull();
    });
  });

  describe('trap 1: os.user identity alias (server CEL parity)', () => {
    it('shows an action gated on os.user.* when the ambient user matches', () => {
      renderHeader(
        {
          type: 'page:header',
          actions: [
            {
              name: 'admin_gate_2358',
              locations: ['record_header'],
              label: 'Admin Gate',
              visible: 'os.user.role == "admin"',
            },
          ],
        },
        { record: { id: '1' }, scope: { user: { id: 'u1', role: 'admin' } } },
      );
      expect(screen.getByRole('button', { name: /Admin Gate/i })).toBeTruthy();
    });

    it('hides an os.user.* gated action when the ambient user does not match', () => {
      renderHeader(
        {
          type: 'page:header',
          actions: [
            {
              name: 'admin_gate_no_match_2358',
              locations: ['record_header'],
              label: 'Admin Gate',
              visible: 'os.user.role == "admin"',
            },
          ],
        },
        { record: { id: '1' }, scope: { user: { id: 'u1', role: 'viewer' } } },
      );
      expect(screen.queryByRole('button', { name: /Admin Gate/i })).toBeNull();
    });
  });

  describe('unified diagnostics: no more silent fail-closed hide', () => {
    it('hides an unevaluatable predicate AND warns once with the action name', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const schema = {
          type: 'page:header',
          actions: [
            {
              name: 'bad_scope_2358',
              locations: ['record_header'],
              label: 'Bad Scope',
              visible: 'undeclared_var_2358 == 1',
            },
          ],
        };
        const { unmount } = renderHeader(schema, { record: { id: '1' } });
        expect(screen.queryByRole('button', { name: /Bad Scope/i })).toBeNull();
        const matching = () =>
          warn.mock.calls.filter(c => String(c[0]).includes('bad_scope_2358'));
        expect(matching()).toHaveLength(1);
        // Since objectui#3521 the fault report is written by the SAME warn-once
        // machinery the row kebab and the selection bar use (`evalRowPredicate`
        // with `warnOnError`), carrying the label this surface passes — so the
        // wording is "failed to evaluate … treated as its safe default" rather
        // than the header's former bespoke "predicate threw". What #2358 asked
        // for is unchanged and still asserted here: the hidden button names
        // itself, quotes its predicate, and says it once.
        expect(String(matching()[0][0])).toMatch(/failed to evaluate/);
        expect(String(matching()[0][0])).toContain('page:header');
        expect(String(matching()[0][0])).toContain('undeclared_var_2358 == 1');
        // Re-render must not spam the warning (deduped per action+predicate).
        unmount();
        renderHeader(schema, { record: { id: '1' } });
        expect(matching()).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('trap 3: warns when a predicate references record fields absent from the payload', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        renderHeader(
          {
            type: 'page:header',
            actions: [
              {
                name: 'hidden_field_gate_2358',
                locations: ['record_header'],
                label: 'Hidden Field Gate',
                visible: 'record.secret_level_2358 == "high"',
              },
            ],
          },
          // Non-empty payload WITHOUT the referenced field — mirrors a
          // projected/partial read binding a record that lacks the key.
          { record: { id: '1', status: 'new' } },
        );
        expect(screen.queryByRole('button', { name: /Hidden Field Gate/i })).toBeNull();
        const hits = warn.mock.calls.filter(c =>
          String(c[0]).includes('hidden_field_gate_2358'),
        );
        // TWO diagnostics, one per fact, each once (objectui#3521): this local
        // one names the missing field — a FACT only this surface can see, since
        // only the page knows which payload it bound (objectui#5399) — and the
        // shared `evalRowPredicate` report states the VERDICT (a CEL fault on an
        // absent key, resolved to the fail-closed default). Before #3521 the
        // legacy JS evaluator returned `undefined` for the absent key without
        // faulting, so only the first line existed.
        const missingField = hits.filter(c => /not present in the record payload/.test(String(c[0])));
        const fault = hits.filter(c => /failed to evaluate/.test(String(c[0])));
        expect(missingField).toHaveLength(1);
        expect(fault).toHaveLength(1);
        expect(String(missingField[0][0])).toContain('secret_level_2358');
      } finally {
        warn.mockRestore();
      }
    });

    it('does not fire the missing-field warning for present-but-null fields', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        renderHeader(
          {
            type: 'page:header',
            actions: [
              {
                name: 'null_field_gate_2358',
                locations: ['record_header'],
                label: 'Null Field Gate',
                visible: 'record.approver_2358 == "u1"',
              },
            ],
          },
          { record: { id: '1', approver_2358: null } },
        );
        // Legitimately empty field → predicate is false, action hidden, but
        // no "missing field" noise.
        expect(screen.queryByRole('button', { name: /Null Field Gate/i })).toBeNull();
        expect(
          warn.mock.calls.filter(c => String(c[0]).includes('null_field_gate_2358')),
        ).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });
  });
});
