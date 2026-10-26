// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A permission set's advanced facets pick with the shared `Select`
 * (objectui#11865).
 *
 * An RLS policy's operation and a tab's visibility were browser-native
 * selects, beside the shared Radix `Select` the rest of Studio picks with. The
 * card asks for one control for one kind of choice, surface by surface; this
 * suite covers these two pickers.
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), shows the
 *     draft's value, and no native select is left;
 *   - the native pickers had no label and so no accessible name; the triggers
 *     have none either;
 *   - every option of both pickers writes the draft the native control wrote,
 *     compared as JSON text; re-picking the current option writes nothing;
 *   - read-only: each trigger is disabled, wears the primitive's own disabled
 *     look, and does not open;
 *   - a stored value no option carries is what the trigger shows, `''`
 *     included (which `SelectItem` refuses as a value);
 *   - the empty-key row the Add tab button creates picks like any other;
 *   - the keyboard alone opens a picker and selects.
 *
 * DIRECTION, observed against the native control: every pin here is red
 * there, because each one reads the pickers as the primitive's triggers. What
 * makes the write pins guards of "the conversion changed nothing the facets
 * write" is the literal each compares against: a `change` event on the
 * pre-conversion component's native control wrote that same JSON, read once
 * on that component. The names were read there the same way. That probe's
 * `change` event fired for the current option too (it wrote the value the
 * control already showed, and for a policy with no operation it wrote
 * `operation: 'all'`), which a browser does not do for an option that is
 * already selected; so the re-pick rows pin the primitive, not a browser
 * reading of the native control.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Select, SelectTrigger, SelectValue } from '@object-ui/components';
import { PermissionAdvancedFacets } from './PermissionAdvancedFacets';

afterEach(cleanup);

const t = (k: string) => k;

type Draft = Record<string, unknown>;

/** Two policies (one with an operation, one without) and two tabs. */
const DRAFT = (): Draft => ({
  rowLevelSecurity: [
    { name: 'p1', object: 'account', operation: 'select', using: 'true', enabled: true },
    { name: 'p2', object: 'contact', using: 'true' },
  ],
  tabPermissions: { a_tab: 'hidden', b_tab: 'default_on' },
});

const PICKERS = ['rls-operation-0', 'rls-operation-1', 'tab-visibility-a_tab', 'tab-visibility-b_tab'] as const;

/**
 * Mount the facets with the RLS and tab sections open. Every `setDraft`
 * updater is applied to the draft as mounted, and the result is recorded as
 * JSON text.
 */
function mount(draft: Draft = DRAFT(), writable = true) {
  const writes: string[] = [];
  const setDraft = (updater: (prev: Draft) => Draft) => {
    writes.push(JSON.stringify(updater(draft)));
  };
  const utils = render(
    <PermissionAdvancedFacets draft={draft} setDraft={setDraft} writable={writable} allSetNames={[]} t={t} />,
  );
  fireEvent.click(screen.getByText('perm.rls.title'));
  fireEvent.click(screen.getByText('perm.tabs.title'));
  return { ...utils, writes };
}

