// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8220, A of the #7929 ruling] The provenance-aware half of the cross-field
 * withhold: a subtree positively marked `'author'` gets its full diagnostic
 * back on the wire; `'policy'`, unmarked and ambiguous all keep the #7929
 * redaction. This file pins the CONSUMER — the two seams in `SqlDriver` that
 * resolve a refusal against the query's own `where` root — on a real driver.
 *
 * The three-way split matters more than either end of it:
 *
 *  - `author ≠ policy` is the capability this card adds (B pinned them
 *    byte-identical, deliberately, until the mark existed);
 *  - `unmarked = policy` is the FAIL DIRECTION — the mark is permission to
 *    reveal, and a missing mark must never land on the disclosing branch. The
 *    byte-equality that used to pin author-vs-policy now pins
 *    unmarked-vs-policy, which is the half of B that survives A.
 *
 * The two merge boundaries' own stamping is pinned in their own packages
 * (plugin-security, service-analytics) and end-to-end in
 * `packages/runtime/src/cross-field-refusal-operand-withhold.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import {
  markFilterSubtreeProvenance,
  type FilterCondition,
} from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#8220] cross-field refusal × filter-subtree provenance', () => {
  let driver: SqlDriver;
  let logged: string[];

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          amount: { type: 'number', name: 'amount' },
          budget: { type: 'number', name: 'budget' },
          organization_id: { type: 'text', name: 'organization_id' },
        },
      } as any,
    ]);
    await driver.create('deal', {
      id: '1', stage: 'won', amount: 10, budget: 5, organization_id: 'o1',
    });
    logged = [];
    (driver as unknown as { logger: unknown }).logger = {
      warn: (m: string) => { logged.push(String(m)); },
      error: () => {},
      info: () => {},
      debug: () => {},
    };
  });

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await driver.find('deal', { fields: ['id'], where: where as FilterCondition });
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  // The one predicate every case below spells: a cross-field reference at an
  // operator whose position SQL push-down does not compile ($contains takes a
  // literal). Column names chosen to read as what each case casts them as.
  const uncompilable = () => ({ stage: { $contains: { $field: 'organization_id' } } });

  it("an 'author'-marked filter gets its operands back — eager, top-level position", async () => {
    const where = markFilterSubtreeProvenance(uncompilable(), 'author');
    const err = await refusalOf(where);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('stage');
    expect(err.message).toContain('organization_id');
    expect(err.message).toContain('$contains');
    // Restored on the wire ⇒ nothing left to relocate to the log.
    expect(logged.join('\n')).toBe('');
  });

  it("an 'author'-marked arm inside a merged $and discloses too — the LAZY group-callback position", async () => {
    // The exact shape a merge boundary produces. The refusal here MUST be one
    // only the EMITTER raises (an undeclared referenced column at a scalar
    // operator — the walk skips the six), because the emitter for a nested arm
    // runs inside a knex group callback, LAZILY, past `applyFilters`' catch:
    // this is the seam `withWithheldFilterLog` threads the root for.
    const authorArm = markFilterSubtreeProvenance(
      { amount: { $gt: { $field: 'no_such_column' } } },
      'author',
    );
    const where = { $and: [{ amount: { $gt: { $field: 'budget' } } }, authorArm] };
    const err = await refusalOf(where);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('no_such_column');
    expect(err.message).toContain('not a declared field');
  });

  it("a 'policy'-marked filter keeps the redaction, and the diagnostic reaches the log", async () => {
    const where = markFilterSubtreeProvenance(uncompilable(), 'policy');
    const err = await refusalOf(where);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('stage');
    expect(err.message).not.toContain('organization_id');
    expect(logged.join('\n')).toContain('organization_id');
  });

  it('an UNMARKED filter withholds byte-identically to a policy-marked one — the fail direction', async () => {
    const unmarked = await refusalOf(uncompilable());
    logged = [];
    const policy = await refusalOf(markFilterSubtreeProvenance(uncompilable(), 'policy'));
    expect(unmarked.message).toBe(policy.message);
    expect(unmarked.code).toBe('INVALID_FILTER');
    expect(unmarked.message).not.toContain('organization_id');
  });

  it('a serialization round-trip DROPS an author mark — the copy withholds', async () => {
    const marked = markFilterSubtreeProvenance(uncompilable(), 'author');
    const err = await refusalOf(JSON.parse(JSON.stringify(marked)));
    expect(err.message).not.toContain('organization_id');
    expect(logged.join('\n')).toContain('organization_id');
  });

  it("the innermost mark wins: 'policy' nested under an 'author' root stays redacted", async () => {
    const scope = markFilterSubtreeProvenance(uncompilable(), 'policy');
    const where = markFilterSubtreeProvenance(
      { $and: [{ amount: { $gt: 1 } }, scope] },
      'author',
    );
    const err = await refusalOf(where);
    expect(err.message).not.toContain('organization_id');
    expect(logged.join('\n')).toContain('organization_id');
  });

  it('a subtree aliased under CONFLICTING marks is ambiguous and withholds', async () => {
    const shared = uncompilable();
    const where = {
      $or: [
        markFilterSubtreeProvenance({ $and: [shared] }, 'author'),
        markFilterSubtreeProvenance({ $and: [shared] }, 'policy'),
      ],
    };
    const err = await refusalOf(where);
    expect(err.message).not.toContain('organization_id');
  });

  it('the boundary-reason family (uncompilableFieldReferenceError) discloses its reason for an author', async () => {
    // An undeclared referenced column at a COMPILABLE operator — the #5222
    // validation-boundary arm, raised inside the cross-field emitter.
    const where = markFilterSubtreeProvenance(
      { amount: { $gt: { $field: 'no_such_column' } } },
      'author',
    );
    const err = await refusalOf(where);
    expect(err.message).toContain('no_such_column');
    expect(err.message).toContain('not a declared field');
    // …and the same spelling unmarked stays generic.
    logged = [];
    const withheld = await refusalOf({ amount: { $gt: { $field: 'no_such_column' } } });
    expect(withheld.message).not.toContain('no_such_column');
    expect(logged.join('\n')).toContain('no_such_column');
  });

  it('a list-member reference names its index for an author', async () => {
    const where = markFilterSubtreeProvenance(
      { amount: { $in: [1, { $field: 'budget' }] } },
      'author',
    );
    const err = await refusalOf(where);
    expect(err.message).toContain('budget');
    expect(err.message).toContain('index 1');
  });

  it('a bare `$field` spec gets its corrected spelling back for an author', async () => {
    const where = markFilterSubtreeProvenance({ amount: { $field: 'budget' } }, 'author');
    const err = await refusalOf(where);
    expect(err.message).toContain('{ "amount": { "$eq": { "$field": "budget" } } }');
  });

  it("the tenant-column arm still discloses to a positively marked author — they typed the column", async () => {
    const where = markFilterSubtreeProvenance(
      { stage: { $eq: { $field: 'organization_id' } } },
      'author',
    );
    const err = await refusalOf(where);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('organization_id');
  });
});
