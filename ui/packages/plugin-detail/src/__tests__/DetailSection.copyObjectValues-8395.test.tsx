/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What `DetailSection`'s click-to-copy WRITES, per field kind (objectui#8395).
 *
 * ## The defect
 *
 * `handleCopyField` built its payload with `String(value)`, and `String()` of an
 * object is the literal text `[object Object]`. The affordance is offered for
 * every non-empty value (`canCopy` is `hasCellValue`, objectui#8376) — objects
 * included — so a reader clicking the copy button, the row, or pressing Enter on
 * an address, geolocation, JSON, file, expanded-lookup, repeater or image cell
 * got a placeholder on the clipboard **while the cell beside the button rendered
 * that same value correctly**. Nothing errors; it is noticed only on paste.
 *
 * ## What this file pins — BOTH halves
 *
 * 1. **The fix.** Every object-valued kind copies parseable JSON of the STORED
 *    value. Each such case also asserts the cell RENDERED its value, because
 *    "the payload is not `[object Object]`" is satisfied by a cell that rendered
 *    nothing and copied nothing — an implementation strictly worse than the bug.
 *    Nothing here asserts a negation; every row asserts its exact payload.
 * 2. ⭐ **The non-regression.** The scalar kinds that were already correct stay
 *    BYTE-IDENTICAL, and each of those cases asserts the rendered text too, so
 *    the pin is red for any future "just copy what the cell renders" rewrite.
 *    That shape was measured and rejected on this card: it is the worse contract
 *    for 9 of 17 field types (`date` renders `Mar 4` — the year is gone;
 *    `percent` renders `12%` against a stored `0.123`; `image` and `boolean`
 *    render no text at all, so they would copy the empty string).
 *
 * ## The contract status of the JSON blob
 *
 * A JSON blob is a DEFENSIBLE DEFAULT, not a settled contract — see the read
 * site's docblock. The per-kind contract (a formatted postal address, `lat,
 * lng`, a filename …) is objectui#8395's option B, a separate card. These cases
 * pin today's answer so a future option-B change is a deliberate edit here.
 *
 * ## Instruments
 *
 * - What is observed is the ARGUMENT to `navigator.clipboard.writeText`, spied
 *   through `Object.defineProperty(navigator, 'clipboard', …)` — the pattern
 *   `app-shell/src/console/organizations/__tests__/acceptInvitationLink.mount.test.tsx`
 *   already uses. There is no `execCommand` fallback on this path.
 * - ⚠️ The clickable row is found by `[role="button"]`, NEVER by
 *   `querySelector('button')`: `BooleanCellRenderer` renders a Radix Checkbox,
 *   which IS a `button` element, so that selector matches the checkbox instead
 *   of the copy button and the click copies nothing. Pinned below.
 * - `window.innerWidth` is 1280: `DetailSection` has mobile and desktop row
 *   shapes and an `isMobile` auto-hide threshold.
 * - Presence is read through `queryByText` into `expect(value, message)`, never
 *   `getByText`, so a missing row fails with the reason rather than with
 *   `TestingLibraryElementError` before `expect` runs.
 *
 * ## Deliberately NOT pinned here
 *
 * The `password` / `secret` branch of this same handler — copy writes the raw
 * secret while the cell renders the mask — is objectui#8440, in the maintainer's
 * decision box. This card leaves that path exactly as it found it, and asserts
 * nothing about it, so whichever way #8440 is answered no case here turns red.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

let writeText: ReturnType<typeof vi.fn>;

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(cleanup);

const objectSchema = {
  fields: {
    // — object-valued kinds: the defect —
    billing_address: { type: 'address', label: 'Billing Address' },
    office_location: { type: 'location', label: 'Office Location' },
    payload: { type: 'json', label: 'Payload' },
    contract: { type: 'file', label: 'Contract' },
    owner_ref: { type: 'lookup', label: 'Owner', reference: 'account' },
    attachments: { type: 'file', label: 'Attachments', multiple: true },
    line_items: { type: 'repeater', label: 'Line Items' },
    logo: { type: 'image', label: 'Logo' },
    tags: {
      type: 'multiselect',
      label: 'Tags',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ],
    },
    // — scalar kinds: already correct, must not move —
    amount: { type: 'number', label: 'Amount', scale: 2 },
    price: { type: 'currency', label: 'Price' },
    ratio: { type: 'percent', label: 'Ratio' },
    due: { type: 'date', label: 'Due' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [{ value: 'won', label: 'Closed Won' }],
    },
    name: { type: 'text', label: 'Name' },
    active: { type: 'boolean', label: 'Active' },
  },
};

/**
 * Stored values. The geolocation carries MORE precision than the cell displays
 * (the cell rounds to 4 decimals) so the payload assertions below cannot be
 * satisfied by re-deriving the payload from the rendered text.
 */
const DATA: Record<string, unknown> = {
  billing_address: {
    // `postalCode`, the spec spelling (objectstack#5143). `formatAddress` reads
    // that key and the legacy `zipCode` only, so an off-spec `postal_code`
    // would be dropped from the RENDERED line while still riding along in the
    // JSON payload — which would make the control below weaker than it looks.
    street: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62704',
    country: 'USA',
  },
  office_location: { latitude: 30.2741567, longitude: 120.1551234 },
  payload: { a: 1, b: ['x', 'y'] },
  contract: { name: 'contract.pdf', url: 'https://cdn.example.com/contract.pdf' },
  owner_ref: { id: 'acct-1', name: 'Acme Corp' },
  attachments: [{ name: 'a.pdf' }, { name: 'b.pdf' }],
  line_items: [{ label: 'one' }, { label: 'two' }],
  logo: { name: 'logo.png', url: 'https://cdn.example.com/logo.png' },
  tags: ['alpha', 'beta'],
  amount: 16,
  price: 1234.5,
  ratio: 0.123,
  due: '2026-03-04',
  stage: 'won',
  name: 'Plain String Value',
  active: true,
};

/**
 * The row LABEL is the section field's own `label` (`field.label || field.name`
 * at the render site), so it is spelled here rather than inherited from
 * `objectSchema` — which supplies the TYPE and the options, not the label.
 */
const section = {
  title: 'Details',
  fields: Object.entries(objectSchema.fields).map(([name, def]) => ({
    name,
    label: (def as { label: string }).label,
  })),
} as DetailViewSection;

const renderAll = () =>
  render(<DetailSection section={section} data={DATA} objectSchema={objectSchema} />);

/**
 * The clickable row for a field, located by its LABEL and taken by
 * `[role="button"]` — see the docblock on why not `querySelector('button')`.
 */
const rowOf = (label: string): HTMLElement => {
  const labelEl = screen.queryByText(label);
  expect(labelEl, `CONTROL: a row labelled "${label}" is on screen`).not.toBeNull();
  const row = (labelEl as HTMLElement).parentElement!.querySelector('[role="button"]');
  expect(row, `the "${label}" row offers the copy affordance`).not.toBeNull();
  return row as HTMLElement;
};

/** Click the row and return the exact argument handed to `writeText`. */
const copyFrom = (label: string): unknown => {
  writeText.mockClear();
  fireEvent.click(rowOf(label));
  expect(
    writeText.mock.calls.length,
    `clicking the "${label}" row wrote to the clipboard exactly once`,
  ).toBe(1);
  return writeText.mock.calls[0][0];
};

describe('DetailSection copy payloads — object cells copy JSON, scalars are unchanged (#8395)', () => {
  /**
   * The seven object-valued kinds whose cell renders TEXT. `rendered` is the
   * control: it proves the cell drew the value, so no row here can pass on a
   * cell that rendered nothing.
   */
  const OBJECT_KINDS = [
    {
      label: 'Billing Address',
      rendered: '1 Main St, Springfield, IL 62704, USA',
      clipboard:
        '{"street":"1 Main St","city":"Springfield","state":"IL","postalCode":"62704","country":"USA"}',
    },
    {
      label: 'Office Location',
      rendered: '30.2742, 120.1551',
      clipboard: '{"latitude":30.2741567,"longitude":120.1551234}',
    },
    {
      label: 'Payload',
      rendered: '{"a":1,"b":["x","y"]}',
      clipboard: '{"a":1,"b":["x","y"]}',
    },
    {
      label: 'Contract',
      rendered: 'contract.pdf',
      clipboard: '{"name":"contract.pdf","url":"https://cdn.example.com/contract.pdf"}',
    },
    {
      label: 'Owner',
      rendered: 'Acme Corp',
      clipboard: '{"id":"acct-1","name":"Acme Corp"}',
    },
    {
      // ⚠️ `rendered` UPDATED by objectui#9161: this cell used to draw the COUNT
      // `2 files` and nothing else, which is the defect that card fixed — a
      // read-only `file` field named no attachment and offered no way to open
      // one. It now draws one affordance per file, so the CONTROL reads the two
      // names. ⭐ The clipboard payload — this file's actual subject — is
      // untouched: it copies the STORED value, which is exactly why "copy the
      // rendered text" is not the contract here.
      label: 'Attachments',
      rendered: 'a.pdfb.pdf',
      clipboard: '[{"name":"a.pdf"},{"name":"b.pdf"}]',
    },
    {
      // The repeater cell prints a COUNT. Only the count is asserted: the label
      // beside it is a hardcoded Chinese string (objectui#8441), and pinning
      // that spelling here would turn this file red when #8441 fixes it.
      label: 'Line Items',
      rendered: '2',
      clipboard: '[{"label":"one"},{"label":"two"}]',
    },
  ];

  it.each(OBJECT_KINDS)(
    'OBJECT — $label copies parseable JSON of the stored value, not `[object Object]`',
    ({ label, rendered, clipboard }) => {
      renderAll();
      const row = rowOf(label);

      // CONTROL — the cell drew the value. Without this, the payload assertion
      // below would also pass for a cell that rendered and copied nothing.
      expect(
        row.textContent,
        `CONTROL: the "${label}" cell rendered its value`,
      ).toContain(rendered);

      expect(copyFrom(label), `"${label}" copies the stored value as JSON`).toBe(clipboard);
      // Parseability is the property the JSON default was chosen for, so it is
      // asserted rather than implied by the string above.
      expect(() => JSON.parse(clipboard), `"${label}"'s payload parses`).not.toThrow();
    },
  );

  it('OBJECT — an image cell copies its JSON even though it renders no text', () => {
    // The image cell renders an <img>, so its `textContent` is ''. Its control
    // is therefore the element, not text — and it is exactly the row that would
    // copy the EMPTY STRING under a "copy the rendered text" rewrite.
    renderAll();
    const row = rowOf('Logo');

    expect(
      row.querySelector('img'),
      'CONTROL: the "Logo" cell rendered an <img> for its value',
    ).not.toBeNull();
    expect(row.textContent, 'the "Logo" cell renders no text at all').toBe('');

    expect(copyFrom('Logo'), '"Logo" copies the stored file object as JSON').toBe(
      '{"name":"logo.png","url":"https://cdn.example.com/logo.png"}',
    );
  });

  it('OBJECT — a multiselect copies its stored values as a JSON array', () => {
    // ⚠️ DECLARED MOVE. An array is an object, so this payload changes from
    // `alpha,beta` (`String(['alpha','beta'])`) to a JSON array. It is the one
    // kind whose payload moves without having been `[object Object]` today: the
    // new form is lossless where the old one was ambiguous for any value
    // containing a comma. The LABELS ("Alpha", "Beta") are deliberately NOT what
    // is copied — the stored values are.
    renderAll();
    const row = rowOf('Tags');

    expect(row.textContent, 'CONTROL: the "Tags" cell rendered its option badges').toBe(
      'AlphaBeta',
    );
    expect(copyFrom('Tags'), '"Tags" copies the stored values, not the labels').toBe(
      '["alpha","beta"]',
    );
  });

  /**
   * ⭐ The non-regression half. `rendered` here is what the reader SEES and
   * `clipboard` is what they GET — the two differ on purpose for four of these
   * five rows, which is why "copy the rendered text" is not the contract.
   */
  const UNCHANGED_SCALARS = [
    { label: 'Amount', rendered: '16.00', clipboard: '16' },
    { label: 'Price', rendered: '1,234.50', clipboard: '1234.5' },
    { label: 'Ratio', rendered: '12%', clipboard: '0.123' },
    { label: 'Due', rendered: 'Mar 4', clipboard: '2026-03-04' },
    { label: 'Stage', rendered: 'Closed Won', clipboard: 'won' },
    { label: 'Name', rendered: 'Plain String Value', clipboard: 'Plain String Value' },
  ];

  it.each(UNCHANGED_SCALARS)(
    'SCALAR — $label still copies its stored value byte-for-byte',
    ({ label, rendered, clipboard }) => {
      renderAll();
      const row = rowOf(label);

      expect(
        row.textContent,
        `CONTROL: the "${label}" cell rendered its value as ${rendered}`,
      ).toContain(rendered);

      expect(copyFrom(label), `"${label}" copies the STORED value, not the rendered one`).toBe(
        clipboard,
      );
    },
  );

  it('SCALAR — a boolean copies `true`, and the copy target is not the row\'s first button', () => {
    // ⚠️ The instrument pin. `BooleanCellRenderer` renders a Radix Checkbox,
    // which IS a `button`, so `querySelector('button')` in this row returns the
    // checkbox and clicking it copies nothing. Anyone writing a copy test for
    // this surface must click `[role="button"]`, as `rowOf` does.
    renderAll();
    const row = rowOf('Active');

    const firstButton = row.querySelector('button');
    expect(firstButton, 'CONTROL: the boolean row does contain a `button` element').not.toBeNull();
    expect(
      firstButton!.getAttribute('role'),
      'that first `button` is the checkbox, NOT the copy button',
    ).toBe('checkbox');

    expect(copyFrom('Active'), 'the boolean row copies its stored value').toBe('true');
  });

  it('a value JSON cannot represent keeps its string form instead of throwing', () => {
    // NOT a payload contract — the guard `JsonCellRenderer` applies to the same
    // operation on the same value. A cycle cannot be serialized; retaining
    // today's `[object Object]` for it keeps the click handler from throwing,
    // and it is the ONLY input for which that text is still written.
    const cyclic: Record<string, unknown> = { self: null };
    cyclic.self = cyclic;

    render(
      <DetailSection
        section={
          { title: 'Details', fields: [{ name: 'payload', label: 'Payload' }] } as DetailViewSection
        }
        data={{ payload: cyclic }}
        objectSchema={objectSchema}
      />,
    );

    expect(() => copyFrom('Payload'), 'clicking must not throw out of the handler').not.toThrow();
    expect(writeText.mock.calls[0][0], 'an unserializable value keeps its string form').toBe(
      '[object Object]',
    );
  });
});
