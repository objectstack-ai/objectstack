// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5814] `convertWhere()` reads better-auth's `Where.mode`, and the identifier
 * it is asked to match case-insensitively is stored normalised.
 *
 * ## The defect
 *
 * better-auth's `Where` has a fourth field —
 * `mode?: "sensitive" | "insensitive"`, `@default "sensitive"` — and
 * `convertWhere()` read `field` / `operator` / `value` and nothing else. The
 * default covers almost every caller, so the drop was invisible; the callers it
 * is NOT invisible for are the ones that explicitly asked.
 *
 * `@better-auth/scim` is the live producer. SCIM's `userName` is
 * `caseExact: false` per RFC 7643, so `parseSCIMResourceFilter` attaches
 * `mode: "insensitive"` to the parsed clause
 * (`@better-auth/scim@1.7.0-rc.1/dist/index.mjs:576`), and SCIM maps only `eq`
 * (`SCIMFilterOperatorMap = { eq: "eq" }`, `:530`) onto better-auth's **email**
 * field (`SCIMUserFilterAttributeFields = { userName: "email" }`, `:531`).
 *
 * With `mode` unread, `userName eq "Alice@example.com"` for a user stored as
 * `alice@example.com` matched **or not depending on the driver**. And because
 * SCIM provisioning is "look up, create if absent", a missed match does not
 * raise — it provisions a **second user**. This is the fail-OPEN twin of
 * #5813's fail-closed dropped predicate: there the query widened, here it
 * answers a different question and looks fine doing it.
 *
 * ## The ruling this pins (maintainer, 2026-08-09, option 3 — both halves)
 *
 *   1. **Normalisation.** `userName` / email comparisons become
 *      case-insensitive by NORMALISING — stored lower-cased, compared
 *      lower-cased. No new query vocabulary: `$ieq` was deferred for
 *      demonstrated pull, and downgrading `eq + insensitive` to `$icontains`
 *      was rejected outright (containment is not equality).
 *   2. **The silent drop ends.** `convertWhere()` handles `mode` explicitly.
 *      On a normalised identifier the request is satisfied by construction; on
 *      **any other field** the adapter warns loudly, naming the field and the
 *      unsupported request, instead of quietly answering case-sensitively.
 *
 * ## Faces, and what each one alone cannot see
 *
 *   1. CONTRACT — which comparand the adapter emits, read off a spy engine. A
 *      behavioural pass alone can be right for the wrong reason (e.g. a backend
 *      that folds case on its own).
 *   2. BEHAVIOUR — what a REAL backend answers, plus the DISCRIMINATION pin
 *      that proves the backend is case-sensitive at all. Without face 2's
 *      discrimination arm, face 2 would be an always-green pin on any backend
 *      whose `=` folds case.
 *   3. THE WARNING — that it fires for a non-identifier field and stays SILENT
 *      for `mode: 'sensitive'` / absent. The silence half is what makes the
 *      firing half mean something: a warning on every query would satisfy "it
 *      warns" while telling an operator nothing.
 *   4. THE WRITE HALF — that the same declared set is normalised on the way
 *      IN. Face 1 + 2 without this would be a lower-cased comparand hunting
 *      rows nobody lower-cased: the mirror-image defect.
 *   5. THE DECLARED SET — pinned by value, so widening it is a deliberate act
 *      that has to come here and say so.
 *
 * ## Backend note
 *
 * Face 2 runs on `@objectstack/driver-sql` + better-sqlite3 `:memory:`, the
 * harness `auth-where-operator-coverage.test.ts` and `auth-contains-filter.test.ts`
 * already use (#5704's programme, PR #5880). It is the right backend for this
 * file specifically: SQLite's default `BINARY` collation makes `=` case-exact,
 * which is precisely the "case-sensitive driver" the issue describes — the
 * discrimination pin below measures that rather than assuming it.
 *
 * ## What is deliberately NOT pinned here
 *
 * A row written *outside* this adapter with a mixed-case email is not reachable
 * by an insensitive lookup, and no migration ships with this change. That is
 * not a gap this file hides: `@better-auth/scim`'s own provisioning path
 * already compares a lower-cased comparand against `user.email` with no `mode`
 * at all (`dist/index.mjs:2227-2234`), so such a row was already invisible to
 * SCIM before this change and in the same direction. Normalising the comparand
 * takes nothing away from it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import type { QueryAST } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/core';
import {
  createObjectQLAdapter,
  createObjectQLAdapterFactory,
  NORMALISED_IDENTIFIER_FIELDS,
} from './objectql-adapter';

/**
 * The `sys_user` columns face 2 touches, declared — a real table has to be told.
 *
 * `email_verified` / `created_at` / `updated_at` are here because the last case
 * in face 2 writes a row through the REAL translation, and better-auth's
 * `transformInput` materialises its core user shape on every create. The
 * sibling files (`auth-contains-filter.test.ts`) declare their fixture down to
 * the two columns they assert on precisely because they never write one; the
 * rule is the same rule — declare what the test actually exercises (#5806).
 */
const SYS_USER = {
  name: 'sys_user',
  fields: {
    name: { type: 'text', name: 'name' },
    email: { type: 'text', name: 'email' },
    email_verified: { type: 'boolean', name: 'email_verified' },
    created_at: { type: 'datetime', name: 'created_at' },
    updated_at: { type: 'datetime', name: 'updated_at' },
  },
};

/**
 * The row the identity provider is looking for: stored the way every write
 * path already stores it — lower-cased.
 */
const SEED = [
  { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
];

/**
 * A read-only engine facade over a REAL `SqlDriver`.
 *
 * Only the read verbs face 2 exercises are declared; seeding goes through the
 * driver directly, so a hand-written `delete`/`update` here would be a dispatch
 * contract this test neither needs nor is able to honour
 * (`check:engine-double-contract`, #4550).
 */
function sqlReadEngine(driver: SqlDriver): IDataEngine {
  // The query bag keeps its declared driver-side type with no `any` erasure —
  // `query-options/no-any-erasure` (#4674/#4918) counts test-side calls too.
  return {
    find: (object: string, query: QueryAST) => driver.find(object, query),
    findOne: (object: string, query: QueryAST) => driver.findOne(object, query),
    count: (object: string, query?: QueryAST) => driver.count(object, query),
  } as unknown as IDataEngine;
}

/**
 * Live `:memory:` databases, closed after each test — the database dies with
 * its connection, so nothing touches the host filesystem.
 */
const openDrivers: SqlDriver[] = [];

afterEach(async () => {
  while (openDrivers.length) {
    const driver = openDrivers.pop();
    try { await driver?.disconnect(); } catch { /* noop */ }
  }
});

async function seededDriver() {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  // Real DDL through the driver's own path — the table the rows land in is
  // created by the backend, not conjured by a store on first write.
  await driver.initObjects([SYS_USER]);
  for (const row of SEED) await driver.create('sys_user', row);
  return driver;
}

async function seededAdapter() {
  const driver = await seededDriver();
  const adapter: any = (createObjectQLAdapterFactory(sqlReadEngine(driver)) as any)({} as any);
  return { driver, adapter };
}

/**
 * The clause `@better-auth/scim` produces for `filter=userName eq "<value>"`:
 * its `userName` attribute maps onto the `email` field and carries
 * `mode: 'insensitive'` because the SCIM schema marks it `caseExact: false`.
 */
function scimUserNameQuery(value: string, mode?: 'sensitive' | 'insensitive') {
  return {
    model: 'user',
    where: [{ field: 'email', value, operator: 'eq', connector: 'AND', ...(mode ? { mode } : {}) }],
    limit: 100,
  } as any;
}

function spyEngine(): IDataEngine {
  return {
    insert: vi.fn().mockResolvedValue({ id: '1' }),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue({ id: '1' }),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as IDataEngine;
}

// ---------------------------------------------------------------------------
// Face 1 — the contract: which comparand the translation emits
// ---------------------------------------------------------------------------

describe('[#5814] convertWhere honours `mode: "insensitive"` on a normalised identifier', () => {
  let engine: IDataEngine;

  beforeEach(() => {
    engine = spyEngine();
  });

  it('normalises the comparand of a SCIM `userName eq` lookup', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany(scimUserNameQuery('Alice@Example.com', 'insensitive'));

    const [object, query] = (engine.find as any).mock.calls[0];
    expect(object).toBe('sys_user');
    expect(query.where).toEqual({ email: 'alice@example.com' });
    // Spelled out separately: the ruling forbids reaching for new vocabulary,
    // so the emitted filter must stay a plain equality — no `$ieq`, and no
    // containment downgrade.
    expect(JSON.stringify(query.where)).not.toContain('$ieq');
    expect(JSON.stringify(query.where)).not.toContain('$icontains');
    expect(JSON.stringify(query.where)).not.toContain('$contains');
  });

  it('leaves the comparand byte-identical when the caller asked for `sensitive`', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany(scimUserNameQuery('Alice@Example.com', 'sensitive'));

    const [, query] = (engine.find as any).mock.calls[0];
    // Folding case unasked would answer a different question than the one put —
    // the same failure in the opposite direction.
    expect(query.where).toEqual({ email: 'Alice@Example.com' });
  });

  it('leaves the comparand byte-identical when `mode` is absent (the default)', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany(scimUserNameQuery('Alice@Example.com'));

    const [, query] = (engine.find as any).mock.calls[0];
    expect(query.where).toEqual({ email: 'Alice@Example.com' });
  });

  it('normalises element-wise for the array-valued operators', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany({
      model: 'user',
      where: [{
        field: 'email',
        value: ['Alice@Example.com', 'BOB@EXAMPLE.COM'],
        operator: 'in',
        connector: 'AND',
        mode: 'insensitive',
      }],
      limit: 100,
    } as any);

    const [, query] = (engine.find as any).mock.calls[0];
    expect(query.where).toEqual({ email: { $in: ['alice@example.com', 'bob@example.com'] } });
  });

  it('applies the producer default on the raw adapter, whose clauses never pass the factory', async () => {
    // `createObjectQLAdapter` is handed hand-built clauses, so `mode` really can
    // be absent at runtime even though `CleanedWhere` types it as required —
    // exactly the reason `operator ?? 'eq'` is spelled out next to it.
    const adapter = createObjectQLAdapter(engine);
    await adapter.findMany({
      model: 'user',
      where: [{ field: 'email', value: 'Alice@Example.com', operator: 'eq' } as any],
      limit: 100,
    } as any);

    const [, query] = (engine.find as any).mock.calls[0];
    expect(query.where).toEqual({ email: 'Alice@Example.com' });
  });
});