/** Open a picker from the keyboard and return the options it lists, in order. */
async function openPicker(testId: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(testId: string, label: string): Promise<void> {
  const options = await openPicker(testId);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`${testId} lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

/** The `disabled:` utilities the shared `SelectTrigger` wears. */
function primitiveDisabledLook(): string[] {
  const { getByRole, unmount } = render(
    <Select disabled>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
    </Select>,
  );
  const tokens = getByRole('combobox').className.split(/\s+/).filter((c) => c.startsWith('disabled:'));
  unmount();
  return tokens;
}

describe('the RLS operation and tab visibility pickers are the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, showing the draft’s value', () => {
    const { container } = mount();
    expect(container.querySelector('select')).toBeNull();

    const shown: Record<string, string> = {};
    for (const id of PICKERS) {
      const trigger = screen.getByTestId(id);
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger).toHaveAttribute('role', 'combobox');
      shown[id] = trigger.textContent ?? '';
    }
    expect(shown).toEqual({
      'rls-operation-0': 'select',
      // A policy with no operation shows "all", as the native control did.
      'rls-operation-1': 'all',
      'tab-visibility-a_tab': 'perm.tabs.vis.hidden',
      'tab-visibility-b_tab': 'perm.tabs.vis.default_on',
    });
  });

  it('the native pickers had no name, and the triggers have none either', () => {
    mount();
    // The CEL clause editors are comboboxes too, named by their labels.
    const unnamed = screen.getAllByRole('combobox', { name: '' });
    expect(unnamed).toHaveLength(PICKERS.length);
    for (const id of PICKERS) expect(unnamed, id).toContain(screen.getByTestId(id));
  });
});

const TABS_UNCHANGED = '"tabPermissions":{"a_tab":"hidden","b_tab":"default_on"}';
const P1 = (operation: string) =>
  `{"name":"p1","object":"account","operation":"${operation}","using":"true","enabled":true}`;
const P1_AS_IS = P1('select');
const P2 = (operation?: string) =>
  `{"name":"p2","object":"contact","using":"true"${operation ? `,"operation":"${operation}"` : ''}}`;
const RLS = (p1: string, p2: string) => `{"rowLevelSecurity":[${p1},${p2}],${TABS_UNCHANGED}}`;
const TABS = (a: string, b = 'default_on') =>
  `{"rowLevelSecurity":[${P1_AS_IS},${P2()}],"tabPermissions":{"a_tab":"${a}","b_tab":"${b}"}}`;

/**
 * [picker, option label, the JSON text of the draft the one write produced].
 * `null`: nothing is written — the option is the current one.
 */
const WRITES: ReadonlyArray<readonly [string, string, string | null]> = [
  ['rls-operation-0', 'all', RLS(P1('all'), P2())],
  ['rls-operation-0', 'select', null],
  ['rls-operation-0', 'insert', RLS(P1('insert'), P2())],
  ['rls-operation-0', 'update', RLS(P1('update'), P2())],
  ['rls-operation-0', 'delete', RLS(P1('delete'), P2())],
  ['rls-operation-1', 'all', null],
  ['rls-operation-1', 'select', RLS(P1_AS_IS, P2('select'))],
  ['rls-operation-1', 'insert', RLS(P1_AS_IS, P2('insert'))],
  ['rls-operation-1', 'update', RLS(P1_AS_IS, P2('update'))],
  ['rls-operation-1', 'delete', RLS(P1_AS_IS, P2('delete'))],
  ['tab-visibility-a_tab', 'perm.tabs.vis.visible', TABS('visible')],
  ['tab-visibility-a_tab', 'perm.tabs.vis.hidden', null],
  ['tab-visibility-a_tab', 'perm.tabs.vis.default_on', TABS('default_on')],
  ['tab-visibility-a_tab', 'perm.tabs.vis.default_off', TABS('default_off')],
  ['tab-visibility-b_tab', 'perm.tabs.vis.visible', TABS('hidden', 'visible')],
  ['tab-visibility-b_tab', 'perm.tabs.vis.hidden', TABS('hidden', 'hidden')],
  ['tab-visibility-b_tab', 'perm.tabs.vis.default_on', null],
  ['tab-visibility-b_tab', 'perm.tabs.vis.default_off', TABS('hidden', 'default_off')],
];

describe('every option writes what the native control wrote', () => {
  it('the table covers every option of both pickers, in the order each lists them', async () => {
    for (const id of PICKERS) {
      mount();
      const listed = (await openPicker(id)).map((o) => o.textContent);
      expect(listed, id).toEqual(WRITES.filter(([p]) => p === id).map(([, label]) => label));
      cleanup();
    }
  });

  it.each(WRITES.map((row) => [`${row[0]} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, testId, label, json) => {
      const { writes } = mount();
      await pick(testId, label);
      expect(writes).toEqual(json === null ? [] : [json]);
    },
  );
});

