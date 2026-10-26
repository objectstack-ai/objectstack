/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details`' dedupe asks the ADR-0079 resolver WHICH ROW to hide
 * (objectui#8175).
 *
 * ## The surface under test is the DEDUPE, not the title
 *
 * This renderer does not draw the H1. It draws the body grid and drops from it
 * the one field whose value the page H1 is already showing. The H1 is drawn a
 * package away by `@object-ui/components`' `PageHeaderRenderer`, whose chain
 * ends with the unified ADR-0079 resolver and only then the same six-name
 * literal walk this ladder used to be. So a TITLE-only pin passes while this
 * ladder is wrong — the two halves are decided in different packages, and
 * `packages/components/src/__tests__/page-header-title.test.tsx` (case
 * `nameField wins over a record-level 'name' value`) is already green on
 * `origin/main` with this defect fully present. Every case below therefore
 * asserts which row RENDERS and which row DROPS.
 *
 * ## The defect these cases pin
 *
 * The ladder had no equivalent of the resolver rung, so for an object whose
 * declared `nameField` names a field the six-entry literal walk does not know,
 * BOTH halves of the dedupe were wrong at once: the duplicate row survived
 * (`contract_no`, the value the H1 shows) and an ordinary field disappeared
 * instead (`name`, a row the H1 never showed).
 *
 * ## Why the resolver rung is UNROLLED into two candidates
 *
 * `resolveNameField` returns ONE answer and short-circuits: a declared
 * `nameField` wins outright and the type-aware derivation never runs. This
 * ladder is VALUE-keyed — the header's own chain re-tries the next rung when a
 * rung's value is empty on the record (`getRecordDisplayName` step 1+2 falls to
 * step 4 when `recordDisplayValueAt` comes back undefined). Delegating to `resolveNameField`
 * alone would therefore lose the derivation rung for every record whose
 * declared pointer happens to be blank. The two rungs are listed separately so
 * the value-keyed walk can fall through exactly the way the H1's does.
 *
 * ## What the rows are keyed by (objectui#8269's trap, measured here)
 *
 * The dedupe filters entries through `columnIdentity`, which is CANONICAL-first
 * (`field` beats `name`/`fieldName`), while `DetailSection` renders each row
 * from `field.name`. For the shapes these fixtures use — bare strings — the two
 * are the same string, so "the resolver's answer" and "the column the row
 * carries" cannot coincide by accident. A deliberately conflicting entry
 * (`{ field, name }` disagreeing) is a different, pre-existing defect shape that
 * `hasConflictingColumnIdentity` already names; it is NOT pinned here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/**
 * An object whose declared `nameField` is `contract_no` — a name the six-entry
 * literal walk (`name`, `full_name`, `title`, `subject`, `display_name`,
 * `label`) does not know. `name` is an ORDINARY field here, and the two carry
 * different values, so "which row is hidden" is answerable from the DOM alone.
 */
const contractSchema = {
  name: 'contract',
  label: 'Contract',
  nameField: 'contract_no',
  fields: {
    contract_no: { type: 'text', label: 'Contract No' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

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

describe('record:details dedupe — the declared `nameField` picks the hidden row (#8175)', () => {
  /**
   * The two halves are separate cases ON PURPOSE. Asserting both inside one
   * `it` makes the first failure short-circuit the second, so an ablation of
   * the read site reddens the duplicate half and says nothing at all about the
   * vanishing half — and "an ordinary field disappears" is half the defect.
   * Split, the ablation names both.
   */
  it('HALF 1 — DROPS the declared `nameField` row (the duplicate must not survive)', () => {
    renderBody(
      { id: 'C1', contract_no: 'HT-2026-001', name: 'internal-name', amount: 42 },
      contractSchema,
      CONTRACT_FIELDS,
    );

    // `HT-2026-001` is exactly what the H1 shows for this record (pinned in
    // `@object-ui/components`' `page-header-title.test.tsx`, case `nameField
    // wins over a record-level 'name' value`), so repeating it in the grid is
    // the duplication this dedupe exists for.
    expect(screen.queryByText('HT-2026-001')).toBeNull();

    // CONTROL — the grid rendered at all. Without it this case is satisfied by
    // a build that rendered nothing: "queryByText is null" is trivially true on
    // an empty document. (The row LABEL is `Amount`, the object's DECLARED
    // label. It read `amount` — the raw field name — until objectui#8497:
    // `record:details` now fills a bare-string entry's `label` from the object
    // definition, so the i18n ladder's middle rung resolves instead of falling
    // straight through to the name.)
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('HALF 2 — KEEPS the ordinary `name` row (no field may vanish in its place)', () => {
    renderBody(
      { id: 'C1', contract_no: 'HT-2026-001', name: 'internal-name', amount: 42 },
      contractSchema,
      CONTRACT_FIELDS,
    );

    // `internal-name` is a row the H1 never showed. The literal walk took it
    // out anyway, because `name` is its first entry and the record has a value
    // there — so the grid lost a field AND kept the duplicate, both at once.
    expect(screen.getByText('internal-name')).toBeInTheDocument();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('honours the deprecated `displayNameField` alias the same way', () => {
    renderBody(
      { id: 'C2', contract_no: 'HT-2026-002', name: 'internal-name-2', amount: 7 },
      { ...contractSchema, nameField: undefined, displayNameField: 'contract_no' },
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('HT-2026-002')).toBeNull();
    expect(screen.getByText('internal-name-2')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('falls through to the literal walk when the declared pointer is EMPTY on the record', () => {
    // The H1's chain is value-keyed: `getRecordDisplayName` only takes the
    // declared pointer when `recordDisplayValueAt` yields something, else it keeps walking.
    // With no `contract_no` value the H1 for this record is `Acme Corporation`,
    // so `name` is the row that has to go — not `contract_no`, which shows
    // nothing at all and duplicates no heading.
    renderBody(
      { id: 'C3', name: 'Acme Corporation', amount: 11 },
      contractSchema,
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('Acme Corporation')).toBeNull();
    expect(screen.getByText('11')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('uses the type-aware derivation rung when nothing is declared', () => {
    // No `nameField`, and no key the literal walk knows. `deriveTitleField`
    // picks `activity_name` off the `*_name` affix, which is exactly what the
    // H1 resolves to — so before this fix the grid repeated the heading and
    // the dedupe dropped nothing at all.
    renderBody(
      { id: 'A1', activity_name: 'Kickoff call', amount: 5 },
      {
        name: 'activity',
        label: 'Activity',
        fields: {
          activity_name: { type: 'text', label: 'Activity Name' },
          amount: { type: 'number', label: 'Amount' },
        },
      },
      ['activity_name', 'amount'],
    );

    expect(screen.queryByText('Kickoff call')).toBeNull();
    expect(screen.getByText('5')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  it('re-tries the derivation rung when a DECLARED pointer is blank on the record', () => {
    // The case a single `resolveNameField()` call cannot answer: it returns
    // `contract_no` (declared wins, derivation never runs), that field is empty
    // here, and the H1 therefore falls to the derivation — `activity_name`.
    // A ladder that consulted only `resolveNameField` would hide nothing and
    // leave `Kickoff call` printed directly under an H1 reading `Kickoff call`.
    renderBody(
      { id: 'A2', activity_name: 'Kickoff call', amount: 3 },
      {
        name: 'activity',
        label: 'Activity',
        nameField: 'contract_no',
        fields: {
          contract_no: { type: 'text', label: 'Contract No' },
          activity_name: { type: 'text', label: 'Activity Name' },
          amount: { type: 'number', label: 'Amount' },
        },
      },
      ['contract_no', 'activity_name', 'amount'],
    );

    expect(screen.queryByText('Kickoff call')).toBeNull();
    expect(screen.getByText('3')).toBeInTheDocument(); // CONTROL: grid rendered
  });

  /**
   * CONTROL — the literal walk is still the tail of the ladder.
   *
   * Without this, deleting the resolver rungs AND the literal walk together
   * would pass every case above that only asserts a row survives. This is the
   * case that goes red for a ladder that resolves nothing.
   */
  it('CONTROL: an undeclared object still dedupes via the literal walk', () => {
    renderBody(
      { id: 'P1', name: 'Acme Corporation', amount: 99 },
      {
        name: 'plain',
        label: 'Plain',
        fields: {
          name: { type: 'text', label: 'Name' },
          amount: { type: 'number', label: 'Amount' },
        },
      },
      ['name', 'amount'],
    );

    expect(screen.queryByText('Acme Corporation')).toBeNull();
    expect(screen.getByText('99')).toBeInTheDocument();
  });
});
