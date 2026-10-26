/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4075 — the row must be bound on the action face, through the shared
 * `usePredicateRecordContext` — and objectui#5741 — that binding is `record.*`
 * ONLY.
 *
 * `useCondition(pred, ctx)` evaluates on `new ExpressionEvaluator({ ...scope,
 * ...ctx })`. The CANONICAL spelling is the `record.` root — it is what
 * `ExpressionEvaluator`'s CEL path binds (`bag.record` as the record
 * namespace), what `evalRowPredicate` binds on the record header and on list
 * rows, and what the server enforces with. #4075 / PR #4079 put the shared
 * helper under these four renderers because two of them — `action:menu`'s item
 * and `action:group`'s two leaves — had no record in scope at all, and
 * `DeclaredActionsBar` carried the same root-only fault (PR #4077). That helper
 * bound the row three ways (`record.*`, bare `status`, `data.*`) until
 * objectui#5330 ruled `record.*` the canon and objectui#5741 (Phase 2) retired
 * the other two: the helper now binds `{ record: row }` and nothing else, with
 * no survey and no special case.
 *
 * ## What each block pins, and in which direction
 *
 * Per site, the canon in two polarities, the two RETIRED spellings on both
 * rows, plus the fault case:
 *
 *   • `record.*` true / false — THE binding. Both polarities are asserted at
 *     every site because only one of them can be red at a time, and which one
 *     depends on that site's error policy (a throw hides on a fail-CLOSED
 *     `visible`; it shows / disables / enables on a fail-SOFT leg).
 *   • bare `status` and `data.*`, each on the HOLDING row and the FAILING row —
 *     the same verdict on both. A retired spelling is an unknown variable, so
 *     it takes the site's fault policy: hidden on every `visible` leg
 *     (`action:button`, `action:menu` item — and therefore the `action:bar`
 *     overflow, which IS an `action:menu` — and, since objectui#11212,
 *     `action:icon` and both `action:group` leaves too); greyed / enabled on
 *     the fail-soft `disabled` / `enabled` legs. "The same verdict on both
 *     rows" is what "no longer bound" looks like from outside, and the
 *     ruling's cost statement is exactly that pair.
 *   • a genuinely faulting predicate (`nope.deep == 1`, an unbound root) takes
 *     each site's error policy — unchanged by the binding cards (#4075 /
 *     #5741); objectui#11212 made every `visible` leg here fail CLOSED, which
 *     is why the `action:icon` / `action:group` cases below read hidden.
 *
 * Every "not rendered" assertion carries an ungated companion, so a green can
 * never mean "the host itself vanished".
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect imports so the renderers are registered before the
// first render — the light `dom` project deliberately does not load the
// `@object-ui/components` graph. Module scope, not a `beforeAll`, per AGENTS.md
// §测试纪律: the cost lands in the import phase, unbounded by any hook timeout.
import '../action-button';
import '../action-icon';
import '../action-bar';
import '../action-menu';
import '../action-group';

/**
 * The row every case evaluates against. `viewer.can_act` is the real shape
 * from the approval family (framework#3310 / #3424) — nested, so a predicate
 * that only ever reads a flat scalar cannot pass by accident.
 */
const ROW = { id: 'r1', status: 'pending', viewer: { can_act: true } };

/** The same question asked through the canon and the two retired roots. */
const HOLDS = {
  record: "record.status == 'pending'",
  bare: "status == 'pending'",
  data: "data.status == 'pending'",
} as const;
const FAILS = {
  record: "record.status == 'closed'",
  bare: "status == 'closed'",
  data: "data.status == 'closed'",
} as const;
/**
 * The two spellings objectui#5741 retired, each with its holding and failing
 * form: a site that still bound them would answer the two differently, a site
 * that does not answers them the same way.
 */
const RETIRED = [
  ['bare', HOLDS.bare, FAILS.bare],
  ['data.*', HOLDS.data, FAILS.data],
] as const;
/** The nested read the approval actions actually ship. */
const NESTED = 'record.viewer.can_act == true';
/** A genuinely faulting predicate — `nope` is bound nowhere. */
const FAULT = 'nope.deep == 1';

const LABEL = 'Act';
const COMPANION = { name: 'view', label: 'View', type: 'script' };

function getRenderer(type: string) {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R;
}

const shown = () => expect(screen.queryByText(LABEL)).toBeInTheDocument();
const hidden = () => {
  expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  expect(screen.getByText('View')).toBeInTheDocument();
};

/**
 * Open a real Radix dropdown host. Radix opens on `pointerdown` (a plain
 * `.click()` does nothing), and the content mounts in a portal on the next
 * tick — so the companion is awaited, which doubles as the "the host itself is
 * alive" check every `hidden()` assertion below depends on.
 */