// ---------------------------------------------------------------------------
// Face 2 — the behaviour: the duplicate-user symptom, on a real backend
// ---------------------------------------------------------------------------

describe('[#5814] the differently-cased SCIM lookup finds the existing user', () => {
  it('DISCRIMINATION: the backend really is case-sensitive, so the pin below can fail', async () => {
    const { adapter } = await seededAdapter();
    // Without this measurement the behavioural pin would be always-green on any
    // backend whose `=` folds case, and would say nothing about the adapter.
    const rows: any[] = await adapter.findMany(scimUserNameQuery('Alice@Example.com', 'sensitive'));
    expect(rows).toEqual([]);
  });

  it('finds the user stored as `alice@example.com` — no second user gets provisioned', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(scimUserNameQuery('Alice@Example.com', 'insensitive'));
    expect(rows.map((r) => r.id)).toEqual(['u_alice']);
  });

  it('matches however the identity provider happens to shout it', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(scimUserNameQuery('ALICE@EXAMPLE.COM', 'insensitive'));
    expect(rows.map((r) => r.id)).toEqual(['u_alice']);
  });

  it('still matches nothing when there is nothing to match', async () => {
    const { adapter } = await seededAdapter();
    // Case-insensitivity must not become a wildcard: #5813's lesson is that the
    // expensive direction of a translation bug is the WIDENING one.
    const rows: any[] = await adapter.findMany(scimUserNameQuery('Carol@Example.com', 'insensitive'));
    expect(rows).toEqual([]);
  });

  it('BOTH HALVES: a mixed-case write is found by a differently-cased lookup', async () => {
    // The end-to-end shape the ruling describes — normalised in, normalised on
    // compare. It goes red if EITHER half is missing, which is why it is here
    // in addition to the two halves' own pins.
    const driver = await seededDriver();
    const engine = {
      ...sqlReadEngine(driver),
      insert: (object: string, data: Record<string, unknown>) => driver.create(object, data),
    } as unknown as IDataEngine;
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);

    // No `id`: better-auth mints it, and passing one is refused by the factory.
    await adapter.create({ model: 'user', data: { name: 'Carol', email: 'Carol@Example.COM' } });

    const rows: any[] = await adapter.findMany(scimUserNameQuery('cArOl@eXaMpLe.com', 'insensitive'));
    expect(rows.map((r) => r.email)).toEqual(['carol@example.com']);
  });
});

