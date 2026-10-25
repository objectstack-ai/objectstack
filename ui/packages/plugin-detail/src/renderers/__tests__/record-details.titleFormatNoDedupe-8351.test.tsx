/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details`' dedupe must not hide a row when the H1 is an interpolated
 * `titleFormat` that names no single field (objectui#8351, ruled option B).
 *
 * ## The surface under test is the DEDUPE, not the title
 *
 * Same boundary as `record-details.nameFieldDedupe-8175.test.tsx`: this
 * renderer draws the body grid, never the H1. Every case below therefore
 * asserts which row RENDERS and which row DROPS.
 *
 * ## The defect
 *
 * The ladder is keyed on "which single FIELD is the H1 showing". A
 * `titleFormat` rung answers with a rendered TEMPLATE, which on a multi-field
 * format is no field's value at all. The ladder had no rung for it, so it
 * walked straight on to `resolveNameField` and hid THAT row — a row whose
 * value the H1 was not showing. The field simply vanished from the grid, and
 * nothing errored.
 *
 * ## What "fully interpolates" is measured against (objectui#8351 ZONE 2)
 *
 * Not a new predicate. The ladder asks `formatTitleTemplate` — the SAME
 * function `getRecordDisplayName`'s step 3 and this package's own
 * `DetailView.resolveDisplayTitle` step 2 call — for the title the template
 * renders on THIS record, and then asks `recordDisplayValueAt` whether that
 * string IS some candidate's value:
 *
 *   - renders a composite (no candidate's value equals it) -> hide NOTHING.
 *     That is the ruled case: "the H1 is not any single field's value, so
 *     there is no row to hide".
 *   - renders nothing (no placeholder resolved) -> the header has already
 *     walked past the template rung, so the ladder runs unchanged.
 *   - collapses onto ONE field's value (a blank placeholder was dropped, or
 *     the format names a single field) -> that row IS the duplicate the
 *     dedupe exists for, and it still goes.
 *
 * The last two are the lit controls: a rule that suppressed the dedupe on the
 * mere PRESENCE of a resolving `titleFormat` prints "Name: Acme Holdings"
 * directly under an H1 reading `Acme Holdings`, which is the exact duplication
 * Phase P.0 of the ladder exists to remove.
 *
 * ⛔ Out of scope by the same ruling: `page:header`'s own `schema.title`, which
 * this package cannot see.
 *
 * ## The ORDER, ruled later (objectui#9436, C1)
 *
 * The ADR-0079 declared pointer (`nameField`, then its `displayNameField`
 * alias) OUTRANKS the template in the header, as it does in
 * `getRecordDisplayName`. So the ladder reads the pointer FIRST: when it holds
 * a value, that field IS the H1 and its row goes, and the template is never
 * consulted. The three template outcomes above therefore only arise on a
 * record where the pointer is absent or blank, and their cases below run on
 * {@link templateOnlySchema}, which declares none.
 *
 * Two cases here pinned the OLD order, where the template outranked the
 * pointer on an object declaring both. They are rewritten to the protocol
 * order, not deleted: "HALF 1" and "hides the row the DECLARED POINTER
 * names". The header and this dedupe are also pinned RENDERED TOGETHER in
 * `record-details.headerDedupeAgreement-9436.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/**
 * An object that declares BOTH a `nameField` and a two-field `titleFormat`.
 * The two answer differently on every record below, so "which row is hidden"
 * is answerable from the DOM alone.
 */
