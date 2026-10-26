// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12531 — Object Settings › Basics › Icon is picked, not typed blind.
 *
 * The field was a text input hinted "Lucide icon name (e.g. building, users)",
 * so a misspelt name was stored as typed and drew the fallback glyph with
 * nothing on screen saying so. It now mounts the console's one icon picker,
 * `IconPickerWidget` (the action inspector's and the Studio nav inspector's),
 * named by the field's own label:
 *
 *  - typing `build` in the picker's search lists `building`, and picking it
 *    patches `icon: 'building'`;
 *  - a stored name that matches no icon shows the picker's inline warning;
 *  - clearing patches `icon: undefined`, the convention the text field had;
 *  - read-only disables the picker, as it disabled the text field.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ObjectDefaultInspector } from './ObjectDefaultInspector';
import { t } from '../i18n';

afterEach(cleanup);

const ICON_LABEL = t('designer.object.icon', 'en-US');

function mount(draft: Record<string, unknown>, readOnly = false) {
  const onPatch = vi.fn();
  render(
    <ObjectDefaultInspector
      type="object"
      name="account"
      draft={{ name: 'account', label: 'Account', ...draft }}
      onPatch={onPatch}
      onSelectionChange={vi.fn()}
      readOnly={readOnly}
      locale="en-US"
    />,
  );
  return onPatch;
}

/** The Icon field's control, found by the name its label gives it. */
function iconTrigger(): HTMLElement {
  return screen.getByRole('combobox', { name: ICON_LABEL });
}

function openAndSearch(query: string): HTMLElement {
  fireEvent.click(iconTrigger());
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(t('engine.form.searchIcons', 'en-US')), {
    target: { value: query },
  });
  return dialog;
}

describe('objectui#12531 — ObjectDefaultInspector picks the object icon from the catalog', () => {
  it('the Icon field is the icon picker, named by its label, and no text box', () => {
    mount({ icon: 'building' });
    const trigger = iconTrigger();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveTextContent('building');
    expect(screen.queryByRole('textbox', { name: ICON_LABEL })).toBeNull();
  });

  it('typing "build" lists building, and picking it patches icon: "building"', () => {
    const onPatch = mount({});
    const dialog = openAndSearch('build');
    const titles = within(dialog).getAllByRole('option').map((o) => o.getAttribute('title'));
    expect(titles).toContain('building');
    for (const title of titles) expect(title).toContain('build');
    fireEvent.click(within(dialog).getAllByRole('option').find((o) => o.getAttribute('title') === 'building') as HTMLElement);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ icon: 'building' });
  });

  it('a stored name that matches no icon shows the warning; a catalog name does not (CONTROL)', () => {
    mount({ icon: 'not-an-icon' });
    expect(screen.getByTestId('icon-picker-unknown-name')).toHaveTextContent('not-an-icon');
    cleanup();
    mount({ icon: 'building' });
    expect(screen.queryByTestId('icon-picker-unknown-name')).toBeNull();
  });

  it('clearing the icon patches icon: undefined, as the text field did', () => {
    const onPatch = mount({ icon: 'building' });
    fireEvent.click(iconTrigger());
    fireEvent.click(within(screen.getByRole('dialog')).getByTitle(t('engine.form.none', 'en-US')));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch.mock.calls[0][0]).toEqual({ icon: undefined });
    expect(Object.prototype.hasOwnProperty.call(onPatch.mock.calls[0][0], 'icon')).toBe(true);
  });

  it('read-only disables the picker', () => {
    const onPatch = mount({ icon: 'building' }, true);
    expect(iconTrigger()).toBeDisabled();
    fireEvent.click(iconTrigger());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
  });
});
