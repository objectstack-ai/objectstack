/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end: a group-labelled field's visible label names — and its visible
 * help text describes — the widget's surface in EVERY state it renders, not
 * only the editable one (objectui#3990, objectui#4005).
 *
 * The residual of objectui#3961 / #3975. Those two moved the association from an
 * inert `<label for>` to the WAI-ARIA group pattern (the label publishes its own
 * `id`, the widget answers with `aria-labelledby` + a role that can carry a
 * name), and pinned it in `composite-group-label-e2e.test.tsx` — entirely on
 * EDITABLE samples. Every one of these widgets also returns EARLY, before the
 * container that consumes that IDREF, for a field-level `readonly: true` and for
 * an option list that resolved to zero offered options. Measured on
 * `origin/main` with a real form + the same bare registration this file uses,
 * counting the elements that reference the host label's published id:
 *
 * ```
 *                              consumers  byLabelText  namedByRole
 * multiselect  readonly+value      0           0          []
 * multiselect  readonly+empty      0           0          []
 * multiselect  zeroOptions         0           0          []
 * multiselect  editable            1           1          [group:1]     ← #3975
 * ```
 *
 * All seven types measured identically, in every readonly state. Both `for`-less
 * halves of the association were dropped by those returns, so the visible label
 * was the accessible name of NOTHING — the same user-visible outcome #3961
 * fixed, in the states its probe never sampled. It is not a regression of either
 * PR: before #3961 the same states rendered a `for` pointing at an id no element
 * carried, which named nothing either. The shape changed; the defect did not.
 *
 * ## Why the role is `group` here even where the editable branch says otherwise
 *
 * `aria-labelledby` on a role-less `div` / `span` names nothing (`generic`
 * prohibits an author name), so the readonly surface needs a role that supports
 * naming, and `group` is the only one that does not lie about interactivity:
 *
 *  - `radio` answers `radiogroup` while editable, but its readonly branch renders
 *    the CHOSEN option's label as text — there is not one radio left in it;
 *  - `file` answers `button` while editable (the dropzone is its single control),
 *    but readonly there is no dropzone, only the file names.
 *
 * So the roles this file expects deliberately differ from `HOSTED` in the
 * editable e2e for exactly those two, and the last describe block pins that the
 * editable answers are untouched.
 *
 * ## The description was the other half of the same defect (objectui#4005)
 *
 * #3990 landed the NAME and deliberately stopped there, because at the time the
 * readonly surfaces had no role and an `aria-describedby` on a role-less
 * `div` / `span` is as inert as the `aria-labelledby` was. Giving them
 * `role="group"` retired that reason — a group is a description carrier under
 * ARIA 1.2 with no focusable control required — but the help text stayed
 * unconsumed. Measured on `origin/main` at `c25222758`, a real form, one field
 * per row, counting the elements whose `aria-describedby` names the rendered
 * `<FormDescription>`:
 *
 * ```
 *                                    descEl  consumers  consumerTags
 * address      editable   desc=YES   SET         1      [input]
 * address      readonly   desc=YES   SET         0      []
 * geolocation  editable   desc=YES   SET         1      [input]
 * geolocation  readonly   desc=YES   SET         0      []
 * checkboxes   editable   desc=YES   SET         1      [div[group]]
 * checkboxes   readonly   desc=YES   SET         0      []
 * radio        editable   desc=YES   SET         1      [div[radiogroup]]
 * radio        readonly   desc=YES   SET         0      []
 * rating       editable   desc=YES   SET         1      [div[group]]
 * rating       readonly   desc=YES   SET         0      []
 * file         editable   desc=YES   SET         1      [div[button]]
 * file         readonly   desc=YES   SET         0      []
 * multiselect  editable   desc=YES   SET         1      [div[group]]
 * multiselect  readonly   desc=YES   SET         0      []
 * ```
 *
 * All seven render the `<FormDescription>` in the readonly state — none is
 * exempt for want of one — and all seven left it referenced by nothing. The
 * `describes` block below is that table's 0 turning into 1; the boundary block
 * after it pins the OTHER direction, that gaining the description gained
 * nothing else (`aria-invalid` / `aria-required` are control-channel state and
 * a readonly display is not a control — objectui#3291 / objectui#3318).
 *
 * The built-in branch is measured, not assumed, and it has no defect of this
 * kind: `input` / `textarea` / `checkbox` / `switch` / `select` render a real
 * control inside `<FormControl>` in the readonly state too, so the Slot's
 * `aria-describedby` lands on it and the reading is `consumers=1` either way.
 * (The comparison row in #4005's issue body reads `consumers=0` for a builtin;
 * it was measured on `type: 'text'`, which is neither a `BUILTIN_FIELD_TYPES`
 * member nor registered in a bare-registration setup, so that field rendered no
 * control at all. The issue flagged the row as noise; this is the re-measure.)
 *
 * The widgets are registered raw rather than through `registerAllFields()`, whose
 * `React.lazy` loaders put an unbounded module load inside a bounded `findBy`
 * window — this repo's known flake generator (AGENTS.md 测试纪律, objectui#3010).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
import { SelectField } from '../widgets/SelectField';

const WIDGETS: Record<string, any> = {
  address: AddressField,
  geolocation: GeolocationField,
  checkboxes: CheckboxesField,
  radio: RadioField,
  rating: RatingField,
  file: FileField,
  multiselect: MultiSelectField,
};

/** The option widgets — the only ones with a zero-option state to measure. */
const OPTION_TYPES = ['checkboxes', 'radio', 'multiselect'] as const;

/**
 * Where the placeholder sits when a readonly field has no value. Three real
 * shapes, so the assertion is per-widget rather than one presumed form:
 *
 *  - `'is-placeholder'`: the whole surface IS `EmptyValue`, which therefore
 *    carries the group props itself;
 *  - `'contains-placeholder'`: `geolocation` keeps its icon row and renders the
 *    placeholder inside it, so the row is the named group;
 *  - `'no-placeholder'`: `rating` has no empty state at all — an unset rating
 *    renders the same "0 / max" star row.
 */
const EMPTY_SHAPE: Record<string, 'is-placeholder' | 'contains-placeholder' | 'no-placeholder'> = {
  address: 'is-placeholder',
  checkboxes: 'is-placeholder',
  radio: 'is-placeholder',
  file: 'is-placeholder',
  multiselect: 'is-placeholder',
  geolocation: 'contains-placeholder',
  rating: 'no-placeholder',
};

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

/** A stored value per type, so the readonly branch renders its filled shape. */
const VALUES: Record<string, unknown> = {
  address: { street: '1 Main St', city: 'Springfield' },
  geolocation: { latitude: 1.5, longitude: 2.5 },
  checkboxes: ['a'],
  radio: 'a',
  rating: 3,
  file: { id: 'f1', name: 'report.pdf' },
  multiselect: ['a'],
};

/** The role the EDITABLE branch answers with — unchanged by this issue. */
const EDITABLE_ROLE: Record<string, string> = {
  address: 'group',
  geolocation: 'group',
  checkboxes: 'group',
  radio: 'radiogroup',
  rating: 'group',
  file: 'button',
  multiselect: 'group',
};

const TYPES = Object.keys(WIDGETS);

beforeAll(() => {
  for (const [type, Component] of Object.entries(WIDGETS)) {
    ComponentRegistry.register(type, Component as any, {
      namespace: 'field',
      skipFallback: true,
      // The declaration under test, mirroring `FIELD_WIDGET_LABELLING`.
      labelling: 'group',
    });
  }
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

function labelTargets(): Array<{ forId: string; resolves: boolean; labelable: boolean }> {
  return Array.from(document.querySelectorAll('label'))
    .map((el) => {
      const forId = el.getAttribute('for') ?? '';
      const target = forId ? document.getElementById(forId) : null;
      return {
        forId,
        resolves: !!target,
        labelable: !!target && LABELABLE.has(target.tagName.toLowerCase()),
      };
    })
    .filter((l) => l.forId !== '');
}

function fieldConfig(
  type: string,
  opts: { readonly?: boolean; zeroOptions?: boolean; description?: string; required?: boolean } = {},
): Record<string, unknown> {
  const config: any = { name: `f_${type}`, label: `Group Label ${type}`, type };
  if ((OPTION_TYPES as readonly string[]).includes(type)) {
    config.options = opts.zeroOptions ? [] : OPTIONS;
  }
  // Field-level readonly — the state this issue is about. NOT the form-level
  // `mode: 'view'`, which renders a different (detail) path and was already
  // naming its group correctly.
  if (opts.readonly) config.readonly = true;
  if (opts.description) config.description = opts.description;
  if (opts.required) config.required = true;
  return config;
}

/** The real form renderer hosting one field — the #3990 reproduction. */
function renderForm(
  fields: any[],
  defaultValues: Record<string, unknown> = {},
  opts: { showSubmit?: boolean } = {},
) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: !!opts.showSubmit,
        submitLabel: 'Create',
        showCancel: false,
        defaultValues,
        fields,
      }}
    />,
  );
}

