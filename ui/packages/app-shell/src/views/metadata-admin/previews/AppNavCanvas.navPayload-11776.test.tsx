// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11776 — two halves of the nav canvas.
 *
 * 1. `navPayloadOf`: the navigation a save sends. It leaves out every entry
 *    that names no target for its `type`, at every depth, and nothing else.
 *    "No target" is read per branch from the spec: the parity pin below walks
 *    every member of `NavigationItemSchema`'s discriminator and holds that the
 *    save leaves an entry out exactly when the spec refuses it for want of a
 *    target, and keeps it once the target is set. A `group` is never left out.
 *
 * 2. The row's remove control is reachable by keyboard. It was mounted only
 *    while a mouse hovered the card, so Tab never reached it. Now it is always
 *    in the tab order and always drawn (objectui#12519: at reduced opacity,
 *    full on hover and on focus), and Enter or Space removes the entry. Whether it is VISIBLE when focused is a stylesheet question no
 *    DOM double answers: the classes are pinned here, and the rendered result
 *    was read once in Chromium for the pull request — nothing here re-reads it.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationItemSchema } from '@objectstack/spec/ui';

import { AppNavCanvas, navPayloadOf } from './AppNavCanvas';

afterEach(cleanup);

/**
 * Every `type` the spec's navigation union discriminates on, read off the
 * schema itself, so a branch the spec adds is a branch this suite judges.
 */
function specNavTypes(): string[] {
  const union = (NavigationItemSchema as unknown as { _zod: { def: { getter: () => { options: Array<{ shape: { type: { _zod: { def: { values: string[] } } } } }> } } } })._zod.def.getter();
  return union.options.flatMap((o) => o.shape.type._zod.def.values);
}

/** The entry the spec takes for each branch: its target set, and nothing else that the branch needs. */
const BOUND: Record<string, Record<string, unknown>> = {
  object: { objectName: 'account' },
  page: { pageName: 'home' },
  dashboard: { dashboardName: 'pipeline' },
  report: { reportName: 'won_deals' },
  url: { url: 'https://example.com' },
  action: { actionDef: { actionName: 'export_all' } },
  component: { componentRef: 'metadata:directory' },
  doc: { book: 'crm_manual' },
  separator: {},
  group: { children: [] },
};

const bare = (type: string): Record<string, unknown> =>
  type === 'group' ? { id: 'nav_probe', type, children: [] } : { id: 'nav_probe', type };

