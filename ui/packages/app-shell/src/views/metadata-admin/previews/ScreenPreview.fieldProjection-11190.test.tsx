// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11190 — the Studio screen preview carries every key of a screen
 * field that `ScreenView` renders, so it draws a field as the runtime dialog
 * does: a `select` with `options` is a combobox, a `placeholder` shows, and a
 * `defaultValue` seeds the control.
 *
 * The preview renders through the shared `ScreenView`, but it builds its
 * `ScreenSpec` from the authored node config first (`buildScreenSpec`), and
 * that projection decides which keys reach the renderer. It is keyed by the
 * spec's own `ScreenFieldSpec`, so it has no key list of its own to fall behind.
 *
 * `defaultValue` is the one key the preview cannot render as the end user sees
 * it: the engine fills in its `{…}` references from the run's variables when
 * the screen pauses, and the preview has no run. It shows the value as written
 * and marks it with a hint line under the form (maintainer triage on the card:
 * "show the literal, with a marker").
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: [] }),
}));

import { ScreenPreview } from './ScreenPreview';
import { buildScreenSpec } from './screen-spec';
import { ScreenView, initialScreenValues, type ScreenFieldSpec, type ScreenSpec } from '../../ScreenView';

afterEach(cleanup);

/**
 * The `fields` of the `screen_1` node of objectstack `examples/app-todo`'s
 * `QuickAddTaskFlow` (`src/flows/task.flow.ts`, as it stands at objectstack
 * `0f6dcac5e9`, the `@objectstack/*` 17.5.0 tag), field for field.
 */
const APP_TODO_SCREEN_1_FIELDS = [
  { name: 'subject', label: 'Task Subject', type: 'text', required: true },
  {
    name: 'priority', label: 'Priority', type: 'select', defaultValue: 'normal',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'normal', label: 'Normal' },
      { value: 'high', label: 'High' },
      { value: 'urgent', label: 'Urgent' },
    ],
  },
  { name: 'dueDate', label: 'Due Date', type: 'date', required: false },
  {
    name: 'category', label: 'Category', type: 'select',
    options: [
      { value: 'personal', label: 'Personal' },
      { value: 'work', label: 'Work' },
      { value: 'shopping', label: 'Shopping' },
      { value: 'health', label: 'Health' },
      { value: 'finance', label: 'Finance' },
      { value: 'other', label: 'Other' },
    ],
  },
];

/** The comboboxes on screen, by the control id `ScreenView` gives each field (`ff-` + its name). */
function comboboxIds(): string[] {
  return screen.queryAllByRole('combobox').map((c) => c.getAttribute('id') ?? '');
}