/** The `<FormDescription>` the host renders for `description`, or null. */
const descriptionEl = (): HTMLElement | null =>
  document.querySelector('[id$="-form-item-description"]');

/**
 * Every element whose `aria-describedby` NAMES `id` — the measurement #4005 is
 * about, read from the DOM rather than through a query helper.
 *
 * Deliberately not `getAllByLabelText` / `toHaveAccessibleDescription` alone:
 * this has to count CONSUMERS, and the failure being pinned is a count of zero
 * against a description element that renders perfectly well. An accessible-name
 * query would answer "no match" for both "nobody references it" and "the
 * reference resolves to nothing", and the token list matters too — after a
 * failed validation the same attribute carries the message id as well.
 */
function describedbyConsumers(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-describedby]')).filter((el) =>
    (el.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(id),
  );
}

const hostLabelOf = (name: string): HTMLLabelElement => {
  const el = document.querySelector(`[data-field="${name}"] > label`);
  if (!el) throw new Error(`no host label rendered for field "${name}"`);
  return el as HTMLLabelElement;
};

describe('a READONLY group-labelled field is named by its host label (objectui#3990)', () => {
  it.each(TYPES)('%s: the host label names the readonly surface', (type) => {
    renderForm([fieldConfig(type, { readonly: true })], { [`f_${type}`]: VALUES[type] });

    // 0 before this fix, 1 after — for all seven, whatever their readonly shape.
    const named = screen.getAllByRole('group', { name: `Group Label ${type}` });
    expect(named).toHaveLength(1);
    // The same association read from the other side.
    expect(screen.getAllByLabelText(`Group Label ${type}`)).toEqual(named);
  });

  it.each(TYPES)('%s: the readonly surface is the element the host handed its id to', (type) => {
    // The name and the host id must land on the SAME element, as in the editable
    // path: the readonly branches dropped BOTH, so the `…-form-item` id existed
    // on no element in the document.
    renderForm([fieldConfig(type, { readonly: true })], { [`f_${type}`]: VALUES[type] });

    const named = screen.getByRole('group', { name: `Group Label ${type}` });
    expect(named.getAttribute('id')).toMatch(/-form-item$/);
  });

  it.each(TYPES)('%s: readonly with NO value names the placeholder surface', (type) => {
    renderForm([fieldConfig(type, { readonly: true })]);

    const named = screen.getByRole('group', { name: `Group Label ${type}` });
    const shape = EMPTY_SHAPE[type];
    if (shape === 'is-placeholder') {
      // `EmptyValue` itself is the field's whole surface here. Its own
      // `aria-label` ("No value") stays in the markup and is outranked by
      // `aria-labelledby` per accname — on the `generic` role it carried before
      // this change, that author name was not exposed at all.
      expect(named).toHaveAttribute('data-slot', 'empty-value');
      expect(named).toHaveAccessibleName(`Group Label ${type}`);
    } else if (shape === 'contains-placeholder') {
      expect(named.querySelector('[data-slot="empty-value"]')).not.toBeNull();
    } else {
      // `rating` has no empty state: an unset rating is the same star row.
      expect(named.querySelector('[data-slot="empty-value"]')).toBeNull();
      expect(named.textContent).toContain('0 / 5');
    }
  });

  it.each(TYPES)('%s: the host label still emits an id and no `for` when readonly', (type) => {
    renderForm([fieldConfig(type, { readonly: true })], { [`f_${type}`]: VALUES[type] });

    const label = hostLabelOf(`f_${type}`);
    expect(label).not.toHaveAttribute('for');
    expect(label.id).not.toBe('');
    // A dangling IDREF fails silently, which reads exactly like success.
    expect(document.getElementById(label.id)).toBe(label);
    // And no OTHER label in the field is left with an inert/dangling `for`.
    expect(labelTargets().filter((l) => !l.resolves || !l.labelable)).toEqual([]);
  });

  it.each(TYPES)('%s: the readonly surface takes the three whole-field keys ONLY', (type) => {
    // The narrow set is deliberate (`toHostGroupProps`): the field's NAME, its
    // DESCRIPTION, and the `role` that lets a non-control surface carry either.
    // Nothing else. `name` is the one that would be a DOM leak of the
    // objectui#3291 class — it is legal on form controls only, and these
    // surfaces are `div` / `span`.
    //
    // Both halves are asserted here so neither can pass vacuously: an
    // implementation that emits nothing at all would satisfy the three
    // `not.toHaveAttribute`s on their own.
    renderForm([fieldConfig(type, { readonly: true, description: 'Some help' })], {
      [`f_${type}`]: VALUES[type],
    });

    const named = screen.getByRole('group', { name: `Group Label ${type}` });
    expect(named).toHaveAttribute('id');
    expect(named).toHaveAttribute('aria-labelledby');
    expect(named).toHaveAttribute('aria-describedby');
    expect(named).not.toHaveAttribute('name');
    expect(named).not.toHaveAttribute('aria-invalid');
    expect(named).not.toHaveAttribute('aria-required');
  });

  it('all seven readonly in ONE form: each is named exactly once', () => {
    const fields = TYPES.map((type) => fieldConfig(type, { readonly: true }));
    const values = Object.fromEntries(TYPES.map((type) => [`f_${type}`, VALUES[type]]));
    renderForm(fields, values);

    for (const type of TYPES) {
      expect(screen.getAllByRole('group', { name: `Group Label ${type}` })).toHaveLength(1);
    }
    expect(labelTargets().filter((l) => !l.resolves || !l.labelable)).toEqual([]);
  });
});

