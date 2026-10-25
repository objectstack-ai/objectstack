/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10345 — on an `action:bar`, a single action's `component` is WHERE
 * it goes (ruling A, comment 5825579152).
 *
 * `action:bar` used to render every inline member with the renderer its
 * `component` names, spreading the single action onto that renderer's schema.
 * The spec's `ActionSchema.component` enum also offers `'action:menu'` and
 * `'action:group'`, and both of those renderers read `schema.actions`, which a
 * single action does not carry, so they returned null. The action vanished
 * from the toolbar, and a `?runAction=` deep link to it was armed, consumed by
 * the host, and ran nothing.
 *
 * The ruling reads the value as placement, which is what the spec's own comment
 * on the key says ("Defaults to 'button' or 'menu_item' based on location, but
 * can be overridden"):
 *
 * - `action:menu` puts the action in the bar's one existing overflow menu.
 * - `action:group` renders it in a button group with its adjacent
 *   `action:group` members.
 *
 * ## What each block defends
 *
 * - The four-row probe is the card's own table, re-read with placement as a
 *   column. Every row renders an unflagged `action:button` control beside the
 *   flagged member, so a harness that runs nothing reads the control inline and
 *   the member's zero, which tells "the member vanished" apart from "nothing
 *   mounted".
 * - The deep-link block arms the member the way `ObjectView` does for
 *   `?runAction=` (it maps the toolbar list and marks exactly the named action
 *   `autoTrigger`), then checks the run happens once and never again. Its
 *   unflagged row refuses a rewrite that runs every relocated member on mount.
 * - The menu block pins the two accounting choices this change makes: a
 *   menu-placed member takes no inline slot, and the overflow order is stated.
 * - The group block pins what "adjacent" means.
 * - The gates block pins that a relocated member is still gated.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports: `action:bar` resolves its members and its
// overflow menu through the ComponentRegistry at render time, and the light
// `dom` project does not load the `@object-ui/components` graph. `action-group`
// is imported so the registry HAS the `action:group` renderer; the fix must not
// depend on its absence. Module scope, not a `beforeAll`, per AGENTS.md
// §测试纪律.
import '../action-bar';
import '../action-button';
import '../action-icon';
import '../action-menu';
import '../action-group';
import { toast } from '../../../ui/sonner';

type Handler = Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
type Member = Record<string, unknown>;
type Placement = 'inline' | 'group' | 'menu' | 'absent';

const LOCATION = 'list_toolbar';

/** The unflagged control in every probe row. */
const CONTROL = { name: 'control', label: 'Control', type: 'api', locations: [LOCATION] };

/** The member whose `component` each row varies. */
const MEMBER = { name: 'member', label: 'Member', type: 'api', icon: 'plus', locations: [LOCATION] };

/** A declared, evaluable predicate that is false, so the gate really runs. */
const NEVER = '1 == 2';

/** The trigger's accessible name: `action:menu`'s fallback label, with no i18n bundle loaded. */
const MORE = 'More actions';

let api: Handler;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The names the runner was actually asked to execute. */
const executed = () => api.mock.calls.map((c) => (c[0] as ActionDef).name);

const flush = () => new Promise((r) => setTimeout(r, 0));

interface BarProps {
  actions: Member[];
  systemActions?: Member[];
  /** Both ceilings take this one value: the split reads `mobileMaxVisible` when the environment looks mobile. */
  max?: number;
}

function Bar({ actions, systemActions, max = 10 }: BarProps) {
  const C = ComponentRegistry.get('action:bar');
  if (!C) throw new Error('action:bar is not registered');
  return (
    // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
    <C
      schema={{
        type: 'action:bar',
        location: LOCATION,
        maxVisible: max,
        mobileMaxVisible: max,
        actions,
        systemActions,
      }}
    />
  );
}

function tree(props: BarProps, context?: Record<string, unknown>) {
  return (
    <ActionProvider handlers={{ api }} onToast={vi.fn()} context={context as never}>
      <Bar {...props} />
    </ActionProvider>
  );
}

const renderBar = (props: BarProps, context?: Record<string, unknown>) => render(tree(props, context));

const toolbar = () => screen.getByRole('toolbar');

/** The one overflow trigger, or null. */
const moreTrigger = () => screen.queryByRole('button', { name: MORE });

/**
 * Open the overflow menu and return its item labels, in order. Radix opens on
 * `pointerdown` (a plain click does nothing) and mounts the content in a portal.
 *
 * A label is the item's NAME: an item greyed out by its declared `disabled`
 * shows the reason as a second line and names itself by its label element
 * (`aria-labelledby`, objectui#11839), so its text is the label plus the reason.
 */
async function openMenuLabels(): Promise<string[]> {
  const trigger = moreTrigger();
  if (!trigger) return [];
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  return within(menu)
    .queryAllByRole('menuitem')
    .map((item) => {
      const labelledBy = item.getAttribute('aria-labelledby');
      const label = labelledBy ? document.getElementById(labelledBy) : item;
      return (label?.textContent ?? '').trim();
    });
}

/**
 * Where a member's control sits. Reads the inline row FIRST: an open Radix menu
 * hides the rest of the page from the accessibility tree.
 */
async function placementOf(label: string): Promise<Placement> {
  const button = screen.queryByRole('button', { name: label });
  if (button && toolbar().contains(button)) {
    return button.closest('[role="group"]') ? 'group' : 'inline';
  }
  return (await openMenuLabels()).includes(label) ? 'menu' : 'absent';
}

/** Each run of grouped buttons in the row, as its button names. */
const groups = () =>
  within(toolbar())
    .queryAllByRole('group')
    .map((g) => within(g).queryAllByRole('button').map((b) => b.getAttribute('aria-label') || (b.textContent ?? '').trim()));

// ---------------------------------------------------------------------------
// The card's four-row probe
// ---------------------------------------------------------------------------

describe("the card's four-row probe: each member component, flagged autoTrigger, beside an unflagged control (objectui#10345)", () => {
  it.each<[string, Placement]>([
    ['action:button', 'inline'],
    ['action:icon', 'inline'],
    ['action:menu', 'menu'],
    ['action:group', 'group'],
  ])('component %s: the member runs once and renders %s', async (component, placement) => {
    // Before the fix the last two rows read 0 runs and `absent`.
    renderBar({ actions: [CONTROL, { ...MEMBER, component, autoTrigger: true }] });

    // The harness is alive: the unflagged control is inline in every row.
    expect(screen.getByRole('button', { name: 'Control' }).closest('[role="group"]')).toBeNull();

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await flush();
    expect(executed()).toEqual(['member']);

    expect(await placementOf('Member')).toBe(placement);
  });

  it('the menu row puts the member in the ONE overflow menu, and the group row wraps it in a button group', async () => {
    const menu = renderBar({ actions: [CONTROL, { ...MEMBER, component: 'action:menu' }] });
    // The control and the one trigger, nothing else.
    expect(within(toolbar()).queryAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent)).toEqual([
      'Control',
      MORE,
    ]);
    menu.unmount();

    renderBar({ actions: [CONTROL, { ...MEMBER, component: 'action:group' }] });
    expect(groups()).toEqual([['Member']]);
    expect(moreTrigger()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The deep-link case
// ---------------------------------------------------------------------------

/** What `ObjectView` does to the toolbar list when `?runAction=<name>` is armed. */
const armDeepLink = (actions: Member[], name: string) =>
  actions.map((a) => (a.name === name ? { ...a, autoTrigger: true } : a));

describe('a ?runAction= deep link to a relocated member runs it, once (objectui#10345)', () => {
  const OTHER = { name: 'other', label: 'Other', type: 'api', locations: [LOCATION], component: 'action:menu' };

  it.each(['action:menu', 'action:group'])('component %s: the named member runs, and only it', async (component) => {
    const toolbarActions = [CONTROL, { ...MEMBER, component }, OTHER];
    const view = renderBar({ actions: armDeepLink(toolbarActions, 'member') });

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(executed()).toEqual(['member']);

    // The host re-maps its list every render, so each re-render hands the bar
    // fresh objects with the flag still set. The once-guard holds.
    for (let i = 0; i < 3; i++) {
      view.rerender(tree({ actions: armDeepLink(toolbarActions, 'member') }));
    }
    await flush();
    expect(executed()).toEqual(['member']);
  });

  it.each(['action:menu', 'action:group'])('component %s: without the flag, nothing runs on mount', async (component) => {
    renderBar({ actions: [CONTROL, { ...MEMBER, component }] });
    await flush();
    expect(await placementOf('Member')).not.toBe('absent');
    expect(api).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// action:menu — the inline budget and the overflow order
// ---------------------------------------------------------------------------

describe("component 'action:menu' places the member in the bar's one overflow menu (objectui#10345)", () => {
  const b = (n: number, extra: Member = {}) => ({ name: `b${n}`, label: `B${n}`, type: 'api', locations: [LOCATION], ...extra });
  const m = (n: number, extra: Member = {}) => b(n, { name: `m${n}`, label: `M${n}`, component: 'action:menu', ...extra });

  it('takes no inline slot: maxVisible still counts only the inline members', async () => {
    renderBar({ actions: [m(1), b(1), b(2)], max: 2 });
    expect(await placementOf('B1')).toBe('inline');
    expect(await placementOf('B2')).toBe('inline');
    expect(await openMenuLabels()).toEqual(['M1']);
  });

  it('an overflow that holds only menu-placed members is still exactly one More button', async () => {
    renderBar({ actions: [b(1), m(1), m(2)], max: 3 });
    expect(toolbar().children).toHaveLength(2);
    expect(toolbar().querySelectorAll('[aria-haspopup]')).toHaveLength(1);
    expect(await openMenuLabels()).toEqual(['M1', 'M2']);
  });

  it('the overflow order: spilled actions, then menu-placed ones, each in bar order, then the separator and system actions', async () => {
    // `m1` sorts FIRST in the bar (`order: -1`), and still does not claim the
    // primary inline slot: its placement is the menu.
    renderBar({
      actions: [b(1), m(1, { order: -1 }), b(2), m(2)],
      systemActions: [{ name: 's1', label: 'S1', type: 'api' }],
      max: 1,
    });
    expect(await placementOf('B1')).toBe('inline');
    expect(await openMenuLabels()).toEqual(['B2', 'M1', 'M2', 'S1']);

    // The separator sits between the business entries and the system entry.
    const menu = screen.getByRole('menu');
    const kinds = Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]')).map((el) =>
      el.getAttribute('role') === 'separator' ? '|' : (el.textContent ?? '').trim(),
    );
    expect(kinds).toEqual(['B2', 'M1', 'M2', '|', 'S1']);
  });
});

// ---------------------------------------------------------------------------
// action:group — what "adjacent" means
// ---------------------------------------------------------------------------

describe("component 'action:group' groups the member with its adjacent group members (objectui#10345)", () => {
  const g = (n: number, extra: Member = {}) => ({ name: `g${n}`, label: `G${n}`, type: 'api', locations: [LOCATION], component: 'action:group', ...extra });
  const plain = { name: 'plain', label: 'Plain', type: 'api', locations: [LOCATION] };
  const menuPlaced = { name: 'mp', label: 'Menu placed', type: 'api', locations: [LOCATION], component: 'action:menu' };

  it('adjacent group members share one group; an inline member between them splits the run', () => {
    renderBar({ actions: [g(1), g(2), plain, g(3)] });
    expect(groups()).toEqual([['G1', 'G2'], ['G3']]);
    // The plain member is a direct toolbar member, outside every group.
    expect(screen.getByRole('button', { name: 'Plain' }).closest('[role="group"]')).toBeNull();
  });

  it('adjacency is read on the drawn row: a menu-placed member between two group members does not split them', async () => {
    renderBar({ actions: [g(1), menuPlaced, g(2)] });
    expect(groups()).toEqual([['G1', 'G2']]);
    expect(await openMenuLabels()).toEqual(['Menu placed']);
  });

  it('each group member counts toward maxVisible, and one past it spills into the menu like any inline member', async () => {
    renderBar({ actions: [g(1), g(2), g(3)], max: 2 });
    expect(groups()).toEqual([['G1', 'G2']]);
    expect(await openMenuLabels()).toEqual(['G3']);
  });

  it("a grouped member's click reaches the runner with the declared action type", async () => {
    renderBar({ actions: [g(1)] });
    fireEvent.click(screen.getByRole('button', { name: 'G1' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[0][0]).toMatchObject({ name: 'g1', type: 'api' });
  });
});

// ---------------------------------------------------------------------------
// A relocated member keeps its gates
// ---------------------------------------------------------------------------

describe('a relocated member is gated exactly as an inline one (objectui#10345)', () => {
  it('a hidden menu-placed member stays hidden, and its deep link is refused, not run', async () => {
    const notice = vi.spyOn(toast, 'warning').mockImplementation(() => 'id');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderBar({
      actions: [
        CONTROL,
        { name: 'shown', label: 'Shown', type: 'api', locations: [LOCATION], component: 'action:menu' },
        { ...MEMBER, component: 'action:menu', visible: NEVER, autoTrigger: true },
      ],
    });

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(String(notice.mock.calls[0][0])).toContain('Member');
    // The menu opened (its visible sibling is there), and the hidden one is not.
    expect(await openMenuLabels()).toEqual(['Shown']);
    await flush();
    expect(api).not.toHaveBeenCalled();
  });

  it('a hidden grouped member stays hidden; its group sibling renders', () => {
    renderBar({
      actions: [
        { name: 'g1', label: 'G1', type: 'api', locations: [LOCATION], component: 'action:group' },
        { name: 'g2', label: 'G2', type: 'api', locations: [LOCATION], component: 'action:group', visible: NEVER },
      ],
    });
    expect(groups()).toEqual([['G1']]);
  });

  it('a disabled menu-placed member is a disabled menu item', async () => {
    renderBar({ actions: [CONTROL, { ...MEMBER, component: 'action:menu', disabled: true }] });
    expect(await openMenuLabels()).toEqual(['Member']);
    const item = screen.getByRole('menuitem', { name: 'Member' });
    expect(item).toHaveAttribute('data-disabled');
    // Its declared `disabled` says why, as the item's description (objectui#11839).
    expect(item).toHaveAccessibleDescription('Not available for this record');
  });

  it.each<[string, Placement]>([
    ['action:menu', 'menu'],
    ['action:group', 'group'],
  ])(
    'component %s: a member whose requiredPermissions the caller lacks is not drawn; held, it is drawn at %s',
    async (component, placement) => {
      const gated = { ...MEMBER, component, requiredPermissions: ['manage_users'] };

      // The held leg first. Without it "absent" below is also what the
      // unplaced member read before the fix, and the row could not fail.
      const held = renderBar({ actions: [CONTROL, gated] }, { user: { id: 'u1', systemPermissions: ['manage_users'] } });
      expect(await placementOf('Member')).toBe(placement);
      held.unmount();

      renderBar({ actions: [CONTROL, gated] }, { user: { id: 'u1', systemPermissions: [] } });
      expect(screen.getByRole('button', { name: 'Control' })).toBeTruthy();
      expect(await placementOf('Member')).toBe('absent');
    },
  );
});
