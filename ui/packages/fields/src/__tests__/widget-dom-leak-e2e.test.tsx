/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GATE: no field widget may leak a non-DOM prop onto a DOM element
 * (objectui#3291).
 *
 * Every registered field widget is rendered through BOTH hosts, and every
 * attribute of every element it produced is checked against what HTML actually
 * defines. An attribute nobody can explain is a leak.
 *
 * ## What this catches that a unit test cannot
 *
 * The leak was never in one widget. It was structural: a widget spread
 * `{...props}` onto its control, and the hosts hand a widget more than the DOM
 * can take. Measured on `origin/main`, a real form, a real widget:
 *
 * ```
 * <input placeholder="PH-f" zzcanary="CANARY-STR" zzcanaryobj="[object Object]"
 *        zzcanarynum="42" id="…" type="text" value="" name="f">
 * ```
 *
 * `zzcanaryobj="[object Object]"` is an ordinary key an author wrote on the
 * field config. That is why the fix is a WHITELIST (`toDomProps`) and why this
 * test plants canaries rather than checking a list of known-bad names: a
 * blacklist of today's renderer props would pass all three canaries above.
 *
 * ## Four things that silently defeat a test like this
 *
 * 1. **React warnings prove nothing.** React 19 passes an all-lowercase
 *    unknown attribute through in COMPLETE silence. In the audit sweep the
 *    only warning came from a camelCase canary — which was written to the DOM
 *    anyway. So this walks real DOM attributes and never listens for console
 *    output.
 * 2. **Both hosts, or the result is a false pass.** The form renderer strips a
 *    known set before forwarding; `SchemaRenderer` spreads the whole authored
 *    node with NO strip layer, so it leaks strictly more (`label` is only
 *    visible there). On that path the widget's own spread is the only defence.
 * 3. **An error variant that produces no error tests nothing.** `required` +
 *    a `false` boolean does NOT fail here — this repo made `required` a
 *    presence check, so `false` is a value (cloud#972). The audit's first pass
 *    under-reported the `error` leak by one widget for exactly this reason.
 *    Every error variant therefore ASSERTS the message rendered before it
 *    scans; a variant that silently produces no error fails the test.
 * 4. **This repo runs happy-dom, not jsdom** (`vitest.config.mts`), whose IDL
 *    coverage has real gaps — `select[size]`, `option[label]`, `textarea[wrap]`
 *    and `col[span]` are all standard HTML that happy-dom does not reflect.
 *    See `@object-ui/test-support`'s `dom-leak-judge` for how the judge is
 *    built, and its `HAPPY_DOM_IDL_GAPS` for each measured exception and its
 *    reason. Every one of those four was found BY a calibration fixture, not
 *    by guesswork.
 *
 * ## The judge proves itself — next to the judge, not here
 *
 * `isKnownAttribute` / `findLeaks` / `leakReport` are imported from
 * `@object-ui/test-support`, which is where they now live for BOTH DOM-leak
 * gates (objectui#4434). They used to be defined in this file and copied into
 * `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`, and the
 * two copies had already drifted.
 *
 * The calibration fixtures moved with them: standard markup that must yield
 * ZERO findings, and markup with planted fake attributes that must ALL be
 * found, now unioned from both gates' fixtures and run once in
 * `packages/test-support/src/__tests__/dom-leak-judge.test.tsx`. When a
 * happy-dom upgrade changes IDL coverage, that fails loudly instead of this
 * sweep going quietly blind — and it now fails in ONE place instead of needing
 * to be discovered twice.
 *
 * ## Deliberate coverage boundary
 *
 * Popovers are NOT opened. Radix needs pointer-capture APIs happy-dom does not
 * implement. Every widget's props spread lands on its inline control (the
 * trigger for a picker), which always renders — so the spread site IS covered,
 * but content that exists only inside an open dropdown is NOT scanned by this
 * test.
 *
 * Widgets are registered from STATIC imports wrapped in `withFieldCarrier`,
 * never via `registerAllFields()`, which wraps every loader in `React.lazy` —
 * an unbounded module load inside a bounded `waitFor` is this repo's known
 * flake generator (AGENTS.md 测试纪律 / objectui#3010).
 */

import type { ComponentType } from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
// The attribute judge, shared with `packages/app-shell`'s sweep gate
// (objectui#4434). It used to be defined in this file and copied into that one;
// its calibration fixtures now live next to it and prove it for both gates.
// `@object-ui/test-support` is private and never published — see its README.
import { findLeaks, leakReport } from '@object-ui/test-support';

import { withFieldCarrier } from '../withFieldCarrier';
import { FORM_FIELD_TYPES } from '../index';

import { TextField } from '../widgets/TextField';
import { TextAreaField } from '../widgets/TextAreaField';
import { NumberField } from '../widgets/NumberField';
import { BooleanField } from '../widgets/BooleanField';
import { SelectField } from '../widgets/SelectField';
import { DateField } from '../widgets/DateField';
import { DateTimeField } from '../widgets/DateTimeField';
import { TimeField } from '../widgets/TimeField';
import { EmailField } from '../widgets/EmailField';
import { PhoneField } from '../widgets/PhoneField';
import { UrlField } from '../widgets/UrlField';
import { MultiSelectField } from '../widgets/MultiSelectField';
import { RadioField } from '../widgets/RadioField';
import { CheckboxesField } from '../widgets/CheckboxesField';
import { TagsField } from '../widgets/TagsField';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { PasswordField } from '../widgets/PasswordField';
import { RichTextField } from '../widgets/RichTextField';
import { LookupField } from '../widgets/LookupField';
import { FileField } from '../widgets/FileField';
import { ImageField } from '../widgets/ImageField';
import { LocationField } from '../widgets/LocationField';
import { FormulaField } from '../widgets/FormulaField';
import { SummaryField } from '../widgets/SummaryField';
import { AutoNumberField } from '../widgets/AutoNumberField';
import { UserField } from '../widgets/UserField';
import { ObjectField } from '../widgets/ObjectField';
import { VectorField } from '../widgets/VectorField';
import { GridField } from '../widgets/GridField';
import { ColorField } from '../widgets/ColorField';
import { SliderField } from '../widgets/SliderField';
import { RatingField } from '../widgets/RatingField';
import { CodeField } from '../widgets/CodeField';
import { AvatarField } from '../widgets/AvatarField';
import { AddressField } from '../widgets/AddressField';
import { GeolocationField } from '../widgets/GeolocationField';
import { SignatureField } from '../widgets/SignatureField';
import { QRCodeField } from '../widgets/QRCodeField';
import { ObjectRefField } from '../widgets/ObjectRefField';
import { FilterConditionField } from '../widgets/FilterConditionField';
import { RecipientPickerField } from '../widgets/RecipientPickerField';
import { PositionRefField, PermissionRefField } from '../widgets/RegistryRefField';

/* ════════════════════════════════════════════════════════════════════════════
 * Every registered field widget, both hosts
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Static components for the widget map's keys. Kept as one object so the
 * parity assertion below can prove it covers the whole registry: a NEW field
 * type added to `fieldWidgetMap` without a line here fails loudly rather than
 * quietly going unscanned.
 */
const WIDGETS: Record<string, ComponentType<any>> = {
  text: TextField,
  textarea: TextAreaField,
  number: NumberField,
  boolean: BooleanField,
  select: SelectField,
  date: DateField,
  datetime: DateTimeField,
  time: TimeField,
  email: EmailField,
  phone: PhoneField,
  url: UrlField,
  multiselect: MultiSelectField,
  radio: RadioField,
  checkboxes: CheckboxesField,
  tags: TagsField,
  currency: CurrencyField,
  percent: PercentField,
  password: PasswordField,
  markdown: RichTextField,
  html: RichTextField,
  richtext: RichTextField,
  lookup: LookupField,
  master_detail: LookupField,
  file: FileField,
  image: ImageField,
  location: LocationField,
  formula: FormulaField,
  summary: SummaryField,
  auto_number: AutoNumberField,
  user: UserField,
  // `owner: UserField` sat here until objectui#4814 retired the spelling. The
  // tombstone that replaced it spreads no author props onto the DOM, so it has
  // no leak surface to scan.
  object: ObjectField,
  vector: VectorField,
  grid: GridField,
  color: ColorField,
  slider: SliderField,
  rating: RatingField,
  code: CodeField,
  avatar: AvatarField,
  address: AddressField,
  geolocation: GeolocationField,
  signature: SignatureField,
  qrcode: QRCodeField,
  'object-ref': ObjectRefField,
  'filter-condition': FilterConditionField,
  'recipient-picker': RecipientPickerField,
  'position-ref': PositionRefField,
  'permission-ref': PermissionRefField,
};

/** Option widgets render an "unfillable" placeholder unless offered a list. */
const OPTION_TYPES = new Set(['select', 'multiselect', 'radio', 'checkboxes', 'tags']);
const OPTIONS = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
];

/**
 * The value each variant starts from: `null` is MISSING for the required check
 * this repo implements (presence, not truthiness — `false` and `0` are values,
 * cloud#972), so one value drives a real validation failure for every type,
 * including `boolean`. Trap 3 above is why that matters, and why every error
 * variant asserts the message before it scans.
 */
const MISSING_VALUE = null;

/** Author-written extras — the open tail that a blacklist cannot close. */
const AUTHORED_EXTRAS = {
  zzcanary: 'CANARY-STR',
  zzcanaryobj: { nested: true },
  zzcanarynum: 42,
  zzcanaryCamel: 'CANARY-CAMEL',
  reference_to: 'contacts',
};

function fieldConfig(type: string, extras: Record<string, unknown> = {}) {
  return {
    name: 'f',
    label: 'F',
    type: `field:${type}`,
    ...(OPTION_TYPES.has(type) ? { options: OPTIONS } : {}),
    ...extras,
  };
}

function renderForm(field: Record<string, unknown>, required: boolean) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues: { f: MISSING_VALUE },
        fields: [{ ...field, required }],
        onSubmit: () => {},
      }}
    />,
  );
}