describe('a READONLY group-labelled field is DESCRIBED by its host help text (objectui#4005)', () => {
  it.each(TYPES)('%s: the description has exactly one consumer, and it is the named group', (type) => {
    renderForm([fieldConfig(type, { readonly: true, description: 'Some help' })], {
      [`f_${type}`]: VALUES[type],
    });

    // The `<FormDescription>` renders in the readonly state for all seven —
    // that was never the defect, and a widget whose readonly shape omitted it
    // would have to be exempted here rather than silently pass.
    const desc = descriptionEl();
    expect(desc).not.toBeNull();
    expect(desc).toHaveTextContent('Some help');

    // 0 before this fix, 1 after — the whole issue, in one number.
    const consumers = describedbyConsumers(desc!.id);
    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toBe(screen.getByRole('group', { name: `Group Label ${type}` }));
    // The same association read the way assistive tech resolves it.
    expect(consumers[0]).toHaveAccessibleDescription('Some help');
  });

  it.each(TYPES)('%s: the description lands on the SAME element as the name', (type) => {
    // Name and description must not drift onto two different elements: the one
    // the host handed its id to is the field's surface, and both belong to it.
    renderForm([fieldConfig(type, { readonly: true, description: 'Some help' })], {
      [`f_${type}`]: VALUES[type],
    });

    const named = screen.getByRole('group', { name: `Group Label ${type}` });
    expect(named.getAttribute('id')).toMatch(/-form-item$/);
    expect(named.getAttribute('aria-describedby')).toBe(descriptionEl()!.id);
  });

  it.each(TYPES)('%s: readonly with NO value describes the placeholder surface too', (type) => {
    // `EmptyValue` is the same surface with nothing in it. Its own
    // `aria-label` ("No value") is the NAME channel and is outranked by
    // `aria-labelledby`; the description is a separate channel and must arrive
    // on it just the same.
    renderForm([fieldConfig(type, { readonly: true, description: 'Some help' })]);

    const consumers = describedbyConsumers(descriptionEl()!.id);
    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toBe(screen.getByRole('group', { name: `Group Label ${type}` }));
  });

  it('all seven readonly in ONE form: each description has exactly one consumer', () => {
    const fields = TYPES.map((type) => fieldConfig(type, { readonly: true, description: 'Some help' }));
    const values = Object.fromEntries(TYPES.map((type) => [`f_${type}`, VALUES[type]]));
    renderForm(fields, values);

    const descriptions = Array.from(
      document.querySelectorAll<HTMLElement>('[id$="-form-item-description"]'),
    );
    expect(descriptions).toHaveLength(TYPES.length);
    // Per description, not in aggregate: one field consuming another's id would
    // keep a total count right while both associations are wrong.
    for (const desc of descriptions) {
      expect(describedbyConsumers(desc.id)).toHaveLength(1);
    }
  });
});