async function openMenu(name: string | RegExp) {
  const trigger = screen.getByRole('button', { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByText('View')).toBeInTheDocument());
}

// ---------------------------------------------------------------------------
// action:button — the record arrives as the `data` prop (action:bar forwards it)
// ---------------------------------------------------------------------------

/** Mounted the way `action:bar` mounts a member: action spread onto `schema`. */
function mountButton(action: any) {
  const Renderer = getRenderer('action:button');
  return render(
    <div>
      <Renderer schema={{ ...action, type: 'action:button', actionType: 'script' }} data={ROW} />
      <Renderer schema={{ ...COMPANION, type: 'action:button', actionType: 'script' }} data={ROW} />
    </div>,
  );
}

describe('action:button — the row binds as `record.*` (objectui#4075 / #5741)', () => {
  it.each([
    ['record.*', HOLDS.record],
    ['record.* nested', NESTED],
  ])('a holding `visible` written as %s renders the button', (_root, visible) => {
    mountButton({ name: 'act', label: LABEL, visible });
    shown();
  });

  it('a failing `visible` written as record.* hides the button', () => {
    mountButton({ name: 'act', label: LABEL, visible: FAILS.record });
    hidden();
  });

  it('`visible` still fails CLOSED on a genuinely faulting predicate', () => {
    mountButton({ name: 'act', label: LABEL, visible: FAULT });
    hidden();
  });

  it.each(RETIRED)('a `visible` written as %s no longer discriminates — hidden on BOTH rows (fail-closed leg)', (_root, holding, failing) => {
    mountButton({ name: 'act', label: LABEL, visible: holding });
    hidden();
    cleanup();
    mountButton({ name: 'act', label: LABEL, visible: failing });
    hidden();
  });

  it('a holding `disabled` written as record.* greys the button', () => {
    mountButton({ name: 'act', label: LABEL, disabled: HOLDS.record });
    expect(screen.getByText(LABEL).closest('button')).toBeDisabled();
  });

  it('a failing `disabled` written as record.* leaves the button clickable', () => {
    mountButton({ name: 'act', label: LABEL, disabled: FAILS.record });
    expect(screen.getByText(LABEL).closest('button')).not.toBeDisabled();
  });

  it.each(RETIRED)('a `disabled` written as %s no longer discriminates — greyed on BOTH rows (fail-soft leg)', (_root, holding, failing) => {
    mountButton({ name: 'act', label: LABEL, disabled: holding });
    expect(screen.getByText(LABEL).closest('button')).toBeDisabled();
    cleanup();
    mountButton({ name: 'act', label: LABEL, disabled: failing });
    expect(screen.getByText(LABEL).closest('button')).toBeDisabled();
  });

  it('a failing legacy `enabled` written as record.* greys the button', () => {
    mountButton({ name: 'act', label: LABEL, enabled: FAILS.record });
    expect(screen.getByText(LABEL).closest('button')).toBeDisabled();
  });

  it.each(RETIRED)('a legacy `enabled` written as %s no longer discriminates — clickable on BOTH rows (fail-soft leg)', (_root, holding, failing) => {
    mountButton({ name: 'act', label: LABEL, enabled: holding });
    expect(screen.getByText(LABEL).closest('button')).not.toBeDisabled();
    cleanup();
    mountButton({ name: 'act', label: LABEL, enabled: failing });
    expect(screen.getByText(LABEL).closest('button')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// action:icon — read the `data` prop at all (it used to land in `...rest`)
// ---------------------------------------------------------------------------

function mountIcon(action: any) {
  const Renderer = getRenderer('action:icon');
  return render(
    <div>
      <Renderer schema={{ ...action, type: 'action:icon', actionType: 'script' }} data={ROW} />
      <Renderer schema={{ ...COMPANION, type: 'action:icon', actionType: 'script' }} data={ROW} />
    </div>,
  );
}

const iconShown = () => expect(screen.queryByLabelText(LABEL)).toBeInTheDocument();
const iconHidden = () => {
  expect(screen.queryByLabelText(LABEL)).not.toBeInTheDocument();
  expect(screen.getByLabelText('View')).toBeInTheDocument();
};

describe('action:icon — the row binds as `record.*` (objectui#4075 / #5741)', () => {
  it.each([
    ['record.*', HOLDS.record],
    ['record.* nested', NESTED],
  ])('a holding `visible` written as %s renders the icon', (_root, visible) => {
    mountIcon({ name: 'act', label: LABEL, visible });
    iconShown();
  });

  it('a failing `visible` written as record.* hides the icon', () => {
    mountIcon({ name: 'act', label: LABEL, visible: FAILS.record });
    iconHidden();
  });

  it.each(RETIRED)('a `visible` written as %s no longer discriminates — hidden on BOTH rows (fail-closed leg)', (_root, holding, failing) => {
    mountIcon({ name: 'act', label: LABEL, visible: holding });
    iconHidden();
    cleanup();
    mountIcon({ name: 'act', label: LABEL, visible: failing });
    iconHidden();
  });

  it('`visible` fails CLOSED on a faulting predicate (objectui#11212)', () => {
    // `action:icon` passes `throwOnError` on `visible` since objectui#11212, as
    // `action:button` does; it failed soft (shown) before.
    mountIcon({ name: 'act', label: LABEL, visible: FAULT });
    iconHidden();
  });

  it('a holding `disabled` written as record.* greys the icon', () => {
    mountIcon({ name: 'act', label: LABEL, disabled: HOLDS.record });
    expect(screen.getByLabelText(LABEL)).toBeDisabled();
  });

  it('a failing `disabled` written as record.* leaves the icon clickable', () => {
    mountIcon({ name: 'act', label: LABEL, disabled: FAILS.record });
    expect(screen.getByLabelText(LABEL)).not.toBeDisabled();
  });

  it.each(RETIRED)('a `disabled` written as %s no longer discriminates — greyed on BOTH rows (fail-soft leg)', (_root, holding, failing) => {
    mountIcon({ name: 'act', label: LABEL, disabled: holding });
    expect(screen.getByLabelText(LABEL)).toBeDisabled();
    cleanup();
    mountIcon({ name: 'act', label: LABEL, disabled: failing });
    expect(screen.getByLabelText(LABEL)).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// action:menu — its items had NO record in scope; the host must supply the row
// ---------------------------------------------------------------------------

/** The real `action:menu` host, mounted with the row and opened. */
async function mountMenu(action: any) {
  const Renderer = getRenderer('action:menu');
  const r = render(
    <Renderer
      schema={{ type: 'action:menu', label: 'More', actions: [action, COMPANION] }}
      data={ROW}
    />,
  );
  await openMenu('More');
  return r;
}

describe('action:menu item — the row binds as `record.*` (objectui#4075 / #5741)', () => {
  it.each([
    ['record.*', HOLDS.record],
    ['record.* nested', NESTED],
  ])('a holding `visible` written as %s renders the menu item', async (_root, visible) => {
    await mountMenu({ name: 'act', label: LABEL, type: 'script', visible });
    shown();
  });

  it('a failing `visible` written as record.* hides the menu item', async () => {
    await mountMenu({ name: 'act', label: LABEL, type: 'script', visible: FAILS.record });
    hidden();
  });

  it.each(RETIRED)('a `visible` written as %s no longer discriminates — hidden on BOTH rows (fail-closed leg)', async (_root, holding, failing) => {
    await mountMenu({ name: 'act', label: LABEL, type: 'script', visible: holding });
    hidden();
    cleanup();
    await mountMenu({ name: 'act', label: LABEL, type: 'script', visible: failing });
    hidden();
  });

  it('a menu item `visible` still fails CLOSED on a faulting predicate', async () => {
    await mountMenu({ name: 'act', label: LABEL, type: 'script', visible: FAULT });
    hidden();
  });

  it('a holding `disabled` written as record.* greys the menu item', async () => {
    await mountMenu({ name: 'act', label: LABEL, type: 'script', disabled: HOLDS.record });
    expect(screen.getByText(LABEL).closest('[role="menuitem"]')).toHaveAttribute(
      'data-disabled',
    );
  });

  it('a failing `disabled` written as record.* leaves the menu item live', async () => {
    await mountMenu({ name: 'act', label: LABEL, type: 'script', disabled: FAILS.record });
    expect(screen.getByText(LABEL).closest('[role="menuitem"]')).not.toHaveAttribute(
      'data-disabled',
    );
  });

  it.each(RETIRED)('a `disabled` written as %s no longer discriminates — greyed on BOTH rows (fail-soft leg)', async (_root, holding, failing) => {
    await mountMenu({ name: 'act', label: LABEL, type: 'script', disabled: holding });
    expect(screen.getByText(LABEL).closest('[role="menuitem"]')).toHaveAttribute('data-disabled');
    cleanup();
    await mountMenu({ name: 'act', label: LABEL, type: 'script', disabled: failing });
    expect(screen.getByText(LABEL).closest('[role="menuitem"]')).toHaveAttribute('data-disabled');
  });
});

// ---------------------------------------------------------------------------
// action:group — both display modes; its two leaves had no record either
// ---------------------------------------------------------------------------

async function mountInlineGroup(action: any) {
  const Group = getRenderer('action:group');
  return render(
    <Group
      schema={{ type: 'action:group', display: 'inline', actions: [action, COMPANION] }}
      data={ROW}
    />,
  );
}

async function mountDropdownGroup(action: any) {
  const Group = getRenderer('action:group');
  const r = render(
    <Group
      schema={{ type: 'action:group', display: 'dropdown', label: 'More', actions: [action, COMPANION] }}
      data={ROW}
    />,
  );
  await openMenu(/More/);
  return r;
}

describe.each([
  ['inline', mountInlineGroup],
  ['dropdown', mountDropdownGroup],
])('action:group %s leaf — the row binds as `record.*` (objectui#4075 / #5741)', (_mode, mount) => {
  it.each([
    ['record.*', HOLDS.record],
    ['record.* nested', NESTED],
  ])('a holding `visible` written as %s renders the action', async (_root, visible) => {
    await mount({ name: 'act', label: LABEL, type: 'script', visible });
    shown();
  });

  it('a failing `visible` written as record.* hides the action', async () => {
    await mount({ name: 'act', label: LABEL, type: 'script', visible: FAILS.record });
    hidden();
  });

  it.each(RETIRED)('a `visible` written as %s no longer discriminates — hidden on BOTH rows (fail-closed leg)', async (_root, holding, failing) => {
    await mount({ name: 'act', label: LABEL, type: 'script', visible: holding });
    hidden();
    cleanup();
    await mount({ name: 'act', label: LABEL, type: 'script', visible: failing });
    hidden();
  });

  it('`visible` fails CLOSED on a faulting predicate (objectui#11212)', async () => {
    // As with `action:icon`: both `action:group` leaves pass `throwOnError` on
    // `visible` since objectui#11212; they failed soft (shown) before.
    await mount({ name: 'act', label: LABEL, type: 'script', visible: FAULT });
    hidden();
  });
});

// ---------------------------------------------------------------------------
// No row at the render site — binding must not blank out an ambient `record`
// ---------------------------------------------------------------------------

describe('a host with no row of its own does not shadow the ambient scope (objectui#4075)', () => {
  /**
   * A host may supply the row through the predicate SCOPE instead of a prop
   * (that is how `action-group-dropdown-visible.test.tsx` drives these leaves).
   * `useCondition` merges the local context OVER the scope, so binding an empty
   * record for "no row here" would blank that out — "this surface has no row"
   * and "this surface's row is empty" are different statements, and only the
   * second may shadow the scope. Caught as a regression by the existing suite,
   * pinned here so the distinction is stated where the binding rule is.
   */
  it('an ambient `record` still resolves when the renderer is given no `data`', () => {
    const Renderer = getRenderer('action:button');
    render(
      <PredicateScopeProvider scope={{ record: ROW }}>
        <Renderer
          schema={{ name: 'act', label: LABEL, type: 'action:button', actionType: 'script', visible: HOLDS.record }}
        />
        <Renderer
          schema={{ ...COMPANION, type: 'action:button', actionType: 'script' }}
        />
      </PredicateScopeProvider>,
    );
    shown();
  });

  it('a `data` prop still WINS over an ambient `record` when both are present', () => {
    const Renderer = getRenderer('action:button');
    render(
      <PredicateScopeProvider scope={{ record: { status: 'closed' } }}>
        <Renderer
          schema={{ name: 'act', label: LABEL, type: 'action:button', actionType: 'script', visible: HOLDS.record }}
          data={ROW}
        />
        <Renderer
          schema={{ ...COMPANION, type: 'action:button', actionType: 'script' }}
        />
      </PredicateScopeProvider>,
    );
    shown();
  });
});

// ---------------------------------------------------------------------------
// action:bar overflow — the bar forwards `data` inline but not into the
// overflow menu it builds, so an overflowed action lost the row entirely
// ---------------------------------------------------------------------------

describe('action:bar overflow menu — the row reaches an overflowed action (objectui#4075)', () => {
  async function mountBarOverflow(action: any) {
    const Bar = getRenderer('action:bar');
    const r = render(
      <Bar
        schema={{ type: 'action:bar', maxVisible: 0, actions: [action, COMPANION] }}
        data={ROW}
      />,
    );
    await openMenu('More actions');
    return r;
  }

  it.each([
    ['record.*', HOLDS.record],
    ['record.* nested', NESTED],
  ])('a holding `visible` written as %s renders the overflowed action', async (_root, visible) => {
    await mountBarOverflow({ name: 'act', label: LABEL, type: 'script', visible });
    shown();
  });

  it('a failing `visible` written as record.* hides the overflowed action', async () => {
    await mountBarOverflow({ name: 'act', label: LABEL, type: 'script', visible: FAILS.record });
    hidden();
  });

  it.each(RETIRED)('a `visible` written as %s no longer discriminates — hidden on BOTH rows (the overflow is an action:menu, fail-closed)', async (_root, holding, failing) => {
    await mountBarOverflow({ name: 'act', label: LABEL, type: 'script', visible: holding });
    hidden();
    cleanup();
    await mountBarOverflow({ name: 'act', label: LABEL, type: 'script', visible: failing });
    hidden();
  });
});
