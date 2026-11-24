// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35985 — Object Settings › Basics picks the icon and the colour
 * together. The icon picker shows the nine palette swatches, and the trigger
 * and every icon in the grid are drawn as the tile they become, in the chosen
 * colour; picking a swatch patches `color`, and the grid follows it.
 *
 * Control: the same picker anywhere without a colour host (a page, an app, a
 * navigation entry) shows no swatches and line icons, since only objects carry
 * a colour.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { OBJECT_COLORS } from '@objectstack/spec/data';
import { ObjectDefaultInspector } from './ObjectDefaultInspector';
import { IconPickerWidget } from '../widgets';
import { t } from '../i18n';
// The inspector reaches the console's dynamic `@objectstack/formula` and
// `@objectstack/lint` imports (CEL authoring); their first load is paid here,
// at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';

afterEach(cleanup);

const LABEL = t('designer.object.iconAndColor', 'en-US');

function mount(draft: Record<string, unknown>) {
  const onPatch = vi.fn();
  const view = render(
    <ObjectDefaultInspector
      type="object"
      name="account"
      draft={{ name: 'account', label: 'Account', ...draft }}
      onPatch={onPatch}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { onPatch, view };
}

function open(): HTMLElement {
  fireEvent.click(screen.getByRole('combobox', { name: LABEL }));
  return screen.getByRole('dialog');
}

describe('objectstack#35985 — the object icon picker carries the colour palette', () => {
  it('shows the trigger as the object’s tile in its colour, gray when it has none', () => {
    const { view } = mount({ icon: 'building', color: 'orange' });
    const trigger = screen.getByRole('combobox', { name: LABEL });
    expect(trigger.querySelector('[data-object-icon-tile]')).toHaveAttribute('data-object-icon-tile', 'orange');
    view.unmount();
    mount({ icon: 'building' });
    expect(screen.getByRole('combobox', { name: LABEL }).querySelector('[data-object-icon-tile]'))
      .toHaveAttribute('data-object-icon-tile', 'gray');
  });

  it('offers the nine palette swatches as one named radio group, the stored colour checked', () => {
    mount({ icon: 'building', color: 'teal' });
    const dialog = open();
    const group = within(dialog).getByRole('radiogroup', { name: t('engine.form.iconColor', 'en-US') });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('data-color'))).toEqual([...OBJECT_COLORS]);
    expect(within(group).getByRole('radio', { name: t('engine.form.objectColor.teal', 'en-US') }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('draws every icon in the grid as a tile of the chosen colour; picking a swatch patches color', () => {
    const { onPatch } = mount({ icon: 'building', color: 'teal' });
    const dialog = open();
    const tiles = within(dialog).getByRole('listbox').querySelectorAll('[data-object-icon-tile]');
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of Array.from(tiles)) expect(tile).toHaveAttribute('data-object-icon-tile', 'teal');

    fireEvent.click(within(dialog).getByRole('radio', { name: t('engine.form.objectColor.purple', 'en-US') }));
    expect(onPatch).toHaveBeenCalledWith({ color: 'purple' });
  });

  it('control: the picker with no colour host shows no swatches and line icons', () => {
    render(<IconPickerWidget id="page-icon" schema={{ type: 'string' }} value="building" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('combobox'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    expect(dialog.querySelector('[data-object-icon-tile]')).toBeNull();
  });
});
