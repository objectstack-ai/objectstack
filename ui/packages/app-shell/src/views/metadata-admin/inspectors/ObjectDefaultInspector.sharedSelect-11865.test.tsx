// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object inspector's access posture is the shared `Select`
 * (objectui#11865).
 *
 * The object designer's home panel picked the object's access posture
 * (`access.default`) with a browser-native select element, beside the shared
 * Radix `Select` the rest of the designer picks with. The card asks for one
 * control for one kind of choice, surface by surface; this suite covers this
 * picker.
 *
 * What is pinned:
 *   - the picker IS the primitive (a Radix combobox trigger) and no native
 *     select is left; it has no accessible name, as the native control had
 *     none (the caption above it is a `Label` with no `htmlFor`);
 *   - both options write the patch the native control wrote, from each
 *     stored posture (none, private, an explicit public, and an off-spec
 *     value, which reads as public); re-picking the shown posture writes
 *     nothing;
 *   - read-only disables the trigger in the primitive's own look
 *     (objectui#11781);
 *   - the keyboard alone opens the picker and selects.
 *
 * Not pinned, because it cannot happen: a stored value outside the options.
 * The posture shown is derived (`private` only for `access.default ===
 * 'private'`, else `public`), so it is always one of the two, here as on the
 * base.
 *
 * DIRECTION, observed against the native control: every pin here but the
 * name pin is red there, because each opens the primitive's listbox or reads
 * its trigger. The patch literals are what a `change` event on the
 * pre-conversion picker wrote, read once on that component.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ObjectDefaultInspector } from './ObjectDefaultInspector';

afterEach(() => cleanup());

const PUBLIC = 'Public — covered by wildcard grants (default)';
const PRIVATE = 'Private — needs an explicit grant';

/** A patch as text, with a key that holds `undefined` named rather than dropped. */
const asText = (patch: unknown) => JSON.stringify(patch, (_k, v) => (v === undefined ? '(undefined)' : v));

function mount(draft: Record<string, unknown>, readOnly = false): string[] {
  const patches: string[] = [];
  render(
    <ObjectDefaultInspector
      type="object"
      name="account"
      draft={{ name: 'account', ...draft }}
      onPatch={(p) => patches.push(asText(p))}
      readOnly={readOnly}
      locale="en-US"
      onSelectionChange={() => {}}
    />,
  );
  return patches;
}

const trigger = () => screen.getByTestId('object-access-posture');

describe('the object inspector picks the access posture with the shared Select (objectui#11865)', () => {
  it('renders the picker as the Radix combobox trigger, with no native select left and no name', () => {
    mount({});
    expect(document.querySelector('select')).toBeNull();
    const el = trigger();
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('role', 'combobox');
    expect(el.textContent).toBe(PUBLIC);
    expect(el).not.toHaveAccessibleName();
  });

  // [stored access, shown before, picked, the patches the pick writes]. Each
  // literal is what the native control's `change` wrote, read on the
  // pre-conversion picker, except the re-pick rows: the posture the trigger
  // already shows, which writes nothing here, as a browser's native control
  // fired no `change` for it (the test DOM's did).
  const CLEARED = '{"access":"(undefined)"}';
  const MADE_PRIVATE = '{"access":{"default":"private"}}';
  it.each([
    ['none', {}, PUBLIC, PUBLIC, []],
    ['none', {}, PUBLIC, PRIVATE, [MADE_PRIVATE]],
    ['private', { access: { default: 'private' } }, PRIVATE, PUBLIC, [CLEARED]],
    ['private', { access: { default: 'private' } }, PRIVATE, PRIVATE, []],
    ['an explicit public', { access: { default: 'public' } }, PUBLIC, PUBLIC, []],
    ['an explicit public', { access: { default: 'public' } }, PUBLIC, PRIVATE, [MADE_PRIVATE]],
    ['an off-spec value', { access: { default: 'weird' } }, PUBLIC, PUBLIC, []],
    ['an off-spec value', { access: { default: 'weird' } }, PUBLIC, PRIVATE, [MADE_PRIVATE]],
  ] as const)('stored %s: shown %s, picking %s writes %j', async (_name, draft, shown, picked, expected) => {
    const patches = mount(draft);
    expect(trigger().textContent).toBe(shown);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: picked }));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(patches).toEqual(expected);
  });

  it('read-only disables the trigger, which then opens nothing', () => {
    mount({ access: { default: 'private' } }, true);
    expect(trigger()).toBeDisabled();
    expect(trigger().textContent).toBe(PRIVATE);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter opens the picker and Enter on an option selects it', async () => {
    const patches = mount({});
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: PRIVATE }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(patches).toEqual([MADE_PRIVATE]);
  });
});
