/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Postal-code round trip of the composite `address` widget (objectstack#5143).
 *
 * The widget used to read and write the part name `zipCode`. The platform
 * stores — and `/api/v1/data/**` serves back — `postalCode`, the name
 * `@objectstack/spec`'s `AddressValueSchema` declares. The two never met:
 *
 *  - opening a stored address showed an EMPTY ZIP box (the stored
 *    `postalCode` had no input reading it), and
 *  - anything typed into that box was written back as `zipCode`, which the
 *    enforced value schema strips (`$strip`) — destroying it at the contract
 *    boundary: lost outright on a new record, and on an existing one silently
 *    discarded while the stale stored code survived.
 *
 * Four of five parts round-tripped, which is what made it survive review.
 *
 * These tests pin BOTH directions, plus the read-time compatibility limb for
 * data the broken build already wrote:
 *
 *  1. stored `postalCode` reaches the ZIP input;
 *  2. every edit writes the postal code back under `postalCode` and never
 *     under `zipCode` — verified against `AddressValueSchema.parse`, i.e. the
 *     platform's own contract, not a local restatement of it;
 *  3. a legacy `zipCode`-shaped value still DISPLAYS, and the first edit of
 *     any part migrates it onto `postalCode` instead of writing the split
 *     shape back out.
 *
 * Reverse verification (measured, not presumed — `git show origin/main` of the
 * widget, this file unchanged): 9 of 12 go red — 1, 2, 5, 6, 7, 8, 9, 10, 12.
 * The three that stay GREEN are worth naming, because one of them refines the
 * issue's stated mechanism:
 *
 *  - 3 stays green. The old widget spread the WHOLE stored object through on
 *    every write (`{...address, [part]: v}`), so an untouched `postalCode`
 *    survived an edit of an unrelated part. The issue's "saving drops the
 *    postal code" therefore does NOT reproduce for a value nobody touched;
 *    the loss the old code really caused is test 6's: a postal code the user
 *    TYPES is written under a key `AddressValueSchema` strips, so the typed
 *    correction is silently discarded and the stale stored code stays — and on
 *    a new record (test 12) it is lost outright. 3 is kept as a contract pin
 *    for the pass-through, not as evidence of the fix.
 *  - 4 stays green: it pins the legacy READ, and the old code read that key
 *    natively. It is meaningful as a pair with 5, which no revert satisfies.
 *  - 11 stays green: it reads the spec, not the widget. That is the point —
 *    it fails only if the CONTRACT moves under us.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddressValueSchema } from '@objectstack/spec/data';
import { AddressField, type AddressValue } from './AddressField';

const field = { name: 'billing_address', type: 'address' } as any;

const ZIP_LABEL = 'ZIP / Postal Code';

/** The document the REST API served back in the issue's evidence. */
const STORED: AddressValue = {
  street: '中策路 1 号',
  city: '杭州',
  state: '浙江',
  postalCode: '310018',
  country: 'CN',
};

/** The same address as written by builds up to 17.0.0-rc.1 (the broken key). */
const LEGACY = {
  street: '中策路 1 号',
  city: '杭州',
  state: '浙江',
  zipCode: '310018',
  country: 'CN',
} as AddressValue;

/** Resolve a sub-input exactly as a browser does on label activation. */
function subInput(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const forId = label.getAttribute('for');
  expect(forId, `label "${labelText}" must carry htmlFor`).toBeTruthy();
  const control = document.getElementById(forId!);
  expect(control, `htmlFor of "${labelText}" must resolve`).not.toBeNull();
  return control as HTMLInputElement;
}

/** The most recent object the widget handed to `onChange`. */
function lastWrite(written: AddressValue[]): AddressValue {
  expect(written.length, 'the widget must have written at least once').toBeGreaterThan(0);
  return written[written.length - 1];
}

/**
 * Controlled harness — the widget is controlled, so a round trip needs a
 * parent that stores what the widget writes and feeds it straight back.
 */
function Harness({ initial, onWrite }: { initial: AddressValue; onWrite: (v: AddressValue) => void }) {
  const [value, setValue] = React.useState<AddressValue>(initial);
  return (
    <AddressField
      value={value}
      onChange={(next) => {
        onWrite(next);
        setValue(next);
      }}
      field={field}
    />
  );
}

