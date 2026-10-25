/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The three remaining secret-field spellings on the unregistered-widget
 * `default` branch — objectui#5375, maintainer ruling of 2026-08-20 (C + A).
 * This file pins **half A**: the defense-in-depth table entries. Half C — the
 * authoring-time refusal of a namespaced id that is not `field:` — is pinned in
 * `packages/core/src/validation/__tests__/form-field-widget-namespace.test.ts`.
 *
 * ## What was measured on this card's branch point (`main` at f2e11ae6f)
 *
 * The real `form` renderer on the built-in path (no `registerAllFields()`),
 * before AND after objectui#5322's fix:
 *
 *   type            registry hit   rendered type
 *   ui:password     TRUE           text
 *   secret          false          text
 *   field:secret    false          text
 *
 * All three put the secret on screen in clear text. For contrast, `password`
 * renders a native masked input and `field:password` is refused outright.
 *
 * ## Why each one missed, and what each gets now
 *
 *  - **`ui:password`** — `renderFieldComponent` resolves a field's `type` only
 *    through the `field:` namespace (objectui#5254), so a `ui`-qualified id
 *    resolves nothing and falls here, where it missed
 *    `NATIVE_INPUT_FIELD_TYPES` (keyed on the `field:`-stripped type). It is
 *    the "verifying does not protect you" shape: `ui:password` IS registered —
 *    as an SDUI node renderer for a top-level `{ type: 'email' }`-style node —
 *    so an author who checks whether it resolves gets a YES. It now takes the
 *    native masked input, and half C makes writing it an authoring error.
 *  - **bare `secret`** — the ObjectQL field type. `mapFieldTypeToFormType` maps
 *    it to `field:password`, so an OBJECT-derived secret field was always safe;
 *    a hand-authored `{ name, type: 'secret' }` in a standalone `FormSchema`
 *    does not go through that mapping. It claims no registered widget, so this
 *    branch is its intended home: native masked input, same as bare `password`.
 *  - **`field:secret`** — a REGISTRY KEY naming a widget nothing registers, so
 *    reaching this branch with it proves the declared widget is absent. Refused
 *    outright, exactly as `field:password` is.
 *
 * ## Severity, stated honestly
 *
 * No producer emits any of the three; all are reachable only through a
 * hand-authored form schema. That is lower severity than objectui#5322 — but a
 * hand-authored standalone form is exactly the surface where the AUTHOR is the
 * producer and no normalizer sits in between.
 *
 * ## Build artifacts
 *
 * None between the edit and the thing under test. The root `vitest.config.mts`
 * `alias` block maps every `@object-ui/*` specifier to that package's `src/`,
 * and the renderer under test is imported through a relative path
 * (`../../../renderers`). No `dist/` is consulted on this leg.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

describe('secret field spellings on the unregistered-widget default branch (objectui#5375)', () => {
  describe('the routing premise', () => {
    it('resolves NOTHING under `field:` on this path', () => {
      // Counter-probe: without it the whole file would pass on a registry
      // where the widgets happen to exist — never exercising the branch.
      expect(ComponentRegistry.get('form')).toBeTruthy();
      expect(ComponentRegistry.get('field:secret')).toBeUndefined();
      expect(ComponentRegistry.get('field:password')).toBeUndefined();
    });

    it('DOES resolve `ui:password` — the "verifying does not protect you" fact', () => {
      // The whole reason half C is the primary fix: an author who checks
      // whether this id resolves gets a yes, and still got a clear-text box.
      // (`./input.tsx` registers `password` with `namespace: 'ui'`.)
      expect(ComponentRegistry.get('ui:password')).toBeTruthy();
    });
  });

  describe('`ui:password` — a registered SDUI node id that is not a field widget', () => {
    it('renders a native MASKED input, not a clear-text box', () => {
      // Pre-fix: type="text" — the secret on screen in clear text.
      const { container } = renderForm([
        { name: 'pw', label: 'Password', type: 'ui:password' },
      ]);
      const el = container.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      expect(el.getAttribute('type')).toBe('password');
    });

    it('does not resolve the registered `ui` node renderer as the field widget', () => {
      // objectui#5254's ruling stands: the field path resolves colon-qualified
      // ids ONLY under `field:`. If the cross-namespace fallback came back, the
      // `ui` renderer would draw its own <Label> on top of the form's.
      const { container } = renderForm([
        { name: 'pw', label: 'Password', type: 'ui:password' },
      ]);
      expect(container.querySelectorAll('label').length).toBe(1);
    });

    it('an explicitly authored `inputType` still wins over the table', () => {
      const { container } = renderForm([
        { name: 'pw', label: 'Password', type: 'ui:password', inputType: 'text' },
      ]);
      expect((container.querySelector('input') as HTMLInputElement).getAttribute('type')).toBe('text');
    });
  });

  describe('bare `secret` — the ObjectQL type, hand-authored', () => {
    it('renders a native MASKED input, not a clear-text box', () => {
      // Pre-fix: type="text".
      const { container } = renderForm([
        { name: 'apiKey', label: 'API key', type: 'secret' },
      ]);
      const el = container.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      expect(el.getAttribute('type')).toBe('password');
    });

    it('matches what the bare `password` spelling renders', () => {
      // The two bare spellings name the same kind of value; a fix that gave
      // them different answers would not be a fix.
      const { container } = renderForm([{ name: 'a', type: 'password' }]);
      expect((container.querySelector('input') as HTMLInputElement).getAttribute('type')).toBe('password');
    });
  });

  describe('`field:secret` — a registry key nothing registers', () => {
    it('renders NO input at all', () => {
      // Pre-fix: <input type="text"> — the secret on screen in clear text.
      const { container } = renderForm([
        { name: 's1', label: 'Secret', type: 'field:secret' },
      ]);
      expect(container.querySelector('input')).toBeNull();
    });

    it('renders a visible refusal naming the widget that is missing', () => {
      const { getByTestId } = renderForm([
        { name: 's2', label: 'Secret', type: 'field:secret' },
      ]);
      const refusal = getByTestId('field-missing-secret-widget');
      expect(refusal.getAttribute('role')).toBe('alert');
      expect(refusal.getAttribute('data-missing-field-widget')).toBe('field:secret');
      expect(refusal.textContent).toContain('field:secret');
      expect(refusal.textContent).toContain('registerAllFields()');
    });

    it('keeps a seeded secret out of the DOM entirely', () => {
      // Not "is it masked" but "is it absent": a type="password" box still
      // carries the value on the element; this branch must carry it nowhere.
      const { container } = renderForm(
        [{ name: 's3', label: 'Secret', type: 'field:secret' }],
        { defaultValues: { s3: 'hunter2' } },
      );
      expect(container.innerHTML).not.toContain('hunter2');
      expect(input()).toBeNull();
    });
  });

  describe('the neighbours this card did NOT move', () => {
    it('`field:password` still refuses (objectui#5322, unchanged)', () => {
      const { container, getByTestId } = renderForm([
        { name: 'pw', label: 'Password', type: 'field:password' },
      ]);
      expect(container.querySelector('input')).toBeNull();
      expect(getByTestId('field-missing-secret-widget').getAttribute('data-missing-field-widget'))
        .toBe('field:password');
    });

    it('a non-secret `ui:*` id is untouched — no namespace-stripping rule was added', () => {
      // The restraint pin. `ui:` did NOT get a prefix-stripping rule of its
      // own: only the one measured secret spelling is in the table. If someone
      // later "generalizes" it by stripping `ui:`, this turns red — which is
      // the point, because that would re-open the cross-namespace resolution
      // objectui#5254 removed.
      const { container } = renderForm([{ name: 'e', label: 'Email', type: 'ui:email' }]);
      const el = container.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      expect(el.getAttribute('type')).toBe('text');
    });

    it('an ordinary unregistered `field:*` id still renders its text box', () => {
      // Only the SECRET types are refused — turning the whole class into
      // refusals would change fields no card has moved or measured.
      const { container } = renderForm([{ name: 'c', label: 'Cost', type: 'field:currency' }]);
      const el = container.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      expect(el.getAttribute('type')).toBe('text');
    });
  });
});
