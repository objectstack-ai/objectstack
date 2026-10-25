/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GATE: the five widgets objectui#4857 left holding a dangling host id in the
 * EDITABLE state are named and described there too — the display-only four
 * through the host's declaration-driven wrapper, `grid` through its own
 * container.
 *
 * ## What was broken
 *
 * objectui#4788 wrapped a READONLY registered widget's replacement display in a
 * host-owned named group, keyed on `readonly === true`. Five widgets never
 * reached that gate while editable. Measured on `origin/main` at `e71c854ce`
 * (this file's probe, a real form + this file's registration, `description`
 * set, editable column):
 *
 * ```
 * formula      editable  for=DANGLING hostIdEl=NONE consumers=0
 * summary      editable  for=DANGLING hostIdEl=NONE consumers=0
 * auto_number  editable  for=DANGLING hostIdEl=NONE consumers=0
 * vector       editable  for=DANGLING hostIdEl=NONE consumers=0
 * grid         editable  for=DANGLING hostIdEl=NONE consumers=0
 * ```
 *
 * The display four have NO editable branch — the whole widget is a replacement
 * display — and on the real object-form path they arrive `disabled`, never
 * `readonly` (ObjectForm keeps `disabled`/`readonly` distinct deliberately; the
 * #4857 ruling rejected re-mapping them), so the #4788 gate could never fire.
 * They now declare `labelling: 'display'` and the host wraps them in EVERY
 * state.
 *
 * `grid` was re-measured before being classified (the 06:36Z correction on the
 * card warned against extrapolating from `slider`/`signature`): its bare config
 * offers exactly ONE focusable, the auxiliary "Add line" button — labelable,
 * but handing it the host id would make the field label NAME the add-row action
 * and a label click INSERT A ROW — and its realistic config offers 8 focusables
 * across cell inputs and row actions. A composite, so it declares
 * `labelling: 'group'` and its own container consumes the host's keys, exactly
 * like `address` / `checkboxes`.
 *
 * The widgets are registered raw with their PRODUCTION declarations rather than
 * through `registerAllFields()`, whose `React.lazy` loaders put an unbounded
 * module load inside a bounded `findBy` window — this repo's known flake
 * generator (AGENTS.md 测试纪律, objectui#3010).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { withFieldCarrier } from '../withFieldCarrier';
import { FormulaField } from '../widgets/FormulaField';
import { SummaryField } from '../widgets/SummaryField';
import { AutoNumberField } from '../widgets/AutoNumberField';
import { VectorField } from '../widgets/VectorField';
import { GridField } from '../widgets/GridField';
import { TextField } from '../widgets/TextField';

const DISPLAY_TYPES = ['formula', 'summary', 'auto_number', 'vector'] as const;

const VALUES: Record<string, unknown> = {
  formula: 'computed',
  summary: 7,
  auto_number: 'A-0001',
  vector: [0.1, 0.2, 0.3, 0.4],
};

const GRID_FIELD_META = {
  columns: [
    { name: 'item', label: 'Item', type: 'text' },
    { name: 'qty', label: 'Qty', type: 'number' },
  ],
};

beforeAll(() => {
  // The PRODUCTION declarations, exactly as `registerField` writes them from
  // `FIELD_WIDGET_LABELLING` — the declaration is half of what is under test.
  ComponentRegistry.register('formula', withFieldCarrier(FormulaField) as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'display',
  });
  ComponentRegistry.register('summary', withFieldCarrier(SummaryField) as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'display',
  });
  ComponentRegistry.register('auto_number', withFieldCarrier(AutoNumberField) as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'display',
  });
  ComponentRegistry.register('vector', withFieldCarrier(VectorField) as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'display',
  });
  ComponentRegistry.register('grid', withFieldCarrier(GridField) as any, {
    namespace: 'field',
    skipFallback: true,
    labelling: 'group',
  });
  // Positive control: an ordinary single-control widget, undeclared, whose
  // label must KEEP reaching a labelable element the plain way — the 27-row
  // green control group of the measurement.
  ComponentRegistry.register('text', withFieldCarrier(TextField) as any, {
    namespace: 'field',
    skipFallback: true,
  });
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

const fieldName = (type: string) => `f_${type}`;
const fieldLabel = (type: string) => `Label ${type}`;

