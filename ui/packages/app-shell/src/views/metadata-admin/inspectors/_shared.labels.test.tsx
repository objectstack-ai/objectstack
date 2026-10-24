// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3994 / #3997 — the inspector field atoms that render a `<Label>` as a
 * SIBLING of their control must close the association (`htmlFor` ⇄ `id`).
 *
 * Before this fix `InspectorTextField` / `InspectorNumberField` /
 * `InspectorSelectField` each rendered "a label, then a control" with no
 * `htmlFor`, no `id` and no `aria-label` fallback. The label and the control
 * were adjacent only VISUALLY: assistive tech read an anonymous "edit box" /
 * "combobox" with the field name floating above it as unowned text, and
 * clicking the visible label did nothing. These atoms are the generic inputs of
 * every scoped metadata inspector (16 non-test modules consume them — page
 * blocks, flow nodes, reports, datasets, permissions), so the defect rendered
 * the moment any inspector panel opened.
 *
 * `getByLabelText` walks the same `for`→id chain assistive tech does, which is
 * why the queries below are the assertion and not a convenience: pre-fix they
 * returned zero matches. The mechanical symptom was already written down as a
 * workaround — `PageBlockInspector.sectionName.test.tsx` located its boxes by
 * placeholder *because* `getByLabelText` could not reach them; that locator is
 * tightened in the same change.
 *
 * ## The fourth atom (objectui#3997)
 *
 * `InspectorComboField` lives in its own module but is the same shape — a
 * `<Label>` sibling over a `button[role=combobox]` — and PR #3996 did not touch
 * it, so it kept the defect after the three `_shared.tsx` atoms were fixed. It
 * joins the component-agnostic `describe.each` below unchanged, which is the
 * point of having written those rows against a roster rather than per component.
 *
 * Its `label` is optional, and the un-labelled branch was the defect one notch
 * worse: a wholly ANONYMOUS combobox (no `for`, no `aria-label`). That is now
 * unauthorable rather than merely fixed at the five call sites — naming is a
 * type-level requirement of exactly one of `label` / `ariaLabel` / `id`, pinned
 * by the `@ts-expect-error` case at the bottom of this file. The `id` variant
 * exists because one real call site (`DashboardWidgetInspector`'s `Field`
 * wrapper) already rendered `<Label htmlFor="widget-dataset">` over a combo that
 * accepted no id — a dangling IDREF, which is worse than an unnamed control
 * because tooling reports an association that resolves to nothing.
 *
 * ## Why the id is minted inside the atom
 *
 * `React.useId()`, not a caller-supplied prop. These atoms are rendered in
 * loops over array items (`record:details.sections[i]`, `page:tabs.items[i]`),
 * where every item repeats the same label — a caller-passed id is exactly the
 * thing that collides there, and a collision is invisible (both labels resolve
 * to the first control). The "several instances" cases below pin that
 * uniqueness rather than assuming it.
 *
 * ## Reverse verification (direction predicted BEFORE running, mutation not committed)
 *
 * Plain RED, in two separate shapes:
 *
 *  1. Drop `htmlFor`/`id` from ONE atom → that atom's `describe.each` rows go
 *     red (label resolution, `getByLabelText`, accessible name, uniqueness),
 *     the other two atoms and the `InspectorCheckboxField` control stay green.
 *  2. Move the select's `id` from `SelectTrigger` back onto `Select` → the
 *     select rows go red while text/number stay green, because Radix's
 *     `Select.Root` renders no DOM element and silently DROPS the id (the
 *     objectui#3976 / PR #3992 mechanism, one directory over).
 *  3. (#3997) Move the combo's `id` off the trigger `Button` and onto `Popover`
 *     → the combo rows go red for the same reason as (2): `Popover.Root` is a
 *     context provider that renders no DOM element, so the id is dropped and the
 *     `for` dangles. The other three atoms stay green.
 *
 * Measured outcomes are in the PR body.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Label } from '@object-ui/components';
import {
  InspectorTextField,
  InspectorNumberField,
  InspectorSelectField,
  InspectorCheckboxField,
} from './_shared';
import { InspectorComboField } from './InspectorComboField';

afterEach(cleanup);

const OPTIONS = [
  { value: 'profile', label: 'Profile' },
  { value: 'meta', label: 'Metadata' },
];

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

/** How many elements in the document carry this exact id. */
const idOwners = (id: string) => document.querySelectorAll(`[id="${id}"]`).length;

interface AtomCase {
  /** Component name, for the test titles. */
  atom: string;
  /** ARIA role of the control the label must name. */
  role: 'textbox' | 'spinbutton' | 'combobox';
  /** Tag of the element that must carry the id — the focusable control. */
  tag: 'INPUT' | 'BUTTON';
  /** One instance with the given label; `onCommit` is the caller's spy. */
  render: (label: string, onCommit: (v: never) => void) => React.ReactElement;
}

const ATOMS: AtomCase[] = [
  {
    atom: 'InspectorTextField',
    role: 'textbox',
    tag: 'INPUT',
    render: (label, onCommit) => (
      <InspectorTextField label={label} value="" onCommit={onCommit as (v: string) => void} />
    ),
  },
  {
    atom: 'InspectorNumberField',
    role: 'spinbutton',
    tag: 'INPUT',
    render: (label, onCommit) => (
      <InspectorNumberField
        label={label}
        value={undefined}
        onCommit={onCommit as (v: number | undefined) => void}
      />
    ),
  },
  {
    atom: 'InspectorSelectField',
    role: 'combobox',
    tag: 'BUTTON',
    render: (label, onCommit) => (
      <InspectorSelectField
        label={label}
        value={undefined}
        options={OPTIONS}
        onCommit={onCommit as (v: string) => void}
      />
    ),
  },
  {
    // objectui#3997 — the fourth atom, from its own module. Same shape, so the
    // rows below apply verbatim; the trigger is the `Button` that
    // `PopoverTrigger asChild` renders as `button[role=combobox]`.
    atom: 'InspectorComboField',
    role: 'combobox',
    tag: 'BUTTON',
    render: (label, onCommit) => (
      <InspectorComboField
        label={label}
        value=""
        options={OPTIONS}
        onCommit={onCommit as (v: string) => void}
      />
    ),
  },
];

describe.each(ATOMS)('$atom — the visible label names the control (#3994)', ({ role, tag, render: renderAtom }) => {
  it('emits no label pointing at an id nothing carries', () => {
    render(renderAtom('Group', vi.fn()));

    const labels = labelTargets();
    // The atom must produce a `for` at all — pre-fix there was none, and this
    // case would then fail on the length rather than pass vacuously.
    expect(labels).toHaveLength(1);
    expect(labels.filter((l) => !l.resolves)).toEqual([]);
  });

  it('resolves the label to the focusable control, not to a wrapper', () => {
    render(renderAtom('Group', vi.fn()));

    const labelled = screen.getAllByLabelText('Group');
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(screen.getByRole(role));
    expect(labelled[0].tagName).toBe(tag);
  });

  it('gives the control the label as its accessible name', () => {
    render(renderAtom('Group', vi.fn()));

    // The user-visible consequence, on the computed name rather than on markup:
    // pre-fix the control was reachable by role but ANONYMOUS.
    const control = screen.getByRole(role, { name: 'Group' });
    expect(control).toHaveAccessibleName('Group');
  });

  it('keeps `for` as the only naming channel', () => {
    // One label, one channel. A second `aria-labelledby` (or an `aria-label`
    // duplicating the visible text) is the double-announcement failure the
    // group-labelling work exists to avoid — objectui#3961/#3978.
    render(renderAtom('Group', vi.fn()));

    const control = screen.getByRole(role);
    const forId = screen.getByText('Group').getAttribute('for');
    // Asserted truthy first: with no association at all both sides are `null`
    // and a bare `toBe` would pass on the defect (null === null).
    expect(forId).toBeTruthy();
    expect(forId).toBe(control.getAttribute('id'));
    expect(control).not.toHaveAttribute('aria-labelledby');
    expect(control).not.toHaveAttribute('aria-label');
  });

  it('mints exactly one owner for the id', () => {
    render(renderAtom('Group', vi.fn()));

    const id = screen.getByRole(role).getAttribute('id')!;
    expect(id).toBeTruthy();
    expect(idOwners(id)).toBe(1);
  });
});

/* ───────────── several instances in one panel must not cross-wire ────────── */

describe.each(ATOMS)('$atom — instances in one panel are named independently (#3994)', ({ role, render: renderAtom }) => {
  it('gives two identically-labelled instances distinct ids', () => {
    // The array-item case verbatim: `record:details.sections[i]` renders the
    // same "Name (i18n key)" label once per section. A shared id would make
    // both labels resolve to the FIRST control — silently, since every
    // assertion on "a control named X" would still pass.
    render(
      <div>
        {renderAtom('Name', vi.fn())}
        {renderAtom('Name', vi.fn())}
      </div>,
    );

    const labelled = screen.getAllByLabelText('Name');
    expect(labelled).toHaveLength(2);
    expect(labelled[0]).not.toBe(labelled[1]);

    const ids = labelled.map((el) => el.getAttribute('id')!);
    expect(new Set(ids).size).toBe(2);
    ids.forEach((id) => expect(idOwners(id)).toBe(1));

    // …and each of the two labels owns its own control, in document order.
    const controls = screen.getAllByRole(role);
    expect(labelled).toEqual(controls);
  });

  it('resolves differently-labelled siblings to their own controls', () => {
    render(
      <div>
        {renderAtom('Group', vi.fn())}
        {renderAtom('Variant', vi.fn())}
      </div>,
    );

    const [first, second] = screen.getAllByRole(role);
    expect(screen.getByLabelText('Group')).toBe(first);
    expect(screen.getByLabelText('Variant')).toBe(second);
    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
  });
});

/* ─────────── the labelled element is the one that actually works ─────────── */

describe('the labelled element is the live control, not a decoy (#3994)', () => {
  it('InspectorTextField — typing into the label-located box commits from that instance', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <div>
        <InspectorTextField label="Name" value="" onCommit={first} />
        <InspectorTextField label="Name" value="" onCommit={second} />
      </div>,
    );

    fireEvent.change(screen.getAllByLabelText('Name')[1], { target: { value: 'contact_info' } });

    expect(second).toHaveBeenCalledWith('contact_info');
    expect(first).not.toHaveBeenCalled();
  });

  it('InspectorNumberField — the label-located box commits a number', () => {
    const onCommit = vi.fn();
    render(<InspectorNumberField label="Columns" value={undefined} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '2' } });

    expect(onCommit).toHaveBeenCalledWith(2);
  });

  it('InspectorSelectField — the id lands on the trigger that surfaces the value', () => {
    // Radix `Select.Root` renders no DOM element, so an id handed to it is
    // dropped and `for` dangles (objectui#3976). The trigger is the real
    // control: it is the element that displays the selected option's label.
    render(
      <InspectorSelectField label="Group" value="profile" options={OPTIONS} onCommit={vi.fn()} />,
    );

    const trigger = screen.getByLabelText('Group');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toContain('Profile');
  });

  it('InspectorComboField — the id lands on the trigger, not on the Radix Popover root', () => {
    // Same mechanism as the select one line up: `Popover.Root` is a context
    // provider with no DOM element of its own (objectui#3997). The trigger is
    // the real control — it is the element that displays the selected option's
    // label, takes focus, and toggles the list.
    render(
      <InspectorComboField label="Group" value="profile" options={OPTIONS} onCommit={vi.fn()} />,
    );

    const trigger = screen.getByLabelText('Group');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.textContent).toContain('Profile');
    // Nothing else in the tree carries the id — in particular no wrapper div
    // stood in for the dropped Root.
    expect(idOwners(trigger.getAttribute('id')!)).toBe(1);
  });

  it('InspectorComboField — a custom value keeps the trigger named', () => {
    // The escape hatch (`allowCustom`) renders the raw value as the trigger
    // text; naming must not depend on the value matching a catalog option.
    render(
      <InspectorComboField
        label="Group"
        value="account.owner.name"
        options={OPTIONS}
        onCommit={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toContain(
      'account.owner.name',
    );
    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
  });

  it('InspectorSelectField — a disabled field is still named', () => {
    // `disabled` stays on the Root (single authority over trigger + items +
    // the hidden native mirror); naming must not travel with it.
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={OPTIONS}
        onCommit={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Group' })).toBeDisabled();
    expect(labelTargets().filter((l) => !l.resolves)).toEqual([]);
  });
});

/* ────────── the un-labelled combo branch still names its trigger ─────────── */

describe('InspectorComboField — a combo without a visible label is still named (#3997)', () => {
  it('names the trigger from `ariaLabel` when no label is rendered', () => {
    // The repeated-row shape: an object filter's `field = value` pair, a
    // dataset's list of joins, an "add another" picker under a group heading.
    // Pre-fix these rendered a wholly anonymous combobox.
    render(
      <InspectorComboField
        ariaLabel="Included relationship"
        value="account_id"
        options={OPTIONS}
        onCommit={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Included relationship' });
    expect(trigger).toHaveAccessibleName('Included relationship');
    expect(trigger.tagName).toBe('BUTTON');
    // No visible label was rendered, so there is nothing to associate — and in
    // particular no `for` pointing at nothing.
    expect(document.querySelectorAll('label')).toHaveLength(0);
    expect(labelTargets()).toEqual([]);
    // `aria-label` is then the ONLY channel: no second `aria-labelledby`.
    expect(trigger).not.toHaveAttribute('aria-labelledby');
  });

  it('resolves an EXTERNAL label to the trigger when the caller owns the id', () => {
    // `DashboardWidgetInspector`'s `Field` wrapper verbatim: the caller renders
    // `<Label htmlFor={id}>` and hands the same id to the control it wraps.
    // Pre-fix the combo accepted no id, so that `for` dangled.
    render(
      <div className="space-y-1.5">
        <Label htmlFor="widget-dataset">Dataset</Label>
        <InspectorComboField
          id="widget-dataset"
          value="sales_pipeline"
          options={OPTIONS}
          onCommit={vi.fn()}
        />
      </div>,
    );

    const trigger = screen.getByLabelText('Dataset');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger).toHaveAccessibleName('Dataset');
    // The caller's `for` now RESOLVES, and to exactly one element.
    expect(labelTargets()).toEqual([{ text: 'Dataset', forId: 'widget-dataset', resolves: true }]);
    expect(idOwners('widget-dataset')).toBe(1);
    // The external label is the only channel — the atom did not also stamp an
    // `aria-label` "just in case", which would double-announce.
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  it('does not render a visible label for either un-labelled variant', () => {
    // Guards against "fixing" the anonymous branch by inventing a visible label
    // out of the aria name or the placeholder: these call sites are laid out in
    // rows where a rendered label would break the grid.
    const { container } = render(
      <InspectorComboField ariaLabel="Field" value="" options={OPTIONS} onCommit={vi.fn()} />,
    );

    expect(container.querySelector('label')).toBeNull();
    expect(screen.queryByText('Field')).not.toBeInTheDocument();
  });

  // The type-level half of this contract — that a combo with NO name, or with
  // two names, does not compile — is pinned in
  // `InspectorComboField.naming.types.test.tsx`, not here. That split is a
  // PREFERENCE, not a constraint: do not read it as a rule against writing a
  // `@ts-expect-error` in this file. It WAS a constraint when this note was
  // written — the package's build tsconfig excludes `**/*.test.tsx` and vitest
  // erases types, so a directive here would have failed neither when the error
  // disappeared nor when it was never there (objectui#3009).
  //
  // `tsconfig.test.json` now compiles every `src/**/*.test.tsx` in the package,
  // this file and that sibling alike, chained off the package's `type-check`
  // script. A directive in either is load-bearing: when the error it expects
  // stops happening, `tsc` reports the directive UNUSED (TS2578).
});

/* ───────────────────────── the counter-example holds ─────────────────────── */

describe('InspectorCheckboxField — the wrapping-label form still names its box', () => {
  it('is reachable by its label text without an id', () => {
    // This atom was already correct (`<label><input/><span>…</span></label>`),
    // and #3994 deliberately left it alone: a wrapping label is a valid
    // association and needs no id. It is the positive control for the reverse
    // verification above — it must stay green under both mutations.
    render(<InspectorCheckboxField label="Collapsible" value={false} onCommit={vi.fn()} />);

    const box = screen.getByLabelText('Collapsible');
    expect(box).toBe(screen.getByRole('checkbox'));
    expect(box).not.toHaveAttribute('id');
    expect(labelTargets()).toEqual([]);
  });
});
