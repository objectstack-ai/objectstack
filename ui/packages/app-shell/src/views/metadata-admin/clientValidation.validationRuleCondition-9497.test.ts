// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Draft-level CEL lint for object VALIDATION rules (objectui#9497).
 *
 * The gap this pins: `clientValidation` already lints the four sibling
 * surfaces — `visibleWhen` / `readonlyWhen` / `requiredWhen` and a `formula`
 * field's `expression` — at `scope: 'record'`, and linted nothing at all on an
 * object validation rule's predicate. That is not cosmetic: the server's rule
 * evaluator binds `{ record, previous }` and nothing else, and since
 * objectstack#4649 a predicate it cannot evaluate is fail-CLOSED — it rejects
 * every write to the object rather than skipping the rule. So a bare-shorthand
 * `amount > 100` was accepted by the draft gate and then wedged the object.
 *
 * ⛔ The editor route is NOT what these assert. objectui#8167 gave the inline
 * `ConditionBuilder` mount `scope="record"`; the JSON source editor, package
 * import and AI authoring routes all reach this gate without passing through
 * it. Every assertion below goes through `validateMetadataDraft`'s own verdict
 * — the gate — never through a helper's return value.
 *
 * Verdicts come from the REAL `@objectstack/formula` engine, so the draft
 * banner, the inline editor and the server reach the same answer.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { validateMetadataDraft } from './clientValidation';
import { __setCelFormulaLoader } from './celAuthoring';

afterEach(() => __setCelFormulaLoader(undefined));

/** Any issue this card's check can raise, at any nesting depth. */
const VALIDATION_PATH = /^validations\.\d+(\.(then|otherwise))*\.(condition|when)$/;

const draft = (validations: unknown[], extraFields: Record<string, unknown> = {}) => ({
  name: 'deal',
  label: 'Deal',
  fields: { amount: { type: 'number', label: 'Amount' }, ...extraFields },
  validations,
});

const script = (condition: unknown) => ({
  type: 'script',
  name: 'amount_cap',
  message: 'Amount is too large',
  condition,
});

