/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GATE: every registered field widget must announce a validation failure to
 * assistive tech — `aria-invalid="true"` on some element inside its own form
 * row (objectui#3306, the paradigm of objectui#3291's leak sweep).
 *
 * ## Why a registry-wide sweep
 *
 * This failure class recurs per widget: objectui#3222 fixed seven widgets that
 * computed `aria-invalid` from a prop nobody produced; objectui#3290 fixed the
 * `aria-required` state channel; objectui#3306 fixed `select`, whose Radix
 * `Select.Root` — not being a DOM element — silently swallowed every `aria-*`
 * the form renderer delivered. Each was invisible until someone happened to
 * audit that one widget, because the per-widget tests only cover the widgets
 * someone already fixed. This sweep covers the REGISTRY, so the next widget
 * with a swallowed or missing `aria-invalid` fails here by name instead of
 * shipping.
 *
 * ## The ratchet, and its two ledgers
 *
 * The positive assertion requires the `aria-invalid="true"` carrier to be
 * FOCUSABLE (objectui#5223). A mark on a wrapper satisfies a row-wide query
 * while telling a keyboard or screen-reader user nothing, so without that
 * requirement the cheapest way to clear a ledger row also left the defect
 * alive and invisible to the next agent.
 *
 * Widgets listed in {@link NOT_YET_DELIVERED} are known not to deliver the
 * attribute today. They are asserted in the OPPOSITE direction — the sweep
 * proves they still do NOT deliver — so fixing one turns its entry red and
 * forces its removal from the ledger. The ledger can only shrink; a widget can
 * never silently regress INTO it, and a fix can never silently go unrecorded.
 *
 * {@link NOT_APPLICABLE} is the OTHER answer, and it is a different claim, not
 * a softer one (objectui#3318 triage). `aria-invalid` is control-channel state:
 * it reports what a user's own editing may do wrong, to the element they would
 * edit. A widget that renders no focusable control has no such element, and
 * marking its text span instead would be precisely the non-focusable-wrapper
 * move this sweep exists to forbid. Those types are not waiting for a delivery
 * that should happen; they are recorded as types where the attribute does not
 * apply, each with the reason in the ledger itself.
 *
 * That second ledger is only safe because a reclassification is FALSIFIABLE.
 * Three structures make "move the row instead of doing the work" fail loudly:
 *
 *  1. `DELIVERING` is DERIVED (`ALL_TYPES` minus both ledgers), so the three
 *     sets partition the registry by construction. Deleting a row from both
 *     ledgers does not retire it — it lands in the positive sweep, which is the
 *     strictest assertion of the three.
 *  2. Every `NOT_APPLICABLE` row carries its own GUARD: the sweep measures that
 *     the widget's row really does offer no focusable control. `grid` cannot be
 *     moved there to tidy the ledger — it renders a button, so the guard goes
 *     red. The same guard is what fails the day someone gives one of these
 *     widgets a real control and leaves the row behind.
 *  3. The two ledgers are asserted DISJOINT and to name only real types, so a
 *     row cannot be double-booked or left pointing at a widget that is gone.
 *
 * `NOT_YET_DELIVERED` is now EMPTY (objectui#3318 closed the last row, `grid`),
 * and a case below asserts it stays that way. This file remains the source of
 * truth for the registry's state: 45 types, every one of them either delivering
 * on a focusable control or carrying a measured NOT_APPLICABLE verdict.
 *
 * ## Discipline inherited from the #3291 sweep
 *
 * - **An error variant that produces no error tests nothing** — every case
 *   asserts the "is required" message rendered before it reads any aria. The
 *   `required` check is a PRESENCE check (`null` is missing, `false`/`0` are
 *   values — cloud#972), so `null` drives a real failure for every type.
 * - **Popovers are not opened** (happy-dom lacks the pointer-capture APIs
 *   Radix needs); the inline control every widget renders is the surface under
 *   test, which is exactly where `aria-invalid` must sit.
 * - Widgets are registered from STATIC imports wrapped in `withFieldCarrier`
 *   (the real registration seam, objectui#3233), never `registerAllFields()`,
 *   whose `React.lazy` loaders are this repo's known flake generator
 *   (AGENTS.md 测试纪律 / objectui#3010).
 */

import type { ComponentType } from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

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

/** Same widget map as the #3291 sweep, so the parity check covers the registry. */
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
  // tombstone that replaced it is not a field widget and renders no control, so
  // it has no `aria-invalid` surface to scan.
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

/**
 * THE RATCHET LEDGER — widget types MEASURED (by this very sweep, run with an
 * empty ledger) not to put `aria-invalid` on any element of their row after a
 * real validation failure, and which SHOULD. Every entry is a known
 * accessibility gap tracked in objectui#3318, not an accepted state: the field
 * shows its red message while assistive tech is told nothing.
 *
 * ## THE LEDGER IS EMPTY — 29 -> 20 -> 9 -> 1 -> 0
 *
 * Every registered widget now either delivers `aria-invalid` on a focusable
 * control or carries a measured {@link NOT_APPLICABLE} verdict. The history,
 * so the zero is readable as an achievement rather than an oversight:
 *
 *  - objectui#3345 cleared 20 with the objectui#3222/#3306 spread pattern;
 *  - objectui#4933 cleared `slider` and reclassified seven (NOT_APPLICABLE);
 *  - objectui#3318's final pass cleared `grid`, the one that needed a DESIGN
 *    rather than a spread. It is a composite line-item editor that reports
 *    validity per CELL, so a FORM-level failure had no obvious target (which
 *    cell? the add-row button?). The adopted answer drives the widget's own
 *    per-cell channel from the host's `error` slot: a required grid that fails
 *    while EMPTY now flags the ghost entry row's required cells, marking each
 *    cell's own input. It was never a `NOT_APPLICABLE` candidate — its row DOES
 *    offer a focusable control, which is what that ledger's guard measures.
 *
 * The set stays here, empty, because it is the RATCHET and not a to-do list:
 * emptiness is asserted below, so the next widget that cannot deliver has to
 * face that choice in review instead of quietly acquiring a ledger row.
 *
 * Do NOT add to this list to make a new widget pass; fix the widget (the
 * objectui#3222/#3306 pattern: spread `toDomProps(props)` onto the real
 * focusable control — never a non-DOM Radix Root, never a wrapper — then
 * `aria-invalid={!!error}` after the spread). An entry is removed by fixing the
 * widget: the sweep asserts each entry still fails to deliver, so a fixed
 * widget turns its own ledger row red until it is removed here. The ledger only
 * shrinks.
 */
const NOT_YET_DELIVERED: ReadonlySet<string> = new Set<string>([]);

/**
 * THE SECOND LEDGER — widget types for which `aria-invalid` is not a delivery
 * that is owed, because there is no element that could carry it: the row
 * renders NO focusable control at all (objectui#3318's triage).
 *
 * This is a semantic verdict, so every row states its ground, and the sweep
 * then MEASURES that ground rather than trusting it — see the "no focusable
 * control" case below. A row whose widget grows a real control goes red here
 * and has to move to {@link NOT_YET_DELIVERED} or be delivered outright; a row
 * moved here to escape the first ledger goes red on arrival.
 *
 * Reachability note, because the two ledgers are graded differently: the first
 * ledger judges a VALUE (does the attribute arrive?) and its rows must reach a
 * real rendered control. These rows judge the opposite fact — that no such
 * control exists — so the assertion is about what the row does NOT contain, in
 * the exact state this sweep renders (fresh, empty, required, just failed).
 *
 * That state is named deliberately rather than as a hedge, and it is the whole
 * of what these rows claim. The four read-only types render their EMPTY-value
 * branch here (an `EmptyValue` placeholder, not the formatted-value span), and
 * `signature`'s Clear button becomes focusable only once something has been
 * drawn. Both are the right state to judge: `required` is a PRESENCE check, so
 * the moment the attribute would have to be announced is exactly the moment the
 * value is missing. A row saying "no control, therefore nothing to mark" is
 * saying it about that moment — verified there, and claiming nothing about a
 * filled field, which is not the one failing.
 */
const NOT_APPLICABLE: ReadonlyMap<string, string> = new Map([
  [
    'formula',
    'Read-only computed display: renders the backend-computed value as text, no control.',
  ],
  [
    'summary',
    'Read-only aggregation display: renders the rolled-up value as text, no control.',
  ],
  [
    'auto_number',
    'Read-only system-generated display: renders the assigned number as text, no control.',
  ],
  [
    'vector',
    'Read-only embedding preview: renders a truncated numeric preview as text, no control.',
  ],
  [
    'signature',
    'Drawing surface is a <canvas> with no keyboard path; the one other element, Clear, is disabled while empty. Its LABEL is a separate half and IS delivered — see FIELD_WIDGET_LABELLING.',
  ],
  [
    'filter-condition',
    'Dependency-gated: with no sibling object_name chosen — the state a fresh form renders — it shows a hint paragraph and no control. Its editable state delivers.',
  ],
  [
    'recipient-picker',
    'Dependency-gated: with no sibling recipient_type chosen — the state a fresh form renders — it shows a hint paragraph and no control. Its editable state delivers.',
  ],
]);

/**
 * HTML's own focusability rules, as a selector: the elements a keyboard user
 * can land on and therefore the only ones assistive technology would read a
 * control state from. `:not([disabled])` matters — a disabled button is not in
 * the tab order, which is why `signature`'s Clear button does not count while
 * the pad is empty.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** Option widgets render an "unfillable" placeholder unless offered a list. */
const OPTION_TYPES = new Set(['select', 'multiselect', 'radio', 'checkboxes', 'tags']);
const OPTIONS = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
];

/**
 * `grid` is the same shape of dependency as the option widgets above, and it
 * was measured, not assumed (objectui#3318). A grid with no `columns` renders
 * an empty table: MEASURED on `origin/main` at `bd977f86f`, its whole row after
 * a real failure is
 *
 * ```
 * bare grid          focusables=[button]                       inputs=0
 * grid with columns  focusables=[input(Item), input(Qty), button]  inputs=2
 * ```
 *
 * — the lone focusable in the bare state is the auxiliary "Add line" BUTTON,
 * whose action is not what is invalid and which objectui#4857 already refused
 * to route field identity onto. So the bare state has no control to mark, and
 * asserting delivery there would only ever be satisfiable by the one carrier
 * this sweep forbids.
 *
 * Giving it columns renders the widget's REAL editing surface, which is what
 * every realistic config is (the widget's own header: "Every realistic config
 * is a composite: many cell inputs, each with its own `aria-label`"). This
 * makes the assertion stricter, not looser — the sweep now has to find the
 * mark on a genuine cell control.
 */
const GRID_COLUMNS = [
  { name: 'item', label: 'Item', required: true },
  { name: 'qty', label: 'Qty', type: 'number', required: true },
];

/** `null` is MISSING for the presence-check `required` (cloud#972). */
const MISSING_VALUE = null;

function fieldConfig(type: string) {
  return {
    name: 'f',
    label: 'F',
    type: `field:${type}`,
    required: true,
    ...(OPTION_TYPES.has(type) ? { options: OPTIONS } : {}),
    ...(type === 'grid' ? { columns: GRID_COLUMNS } : {}),
  };
}

function renderForm(field: Record<string, unknown>) {
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
        fields: [field],
        onSubmit: () => {},
      }}
    />,
  );
}

async function formRow(): Promise<Element> {
  return waitFor(() => {
    const row = document.querySelector('[data-field="f"]');
    if (!row) throw new Error('field row never rendered');
    return row;
  });
}

/**
 * Drive a REAL validation failure and prove it rendered before reading aria:
 * submit, then wait for the "is required" message inside the row.
 */
async function failValidation(): Promise<Element> {
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await waitFor(() => {
    expect(document.querySelector('[data-field="f"]')?.textContent ?? '').toContain(
      'is required',
    );
  });
  return formRow();
}

beforeAll(() => {
  for (const [type, Widget] of Object.entries(WIDGETS)) {
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

const ALL_TYPES = Object.keys(WIDGETS);
// DERIVED, never listed: a type is swept positively unless a ledger claims it.
// This is what makes "quietly retire a row" impossible — dropping a row from
// both ledgers promotes the widget into the strictest assertion of the three,
// it does not excuse it.
const DELIVERING = ALL_TYPES.filter(
  (type) => !NOT_YET_DELIVERED.has(type) && !NOT_APPLICABLE.has(type),
);
const LEDGERED = ALL_TYPES.filter((type) => NOT_YET_DELIVERED.has(type));
const INAPPLICABLE = ALL_TYPES.filter((type) => NOT_APPLICABLE.has(type));

describe('every registered field widget announces a failed validation (objectui#3306)', () => {
  it('covers every field type the form can render', () => {
    expect(Object.keys(WIDGETS).sort()).toEqual([...FORM_FIELD_TYPES].sort());
  });

  it('the NOT_YET_DELIVERED ledger is empty and stays empty', () => {
    // The ratchet's terminal state, made mechanical (objectui#3318). The
    // header has always said "do NOT add to this list to make a new widget
    // pass", but that was prose: a new widget could acquire a ledger row and
    // the sweep would happily assert it still fails, which reads in review as
    // a considered decision rather than an unfixed gap.
    //
    // Reaching zero is what makes enforcing it possible, so it is enforced
    // here. If you are reading this because your new widget turned it red:
    // deliver `aria-invalid` on the widget's focusable control (the
    // objectui#3222/#3306 pattern), or — if it genuinely renders no control —
    // put it in NOT_APPLICABLE, whose guard will MEASURE that claim. Editing
    // this assertion is the third road, and it is deliberately a visible,
    // reviewable act rather than a quiet one.
    expect([...NOT_YET_DELIVERED]).toEqual([]);
  });

  it('both ledgers only name types that exist', () => {
    // A renamed/removed widget must not leave a stale ledger entry that would
    // silently assert against nothing.
    const stale = [...NOT_YET_DELIVERED, ...NOT_APPLICABLE.keys()].filter(
      (type) => !(type in WIDGETS),
    );
    expect(stale).toEqual([]);
  });

  it('the two ledgers are mutually exclusive', () => {
    // A type in both would be claimed as owed AND as not owed at once, and
    // whichever case ran second would look like it had been considered.
    const both = [...NOT_YET_DELIVERED].filter((type) => NOT_APPLICABLE.has(type));
    expect(both).toEqual([]);
  });

  it('the three cases partition the registry — no type is swept twice or not at all', () => {
    // Mechanical given the derivation above, and asserted anyway because it is
    // the property every other case in this file leans on. Note what it does
    // NOT catch, so nobody reads more into a green here than is there: deleting
    // a row from both ledgers keeps this partition valid (the type simply moves
    // into DELIVERING) and is caught one case down, by the positive sweep.
    expect([...DELIVERING, ...LEDGERED, ...INAPPLICABLE].sort()).toEqual([...ALL_TYPES].sort());
  });

  it('every NOT_APPLICABLE row states its ground', () => {
    // The row is a claim about the widget's markup; an unexplained one cannot
    // be reviewed, and "it was already in the list" is how a wrong verdict
    // outlives the reasoning that produced it.
    const unexplained = [...NOT_APPLICABLE.entries()]
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([type]) => type);
    expect(unexplained).toEqual([]);
  });

  it.each(DELIVERING)(
    'field:%s — carries aria-invalid on a FOCUSABLE control in its row after a real failure',
    async (type) => {
      renderForm(fieldConfig(type));
      const row = await formRow();

      // No premature alarm: a widget must not claim invalid before validation
      // ran. (`aria-invalid="false"` is fine and expected — asserting on the
      // "true" value keeps this half meaningful for widgets that stay silent
      // until they fail.)
      expect(row.querySelector('[aria-invalid="true"]')).toBeNull();

      const after = await failValidation();
      const carriers = Array.from(after.querySelectorAll('[aria-invalid="true"]'));

      expect(
        carriers.length,
        `field:${type} rendered its "is required" message but no element in its row carries aria-invalid="true" — assistive tech is never told the field failed`,
      ).toBeGreaterThan(0);

      // THE WRAPPER-MARK HOLE, closed (objectui#5223). Until this half existed,
      // the assertion above was a query over the WHOLE ROW, so a mark on a
      // non-focusable wrapper — a `div`, a `td`, a text span — passed as
      // "delivered" while the control the user actually edits still announced
      // nothing. That is not a hypothetical: it is the cheapest way to turn a
      // ledger row green, it reads clean in review, and nothing else in this
      // file would have caught it (the wrapper check guards NOT_APPLICABLE rows
      // only). `aria-invalid` is control-channel state; assistive tech reads it
      // from the element a keyboard user can land on, so that is where it must
      // sit.
      const describeEl = (el: Element) => {
        const role = el.getAttribute('role');
        return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''}`;
      };
      expect(
        carriers.filter((el) => el.matches(FOCUSABLE)).map(describeEl),
        `field:${type} carries aria-invalid ONLY on non-focusable element(s) [${carriers
          .map(describeEl)
          .join(', ')}] — a wrapper mark (objectui#5223). It satisfies a row-wide query while the control the user edits announces nothing. Put the state on the focusable control itself.`,
      ).not.toEqual([]);
    },
  );

  it.each(LEDGERED)(
    'field:%s — KNOWN GAP: still does not deliver aria-invalid (fix it, then remove it from NOT_YET_DELIVERED)',
    async (type) => {
      renderForm(fieldConfig(type));
      await formRow();

      const after = await failValidation();
      // The ratchet: the day this widget starts delivering, this assertion
      // fails and the entry MUST be removed from the ledger above.
      expect(
        after.querySelector('[aria-invalid="true"]'),
        `field:${type} now delivers aria-invalid — remove it from NOT_YET_DELIVERED so the sweep guards it forward`,
      ).toBeNull();
    },
  );

  it.each(INAPPLICABLE)(
    'field:%s — NOT APPLICABLE: renders no focusable control, so there is nothing to mark',
    async (type) => {
      renderForm(fieldConfig(type));
      await formRow();

      const after = await failValidation();

      // The GROUND of the verdict, measured rather than asserted in prose. Two
      // separate futures turn this red, and both should:
      //  - the widget gains a real control (an editable formula, a keyboard
      //    path on the signature canvas, a gated picker that renders its input
      //    up front) — the row now owes a delivery and must leave this ledger;
      //  - someone parks a row here to empty NOT_YET_DELIVERED. `grid` is the
      //    live specimen: it renders a button, so it fails on arrival.
      const focusable = Array.from(after.querySelectorAll(FOCUSABLE));
      expect(
        focusable.map((el) => el.tagName.toLowerCase()),
        `field:${type} is on the NOT_APPLICABLE ledger ("${NOT_APPLICABLE.get(type)}") but its row now offers a focusable control — the verdict has expired, move the row`,
      ).toEqual([]);

      // And the line this whole sweep draws: no control means the state does
      // not go on a wrapper instead. A widget must not buy a green DELIVERING
      // row by marking a text span.
      expect(
        after.querySelector('[aria-invalid="true"]'),
        `field:${type} carries aria-invalid on a row with no focusable control — that marks a wrapper, which is the move this sweep forbids`,
      ).toBeNull();
    },
  );
});
