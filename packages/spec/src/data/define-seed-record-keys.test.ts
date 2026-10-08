// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defineSeed` checks every record key against the object it seeds: at compile
 * time for a record literal (TypeScript's excess-property check over the
 * object's declared fields plus the injectable system columns), and when it
 * runs for every record, whatever its shape (declared fields plus the system
 * columns `resolveInjectedSystemColumns` gives THIS object).
 *
 * The `@ts-expect-error` lines are the compile-time half: this file is in the
 * `tsconfig.test.json` program `check:test-typecheck` compiles, so a type that
 * stopped refusing the key turns the directive into TS2578 there.
 */

import { describe, expect, it } from 'vitest';
import { Field } from './field.zod';
import { ObjectSchema, type ServiceObject } from './object.zod';
import { defineSeed } from './seed.zod';

const Lead = ObjectSchema.create({
  name: 'crm_lead',
  fields: {
    first_name: Field.text({ label: 'First Name' }),
    lead_source: Field.text({ label: 'Lead Source' }),
    account: Field.lookup('crm_account', { label: 'Account' }),
  },
});

/** The error `fn` throws; fails the test when it returns instead. */
function refusalOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('expected defineSeed to refuse the seed, and it returned');
}

describe('defineSeed refuses a record key the target object does not have', () => {
  it("the docblock's own ❌ example: an unknown key fails tsc, and is refused when it runs", () => {
    const error = refusalOf(() =>
      defineSeed(Lead, {
        externalId: 'first_name',
        // @ts-expect-error `source` is not a field of crm_lead (the defineSeed docblock's ❌ line)
        records: [{ first_name: 'Alice', lead_source: 'web' }, { source: 'web' }],
      }),
    );
    expect(error.message.split('\n')[0]).toContain("defineSeed('crm_lead')");
    expect(error.message).toContain('records[1]: `source` is not a field of `crm_lead`');
  });

  it('a misspelled key beside a spread of untyped rows: tsc is silent, the call refuses it and suggests the column', () => {
    // A spread of `Record<string, unknown>[]` in the array literal turns off
    // TypeScript's excess-property check on every inline record beside it, so
    // no `@ts-expect-error` here: this is the shape that passed `tsc`.
    const generated = (): readonly Record<string, unknown>[] => [{ first_name: 'Gen' }];
    const error = refusalOf(() =>
      defineSeed(Lead, {
        externalId: 'first_name',
        records: [{ first_name: 'Carol', created_atx: '2026-01-01' }, ...generated()],
      }),
    );
    expect(error.message).toContain('records[0]: `created_atx` is not a field of `crm_lead`');
    expect(error.message).toContain("Did you mean 'created_at'?");
  });

  it('records that never were a literal (a variable of untyped rows) are judged when the call runs', () => {
    const rows: Record<string, unknown>[] = [{ first_name: 'Dan' }, { first_name: 'Eve', lead_sorce: 'web' }];
    const error = refusalOf(() => defineSeed(Lead, { externalId: 'first_name', records: rows }));
    expect(error.message).toContain('records[1]: `lead_sorce` is not a field of `crm_lead`');
    expect(error.message).toContain("Did you mean 'lead_source'?");
  });

  it('an object whose `fields` type is a string-keyed record (ServiceObject) is judged when the call runs', () => {
    const Widened: ServiceObject = Lead;
    const error = refusalOf(() =>
      defineSeed(Widened, { externalId: 'first_name', records: [{ first_name: 'Fay', firstname: 'Fay' }] }),
    );
    expect(error.message).toContain('records[0]: `firstname` is not a field of `crm_lead`');
  });

  it('collects every unknown key across records into one refusal', () => {
    const rows: Record<string, unknown>[] = [{ first_name: 'A', zz_one: 1 }, { first_name: 'B' }, { zz_two: 2, zz_three: 3 }];
    const error = refusalOf(() => defineSeed(Lead, { externalId: 'first_name', records: rows }));
    expect(error.message.split('\n')[0]).toContain('zz_one, zz_two, zz_three');
    expect(error.message).toContain('records[0]: `zz_one`');
    expect(error.message).toContain('records[2]: `zz_two`');
    expect(error.message).toContain('records[2]: `zz_three`');
  });
});

describe('defineSeed accepts every key that names a column of the target object', () => {
  it('control: a seed of declared fields only passes and returns the parsed seed', () => {
    const seed = defineSeed(Lead, {
      externalId: 'first_name',
      records: [
        { first_name: 'Alice', lead_source: 'web' },
        { first_name: 'Bob', account: 'Acme Corp' },
      ],
    });
    expect(seed.object).toBe('crm_lead');
    expect(seed.records).toEqual([
      { first_name: 'Alice', lead_source: 'web' },
      { first_name: 'Bob', account: 'Acme Corp' },
    ]);
  });

  it('system-field control: created_at and the other injected columns pass tsc and the call', () => {
    const seed = defineSeed(Lead, {
      externalId: 'first_name',
      records: [
        { first_name: 'Alice', created_at: '2026-01-01T00:00:00.000Z' },
        { first_name: 'Bob', id: 'lead_bob', owner_id: 'admin@example.com', organization_id: 'org_1' },
      ],
    });
    expect(seed.records[0]).toEqual({ first_name: 'Alice', created_at: '2026-01-01T00:00:00.000Z' });
  });

  it('the injected set is THIS object\'s: created_at is refused on an object built with `systemFields: false`', () => {
    const Bare = ObjectSchema.create({
      name: 'crm_rate_card',
      systemFields: false,
      fields: { code: Field.text({ label: 'Code' }) },
    });
    // Compiles: the type admits every injectable name, because it cannot
    // evaluate the opt-out. The call reads the object's own plan.
    const error = refusalOf(() =>
      defineSeed(Bare, { externalId: 'code', records: [{ code: 'A', created_at: '2026-01-01' }] }),
    );
    expect(error.message).toContain('records[0]: `created_at` is not a field of `crm_rate_card`');
    // The driver's primary key exists even there.
    expect(defineSeed(Bare, { externalId: 'code', records: [{ code: 'B', id: 'rc_b' }] }).records).toHaveLength(1);
  });

  it("the injected set is THIS object's: owner_id is refused on an `ownership: 'org'` object, created_at is not", () => {
    const OrgOwned = ObjectSchema.create({
      name: 'crm_region',
      ownership: 'org',
      fields: { code: Field.text({ label: 'Code' }) },
    });
    const error = refusalOf(() =>
      defineSeed(OrgOwned, { externalId: 'code', records: [{ code: 'EU', owner_id: 'admin@example.com' }] }),
    );
    expect(error.message).toContain('records[0]: `owner_id` is not a field of `crm_region`');
    expect(defineSeed(OrgOwned, { externalId: 'code', records: [{ code: 'NA', created_at: '2026-01-01' }] }).records)
      .toHaveLength(1);
  });
});