// ---------------------------------------------------------------------------
// Face 3 — the warning: loud for what cannot be honoured, silent otherwise
// ---------------------------------------------------------------------------

describe('[#5814] an unhonourable `mode: "insensitive"` is loud, never silent', () => {
  let engine: IDataEngine;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    engine = spyEngine();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('warns, naming the field and what was done instead, for a non-identifier field', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', value: 'ALICE', operator: 'eq', connector: 'AND', mode: 'insensitive' }],
      limit: 100,
    } as any);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    // The three things an operator needs to act on it.
    expect(message).toContain('user.name');
    expect(message).toContain('insensitive');
    expect(message).toContain('CASE-SENSITIVELY');
    expect(message).toContain('#5814');
  });

  it('answers the query anyway — loud is not fail-closed', async () => {
    // Deliberate, and it is the ruling's own reasoning: refusing here would
    // upgrade "an occasional duplicate user" into "userName queries entirely
    // unavailable", which is the worse trade on an authentication path.
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', value: 'ALICE', operator: 'eq', connector: 'AND', mode: 'insensitive' }],
      limit: 100,
    } as any);

    const [, query] = (engine.find as any).mock.calls[0];
    expect(query.where).toEqual({ name: 'ALICE' });
  });

  it('stays silent for a normalised identifier — there is nothing unhonoured to report', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany(scimUserNameQuery('Alice@Example.com', 'insensitive'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent for `mode: "sensitive"` and for an absent `mode`', async () => {
    // The half that makes the firing half mean something: a warning on every
    // query satisfies "it warns" and tells an operator nothing.
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', value: 'ALICE', operator: 'eq', connector: 'AND', mode: 'sensitive' }],
      limit: 100,
    } as any);
    await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', value: 'ALICE', operator: 'eq', connector: 'AND' }],
      limit: 100,
    } as any);

    expect(warn).not.toHaveBeenCalled();
  });

  it('names the model too — the same field name on another model is a different fact', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany({
      model: 'verification',
      where: [{ field: 'identifier', value: 'Alice@Example.com', operator: 'eq', connector: 'AND', mode: 'insensitive' }],
      limit: 100,
    } as any);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('verification.identifier');
  });
});

