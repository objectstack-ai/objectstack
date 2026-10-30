// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27521 (Studio row 33) — the Add field popover's Create button
 * says why it is off, and Tab still reaches it.
 *
 * A natively disabled Create gave no reason and was skipped by Tab, so a
 * keyboard or screen-reader author met a form that would not submit with
 * nothing to say why. It is now `aria-disabled`, focusable, and described by
 * the missing step; a submit while it is off creates nothing.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { t } from '../metadata-admin/i18n';
import { AddFieldPopover } from './AddFieldPopover';

afterEach(cleanup);

function renderOpen(takenNames: string[] = []) {
  const onCreate = vi.fn();
  render(
    <AddFieldPopover open onCreate={onCreate} takenNames={takenNames}>
      <button type="button">anchor</button>
    </AddFieldPopover>,
  );
  return { onCreate, create: () => screen.getByTestId('add-field-create') };
}

const typeLabel = (text: string) =>
  fireEvent.change(screen.getByTestId('add-field-label-input'), { target: { value: text } });

describe('Add field · Create says why it is off (objectstack#27521)', () => {
  it('with no label: focusable, described by "type a label", and a click creates nothing', () => {
    const { onCreate, create } = renderOpen();
    expect(create()).not.toBeDisabled();
    expect(create()).toHaveAttribute('aria-disabled', 'true');
    expect(create()).toHaveAccessibleDescription(t('engine.studio.data.addFieldNeedsLabel', 'en-US'));
    create().focus();
    expect(create()).toHaveFocus();
    fireEvent.click(create());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('a label that derives no API name: the reason is the API-name hint', () => {
    const { create } = renderOpen();
    typeLabel('满意度');
    expect(create()).toHaveAttribute('aria-disabled', 'true');
    expect(create()).toHaveAccessibleDescription(t('engine.studio.data.addFieldApiNameNotDerived', 'en-US'));
  });

  it('CONTROL — with a label that names the field, Create is on, undescribed, and creates', () => {
    const { onCreate, create } = renderOpen();
    typeLabel('Health Score');
    expect(create()).not.toHaveAttribute('aria-disabled');
    expect(create()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByTestId('add-field-create-reason')).toBeNull();
    fireEvent.click(create());
    expect(onCreate).toHaveBeenCalledWith('Health Score', 'text', undefined);
  });
});
