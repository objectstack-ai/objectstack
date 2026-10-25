// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4010 — `ColorVariantPicker`'s `role="radiogroup"` must carry a name.
 *
 * Each swatch was already named by its COLOUR ("Blue", "Success"). The group was
 * named by nothing at all, so focus entering it announced an anonymous
 * radiogroup: eight colours, no statement of what they colour. The visible
 * "Color" label beside it belonged to no one.
 *
 * A `<label for>` cannot repair that. `role="radiogroup"` is a CONTAINER, not a
 * labelable element, so a `for` aimed at it is inert HTML — the reason this repo
 * moved group-labelled field widgets onto the WAI-ARIA group pattern
 * (objectui#3961 → #3990) and the reason `form.tsx` drops the `for` outright
 * when it publishes the label's id instead. So the pins below are about the
 * IDREF, not about `getByLabelText`.
 *
 * ## What each assertion is guarding, and why it is not one assertion
 *
 * `toHaveAccessibleName` alone is not enough. An `aria-labelledby` pointing at
 * the WRONG element still computes a name — that element's text — and a
 * name-only assertion cannot tell "named by its own label" from "named by
 * whatever happened to be nearby" (the #4788/#4824 reachability family). So the
 * IDREF is also resolved to a NODE and that node is asserted to BE the visible
 * label, inside this field's own container. And because a duplicated id
 * resolves silently to the first owner, the id's owner count is pinned too.
 *
 * The type-level cases sit in this file rather than a separate one because
 * `packages/app-shell/tsconfig.test.json` compiles every `src/**\/*.test.tsx`
 * in the package and is chained from its `type-check` script (objectui#4040
 * retired the narrow `tsconfig.typetests.json` after the package graduated). A
 * `@ts-expect-error` here is therefore read by a compiler CI runs — the
 * distinction objectui#3009 was filed over.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Label } from '@object-ui/components';
import { ColorVariantPicker } from './color-variant-field';

afterEach(cleanup);

const noop = (_v: string) => {};
const OPTIONS = [{ value: 'default' }, { value: 'blue', label: 'Blue' }];

/** How many elements in the document carry this exact id. */
const idOwners = (id: string) => document.querySelectorAll(`[id="${id}"]`).length;

describe('ColorVariantPicker — named by a visible label (IDREF)', () => {
  /** The call-site shape both inspectors use: a label that publishes its id. */
  function renderLabelled(labelText = 'Color') {
    return render(
      <div data-testid="field">
        <Label id="color-label">{labelText}</Label>
        <ColorVariantPicker ariaLabelledBy="color-label" value="blue" onChange={noop} options={OPTIONS} />
      </div>,
    );
  }

  it('resolves its IDREF to the visible label NODE, in its own field container', () => {
    renderLabelled();
    const group = screen.getByRole('radiogroup');

    const idref = group.getAttribute('aria-labelledby');
    // Truthy first: with no association at all both sides read `null`, and a
    // bare `toBe` would pass on the defect (null === null).
    expect(idref).toBeTruthy();

    const target = document.getElementById(idref!);
    expect(target).not.toBeNull();
    // Not merely "some element with the right text" — THE visible label.
    expect(target).toBe(screen.getByText('Color'));
    expect(target!.tagName).toBe('LABEL');
    // Container ownership: the name comes from this field, not from a
    // same-texted label elsewhere on a panel that renders many.
    expect(within(screen.getByTestId('field')).getByText('Color')).toBe(target);
    // Exactly one element answers that id.
    expect(idOwners(idref!)).toBe(1);
  });

  it('computes the accessible name a screen reader announces', () => {
    renderLabelled();
    // The end state, through the same accname walk assistive tech performs.
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Color');
    expect(screen.getByRole('radiogroup', { name: 'Color' })).toBeInTheDocument();
  });

  it('keeps the IDREF as the ONLY naming channel', () => {
    // One label, one channel. A second `aria-label` duplicating the visible text
    // is the double-announcement failure objectui#3961/#3978 removed — and the
    // group must NOT carry the field id either, which would make a `<label for>`
    // resolve while still naming nothing (the cosmetic half-fix #4010 refused).
    renderLabelled();
    const group = screen.getByRole('radiogroup');
    expect(group).not.toHaveAttribute('aria-label');
    expect(group).not.toHaveAttribute('id');
    // No `for` anywhere: nothing may claim a labelable association to a group.
    expect(document.querySelectorAll('label[for]')).toHaveLength(0);
  });

  it('names the GROUP without disturbing the per-swatch names', () => {
    renderLabelled();
    const group = screen.getByRole('radiogroup');
    // The swatches keep their own colour names…
    expect(within(group).getByRole('radio', { name: 'Blue' })).toBeInTheDocument();
    // …and the group's name is the field's, not a colour's.
    expect(group).toHaveAccessibleName('Color');
  });

  it('carries the label text verbatim, whatever the locale rendered', () => {
    // The IDREF channel cannot drift from the visible text: it IS the text.
    // A translated panel therefore needs no second translated string.
    renderLabelled('颜色');
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('颜色');
  });
});

describe('ColorVariantPicker — self-owned name (aria-label)', () => {
  it('names the group when no visible label is in a position to publish an id', () => {
    // The generic `SchemaForm` host: its `<Label htmlFor={id}>` is written
    // before it can know this widget renders a group rather than a labelable
    // `<input type="color">`.
    render(<ColorVariantPicker ariaLabel="Color Variant" value="blue" onChange={noop} options={OPTIONS} />);

    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAccessibleName('Color Variant');
    // Single channel here too — no IDREF pointing at an id nothing publishes,
    // which would be the dangling reference this issue exists to remove.
    expect(group).not.toHaveAttribute('aria-labelledby');
  });
});

describe('ColorVariantPicker — naming is required, and singular (compile time)', () => {
  it('is pinned by the compiler, not only by the DOM', () => {
    // Neither mistake has a runtime symptom the component could report: an
    // unnamed swatch row renders, lays out and commits values perfectly. It is
    // wrong only for the users who cannot see it, so the check has to happen at
    // authoring time or not at all.
    const anonymous = (
      // @ts-expect-error objectui#4010 — an unnamed colour group must not compile.
      <ColorVariantPicker value="blue" onChange={noop} options={OPTIONS} />
    );
    const doublyNamed = (
      // @ts-expect-error objectui#4010 — the two naming channels are exclusive.
      // (The directive belongs on the ELEMENT, not on the offending attribute:
      // an incompatible union is reported against the whole attributes object,
      // so a per-attribute directive reads as unused and fails the build.)
      <ColorVariantPicker ariaLabel="Color" ariaLabelledBy="color-label" value="blue" onChange={noop} />
    );
    expect([anonymous, doublyNamed].every(React.isValidElement)).toBe(true);
  });

  it('pins the union itself, not only how JSX happens to check it', () => {
    // Assignability is the contract; JSX is one authoring surface over it, and
    // excess-property checking makes the two differ often enough to pin both.
    type Assert< T extends true > = T;
    type Extends< A, B > = [A] extends [B] ? true : false;
    type IsAny< T > = 0 extends 1 & T ? true : false;
    type Equal< A, B > = (< T >() => T extends A ? 1 : 2) extends < T >() => T extends B ? 1 : 2
      ? true
      : false;
    type Props = React.ComponentProps< typeof ColorVariantPicker >;
    /** Everything the picker needs EXCEPT a name. */
    type Base = { value: string | undefined; onChange: (v: string) => void };

    // Guard against the probe lying: were the props `any`, every assertion
    // below would pass while proving nothing.
    type _PropsNotAny = Assert< Equal< IsAny< Props >, false > >;

    type _IdrefIsANaming = Assert< Extends< Base & { ariaLabelledBy: string }, Props > >;
    type _SelfIsANaming = Assert< Extends< Base & { ariaLabel: string }, Props > >;
    // The defect this file exists for: three call sites shipped this shape.
    type _AnonymousRejected = Assert< Equal< Extends< Base, Props >, false > >;
    type _BothRejected = Assert<
      Equal< Extends< Base & { ariaLabel: string; ariaLabelledBy: string }, Props >, false >
    >;

    expect(true).toBe(true);
  });

  it('accepts each legal spelling as a real element', () => {
    // Keeps the positive cases honest: a union too tight for a shape a real call
    // site needs would fail here rather than only in CI's build.
    const byIdref = <ColorVariantPicker ariaLabelledBy="color-label" value="blue" onChange={noop} />;
    const bySelf = <ColorVariantPicker ariaLabel="Color" value="blue" onChange={noop} />;
    expect([byIdref, bySelf].every(React.isValidElement)).toBe(true);
  });
});