const contractSchema = {
  name: 'contract',
  label: 'Contract',
  nameField: 'contract_no',
  titleFormat: '{contract_no} - {name}',
  fields: {
    contract_no: { type: 'text', label: 'Contract No' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

/**
 * The same object with NO declared pointer (objectui#9436). This is where the
 * template IS the H1, so the ruled option-B outcomes are measured here. The
 * type-aware derivation still names `name` (a name-ish exact key), which makes
 * `resolveNameField` answer `name`, the row the pre-#8351 walk used to hide.
 */
const { nameField: _declaredPointer, ...templateOnlySchema } = contractSchema;

const CONTRACT_FIELDS = ['contract_no', 'name', 'amount'];

function renderBody(record: any, schema: any, fields: string[]) {
  return render(
    <RecordContextProvider
      objectName={schema?.name ?? 'contract'}
      recordId={record.id}
      data={record}
      objectSchema={schema}
    >
      <RecordDetailsRenderer schema={{ fields } as never} />
    </RecordContextProvider>,
  );
}

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain` for the
  // ROW-level verdict; happy-dom resolves that relative URL to a REAL socket,
  // which the repo's network-escape guard fails the file for (objectui#6640).
  // Serve it from a double — its answer is orthogonal to which row is hidden.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('record:details dedupe — an interpolated `titleFormat` hides no row (#8351)', () => {
  /**
   * The halves are separate cases ON PURPOSE, exactly as in the objectui#8175
   * pin: asserting both inside one `it` lets the first failure short-circuit
   * the second, so an ablation of the read site reddens one half and says
   * nothing at all about the other.
   */
  it('HALF 1 — DROPS the declared `nameField` row: the H1 is its value, not the template (#9436)', () => {
    // Rewritten, not deleted. Under the OLD order this case asserted that the
    // row was KEPT, because the H1 read `HT-2026-001 - Acme Corporation`.
    // Under the protocol order (objectui#9436) the declared pointer outranks
    // the template, so the H1 reads `HT-2026-001`, and the `contract_no` row
    // IS the duplicate the dedupe exists to remove.
    renderBody(
      { id: 'C1', contract_no: 'HT-2026-001', name: 'Acme Corporation', amount: 42 },
      contractSchema,
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('HT-2026-001')).toBeNull();

    // CONTROL — the grid rendered at all. Without it a build that rendered
    // nothing would satisfy nothing here, and `queryByText === null` cases
    // below are trivially true on an empty document.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('HALF 2 — KEEPS the ordinary `name` row (the H1 is the declared pointer, not `name`)', () => {
    renderBody(
      { id: 'C1', contract_no: 'HT-2026-001', name: 'Acme Corporation', amount: 42 },
      contractSchema,
      CONTRACT_FIELDS,
    );

    // The template's `{name}` placeholder does not make `name` the heading.
    // The H1 is `contract_no`'s value, so `name` duplicates nothing.
    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('HALF 1b — with NO declared pointer, a composite template KEEPS the derived `name` row', () => {
    // The ruled option-B case, on an object where the template really is the
    // H1 (objectui#9436 moved it below a declared pointer). The H1 reads
    // `HT-2026-011 - Acme Corporation`, which is no field's value, so no row
    // duplicates it. The walk would hide `name`, the row `resolveNameField`
    // derives, and the H1 never showed it.
    renderBody(
      { id: 'C11', contract_no: 'HT-2026-011', name: 'Acme Corporation', amount: 12 },
      templateOnlySchema,
      CONTRACT_FIELDS,
    );

    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('HALF 2b — with NO declared pointer, a composite template KEEPS the `contract_no` row too', () => {
    renderBody(
      { id: 'C11', contract_no: 'HT-2026-011', name: 'Acme Corporation', amount: 12 },
      templateOnlySchema,
      CONTRACT_FIELDS,
    );

    expect(screen.getByText('HT-2026-011')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('LIT CONTROL A — a `titleFormat` that resolves to NOTHING leaves the ladder alone', () => {
    // No pointer is declared and no placeholder resolves on this record, so
    // `formatTitleTemplate` returns '' and the header walks past the template
    // rung to the unified resolver, which derives `name`. The H1 reads
    // `internal-name`, and that row must still go.
    renderBody(
      { id: 'C2', contract_no: 'HT-2026-002', name: 'internal-name', amount: 7 },
      { ...templateOnlySchema, titleFormat: '{ref_a} - {ref_b}' },
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('internal-name')).toBeNull();
    expect(screen.getByText('HT-2026-002')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('LIT CONTROL B — a template that COLLAPSES onto one field still hides that row', () => {
    // No pointer is declared and `contract_no` is blank, so
    // `formatTitleTemplate` drops that placeholder and the orphan separator
    // with it. The H1 reads exactly `Acme Holdings`. That IS `name`'s value,
    // so the row is a real duplicate and still goes. This is the case a
    // presence-only rule gets wrong: it would print "Name: Acme Holdings"
    // directly under an identical H1.
    renderBody(
      { id: 'C3', contract_no: '', name: 'Acme Holdings', amount: 9 },
      templateOnlySchema,
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('Acme Holdings')).toBeNull();
    expect(screen.getByText('9')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('LIT CONTROL C — a single-field `titleFormat` is that field, and still dedupes', () => {
    // `{name}` renders exactly `name`'s value. "Interpolated" does not mean
    // "composite": the ruled reason is that the H1 names no ONE field, and
    // here it names exactly one.
    renderBody(
      { id: 'C4', name: 'Acme Corporation', amount: 5 },
      {
        name: 'plain',
        label: 'Plain',
        titleFormat: '{name}',
        fields: {
          name: { type: 'text', label: 'Name' },
          amount: { type: 'number', label: 'Amount' },
        },
      },
      ['name', 'amount'],
    );

    expect(screen.queryByText('Acme Corporation')).toBeNull();
    expect(screen.getByText('5')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('hides the row the DECLARED POINTER names, not the one the template names (#9436)', () => {
    // Rewritten, not deleted. Under the OLD order this case hid `name`,
    // because the template `{name}` was the H1. Under the protocol order
    // (objectui#9436) `nameField: 'contract_no'` outranks the template, so
    // the H1 reads `HT-2026-005`. A ladder still checking the template first
    // hides `Acme Corporation`, a row the H1 never showed, and leaves the real
    // duplicate printed underneath. Both halves are wrong at once, the
    // objectui#8175 shape again.
    renderBody(
      { id: 'C5', contract_no: 'HT-2026-005', name: 'Acme Corporation', amount: 3 },
      { ...contractSchema, titleFormat: '{name}' },
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('HT-2026-005')).toBeNull();
    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('hides the row the TEMPLATE names when no pointer is declared: a scan, not a peek', () => {
    // No pointer is declared, so the template `{subject}` IS the H1 and reads
    // `Renewal`. The ladder's first candidate WITH A VALUE is `name` (the
    // derived title field), so a walk that stops at the first resolving
    // candidate hides `Acme Corporation`, a row the H1 never showed, and
    // leaves the real duplicate. The match has to scan every candidate.
    renderBody(
      { id: 'C7', name: 'Acme Corporation', subject: 'Renewal', amount: 4 },
      {
        name: 'deal',
        label: 'Deal',
        titleFormat: '{subject}',
        fields: {
          name: { type: 'text', label: 'Name' },
          subject: { type: 'text', label: 'Subject' },
          amount: { type: 'number', label: 'Amount' },
        },
      },
      ['name', 'subject', 'amount'],
    );

    expect(screen.queryByText('Renewal')).toBeNull();
    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('CONTROL — an object with NO `titleFormat` dedupes exactly as before', () => {
    // The objectui#8175 ladder, untouched. Without this case, a change that
    // disabled the H1 dedupe outright would pass every assertion above.
    renderBody(
      { id: 'C6', contract_no: 'HT-2026-006', name: 'internal-name', amount: 11 },
      { ...contractSchema, titleFormat: undefined },
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('HT-2026-006')).toBeNull();
    expect(screen.getByText('internal-name')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument(); // CONTROL: grid rendered
  });
});