describe('the readonly surface gains the description and NOTHING else (objectui#3291 / #3318)', () => {
  // The boundary, pinned from both sides. `aria-invalid` / `aria-required` are
  // CONTROL-channel state: they report what a user's editing may do wrong, to
  // the element they would edit. A readonly display cannot be edited, so
  // neither may appear on it — in any circumstance, including the two that
  // would produce them on an editable control.

  it.each(TYPES)('%s: a REQUIRED readonly field is described, never aria-required', (type) => {
    renderForm([fieldConfig(type, { readonly: true, required: true, description: 'Some help' })], {
      [`f_${type}`]: VALUES[type],
    });

    const named = screen.getByRole('group', { name: `Group Label ${type}` });
    expect(named).toHaveAttribute('aria-describedby', descriptionEl()!.id);
    expect(named).not.toHaveAttribute('aria-required');
    expect(named).not.toHaveAttribute('aria-invalid');
  });

  it.each(TYPES)('%s: a FAILED validation still puts no aria-invalid on it', async (type) => {
    // Measured as reachable, not presumed: a readonly `required` field with no
    // value really is validated on submit and really does render its
    // `<FormMessage>`, so this is the live invalid state rather than a
    // hypothetical one.
    renderForm([fieldConfig(type, { readonly: true, required: true, description: 'Some help' })], {}, {
      showSubmit: true,
    });

    expect(screen.getByRole('group', { name: `Group Label ${type}` })).not.toHaveAttribute(
      'aria-invalid',
    );

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    const message = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[id$="-form-item-message"]');
      if (!el) throw new Error('no validation message rendered');
      return el;
    });

    // Re-queried after the re-render rather than reusing the pre-submit
    // reference, so the assertion cannot read a detached node's stale attributes.
    const named = screen.getByRole('group', { name: `Group Label ${type}` });
    // `<FormControl>`'s Slot widens `aria-describedby` to "description message"
    // once there is an error, and the readonly surface forwards that verbatim —
    // the same value the editable control would carry. What it must NOT gain is
    // the state channel.
    expect(named.getAttribute('aria-describedby')?.split(/\s+/)).toEqual([
      descriptionEl()!.id,
      message.id,
    ]);
    expect(named).not.toHaveAttribute('aria-invalid');
    expect(named).not.toHaveAttribute('aria-required');
  });

  it.each(TYPES)('%s: a readonly field with NO description answers as the editable one does', (type) => {
    // Honest pin, not an aspiration: `<FormControl>`'s Slot emits the
    // description IDREF unconditionally, so a field without a `description`
    // hands EVERY control — builtin, single-control widget, and now this
    // readonly surface — a reference to an element that never rendered.
    // Measured on `origin/main` at `c25222758`, `desc=NO`: all seven
    // group-labelled widgets plus builtin `input` and `email` already carried
    // exactly one such reference on their editable control. The readonly
    // surface answering the same way is parity; it is NOT this issue's defect
    // (an unresolvable IDREF is inert for assistive tech, while an unconsumed
    // description is simply lost), and pinning it here is what would make a
    // later change to that unconditional emission visible.
    renderForm([fieldConfig(type, { readonly: true })], { [`f_${type}`]: VALUES[type] });

    expect(descriptionEl()).toBeNull();
    const named = screen.getByRole('group', { name: `Group Label ${type}` });
    const describedby = named.getAttribute('aria-describedby');
    expect(describedby).toMatch(/-form-item-description$/);
    expect(document.getElementById(describedby!)).toBeNull();
    // Which is the point: an IDREF resolving to nothing contributes no
    // accessible description, so the surface announces exactly what it did
    // before this change.
    expect(named).not.toHaveAccessibleDescription();
  });
});