describe('read-only follows the primitive (objectui#11781)', () => {
  it('each picker is disabled, wears the primitive’s disabled look, and does not open', () => {
    const look = primitiveDisabledLook();
    expect(look.length, 'the primitive carries no disabled look to compare with').toBeGreaterThan(0);
    const { writes } = mount(DRAFT(), false);
    for (const id of PICKERS) {
      const trigger = screen.getByTestId(id);
      expect(trigger).toBeDisabled();
      for (const token of look) expect(trigger, `${id} lacks ${token}`).toHaveClass(token);
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(screen.queryByRole('listbox'), `${id} opened while read-only`).toBeNull();
    }
    expect(writes).toEqual([]);
  });

  it('CONTROL — writable: the same pickers are enabled', () => {
    mount();
    for (const id of PICKERS) expect(screen.getByTestId(id)).toBeEnabled();
  });
});

/** A policy whose stored operation is `''`, and the empty-key row the Add tab button creates. */
const EDGES = (): Draft => ({
  rowLevelSecurity: [{ name: 'p', object: 'a', operation: '' }],
  tabPermissions: { '': 'visible' },
});

describe('a stored value no option carries is what the trigger shows', () => {
  const OUTSIDE: Draft = {
    rowLevelSecurity: [{ name: 'p1', object: 'account', operation: 'read', using: 'true' }],
    tabPermissions: { a_tab: 'default' },
  };

  it('an operation the picker does not offer is shown and listed first, and re-picking it writes nothing', async () => {
    const { writes } = mount(OUTSIDE);
    // The native control showed "all" here, as if the policy covered every operation.
    expect(screen.getByTestId('rls-operation-0')).toHaveTextContent('read');
    const listed = (await openPicker('rls-operation-0')).map((o) => o.textContent);
    expect(listed).toEqual(['read', 'all', 'select', 'insert', 'update', 'delete']);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(writes).toEqual([]);
  });

  it('a tab visibility the picker does not offer is shown, not "visible"', () => {
    mount(OUTSIDE);
    expect(screen.getByTestId('tab-visibility-a_tab')).toHaveTextContent('default');
    expect(screen.getByTestId('tab-visibility-a_tab')).not.toHaveTextContent('perm.tabs.vis.visible');
  });

  it('a stored operation of "" (which SelectItem refuses as a value) is its own item, and a pick writes what the native control wrote', async () => {
    const { writes } = mount(EDGES());
    // The native control showed "all" here, its first option.
    expect(screen.getByTestId('rls-operation-0')).not.toHaveTextContent('all');
    const listed = (await openPicker('rls-operation-0')).map((o) => o.textContent);
    expect(listed).toEqual(['', 'all', 'select', 'insert', 'update', 'delete']);
    fireEvent.click(screen.getAllByRole('option')[3]);
    expect(writes).toEqual(['{"rowLevelSecurity":[{"name":"p","object":"a","operation":"insert"}],"tabPermissions":{"":"visible"}}']);
  });
});

describe('the row Add tab creates picks like any other', () => {
  it('the empty-key tab writes what the native control wrote', async () => {
    const { writes } = mount(EDGES());
    expect(screen.getByTestId('tab-visibility-')).toHaveTextContent('perm.tabs.vis.visible');
    await pick('tab-visibility-', 'perm.tabs.vis.hidden');
    expect(writes).toEqual(['{"rowLevelSecurity":[{"name":"p","object":"a","operation":""}],"tabPermissions":{"":"hidden"}}']);
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens a picker and Enter on an option selects it', async () => {
    const { writes } = mount();
    fireEvent.keyDown(screen.getByTestId('tab-visibility-a_tab'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'perm.tabs.vis.default_off' }), { key: 'Enter' });
    expect(writes).toEqual([TABS('default_off')]);
  });
});
