/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end: a composite / grouped field's VISIBLE label is the accessible name
 * of the thing the widget renders (objectui#3961).
 *
 * The sibling case of #3952 (`BooleanField`, a single control that renamed the
 * host's id). Here the widget has no single labelable control to hand the label
 * to, and the failure came in two shapes — measured in a real form on
 * `origin/main`, one field per row, reading each `<label for>` against the DOM:
 *
 * ```
 * address      for=_r_0_-form-item -> MISSING          byLabelText=0   role+name=0
 * geolocation  for=_r_2_-form-item -> MISSING          byLabelText=0   role+name=0
 * checkboxes   for=_r_4_-form-item -> div              byLabelText=0   role+name=0
 * radio        for=_r_6_-form-item -> div[radiogroup]   byLabelText=0   role+name=0
 * rating       for=_r_a_-form-item -> div              byLabelText=0   role+name=0
 * file         for=_r_b_-form-item -> div[role=button] byLabelText=0   role+name=0
 * ```
 *
 *  - **id overwritten** (`address` / `geolocation`): the host id was spread onto
 *    the first sub-input and then replaced by that input's own `subId(...)`
 *    (objectui#3343 — correctly, sub-inputs need unique ids), so the `for` named
 *    an id NOTHING carried. Clicking "Shipping Address" did nothing and the group
 *    label was absent from the accessibility tree entirely.
 *  - **id kept, on a `div`** (`checkboxes` / `radio` / `rating` / `file`): the
 *    `for` "resolved", but `<label for>` on a non-labelable element is inert —
 *    `HTMLLabelElement.control` is `null`, so it activates nothing and
 *    contributes no name. Both columns on the right show it: zero elements named
 *    by that label, in either query.
 *
 * So all six ended in the same place — a visible label that names NOTHING — and
 * the fix is the WAI-ARIA group pattern: the widget declares that it must be
 * named by IDREF (`ComponentMeta.labelling: 'group'`), the form renderer
 * publishes its label's `id` and drops the `for`, and the widget's group
 * container answers with `role="group"` + the handed-down `aria-labelledby`.
 *
 * Two directions per widget, because a one-directional pin here is nearly free to
 * pass by accident: the name must be present when hosted, and STANDALONE
 * rendering (the inline grid editor, a bare SDUI node — nobody hands an id, and
 * there is no host label to point at) must stay exactly as it was.
 *
 * The widgets are registered raw rather than through `registerAllFields()`, which
 * wraps every loader in `React.lazy`: an unbounded module load inside a bounded
 * `findBy`/`waitFor` window is the repo's known flake generator (AGENTS.md
 * 测试纪律, objectui#3010). Same components, no Suspense boundary. The
 * DECLARATION that ships with the real registration is pinned separately, in
 * `group-labelling-declaration.test.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { AddressField } from '../widgets/AddressField';
import { GeolocationField } from '../widgets/GeolocationField';
import { CheckboxesField } from '../widgets/CheckboxesField';
import { RadioField } from '../widgets/RadioField';
import { RatingField } from '../widgets/RatingField';
import { FileField } from '../widgets/FileField';
import { MultiSelectField } from '../widgets/MultiSelectField';
import { TextField } from '../widgets/TextField';

/**
 * The role each widget's named surface answers with. Not uniform, and
 * deliberately so:
 *
 *  - `radio` keeps `radiogroup` — already a member of the group role family, more
 *    specific than `group`, and the correct carrier of `aria-invalid` for a set
 *    of radios (#3318). Overriding it with `group` would be a regression.
 *  - `file` is `button`: it is NOT a composite — it has exactly one control, the
 *    dropzone, which is a `div[role="button"]` (the keyboard path to the hidden
 *    file input). It needs IDREF labelling because a `div` cannot be
 *    `for`-labelled, not because it is a group, so no `role="group"` wrapper is
 *    invented for it.
 *  - `multiselect` is `group`, and arrived with objectui#3975 rather than #3961:
 *    #3961's probe covered the six above, and re-running it over the whole widget
 *    map afterwards put `multiselect` on the byte-identical `checkboxes` shape —
 *    host id kept, on the chip row's wrapper `div`, `for` inert. Measured on the
 *    tree that already had #3961's fix, i.e. this is its residual, not a
 *    regression of it:
 *
 *    ```
 *    checkboxes   for=(none) ownId=…-group-label  byLabelText=1(div[role=group])  ← #3961
 *    multiselect  for=…-form-item ownId=(none)    byLabelText=0                   ← #3975
 *    ```
 */
const HOSTED: Array<[type: string, role: string]> = [
  ['address', 'group'],
  ['geolocation', 'group'],
  ['checkboxes', 'group'],
  ['radio', 'radiogroup'],
  ['rating', 'group'],
  ['file', 'button'],
  ['multiselect', 'group'],
];

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

const WIDGETS: Record<string, any> = {
  address: AddressField,
  geolocation: GeolocationField,
  checkboxes: CheckboxesField,
  radio: RadioField,
  rating: RatingField,
  file: FileField,
  multiselect: MultiSelectField,
};

beforeAll(() => {
  for (const [type, Component] of Object.entries(WIDGETS)) {
    ComponentRegistry.register(type, Component as any, {
      namespace: 'field',
      skipFallback: true,
      // The declaration under test, mirroring `FIELD_WIDGET_LABELLING`.
      labelling: 'group',
    });
  }
  // Positive control: an ordinary single-control widget, undeclared.
  ComponentRegistry.register('text', TextField as any, { namespace: 'field', skipFallback: true });
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

/** HTML's labelable elements — the only ones a `<label for>` can address. */
const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

/**
 * Every `<label for=…>` in the document, with what it resolves to and whether
 * that target can legally be labelled. Both failure shapes of this issue appear
 * here: `resolves: false` is the overwritten-id case, `labelable: false` the
 * inert-`div` case.
 */
function labelTargets(): Array<{ text: string; forId: string; resolves: boolean; labelable: boolean }> {
  return Array.from(document.querySelectorAll('label'))
    .map((el) => {
      const forId = el.getAttribute('for') ?? '';
      const target = forId ? document.getElementById(forId) : null;
      return {
        text: (el.textContent ?? '').trim(),
        forId,
        resolves: !!target,
        labelable: !!target && LABELABLE.has(target.tagName.toLowerCase()),
      };
    })
    .filter((l) => l.forId !== '');
}

function fieldConfig(type: string) {
  const config: any = { name: `f_${type}`, label: `Group Label ${type}`, type };
  if (type === 'checkboxes' || type === 'radio' || type === 'multiselect') config.options = OPTIONS;
  return config;
}

/** The real form renderer hosting one field — the #3961 reproduction. */
function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        defaultValues: {},
        fields,
      }}
    />,
  );
}

const hostLabelOf = (name: string): HTMLLabelElement => {
  const el = document.querySelector(`[data-field="${name}"] > label`);
  if (!el) throw new Error(`no host label rendered for field "${name}"`);
  return el as HTMLLabelElement;
};

describe('a form-hosted composite field is NAMED by its host label (objectui#3961)', () => {
  it.each(HOSTED)('%s: the host label is the accessible name of the %s', (type, role) => {
    renderForm([fieldConfig(type)]);

    // The assertion that was 0 before this fix and is 1 after, for all six.
    const named = screen.getAllByRole(role, { name: `Group Label ${type}` });
    expect(named).toHaveLength(1);
    // `getByLabelText` resolves the same association from the other side.
    expect(screen.getAllByLabelText(`Group Label ${type}`)).toEqual(named);
  });

  it.each(HOSTED)('%s: the named element is the one the host handed its id to', (type, role) => {
    // The host id and the host name must land on the SAME element. They came
    // apart in both directions before: `address` dropped the id (overwritten by a
    // sub-input's), `checkboxes` kept it on a container the label could not name.
    renderForm([fieldConfig(type)]);

    const named = screen.getByRole(role, { name: `Group Label ${type}` });
    expect(named.getAttribute('id')).toMatch(/-form-item$/);
  });

  it.each(HOSTED)('%s: the host label emits an id and no `for`', (type) => {
    renderForm([fieldConfig(type)]);

    const label = hostLabelOf(`f_${type}`);
    expect(label).not.toHaveAttribute('for');
    expect(label.id).not.toBe('');
    // The IDREF is not dangling — `aria-labelledby` naming a missing id fails
    // silently, which is indistinguishable from success in the markup.
    expect(document.getElementById(label.id)).toBe(label);
  });

  it.each(HOSTED)('%s: no label in the field is left with an inert or dangling `for`', (type) => {
    // The class-wide invariant this issue is an instance of, and the one that can
    // only be stated once the group labels stop emitting `for` at all: EVERY
    // remaining `for` (the widgets' own sub-labels) must resolve to a real
    // labelable control.
    renderForm([fieldConfig(type)]);

    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
    expect(labelTargets().filter((l) => !l.labelable)).toEqual([]);
  });

  it('all of them in ONE form: every group is named, every `for` still resolves', () => {
    renderForm(HOSTED.map(([type]) => fieldConfig(type)));

    for (const [type, role] of HOSTED) {
      expect(screen.getAllByRole(role, { name: `Group Label ${type}` })).toHaveLength(1);
    }
    expect(labelTargets().filter((l) => !l.resolves || !l.labelable)).toEqual([]);
  });
});

describe('the group name does not swallow the sub-controls\' own names (objectui#3961)', () => {
  it('address sub-inputs keep their own labels', () => {
    // Why `aria-labelledby` is held back from the first sub-input rather than
    // riding along with the rest of the DOM pass-through: `aria-labelledby`
    // OVERRIDES a control's `<label for>`. Spread onto the street box, the group
    // name would REPLACE "Street Address" — the "one input, two labels,
    // concatenated name" outcome the issue rejected option 2 for.
    renderForm([fieldConfig('address')]);

    expect(screen.getByLabelText('Street Address')).toHaveAccessibleName('Street Address');
    expect(screen.getByLabelText('City')).toHaveAccessibleName('City');
    expect(screen.getByLabelText('Street Address')).not.toHaveAttribute('aria-labelledby');
  });

  it('the description stays on the first focusable sub-input, not on the container', () => {
    // #3318's deliberate choice, preserved: only the `id` moved out to the
    // container. A description or error must be announced when focus lands on
    // something focusable, and a group container is not focusable — so
    // `aria-describedby` stays where a screen reader will actually reach it.
    renderForm([{ ...fieldConfig('address'), description: 'Where we ship it' }]);

    const street = screen.getByLabelText('Street Address');
    expect(street.getAttribute('aria-describedby')).toContain('-form-item-description');
    const group = screen.getByRole('group', { name: 'Group Label address' });
    expect(group).not.toHaveAttribute('aria-describedby');
  });

  it('checkboxes options keep their per-option labels', () => {
    renderForm([fieldConfig('checkboxes')]);

    expect(screen.getByLabelText('Alpha')).toHaveAttribute('role', 'checkbox');
    expect(screen.getByLabelText('Beta')).toHaveAttribute('role', 'checkbox');
  });

  it('multiselect chips keep their own names (objectui#3975)', () => {
    // The chips name themselves from their text CONTENT, not from a sub-label,
    // so the group's `aria-labelledby` sits one level up and must not reach them.
    // `aria-labelledby` on a chip would REPLACE "Alpha" with the group name —
    // the same override this file refuses for `address`'s street box.
    renderForm([fieldConfig('multiselect')]);

    const alpha = screen.getByRole('button', { name: 'Alpha' });
    expect(alpha).toHaveAccessibleName('Alpha');
    expect(alpha).not.toHaveAttribute('aria-labelledby');
    expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy();
    // The group is the CONTAINER, not one of the chips.
    expect(screen.getByRole('group', { name: 'Group Label multiselect' })).toBe(alpha.parentElement);
  });
});

describe('an undeclared single-control field keeps the plain `for` association (objectui#3961)', () => {
  it('text: the label still points at the input, with no second naming channel', () => {
    // The positive control for the DECLARATION. `text` is not in
    // `FIELD_WIDGET_LABELLING`, so it must travel the unchanged path: a
    // working `for`, and NO `aria-labelledby` — two channels naming one control
    // is what #3290 / #3222 / #3952 each refused.
    renderForm([{ name: 'f_text', label: 'Plain Text', type: 'text' }]);

    const input = screen.getByLabelText('Plain Text');
    expect(input.tagName.toLowerCase()).toBe('input');
    expect(input).not.toHaveAttribute('aria-labelledby');
    const label = hostLabelOf('f_text');
    expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
    expect(label.id).toBe('');
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });

  it('a group field and a control field in one form each get their own treatment', () => {
    renderForm([{ name: 'f_text', label: 'Plain Text', type: 'text' }, fieldConfig('rating')]);

    expect(hostLabelOf('f_text')).toHaveAttribute('for');
    expect(hostLabelOf('f_rating')).not.toHaveAttribute('for');
    expect(screen.getByRole('group', { name: 'Group Label rating' })).toBeTruthy();
    expect(screen.getByLabelText('Plain Text').tagName.toLowerCase()).toBe('input');
  });
});

describe('STANDALONE composite widgets are unchanged (objectui#3961)', () => {
  // `FieldEditWidget` (the grid's inline cell editor) and bare SDUI nodes render
  // these widgets with no id and no host label. There is nothing to associate, so
  // nothing may be emitted: an unnamed `role="group"` adds no information and
  // announces a container that has no name to give.

  it('address: no group role, and every sub-label still resolves to its input', () => {
    render(
      <AddressField
        value={{ street: '1 Main St' }}
        onChange={() => {}}
        field={{ name: 'shipping', label: 'Shipping Address', type: 'address' } as any}
      />,
    );

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(document.querySelector('[aria-labelledby]')).toBeNull();
    expect(labelTargets().filter((l) => !l.resolves || !l.labelable)).toEqual([]);
    // The sub-input ids of objectui#3343 are untouched: only the (absent) HOST id
    // changed place.
    expect(screen.getByLabelText('Street Address')).toHaveValue('1 Main St');
  });

  it('geolocation: no group role, sub-labels intact', () => {
    render(
      <GeolocationField
        value={{ latitude: 1, longitude: 2 }}
        onChange={() => {}}
        field={{ name: 'where', label: 'Where', type: 'geolocation' } as any}
      />,
    );

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(document.querySelector('[aria-labelledby]')).toBeNull();
    expect(labelTargets().filter((l) => !l.resolves || !l.labelable)).toEqual([]);
    expect(screen.getByLabelText('Latitude')).toHaveValue(1);
  });

  it('checkboxes: the container stays a plain div', () => {
    render(
      <CheckboxesField
        value={[]}
        onChange={() => {}}
        field={{ name: 'tags', label: 'Tags', type: 'checkboxes', options: OPTIONS } as any}
      />,
    );

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.getByTestId('checkboxes-tags')).not.toHaveAttribute('role');
  });

  it('multiselect: the chip row stays a plain div (objectui#3975)', () => {
    render(
      <MultiSelectField
        value={[]}
        onChange={() => {}}
        field={{ name: 'tags', label: 'Tags', type: 'multiselect', options: OPTIONS } as any}
      />,
    );

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.getByTestId('multiselect-tags')).not.toHaveAttribute('role');
    // The chips are still reachable by their own names with no group around them.
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy();
  });

  it('rating: the container stays a plain div', () => {
    const { container } = render(
      <RatingField
        value={3}
        onChange={() => {}}
        field={{ name: 'score', label: 'Score', type: 'rating' } as any}
      />,
    );

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(container.firstElementChild).not.toHaveAttribute('role');
  });

  it('radio: the radiogroup survives without a name', () => {
    render(
      <RadioField
        value={undefined as any}
        onChange={() => {}}
        field={{ name: 'plan', label: 'Plan', type: 'radio', options: OPTIONS } as any}
      />,
    );

    // Radix owns this role; nothing in this change may take it away.
    const group = screen.getByRole('radiogroup');
    expect(group).not.toHaveAttribute('aria-labelledby');
    expect(labelTargets().filter((l) => !l.resolves || !l.labelable)).toEqual([]);
  });

  it('file: the dropzone keeps role=button and gains no name it was not given', () => {
    render(
      <FileField
        value={null}
        onChange={() => {}}
        field={{ name: 'attachment', label: 'Attachment', type: 'file' } as any}
      />,
    );

    const dropzone = screen.getByRole('button');
    expect(dropzone).not.toHaveAttribute('aria-labelledby');
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });
});
