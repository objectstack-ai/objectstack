// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #11293 — "what is this record called?", resolved from the object's own
// declaration instead of re-composed per hook.
//
// ## What these pins are protecting, and why the FORMULA arm is the centre
//
// The exemplar app carried FIVE inline reimplementations of a record title
// inside hook bodies, and in FOUR of the five the object's `nameField` points
// at a FORMULA (`display_title`, `full_name`); only one is a real column. A
// title accessor that reads stored columns only would therefore answer the
// wrong four of five — so the formula arm is not an extension of the column
// arm here, it is the default case and the column arm is the fallout.
//
// ## ⚠️ The vacuity trap this file is built to avoid
//
// An accessor test passes TRIVIALLY if the fixture's `nameField` happens to be
// a plain column, or if the formula happens to evaluate to the same string as
// some stored column — in both cases "the formula was evaluated" and "the
// stored value was read" are indistinguishable in the assertion. Every formula
// fixture below therefore composes a title that equals NO single stored column
// on the record, and `titleDiffersFromEveryStoredColumn` asserts exactly that
// as a control. Without it a naive column-reading implementation would sit
// green through the case it gets wrong.
//
// ## Rebuild is NOT load-bearing for this file
//
// Every import here is RELATIVE (`./record-title.js`, `./engine.js`), so vitest
// resolves them to this package's SOURCE. There is no `exports` hop to `dist/`
// and therefore no build artifact standing between an edit and this suite. The
// runtime-side seam suite (`packages/runtime/src/sandbox/`) is the opposite
// regime — it reaches this code through `@objectstack/objectql`, which resolves
// through `exports` to `dist/` — and says so in its own header.

import { describe, it, expect } from 'vitest';
import {
  resolveRecordTitle,
  resolveRelatedTitleTarget,
  titleFieldOf,
  RecordTitleFieldError,
} from './record-title.js';
import { evaluateFormulaField } from './engine.js';

/** `crm_case` — the measured shape: `nameField` is a FORMULA. */
const CASE = {
  name: 'rt_case',
  label: 'Case',
  nameField: 'display_title',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    case_number: { name: 'case_number', label: 'No.', type: 'text' as const },
    subject: { name: 'subject', label: 'Subject', type: 'text' as const },
    status: { name: 'status', label: 'Status', type: 'text' as const },
    account_id: { name: 'account_id', label: 'Account', type: 'lookup' as const, reference: 'rt_account' },
    owner: { name: 'owner', label: 'Owner', type: 'user' as const },
    display_title: {
      name: 'display_title', label: 'Title', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.case_number + " — " + record.subject' },
    },
  },
};

/** `crm_opportunity` — the ONE measured object whose title is a real column. */
const OPPORTUNITY = {
  name: 'rt_opportunity',
  label: 'Opportunity',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    stage: { name: 'stage', label: 'Stage', type: 'text' as const },
  },
};

const ACCOUNT = {
  name: 'rt_account',
  label: 'Account',
  nameField: 'display_title',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    legal_name: { name: 'legal_name', label: 'Legal name', type: 'text' as const },
    region: { name: 'region', label: 'Region', type: 'text' as const },
    display_title: {
      name: 'display_title', label: 'Title', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.legal_name + " (" + record.region + ")"' },
    },
  },
};

/**
 * THE VACUITY CONTROL.
 *
 * Asserts the resolved title is not merely one of the record's stored values
 * echoed back — i.e. that the formula genuinely ran and genuinely composed. A
 * column-reading implementation cannot satisfy this for any of the formula
 * fixtures above.
 */
function titleDiffersFromEveryStoredColumn(
  title: string | undefined,
  record: Record<string, unknown>,
): void {
  expect(typeof title).toBe('string');
  const stored = Object.entries(record)
    .filter(([k]) => k !== 'display_title' && k !== 'full_name')
    .map(([, v]) => v);
  expect(stored).not.toContain(title);
  // …and it is not the id either, which is the value the defect reached for.
  expect(title).not.toBe(record.id);
}

describe('#11293 titleFieldOf — the ADR-0079 pointer', () => {
  it('reads `nameField`', () => {
    expect(titleFieldOf(CASE)).toBe('display_title');
  });

  it('honours the deprecated `displayNameField` alias when `nameField` is absent', () => {
    expect(titleFieldOf({ displayNameField: 'legacy_title', fields: {} })).toBe('legacy_title');
  });

  it('`nameField` WINS over the deprecated alias — canonical first, no ambiguity', () => {
    expect(titleFieldOf({ nameField: 'a', displayNameField: 'b', fields: {} })).toBe('a');
  });

  it('undefined when the object declares no pointer at all', () => {
    expect(titleFieldOf({ fields: {} })).toBeUndefined();
    expect(titleFieldOf(undefined)).toBeUndefined();
  });
});

describe('#11293 resolveRecordTitle — a FORMULA nameField (the majority case)', () => {
  const record = {
    id: 'a1b2c3d4e5f6g7h8',
    case_number: 'CASE-0042',
    subject: 'Printer on fire',
    status: 'open',
  };

  it('composes the declared formula server-side, with no round trip', () => {
    const title = resolveRecordTitle(CASE, record);
    expect(title).toBe('CASE-0042 — Printer on fire');
  });

  it('CONTROL — the composed title equals no single stored column, so the formula really ran', () => {
    titleDiffersFromEveryStoredColumn(resolveRecordTitle(CASE, record), record);
  });

  it('a formula that cannot EVALUATE answers absence, never a half-composed lie', () => {
    // `subject` missing entirely: `applyFormulaPlan` records the evaluator's
    // failure as `null`, which surfaces here as `undefined`.
    const partial = { id: 'x', case_number: 'CASE-0043' };
    expect(resolveRecordTitle(CASE, partial)).toBeUndefined();
  });

  it('never falls back to the record id', () => {
    // No pointer at all — the one place an id fallback would be tempting.
    const untitled = { name: 'rt_untitled', fields: { id: { name: 'id', type: 'text' as const } } };
    expect(resolveRecordTitle(untitled, { id: 'a1b2c3d4e5f6g7h8' })).toBeUndefined();
  });
});

