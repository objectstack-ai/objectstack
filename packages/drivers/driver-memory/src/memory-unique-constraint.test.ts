// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13197] `driver-memory` enforces field-level `unique` — a colliding write is
 * REFUSED, not landed.
 *
 * The card's motivating instance is an autonumber allocated out-of-process:
 * the engine's `createWithAutonumberResync` re-seeds and re-issues only when
 * the STORE rejects the duplicate, so on a store that rejected nothing a
 * duplicate business identifier landed with no error anywhere. Nothing in this
 * file knows what an autonumber is — the defect was that the driver enforced no
 * uniqueness AT ALL, and that is what is pinned here.
 *
 * ## Two things every refusal test in this package must do
 *
 *  1. **Assert the ENVELOPE, never merely "it threw"** (#6144). A bare `Error`
 *     from an unrelated fault satisfies `toThrow()` and says nothing about the
 *     contract; `code` AND `status` are the contract (ADR-0112), and they are
 *     the SQL family's values so a suite that swaps this driver for SQLite sees
 *     one envelope.
 *  2. **Assert the store is UNCHANGED.** "Refused" and "refused after writing
 *     the row" are different facts, and only the second one is the bug wearing
 *     an error message.
 *
 * ## The scoping arms are `driver-sql`'s, and are pinned as such
 *
 * ADR-0120 D1/D3, read off `uniqueIndexesFromFields`: `'global'` is
 * platform-wide, bare `true` and `'organization'` are per-organization (bare
 * `true` is the POSITIONAL spelling of `'organization'` at FIELD level, not of
 * `'global'` — the #4986 trap), and both degrade to a single-column constraint
 * when the object has no tenant column. This package cannot import `driver-sql`
 * (dependency direction), so the arms are reproduced and pinned here against
 * that rule rather than shared.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { InMemoryDriver } from './memory-driver.js';
import {
  UNIQUE_VIOLATION_CODE,
  UNIQUE_VIOLATION_STATUS,
  tenantFieldOf,
  uniqueConstraintsFromFields,
} from './memory-unique-constraint.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** Run `fn`, requiring it to reject; hand back the rejection for inspection. */
async function refusalOf(fn: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await fn();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this write, but it resolved');
}

/** The envelope assertion, in one place — `code` AND `status`, never just "it threw". */
function expectUniqueViolationEnvelope(err: WireBearingError, field: string) {
  expect(err.code).toBe(UNIQUE_VIOLATION_CODE);
  expect(err.status).toBe(UNIQUE_VIOLATION_STATUS);
  expect(err.code).toBe('UNIQUE_VIOLATION');
  expect(err.status).toBe(409);
  expect(err.message).toContain(field);
  // Same no-driver-prefix rule the filter refusals hold: the wire identity is
  // the SQL family's, and a driver name in the sentence breaks that parity.
  expect(err.message).not.toContain('[driver-memory]');
}

const DOC_SCHEMA = {
  name: 'doc',
  fields: {
    id: { type: 'text', name: 'id' },
    title: { type: 'text', name: 'title' },
    doc_no: { type: 'autonumber', name: 'doc_no', unique: true },
  },
};

describe('[#13197] the motivating instance: a duplicate autonumber is REFUSED, not landed', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
  });

  it('the second row carrying an already-stored record number is refused, and nothing is written', async () => {
    await driver.create('doc', { id: '1', title: 'first', doc_no: 'D-0005' });

    const err = await refusalOf(() => driver.create('doc', { id: '2', title: 'second', doc_no: 'D-0005' }));

    expectUniqueViolationEnvelope(err, 'doc_no');
    // The half that makes it a fix rather than a louder bug: ONE row, not two.
    const rows = await driver.find('doc', { fields: ['id', 'doc_no'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('1');
  });

  it('the refusal is recognisable to the ENGINE, so the autonumber resync converges', async () => {
    // Load-bearing, not cosmetic. `ObjectQL.createWithAutonumberResync` drops
    // the stale counter, re-seeds and re-issues ONLY when
    // `isUniqueViolationError` says the rejection was a conflict. A refusal it
    // does not recognise propagates with the counter still warm and the next
    // insert collides too — #5495's PROBE3 storm, i.e. a silent duplicate
    // traded for a non-converging insert loop. #13197 added the platform's own
    // `UNIQUE_VIOLATION` code to that predicate's `codes` channel for exactly
    // this edge; if this assertion goes red, the trade is no longer honest.
    await driver.create('doc', { id: '1', doc_no: 'D-0005' });
    const err = await refusalOf(() => driver.create('doc', { id: '2', doc_no: 'D-0005' }));

    expect(isUniqueViolationError(err)).toBe(true);
  });

  it('a DIFFERENT record number still lands — the constraint is not a blanket refusal', async () => {
    await driver.create('doc', { id: '1', doc_no: 'D-0005' });
    const written = await driver.create('doc', { id: '2', doc_no: 'D-0006' });
    expect(written.doc_no).toBe('D-0006');
    expect(await driver.count('doc')).toBe(2);
  });
});

describe('[#13197] every write path goes through the constraint, not just create', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: '1', doc_no: 'D-0001' });
    await driver.create('doc', { id: '2', doc_no: 'D-0002' });
  });

  it('update onto a taken value is refused and the row keeps its old value', async () => {
    const err = await refusalOf(() => driver.update('doc', '2', { doc_no: 'D-0001' }));
    expectUniqueViolationEnvelope(err, 'doc_no');
    expect((await driver.findOne('doc', { fields: ['doc_no'], where: { id: '2' } }))!.doc_no).toBe('D-0002');
  });

  it('a row does not collide with ITSELF — an update that leaves the unique field alone passes', async () => {
    const updated = await driver.update('doc', '2', { title: 'renamed' });
    expect(updated!.doc_no).toBe('D-0002');
    // And re-writing the row's OWN value is not a collision either.
    expect((await driver.update('doc', '2', { doc_no: 'D-0002' }))!.doc_no).toBe('D-0002');
  });

  it('bulkCreate catches a duplicate WITHIN the batch, not only against stored rows', async () => {
    const err = await refusalOf(() =>
      driver.bulkCreate('doc', [{ id: 'a', doc_no: 'D-0100' }, { id: 'b', doc_no: 'D-0100' }]),
    );
    expectUniqueViolationEnvelope(err, 'doc_no');
  });

  it('updateMany refuses BEFORE mutating anything — no half-applied batch', async () => {
    // Stamping one value onto two rows collides by construction. The refusal
    // has to leave both rows alone: a partially applied batch is the shape that
    // makes a caller's retry unsafe.
    const err = await refusalOf(() => driver.updateMany('doc', { where: {} }, { doc_no: 'D-0009' }));
    expectUniqueViolationEnvelope(err, 'doc_no');

    const rows = await driver.find('doc', { fields: ['id', 'doc_no'], orderBy: [{ field: 'id', order: 'asc' }] });
    expect(rows.map((r: any) => r.doc_no)).toEqual(['D-0001', 'D-0002']);
  });

  it('upsert on a conflict key UPDATES the existing row rather than colliding with it', async () => {
    const out = await driver.upsert('doc', { doc_no: 'D-0001', title: 'upserted' }, ['doc_no']);
    expect(out!.id).toBe('1');
    expect(await driver.count('doc')).toBe(2);
  });
});