// ---------------------------------------------------------------------------
// Face 4 — the write half: the set is normalised on the way IN
// ---------------------------------------------------------------------------

describe('[#5814] normalised identifiers are stored lower-cased', () => {
  let engine: IDataEngine;

  beforeEach(() => {
    engine = spyEngine();
  });

  it('lower-cases `email` on create', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.create({ model: 'user', data: { email: 'Alice@Example.COM', name: 'Alice' } });

    const [object, data] = (engine.insert as any).mock.calls[0];
    expect(object).toBe('sys_user');
    expect(data.email).toBe('alice@example.com');
    // The display name is NOT an identifier — it keeps the case its owner chose.
    expect(data.name).toBe('Alice');
  });

  it('lower-cases `email` on update', async () => {
    (engine.findOne as any).mockResolvedValue({ id: 'u_alice' });
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.update({
      model: 'user',
      where: [{ field: 'id', value: 'u_alice', operator: 'eq', connector: 'AND' }],
      update: { email: 'Alice@Example.COM' },
    } as any);

    const [object, patch] = (engine.update as any).mock.calls[0];
    expect(object).toBe('sys_user');
    expect(patch.email).toBe('alice@example.com');
  });

  it('lower-cases `email` on updateMany', async () => {
    (engine.find as any).mockResolvedValue([{ id: 'u_alice' }]);
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.updateMany({
      model: 'user',
      where: [{ field: 'id', value: 'u_alice', operator: 'eq', connector: 'AND' }],
      update: { email: 'Alice@Example.COM' },
    } as any);

    const [, patch] = (engine.update as any).mock.calls[0];
    expect(patch.email).toBe('alice@example.com');
  });

  it('lower-cases on the raw adapter too — it bypasses better-auth entirely', async () => {
    const adapter = createObjectQLAdapter(engine);
    await adapter.create({ model: 'user', data: { email: 'Alice@Example.COM' } });

    const [, data] = (engine.insert as any).mock.calls[0];
    expect(data.email).toBe('alice@example.com');
  });

  it('touches nothing on a model outside the declared set', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.create({
      model: 'verification',
      data: { identifier: 'Alice@Example.COM', value: 'TOKEN', expiresAt: new Date() },
    });

    const [object, data] = (engine.insert as any).mock.calls[0];
    expect(object).toBe('sys_verification');
    expect(data.identifier).toBe('Alice@Example.COM');
  });
});

// ---------------------------------------------------------------------------
// Face 5 — the declared set, pinned by value
// ---------------------------------------------------------------------------

describe('[#5814] the normalised identifier set cannot widen quietly', () => {
  it('is exactly `user.email` today', () => {
    // Widening this is a contract change with a precondition, not a config
    // tweak: a field may join only once EVERY producer of it writes it
    // normalised. Adding a member without coming here is the failure this pin
    // exists to make impossible — the compare half would start lower-casing a
    // comparand against rows nobody lower-cased.
    expect(NORMALISED_IDENTIFIER_FIELDS).toEqual({ user: ['email'] });
  });

  it('is the field `@better-auth/scim` actually queries', () => {
    // SCIM's `userName` is mapped onto better-auth's `email` field, not onto a
    // `userName` column — `SCIMUserFilterAttributeFields = { userName: "email" }`.
    // A set that named `userName` would be spelled plausibly and match nothing.
    expect(NORMALISED_IDENTIFIER_FIELDS.user).toContain('email');
    expect(NORMALISED_IDENTIFIER_FIELDS.user).not.toContain('userName');
  });
});
