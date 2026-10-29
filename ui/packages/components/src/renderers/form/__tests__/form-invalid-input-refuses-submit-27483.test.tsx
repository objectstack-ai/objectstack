/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27483 — the form renderer's half of the `onInvalidInputChange`
 * channel: a widget's report of text it could not parse becomes the field's
 * validation error and refuses submit; withdrawing it lets the submit through;
 * and only the widgets that report receive the callback.
 *
 * The real date picker lives in `@object-ui/fields`, which components tests
 * never load (its end-to-end pin is there); a probe stands in for it here.
 */

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

const MESSAGE = 'Not saved: "13/45/2026" is not a date.';

function ReportingProbe(props: any) {
  return (
    <div data-testid={`probe-${props.field?.name}`} data-has-key={'onInvalidInputChange' in props ? 'yes' : 'no'}>
      <button type="button" onClick={() => props.onInvalidInputChange?.(MESSAGE)}>
        report
      </button>
      <button type="button" onClick={() => props.onInvalidInputChange?.(null)}>
        withdraw
      </button>
    </div>
  );
}

beforeAll(() => {
  ComponentRegistry.register('field:date', ReportingProbe, { namespace: 'test' });
  // A registered widget that does not report: the strip must keep the key off it.
  ComponentRegistry.register('field:lookup', ReportingProbe, { namespace: 'test' });
}, 30000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

function renderForm(onSubmit: (data: Record<string, unknown>) => void) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues: { due: null },
        fields: [
          { name: 'due', label: 'Due Date', type: 'field:date' },
          { name: 'account', label: 'Account', type: 'field:lookup' },
        ],
        onSubmit,
      }}
    />,
  );
}

const dueRow = () => document.querySelector('[data-field="due"]') as HTMLElement;
const within = (row: HTMLElement, name: string) =>
  Array.from(row.querySelectorAll('button')).find((b) => b.textContent === name)!;

describe('form renderer — unparseable widget input is a field error (objectstack#27483)', () => {
  it('a report shows as the field message at once and refuses submit', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.click(within(dueRow(), 'report'));
    await waitFor(() => expect(dueRow().textContent).toContain(MESSAGE));

    const scroll = vi.spyOn(Element.prototype as any, 'scrollIntoView');
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a withdrawn report clears the error and the submit goes through', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.click(within(dueRow(), 'report'));
    await waitFor(() => expect(dueRow().textContent).toContain(MESSAGE));
    fireEvent.click(within(dueRow(), 'withdraw'));
    await waitFor(() => expect(dueRow().textContent).not.toContain(MESSAGE));

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('only the reporting widget types receive the callback', () => {
    renderForm(() => {});
    expect(screen.getByTestId('probe-due')).toHaveAttribute('data-has-key', 'yes');
    expect(screen.getByTestId('probe-account')).toHaveAttribute('data-has-key', 'no');
  });
});