describe('[#13197] what is NOT constrained — the boundaries, stated so they are not read as gaps', () => {
  it('a field with no `unique` declaration takes duplicates as before', async () => {
    const driver = new InMemoryDriver();
    await driver.syncSchema('note', { name: 'note', fields: { id: { type: 'text' }, body: { type: 'text' } } });
    await driver.create('note', { id: '1', body: 'same' });
    await driver.create('note', { id: '2', body: 'same' });
    expect(await driver.count('note')).toBe(2);
  });

  it('an object that never passed through syncSchema is unconstrained — the driver does not infer constraints from data', async () => {
    const driver = new InMemoryDriver();
    await driver.create('undeclared', { id: '1', doc_no: 'D-1' });
    await driver.create('undeclared', { id: '2', doc_no: 'D-1' });
    expect(await driver.count('undeclared')).toBe(2);
  });

  it('NULL stays NULL-DISTINCT, exactly as under SQL UNIQUE', async () => {
    // Folding empty values together would refuse the second row of every table
    // with an optional unique column — a refusal driver-sql does not issue, so
    // it would be a fresh divergence introduced by the fix for a divergence.
    const driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.create('doc', { id: '1', doc_no: null });
    await driver.create('doc', { id: '2', doc_no: null });
    await driver.create('doc', { id: '3' }); // absent, not null
    expect(await driver.count('doc')).toBe(3);
  });

  it('dropTable forgets the declaration — a constraint must not outlive its table', async () => {
    const driver = new InMemoryDriver();
    await driver.syncSchema('doc', DOC_SCHEMA);
    await driver.dropTable('doc');
    await driver.create('doc', { id: '1', doc_no: 'D-1' });
    await driver.create('doc', { id: '2', doc_no: 'D-1' });
    expect(await driver.count('doc')).toBe(2);
  });

  it('rows already present when the schema arrives are not retroactively refused', async () => {
    // They came from `initialData` or a persistence adapter, before any schema
    // existed. Refusing them at syncSchema would turn a declaration into a boot
    // failure over data this driver did not write.
    const driver = new InMemoryDriver({ initialData: { doc: [{ id: '1', doc_no: 'D-1' }, { id: '2', doc_no: 'D-1' }] } });
    await driver.connect();
    await expect(driver.syncSchema('doc', DOC_SCHEMA)).resolves.toBeUndefined();
    expect(await driver.count('doc')).toBe(2);
    // From here on, every WRITE is checked.
    const err = await refusalOf(() => driver.create('doc', { id: '3', doc_no: 'D-1' }));
    expectUniqueViolationEnvelope(err, 'doc_no');
  });
});

