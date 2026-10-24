// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Draft-level CEL lint for object field conditional rules (objectui#1582).
 *
 * The spec Zod only checks the SHAPE of `visibleWhen` / `readonlyWhen` /
 * `requiredWhen` (`string | envelope`); these tests prove a shape-valid but
 * unparsable/mistyped predicate now surfaces as a `fields.<key>.<rule>` issue
 * from `validateMetadataDraft('object', …)` — against the REAL
 * `@objectstack/formula` engine, so the draft banner reaches the same verdict
 * as the inline editor and the server.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { validateMetadataDraft } from './clientValidation';
import { __setCelFormulaLoader } from './celAuthoring';

afterEach(() => __setCelFormulaLoader(undefined));

const RULE_PATH = /^fields\..+\.(visibleWhen|readonlyWhen|requiredWhen)$/;

const draftWith = (fields: unknown) => ({ name: 'account', label: 'Account', fields });

describe('validateMetadataDraft — object field conditional rules (real engine)', () => {
  it('flags a malformed predicate under its fields.<name>.<rule> path', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({ status: { type: 'text', visibleWhen: 'record.kind ==' } }),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.path === 'fields.status.visibleWhen')).toBe(true);
  });

  it('flags a bare field reference (record scope) with the record.<field> fix', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        amount: { type: 'number' },
        status: { type: 'text', requiredWhen: 'amount > 1000' },
      }),
    );
    const issue = res.issues.find((i) => i.path === 'fields.status.requiredWhen');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/record\.amount/);
  });

  it('is clean for valid predicates in both wire shapes (string and envelope)', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        amount: { type: 'number' },
        status: {
          type: 'text',
          visibleWhen: 'record.amount > 0',
          readonlyWhen: { dialect: 'cel', source: 'record.amount > 10' },
        },
      }),
    );
    expect(res.issues.filter((i) => RULE_PATH.test(i.path))).toEqual([]);
  });

  // `conditionalRequired` is no longer one of OUR lint keys — @objectstack/spec
  // 17 (#3855) retired it, so the draft is rejected by the spec parse itself,
  // and the rejection carries the rename prescription. We assert the author
  // still gets told, and told by the spec (AGENTS.md #0.1 — one contract).
  it('rejects the retired conditionalRequired alias via the spec tombstone', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({ status: { type: 'text', conditionalRequired: 'record.x == 1' } }),
    );
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path === 'fields.status.conditionalRequired');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/requiredWhen/);
  });

  it('uses index paths for the ARRAY fields shape', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith([{ name: 'status', type: 'text', visibleWhen: 'record.x ==' }]),
    );
    expect(res.issues.some((i) => i.path === 'fields.0.visibleWhen')).toBe(true);
  });

  it('skips non-CEL dialect envelopes (the engine owns that error, not the CEL lint)', async () => {
    // A well-typed NON-CEL dialect whose garbage `source` the CEL lint must
    // leave alone (`predicateSource` only extracts `dialect: undefined | 'cel'`).
    // Must stay a non-CEL dialect: `dialect: 'cel'` would make the lint OWN
    // `'!!!'` and flag it, flipping this assertion. `template` survives the
    // spec's `ExpressionDialect` narrowing (framework#3278 retired `js`).
    const res = await validateMetadataDraft(
      'object',
      draftWith({ status: { type: 'text', visibleWhen: { dialect: 'template', source: '!!!' } } }),
    );
    expect(res.issues.filter((i) => RULE_PATH.test(i.path))).toEqual([]);
  });

  it('fails open (no CEL issues) when the engine is unavailable', async () => {
    __setCelFormulaLoader(() => Promise.resolve(null));
    const res = await validateMetadataDraft(
      'object',
      draftWith({ status: { type: 'text', visibleWhen: 'record.kind ==' } }),
    );
    expect(res.issues.filter((i) => RULE_PATH.test(i.path))).toEqual([]);
  });
});

describe('validateMetadataDraft — formula field expressions (role value, real engine)', () => {
  it('flags a malformed formula under fields.<name>.expression', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        amount: { type: 'number' },
        total: { type: 'formula', expression: 'record.amount *' },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.path === 'fields.total.expression')).toBe(true);
  });

  it('flags a bare field reference with the record.<field> fix', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        amount: { type: 'number' },
        total: { type: 'formula', expression: 'amount * 0.2' },
      }),
    );
    const issue = res.issues.find((i) => i.path === 'fields.total.expression');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/record\.amount/);
  });

  it('is clean for a valid formula in both wire shapes', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        amount: { type: 'number' },
        total: { type: 'formula', expression: 'record.amount * 0.2' },
        margin: { type: 'formula', expression: { dialect: 'cel', source: 'record.amount * 0.1' } },
      }),
    );
    expect(res.issues.filter((i) => i.path.endsWith('.expression'))).toEqual([]);
  });

  it('does NOT lint expression on non-formula fields (summary has none)', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'count' } },
      }),
    );
    expect(res.issues.filter((i) => i.path.endsWith('.expression'))).toEqual([]);
  });
});