describe('AddressField — postal code round trip (objectstack#5143)', () => {
  it('1. loads the stored `postalCode` into the ZIP input', () => {
    render(<AddressField value={STORED} onChange={vi.fn()} field={field} />);

    expect(subInput(ZIP_LABEL).value).toBe('310018');
    // The four parts that always worked must keep working.
    expect(subInput('Street Address').value).toBe('中策路 1 号');
    expect(subInput('City').value).toBe('杭州');
    expect(subInput('State / Province').value).toBe('浙江');
    expect(subInput('Country').value).toBe('CN');
  });

  it('2. keeps the postal code when an UNRELATED part is edited, under `postalCode`', () => {
    const written: AddressValue[] = [];
    render(<Harness initial={STORED} onWrite={(v) => written.push(v)} />);

    fireEvent.change(subInput('City'), { target: { value: '宁波' } });

    const last = lastWrite(written);
    expect(last.city).toBe('宁波');
    expect(last.postalCode).toBe('310018');
    expect(Object.keys(last)).not.toContain('zipCode');
    // …and it is still on screen after the write is fed back in.
    expect(subInput(ZIP_LABEL).value).toBe('310018');
  });

  it('3. the written address survives the enforced platform value contract', () => {
    const written: AddressValue[] = [];
    render(<Harness initial={STORED} onWrite={(v) => written.push(v)} />);

    fireEvent.change(subInput('City'), { target: { value: '宁波' } });

    // `AddressValueSchema` is `$strip`: an unknown part name is DROPPED, which
    // is how a `zipCode`-shaped write lost the postal code on the way to
    // storage. Parsing the widget's own output is the end-to-end pin.
    const parsed = AddressValueSchema.parse(lastWrite(written));
    expect(parsed.postalCode).toBe('310018');
  });

  it('4. still DISPLAYS a legacy `zipCode`-shaped value written by earlier builds', () => {
    render(<AddressField value={LEGACY} onChange={vi.fn()} field={field} />);

    expect(subInput(ZIP_LABEL).value).toBe('310018');
  });

  it('5. migrates a legacy value onto `postalCode` on the first edit of any part', () => {
    const written: AddressValue[] = [];
    render(<Harness initial={LEGACY} onWrite={(v) => written.push(v)} />);

    fireEvent.change(subInput('Street Address'), { target: { value: '中策路 2 号' } });

    const last = lastWrite(written);
    expect(last.street).toBe('中策路 2 号');
    expect(last.postalCode).toBe('310018');
    expect(Object.keys(last)).not.toContain('zipCode');
    expect(AddressValueSchema.parse(last).postalCode).toBe('310018');
  });

  it('6. writes an edit of the ZIP box itself under `postalCode`', () => {
    const written: AddressValue[] = [];
    render(<Harness initial={STORED} onWrite={(v) => written.push(v)} />);

    fireEvent.change(subInput(ZIP_LABEL), { target: { value: '310019' } });

    const last = lastWrite(written);
    expect(last.postalCode).toBe('310019');
    expect(Object.keys(last)).not.toContain('zipCode');
    expect(subInput(ZIP_LABEL).value).toBe('310019');
    // The sharpest statement of the bug: under the old key the CORRECTION was
    // stripped by the contract and the stale stored code survived, with no
    // error anywhere — the user saw 310019 in the box and 310018 in the record.
    expect(AddressValueSchema.parse(last).postalCode).toBe('310019');
  });

  it('7. prefers the canonical key when a record carries both', () => {
    const both = { ...STORED, zipCode: '999999' } as AddressValue;
    const written: AddressValue[] = [];
    render(<Harness initial={both} onWrite={(v) => written.push(v)} />);

    expect(subInput(ZIP_LABEL).value).toBe('310018');

    fireEvent.change(subInput('City'), { target: { value: '宁波' } });

    const last = lastWrite(written);
    expect(last.postalCode).toBe('310018');
    expect(Object.keys(last)).not.toContain('zipCode');
  });

  it('8. clearing the ZIP box clears the postal code instead of resurrecting the legacy value', () => {
    const written: AddressValue[] = [];
    render(<Harness initial={LEGACY} onWrite={(v) => written.push(v)} />);

    fireEvent.change(subInput(ZIP_LABEL), { target: { value: '' } });

    const last = lastWrite(written);
    expect(last.postalCode).toBe('');
    expect(Object.keys(last)).not.toContain('zipCode');
    expect(subInput(ZIP_LABEL).value).toBe('');
  });

  it('9. formats the postal code in read-only mode, canonical and legacy alike', () => {
    const canonical = render(
      <AddressField value={STORED} onChange={vi.fn()} field={field} readonly />,
    );
    expect(canonical.container.textContent).toContain('浙江 310018');
    canonical.unmount();

    const legacy = render(
      <AddressField value={LEGACY} onChange={vi.fn()} field={field} readonly />,
    );
    expect(legacy.container.textContent).toContain('浙江 310018');
  });

  it('10. binds the ZIP sub-input to the canonical part name, and nothing to the legacy one', () => {
    const { baseElement } = render(
      <AddressField value={STORED} onChange={vi.fn()} field={field} />,
    );

    expect(subInput(ZIP_LABEL).id).toMatch(/-postalCode$/);
    const ids = Array.from(baseElement.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.filter((id) => id.endsWith('-zipCode'))).toEqual([]);
  });

  it('11. spells the part the way the spec spells it (direction guard)', () => {
    const specParts = Object.keys(AddressValueSchema.shape);
    expect(specParts).toContain('postalCode');
    expect(specParts).not.toContain('zipCode');
  });

  it('12. a postal code entered on a NEW record reaches storage instead of being stripped', () => {
    const written: AddressValue[] = [];
    render(<Harness initial={{}} onWrite={(v) => written.push(v)} />);

    fireEvent.change(subInput(ZIP_LABEL), { target: { value: '310018' } });

    // Nothing stored to mask the loss: under the old key the parse produced an
    // address with no postal code at all.
    expect(AddressValueSchema.parse(lastWrite(written)).postalCode).toBe('310018');
  });
});