describe('a ZERO-OPTION group-labelled field is named by its host label (objectui#3990)', () => {
  it.each(OPTION_TYPES)('%s: the unfillable-options box is the named group', (type) => {
    renderForm([fieldConfig(type, { zeroOptions: true })]);

    const named = screen.getAllByRole('group', { name: `Group Label ${type}` });
    expect(named).toHaveLength(1);
    // The named element is the shared `OptionsEmptyState` box, not some ancestor:
    // in this state it is the only thing the widget renders.
    expect(named[0]).toBe(screen.getByTestId(`${type}-empty-f_${type}`));
    expect(named[0].getAttribute('id')).toMatch(/-form-item$/);
    expect(screen.getAllByLabelText(`Group Label ${type}`)).toEqual(named);
  });

  it.each(OPTION_TYPES)('%s: the unfillable-options box is also DESCRIBED (objectui#4005)', (type) => {
    // Same surface, same reasoning: this box is everything the field renders in
    // this state, so there is no option control anywhere for the help text to
    // be announced on. It asks `toHostGroupProps` for the same
    // `'instead-of-the-inputs'` answer the readonly branches do.
    renderForm([fieldConfig(type, { zeroOptions: true, description: 'Some help' })]);

    const box = screen.getByTestId(`${type}-empty-f_${type}`);
    const consumers = describedbyConsumers(descriptionEl()!.id);
    expect(consumers).toEqual([box]);
    expect(box).toHaveAccessibleDescription('Some help');
    // The boundary holds here too.
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).not.toHaveAttribute('aria-required');
    expect(box).not.toHaveAttribute('name');
  });

  it.each(OPTION_TYPES)('%s: readonly wins over zero options, and is still named', (type) => {
    // Both early returns at once. The readonly branch comes first, so the
    // measured surface is the readonly one — and it must still be named.
    renderForm([fieldConfig(type, { readonly: true, zeroOptions: true })], {
      [`f_${type}`]: VALUES[type],
    });

    expect(screen.getAllByRole('group', { name: `Group Label ${type}` })).toHaveLength(1);
    expect(screen.queryByTestId(`${type}-empty-f_${type}`)).toBeNull();
  });
});

