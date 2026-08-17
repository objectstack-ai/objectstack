// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7861] `publicSharing.eligibility` — declared, and now enforced.
 *
 * ## The defect this pins
 *
 * The key was declared in `object.zod.ts` with a TSDoc promising *"evaluated
 * against the candidate record when a link is created … the create call fails
 * with 422"*, and **nothing read it**. `getPolicy()` built its policy out of the
 * five sibling keys and skipped this one, so `createLink` ran no predicate at
 * all. Its five siblings were each genuinely enforced, which is exactly what
 * made the hole survive review.
 *
 * ## Why the evidence here is end-to-end, and why it is about the INSERT
 *
 * The harm does not land at `createLink`. It lands at `resolveToken`:
 * `GET /api/v1/share-links/:token/resolve` has no auth check and reads the
 * record under `SYSTEM_CTX`, so a link that gets minted is served to a caller
 * with **no principal at all**. A test proving "the service throws" would
 * therefore prove the wrong thing — a token that exists is already the harm.
 * So every rejection case below additionally asserts that `sys_share_link` took
 * **no row**, and the headline case walks the whole path: mint → resolve, on
 * both an eligible and an ineligible record.
 *
 * For the same reason the backend is real rather than a fake: a live
 * `SqlDriver` on better-sqlite3 `:memory:`, DDL through the driver's own
 * `initObjects` from the REAL `SysShareLink` object definition — the harness
 * `plugin-auth`'s suite settled on (#5893/#5830/#5704). A hand-written double
 * would decide for itself what `fields`-projection and insert mean, and the
 * fix widens exactly that projection.
 *
 * ## The sibling-key regression surface
 *
 * The card's own table is the control group, so all five enforced siblings are
 * pinned here beside the new gate — two of them (`allowedAudiences`,
 * `maxExpiryDays`) had no pin in this package before. That set is what makes
 * the ablation meaningful: with the new predicate removed, the eligibility
 * cases must flip red and these five must stay green.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import type { DriverQuery } from '@objectstack/spec/contracts';
// The producer's OWN dispatch predicate: a double that opens its write verbs
// with this cannot accept a call the real engine refuses
// (`check:engine-double-contract`).
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ShareLinkService } from './share-link-service.js';
import { SysShareLink } from './objects/sys-share-link.object.js';

/**
 * The object the card measured against: a mix of public and internal records,
 * which is the case an eligibility gate exists for. The predicate is the
 * card's, verbatim.
 */
const ELIGIBILITY = "record.status == 'published' && record.audience == 'public'";

const ARTICLE = {
  name: 'article',
  label: 'Article',
  fields: {
    id: { type: 'text', name: 'id', label: 'Id', primary: true },
    title: { type: 'text', name: 'title', label: 'Title' },
    status: { type: 'text', name: 'status', label: 'Status' },
    audience: { type: 'text', name: 'audience', label: 'Audience' },
    owner_id: { type: 'text', name: 'owner_id', label: 'Owner' },
  },
  publicSharing: {
    enabled: true,
    allowedAudiences: ['public', 'link_only'],
    allowedPermissions: ['view'],
    maxExpiryDays: 30,
    redactFields: ['owner_id'],
    eligibility: ELIGIBILITY,
  },
} as any;

const ROWS = [
  { id: 'a_ok', title: 'Published + public', status: 'published', audience: 'public', owner_id: 'u1' },
  { id: 'a_internal', title: 'Published + INTERNAL', status: 'published', audience: 'internal', owner_id: 'u1' },
  { id: 'a_draft', title: 'DRAFT + public', status: 'draft', audience: 'public', owner_id: 'u1' },
];

const CALLER = { userId: 'u1' } as any;

/** Live `:memory:` databases, closed after each test. */
const openDrivers: SqlDriver[] = [];

afterEach(async () => {
  while (openDrivers.length) {
    const driver = openDrivers.pop();
    try { await driver?.disconnect(); } catch { /* noop */ }
  }
});