describe('objectui#11190 — the screen preview renders a field as the runtime does', () => {
  it("app-todo's screen_1 renders its two selects as comboboxes in the preview, as at runtime", () => {
    render(<ScreenPreview node={{ id: 'screen_1', label: 'Task Details', config: { fields: APP_TODO_SCREEN_1_FIELDS } }} />);
    const preview = comboboxIds();
    expect(preview).toEqual(['ff-priority', 'ff-category']);
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
    // `defaultValue: 'normal'` seeds the select, as the runtime seeds it.
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Normal');
    // The plain text field stays a text box.
    expect(screen.getByRole('textbox', { name: 'Task Subject' })).toBeInTheDocument();
    // A default with no `{…}` reference is what the run shows too: no marker.
    expect(document.querySelectorAll('[data-default-template]')).toHaveLength(0);
    cleanup();

    // The runtime: the wire shape the engine's `screen` executor sends for
    // the same rows (`required` stated; `'normal'` has no reference to fill
    // in), rendered by `ScreenView` with the values it seeds.
    const wire: ScreenSpec = {
      nodeId: 'screen_1',
      fields: APP_TODO_SCREEN_1_FIELDS.map((f) => ({ ...f, required: f.required === true })),
    };
    render(<ScreenView screen={wire} values={initialScreenValues(wire)} onValueChange={() => {}} />);
    expect(comboboxIds()).toEqual(preview);
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Normal');
  });

  it('a placeholder shows', () => {
    render(
      <ScreenPreview
        node={{ id: 's1', config: { fields: [{ name: 'note', label: 'Note', type: 'text', placeholder: 'e.g. call the client' }] } }}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute('placeholder', 'e.g. call the client');
  });

  it('a defaultValue template shows as written, with its marker naming the field and the template', () => {
    const { container } = render(
      <ScreenPreview
        node={{
          id: 's1',
          config: { fields: [{ name: 'followUp', label: 'Follow-up', type: 'text', defaultValue: 'Call {customer} back' }] },
        }}
        // The preview holds a value for `customer` and still does not fill it in.
        variables={{ customer: 'Acme' }}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Follow-up' })).toHaveValue('Call {customer} back');
    const marker = container.querySelector('[data-default-template="followUp"]') as HTMLElement;
    expect(marker).toHaveTextContent('Default template for “Follow-up”, shown as written — the run fills it in:');
    expect(within(marker).getByText('Call {customer} back').tagName).toBe('CODE');
  });

  it('the marker reads the designer locale, and shows a template the control itself cannot display', () => {
    const { container } = render(
      <ScreenPreview
        node={{ id: 's1', config: { fields: [{ name: 'due', label: 'Due', type: 'date', defaultValue: '{dueDate}' }] } }}
        locale="zh-CN"
      />,
    );
    const marker = container.querySelector('[data-default-template="due"]') as HTMLElement;
    expect(marker).toHaveTextContent('“Due”的默认值模板,按原文显示 —— 运行时填入实际值:');
    expect(within(marker).getByText('{dueDate}')).toBeInTheDocument();
  });

  it('control: a field declaring none of the keys renders as it did — a bare text box, no marker', () => {
    const { container } = render(
      <ScreenPreview node={{ id: 's1', config: { fields: [{ name: 'plain', label: 'Plain' }] } }} />,
    );
    const box = screen.getByRole('textbox', { name: 'Plain' });
    expect(box).toHaveValue('');
    expect(box).not.toHaveAttribute('placeholder');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(container.querySelectorAll('[data-default-template]')).toHaveLength(0);
  });
});

describe('objectui#11190 — the projection carries every ScreenFieldSpec key', () => {
  it('a row holding every key of the spec type comes out whole', () => {
    // `Required<ScreenFieldSpec>`: a key the spec adds fails this package's
    // test type-check here (and `screen-spec.ts`'s own) until it is given a
    // value; a key the projection drops fails this assertion.
    const full: Required<ScreenFieldSpec> = {
      name: 'qty',
      label: 'Quantity',
      type: 'select',
      required: true,
      options: [{ value: 1, label: 'One' }],
      defaultValue: 1,
      placeholder: 'Pick one',
      min: 1,
      max: 10,
      inlineHelpText: 'Between one and ten',
      reference: 'account',
      visibleWhen: 'true',
    };
    expect(buildScreenSpec({ id: 'n1', config: { fields: [full] } }).fields).toStrictEqual([full]);
  });

  it('carries each new key only when it holds the declared type', () => {
    const spec = buildScreenSpec({
      id: 'n1',
      config: {
        fields: [
          // An option without a `label` is half-typed, so the list is not carried.
          { name: 'a', type: 'select', options: [{ value: 'x', label: 'X' }, { value: 'y' }], placeholder: 3 },
          { name: 'b', options: 'x,y' },
          // `defaultValue` is `unknown` in the spec: `null` is carried, as the executor forwards it.
          { name: 'c', defaultValue: null },
        ],
      },
    });
    expect(spec.fields).toStrictEqual([
      { name: 'a', type: 'select', required: false },
      { name: 'b', required: false },
      { name: 'c', required: false, defaultValue: null },
    ]);
  });
});
