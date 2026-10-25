/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details`' H1 dedupe recognises a `titleFormat` that collapses onto
 * ANY field the template renders, not only onto a fixed candidate list
 * (objectui#10360).
 *
 * ## The defect
 *
 * When no declared name pointer holds a value, the H1 is the rendered
 * `titleFormat`. objectui#8351 (ruled option B) hides the row whose value
 * EQUALS that rendered string, and hides nothing when the string is a
 * composite that is no field's value. The comparison set was
 * `titleCandidates` alone: the two ADR-0079 resolver rungs plus six literal
 * names. A template that collapsed onto a field outside that list was not
 * recognised, so the field's row printed directly under an H1 showing the
 * same value. Measured by the objectui#9436 dev: no pointer,
 * `titleFormat: '{contract_no} - {name}'`, a blank `name` ⇒ H1 `HT-2026-003`,
 * and the "Contract No" row still printed `HT-2026-003`.
 *
 * ## What changed, and what did not
 *
 * The comparison is ruling B's, unchanged: `recordDisplayValueAt(field)` must
 * EQUAL the rendered template. Only the set of fields compared is wider. The
 * candidate scan runs first, exactly as before, and a candidate match still
 * wins. Only when no candidate matches does the scan go on to the fields the
 * template rendered. So no row that was hidden before is hidden differently
 * now; the change can only hide a row where nothing was hidden.
 *
 * "A field the template rendered" is asked of `formatTitleTemplate` itself,
 * never of a second placeholder parser: blank that one field on the record,
 * render again, and see whether the title changed. So the answer agrees with
 * the renderer on every token shape it accepts (`{{…}}`, inner whitespace,
 * dotted lookup paths). The `TWO FIELDS EQUAL THE H1` case below is why a
 * "which placeholders does the template name" reading is not enough.
 *
 * ## The surface under test
 *
 * Each case renders the REAL `page:header` beside the REAL body under one
 * record context, as `record-details.headerDedupeAgreement-9436.test.tsx`
 * does. It reads the H1 the user sees, then which row the body drops. A
 * dedupe-only pin would take the H1's value on trust.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
// Registers `page:header` (and the rest of the atoms) on the shared registry.
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/**
 * The card's fixture: NO declared name pointer, so the template is the H1.
 * `contract_no` is on no candidate list: it is not one of the six literal
 * names, and the type-aware derivation lands on `name` (a name-ish exact key).
 */
const templateOnlySchema = {
  name: 'contract',
  label: 'Contract',
  titleFormat: '{contract_no} - {name}',
  fields: {
    contract_no: { type: 'text', label: 'Contract No' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const CONTRACT_FIELDS = ['contract_no', 'name', 'amount'];

/**
 * Viewport, pinned rather than inherited, for the reason
 * `record-details.dedupeEmptinessTrims-8350.test.tsx` states: `DetailSection`
 * can also remove an EMPTY row through its auto-hide heuristic, whose
 * thresholds depend on the viewport. On the desktop branch no fixture here
 * reaches the 4-row minimum, so a row can only be missing because the dedupe
 * dropped it.
 */
const DESKTOP_WIDTH = 1280;

/** Render the header and the body under ONE record context; read both. */
function renderPage(
  record: any,
  schema: any,
  fields: string[],
): { h1: string | null | undefined; body: string } {
  const Header = ComponentRegistry.get('page:header');
  if (!Header) throw new Error('page:header not registered');
  const { container } = render(
    <ActionProvider>
      <RecordContextProvider
        objectName={schema.name}
        recordId={record.id}
        data={record}
        objectSchema={schema}
      >
        <div data-testid="page-header">
          <Header schema={{ type: 'page:header' }} />
        </div>
        <div data-testid="page-body">
          <RecordDetailsRenderer schema={{ fields } as never} />
        </div>
      </RecordContextProvider>
    </ActionProvider>,
  );
  const h1 = container.querySelector('[data-testid="page-header"] h1')?.textContent;
  const body = container.querySelector('[data-testid="page-body"]')?.textContent ?? '';
  return { h1, body };
}

/** How many times `needle` occurs in `haystack`. */
const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DESKTOP_WIDTH });
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom
  // would resolve that to a REAL socket (objectui#6640). Its answer is
  // orthogonal to which heading renders and which row is hidden.
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

describe('record:details dedupe — a `titleFormat` collapsed onto a non-candidate field (#10360)', () => {
  it('THE CARD — the H1 collapses onto `contract_no`, and the "Contract No" row is not printed under it', () => {
    // `name` is blank, so `formatTitleTemplate` drops that placeholder and its
    // orphan separator. The H1 reads exactly `contract_no`'s value, so that
    // row IS the duplicate.
    const { h1, body } = renderPage(
      { id: 'C3', contract_no: 'HT-2026-003', name: '', amount: 13 },
      templateOnlySchema,
      CONTRACT_FIELDS,
    );

    expect(h1).toBe('HT-2026-003');
    expect(body).not.toContain('HT-2026-003');
    expect(body).not.toContain('Contract No');
    // CONTROL: the body rendered, and the rows the H1 does not show stay.
    expect(body).toContain('Name');
    expect(body).toContain('Amount');
  });

  it('COMPOSITE CONTROL — both placeholders hold a value: the H1 is no field\'s value, and no row is hidden (#8351)', () => {
    // The ruled option-B case, kept. A presence-only rule, or a widened scan
    // that stopped comparing values, would hide a row here.
    const { h1, body } = renderPage(
      { id: 'C13', contract_no: 'HT-2026-013', name: 'Acme Corporation', amount: 14 },
      templateOnlySchema,
      CONTRACT_FIELDS,
    );

    expect(h1).toBe('HT-2026-013 - Acme Corporation');
    expect(body).toContain('HT-2026-013');
    expect(body).toContain('Acme Corporation');
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });

  it('SAME VALUE IN BOTH PLACEHOLDERS — the template renders a composite, so BOTH rows stay', () => {
    // Two placeholder fields holding the same value do not collapse: each
    // placeholder renders its own copy, so the H1 is the composite, which is
    // neither field's value. The equality test answers no for both.
    const { h1, body } = renderPage(
      { id: 'C23', contract_no: 'HT-2026-003', name: 'HT-2026-003', amount: 15 },
      templateOnlySchema,
      CONTRACT_FIELDS,
    );

    expect(h1).toBe('HT-2026-003 - HT-2026-003');
    expect(occurrences(body, 'HT-2026-003')).toBe(2);
    expect(body).toContain('Contract No');
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });

  it('TWO FIELDS EQUAL THE H1 — the row the template RENDERED goes, not a field it merely names', () => {
    // `owner` (an expanded lookup) and `rep` both display `Ann`, and the
    // template names both. Only `rep` rendered the H1: `{owner.nickname}` is
    // blank. A scan that took the first field the template names, by
    // equality alone, would hide `owner` and leave `Ann` printed under the
    // H1. Blanking a field and rendering again is what tells the two apart:
    // blank `rep` and the title changes, blank `owner` and it does not.
    // (Two TOP-LEVEL placeholders cannot both equal the H1 this way; a
    // dotted path is what lets a field's own value differ from what its
    // placeholder rendered.)
    //
    // `rep` is on no candidate list: it is not a literal name, and the
    // derivation lands on `name` (a name-ish exact key) — so this case needs
    // the widened scan, not the candidate one.
    const { h1, body } = renderPage(
      {
        id: 'C33',
        owner: { id: 'u1', name: 'Ann', nickname: '' },
        rep: 'Ann',
        name: 'Q3 renewal',
        amount: 16,
      },
      {
        name: 'deal',
        label: 'Deal',
        titleFormat: '{owner.nickname} - {rep}',
        fields: {
          name: { type: 'text', label: 'Name' },
          rep: { type: 'text', label: 'Rep' },
          amount: { type: 'number', label: 'Amount' },
        },
      },
      ['name', 'rep', 'amount'],
    );

    expect(h1).toBe('Ann');
    expect(body).not.toContain('Ann');
    expect(body).not.toContain('Rep');
    // CONTROL: the body rendered, and the derived `name` row the H1 does not
    // show stays.
    expect(body).toContain('Q3 renewal');
    expect(body).toContain('Amount');
  });

  it('DECLARED POINTER CONTROL — when the pointer holds a value, the template is never scanned (#9436)', () => {
    // The declared-pointer branch runs first and is untouched: the H1 is
    // `name`'s value and only that row goes. The template would collapse
    // onto `contract_no` (`code` is blank), but the header never reaches the
    // template, so neither may the dedupe. `contract_no` keeps its row.
    const { h1, body } = renderPage(
      { id: 'C43', contract_no: 'HT-2026-043', code: '', name: 'Acme Corporation', amount: 17 },
      {
        ...templateOnlySchema,
        nameField: 'name',
        titleFormat: '{contract_no} - {code}',
      },
      CONTRACT_FIELDS,
    );

    expect(h1).toBe('Acme Corporation');
    expect(body).not.toContain('Acme Corporation');
    expect(body).toContain('HT-2026-043');
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });
});
