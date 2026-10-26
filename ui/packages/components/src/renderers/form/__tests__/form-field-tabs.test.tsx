/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #2959: `FormSchema.fieldTabs` — a tabbed field layout inside ONE form.
 *
 * The contract these pin:
 *  - one `<form>` / react-hook-form instance for every tab;
 *  - panels are force-mounted (only CSS-hidden), so a tab the user leaves keeps
 *    its values AND its validation — react-hook-form skips *unmounted* fields,
 *    which is how a required field on an unopened tab used to reach the server;
 *  - a failed submit activates the tab holding the first offending field and
 *    marks every tab that has one;
 *  - a field no tab claims is still rendered (never silently dropped).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

beforeEach(() => {
  vi.spyOn(toast, 'error').mockImplementation(() => 'id' as any);
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FIELDS = [
  { name: 'subject', label: 'Subject', type: 'input', required: true },
  { name: 'status', label: 'Status', type: 'input' },
  { name: 'description', label: 'Description', type: 'input', required: true },
];

const TABS = [
  { key: 'basics', label: 'Basics', fields: ['subject', 'status'] },
  { key: 'detail', label: 'Detail', description: 'Anything else', fields: ['description'] },
];

function renderTabbedForm(overrides: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const Form = ComponentRegistry.get('form')!;
  const utils = render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        fields: FIELDS,
        fieldTabs: TABS,
        onSubmit,
        ...overrides,
      }}
    />,
  );
  return { ...utils, onSubmit };
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));
const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`)!;
  fireEvent.change(input, { target: { value } });
};
const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('form renderer — fieldTabs (#2959)', () => {
  it('renders one form and one panel per tab, with every field mounted', () => {
    const { container } = renderTabbedForm();

    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    // Both panels exist up front — the inactive one is hidden by CSS, not
    // unmounted, so its fields are present and registered.
    expect(screen.getByTestId('form-tab-panel:basics')).toBeTruthy();
    expect(screen.getByTestId('form-tab-panel:detail')).toBeTruthy();
    for (const name of ['subject', 'status', 'description']) {
      expect(container.querySelector(`[data-field="${name}"]`)).toBeTruthy();
    }
    // The tab's blurb rides along with its panel.
    expect(screen.getByText('Anything else')).toBeTruthy();
  });

  it('marks the inactive panel with data-state=inactive (CSS-hidden, still mounted)', () => {
    renderTabbedForm();
    expect(screen.getByTestId('form-tab-panel:basics')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('form-tab-panel:detail')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByTestId('form-tab-panel:detail').className).toContain(
      'data-[state=inactive]:hidden',
    );
  });

  it('submits values entered across different tabs', async () => {
    const { onSubmit } = renderTabbedForm();

    fill('subject', 'From tab 1');
    fireEvent.click(tab(/Detail/));
    fill('description', 'From tab 2');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      subject: 'From tab 1',
      description: 'From tab 2',
    });
  });

  it('validates fields on tabs the user never opened, and jumps to the offender', async () => {
    const { onSubmit } = renderTabbedForm();

    fill('subject', 'Only tab 1 filled');
    submit();

    // `description` is required and lives on a tab that was never opened.
    await waitFor(() => expect(tab(/Detail/)).toHaveAttribute('data-state', 'active'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(tab(/Detail/)).toHaveAttribute('data-error', 'true');
    expect(tab(/Basics/)).not.toHaveAttribute('data-error');
  });

  it('honors defaultFieldTab', () => {
    renderTabbedForm({ defaultFieldTab: 'detail' });
    expect(screen.getByTestId('form-tab-panel:detail')).toHaveAttribute('data-state', 'active');
  });

  it('keeps the tab schema keys off the <form> DOM element', () => {
    // Callers/the SDUI dispatch spread the whole form node at the top level too,
    // so a FormSchema key that isn't consumed leaks onto the DOM and React logs
    // "does not recognize the `fieldTabs` prop on a DOM element".
    const Form = ComponentRegistry.get('form')!;
    const { container } = render(
      <Form
        schema={{ type: 'form', fields: FIELDS, fieldTabs: TABS }}
        // The top-level spread that reproduces the leak.
        fields={FIELDS}
        fieldTabs={TABS}
        defaultFieldTab="detail"
        fieldTabsPosition="top"
      />,
    );
    const form = container.querySelector('form')!;
    for (const attr of ['fieldtabs', 'defaultfieldtab', 'fieldtabsposition']) {
      expect(form.hasAttribute(attr)).toBe(false);
    }
  });

  it('renders fields no tab claims instead of dropping them', () => {
    const { container } = renderTabbedForm({
      fieldTabs: [
        { key: 'basics', label: 'Basics', fields: ['subject'] },
        { key: 'detail', label: 'Detail', fields: ['description'] },
      ],
    });
    // `status` belongs to no tab — it must still be in the DOM, outside the panels.
    const status = container.querySelector('[data-field="status"]')!;
    expect(status).toBeTruthy();
    expect(status.closest('[role="tabpanel"]')).toBeNull();
  });

  it('falls back to a plain field list for a single tab', () => {
    renderTabbedForm({ fieldTabs: [{ key: 'only', label: 'Only', fields: ['subject'] }] });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    // …and every field still renders, not just the one the lone tab claimed.
    expect(document.body.querySelector('[data-field="description"]')).toBeTruthy();
  });
});
