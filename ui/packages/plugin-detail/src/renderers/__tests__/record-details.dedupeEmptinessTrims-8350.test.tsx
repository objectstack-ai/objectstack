/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details`' dedupe and the page H1 share ONE definition of "this record
 * has a value here" (objectui#8350).
 *
 * ## The surface under test is the DEDUPE, not the title
 *
 * This renderer does not draw the H1. It draws the body grid and drops from it
 * the one field whose value the H1 is already showing. The H1 is drawn a
 * package away by `@object-ui/components`' `PageHeaderRenderer`, and its half
 * of this is already green on `origin/main` with the defect fully present —
 * `packages/components/src/__tests__/page-header-title.test.tsx` passes either
 * way, because the two halves are decided in different packages. So every case
 * below asserts which row RENDERS and which row DROPS. A title-only pin proves
 * nothing here.
 *
 * ## The defect these cases pin
 *
 * objectui#8175 (PR #8349) made the two halves agree on WHICH FIELD: the ladder
 * now leads with `resolveNameField` / `deriveTitleField`, the same ADR-0079
 * resolver the header reads. They still disagreed on WHAT COUNTS AS A VALUE.
 *
 * The header decides emptiness through `@object-ui/core`'s
 * `recordDisplayValueAt` (the function that was `valueAt`), which TRIMS: a
 * whitespace-only value is empty, so `getRecordDisplayName` keeps walking to
 * the next rung. The ladder asked its own raw `undefined` / `null` / `''`
 * question, which `'   '` passes. ⇒ for a record whose title field holds only
 * spaces the ladder concluded THAT field was what the H1 shows and hid its row,
 * while the H1 had already moved on and was showing something else. A field
 * disappeared from the grid to deduplicate against a heading that never
 * displayed it, and nothing errored — a row was simply absent.
 *
 * ## Why every tier of the ladder is exercised
 *
 * The ladder is eight candidates: two resolver rungs (declared pointer, then
 * the type-aware derivation) and the six-entry literal walk as the tail. The
 * emptiness test is asked once per candidate, so a fix that reached only the
 * first rung would leave the other two wrong. `WHITESPACE AT THE DERIVATION
 * RUNG` and `WHITESPACE IN THE LITERAL WALK` are what make "all three tiers
 * share the fixed test" a measurement rather than a claim.
 *
 * ## Every case carries a control, and one case IS a control
 *
 * `queryByText(...)` returning null is trivially true on a document that
 * rendered nothing, so each case also asserts a surviving ordinary row BY
 * VALUE. And `NON-REGRESSION` at the bottom pins that a real value still hides
 * its row: without it, an "emptiness test" that answered EMPTY for everything —
 * disabling the dedupe outright — would pass every other case in this file.
 *
 * ## What the rows are keyed by (objectui#8269's trap)
 *
 * The dedupe filters entries through `columnIdentity`, which is CANONICAL-first
 * (`field` beats `name`), while `DetailSection` renders each row from
 * `field.name`. All fixtures here use BARE STRING entries, where the two are
 * the same string by construction — so a green cannot come from the resolver's
 * answer accidentally matching a differently-keyed column. A row that survives
 * is therefore asserted by its LABEL, which for a bare-string entry is the
 * field name itself; a row that must drop is asserted by its VALUE.
 *
 * ## Why the whitespace rows are still on screen — and why this file now pins
 * the viewport (objectui#8399)
 *
 * A row may only be missing below because the dedupe dropped it. `DetailSection`
 * can also remove a row, through its auto-hide heuristic, and that heuristic is
 * decided by TWO viewport-dependent constants (`DetailSection.tsx`, read through
 * `useIsMobile`, breakpoint 768):
 *
 *   desktop — `AUTO_HIDE_MIN_FIELDS` 4, `AUTO_HIDE_RATIO` 0.25
 *   mobile  — `AUTO_HIDE_MIN_FIELDS` 3, `AUTO_HIDE_RATIO` 0.2
 *
 * Measured on this base, after the dedupe, per fixture (rendered rows / of which
 * empty): CONTRACT 2/1 · ACTIVITY 3/2 · PLAIN 2/1 · NON-REGRESSION 2/0. So on
 * the DESKTOP branch nothing here can reach the 4-row minimum and auto-hide
 * cannot fire — which is the condition every case below needs.
 *
 * ⚠️ This file used to state a second reason that is no longer true, and that
 * is why the pin exists. `DetailSection`'s own emptiness test WAS raw, so a
 * whitespace-only value counted as FILLED there and the ACTIVITY fixture read
 * 0 empty rows. objectui#8376 made that definition TRIM — the same definition
 * the dedupe ladder reads — so those two rows are EMPTY here now. The ACTIVITY
 * fixture consequently sits EXACTLY at the mobile minimum (3 rows) with 2 of
 * them empty (0.67 ≥ 0.2): on the mobile branch auto-hide fires and
 * `WHITESPACE AT THE DERIVATION RUNG — HALF 2` reddens, reporting only that
 * `contract_no` could not be found.
 *
 * The green was therefore resting on an ambient value this file never stated:
 * happy-dom reports `innerWidth` 1024 (measured), which is the desktop branch.
 * It is pinned below — and the branch is chosen, not inherited. DESKTOP is the
 * branch these cases mean to exercise, because they assert WHICH ROW THE DEDUPE
 * DROPS and that reading is only clean while no second mechanism can remove a
 * row. The mobile branch is not swept under the rug by that choice: it is
 * covered as a SECOND describe at the bottom of this file, never as a
 * substitute, and what it pins is the distinction the choice above depends on —
 * an auto-hidden row comes back, a deduped row does not.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { getRecordDisplayName } from '@object-ui/core';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/**
 * Viewport, pinned rather than inherited (objectui#8399) — see the docblock.
 *
 * `Object.defineProperty` rather than assignment: happy-dom's `innerWidth` is a
 * getter, so `window.innerWidth = n` is silently a no-op. `configurable: true`
 * is what lets the second describe re-pin it.
 */
const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;
const pinViewport = (width: number) => () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
};

/**
 * Presence read as a VALUE, so the `expect` message survives into the CI
 * summary. `getByText` throws before `expect` runs, and its one-line summary
 * ("Unable to find an element with the text: contract_no") is exactly the
 * message that sent this card's reader to the dedupe ladder instead of to the
 * auto-hide heuristic.
 */
// ⚠️ Row labels here are the object's DECLARED `label`s (objectui#8497).
// `record:details` fills a bare-string field entry's `label` from the bound
// object definition before `DetailSection` sees it, so a row that used to be
// found by its raw field name is now found by the label the object declares.
// Nothing about what this file measures moved — only how a row is named.
const shown = (text: string) => screen.queryByText(text) !== null;

/**
 * Declared pointer `contract_no`, held blank-but-not-empty on the record.
 * `deriveTitleField` lands on `name` (NAME_ISH_EXACT, first entry), which is
 * exactly where the header's chain goes when the declared rung yields nothing —
 * so `Acme Corporation` is what this record's H1 says, and its row is the
 * duplicate.
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
const WHITESPACE_POINTER_RECORD = {
  id: 'W1',
  contract_no: '   ',
  name: 'Acme Corporation',
  amount: 42,
};

/**
 * Both resolver rungs blank-but-not-empty at once: the declared pointer
 * (`contract_no`) and the derivation (`activity_name`, via the `*_name` affix —
 * no NAME_ISH_EXACT field is declared). The header therefore falls all the way
 * to a record key, landing on `label`, the LAST literal-walk entry.
 */
const activitySchema = {
  name: 'activity',
  label: 'Activity',
  nameField: 'contract_no',
  fields: {
    contract_no: { type: 'text', label: 'Contract No' },
    activity_name: { type: 'text', label: 'Activity Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};
const ACTIVITY_FIELDS = ['contract_no', 'activity_name', 'label', 'amount'];
const WHITESPACE_BOTH_RUNGS_RECORD = {
  id: 'W2',
  contract_no: '   ',
  activity_name: '\t\n ',
  label: 'Acme Corporation',
  amount: 4,
};

/**
 * Neither resolver rung answers — `amount` is the only declared field and
 * `number` is not title-eligible — so the ladder IS the literal walk here. Its
 * first entry (`name`) is blank-but-not-empty; `title`, further down, is where
 * both halves must land.
 */
const plainSchema = {
  name: 'plain',
  label: 'Plain',
  fields: {
    amount: { type: 'number', label: 'Amount' },
  },
};
const PLAIN_FIELDS = ['name', 'title', 'amount'];
const WHITESPACE_WALK_RECORD = { id: 'W3', name: '   ', title: 'Real Title', amount: 6 };

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

describe('record:details dedupe — emptiness is the header\'s definition (#8350)', () => {
  // DESKTOP on purpose: at these fixture sizes it is the only branch on which
  // `DetailSection` auto-hide cannot fire, so a missing row can only be the
  // dedupe's doing. See the docblock; the mobile branch is covered below.
  beforeEach(pinViewport(DESKTOP_WIDTH));

  /**
   * The two halves are separate cases ON PURPOSE. Inside one `it` the first
   * failing expectation short-circuits the rest, so an ablation of the read
   * site would redden "the duplicate survived" and say nothing at all about
   * "an ordinary field vanished" — and that second half is half the defect.
   * Split, an ablation names both by test name.
   */
  it('HALF 1 — a whitespace-only declared pointer does NOT claim the dedupe: the row the H1 really shows DROPS', () => {
    renderBody(WHITESPACE_POINTER_RECORD, contractSchema, CONTRACT_FIELDS);

    // `contract_no` holds only spaces, so the header walked past it to the
    // derivation and this record's H1 reads `Acme Corporation`. That is the
    // row that duplicates the heading, and the only row that may be hidden.
    expect(screen.queryByText('Acme Corporation')).toBeNull();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('HALF 2 — the whitespace-only row SURVIVES (nothing vanishes for a heading that never showed it)', () => {
    renderBody(WHITESPACE_POINTER_RECORD, contractSchema, CONTRACT_FIELDS);

    // The raw test read `'   '` as a value and hid this row to deduplicate
    // against an H1 that was showing something else entirely.
    expect(screen.getByText('Contract No')).toBeInTheDocument();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('WHITESPACE AT THE DERIVATION RUNG — HALF 1: the walk continues past BOTH resolver rungs and the duplicate drops', () => {
    renderBody(WHITESPACE_BOTH_RUNGS_RECORD, activitySchema, ACTIVITY_FIELDS);

    // Fixing only the first rung is not enough: rung 2 (`activity_name`) is
    // blank-but-not-empty too, and a raw test there would stop the walk before
    // it reached `label` — leaving `Acme Corporation` printed under an H1 that
    // already says `Acme Corporation`.
    expect(screen.queryByText('Acme Corporation')).toBeNull();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('WHITESPACE AT THE DERIVATION RUNG — HALF 2: both blank rows survive', () => {
    renderBody(WHITESPACE_BOTH_RUNGS_RECORD, activitySchema, ACTIVITY_FIELDS);

    expect(screen.getByText('Contract No')).toBeInTheDocument();
    expect(screen.getByText('Activity Name')).toBeInTheDocument();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('WHITESPACE IN THE LITERAL WALK — HALF 1: the tail trims too, so the next entry down is what drops', () => {
    renderBody(WHITESPACE_WALK_RECORD, plainSchema, PLAIN_FIELDS);

    // Neither resolver rung answers for this object, so the six-entry tail IS
    // the ladder. `name` is its first entry and holds only spaces; `title` is
    // where the header lands, so `title`'s row is the duplicate.
    expect(screen.queryByText('Real Title')).toBeNull();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('WHITESPACE IN THE LITERAL WALK — HALF 2: the blank `name` row survives', () => {
    renderBody(WHITESPACE_WALK_RECORD, plainSchema, PLAIN_FIELDS);

    expect(screen.getByText('name')).toBeInTheDocument();

    // CONTROL — the grid rendered at all.
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  /**
   * The OTHER half, measured here rather than cited.
   *
   * Everything above asserts the grid. This asserts what the header's own
   * resolver actually answers for the same three records — so "the two halves
   * now agree" is a reading in this file, not a cross-package promise. It is an
   * ADDITION to the DOM cases, never a substitute: on its own it would be the
   * title-only pin the docblock warns about, and it is green on `origin/main`
   * with the defect fully present.
   */
  it('CROSS-CHECK — `getRecordDisplayName` names exactly the value each case drops', () => {
    expect(getRecordDisplayName(contractSchema, WHITESPACE_POINTER_RECORD)).toBe('Acme Corporation');
    expect(getRecordDisplayName(activitySchema, WHITESPACE_BOTH_RUNGS_RECORD)).toBe('Acme Corporation');
    expect(getRecordDisplayName(plainSchema, WHITESPACE_WALK_RECORD)).toBe('Real Title');
  });

  /**
   * NON-REGRESSION — the dedupe still dedupes.
   *
   * Every case above is satisfied by an emptiness test that answers EMPTY for
   * everything, i.e. by deleting the dedupe. This is the case that goes red for
   * that, and it is why the fix is "share the header's definition" rather than
   * "be more willing to call things empty".
   */
  it('NON-REGRESSION: a real declared-pointer value still hides its own row', () => {
    renderBody(
      { id: 'W4', contract_no: 'HT-2026-001', name: 'internal-name', amount: 42 },
      contractSchema,
      CONTRACT_FIELDS,
    );

    expect(screen.queryByText('HT-2026-001')).toBeNull();

    // CONTROLS — the grid rendered, and the ordinary row is untouched.
    expect(screen.getByText('internal-name')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});

/**
 * The MOBILE branch — an ADDITION, never a substitute (objectui#8399).
 *
 * The describe above pins DESKTOP because that is the branch its cases need.
 * That choice is only honest if the other branch is stated rather than avoided,
 * and here the other branch is not a null case: the ACTIVITY fixture's 3
 * rendered rows sit EXACTLY at the mobile `AUTO_HIDE_MIN_FIELDS` (3) with 2 of
 * them empty (0.67 ≥ `AUTO_HIDE_RATIO` 0.2), so `DetailSection` auto-hide
 * fires. Measured, not argued: with the viewport at `MOBILE_WIDTH` and no other
 * change, `WHITESPACE AT THE DERIVATION RUNG — HALF 2` above goes red.
 *
 * ## What these two cases pin, and why it is not just "the same rows again"
 *
 * A row the dedupe dropped and a row auto-hide hid are BOTH "not on screen".
 * The describe above reads every absence as the dedupe's doing, and only the
 * desktop thresholds make that reading sound. These cases pin the difference
 * the reading rests on, on the branch where both mechanisms are live:
 *
 *   - auto-hide HIDES — `DetailSection` says so with `Show 2 empty fields`, and
 *     the toggle brings both rows back;
 *   - the dedupe REMOVES — `Acme Corporation`'s row is gone from the section
 *     and no toggle resurrects it.
 *
 * ⇒ if auto-hide ever reaches the desktop branch too (a threshold change, a
 * fixture change, another shift in what counts as empty), the describe above
 * reddens with a bare "Unable to find … contract_no" while MOBILE HALF 2 stays
 * green — and that pair of readings names auto-hide instead of the ladder.
 */
describe('record:details dedupe — on mobile the blank rows are HIDDEN, not deduped (#8399)', () => {
  beforeEach(pinViewport(MOBILE_WIDTH));

  it('MOBILE HALF 1 — auto-hide removes both blank rows, and DetailSection reports them as empty', () => {
    renderBody(WHITESPACE_BOTH_RUNGS_RECORD, activitySchema, ACTIVITY_FIELDS);

    expect(
      shown('Contract No'),
      'mobile auto-hide must fire on this fixture (3 rendered rows meets AUTO_HIDE_MIN_FIELDS 3, 2/3 empty clears AUTO_HIDE_RATIO 0.2) — this row is absent because it was HIDDEN, not because the dedupe took it',
    ).toBe(false);
    expect(
      shown('Activity Name'),
      'the second blank row is hidden by the same heuristic, for the same reason',
    ).toBe(false);

    // CONTROL — the grid rendered at all. Every negative above is trivially
    // true of a document that rendered nothing.
    expect(shown('4'), 'the one filled row must still render').toBe(true);

    // The count is the other half of the reading: a RAW emptiness test would
    // see 0 empty rows here and offer no toggle at all, so this line also pins
    // that `DetailSection` reads whitespace as empty (objectui#8376).
    const toggle = screen.queryByRole('button', { name: /empty fields/i });
    expect(
      toggle === null ? 'NO TOGGLE RENDERED' : toggle.textContent,
      'auto-hide must offer the reveal toggle, counting BOTH whitespace-only rows as empty',
    ).toContain('Show 2 empty fields');
  });

  it('MOBILE HALF 2 — the toggle brings the hidden rows back; the DEDUPED row never comes back', () => {
    renderBody(WHITESPACE_BOTH_RUNGS_RECORD, activitySchema, ACTIVITY_FIELDS);

    const toggle = screen.queryByRole('button', { name: /empty fields/i });
    expect(
      toggle,
      'without the reveal toggle there is nothing to reveal and this case measures nothing',
    ).not.toBeNull();
    fireEvent.click(toggle as HTMLElement);

    expect(
      shown('Contract No'),
      'revealing empty fields must bring back a row that auto-hide hid',
    ).toBe(true);
    expect(
      shown('Activity Name'),
      'revealing empty fields must bring back a row that auto-hide hid',
    ).toBe(true);

    // ⭐ The line between the two mechanisms. `label` carries `Acme Corporation`,
    // the value this record's H1 shows; the dedupe removed that field from the
    // section entirely, so no toggle can resurrect it. If this ever goes green,
    // the rows above were auto-hidden rather than deduped and every absence
    // asserted in the describe above is measuring the wrong mechanism.
    expect(
      shown('Acme Corporation'),
      'the dedupe REMOVES the duplicate row — revealing empty fields must not resurrect it',
    ).toBe(false);
  });
});
