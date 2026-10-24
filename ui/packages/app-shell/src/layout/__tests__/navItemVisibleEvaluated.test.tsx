/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * App navigation item `visible` (CEL) — the gate, end to end, with a LIT
 * CONTROL (objectui#10119).
 *
 * ## What "lit control" means here, and why the card could not be answered
 * without one
 *
 * The reported reading was "the sidebar was byte-identical to a user for whom
 * the predicate was `true`". An ABSENCE is not a measurement: a sidebar that
 * renders nothing differently is what a working gate, a broken gate, and a
 * harness that never mounted anything all look like. So every case below runs
 * the SAME navigation through the SAME renderer TWICE — once for a session the
 * predicate excludes and once for a session it admits — and asserts the two
 * renders DIFFER. The `true` leg is the lit control: if it ever stops
 * rendering the entry, the `false` leg's absence stops meaning anything.
 *
 * ## The chain under test is the shipped one, not a re-implementation
 *
 * `ExpressionProvider` builds the evaluator from the session bag
 * `buildExpressionUser` normalises, and `NavigationRenderer` applies the
 * per-item gates. The one line between them — `evaluateVisibility(expr,
 * evaluator)` — is spelled here exactly as `UnifiedSidebar` (the sidebar
 * `ConsoleLayout` mounts) spells it, through the SAME exported
 * `evaluateVisibility`, so no second evaluator exists to drift.
 *
 * ## The wire shape is the SERVED one
 *
 * The predicates below are `{ dialect: 'cel', source }` envelopes, not authored
 * strings: that is what `ExpressionInputSchema` normalises an authored
 * ``P`…` `` into and what the app-metadata endpoint serves to the browser, and
 * it was the shape that used to fall through to a blanket "visible".
 * `NavigationItem.visible` is declared `boolean | string`, so the envelope is
 * cast in at the fixture — the declaration gap is noted, not worked around.
 *
 * ## Failure direction: FAIL-OPEN, pinned deliberately
 *
 * An unevaluable predicate renders the entry. That is this repo's shipped
 * policy (`evaluateVisibility`'s own "FAIL-OPEN IS UNCHANGED, deliberately"),
 * and hiding a nav entry is presentation, not authorization — the server still
 * enforces object and record permissions on every route the entry leads to.
 * "Hide on error" would silently delete a user's navigation with no diagnostic;
 * "show on error" leaves a dead-looking entry that the server still refuses.
 * The direction is pinned here so a later change has to state its case.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, hasVisibleNavigationItems } from '@object-ui/layout';
import { ExpressionProvider, useExpressionContext, evaluateVisibility } from '../../providers/ExpressionProvider.js';
import { buildExpressionUser } from '../../providers/expressionUser.js';

/**
 * The card's own predicate, in the shape the server serves it.
 * `!('demo_member' in current_user.positions)` is FALSE for a member and TRUE
 * for everyone else, so one fixture drives both legs.
 */
const MEMBER_GATE = {
  dialect: 'cel',
  source: "!('demo_member' in current_user.positions)",
} as unknown as NavigationItem['visible'];

const MEMBER = { id: 'u_member', name: 'Mia', email: 'mia@example.com', positions: ['demo_member'] };
const OUTSIDER = { id: 'u_outsider', name: 'Otto', email: 'otto@example.com', positions: ['other_team'] };

/**
 * Mounts the shipped chain. `evalVis` is the sidebar's own one-liner, read off
 * the context the provider publishes rather than constructed here.
 */
function NavUnderProvider({ items, enablePinning }: { items: NavigationItem[]; enablePinning?: boolean }) {
  const { evaluator } = useExpressionContext();
  const evalVis = React.useCallback(
    (expr: NavigationItem['visible']) => evaluateVisibility(expr, evaluator),
    [evaluator],
  );
  return (
    <NavigationRenderer
      items={items}
      basePath="/apps/demo_app"
      evaluateVisibility={evalVis}
      enablePinning={enablePinning}
      onPinToggle={enablePinning ? () => {} : undefined}
    />
  );
}

function renderFor(
  session: typeof MEMBER | typeof OUTSIDER | null,
  items: NavigationItem[],
  opts: { enablePinning?: boolean } = {},
) {
  const view = render(
    <MemoryRouter initialEntries={['/apps/demo_app']}>
      <ExpressionProvider user={buildExpressionUser(session)}>
        <SidebarProvider defaultOpen>
          <NavUnderProvider items={items} enablePinning={opts.enablePinning} />
        </SidebarProvider>
      </ExpressionProvider>
    </MemoryRouter>,
  );
  return view;
}

/** Present-or-absent by visible label, across the whole rendered sidebar. */
function labels(): string[] {
  return screen.queryAllByRole('button').concat(screen.queryAllByRole('link')).map((el) => el.textContent?.trim() ?? '');
}

const HOME: NavigationItem = { id: 'nav_home', type: 'page', pageName: 'demo_home', label: 'Home' };

describe('nav item `visible` is evaluated per item by the shell (objectui#10119)', () => {
  it('a LEAF predicate that is false hides it — and the same predicate, true, renders it', () => {
    const items: NavigationItem[] = [
      HOME,
      { id: 'nav_secret', type: 'object', objectName: 'demo_thing', label: 'Secret', visible: MEMBER_GATE },
    ];

    const member = renderFor(MEMBER, items);
    expect(screen.queryByText('Secret')).toBeNull();
    // Lit control, same run: the entry exists and the harness renders it.
    expect(screen.getByText('Home')).toBeTruthy();
    member.unmount();

    const outsider = renderFor(OUTSIDER, items);
    expect(screen.getByText('Secret')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy();
    outsider.unmount();
  });

  it('a GROUP predicate that is false takes the whole subtree with it', () => {
    const items: NavigationItem[] = [
      HOME,
      {
        id: 'group_admin',
        type: 'group',
        label: 'Admin Only',
        visible: MEMBER_GATE,
        // No predicate of its own — it must go because its ANCESTOR went.
        children: [
          { id: 'nav_secret', type: 'object', objectName: 'demo_thing', label: 'Secret' },
        ],
      },
    ];

    const member = renderFor(MEMBER, items);
    expect(screen.queryByText('Admin Only')).toBeNull();
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.getByText('Home')).toBeTruthy();
    member.unmount();

    const outsider = renderFor(OUTSIDER, items);
    expect(screen.getByText('Admin Only')).toBeTruthy();
    expect(screen.getByText('Secret')).toBeTruthy();
    outsider.unmount();
  });

  it('a group whose children are ALL hidden leaves no empty husk behind', () => {
    const items: NavigationItem[] = [
      HOME,
      {
        id: 'group_admin',
        type: 'group',
        label: 'Admin Only',
        // The GROUP is ungated; every child is gated away.
        children: [
          { id: 'nav_secret', type: 'object', objectName: 'demo_thing', label: 'Secret', visible: MEMBER_GATE },
          { id: 'nav_secret2', type: 'object', objectName: 'demo_other', label: 'Secret Two', visible: MEMBER_GATE },
        ],
      },
    ];

    const member = renderFor(MEMBER, items);
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.queryByText('Secret Two')).toBeNull();
    // A labelled disclosure that opens onto nothing is a dead affordance, and
    // it contradicts `hasVisibleNavigationItems`, which already scores such a
    // group as contributing nothing.
    expect(screen.queryByText('Admin Only')).toBeNull();
    expect(screen.getByText('Home')).toBeTruthy();
    member.unmount();

    const outsider = renderFor(OUTSIDER, items);
    expect(screen.getByText('Admin Only')).toBeTruthy();
    expect(screen.getByText('Secret')).toBeTruthy();
    outsider.unmount();
  });

  it('a PINNED descendant does not escape its hidden ancestor into Favorites', () => {
    const items: NavigationItem[] = [
      HOME,
      {
        id: 'group_admin',
        type: 'group',
        label: 'Admin Only',
        visible: MEMBER_GATE,
        children: [
          // Ungated and pinned: the favorites section collects it by walking
          // `children`, which is a second path into the same subtree.
          { id: 'nav_secret', type: 'object', objectName: 'demo_thing', label: 'Secret', pinned: true },
        ],
      },
    ];

    const member = renderFor(MEMBER, items, { enablePinning: true });
    expect(labels().join('|')).not.toContain('Secret');
    expect(screen.queryByText('Favorites')).toBeNull();
    member.unmount();

    const outsider = renderFor(OUTSIDER, items, { enablePinning: true });
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getAllByText('Secret').length).toBeGreaterThan(0);
    outsider.unmount();
  });

  it('CONTROL — an item with NO `visible` key renders identically for both sessions', () => {
    const items: NavigationItem[] = [HOME];

    const member = renderFor(MEMBER, items);
    const memberLabels = labels();
    member.unmount();

    const outsider = renderFor(OUTSIDER, items);
    expect(labels()).toEqual(memberLabels);
    expect(memberLabels.join('|')).toContain('Home');
    outsider.unmount();
  });

  it('FAILURE DIRECTION — an unevaluable predicate renders the entry (fail-open), for both sessions', () => {
    const unevaluable = {
      dialect: 'cel',
      source: 'nosuchroot10119.positions.size() > 0',
    } as unknown as NavigationItem['visible'];
    const items: NavigationItem[] = [
      HOME,
      { id: 'nav_broken', type: 'object', objectName: 'demo_thing', label: 'Broken Gate', visible: unevaluable },
    ];

    const member = renderFor(MEMBER, items);
    expect(screen.getByText('Broken Gate')).toBeTruthy();
    member.unmount();

    const outsider = renderFor(OUTSIDER, items);
    expect(screen.getByText('Broken Gate')).toBeTruthy();
    outsider.unmount();
  });

  it('the AREA derivation and the renderer agree on every case above', () => {
    // `hasVisibleNavigationItems` decides whether an area is offered at all,
    // and documents that it "can never disagree with the rendered navigation".
    // These are the two nesting cases that statement is about.
    const hiddenAncestor: NavigationItem[] = [
      {
        id: 'group_admin',
        type: 'group',
        label: 'Admin Only',
        visible: false,
        children: [{ id: 'nav_secret', type: 'object', objectName: 'demo_thing', label: 'Secret' }],
      },
    ];
    const allChildrenHidden: NavigationItem[] = [
      {
        id: 'group_admin',
        type: 'group',
        label: 'Admin Only',
        children: [{ id: 'nav_secret', type: 'object', objectName: 'demo_thing', label: 'Secret', visible: false }],
      },
    ];
    const literal = (expr: NavigationItem['visible']) => expr !== false && expr !== 'false';

    expect(hasVisibleNavigationItems(hiddenAncestor, { evaluateVisibility: literal })).toBe(false);
    expect(hasVisibleNavigationItems(allChildrenHidden, { evaluateVisibility: literal })).toBe(false);
  });
});