/* ====================================================================== *
 * The ADR-0120 D1/D3 scoping arms — measured against driver-sql's
 * `uniqueIndexesFromFields`, arm for arm.
 * ==================================================================== */

describe("[#13197] scoping matches driver-sql's ADR-0120 D1/D3 rule", () => {
  const withOrg = (unique: unknown) => ({
    name: 'contact',
    fields: {
      id: { type: 'text' },
      organization_id: { type: 'text' },
      email: { type: 'text', unique },
    },
  });

  it('`unique: true` on an object WITH a tenant column scopes per organization', async () => {
    // Bare `true` is the positional spelling of `'organization'` at field level.
    // Reading it as `'global'` makes two organizations' identical values
    // collide on a constraint neither can see — ADR-0120 D1's whole point.
    expect(uniqueConstraintsFromFields(withOrg(true))).toEqual([
      { field: 'email', scopeField: 'organization_id' },
    ]);

    const driver = new InMemoryDriver();
    await driver.syncSchema('contact', withOrg(true));
    await driver.create('contact', { id: '1', organization_id: 'acme', email: 'a@b.com' });
    await driver.create('contact', { id: '2', organization_id: 'globex', email: 'a@b.com' });
    expect(await driver.count('contact')).toBe(2);

    const err = await refusalOf(() =>
      driver.create('contact', { id: '3', organization_id: 'acme', email: 'a@b.com' }),
    );
    expectUniqueViolationEnvelope(err, 'email');
    expect(err.message).toContain('organization_id');
  });

  it("`unique: 'organization'` is the explicit synonym — same materialization", () => {
    expect(uniqueConstraintsFromFields(withOrg('organization'))).toEqual([
      { field: 'email', scopeField: 'organization_id' },
    ]);
  });

  it("`unique: 'global'` is platform-wide even WITH a tenant column", async () => {
    expect(uniqueConstraintsFromFields(withOrg('global'))).toEqual([
      { field: 'email', scopeField: null },
    ]);

    const driver = new InMemoryDriver();
    await driver.syncSchema('contact', withOrg('global'));
    await driver.create('contact', { id: '1', organization_id: 'acme', email: 'a@b.com' });
    const err = await refusalOf(() =>
      driver.create('contact', { id: '2', organization_id: 'globex', email: 'a@b.com' }),
    );
    expectUniqueViolationEnvelope(err, 'email');
    expect(err.message).not.toContain('organization_id');
  });

  it('the NULL-organization rows form ONE bucket — the D3 fold, without needing the `__global__` token', async () => {
    // SQL UNIQUE is NULL-distinct, so a raw `(organization_id, email)` composite
    // enforced NOTHING on NULL-org rows — every row on a single-organization
    // stack (#5030). ADR-0120 D3 folds them with COALESCE onto a reserved
    // literal because an index EXPRESSION needs one; a JS key holds `null`
    // directly, so the same bucket is reached with no token at all.
    const driver = new InMemoryDriver();
    await driver.syncSchema('contact', withOrg(true));
    await driver.create('contact', { id: '1', email: 'a@b.com' });
    const err = await refusalOf(() => driver.create('contact', { id: '2', email: 'a@b.com' }));
    expectUniqueViolationEnvelope(err, 'email');
    // …and a row that DOES carry an organization is untouched by that bucket.
    await driver.create('contact', { id: '3', organization_id: 'acme', email: 'a@b.com' });
    expect(await driver.count('contact')).toBe(2);
  });

  it('with NO tenant column both per-organization spellings degrade to a single-column constraint', () => {
    const noOrg = { name: 'doc', fields: { id: { type: 'text' }, code: { type: 'text', unique: true } } };
    expect(uniqueConstraintsFromFields(noOrg)).toEqual([{ field: 'code', scopeField: null }]);
  });

  it('a unique declaration ON the tenant column itself stays single-column', () => {
    // `(organization_id, organization_id)` is not a constraint.
    const oneRowPerOrg = {
      name: 'settings',
      fields: { id: { type: 'text' }, organization_id: { type: 'text', unique: true } },
    };
    expect(uniqueConstraintsFromFields(oneRowPerOrg)).toEqual([
      { field: 'organization_id', scopeField: null },
    ]);
  });

  it('`unique: false` / absent declares no constraint at all', () => {
    expect(uniqueConstraintsFromFields(withOrg(false))).toEqual([]);
    expect(uniqueConstraintsFromFields(withOrg(undefined))).toEqual([]);
  });
});