describe('the editable answers are untouched (objectui#3961 / #3975 regression)', () => {
  it.each(TYPES)('%s: editable keeps its own role, readonly answers `group`', (type) => {
    // The drift pin: one widget, two surfaces, both named. `radio` and `file`
    // deliberately answer with DIFFERENT roles in the two states, so a future
    // "unify the roles" edit has to come here and say which it broke.
    renderForm([fieldConfig(type)], { [`f_${type}`]: VALUES[type] });
    expect(
      screen.getAllByRole(EDITABLE_ROLE[type], { name: `Group Label ${type}` }),
    ).toHaveLength(1);
    cleanup();

    renderForm([fieldConfig(type, { readonly: true })], { [`f_${type}`]: VALUES[type] });
    expect(screen.getAllByRole('group', { name: `Group Label ${type}` })).toHaveLength(1);
  });

  it.each(TYPES)('%s: editable still has exactly ONE description consumer', (type) => {
    // The regression #4005 could most easily have caused. `address` and
    // `geolocation` spread the SAME helper's result on their editable
    // container, so a `toHostGroupProps` that always emitted
    // `aria-describedby` would have described the container as well as the
    // sub-input inside it — the help text announced twice, which is the double
    // channel objectui#3290 removed from the required marker and objectui#3318
    // refused for this one. The `'above-the-inputs'` argument at those two call
    // sites is the only thing preventing it.
    renderForm([fieldConfig(type, { description: 'Some help' })], { [`f_${type}`]: VALUES[type] });

    expect(describedbyConsumers(descriptionEl()!.id)).toHaveLength(1);
  });

  it.each(['address', 'geolocation'])(
    '%s: the editable CONTAINER stays undescribed, the sub-input keeps it',
    (type) => {
      renderForm([fieldConfig(type, { description: 'Some help' })], { [`f_${type}`]: VALUES[type] });

      const container = screen.getByRole('group', { name: `Group Label ${type}` });
      expect(container).not.toHaveAttribute('aria-describedby');
      const [consumer] = describedbyConsumers(descriptionEl()!.id);
      expect(consumer.tagName.toLowerCase()).toBe('input');
      expect(container.contains(consumer)).toBe(true);
    },
  );
});

