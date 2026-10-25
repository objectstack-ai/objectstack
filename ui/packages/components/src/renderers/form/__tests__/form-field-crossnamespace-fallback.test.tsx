/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A form field's `type` resolves a FIELD WIDGET or nothing — objectui#5254,
 * maintainer ruling of 2026-08-19 (option B of the measured option set).
 *
 * ## What was measured on `origin/main` at 3fbbea1f3
 *
 * `renderFieldComponent` resolved `field:<type>` first and then fell back to
 * `ComponentRegistry.get(type)` — the BARE name, in whatever namespace happened
 * to hold it. `./input.tsx` registers `email` and `password` as `ui`-namespace
 * SDUI NODE renderers (for a top-level `{ type: 'email' }` node), so a
 * hand-authored form field landed in one of them and got the field-widget prop
 * bundle it does not implement, spread straight onto the element:
 *
 *   type:'email' + max_length: 50
 *     attrs=["class","id","max_length","field","aria-describedby",
 *            "aria-invalid","type","value","name"]
 *     maxlength=null      field="[object Object]"
 *
 * Three defects in one render:
 *
 *   1. `field` — the raw metadata OBJECT — became a stray DOM attribute,
 *      stringified to `[object Object]`. The field-widget strip deliberately
 *      KEEPS `field` (it is the widget metadata carrier, objectui#3233), which
 *      is correct for a field widget and wrong for a component that is not one.
 *   2. `max_length` reached the element as an inert attribute and the field had
 *      NO cap: `maxlength` was `null`.
 *   3. That renderer draws its own `<Label>`, so the control got a SECOND
 *      `<label>` on top of the form's own `<FormLabel>` — two labels naming one
 *      control.
 *
 * The fallback was not narrow: it answered **126** bare names on this built-in
 * path (`div`, `h1`, `card`, `button`, `form` …) and 116 with the fields
 * package registered as well.
 *
 * ## The behaviour change, stated
 *
 * A spelling that resolved yesterday stops resolving: a form field whose `type`
 * names a non-field component now takes the `default` input branch instead of
 * rendering that component. That is the ruling's substance, not a side effect.
 *
 * ## Why `email`/`password` still render a native input
 *
 * The ruling put one verification on the implementer: "the default branch
 * renders a usable input for these types". Measured — it does NOT on its own.
 * `inputType` on the default branch is whatever the AUTHOR wrote, and a plain
 * `{ name, type: 'password' }` authors none, so the branch would have rendered
 * `type="text"` and put a secret on screen in clear text. `NATIVE_INPUT_FIELD_TYPES`
 * in form.tsx is what closes that: these two declared field types
 * (`EmailFieldMetadata` / `PasswordFieldMetadata` in `@object-ui/types`) keep
 * the native input they always had. The VISIBLE rendering of an `email` /
 * `password` field is therefore unchanged — only the leak, the duplicate label
 * and the dead ceiling go away.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/** Render the built-in branch: no `registerAllFields()`, so nothing resolves under `field:`. */
function renderForm(fields: any[], extra: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields, ...extra }} />,
  );
}

const input = () => document.querySelector('input') as HTMLInputElement;

afterEach(cleanup);

