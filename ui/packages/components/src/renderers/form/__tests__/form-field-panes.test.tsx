/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #2153: `FormSchema.fieldPanes` — a split field layout inside ONE form.
 *
 * The sibling of `fieldTabs` (#2959), for side-by-side panels. A `<form>` cannot
 * live inside each panel and still be one form, so the renderer puts the `<form>`
 * around the whole panel group and the panels hold only fields.
 *
 * The contract these pin:
 *  - one `<form>` / react-hook-form instance across every pane, so a submit
 *    carries all of them and a field rule can read across the divider;
 *  - a field no pane claims is still rendered (never silently dropped);
 *  - the pane schema keys never reach the `<form>` DOM element;
 *  - `fieldPanesResizable: false` actually pins the divider.
 *
 * Pane SIZES cannot be asserted here: react-resizable-panels resolves them
 * against the measured group width, which is 0 under happy-dom, so every panel
 * comes out an even `flex-grow: 50`. They are verified in a real browser.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FIELDS = [
  { name: 'subject', label: 'Subject', type: 'input' },
  { name: 'status', label: 'Status', type: 'input' },
  { name: 'priority', label: 'Priority', type: 'input' },
];

const PANES = [
  { key: 'primary', fields: ['subject'], defaultSize: 40 },
  { key: 'secondary', fields: ['status', 'priority'], defaultSize: 60 },
];

function renderSplitForm(overrides: Record<string, unknown> = {}) {
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
        fieldPanes: PANES,
        onSubmit,
        ...overrides,
      }}
    />,
  );
  return { ...utils, onSubmit };
}

const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
  if (!input) throw new Error(`field not rendered: ${name}`);
  fireEvent.change(input, { target: { value } });
};

const pane = (key: string) => document.body.querySelector(`[data-testid="form-pane:${key}"]`);

describe('FormSchema.fieldPanes — one form across the split (#2153)', () => {
  it('renders one <form> and lays each pane out in its own panel', () => {
    const { container } = renderSplitForm();

    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(pane('primary')?.querySelector('[data-field="subject"]')).toBeTruthy();
    expect(pane('secondary')?.querySelector('[data-field="status"]')).toBeTruthy();
    expect(pane('secondary')?.querySelector('[data-field="priority"]')).toBeTruthy();
    // Both panes are inside the single form, not the other way round (which is
    // the arrangement that cannot work: a <form> per panel).
    const form = container.querySelector('form')!;
    expect(form.querySelector('[data-testid="form-pane:primary"]')).toBeTruthy();
    expect(form.querySelector('[data-testid="form-pane:secondary"]')).toBeTruthy();
  });

  it('submits every pane’s values', async () => {
    const { onSubmit } = renderSplitForm();

    fill('subject', 'Printer on fire');
    fill('status', 'open');
    fill('priority', 'high');

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      subject: 'Printer on fire',
      status: 'open',
      priority: 'high',
    });
  });

  it('evaluates a field rule across the divider', async () => {
    renderSplitForm({
      fields: [
        ...FIELDS,
        {
          name: 'escalation',
          label: 'Escalation',
          type: 'input',
          // Watches a field in the OTHER pane — only one shared react-hook-form
          // instance can see it. With a form per panel the predicate faulted on
          // the missing key and failed open, so the field was always visible.
          visibleWhen: "record.subject == 'urgent'",
        },
      ],
      fieldPanes: [
        { key: 'primary', fields: ['subject'] },
        { key: 'secondary', fields: ['status', 'escalation'] },
      ],
    });

    expect(document.body.querySelector('[data-field="escalation"]')).toBeNull();

    fill('subject', 'urgent');

    await waitFor(() =>
      expect(pane('secondary')?.querySelector('[data-field="escalation"]')).toBeTruthy(),
    );
  });

  it('keeps the pane schema keys off the <form> DOM element', () => {
    // Callers / the SDUI dispatch spread the whole form node at the top level as
    // well, so an unconsumed FormSchema key leaks onto the DOM and React logs
    // "does not recognize the `fieldPanes` prop on a DOM element".
    const Form = ComponentRegistry.get('form')!;
    const { container } = render(
      <Form
        schema={{ type: 'form', fields: FIELDS, fieldPanes: PANES }}
        // The top-level spread that reproduces the leak.
        fields={FIELDS}
        fieldPanes={PANES}
        fieldPanesOrientation="vertical"
        fieldPanesResizable={false}
      />,
    );
    const form = container.querySelector('form')!;
    for (const attr of ['fieldpanes', 'fieldpanesorientation', 'fieldpanesresizable']) {
      expect(form.hasAttribute(attr)).toBe(false);
    }
  });

  it('renders fields no pane claims instead of dropping them', () => {
    const { container } = renderSplitForm({
      fieldPanes: [
        { key: 'primary', fields: ['subject'] },
        { key: 'secondary', fields: ['status'] },
      ],
    });

    // `priority` belongs to no pane — still in the DOM, outside the panels.
    const priority = container.querySelector('[data-field="priority"]')!;
    expect(priority).toBeTruthy();
    expect(priority.closest('[data-panel]')).toBeNull();
  });

  it('falls back to a plain field list for a single pane', () => {
    const { container } = renderSplitForm({
      fieldPanes: [{ key: 'only', fields: ['subject'] }],
    });

    expect(container.querySelector('[data-panel]')).toBeNull();
    expect(pane('only')).toBeNull();
    // …and every field still renders, not just the one the lone pane claimed.
    expect(container.querySelector('[data-field="priority"]')).toBeTruthy();
  });

  it('lets a tabbed layout win when a caller declares both', () => {
    renderSplitForm({
      fieldTabs: [
        { key: 'basics', label: 'Basics', fields: ['subject'] },
        { key: 'triage', label: 'Triage', fields: ['status', 'priority'] },
      ],
    });

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(pane('primary')).toBeNull();
  });

  it('pins the divider when fieldPanesResizable is false', () => {
    const { container } = renderSplitForm({ fieldPanesResizable: false });
    const separator = container.querySelector('[role="separator"]')!;
    expect(separator.getAttribute('aria-disabled')).toBe('true');
  });

  it('leaves the divider draggable by default', () => {
    const { container } = renderSplitForm();
    const separator = container.querySelector('[role="separator"]')!;
    expect(separator.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('gives a vertical split a full-width divider, not a 1px sliver', () => {
    // `fieldPanesOrientation: 'vertical'` stacks the panes, so the divider is a
    // horizontal rule. It used to render as a 1px-wide vertical sliver: the
    // Shadcn handle styled that case with `data-[panel-group-direction=vertical]`
    // variants, which react-resizable-panels v4 never triggers. The form renders
    // through `custom/resizable`, which re-keys them onto the separator's own
    // `aria-orientation` — see custom/resizable.tsx and
    // __tests__/resizable-orientation.test.tsx.
    const { container } = renderSplitForm({ fieldPanesOrientation: 'vertical' });
    const separator = container.querySelector('[role="separator"]')!;

    expect(separator.getAttribute('aria-orientation')).toBe('horizontal');
    expect([...separator.classList]).toContain('aria-[orientation=horizontal]:w-full');

    // …and the default (side-by-side) split still gets the vertical divider.
    cleanup();
    const sideBySide = renderSplitForm().container.querySelector('[role="separator"]')!;
    expect(sideBySide.getAttribute('aria-orientation')).toBe('vertical');
  });
});