interface BootOptions {
  /**
   * The object definition the DRIVER is initialised from, when it must differ
   * from the one the engine reports through `getSchema`. Defaulting to the same
   * object is the ordinary case; the two differ only where a test needs a
   * declared field the stored row genuinely does not carry (see the #9085
   * block), which is the shape the binder exists for.
   */
  ddl?: any;
  /**
   * Reshape each `article` row on its way out of the driver. Used only to
   * reproduce a row shape `SqlDriver` structurally cannot express — see the
   * own-key-`undefined` block for what is reproduced and why it is real.
   */
  shapeRow?: (row: any) => any;
}

/**
 * A real backend behind the real service.
 *
 * Only the verbs `ShareLinkService` actually calls are exposed; `getSchema` is
 * the in-memory registry read the engine performs, so the policy the service
 * reads is the object's declared one.
 */
async function boot(article: any = ARTICLE, options: BootOptions = {}) {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  await driver.initObjects([SysShareLink as any, options.ddl ?? article]);
  for (const row of ROWS) await driver.create('article', row);

  const schemas: Record<string, any> = { article, sys_share_link: SysShareLink };
  const engine = {
    getSchema: (name: string) => schemas[name],
    find: async (object: string, query: any) => {
      const rows = await driver.find(object, query);
      if (!options.shapeRow || object !== 'article' || !Array.isArray(rows)) return rows;
      return rows.map(options.shapeRow);
    },
    findOne: (object: string, query: any) => driver.findOne(object, query),
    insert: (object: string, data: any) => driver.create(object, data),
    // Opened with ObjectQL's OWN dispatch predicate rather than a hand-mirrored
    // id check, so this facade cannot accept an update the real engine refuses
    // (`check:engine-double-contract`). `by-id` is the only branch reachable
    // here — `resolveToken`'s usage stamp is the sole update the service makes.
    update: (object: string, data: any, options?: any) => {
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (dispatch.kind !== 'by-id') throw new Error(`unexpected dispatch: ${dispatch.kind}`);
      return driver.update(object, dispatch.id as string, data);
    },
  };
  const service = new ShareLinkService({ engine: engine as any });
  return { driver, service };
}

/** Every row currently in the share-link table — the thing that must stay empty. */
async function mintedLinks(driver: SqlDriver): Promise<any[]> {
  // The unfiltered read keeps its declared driver-side type rather than an
  // `as any` erasure — `query-options/no-any-erasure` (#4674/#4918) counts
  // test-side calls too.
  const everyRow: DriverQuery = {};
  return driver.find('sys_share_link', everyRow);
}

/**
 * The rejection assertion, per the ADR-0112 envelope: `code` AND `status`.
 * A bare `.toThrow()` would pass against a refusal for entirely the wrong
 * reason — including the pre-fix 403/404 visibility refusal.
 */
async function expectRefusal(
  run: () => Promise<unknown>,
  expected: { status: number; code: string },
): Promise<any> {
  let caught: any;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected a refusal, but the call resolved').toBeDefined();
  expect(caught.status).toBe(expected.status);
  expect(caught.code).toBe(expected.code);
  return caught;
}

