/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end: BOTH select paths associate the form's visible label with the
 * control the user operates (objectui#3976, the built-in half of #3306).
 *
 * There are two `select` paths through the form renderer and they do not share
 * an implementation:
 *
 *  - **registered widget** — `type: 'field:select'` (what `mapFieldTypeToFormType`
 *    emits for object-driven forms) resolves to this package's `SelectField`.
 *    objectui#3306 moved its DOM pass-through from Radix's `Select.Root` — which
 *    renders no element and silently drops what it does not recognise — onto
 *    `SelectTrigger`, the focusable `<button role="combobox">`.
 *  - **built-in branch** — a hand-written `type: 'select'` never reaches the
 *    registry at all (`'select'` is a `BUILTIN_FIELD_TYPES` member), so the form
 *    renderer's own `Select` branch renders it. That branch kept spreading onto
 *    Root until objectui#3976: the visible label pointed at an id no element
 *    carried, `getByLabelText` found nothing, and `aria-describedby` /
 *    `aria-invalid` / `aria-required` never reached the DOM either.
 *
 * The paths are pinned side by side, in one file, precisely because the fork is
 * what caused the bug: #3306 fixed one half and the other silently kept the
 * defect for as long as nobody wrote a bare `type: 'select'` into a test. The
 * registered half here is a POSITIVE CONTROL — it must stay green through any
 * change to the built-in branch.
 *
 * The widget is registered raw rather than through `registerAllFields()`, which
 * wraps every loader in `React.lazy`: an unbounded module load inside a bounded
 * `findBy`/`waitFor` window is the repo's known flake generator (AGENTS.md
 * 测试纪律, objectui#3010). Same component, no Suspense boundary.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { SelectField } from '../widgets/SelectField';

const OPTIONS = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
];

beforeAll(() => {
  ComponentRegistry.register('select', SelectField as any, {
    namespace: 'field',
    skipFallback: true,
  });
}, 30000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The real form renderer hosting one field. */
function renderForm(field: any, defaultValue: unknown = undefined) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues: { [field.name]: defaultValue },
        fields: [field],
        onSubmit: () => {},
      }}
    />,
  );
}

/** Every `<label for=…>` in the document, paired with its resolved target. */
function labelTargets(): Array<{ text: string; forId: string; resolves: boolean }> {
  return Array.from(document.querySelectorAll('label'))
    .map((el) => ({
      text: (el.textContent ?? '').trim(),
      forId: el.getAttribute('for') ?? '',
      resolves: !!el.getAttribute('for') && !!document.getElementById(el.getAttribute('for')!),
    }))
    .filter((l) => l.forId !== '');
}

/** The trigger button, by role — fails loudly if it stops being a combobox. */
function trigger(name: string): Element {
  const el = document.querySelector(`[data-field="${name}"] [role="combobox"]`);
  if (!el) throw new Error(`no select trigger rendered for field "${name}"`);
  return el;
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

/**
 * The guarantees a select must give whichever path rendered it. Run twice, so
 * neither path can drift away from the other again.
 */
const PATHS = [
  ['built-in branch (bare `type: select`, objectui#3976)', 'select'],
  ['registered widget (`field:select`, objectui#3306 — positive control)', 'field:select'],
] as const;

describe.each(PATHS)('%s', (_label, type) => {
  const field = { name: 'choice', label: 'Choice', type, options: OPTIONS };

  it('emits no label pointing at an id nothing carries', () => {
    renderForm(field);

    const labels = labelTargets();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((l) => !l.resolves)).toEqual([]);
  });

  it('resolves the visible label to the trigger button', () => {
    renderForm(field);

    // `getAllByLabelText` walks `for`→id, so it guards the association itself:
    // on the built-in path this used to find NOTHING at all.
    const labelled = screen.getAllByLabelText('Choice');
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(trigger('choice'));
    expect(labelled[0].tagName).toBe('BUTTON');
  });

  it('gives the combobox the label as its accessible name', () => {
    renderForm(field);

    expect(screen.getByRole('combobox', { name: 'Choice' })).toBe(trigger('choice'));
  });

  it('carries the required state on the trigger', () => {
    renderForm({ ...field, required: true });

    expect(trigger('choice')).toHaveAttribute('aria-required', 'true');
  });

  it('announces invalid on the trigger and links the message', async () => {
    renderForm({ ...field, required: true }, null);

    // A valid field SAYS it is valid rather than staying mute (#3222/#3306).
    expect(trigger('choice')).toHaveAttribute('aria-invalid', 'false');

    submit();

    const message = await screen.findByText('Choice is required');
    await waitFor(() => expect(trigger('choice')).toHaveAttribute('aria-invalid', 'true'));
    expect(message.id).not.toBe('');
    const describedBy = trigger('choice').getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(/\s+/)).toContain(message.id);
  });

  it('keeps `name` on Root, where the submitted hidden select is', () => {
    // The whitelist both paths share: `name` is the ONE key Root consumes — it
    // forwards it to the hidden native `<select>` that takes part in form
    // submission. On the trigger it would sit uselessly on a non-submitter.
    renderForm(field);

    expect(document.querySelector('[data-field="choice"] select[aria-hidden="true"]')).toHaveAttribute(
      'name',
      'choice',
    );
    expect(trigger('choice')).not.toHaveAttribute('name');
  });
});

describe('the fork itself (objectui#3976 / #3231)', () => {
  it('a bare `type: select` renders the BUILT-IN branch even though field:select resolves', () => {
    // Measured, not inferred — this is the fact that made #3976 a built-in-side
    // bug rather than a duplicate of #3306: `renderFieldComponent` skips the
    // registry entirely for a `BUILTIN_FIELD_TYPES` member, so `SelectField` is
    // NOT what renders a hand-written `type: 'select'`, even here where the real
    // widget is registered under `field:select`.
    expect(ComponentRegistry.get('field:select')).toBe(SelectField);

    renderForm({ name: 'choice', label: 'Choice', type: 'select', options: OPTIONS });

    // `SelectField` stamps this locator on the trigger it renders; the built-in
    // branch does not. Same role, different implementation.
    expect(document.querySelector('[data-testid="select-trigger-choice"]')).toBeNull();
    expect(trigger('choice')).toBeInTheDocument();
  });
});