function fieldConfig(
  type: string,
  opts: { readonly?: boolean; disabled?: boolean; field?: unknown } = {},
): Record<string, unknown> {
  const config: any = {
    name: fieldName(type),
    label: fieldLabel(type),
    type,
    description: 'Some help',
  };
  if (opts.field) config.field = opts.field;
  if (opts.readonly) config.readonly = true;
  if (opts.disabled) config.disabled = true;
  return config;
}

/** The real form renderer hosting one field — the reproduction. */
function renderForm(fields: any[], defaultValues: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        defaultValues,
        fields,
      }}
    />,
  );
}

const item = (name: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (!el) throw new Error(`no form item rendered for field "${name}"`);
  return el;
};

const hostLabel = (name: string): HTMLLabelElement => {
  const el = item(name).querySelector('label');
  if (!el) throw new Error(`no host label rendered for field "${name}"`);
  return el as HTMLLabelElement;
};

const byId = (id: string | null | undefined): HTMLElement | null =>
  id ? document.getElementById(id) : null;

const idrefs = (el: Element, attr: string): string[] =>
  (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean);

/** Every element whose `aria-describedby` NAMES `id` — the `consumers=` column. */
function describedbyConsumers(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-describedby]')).filter((el) =>
    (el.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(id),
  );
}

/** The host id, derived exactly as the #4788 probe derived it. */
function hostIdOf(name: string): string {
  const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]');
  expect(descEl).not.toBeNull();
  return descEl!.id.replace(/-description$/, '');
}

describe('a display-declared widget is named and described while the form is EDITABLE (objectui#4857)', () => {
  it.each(DISPLAY_TYPES)('%s: the host id is on a named group, and the label `for` is gone', (type) => {
    const name = fieldName(type);
    renderForm([fieldConfig(type)], { [name]: VALUES[type] });

    // `hostIdEl=NONE` → the host's wrapper group, in the EDITABLE state.
    const hostId = hostIdOf(name);
    const host = byId(hostId);
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('role', 'group');
    expect(host).toHaveAttribute('data-slot', 'readonly-field-group');
    expect(item(name).contains(host!)).toBe(true);

    // `for=DANGLING` → no `for` at all, and a published id instead
    // (single naming channel, objectui#3978).
    const label = hostLabel(name);
    expect(label).not.toHaveAttribute('for');
    expect(label.id).not.toBe('');

    // The name IDREFs resolve: label first, then the group itself so the VALUE
    // stays in the accessible name (`group` is not a name-from-content role).
    const labelled = idrefs(host!, 'aria-labelledby');
    expect(labelled).toEqual([label.id, hostId]);
    expect(byId(labelled[0])).toBe(label);

    // `consumers=0` → 1, on the same element that carries the name.
    const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]')!;
    expect(describedbyConsumers(descEl.id)).toEqual([host]);

    // The widget's own display output sits INSIDE the named group.
    expect(host!.firstElementChild).not.toBeNull();
    expect(host).toHaveAccessibleName(new RegExp(`^${fieldLabel(type)} .+`));
    expect(item(name).querySelectorAll('[role="group"]')).toHaveLength(1);

    // No control-channel state rides along (objectui#4005 boundary): a pure
    // display cannot be edited, so it cannot be invalid or required.
    expect(host).not.toHaveAttribute('aria-invalid');
    expect(host).not.toHaveAttribute('aria-required');
  });

  it('formula: the wrapper applies on the DISABLED path — the real object-form shape', () => {
    // `ObjectForm` maps computed fields to `disabled: true`, NOT
    // `readonly: true` (deliberately — option 1 of the #4857 option set was
    // rejected). The gate keys off the DECLARATION, so `disabled` neither
    // enables nor defeats it.
    const name = fieldName('formula');
    renderForm([fieldConfig('formula', { disabled: true })], { [name]: 'computed' });

    const host = byId(hostIdOf(name));
    expect(host).toHaveAttribute('role', 'group');
    expect(host).toHaveAccessibleName('Label formula computed');
    expect(host).toHaveAccessibleDescription('Some help');
    expect(hostLabel(name)).not.toHaveAttribute('for');
  });

  it.each(DISPLAY_TYPES)('%s: the readonly state keeps the same shape (both arms of the gate)', (type) => {
    const name = fieldName(type);
    renderForm([fieldConfig(type, { readonly: true })], { [name]: VALUES[type] });

    const host = byId(hostIdOf(name));
    expect(host).toHaveAttribute('role', 'group');
    expect(hostLabel(name)).not.toHaveAttribute('for');
    const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]')!;
    expect(describedbyConsumers(descEl.id)).toEqual([host]);
  });
});