describe('[#7861] publicSharing.eligibility is enforced at createLink', () => {
  it('THE REPRO — an eligible record mints and resolves; an ineligible one does neither', async () => {
    const { driver, service } = await boot();

    // The record the policy admits: minted, and served through the real
    // anonymous resolve path.
    const link = await service.createLink(
      { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
      CALLER,
    );
    expect(link.token).toBeTruthy();
    const resolved = await service.resolveToken(link.token, {});
    expect(resolved).not.toBeNull();
    expect(resolved!.link.record_id).toBe('a_ok');

    // The record the policy excludes. Pre-fix this returned OK and the token
    // resolved anonymously — the card's measured `← should be 422`.
    await expectRefusal(
      () => service.createLink(
        { object: 'article', recordId: 'a_internal', audience: 'public', permission: 'view' },
        CALLER,
      ),
      { status: 422, code: 'RECORD_NOT_ELIGIBLE' },
    );

    // The harm is the ROW, so that is what is asserted: the only link in the
    // table is the eligible one. Nothing exists for `resolveToken` to serve.
    const rows = await mintedLinks(driver);
    expect(rows.map((r) => r.record_id)).toEqual(['a_ok']);
  });

  it('a DRAFT record is refused with 422 and mints nothing', async () => {
    const { driver, service } = await boot();
    await expectRefusal(
      () => service.createLink(
        { object: 'article', recordId: 'a_draft', audience: 'public', permission: 'view' },
        CALLER,
      ),
      { status: 422, code: 'RECORD_NOT_ELIGIBLE' },
    );
    expect(await mintedLinks(driver)).toHaveLength(0);
  });

  it('the refusal names the predicate the author wrote', async () => {
    const { service } = await boot();
    const err = await expectRefusal(
      () => service.createLink(
        { object: 'article', recordId: 'a_internal', audience: 'public' },
        CALLER,
      ),
      { status: 422, code: 'RECORD_NOT_ELIGIBLE' },
    );
    expect(err.message).toContain(ELIGIBILITY);
  });

  it('a record-level construct the pushdown compiler rejects still evaluates', async () => {
    // `has(record.x)` is REJECTED by `compileCelToFilter` (measured:
    // `unsupported`) — the reason the filter compiler is the wrong instrument
    // for a record-level verdict. Through the record-level evaluator it is an
    // ordinary predicate, so this shape must mint rather than 422.
    const { service } = await boot({
      ...ARTICLE,
      publicSharing: { ...ARTICLE.publicSharing, eligibility: 'has(record.owner_id)' },
    });
    const link = await service.createLink(
      { object: 'article', recordId: 'a_internal', audience: 'public', permission: 'view' },
      CALLER,
    );
    expect(link.token).toBeTruthy();
  });

  describe('an unanswered policy refuses — it never mints', () => {
    it('a predicate that does not compile is 422, not a link', async () => {
      const { driver, service } = await boot({
        ...ARTICLE,
        publicSharing: { ...ARTICLE.publicSharing, eligibility: 'record.status ===== ' },
      });
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
          CALLER,
        ),
        { status: 422, code: 'ELIGIBILITY_UNEVALUABLE' },
      );
      expect(await mintedLinks(driver)).toHaveLength(0);
    });

    it('a predicate naming an UNDECLARED key is 422, not a link', async () => {
      const { driver, service } = await boot({
        ...ARTICLE,
        publicSharing: { ...ARTICLE.publicSharing, eligibility: "record.nope == 'x'" },
      });
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
          CALLER,
        ),
        { status: 422, code: 'ELIGIBILITY_UNEVALUABLE' },
      );
      expect(await mintedLinks(driver)).toHaveLength(0);
    });

    it('a predicate resolving to a non-boolean has not consented', async () => {
      const { driver, service } = await boot({
        ...ARTICLE,
        publicSharing: { ...ARTICLE.publicSharing, eligibility: 'record.title' },
      });
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
          CALLER,
        ),
        { status: 422, code: 'RECORD_NOT_ELIGIBLE' },
      );
      expect(await mintedLinks(driver)).toHaveLength(0);
    });

  });

  /**
   * [#9085 / #8489] The declared-field binding, pinned by cases that CANNOT
   * pass without it.
   *
   * ## What was wrong with the pin these replace
   *
   * The previous case — *"a DECLARED field the row left empty is judged, not
   * faulted"* — evaluated `record.owner_id == null` against row `a_ok`, and
   * every seeded row carries `owner_id: 'u1'`. So the declared field was never
   * actually absent, the binder never had anything to bind, and the case
   * reached `RECORD_NOT_ELIGIBLE` **identically with the binder fully ablated**
   * (measured). It pinned the predicate's plumbing, not the binding — which is
   * the one thing it was written to guard.
   *
   * ## How these two discriminate
   *
   * The declared field has to be genuinely missing from the stored row, so the
   * schema the engine reports declares `archived_at` while the table the driver
   * was initialised from does not carry it. That skew is the real production
   * shape, not a contrivance: it is a driver that omits NULL columns, a
   * migration that has not run yet, a projection that dropped the column — all
   * of them "a field the driver simply did not return", which is the sentence
   * the binder exists to answer. Measured directly on a first-party driver:
   * `InMemoryDriver` returns no `status` key at all for a row created without
   * one.
   *
   * The two cases fail in OPPOSITE directions under ablation, which is what
   * makes them a tripwire rather than a pair that happens to be red together:
   *
   * | predicate                    | bound (correct)       | binder ABLATED               |
   * |:-----------------------------|:----------------------|:-----------------------------|
   * | `record.archived_at == null` | `true` → **mints**    | FAULT → `ELIGIBILITY_UNEVALUABLE` |
   * | `!has(record.archived_at)`   | `false` → **refuses** | `true` → **mints a link**    |
   *
   * The second row is the #6454 rule and the reason this card was filed: once
   * bindings are materialised `has(record.<declared field>)` is uniformly TRUE,
   * so `has()` guards an UNDECLARED key and never an empty value. A binder that
   * misses the row therefore MINTS a link on a predicate every other
   * server-side surface refuses — over-acceptance, in the dangerous direction.
   */
  describe('[#9085] the declared-field binding is pinned discriminatingly', () => {
    /**
     * Declares one more field than the table carries. Handed to `getSchema`;
     * the driver is initialised from `ARTICLE`, so the stored row genuinely has
     * no `archived_at` key.
     */
    const withUnstoredField = (eligibility: string) => ({
      ...ARTICLE,
      fields: {
        ...ARTICLE.fields,
        archived_at: { type: 'datetime', name: 'archived_at', label: 'Archived at' },
      },
      publicSharing: { ...ARTICLE.publicSharing, eligibility },
    });

    it('a declared field the row genuinely does not carry is JUDGED, not faulted', async () => {
      const { driver, service } = await boot(
        withUnstoredField('record.archived_at == null'),
        { ddl: ARTICLE },
      );

      // Without the binding this read faults `No such key: archived_at`, and a
      // fault on this fail-closed gate is `ELIGIBILITY_UNEVALUABLE` — the
      // eligible row would be refused for a reason that is not about the row.
      const link = await service.createLink(
        { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
        CALLER,
      );
      expect(link.token).toBeTruthy();
      expect((await mintedLinks(driver)).map((r) => r.record_id)).toEqual(['a_ok']);
    });

    it('`!has()` on a declared field is FALSE even when the row omits it — and mints nothing', async () => {
      const { driver, service } = await boot(
        withUnstoredField('!has(record.archived_at)'),
        { ddl: ARTICLE },
      );

      // The #6454 semantics. An unbound record answers this `true` and MINTS —
      // the over-acceptance that this seam carried while it kept its own copy
      // of the binder.
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
          CALLER,
        ),
        { status: 422, code: 'RECORD_NOT_ELIGIBLE' },
      );
      expect(await mintedLinks(driver)).toHaveLength(0);
    });
  });

  /**
   * [#8489] The verdict change this card's ruling accepted knowingly.
   *
   * The retired local mirror bound a declared field by KEY PRESENCE
   * (`!(name in record)`); the canonical `materializeDeclaredFields` binds by
   * VALUE (`record[name] === undefined`). They agree on every input class but
   * one: a declared field held as an own key whose value is `undefined`.
   *
   * The canonical rule is the correct one, and the canonical helper's own doc
   * comment says so in as many words — *"`undefined` counts as absent (not just
   * a missing key): CEL treats an own key holding `undefined` exactly as it
   * treats no key at all"*. Measured against the real `@objectstack/formula`
   * engine, that is exactly what CEL does: `has(record.status)` is `false` and
   * `record.status == null` FAULTS `No such key: status`. So the mirror's `in`
   * check left a key bound that the evaluator still read as absent.
   *
   * ## Why the row is reshaped instead of stored
   *
   * `SqlDriver` cannot express this shape — a SQL NULL arrives as `null`, which
   * is a value, not `undefined`. `InMemoryDriver` can and does: measured,
   * `create('article', { …, status: undefined })` preserves the own key and
   * `find` returns it holding `undefined`. So the shape is real and first-party
   * reachable; it is applied on top of the real driver's row here rather than
   * pulling a second backend into this suite for one row.
   *
   * The two cases below are the two directions of the accepted change: the
   * widening the maintainer accepted, and the over-acceptance it closes.
   */
  describe('[#8489] a declared field held as an own key with `undefined`', () => {
    /** The exact shape `InMemoryDriver` produces for an explicitly-undefined write. */
    const asOwnKeyUndefined = (row: any) => {
      const out = { ...row };
      out.status = undefined;
      return out;
    };

    const withEligibility = (eligibility: string) => ({
      ...ARTICLE,
      publicSharing: { ...ARTICLE.publicSharing, eligibility },
    });

    it('is bound to `null` and JUDGED — the accepted widening', async () => {
      const { driver, service } = await boot(
        withEligibility('record.status == null'),
        { shapeRow: asOwnKeyUndefined },
      );

      // The retired mirror left the key unbound, CEL faulted `No such key`, and
      // this fail-closed gate refused with `ELIGIBILITY_UNEVALUABLE`. The
      // predicate is now ANSWERED rather than unevaluable, and the answer is
      // `true`.
      const link = await service.createLink(
        { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
        CALLER,
      );
      expect(link.token).toBeTruthy();
      expect((await mintedLinks(driver)).map((r) => r.record_id)).toEqual(['a_ok']);
    });

    it('`!has()` over it refuses — closing the over-acceptance the mirror carried', async () => {
      const { driver, service } = await boot(
        withEligibility('!has(record.status)'),
        { shapeRow: asOwnKeyUndefined },
      );

      // This is the direction that matters for a security-relevant gate: the
      // retired mirror MINTED here, on a predicate every other server-side
      // surface refuses.
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
          CALLER,
        ),
        { status: 422, code: 'RECORD_NOT_ELIGIBLE' },
      );
      expect(await mintedLinks(driver)).toHaveLength(0);
    });
  });

  /**
   * The card's sibling table, pinned. These are the ablation's control group:
   * removing the eligibility predicate must leave every one of them green.
   */
  describe('the five enforced sibling keys stay enforced', () => {
    const noEligibility = () => ({
      ...ARTICLE,
      publicSharing: { ...ARTICLE.publicSharing, eligibility: undefined },
    });

    it('`enabled` — an object that did not opt in is refused', async () => {
      const { service } = await boot({ ...noEligibility(), publicSharing: undefined });
      await expectRefusal(
        () => service.createLink({ object: 'article', recordId: 'a_ok' }, CALLER),
        { status: 422, code: 'SHARING_NOT_ENABLED' },
      );
    });

    it('`allowedAudiences` — an audience outside the list is refused', async () => {
      const { service } = await boot(noEligibility());
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'signed_in' },
          CALLER,
        ),
        { status: 422, code: 'AUDIENCE_NOT_ALLOWED' },
      );
    });

    it('`allowedPermissions` — a grant outside the list is refused', async () => {
      const { service } = await boot(noEligibility());
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'edit' },
          CALLER,
        ),
        { status: 422, code: 'PERMISSION_NOT_ALLOWED' },
      );
    });

    it('`maxExpiryDays` — an expiry beyond the cap is refused', async () => {
      const { service } = await boot(noEligibility());
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', expiresAt: '90d' },
          CALLER,
        ),
        { status: 422, code: 'EXPIRY_TOO_LONG' },
      );
    });

    it('`redactFields` — the object default reaches the resolved link', async () => {
      const { service } = await boot(noEligibility());
      const link = await service.createLink(
        { object: 'article', recordId: 'a_ok', audience: 'public' },
        CALLER,
      );
      const resolved = await service.resolveToken(link.token, {});
      expect(resolved!.redactFields).toContain('owner_id');
    });

    it('an object with no eligibility key behaves exactly as before', async () => {
      // The other half of the same guarantee: the gate is inert when the key
      // is absent, so every one of the three records still mints.
      const { service } = await boot(noEligibility());
      for (const id of ['a_ok', 'a_internal', 'a_draft']) {
        const link = await service.createLink(
          { object: 'article', recordId: id, audience: 'public' },
          CALLER,
        );
        expect(link.record_id).toBe(id);
      }
    });
  });
});
