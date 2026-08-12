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

/**
 * A real backend behind the real service.
 *
 * Only the verbs `ShareLinkService` actually calls are exposed; `getSchema` is
 * the in-memory registry read the engine performs, so the policy the service
 * reads is the object's declared one.
 */
async function boot(article: any = ARTICLE) {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  await driver.initObjects([SysShareLink as any, article]);
  for (const row of ROWS) await driver.create('article', row);

  const schemas: Record<string, any> = { article, sys_share_link: SysShareLink };
  const engine = {
    getSchema: (name: string) => schemas[name],
    find: (object: string, query: any) => driver.find(object, query),
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
  return driver.find('sys_share_link', {} as any);
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

    it('a DECLARED field the row left empty is judged, not faulted', async () => {
      // Several drivers omit NULL columns. Binding declared-and-absent to
      // `null` is what keeps such a row a `false` verdict (refused on the
      // merits) rather than an `ELIGIBILITY_UNEVALUABLE` fault.
      const { service } = await boot({
        ...ARTICLE,
        publicSharing: { ...ARTICLE.publicSharing, eligibility: 'record.owner_id == null' },
      });
      await expectRefusal(
        () => service.createLink(
          { object: 'article', recordId: 'a_ok', audience: 'public', permission: 'view' },
          CALLER,
        ),
        { status: 422, code: 'RECORD_NOT_ELIGIBLE' },
      );
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