describe('grid consumes the host channels on its own container (objectui#4857)', () => {
  it('editable: the container is the named, described group; cells keep their own names', () => {
    const name = fieldName('grid');
    renderForm(
      [fieldConfig('grid', { field: GRID_FIELD_META })],
      { [name]: [{ item: 'Widget', qty: 2 }] },
    );

    // The host id lands on the widget's OWN root container — no host wrapper
    // (the `'group'` path hands the widget the IDREF instead, objectui#3961).
    const hostId = hostIdOf(name);
    const host = byId(hostId);
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('data-testid', 'line-items');
    expect(host).toHaveAttribute('role', 'group');
    expect(host).not.toHaveAttribute('data-slot', 'readonly-field-group');

    // `for=DANGLING` → no `for`, a published label id, and the container names
    // itself by that single IDREF.
    const label = hostLabel(name);
    expect(label).not.toHaveAttribute('for');
    expect(label.id).not.toBe('');
    expect(idrefs(host!, 'aria-labelledby')).toEqual([label.id]);
    expect(host).toHaveAccessibleName(fieldLabel('grid'));

    // `consumers=0` → 1, the container (no cell input takes the FIELD's
    // description; each cell keeps its own `aria-label`).
    const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]')!;
    expect(describedbyConsumers(descEl.id)).toEqual([host]);

    // The composite's sub-controls keep their own names — the group name must
    // not swallow them (objectui#3961's second half).
    expect(screen.getAllByRole('textbox', { name: 'Item' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('spinbutton', { name: 'Qty' }).length).toBeGreaterThan(0);

    // Withheld keys: `name` is DOM-legal on form controls only (objectui#3291),
    // and `aria-invalid` is control-channel state this grid reports per CELL.
    expect(host).not.toHaveAttribute('name');
    expect(host).not.toHaveAttribute('aria-invalid');
    expect(host).not.toHaveAttribute('aria-required');
  });

  it('readonly: the replacement table takes the name AND the description itself', () => {
    const name = fieldName('grid');
    renderForm(
      [fieldConfig('grid', { readonly: true, field: GRID_FIELD_META })],
      { [name]: [{ item: 'Widget', qty: 2 }] },
    );

    const host = byId(hostIdOf(name));
    expect(host).not.toBeNull();
    // The widget's own container, not the host's readonly wrapper — a
    // group-labelled widget is excluded from the #4788 wrap so the id stays on
    // the surface the widget owns.
    expect(host).toHaveAttribute('role', 'group');
    expect(host).not.toHaveAttribute('data-slot', 'readonly-field-group');
    expect(item(name).querySelectorAll('[role="group"]')).toHaveLength(1);

    const label = hostLabel(name);
    expect(label).not.toHaveAttribute('for');
    expect(idrefs(host!, 'aria-labelledby')).toEqual([label.id]);

    const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]')!;
    expect(describedbyConsumers(descEl.id)).toEqual([host]);
  });

  it('standalone (no host label): no role claim, markup keeps its shape', () => {
    // A grid rendered without a visible label is handed no `aria-labelledby`,
    // so the container must NOT answer `role="group"` — a group nothing names
    // is the inert pair the declaration family exists to avoid.
    const name = fieldName('grid');
    renderForm(
      [{ name, type: 'grid', field: GRID_FIELD_META }],
      { [name]: [{ item: 'Widget', qty: 2 }] },
    );

    const container = document.querySelector('[data-testid="line-items"]')!;
    expect(container).not.toBeNull();
    expect(container).not.toHaveAttribute('role');
    expect(container).not.toHaveAttribute('aria-labelledby');
  });
});

describe('the control group is untouched — a single-control label still addresses its control', () => {
  it('text: no group, `for` resolves to a labelable element, description consumed by it', () => {
    const name = fieldName('text');
    renderForm([fieldConfig('text')], { [name]: 'Hello' });

    expect(screen.queryByRole('group')).toBeNull();
    const label = hostLabel(name);
    expect(label).not.toHaveAttribute('id');
    const target = byId(label.getAttribute('for'));
    expect(target).not.toBeNull();
    expect(['input', 'textarea', 'select', 'button']).toContain(target!.tagName.toLowerCase());
    const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]')!;
    expect(describedbyConsumers(descEl.id)).toEqual([target]);
  });
});
