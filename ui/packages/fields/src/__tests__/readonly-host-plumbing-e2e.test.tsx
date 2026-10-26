/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end over the REAL widgets: a readonly field's replacement display is
 * named by its visible label and described by its visible help text, whatever
 * shape that display takes (objectui#4788).
 *
 * The residual of the objectui#3961 → #3990 → #4005 family, on the other side of
 * the `labelling` declaration. Those three fixed the seven group-labelled
 * widgets, which consume the host's keys themselves. Every OTHER registered
 * widget declares `labelling: 'control'` by omission — correct for its editable
 * branch, which renders a labelable element and lands the host id on it — and
 * then returns EARLY in the readonly state with a replacement display that
 * spreads nothing at all.
 *
 * Measured on `origin/main` at `1ef236e18`, a real form + the same bare
 * registration this file uses, `description: 'Some help'` on every field, one
 * field per row. `for=` is the host label's target, `hostIdEl=` the element
 * carrying `…-form-item`, `consumers=` the elements whose `aria-describedby`
 * names the rendered `<FormDescription>`:
 *
 * ```
 *                readonly                                    editable
 * text     for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * number   for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * boolean  for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=switch consumers=1
 * email    for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * phone    for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * url      for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * formula  for=DANGLING hostIdEl=NONE consumers=0   for=DANGLING           hostIdEl=NONE   consumers=0
 * …(all 34 registered non-group-labelled types below, every readonly row identical)
 * ```
 *
 * `hostIdEl=NONE` is the reading that makes this heavier than #3990's family: in
 * the readonly state the `…-form-item` id was on NO element in the document, so
 * the visible label's `for` DANGLED and the surface had no accessible name at
 * all. The D group (`formula` / `summary` / `auto_number` / `vector`) has no
 * editable branch to differ from — the whole widget is a replacement display —
 * and reads the same in both columns.
 *
 * ## Why the assertions resolve IDREFs instead of trusting a name query
 *
 * The measurement that produced the table also ran a controlled experiment on
 * the obvious widget-side fix, and disproved it: an `aria-labelledby` on a
 * role-less `span` / `div` names NOTHING (`generic` prohibits an author name),
 * while `toHaveAccessibleName()` in jsdom answers PASS for exactly that markup.
 * A per-widget fix would have shipped 26 inert surfaces plus green tests
 * certifying them. So the mechanism landed once in the host — the form renderer
 * wraps a readonly registered widget's output in a `role="group"` container
 * carrying the id, the composite name and the description — and this file
 * checks OWNERSHIP: every IDREF is resolved against the document and the
 * resolved node is asserted to be the right element inside the right form item.
 *
 * ⛔ Not one widget under `packages/fields/src/widgets/` changed for this. That
 * is the structural claim of the fix (option E of the measured option set,
 * ratified 2026-08-16): there is no "remember to spread the host props" entry
 * point left for the next widget author, or for the next AI-written widget, to
 * miss.
 *
 * The widgets are registered raw rather than through `registerAllFields()`, whose
 * `React.lazy` loaders put an unbounded module load inside a bounded `findBy`
 * window — this repo's known flake generator (AGENTS.md 测试纪律, objectui#3010).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

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
import { TagsField } from '../widgets/TagsField';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { PasswordField } from '../widgets/PasswordField';
import { RichTextField } from '../widgets/RichTextField';
import { LookupField } from '../widgets/LookupField';
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
import { CodeField } from '../widgets/CodeField';
import { AvatarField } from '../widgets/AvatarField';
import { SignatureField } from '../widgets/SignatureField';
import { QRCodeField } from '../widgets/QRCodeField';

/**
 * Every registered widget that is NOT group-labelled — i.e. everything the
 * #3961 family left behind. `textarea` and `select` appear under their
 * `field:`-qualified keys because the bare spellings are `BUILTIN_FIELD_TYPES`
 * members: a bare `type: 'textarea'` never consults the registry and renders the
 * host's own control, which had no defect (measured: `consumers=1` either way).
 */
const WIDGETS: Record<string, any> = {
  text: TextField,
  'field:textarea': TextAreaField,
  number: NumberField,
  boolean: BooleanField,
  'field:select': SelectField,
  date: DateField,
  datetime: DateTimeField,
  time: TimeField,
  email: EmailField,
  phone: PhoneField,
  url: UrlField,
  tags: TagsField,
  currency: CurrencyField,
  percent: PercentField,
  password: PasswordField,
  markdown: RichTextField,
  html: RichTextField,
  richtext: RichTextField,
  lookup: LookupField,
  master_detail: LookupField,
  image: ImageField,
  location: LocationField,
  // The D group — no editable branch at all, the whole widget is the display.
  formula: FormulaField,
  summary: SummaryField,
  auto_number: AutoNumberField,
  vector: VectorField,
  user: UserField,
  owner: UserField,
  object: ObjectField,
  grid: GridField,
  color: ColorField,
  slider: SliderField,
  code: CodeField,
  avatar: AvatarField,
  signature: SignatureField,
  qrcode: QRCodeField,
};

/** A stored value per type, so the readonly branch renders its FILLED shape. */
const VALUES: Record<string, unknown> = {
  text: 'Hello',
  'field:textarea': 'Hello there',
  number: 42,
  boolean: true,
  'field:select': 'a',
  date: '2026-01-02',
  datetime: '2026-01-02T03:04:05Z',
  time: '03:04',
  email: 'user@example.com',
  phone: '+15551234567',
  url: 'https://example.com',
  tags: ['red', 'blue'],
  currency: 12.5,
  percent: 0.25,
  password: 'hunter2',
  markdown: '# Hi',
  html: '<p>Hi</p>',
  richtext: '<p>Hi</p>',
  lookup: 'rec_1',
  master_detail: 'rec_1',
  image: 'https://example.com/a.png',
  location: { lat: 1, lng: 2 },
  formula: 'computed',
  summary: 7,
  auto_number: 'A-0001',
  vector: [0.1, 0.2, 0.3, 0.4],
  user: 'u1',
  owner: 'u1',
  object: { a: 1 },
  grid: [{ a: 1 }],
  color: '#ff0000',
  slider: 5,
  code: 'const a = 1;',
  avatar: 'https://example.com/a.png',
  signature: 'data:image/png;base64,AAA',
  qrcode: 'https://example.com',
};

const TYPES = Object.keys(WIDGETS);

/** The four sampled shapes: anchor, plain text, toggle display, display-only. */
const SAMPLES = ['email', 'text', 'boolean', 'formula'] as const;

beforeAll(() => {
  for (const [type, Component] of Object.entries(WIDGETS)) {
    // No `labelling` key — these are the `'control'` widgets by omission, which
    // is exactly the population this issue is about.
    ComponentRegistry.register(type.replace(/^field:/, ''), Component as any, {
      namespace: 'field',
      skipFallback: true,
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

const fieldName = (type: string) => `f_${type.replace(':', '_')}`;
const fieldLabel = (type: string) => `Label ${type.replace(/^field:/, '')}`;

function fieldConfig(type: string, opts: { readonly?: boolean } = {}): Record<string, unknown> {
  const bare = type.replace(/^field:/, '');
  const config: any = {
    name: fieldName(type),
    label: fieldLabel(type),
    type,
    description: 'Some help',
  };
  if (bare === 'select' || bare === 'tags') config.options = [{ label: 'Alpha', value: 'a' }];
  // Field-level readonly — the state this issue is about.
  if (opts.readonly) config.readonly = true;
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

/**
 * Every element whose `aria-describedby` NAMES `id` — the `consumers=` column,
 * read from the DOM rather than through a query helper. Deliberately not
 * `toHaveAccessibleDescription`: the failure being pinned is a COUNT of zero
 * against a description element that renders perfectly well, and a name query
 * answers "no match" for both "nobody references it" and "the reference
 * resolves to nothing".
 */
function describedbyConsumers(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-describedby]')).filter((el) =>
    (el.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(id),
  );
}

describe('every readonly registered widget is named and described by its host (objectui#4788)', () => {
  it.each(TYPES)('%s: the host id is on a named group, and the label `for` is gone', (type) => {
    const name = fieldName(type);
    renderForm([fieldConfig(type, { readonly: true })], { [name]: VALUES[type] });

    // `hostIdEl=NONE` → the group. Read from the description id so the host id
    // is derived exactly as the probe derived it, not guessed.
    const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]');
    expect(descEl).not.toBeNull();
    const hostId = descEl!.id.replace(/-description$/, '');
    const host = byId(hostId);
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('role', 'group');
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
    expect(describedbyConsumers(descEl!.id)).toEqual([host]);
  });

  it.each(TYPES)('%s: the widget output the user reads sits INSIDE that group', (type) => {
    const name = fieldName(type);
    renderForm([fieldConfig(type, { readonly: true })], { [name]: VALUES[type] });

    const host = screen.getByRole('group');
    // The host wraps, it does not replace: whatever the widget rendered is still
    // there, and it is there INSIDE the named group rather than beside it.
    expect(host.firstElementChild).not.toBeNull();
    // And because the group names ITSELF as well as the label, that rendered
    // content is part of the accessible name — which is the assertion that
    // actually holds for every face. `textContent` does not: `image` and
    // `signature` render an `img` whose value is its `alt`, so their text is
    // empty while their name reads `Label image a.png` / `Label signature
    // Signature`. Measured, then corrected — the first spelling of this
    // assertion was red on exactly those two.
    expect(host).toHaveAccessibleName(new RegExp(`^${fieldLabel(type)} .+`));
    // And the group is the only one in the item — no nested second claim.
    expect(item(name).querySelectorAll('[role="group"]')).toHaveLength(1);
  });

  it.each(TYPES)('%s: no control-channel state rides along (objectui#4005 boundary)', (type) => {
    const name = fieldName(type);
    renderForm([fieldConfig(type, { readonly: true })], { [name]: VALUES[type] });

    const host = screen.getByRole('group');
    // `<FormControl>`'s Slot injects `aria-invalid` into whatever it wraps. A
    // readonly display cannot be edited and cannot be made invalid by the person
    // reading it, so the wrapper consumes the key and emits nothing.
    expect(host).not.toHaveAttribute('aria-invalid');
    expect(host).not.toHaveAttribute('aria-required');
  });
});

describe('the four sampled shapes read the way a user would hear them', () => {
  it('email (anchor face): the group carries label + value, the link keeps its own name', () => {
    const name = fieldName('email');
    renderForm([fieldConfig('email', { readonly: true })], { [name]: 'user@example.com' });

    // The composite name — this is the reading the ruling asked for: the value
    // must not vanish from the accessible name when the label takes it over.
    expect(screen.getByRole('group')).toHaveAccessibleName('Label email user@example.com');
    // The anchor is read as itself inside the group, with the field name NOT
    // duplicated onto it.
    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName('user@example.com');
    expect(link).toHaveAttribute('href', 'mailto:user@example.com');
    expect(link).not.toHaveAttribute('aria-labelledby');
  });

  it('text (plain-text face): the name is real, not the inert pair a role-less span gives', () => {
    const name = fieldName('text');
    renderForm([fieldConfig('text', { readonly: true })], { [name]: 'Hello' });

    const host = screen.getByRole('group', { name: 'Label text Hello' });
    // The role is what makes the name and the description land at all — the
    // controlled experiment in the measurement showed `aria-labelledby` on a
    // role-less span passing `toHaveAccessibleName` while naming nothing.
    expect(host.tagName.toLowerCase()).toBe('div');
    expect(host.querySelector('span')).not.toBeNull();
    expect(host).toHaveAccessibleDescription('Some help');
  });

  it('boolean: the readonly display of a toggle is named as a value, not a control', () => {
    const name = fieldName('boolean');
    renderForm([fieldConfig('boolean', { readonly: true })], { [name]: true });

    expect(screen.getByRole('group')).toHaveAccessibleName(/^Label boolean /);
    // No switch is left in the readonly branch, so nothing must claim to be one.
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('formula (D group): a widget with no editable branch is covered by the same wrapper', () => {
    const name = fieldName('formula');
    renderForm([fieldConfig('formula', { readonly: true })], { [name]: 'computed' });

    // `FormulaField` never reads `readonly` — the whole widget is a replacement
    // display. The host gate is `readonly` + a registered field widget, so the
    // D group is covered by construction rather than by a per-widget exception.
    expect(screen.getByRole('group')).toHaveAccessibleName('Label formula computed');
    expect(screen.getByRole('group')).toHaveAccessibleDescription('Some help');
  });
});

describe('the editable branch is untouched — its label still addresses a real control', () => {
  it.each(SAMPLES)('%s: no group, `for` resolves, description consumed by the control', (type) => {
    const name = fieldName(type);
    renderForm([fieldConfig(type)], { [name]: VALUES[type] });

    if (type === 'formula') {
      // The D group has no editable branch to keep: it renders the same
      // display-only span, which is why its editable row measured
      // `for=DANGLING hostIdEl=NONE consumers=0` too. objectui#4857 closed that
      // residual — deliberately, as this pin demanded — through a
      // `labelling: 'display'` DECLARATION, whose covered behaviour is pinned
      // in `display-grid-host-channels-e2e.test.tsx`. THIS file registers every
      // widget bare, declaration-less, so what this branch now pins is the
      // UNDECLARED fallback: a widget that skips the declaration falls to the
      // single-control path and its editable `for` dangles again — the silent
      // degradation the exhaustive `FIELD_WIDGET_LABELLING` record exists to
      // make impossible for this package's own registrations.
      expect(screen.queryByRole('group')).toBeNull();
      expect(hostLabel(name)).toHaveAttribute('for');
      expect(byId(hostLabel(name).getAttribute('for'))).toBeNull();
      return;
    }

    expect(screen.queryByRole('group')).toBeNull();
    const label = hostLabel(name);
    expect(label).not.toHaveAttribute('id');
    const target = byId(label.getAttribute('for'));
    expect(target).not.toBeNull();
    // A labelable element, so the plain `for` is a real association.
    expect(['input', 'textarea', 'select', 'button']).toContain(target!.tagName.toLowerCase());
    const descEl = item(name).querySelector<HTMLElement>('[id$="-form-item-description"]')!;
    expect(describedbyConsumers(descEl.id)).toEqual([target]);
  });
});
