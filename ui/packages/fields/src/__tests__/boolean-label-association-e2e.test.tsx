/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end: a boolean field's VISIBLE label is associated with the control
 * the widget renders (objectui#3952).
 *
 * The defect: `<FormControl>` is a Radix `Slot` that hands its child the id
 * `<FormLabel htmlFor>` already points at (`_r_N_-form-item`), and
 * `BooleanField` REPLACED it with the field name. So the form's visible label
 * referenced an id no element carried — clicking it toggled nothing — while the
 * widget emitted a SECOND, `sr-only` label of its own carrying the same text.
 * The accessible name survived only by that accident.
 *
 * Two scenarios, pinned separately, because the widget has two hosts with
 * opposite needs:
 *
 *  - **hosted** (the form renderer, `ObjectForm`, any `<FormControl>`): the host
 *    owns the id AND the label. The widget must use the id it was handed and
 *    must NOT emit a label of its own — that is the duplicate half of the bug.
 *  - **standalone** (`FieldEditWidget`'s inline grid editor, a bare SDUI node):
 *    nobody hands an id and nobody renders a label, so the widget's own
 *    `sr-only` label is the control's ONLY accessible name and must stay.
 *
 * The widgets are registered raw rather than through `registerAllFields()`,
 * which wraps every loader in `React.lazy`: an unbounded module load inside a
 * bounded `findBy`/`waitFor` window is the repo's known flake generator
 * (AGENTS.md 测试纪律, objectui#3010). Same component, no Suspense boundary.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { BooleanField } from '../widgets/BooleanField';

beforeAll(() => {
  ComponentRegistry.register('boolean', BooleanField as any, {
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

/** The real form renderer hosting one field — the #3952 reproduction. */
function renderForm(field: any, defaultValue: unknown) {
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

/** The two-state control a field row drew — a switch or a checkbox. */
const controlOf = (name: string): Element => {
  const el = document.querySelector(`[data-field="${name}"] [role="switch"], [data-field="${name}"] [role="checkbox"]`);
  if (!el) throw new Error(`no two-state control rendered for field "${name}"`);
  return el;
};

// A `toggle`, in the shape `ObjectForm` hands the form: the widget id
// `mapFieldTypeToFormType` resolves (`field:boolean` for both boolean types)
// plus the object's own field metadata, whose `type` decides the face — a
// `toggle` draws a switch, a `boolean` a checkbox (objectstack#27519). The
// two-field case below hosts one of each.
const BOOLEAN_FIELD = {
  name: 'notifications',
  label: 'Email Notifications',
  type: 'field:boolean',
  field: { name: 'notifications', label: 'Email Notifications', type: 'toggle' },
};

describe('a form-hosted boolean field is labelled by its HOST (objectui#3952)', () => {
  it('every label the form emits points at an element that exists', () => {
    renderForm(BOOLEAN_FIELD, false);

    const labels = labelTargets();
    expect(labels.length).toBeGreaterThan(0);
    // A `for` naming an id nothing carries is the defect verbatim: the form's
    // visible label used to reference `_r_N_-form-item` while the switch
    // carried `notifications`.
    expect(labels.filter((l) => !l.resolves)).toEqual([]);
  });

  it('the visible label names the switch — one label, associated with the control', () => {
    renderForm(BOOLEAN_FIELD, false);

    // `getAllByLabelText` resolves label→control through `for`/id, so it guards
    // the ID half: restore the override and it does not merely return the wrong
    // node, it throws "found a label … however no form control was found
    // associated to that label" — the switch left with NO accessible name,
    // which is exactly what #3952 warned would happen the day the widget's own
    // label went away. It does NOT guard the duplicate half: two labels
    // pointing at ONE control still resolve to one element (measured), so the
    // duplicate is pinned by the label-text count below.
    const labelled = screen.getAllByLabelText('Email Notifications');
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(controlOf('notifications'));
    expect(labelled[0]).toHaveAttribute('role', 'switch');
  });

  it('the label text appears exactly once in the DOM', () => {
    renderForm(BOOLEAN_FIELD, false);

    // The duplicate half of the defect (and why a naive `getByText` on a
    // boolean field returned two nodes).
    expect(screen.getAllByText('Email Notifications')).toHaveLength(1);
  });

  it('activating the visible label toggles the switch', () => {
    renderForm(BOOLEAN_FIELD, false);

    const control = controlOf('notifications');
    expect(control).toHaveAttribute('aria-checked', 'false');

    // The user-facing symptom of #3952: the normal affordance for a switch row
    // is clicking its label. It reaches the control only through the `for`/id
    // association the form set up.
    fireEvent.click(screen.getByText('Email Notifications'));

    expect(controlOf('notifications')).toHaveAttribute('aria-checked', 'true');
  });

  it('the control keeps the HOST id verbatim — the widget does not rename it', () => {
    renderForm(BOOLEAN_FIELD, false);

    const control = controlOf('notifications');
    const id = control.getAttribute('id') ?? '';
    // The host's id is a `useId()`-derived form-item id; the field name is what
    // the widget used to substitute for it.
    expect(id).not.toBe('');
    expect(id).not.toBe('notifications');
    expect(id).toMatch(/-form-item$/);
    // …and it is the id the visible label points at.
    const visible = screen.getByText('Email Notifications');
    expect(visible.getAttribute('for')).toBe(id);
  });

  it('two boolean fields in one form each get their own label', () => {
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          mode: 'create',
          showSubmit: false,
          showCancel: false,
          defaultValues: { notifications: false, digest: false },
          fields: [BOOLEAN_FIELD, { name: 'digest', label: 'Weekly Digest', type: 'boolean' }],
          onSubmit: () => {},
        }}
      />,
    );

    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
    // Each label reaches its OWN control (a shared/colliding id would make both
    // resolve to the first one). The `boolean` row draws a checkbox, the
    // `toggle` row a switch (objectstack#27519).
    fireEvent.click(screen.getByText('Weekly Digest'));
    expect(controlOf('digest')).toHaveAttribute('role', 'checkbox');
    expect(controlOf('digest')).toHaveAttribute('aria-checked', 'true');
    expect(controlOf('notifications')).toHaveAttribute('role', 'switch');
    expect(controlOf('notifications')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('a STANDALONE boolean widget keeps its own accessible name (objectui#3952)', () => {
  // `FieldEditWidget` (the grid's inline cell editor) renders these widgets with
  // no `id` and no label of its own, so removing the widget's `sr-only` label
  // unconditionally would leave the control unnamed. These pin the fallback.

  it('switch variant: the sr-only label names the control', () => {
    render(
      <BooleanField
        value={false}
        onChange={() => {}}
        field={{ name: 'notifications', label: 'Email Notifications', type: 'toggle' } as any}
      />,
    );

    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
    const labelled = screen.getAllByLabelText('Email Notifications');
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toHaveAttribute('role', 'switch');
  });

  it('checkbox variant: the sr-only label names the control', () => {
    render(
      <BooleanField
        value={false}
        onChange={() => {}}
        field={
          {
            name: 'agreed',
            label: 'I agree',
            type: 'boolean',
          } as any
        }
      />,
    );

    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
    const labelled = screen.getAllByLabelText('I agree');
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toHaveAttribute('role', 'checkbox');
  });
});

describe('a host that labels by field NAME keeps its association (objectui#3952)', () => {
  // `@object-ui/app-shell`'s `ActionParamDialog` boolean branch renders
  // `<Label htmlFor={param.name}>` and — unlike its own generic branch, which
  // passes `id={param.name}` — hands the widget NO id. It works only because
  // the fallback chain's second term derives the id from the field name
  // (`paramToField` sets `name: param.name`).
  //
  // So the chain is `hostId || config.name || useId()`, in that order, and the
  // middle term is NOT dead weight to be "cleaned up" into a bare `useId()`:
  // that would silently unlink every boolean action param in the console. This
  // pin is what makes that attempt fail loudly instead.
  it('falls back to the field name when no id was handed down', () => {
    render(
      <div>
        <BooleanField
          value={false}
          onChange={() => {}}
          field={{ name: 'confirmed', label: 'Confirmed', type: 'boolean' } as any}
        />
        <label htmlFor="confirmed">Send anyway</label>
      </div>,
    );

    const control = document.querySelector('[role="checkbox"]')!;
    expect(control).toHaveAttribute('id', 'confirmed');
    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
    // The host's OWN label reaches the control through that id.
    expect(screen.getAllByLabelText(/Send anyway/)).toHaveLength(1);
  });
});

describe('a host-supplied id wins for BOTH variants (objectui#3952)', () => {
  // Pinned at the prop boundary, exactly as `<FormControl>`'s Slot delivers
  // it: a `toggle` draws the switch variant and a `boolean` the checkbox
  // variant (objectstack#27519).
  it.each([
    ['switch', 'toggle', 'switch'],
    ['checkbox', 'boolean', 'checkbox'],
  ] as const)('%s variant uses the id the host handed it', (_name, type, role) => {
    render(
      <label htmlFor="host-item">
        Host Label
        <BooleanField
          value={false}
          onChange={() => {}}
          id="host-item"
          field={{ name: 'agreed', label: 'I agree', type } as any}
        />
      </label>,
    );

    const control = document.querySelector(`[role="${role}"]`)!;
    expect(control).toHaveAttribute('id', 'host-item');
    // And the widget adds no second label of its own.
    expect(screen.queryByText('I agree')).toBeNull();
    expect(document.querySelectorAll('label')).toHaveLength(1);
  });
});
