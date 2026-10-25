/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A host `onBlur` must survive the widget it is handed to — measured through
 * the REAL form renderer, not a hand-built host (objectui#6802).
 *
 * ## Why this file exists at all
 *
 * `onBlur` is a DECLARED DOM pass-through key: it is named in
 * `FieldWidgetDomProps` (`../widgets/types.ts`), named in
 * `SDUI_DOM_PASS_THROUGH_KEYS` (`@object-ui/core`), and forwarded by
 * `toDomProps`. `CurrencyField` and `TagsField` each wrote their own
 * `onBlur={…}` AFTER the `{...toDomProps(props)}` spread, so the host's handler
 * was overwritten and never reached the control — this package's
 * DECLARED-BUT-NOT-DELIVERED class (objectui#3290 / objectui#3222).
 *
 * ## The measurement that makes this a REAL defect, not a latent one
 *
 * objectui#6802 was filed and triaged as LATENT, on the reading that "no host
 * in this repo passes `onBlur` to a field widget". ⛔ That is FALSE on `main`,
 * and this file is the reproduction.
 *
 * The form renderer hosts every field through react-hook-form's `Controller`
 * (`<FormField>` in `@object-ui/components`) and spreads the controller's field
 * object into the widget's props:
 *
 * ```tsx
 * render={({ field: formField, fieldState }) => (
 *   … renderFieldComponent(resolvedType, { ...fieldProps, …, ...formField, … })
 * ```
 * (`packages/components/src/renderers/form/form.tsx`)
 *
 * A react-hook-form controller field is `{ name, value, onChange, onBlur, ref,
 * disabled }` — so **`onBlur` is on the props of every registered field widget
 * in every form this repo renders**, and it is the handler that marks the field
 * touched and, under `validationMode: 'onBlur'` / `'onTouched'`, runs its
 * validation. A widget that overrides it does not drop a hypothetical key: it
 * silently opts that field type out of blur-mode validation while every other
 * field type on the same form keeps it.
 *
 * `validationMode` is authorable (`ObjectFormSchema`, wired to react-hook-form's
 * `mode`), so an author reaches this with metadata alone.
 *
 * ## What is asserted
 *
 * The widget-level composition pins live next to their widgets
 * (`NumberInputWidgets.badInputAnnounce.test.tsx` for the four `type="number"`
 * widgets, `TagsField.hostOnBlur.test.tsx` for tags). THIS file asserts the
 * consequence a user can see: a blur-mode required field announces on blur.
 * `NumberField` — repaired in objectui#6780 — is the CONTROL: it proves the
 * harness really does produce a blur-mode failure, so a red currency row is
 * about the widget and not about the fixture.
 *
 * The widgets are registered raw rather than through `registerAllFields()`,
 * which wraps every loader in `React.lazy`: an unbounded module load inside a
 * bounded `findBy`/`waitFor` window is the repo's known flake generator
 * (AGENTS.md 测试纪律, objectui#3010). Same component, no Suspense boundary.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { CurrencyField } from '../widgets/CurrencyField';
import { TagsField } from '../widgets/TagsField';
import { NumberField } from '../widgets/NumberField';

beforeAll(() => {
  ComponentRegistry.register('currency', CurrencyField as any, {
    namespace: 'field',
    skipFallback: true,
  });
  ComponentRegistry.register('tags', TagsField as any, {
    namespace: 'field',
    skipFallback: true,
  });
  ComponentRegistry.register('number', NumberField as any, {
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

/** The real form renderer, in the blur-driven validation mode authors declare. */
function renderBlurModeForm(field: any) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        validationMode: 'onBlur',
        defaultValues: {},
        fields: [field],
        onSubmit: () => {},
      }}
    />,
  );
}

const controlOf = (name: string, selector: string): HTMLElement => {
  const el = document.querySelector(`[data-field="${name}"] ${selector}`);
  if (!el) throw new Error(`no ${selector} rendered for field "${name}"`);
  return el as HTMLElement;
};

describe('the form renderer really does hand a field widget an onBlur (objectui#6802)', () => {
  it('CONTROL: NumberField — repaired in objectui#6780 — announces on blur', async () => {
    renderBlurModeForm({ name: 'qty', label: 'Qty', type: 'number', required: true });

    fireEvent.blur(controlOf('qty', 'input[type=number]'));

    await waitFor(() => {
      expect(screen.getByText('Qty is required')).toBeInTheDocument();
    });
  });

  it('CurrencyField announces on blur instead of swallowing the host handler', async () => {
    renderBlurModeForm({ name: 'amount', label: 'Amount', type: 'currency', required: true });

    fireEvent.blur(controlOf('amount', 'input[type=number]'));

    await waitFor(() => {
      expect(screen.getByText('Amount is required')).toBeInTheDocument();
    });
  });

  it('TagsField announces on blur instead of swallowing the host handler', async () => {
    renderBlurModeForm({ name: 'labels', label: 'Labels', type: 'tags', required: true });

    fireEvent.blur(controlOf('labels', 'input'));

    await waitFor(() => {
      expect(screen.getByText('Labels is required')).toBeInTheDocument();
    });
  });
});