describe('STANDALONE readonly widgets are unchanged (objectui#3990)', () => {
  // `FieldEditWidget` (the grid's inline cell editor) and bare SDUI nodes hand
  // down no id and no host label, so there is nothing to associate and nothing
  // may be emitted: an unnamed `role="group"` announces a container with no name
  // to give, and an id nobody asked for can collide with the page's own.

  it.each(TYPES)('%s: no role, no IDREF, no id', (type) => {
    const Widget = WIDGETS[type];
    render(
      <Widget
        value={VALUES[type]}
        onChange={() => {}}
        readonly
        field={{
          name: type,
          label: `Group Label ${type}`,
          type,
          ...((OPTION_TYPES as readonly string[]).includes(type) ? { options: OPTIONS } : null),
        }}
      />,
    );

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(document.querySelector('[aria-labelledby]')).toBeNull();
    expect(document.querySelector('[id]')).toBeNull();
  });

  it.each(TYPES)('%s: no description channel either (objectui#4005)', (type) => {
    const Widget = WIDGETS[type];
    render(
      <Widget
        value={VALUES[type]}
        onChange={() => {}}
        readonly
        field={{
          name: type,
          label: `Group Label ${type}`,
          type,
          ...((OPTION_TYPES as readonly string[]).includes(type) ? { options: OPTIONS } : null),
        }}
      />,
    );

    // No host, so no IDREF was handed down and none may be invented: the third
    // key is `undefined` exactly like the first two, React emits no attribute,
    // and this markup stays byte-identical to what it was.
    expect(document.querySelector('[aria-describedby]')).toBeNull();
  });

  it.each(TYPES)('%s: no value, still nothing emitted', (type) => {
    const Widget = WIDGETS[type];
    render(
      <Widget
        value={undefined}
        onChange={() => {}}
        readonly
        field={{
          name: type,
          label: `Group Label ${type}`,
          type,
          ...((OPTION_TYPES as readonly string[]).includes(type) ? { options: OPTIONS } : null),
        }}
      />,
    );

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(document.querySelector('[aria-labelledby]')).toBeNull();
    // The placeholder keeps its own name and gains no role it was not given.
    const placeholder = document.querySelector('[data-slot="empty-value"]');
    if (placeholder) expect(placeholder).not.toHaveAttribute('role');
  });

  it('the shared options-empty box emits nothing for a widget that is not group-labelled', () => {
    // The positive control for `OptionsEmptyState`'s group prop. The single
    // `SelectField` is the one option widget `FIELD_WIDGET_LABELLING` declares
    // `'control'` rather than `'group'` — its label keeps a plain `for`, which
    // objectui#8803 made resolve by rendering the box as a labelable
    // `<output>`. Either way the GROUP channel must stay off it, and standalone
    // rendering hands down no host keys at all: no `role`, no IDREF, no host
    // id, no description.
    render(
      <SelectField
        value={undefined}
        onChange={() => {}}
        field={{ name: 'stage', label: 'Stage', type: 'select', options: [] } as any}
      />,
    );

    const box = screen.getByTestId('select-empty-stage');
    expect(box).not.toHaveAttribute('role');
    expect(box).not.toHaveAttribute('aria-labelledby');
    expect(box).not.toHaveAttribute('id');
    expect(box).not.toHaveAttribute('aria-describedby');
  });
});