describe('validateMetadataDraft — object validation rule predicates (real engine)', () => {
  // ── The red pin: the exact spelling the server fail-closes on ──────────
  it('flags a bare-shorthand condition with the record.<field> fix', async () => {
    const res = await validateMetadataDraft('object', draft([script('amount > 100')]));
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path === 'validations.0.condition');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/record\.amount/);
  });

  // ── Control 1: the CORRECT spelling stays clean ────────────────────────
  // Green on both sides of the fix. Without it, a linter that rejected
  // everything would satisfy the red pin above and measure nothing.
  it('is clean for the canonical record.<field> spelling', async () => {
    const res = await validateMetadataDraft('object', draft([script('record.amount > 100')]));
    expect(res.issues.filter((i) => VALIDATION_PATH.test(i.path))).toEqual([]);
    expect(res.ok).toBe(true);
  });

  // ── Control 2: a sibling key keeps its verdict ─────────────────────────
  // objectui#9497 ADDS a fifth check; it does not move or re-scope the four
  // that were already here. Both halves of the sibling's verdict are asserted
  // in one draft: the bad `visibleWhen` still flags, the good one still does
  // not.
  it('leaves the sibling field-rule verdicts exactly where they were', async () => {
    const res = await validateMetadataDraft(
      'object',
      draft([], {
        stage: { type: 'text', visibleWhen: 'amount > 1000' },
        owner_note: { type: 'text', visibleWhen: 'record.amount > 1000' },
      }),
    );
    const bad = res.issues.find((i) => i.path === 'fields.stage.visibleWhen');
    expect(bad).toBeTruthy();
    expect(bad!.message).toMatch(/record\.amount/);
    expect(res.issues.some((i) => i.path === 'fields.owner_note.visibleWhen')).toBe(false);
  });

  it('flags an unparsable condition under its validations.<i>.condition path', async () => {
    const res = await validateMetadataDraft('object', draft([script('record.amount >')]));
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.path === 'validations.0.condition')).toBe(true);
  });

  it('reads the ADR-0089 envelope wire shape as well as the bare string', async () => {
    const res = await validateMetadataDraft(
      'object',
      draft([script({ dialect: 'cel', source: 'amount > 100' })]),
    );
    expect(res.issues.some((i) => i.path === 'validations.0.condition')).toBe(true);
  });

  it('lints cross_field rules, which the server evaluates through the same checker', async () => {
    const res = await validateMetadataDraft(
      'object',
      draft([
        {
          type: 'cross_field',
          name: 'amount_vs_prior',
          message: 'Amount may not shrink',
          condition: 'amount < previous.amount',
          fields: ['amount'],
        },
      ]),
    );
    expect(res.issues.some((i) => i.path === 'validations.0.condition')).toBe(true);
  });

  // The spec spells a `conditional` rule's guard `when`, and the server's
  // conditional checker fail-closes on it with the same sentence it uses for
  // `condition`. Same harm, same gate, so the same lint.
  it('lints a conditional rule guard under its when path', async () => {
    const res = await validateMetadataDraft(
      'object',
      draft([
        {
          type: 'conditional',
          name: 'big_deals',
          message: 'Big deals need review',
          when: 'amount > 100',
          then: { type: 'script', name: 'needs_review', message: 'Needs review', condition: 'record.amount > 0' },
        },
      ]),
    );
    expect(res.issues.some((i) => i.path === 'validations.0.when')).toBe(true);
  });

  // The conditional checker dispatches the taken branch back through the same
  // rule evaluator with the same context, so a nested predicate fail-closes
  // identically. The Validations panel's `conditional` skeleton seeds exactly
  // this nesting.
  it('lints a nested then-branch rule predicate', async () => {
    const res = await validateMetadataDraft(
      'object',
      draft([
        {
          type: 'conditional',
          name: 'big_deals',
          message: 'Big deals need review',
          when: 'record.amount > 100',
          then: { type: 'script', name: 'needs_review', message: 'Needs review', condition: 'amount > 0' },
        },
      ]),
    );
    const issue = res.issues.find((i) => i.path === 'validations.0.then.condition');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/record\.amount/);
  });

  it('flags an unknown field reference, which the server also fail-closes on', async () => {
    const res = await validateMetadataDraft('object', draft([script('record.nope > 100')]));
    const issue = res.issues.find((i) => i.path === 'validations.0.condition');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/nope/);
  });

  it('ignores rule types that carry no CEL predicate', async () => {
    const res = await validateMetadataDraft(
      'object',
      draft([
        { type: 'format', name: 'amount_fmt', message: 'Bad format', field: 'amount', format: 'email' },
      ]),
    );
    expect(res.issues.filter((i) => VALIDATION_PATH.test(i.path))).toEqual([]);
  });

  it('is inert when the draft declares no validations', async () => {
    const res = await validateMetadataDraft('object', {
      name: 'deal',
      label: 'Deal',
      fields: { amount: { type: 'number' } },
    });
    expect(res.issues.filter((i) => VALIDATION_PATH.test(i.path))).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('skips non-CEL dialect envelopes (the engine owns that error, not the CEL lint)', async () => {
    const res = await validateMetadataDraft(
      'object',
      draft([script({ dialect: 'template', source: '!!!' })]),
    );
    expect(res.issues.filter((i) => VALIDATION_PATH.test(i.path))).toEqual([]);
  });

  it('fails open (no CEL issues) when the engine is unavailable', async () => {
    __setCelFormulaLoader(() => Promise.resolve(null));
    const res = await validateMetadataDraft('object', draft([script('amount > 100')]));
    expect(res.issues.filter((i) => VALIDATION_PATH.test(i.path))).toEqual([]);
  });
});