/**
 * The form row. Waiting on `[data-field]` (emitted by `FormItem` for EVERY
 * field) rather than widget-specific copy keeps the wait condition identical
 * for all 46 widgets and independent of what any one of them renders.
 */
async function formRow(): Promise<Element> {
  return waitFor(() => {
    const row = document.querySelector('[data-field="f"]');
    if (!row) throw new Error('field row never rendered');
    return row;
  });
}

beforeAll(() => {
  for (const [type, Widget] of Object.entries(WIDGETS)) {
    // `withFieldCarrier` is the real registration seam (objectui#3233) — going
    // around it would test a widget in a shape no host ever produces.
    ComponentRegistry.register(type, withFieldCarrier(Widget) as any, {
      namespace: 'field',
      skipFallback: true,
    });
  }
}, 60000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('no field widget leaks non-DOM props to the DOM (objectui#3291)', () => {
  it('covers every field type the form can render', () => {
    // The gate's reach. Without this, adding a widget adds an unscanned widget.
    expect(Object.keys(WIDGETS).sort()).toEqual([...FORM_FIELD_TYPES].sort());
  });

  const types = Object.keys(WIDGETS);

  it.each(types)('field:%s — form path, plain field', async (type) => {
    renderForm(fieldConfig(type), false);
    const row = await formRow();
    expect(leakReport(`field:${type} [form/plain]`, findLeaks(row))).toBe('');
  });

  it.each(types)('field:%s — form path, author-written extra keys', async (type) => {
    // The largest measured leak source: the form renderer destructures a fixed set
    // of known keys and forwards the rest verbatim, so anything else an author
    // put on the field config arrives at the widget as a prop.
    renderForm(fieldConfig(type, AUTHORED_EXTRAS), false);
    const row = await formRow();
    expect(leakReport(`field:${type} [form/authored-extras]`, findLeaks(row))).toBe('');
  });

  it.each(types)('field:%s — form path, after a real validation failure', async (type) => {
    renderForm(fieldConfig(type), true);
    const row = await formRow();

    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    // Trap 3: scan only once the error is PROVEN to exist. A variant that
    // silently produced none would otherwise pass while testing nothing.
    await waitFor(() => {
      expect(document.querySelector('[data-field="f"]')?.textContent ?? '').toContain(
        'is required',
      );
    });

    expect(
      leakReport(`field:${type} [form/validation-error]`, findLeaks(await formRow())),
    ).toBe('');
  });

  it.each(types)('field:%s — SDUI path, plain node', async (type) => {
    // Strictly wider than the form path: `SchemaRenderer` spreads the whole
    // authored node as props with no strip layer, so the widget's own spread
    // is the only defence here.
    const { container } = render(
      <SchemaRenderer schema={{ ...fieldConfig(type), type: `field:${type}` } as any} />,
    );
    await waitFor(() => expect(container.firstElementChild).toBeTruthy());
    expect(leakReport(`field:${type} [sdui/plain]`, findLeaks(container))).toBe('');
  });

  it.each(types)('field:%s — SDUI path, author-written extra keys', async (type) => {
    const { container } = render(
      <SchemaRenderer
        schema={{ ...fieldConfig(type, AUTHORED_EXTRAS), type: `field:${type}` } as any}
      />,
    );
    await waitFor(() => expect(container.firstElementChild).toBeTruthy());
    expect(leakReport(`field:${type} [sdui/authored-extras]`, findLeaks(container))).toBe('');
  });
});