describe('[#13197] tenantFieldOf mirrors SqlDriver.computeTenantField arm for arm', () => {
  it('an explicit opt-out wins over any column-presence heuristic', () => {
    expect(
      tenantFieldOf({ fields: { organization_id: {} }, tenancy: { enabled: false } }),
    ).toBeNull();
  });

  it('a declared tenantField that exists on the object is used', () => {
    expect(
      tenantFieldOf({ fields: { org: {}, organization_id: {} }, tenancy: { tenantField: 'org' } }),
    ).toBe('org');
  });

  it('a declared tenantField that does NOT exist falls through to the implicit column', () => {
    expect(
      tenantFieldOf({ fields: { organization_id: {} }, tenancy: { tenantField: 'missing' } }),
    ).toBe('organization_id');
  });

  it('the implicit `organization_id` column is detected with no tenancy block at all', () => {
    expect(tenantFieldOf({ fields: { organization_id: {} } })).toBe('organization_id');
  });

  it('no candidate column answers null', () => {
    expect(tenantFieldOf({ fields: { id: {} } })).toBeNull();
    expect(tenantFieldOf(undefined)).toBeNull();
  });
});

describe('[#13197] value identity', () => {
  it('distinguishes a number from its string spelling, as `upsert` already does', async () => {
    // A SQL column has one type so the question cannot arise there; here it can,
    // and folding them would refuse a write SQL accepts.
    const driver = new InMemoryDriver();
    await driver.syncSchema('doc', {
      name: 'doc',
      fields: { id: { type: 'text' }, code: { type: 'text', unique: 'global' } },
    });
    await driver.create('doc', { id: '1', code: 5 });
    await driver.create('doc', { id: '2', code: '5' });
    expect(await driver.count('doc')).toBe(2);

    const err = await refusalOf(() => driver.create('doc', { id: '3', code: 5 }));
    expectUniqueViolationEnvelope(err, 'code');
  });
});
