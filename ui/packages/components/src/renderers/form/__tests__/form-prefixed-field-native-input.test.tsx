/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The unregistered-widget `default` branch, answered per spelling —
 * objectui#5322, triage ruling of 2026-08-19.
 *
 * ## What was measured on this card's branch point (`main` at f2e11ae6f)
 *
 * On the built-in path (no `registerAllFields()`), with nothing registered
 * under the `field:` namespace:
 *
 *   field:password  registryGet=false  type="text"
 *                   attrs=["class","id","aria-describedby","aria-invalid","type","name"]
 *   field:email     registryGet=false  type="text"
 *   password        registryGet=true   type="password"    (objectui#5254 / PR5326)
 *   email           registryGet=true   type="email"       (objectui#5254 / PR5326)
 *
 * `mapFieldTypeToFormType` (`@object-ui/fields`) emits the `field:`-prefixed id
 * for EVERY object-derived form, so the first two lines are the normal path:
 * an object-derived `password` field rendered a plain text box with the secret
 * on screen in clear text, and an object-derived `email` field lost its native
 * keyboard and validation.
 *
 * PRE-EXISTING, not a regression from objectui#5254: `NATIVE_INPUT_FIELD_TYPES`
 * is keyed on the raw `type`, so the prefixed spelling always missed it. The
 * same reading was taken on `origin/main` before that change.
 *
 * ## The two halves, and why the spellings differ
 *
 * The ruling: *"the unregistered-widget default must respect the declared input
 * type, or refuse to render the value rather than degrade to clear text"*, with
 * *"for `password` specifically, prefer masking/refusal over best-effort
 * rendering"*. Both limbs are used, on the spellings where each is correct:
 *
 *  - A **bare** `password` / `email` claims no registered widget. This branch is
 *    its intended home and its native input is the CORRECT rendering, not a
 *    degrade. Unchanged — the behaviour PR5326 gave it is pinned below, because
 *    a fix that traded one spelling for the other would not be a fix.
 *  - A **`field:`-prefixed** id is a registry key, so reaching this branch with
 *    one PROVES the app shipped without the widget it declares. For `email`
 *    that is answered by respecting the declared type (`type="email"`). For
 *    `password` masking is not enough: the user would be typing a secret into a
 *    form whose password widget is absent, in a box that looks like it worked.
 *    It refuses — no input, no value in the DOM — and says why.
 *
 * ## Build artifacts
 *
 * None between the edit and the thing under test. Every `@object-ui/*`
 * specifier is aliased to that package's `src/` by the root `vitest.config.mts`
 * (`alias` block), and the renderer under test is imported through a relative
 * path (`../../../renderers`). No `dist/` is consulted on this leg.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
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

const input = () => document.querySelector('input') as HTMLInputElement | null;

afterEach(cleanup);

describe('the unregistered-widget default branch, per spelling (objectui#5322)', () => {
  describe('the routing premise', () => {
    it('resolves NOTHING for either `field:`-prefixed id on this path', () => {
      // Without this the whole file would pass on a registry where the widgets
      // happen to exist — i.e. never exercising the branch under test.
      expect(ComponentRegistry.get('form')).toBeTruthy(); // counter-probe: registry populated
      expect(ComponentRegistry.get('field:password')).toBeUndefined();
      expect(ComponentRegistry.get('field:email')).toBeUndefined();
    });
  });

  describe('`field:password` — refuses, rather than degrading to clear text', () => {
    it('renders NO input at all', () => {
      // Pre-fix: <input type="text"> — the secret on screen in clear text.
      const { container } = renderForm([
        { name: 'pw1', label: 'Password', type: 'field:password' },
      ]);
      expect(container.querySelector('input')).toBeNull();
    });

    it('renders a visible refusal naming the widget that is missing', () => {
      const { getByTestId } = renderForm([
        { name: 'pw2', label: 'Password', type: 'field:password' },
      ]);
      const refusal = getByTestId('field-missing-secret-widget');
      // `role="alert"` so the refusal is announced, not merely painted.
      expect(refusal.getAttribute('role')).toBe('alert');
      expect(refusal.getAttribute('data-missing-field-widget')).toBe('field:password');
      // The text names the offending id AND the fix — it is what an agent
      // iterating on the host bootstrap reads.
      expect(refusal.textContent).toContain('field:password');
      expect(refusal.textContent).toContain('registerAllFields()');
    });

    it('keeps a seeded secret out of the DOM entirely', () => {
      // The load-bearing assertion of this card: not "is it masked" but "is it
      // absent". A `type="password"` box still carries the value on the
      // element; this branch must carry it nowhere.
      const { container } = renderForm(
        [{ name: 'pw3', label: 'Password', type: 'field:password' }],
        { defaultValues: { pw3: 'hunter2' } },
      );
      expect(container.innerHTML).not.toContain('hunter2');
      expect(container.querySelector('input')).toBeNull();
    });

    it('writes the fix instruction to the console', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        renderForm([{ name: 'pw4', label: 'Password', type: 'field:password' }]);
        const said = spy.mock.calls.map((c) => String(c[0])).join('\n');
        expect(said).toContain("form field 'pw4'");
        expect(said).toContain('field:password');
        expect(said).toContain('registerAllFields()');
      } finally {
        spy.mockRestore();
      }
    });

    it('does not take the rest of the form down with it', () => {
      // One unrenderable field must not cost the other fields — the reason the
      // refusal is a rendered alert and not a throw.
      const { container, getByTestId } = renderForm([
        { name: 'pw5', label: 'Password', type: 'field:password' },
        { name: 'contact', label: 'Contact', type: 'field:email' },
      ]);
      expect(getByTestId('field-missing-secret-widget')).toBeTruthy();
      const email = container.querySelector('input[name="contact"]') as HTMLInputElement;
      expect(email).toBeTruthy();
      expect(email.getAttribute('type')).toBe('email');
    });

    it('yields to a REGISTERED `field:password` widget', () => {
      // The refusal answers a missing widget. It must never preempt a present
      // one — otherwise every app that DOES register its fields would lose its
      // password widget. Registered here rather than via `registerAllFields()`
      // so the assertion is hermetic.
      const Widget = (props: any) => (
        <output data-testid="zzpw">{String(props.field?.name)}</output>
      );
      ComponentRegistry.register('password', Widget as any, { namespace: 'field' });
      try {
        const { getByTestId, queryByTestId } = renderForm([
          { name: 'pw6', label: 'Password', type: 'field:password' },
        ]);
        expect(getByTestId('zzpw').textContent).toBe('pw6');
        expect(queryByTestId('field-missing-secret-widget')).toBeNull();
      } finally {
        ComponentRegistry.unregister('password', 'field');
      }
    });
  });

  describe('`field:email` — respects the declared input type', () => {
    it('renders the native email input, still named and labelled', () => {
      // Pre-fix: type="text" — the native keyboard and validation lost.
      const { container } = renderForm([
        { name: 'contact', label: 'Contact', type: 'field:email' },
      ]);
      const el = input()!;
      expect(el.tagName).toBe('INPUT');
      expect(el.getAttribute('type')).toBe('email');
      expect(el.getAttribute('name')).toBe('contact');
      // Label names THIS control (the `for`/`id` pair), so the input is
      // reachable by its accessible name rather than merely present.
      const label = container.querySelector('label')!;
      expect(label.getAttribute('for')).toBe(el.getAttribute('id'));
      expect(el.getAttribute('id')).toBeTruthy();
    });

    it('accepts typed input and reports it to the form — usable, not just present', () => {
      const seen: any[] = [];
      renderForm([{ name: 'contact', label: 'Contact', type: 'field:email' }], {
        onChange: (values: unknown) => {
          seen.push(values);
        },
      });
      fireEvent.change(input()!, { target: { value: 'a@b.com' } });
      expect(input()!.value).toBe('a@b.com');
      expect(seen.at(-1)).toMatchObject({ contact: 'a@b.com' });
    });

    it('lets an explicitly authored inputType win over the type-derived one', () => {
      renderForm([
        { name: 'contact', label: 'Contact', type: 'field:email', inputType: 'tel' },
      ]);
      expect(input()!.getAttribute('type')).toBe('tel');
    });
  });

  describe('the BARE spellings keep exactly what PR5326 gave them', () => {
    // A fix that traded one spelling for the other would not be a fix, and a
    // file that only covered the prefixed form would not catch that.
    it('renders bare `password` MASKED', () => {
      renderForm([{ name: 'secret', label: 'Secret', type: 'password' }]);
      const el = input()!;
      expect(el.getAttribute('type')).toBe('password');
      expect(el.getAttribute('name')).toBe('secret');
    });

    it('does NOT refuse a bare `password` — it claims no registered widget', () => {
      // The asymmetry, stated as a test: the refusal keys on the `field:`
      // prefix (a registry key that resolved nothing), never on the type alone.
      const { queryByTestId } = renderForm([
        { name: 'secret', label: 'Secret', type: 'password' },
      ]);
      expect(queryByTestId('field-missing-secret-widget')).toBeNull();
    });

    it('renders bare `email` as a native email input', () => {
      renderForm([{ name: 'contact', label: 'Contact', type: 'email' }]);
      expect(input()!.getAttribute('type')).toBe('email');
    });
  });

  describe('nothing else on this branch moved', () => {
    it('leaves another unregistered `field:*` id rendering its text box', () => {
      // Deliberately narrow: only `password` refuses, and only the two table
      // members get a native type. Turning the whole unregistered-`field:*`
      // class into refusals would change fields this card neither moved nor
      // measured.
      expect(ComponentRegistry.get('field:currency')).toBeUndefined(); // counter-probe
      const { queryByTestId } = renderForm([
        { name: 'amount', label: 'Amount', type: 'field:currency' },
      ]);
      expect(input()!.getAttribute('type')).toBe('text');
      expect(queryByTestId('field-missing-secret-widget')).toBeNull();
    });

    it('leaves a builtin type on its own branch', () => {
      // `input` is a BUILTIN_FIELD_TYPES member — the registry is never
      // consulted for it, and the prefix logic never runs.
      renderForm([{ name: 'plain', label: 'Plain', type: 'input' }]);
      expect(input()!.getAttribute('type')).toBe('text');
    });

    it('still caps a prefixed field by its declared ceiling', () => {
      // The `maxLength` resolution this branch does (#5253; the spec spelling
      // alone since objectui#11070) is untouched by the type-key change above.
      renderForm([
        { name: 'contact', label: 'Contact', type: 'field:email', maxLength: 50 },
      ]);
      expect(input()!.getAttribute('maxlength')).toBe('50');
    });
  });
});