describe('navPayloadOf — what a nav save sends (objectui#11776)', () => {
  it('judges every branch the spec declares', () => {
    expect(Object.keys(BOUND).sort()).toEqual(specNavTypes().sort());
  });

  it.each(Object.keys(BOUND))('`%s`: left out exactly when the spec refuses it for want of a target', (type) => {
    const entry = bare(type);
    const specTakes = NavigationItemSchema.safeParse(entry).success;
    expect(navPayloadOf([entry])).toEqual(specTakes ? [entry] : []);
  });

  it.each(Object.keys(BOUND))('`%s`: kept once its target is set, which the spec then takes', (type) => {
    const entry = { ...bare(type), ...BOUND[type] };
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
    expect(navPayloadOf([entry])).toEqual([entry]);
  });

  it('only the separator and the group are taken bare; every other branch names a target', () => {
    const takenBare = specNavTypes().filter((type) => NavigationItemSchema.safeParse(bare(type)).success);
    expect(takenBare.sort()).toEqual(['group', 'separator']);
  });

  it('a `doc` entry names its target by `doc` OR `book`', () => {
    const byDoc = { id: 'nav_guide', type: 'doc', doc: 'crm_lead_guide' };
    const byBook = { id: 'nav_help', type: 'doc', book: 'crm_manual' };
    expect(navPayloadOf([byDoc, byBook])).toEqual([byDoc, byBook]);
  });

  it('an `action` entry names its target by `actionDef.actionName`', () => {
    expect(navPayloadOf([{ id: 'nav_run', type: 'action', actionDef: {} }])).toEqual([]);
    expect(navPayloadOf([{ id: 'nav_run', type: 'action', actionDef: { actionName: 'run_it' } }])).toHaveLength(1);
  });

  it('an entry with no `type` — what an unbind leaves — is left out, as it was before', () => {
    expect(navPayloadOf([{ id: 'nav_item_3', label: 'Orders' }, { id: 'nav_item_4', type: undefined }])).toEqual([]);
  });

  it('the boundary is the spec’s: a target key holding any string is sent, and the server judges it', () => {
    const empty = { id: 'nav_blank', type: 'object', objectName: '' };
    expect(NavigationItemSchema.safeParse(empty).success).toBe(true);
    expect(navPayloadOf([empty])).toEqual([empty]);
  });

  it('a `type` the spec does not declare is sent: its refusal is the server’s to make, by name', () => {
    const view = { id: 'nav_view', type: 'view', objectName: 'account' };
    expect(NavigationItemSchema.safeParse(view).success).toBe(false);
    expect(navPayloadOf([view])).toEqual([view]);
  });

  it('an unbound entry inside a group is left out, and the group is kept', () => {
    const bound = { id: 'nav_accounts', type: 'object', objectName: 'account' };
    const group = {
      id: 'nav_sales',
      type: 'group',
      label: 'Sales',
      children: [{ id: 'nav_item_5', type: 'object' }, bound, { id: 'nav_item_6' }],
    };
    expect(navPayloadOf([group])).toEqual([{ ...group, children: [bound] }]);
    // The group's own document is untouched: only what is sent loses the child.
    expect(group.children).toHaveLength(3);
  });

  it('a group that loses every child is still sent, with no children', () => {
    const group = { id: 'nav_sales', type: 'group', label: 'Sales', children: [{ id: 'nav_item_5', type: 'object' }] };
    const [sent] = navPayloadOf([group]);
    expect(sent).toEqual({ ...group, children: [] });
    expect(NavigationItemSchema.safeParse(sent).success).toBe(true);
  });

  it('nesting is judged at every depth, an `object` entry’s nested views included', () => {
    const view = { id: 'nav_open_tasks', type: 'object', objectName: 'task', viewName: 'open' };
    const object = { id: 'nav_tasks', type: 'object', objectName: 'task', children: [view, { id: 'nav_item_7', type: 'page' }] };
    const group = { id: 'nav_work', type: 'group', label: 'Work', children: [object] };
    expect(navPayloadOf([group])).toEqual([{ ...group, children: [{ ...object, children: [view] }] }]);
  });

  it('the sent array is the editor’s, less the entries with no target, in order and with every id kept', () => {
    const home = { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' };
    const sep = { type: 'separator' };
    const accounts = { id: 'nav_accounts', type: 'object', objectName: 'account' };
    const editor = [home, { id: 'nav_item_2', type: 'object' }, sep, accounts, { id: 'nav_item_5', type: 'report' }];
    const sent = navPayloadOf(editor);
    expect(sent).toEqual([home, sep, accounts]);
    // The entries sent ARE the editor's: nothing kept is copied or rewritten.
    expect(sent[0]).toBe(home);
    expect(sent[1]).toBe(sep);
    expect(sent[2]).toBe(accounts);
  });

  it('the control: a navigation whose every entry names a target is sent as it is, entry for entry', () => {
    const nav = [
      { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
      { id: 'nav_sales', type: 'group', label: 'Sales', children: [{ id: 'nav_accounts', type: 'object', objectName: 'account' }] },
      { id: 'nav_help', type: 'doc', book: 'crm_manual' },
    ];
    const sent = navPayloadOf(nav);
    expect(sent).toEqual(nav);
    sent.forEach((entry, i) => expect(entry).toBe(nav[i]));
  });
});

describe('AppNavCanvas — the remove control is reachable by keyboard (objectui#11776)', () => {
  const NAV = [
    { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
    { id: 'nav_item_2', type: 'object' },
  ];

  function renderCanvas() {
    const onPatch = vi.fn();
    render(<AppNavCanvas draft={{ navigation: NAV }} rootKey="navigation" onPatch={onPatch} selection={null} />);
    return onPatch;
  }

  /** The card for `label`: the row button whose text starts with it. */
  const card = (label: string) =>
    screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.startsWith(label))!;

  it('every row carries it with no pointer over the card, and it has an accessible name', () => {
    renderCanvas();
    expect(screen.getAllByRole('button', { name: 'Remove nav item' })).toHaveLength(NAV.length);
    expect(within(card('Home')).getByRole('button', { name: 'Remove nav item' })).toHaveAttribute('tabindex', '0');
  });

  it('Tab reaches it straight after its card, and it is shown in full on focus as on hover', async () => {
    const user = userEvent.setup();
    renderCanvas();
    const home = card('Home');
    const remove = within(home).getByRole('button', { name: 'Remove nav item' });
    home.focus();
    await user.tab();
    expect(remove).toHaveFocus();
    // Drawn at a fixed 24 px either way (objectui#12519); the card's hover,
    // the card's keyboard focus and its own keyboard focus each raise it to
    // full opacity.
    expect(remove.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        'w-6',
        'group-hover:opacity-100',
        'group-focus-visible:opacity-100',
        'focus-visible:opacity-100',
      ]),
    );
    // The card is the `group` those variants read.
    expect(home.className.split(/\s+/)).toContain('group');
  });

  it.each([['Enter', '{Enter}'], ['Space', ' ']])('%s on it removes that entry, and only that one', async (_name, keys) => {
    const user = userEvent.setup();
    const onPatch = renderCanvas();
    const placeholder = card('Item 2');
    within(placeholder).getByRole('button', { name: 'Remove nav item' }).focus();
    await user.keyboard(keys);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ navigation: [NAV[0]] });
  });
});