describe('#11293 resolveRecordTitle — a STORED-COLUMN nameField', () => {
  it('reads the column straight off the record', () => {
    expect(resolveRecordTitle(OPPORTUNITY, { id: 'o1', name: 'Acme — Phase 2', stage: 'won' }))
      .toBe('Acme — Phase 2');
  });

  it('absent column → undefined, not the empty string and not the id', () => {
    expect(resolveRecordTitle(OPPORTUNITY, { id: 'o1', stage: 'won' })).toBeUndefined();
  });

  it('a genuinely blank title is reported as blank, not as absence', () => {
    // `''` and "no title pointer" are different facts about the object; a
    // consumer that collapses them hides a misconfigured object behind a `??`.
    expect(resolveRecordTitle(OPPORTUNITY, { id: 'o1', name: '' })).toBe('');
  });

  it('a non-string scalar title is stringified rather than dropped', () => {
    const numbered = { nameField: 'seq', fields: { seq: { name: 'seq', type: 'number' as const } } };
    expect(resolveRecordTitle(numbered, { seq: 42 })).toBe('42');
  });
});

describe('#11293 evaluateFormulaField — narrowed to ONE field on purpose', () => {
  it('an unrelated MALFORMED formula elsewhere on the object does not break the title', () => {
    // `planFormulaProjection(schema, undefined)` — the shape `find` uses —
    // compiles every formula on the schema at planning stage, so a title
    // lookup planned that way would throw on a neighbour's typo. Narrowing to
    // the requested field is what keeps a title's blast radius its own
    // declaration.
    const withBadNeighbour = {
      ...CASE,
      fields: {
        ...CASE.fields,
        broken: {
          name: 'broken', label: 'Broken', type: 'formula' as const,
          expression: { dialect: 'cel', source: 'record.a +++ ' },
        },
      },
    };
    const record = { id: 'c1', case_number: 'CASE-0044', subject: 'Still fine' };
    expect(resolveRecordTitle(withBadNeighbour, record)).toBe('CASE-0044 — Still fine');
  });

  it('answers undefined for a field that is not a declared formula — the signal to read the column', () => {
    expect(evaluateFormulaField(OPPORTUNITY, { name: 'Acme' }, 'name')).toBeUndefined();
  });

  it('does NOT mutate the record it is handed', () => {
    // `applyFormulaPlan` writes the computed value onto the record it receives,
    // and the records reaching here are the engine's own hook payloads.
    const record: Record<string, unknown> = { id: 'c1', case_number: 'CASE-0045', subject: 'Untouched' };
    const before = JSON.stringify(record);
    resolveRecordTitle(CASE, record);
    expect(JSON.stringify(record)).toBe(before);
    expect('display_title' in record).toBe(false);
  });
});

describe('#11293 resolveRelatedTitleTarget — a lookup column hands the body an id', () => {
  const record = { id: 'c1', case_number: 'CASE-0046', subject: 'x', account_id: 'acc_9', owner: 'usr_3' };

  it('resolves an author-declared lookup to its target object and the stored id', () => {
    expect(resolveRelatedTitleTarget(CASE, record, 'account_id', 'test'))
      .toEqual({ object: 'rt_account', id: 'acc_9' });
  });

  it('resolves a `user` field whose target is fixed BY THE TYPE (no `reference` key)', () => {
    // cloud#983: a raw `field.reference` read makes `{ type: 'user' }` look
    // targetless even though `Field.user()` takes no target argument.
    // `referenceTargetOf` is the single arbiter, and this is why it is used.
    expect(resolveRelatedTitleTarget(CASE, record, 'owner', 'test'))
      .toEqual({ object: 'sys_user', id: 'usr_3' });
  });

  it('an EMPTY lookup is an ordinary state — undefined, not an error', () => {
    expect(resolveRelatedTitleTarget(CASE, { ...record, account_id: null }, 'account_id', 'test'))
      .toBeUndefined();
    expect(resolveRelatedTitleTarget(CASE, { ...record, account_id: '' }, 'account_id', 'test'))
      .toBeUndefined();
  });

  it('an ALREADY-EXPANDED reference still yields its id', () => {
    const expanded = { ...record, account_id: { id: 'acc_9', legal_name: 'Acme' } };
    expect(resolveRelatedTitleTarget(CASE, expanded, 'account_id', 'test'))
      .toEqual({ object: 'rt_account', id: 'acc_9' });
  });

  it('an UNDECLARED field name throws — a typo must not read as "no title"', () => {
    expect(() => resolveRelatedTitleTarget(CASE, record, 'acount_id', 'test'))
      .toThrow(RecordTitleFieldError);
    expect(() => resolveRelatedTitleTarget(CASE, record, 'acount_id', 'test'))
      .toThrow(/not a declared field/);
  });

  it('a declared NON-reference field throws, naming its type and the remedy', () => {
    expect(() => resolveRelatedTitleTarget(CASE, record, 'subject', 'test'))
      .toThrow(/does not point at another record/);
  });

  it('the related object\'s own FORMULA title resolves the same way', () => {
    const related = { id: 'acc_9', legal_name: 'Acme Industrial', region: 'EMEA' };
    const title = resolveRecordTitle(ACCOUNT, related);
    expect(title).toBe('Acme Industrial (EMEA)');
    titleDiffersFromEveryStoredColumn(title, related);
  });
});
