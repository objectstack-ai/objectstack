// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Seed records the seed load refuses, judged at `os validate` / `os build`
 * time by the WRITE PATH'S OWN evaluator (#35653, folding #35486).
 *
 * The walk is `judgeSeedRowRefusals` (`@objectstack/lint`); the verdict is
 * `evaluateValidationRules` (`@objectstack/objectql`), injected exactly as the
 * two command files inject it. The stacks go through the real stack parse, so
 * the datasets carry the defaults the commands see (`externalId: 'name'`,
 * `mode: 'ignore'`), and the datasets are found by the commands' own
 * `datasetsOf`. The blank-key sentence is held equal to the one the real seed
 * loader returns for the same record, so the two cannot drift.
 *
 * Four pins (the card's): a record a rule refuses, named by the rule; a
 * record that passes; a rule this door cannot judge (it reads a roll-up),
 * counted and NOT reported, although the evaluator, handed the record as
 * written, would refuse it; a blank key field on an `upsert` dataset.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
import { evaluateValidationRules } from '@objectstack/objectql';
import { judgeSeedRowRefusals, SEED_RECORD_KEY_FIELD_BLANK, SEED_ROW_REFUSED_BY_VALIDATION_RULE } from '@objectstack/lint';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { datasetsOf } from '../src/utils/bundle-seed-files.js';
import { authoringRuleUnionStack } from '../src/utils/stack-collections.js';

type AnyRec = Record<string, unknown>;

const INVOICE = {
  name: 'xt_invoice',
  label: 'Invoice',
  fields: {
    name: { type: 'text', label: 'Number' },
    total: { type: 'currency', label: 'Total' },
    // A roll-up the load recomputes after each payment lands.
    amount_paid: { type: 'summary', label: 'Paid', summaryOperations: { object: 'xt_payment', field: 'amount', function: 'sum' } },
  },
  validations: [
    {
      type: 'script',
      name: 'paid_within_total',
      condition: 'record.amount_paid > record.total',
      message: 'An invoice may not be paid beyond its total.',
    },
  ],
};

const PAYMENT = {
  name: 'xt_payment',
  label: 'Payment',
  fields: {
    name: { type: 'text', label: 'Reference' },
    amount: { type: 'currency', label: 'Amount' },
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'xt_invoice' },
  },
  validations: [
    {
      type: 'script',
      name: 'amount_positive',
      condition: 'record.amount <= 0',
      message: 'A payment amount must be positive.',
    },
  ],
};

function parsedStack(data: AnyRec[]): AnyRec {
  return ObjectStackDefinitionSchema.parse({ objects: [INVOICE, PAYMENT], data }) as AnyRec;
}

/** The call `os validate` step 3d-ter and `os build` step 4a-0-bis make. */
function judge(stack: AnyRec) {
  const union = authoringRuleUnionStack(stack);
  return judgeSeedRowRefusals({ datasets: datasetsOf(stack), stack: union, evaluateValidationRules });
}

describe('os validate / os build: seed records against the package\'s own validation rules', () => {
  it('a record its rule refuses is named by location, index and rule; the record beside it passes', () => {
    const out = judge(parsedStack([
      { object: 'xt_payment', records: [{ name: 'P1', amount: 25 }, { name: 'P2', amount: -10 }] },
    ]));
    expect(out.refusals).toEqual([{
      rule: SEED_ROW_REFUSED_BY_VALIDATION_RULE,
      location: 'data[0].records[1]',
      object: 'xt_payment',
      recordIndex: 1,
      validationRule: 'amount_positive',
      message: "Seed record #1 of 'xt_payment' is refused by its validation rule 'amount_positive': A payment amount must be positive.",
    }]);
  });

  it('CONTROL: every record passing its rules yields no finding', () => {
    const out = judge(parsedStack([
      { object: 'xt_payment', records: [{ name: 'P1', amount: 25 }, { name: 'P2', amount: 10 }] },
    ]));
    expect(out.refusals).toEqual([]);
  });

  it('a rule reading a roll-up is counted as not judged, never reported — though the evaluator would refuse the record as written', () => {
    const invoice = { name: 'INV-1', total: 100, amount_paid: 500 };
    const out = judge(parsedStack([{ object: 'xt_invoice', records: [invoice] }]));
    expect(out.refusals).toEqual([]);
    expect(out.notJudged['field-value']).toBe(1);
    // What a door that handed the record as written would have said: a refusal
    // the load never gives, since the load recomputes the roll-up.
    expect(() => evaluateValidationRules(INVOICE as never, invoice, 'insert', { skipStateMachine: true }))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('a record whose rule cannot be evaluated on its own values is reported: the write fails such a rule closed', () => {
    const out = judge(parsedStack([{ object: 'xt_payment', records: [{ name: 'P1' }] }]));
    expect(out.refusals.map((r) => [r.location, r.validationRule])).toEqual([['data[0].records[0]', 'amount_positive']]);
    expect(out.refusals[0].message).toContain("could not be evaluated");
  });
});

/** A metadata service holding the two objects, and an engine the dry run must never reach. */
function dryRunLoader(): SeedLoaderService {
  const objects: Record<string, AnyRec> = { xt_invoice: INVOICE, xt_payment: PAYMENT };
  const metadata = {
    getObject: vi.fn(async (name: string) => objects[name]),
    get: vi.fn(async (_type: string, name: string) => objects[name]),
    list: vi.fn(async () => Object.values(objects)),
    listObjects: vi.fn(async () => Object.values(objects)),
  } as unknown as IMetadataService;
  // Every engine verb refuses: a dry run into a named organization reads and
  // writes nothing, so any call reaching the engine is the failure.
  const engine = new Proxy({}, {
    get: (_target, verb) => () => { throw new Error(`a dry run reached the engine: ${String(verb)}`); },
  }) as unknown as IDataEngine;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return new SeedLoaderService(engine, metadata, logger as never);
}

describe('os validate / os build: a keyed seed record with a blank key field (#35486)', () => {
  it('names the object, record index and field, in the very sentence the seed loader refuses it with', async () => {
    const stack = parsedStack([
      { object: 'xt_payment', mode: 'upsert', records: [{ name: 'P1', amount: 25 }, { name: '', amount: 5 }] },
    ]);
    const out = judge(stack);
    expect(out.refusals.map(({ rule, location, object, recordIndex, field }) => ({ rule, location, object, recordIndex, field })))
      .toEqual([{ rule: SEED_RECORD_KEY_FIELD_BLANK, location: 'data[0].records[1]', object: 'xt_payment', recordIndex: 1, field: 'name' }]);

    const loaded = await dryRunLoader().validate(stack.data as never[], { organizationId: 'org_seed_rules' } as never);
    const loaderSentence = loaded.errors.find((e) => e.recordIndex === 1 && e.sourceObject === 'xt_payment')?.message;
    expect(loaderSentence).toBeDefined();
    expect(out.refusals[0].message).toBe(loaderSentence);
  });
});