describe('form field type resolution — no cross-namespace fallback (objectui#5254)', () => {
  describe('the fallback the ruling removed', () => {
    it('still has a bare `email` entry to fall back TO — the routing premise', () => {
      // Without this the whole file would pass on an empty registry. `email`
      // and `password` ARE registered (as `ui` SDUI nodes) and there is NO
      // `field:` entry for them on this path — exactly the shape that used to
      // route a form field into a non-field component.
      expect(ComponentRegistry.get('form')).toBeTruthy(); // counter-probe: registry populated
      expect(ComponentRegistry.get('email')).toBeTruthy();
      expect(ComponentRegistry.get('password')).toBeTruthy();
      expect(ComponentRegistry.get('field:email')).toBeUndefined();
      expect(ComponentRegistry.get('field:password')).toBeUndefined();
    });

    it('never leaks the `field` metadata object onto the DOM', () => {
      renderForm([{ name: 'contact', label: 'Contact', type: 'email' }]);
      // Pre-fix: field="[object Object]".
      expect(input().getAttributeNames()).not.toContain('field');
    });

    it('caps the field by its declared ceiling', () => {
      // Pre-fix the fixture spelled the ceiling `max_length`, which reached the
      // element as a stray attribute and capped nothing. objectui#11070 retired
      // that spelling (every reader reads the spec's `maxLength` alone), so the
      // pin now declares the ceiling the one way it is read.
      renderForm([{ name: 'contact', label: 'Contact', type: 'email', maxLength: 50 }]);
      expect(input().getAttribute('maxlength')).toBe('50');
    });

    it('gives the control exactly ONE label', () => {
      // Pre-fix the `ui` renderer drew its own <Label> on top of <FormLabel>.
      const { container } = renderForm([{ name: 'contact', label: 'Contact', type: 'email' }]);
      expect(container.querySelectorAll('label')).toHaveLength(1);
    });

    it('stops routing a form field into an arbitrary non-field component', () => {
      // The CLASS, not just the two spellings the card measured: `card` is a
      // plain SDUI component that no `field:` entry claims. Pre-fix this
      // rendered the Card component in the field slot and no input at all.
      expect(ComponentRegistry.get('card')).toBeTruthy(); // counter-probe
      renderForm([{ name: 'note', label: 'Note', type: 'card' }]);
      expect(input()).toBeTruthy();
    });
  });

  describe('the ruling’s required check — the default branch is a USABLE input', () => {
    it('renders `email` as a native email input, still named and labelled', () => {
      const { container } = renderForm([{ name: 'contact', label: 'Contact', type: 'email' }]);
      const el = input();
      expect(el.tagName).toBe('INPUT');
      expect(el.getAttribute('type')).toBe('email');
      expect(el.getAttribute('name')).toBe('contact');
      expect(el.hasAttribute('disabled')).toBe(false);
      expect(el.hasAttribute('readonly')).toBe(false);
      // Label names THIS control (the `for`/`id` pair), so the input is
      // reachable by its accessible name rather than merely present.
      const label = container.querySelector('label')!;
      expect(label.getAttribute('for')).toBe(el.getAttribute('id'));
      expect(el.getAttribute('id')).toBeTruthy();
    });

    it('renders `password` MASKED — the half that would be worse than the leak', () => {
      // Without form.tsx's `NATIVE_INPUT_FIELD_TYPES` this branch renders
      // `type="text"` and the secret is on screen in clear text.
      renderForm([{ name: 'secret', label: 'Secret', type: 'password' }]);
      expect(input().getAttribute('type')).toBe('password');
      expect(input().getAttribute('name')).toBe('secret');
    });

    it('accepts typed input and reports it to the form — usable, not just present', () => {
      const seen: any[] = [];
      renderForm([{ name: 'contact', label: 'Contact', type: 'email' }], {
        onChange: (values: unknown) => { seen.push(values); },
      });
      fireEvent.change(input(), { target: { value: 'a@b.com' } });
      expect(input().value).toBe('a@b.com');
      // The value reaches the form state under the field's own name — this is
      // what makes it a working FIELD and not merely a text box on screen.
      expect(seen.at(-1)).toMatchObject({ contact: 'a@b.com' });
    });

    it('lets an explicitly authored inputType win over the type-derived one', () => {
      renderForm([{ name: 'contact', label: 'Contact', type: 'email', inputType: 'text' }]);
      expect(input().getAttribute('type')).toBe('text');
    });
  });

  describe('what did NOT change', () => {
    it('still resolves a `field:`-namespaced widget', () => {
      // The other side of the rule: removing the bare-name tail must not touch
      // field-widget resolution. Registered here rather than via
      // `registerAllFields()` so the assertion is hermetic.
      const Widget = (props: any) =>
        <output data-testid="zzwidget">{String(props.field?.name)}</output>;
      ComponentRegistry.register('zzcross', Widget as any, { namespace: 'field' });
      try {
        const { getByTestId } = renderForm([{ name: 'w', label: 'W', type: 'zzcross' }]);
        expect(getByTestId('zzwidget').textContent).toBe('w');
      } finally {
        ComponentRegistry.unregister('zzcross', 'field');
      }
    });

    it('leaves the `ui` SDUI node renderers reachable as NODES', () => {
      // `email`/`password` are legitimate top-level SDUI node types. This card
      // removes them from FIELD resolution only — rendering one as a node is
      // untouched (and is what packages/components/src/__tests__/
      // form-renderers.test.tsx covers).
      const Email = ComponentRegistry.get('email')!;
      const { container } = render(<Email schema={{ type: 'email', label: 'Email' }} />);
      expect(container.querySelector('input[type="email"]')).toBeTruthy();
    });

    it('leaves a builtin type on its own branch', () => {
      // `input` is a BUILTIN_FIELD_TYPES member — the registry is never
      // consulted for it, before or after.
      renderForm([{ name: 'plain', label: 'Plain', type: 'input' }]);
      expect(input().getAttribute('type')).toBe('text');
      expect(input().getAttributeNames()).not.toContain('field');
    });
  });
});
