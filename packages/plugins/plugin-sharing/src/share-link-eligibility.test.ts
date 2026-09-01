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
 *
 * ## [#13608] The second seam: the same policy, held again at REDEMPTION
 *
 * Enforcing at mint alone left the adjacent half open, and the state the
 * predicate reads is exactly the state an editor changes: publish an article
 * `public`, mint a link, then flip `audience` to `internal` or `status` back to
 * `draft`, and the token minted before the flip kept resolving — serving the
 * record in full to a caller with no principal. The maintainer ruled
 * (2026-08-31) that `resolveToken` re-evaluates the predicate before serving,
 * fail-closed, and that the refusal reuses the undifferentiated `null` a
 * revoked link already gets rather than inventing a distinguishable "no longer
 * eligible" answer for an anonymous caller — that distinction is an existence
 * oracle.
 *
 * So the redemption block below pins three things the mint block cannot: the
 * reclassification repro on BOTH flips, the refusal's SHAPE (measured at the
 * service seam and again at the HTTP seam an anonymous holder actually
 * reaches), and the fail-closed arm asserted by its REASON rather than by its
 * outcome — a predicate that cannot compile can never be merely false, and the
 * reason it refuses is read off the server-side log, which is the only place
 * the ruling leaves it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import type { DriverQuery } from '@objectstack/spec/contracts';
// The producer's OWN dispatch predicate: a double that opens its write verbs
// with this cannot accept a call the real engine refuses
// (`check:engine-double-contract`).
import { assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { ShareLinkService } from './share-link-service.js';
// [#13608] The PUBLIC seam an anonymous holder actually reaches. The refusal's
// shape is a claim about what that caller can observe, so it is measured there
// and not only on the service's return value.
import { registerShareLinkRoutes } from './share-link-routes.js';
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

/** A refusal line the service wrote to its server-side log. */
interface LoggedRefusal { msg: string; meta?: Record<string, any> }

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
  /**
   * [#13608] Collect the service's server-side log. The redemption refusal is
   * deliberately silent on the wire, so this is where the REASON it refused
   * becomes assertable — and where the ruling says the reason belongs.
   */
  logger?: { warn: (msg: string, meta?: Record<string, any>) => void };
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
  /**
   * [#13608] Every read the service issues, in order. Two claims are measured
   * off it: the `id`-only probe is UNCHANGED for an object with no predicate,
   * and the eligibility path widens that same read rather than adding a second.
   */
  const findCalls: Array<{ object: string; query: any }> = [];
  const engine = {
    getSchema: (name: string) => schemas[name],
    find: async (object: string, query: any) => {
      findCalls.push({ object, query });
      const rows = await driver.find(object, query);
      if (!options.shapeRow || object !== 'article' || !Array.isArray(rows)) return rows;
      return rows.map(options.shapeRow);
    },
    findOne: (object: string, query: any) => { assertEngineFindOnePredicate(object, query); return driver.findOne(object, query); },
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
  const service = new ShareLinkService({
    engine: engine as any,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  return { driver, service, engine, schemas, findCalls };
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


/**
 * [#13608] The redemption seam.
 *
 * `resolveToken` checked `revoked_at`, `expires_at`, the audience gates, the
 * password and record EXISTENCE — and served whatever survived, under
 * `SYSTEM_CTX`, to a caller with no principal. The object's declared
 * eligibility policy was consulted at mint and never again, so a record could
 * be reclassified out of the policy and keep being published by a token minted
 * while it was in.
 */
describe('[#13608] publicSharing.eligibility is enforced again at REDEMPTION', () => {
  /** A token minted while `a_ok` still qualifies — the pre-condition of every case below. */
  async function mintOn(service: ShareLinkService, recordId = 'a_ok', extra: Record<string, unknown> = {}) {
    const link = await service.createLink(
      { object: 'article', recordId, audience: 'public', permission: 'view', ...extra },
      CALLER,
    );
    expect(link.token).toBeTruthy();
    return link;
  }

  /** The row as the table holds it now — usage counters included. */
  async function linkRow(driver: SqlDriver, id: string): Promise<any> {
    const rows = await driver.find('sys_share_link', {} as DriverQuery);
    return rows.find((r: any) => r.id === id);
  }

  describe('THE REPRO — a record reclassified after mint stops being served', () => {
    it('`audience` flipped to internal: the same token resolves, then does not', async () => {
      const { driver, service } = await boot();
      const link = await mintOn(service);

      // Minted while eligible, and serving.
      expect(await service.resolveToken(link.token, {})).not.toBeNull();

      // The editor's flip — the exact step the card measured.
      await driver.update('article', 'a_ok', { audience: 'internal' });

      // Pre-fix this still returned the record in full to an anonymous caller.
      expect(await service.resolveToken(link.token, {})).toBeNull();
    });

    it('`status` reverted to draft: the same token resolves, then does not', async () => {
      const { driver, service } = await boot();
      const link = await mintOn(service);
      expect(await service.resolveToken(link.token, {})).not.toBeNull();

      await driver.update('article', 'a_ok', { status: 'draft' });

      expect(await service.resolveToken(link.token, {})).toBeNull();
    });
  });

  /**
   * Ruling item 2 (maintainer, 2026-08-31): the refusal REUSES the answer a
   * revoked / expired link already gets. Distinguishing "does not exist" from
   * "revoked" from "no longer eligible" for a caller with no principal is an
   * existence oracle, judged the way this repo's `RESOURCE_NOT_FOUND` pins
   * judge one.
   *
   * "It refuses" does not cover that, so the shape itself is asserted — twice,
   * because the claim is about two different observers.
   */
  describe('the refusal is the answer revoked / expired / unknown already give', () => {
    it('at the service seam it is `null` — the identical value, not a lookalike', async () => {
      const { driver, service } = await boot();

      // ⚠️ The record-gone arm gets its OWN record. Deleting the reclassified
      // one would satisfy this case through the #5190 probe instead, and the
      // reclassification assertion would then pass with the whole eligibility
      // gate ablated — measured, on the first run of this ablation.
      await driver.create('article', {
        id: 'a_second',
        title: 'Another published + public',
        status: 'published',
        audience: 'public',
        owner_id: 'u1',
      });

      const live = await mintOn(service);
      const revoked = await mintOn(service);
      const expired = await mintOn(service);
      const gone = await mintOn(service, 'a_second');

      await service.revokeLink(revoked.token, { isSystem: true } as any);
      await driver.update('sys_share_link', expired.id, {
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });

      // The reclassification, applied after every token above was minted. The
      // record STAYS in the table — it is ineligible, not gone.
      await driver.update('article', 'a_ok', { audience: 'internal' });
      // …and the other record is removed outright, for the #5190 arm of the
      // same door.
      await driver.delete('article', 'a_second');

      const answers = {
        reclassified: await service.resolveToken(live.token, {}),
        revoked: await service.resolveToken(revoked.token, {}),
        expired: await service.resolveToken(expired.token, {}),
        recordGone: await service.resolveToken(gone.token, {}),
        unknown: await service.resolveToken('zzzzzzzzzzzzzzzzzzzzzz', {}),
      };

      // Identity, not deep equality: every arm returns the SAME value, so
      // there is nothing on the wire to tell them apart.
      for (const [name, answer] of Object.entries(answers)) {
        expect(answer, `${name} must answer with the shared refusal`).toBeNull();
      }
      expect(Object.values(answers).every((a) => a === answers.revoked)).toBe(true);
    });

    it('the ineligible arm returns — it never throws a code an anonymous caller could read', async () => {
      const { driver, service } = await boot();
      const link = await mintOn(service);
      await driver.update('article', 'a_ok', { audience: 'internal' });

      // `assertEligible` throws `RECORD_NOT_ELIGIBLE`; letting that escape here
      // would hand the route a 422 with the policy's own text in it.
      await expect(service.resolveToken(link.token, {})).resolves.toBeNull();
    });

    /**
     * The HTTP seam, driven end-to-end on the real service through the real
     * route, with the route's SECURE default context — every request below is
     * anonymous.
     *
     * What this measures, and why it is the honest reading of ruling item 2:
     * the reclassified link lands in the route's generic "invalid / expired /
     * revoked" answer, byte-for-byte the same one a token that NEVER EXISTED
     * gets. It does not land in the 410 `EXPIRED_OR_REVOKED` branch, and it
     * must not: the route picks that branch off `revoked_at` / `expires_at` on
     * the row itself, so reaching it would require the service to hand the
     * route a distinguishable "ineligible" answer — exactly what the ruling
     * forbids. The bucket it does land in is the strictly LESS informative of
     * the two: 410 would confirm to a holder that the token was real.
     */
    it('at the HTTP seam an anonymous caller cannot tell it from an unknown token', async () => {
      const { driver, service, engine } = await boot();
      const live = await mintOn(service);
      const revoked = await mintOn(service);
      await service.revokeLink(revoked.token, { isSystem: true } as any);

      const resolve = mountResolveRoute(service, engine);

      // Before the flip: the link serves the record.
      const served = await resolve(live.token);
      expect(served.status).toBe(200);

      await driver.update('article', 'a_ok', { audience: 'internal' });

      const reclassified = await resolve(live.token);
      const unknown = await resolve('zzzzzzzzzzzzzzzzzzzzzz');
      const revokedAnswer = await resolve(revoked.token);

      // The equality that IS ruling item 2 at this seam.
      expect(reclassified).toEqual(unknown);
      expect(reclassified.status).toBe(404);
      expect(reclassified.body?.error?.code).toBe('INVALID_OR_EXPIRED');
      // Nothing about the policy, the predicate or the record reaches the wire.
      expect(JSON.stringify(reclassified.body).toLowerCase()).not.toContain('eligib');
      expect(JSON.stringify(reclassified.body).toLowerCase()).not.toContain('audience');

      // The pre-existing revoked bucket, recorded as measured rather than
      // assumed: it is a DIFFERENT status, and this change does not move it.
      expect(revokedAnswer.status).toBe(410);
      expect(revokedAnswer.body?.error?.code).toBe('EXPIRED_OR_REVOKED');
    });

    it('a refused redemption stamps no usage — exactly like a revoked one', async () => {
      const { driver, service } = await boot();
      const link = await mintOn(service);
      await driver.update('article', 'a_ok', { audience: 'internal' });

      expect(await service.resolveToken(link.token, {})).toBeNull();

      const row = await linkRow(driver, link.id);
      expect(row.use_count ?? 0).toBe(0);
      expect(row.last_used_at ?? null).toBeNull();
    });
  });

  /**
   * The fail-closed arm, asserted by the REASON it refuses.
   *
   * A case whose predicate is false anyway would pass with the whole
   * fail-closed branch deleted, so each case here uses a record that WOULD
   * qualify under the predicate it was minted with, and a predicate that
   * cannot be false at all — it can only fault. The reason is read off the
   * server-side log, which is the only place the ruling leaves it.
   */
  describe('fail-closed: an unanswered predicate refuses, and says why only in the log', () => {
    /** Mint under the working policy, then swap the object's predicate underneath the token. */
    async function mintThenBreakPredicate(eligibility: string) {
      const logged: LoggedRefusal[] = [];
      const { driver, service, schemas } = await boot(ARTICLE, {
        logger: { warn: (msg, meta) => { logged.push({ msg, meta }); } },
      });
      const link = await mintOn(service);

      // The control: this token, this record, resolves under the declared
      // policy. So a later refusal is about the SWAP, not about the record.
      expect(await service.resolveToken(link.token, {})).not.toBeNull();

      schemas.article = { ...ARTICLE, publicSharing: { ...ARTICLE.publicSharing, eligibility } };
      return { driver, service, link, logged };
    }

    it('a predicate that no longer compiles refuses a record that still qualifies', async () => {
      const { service, link, logged } = await mintThenBreakPredicate('record.status ===== ');

      expect(await service.resolveToken(link.token, {})).toBeNull();

      // The reason, and the only place it exists. `a_ok` is `published` +
      // `public`, so no false verdict is available here — this refusal can
      // only have come from the unevaluable arm.
      expect(logged).toHaveLength(1);
      expect(logged[0].meta?.reason).toBe('ELIGIBILITY_UNEVALUABLE');
      expect(logged[0].meta?.link).toBe(link.id);
      expect(logged[0].meta?.record).toBe('a_ok');
    });

    it('a predicate naming an UNDECLARED key refuses as a fault, not as a verdict', async () => {
      const { service, link, logged } = await mintThenBreakPredicate("record.nope == 'x'");

      expect(await service.resolveToken(link.token, {})).toBeNull();
      expect(logged[0].meta?.reason).toBe('ELIGIBILITY_UNEVALUABLE');
    });

    it('a predicate resolving to a non-boolean has not consented', async () => {
      const { service, link, logged } = await mintThenBreakPredicate('record.title');

      expect(await service.resolveToken(link.token, {})).toBeNull();
      expect(logged[0].meta?.reason).toBe('RECORD_NOT_ELIGIBLE');
    });

    it('the refusal reason names the two things an operator needs, and stays server-side', async () => {
      const { service, link, logged } = await mintThenBreakPredicate('record.status ===== ');
      await service.resolveToken(link.token, {});

      expect(logged[0].msg).toContain('publicSharing.eligibility');
      expect(logged[0].meta?.detail).toContain('record.status ===== ');
    });
  });

  /**
   * The other half of the guarantee: everything that was serving before must
   * still serve, and the read must not have grown a second query.
   */
  describe('nothing else moved', () => {
    it('a record that stays eligible resolves exactly as before, redaction included', async () => {
      const { driver, service } = await boot();
      const link = await mintOn(service, 'a_ok', { redactFields: ['title'] });

      // A write that does NOT cross the policy — the record still qualifies.
      await driver.update('article', 'a_ok', { title: 'Renamed, still published + public' });

      const resolved = await service.resolveToken(link.token, {});
      expect(resolved).not.toBeNull();
      expect(resolved!.link.record_id).toBe('a_ok');
      // object default ∪ per-link, unchanged by this card.
      expect(resolved!.redactFields).toEqual(['owner_id', 'title']);

      const row = await linkRow(driver, link.id);
      expect(row.use_count).toBe(1);
      expect(row.last_used_at).toBeTruthy();
    });

    it('an object with NO eligibility key is untouched by a reclassification', async () => {
      const noEligibility = { ...ARTICLE, publicSharing: { ...ARTICLE.publicSharing, eligibility: undefined } };
      const { driver, service } = await boot(noEligibility);
      const link = await mintOn(service);

      await driver.update('article', 'a_ok', { audience: 'internal', status: 'draft' });

      // No declared policy, so nothing to hold: the link keeps serving.
      expect(await service.resolveToken(link.token, {})).not.toBeNull();
    });

    it('the existence probe keeps its `id`-only projection when no predicate is declared', async () => {
      const noEligibility = { ...ARTICLE, publicSharing: { ...ARTICLE.publicSharing, eligibility: undefined } };
      const { service, findCalls } = await boot(noEligibility);
      const link = await mintOn(service);

      findCalls.length = 0;
      expect(await service.resolveToken(link.token, {})).not.toBeNull();

      const articleReads = findCalls.filter((c) => c.object === 'article');
      expect(articleReads).toHaveLength(1);
      expect(articleReads[0].query.fields).toEqual(['id']);
    });

    it('the eligibility read WIDENS the same probe rather than adding a second query', async () => {
      const { service, findCalls } = await boot();
      const link = await mintOn(service);

      findCalls.length = 0;
      expect(await service.resolveToken(link.token, {})).not.toBeNull();

      const articleReads = findCalls.filter((c) => c.object === 'article');
      expect(articleReads).toHaveLength(1);
      expect(articleReads[0].query.fields).toBeUndefined();
    });

    it('[#5190] a deleted record still refuses — the probe survived the refactor', async () => {
      const { driver, service } = await boot();
      const link = await mintOn(service);
      await driver.delete('article', 'a_ok');

      expect(await service.resolveToken(link.token, {})).toBeNull();
    });

    it('[#5190] a deleted record refuses even with NO predicate declared', async () => {
      const noEligibility = { ...ARTICLE, publicSharing: { ...ARTICLE.publicSharing, eligibility: undefined } };
      const { driver, service } = await boot(noEligibility);
      const link = await mintOn(service);
      await driver.delete('article', 'a_ok');

      expect(await service.resolveToken(link.token, {})).toBeNull();
    });
  });
});

/**
 * [#13608] Mount the real PUBLIC resolve route on the real service.
 *
 * Only the verbs `registerShareLinkRoutes` calls are implemented, and the
 * SECURE default `contextFromRequest` is deliberately left in place: it reads
 * no identity header, so every request driven through the returned function is
 * anonymous — the caller the refusal shape is a claim about.
 */
function mountResolveRoute(service: ShareLinkService, engine: unknown) {
  const routes = new Map<string, RouteHandler>();
  const http: any = {
    get: (path: string, h: RouteHandler) => { routes.set(`GET ${path}`, h); return http; },
    post: (path: string, h: RouteHandler) => { routes.set(`POST ${path}`, h); return http; },
    put: (path: string, h: RouteHandler) => { routes.set(`PUT ${path}`, h); return http; },
    delete: (path: string, h: RouteHandler) => { routes.set(`DELETE ${path}`, h); return http; },
    patch: (path: string, h: RouteHandler) => { routes.set(`PATCH ${path}`, h); return http; },
    use: () => http,
    listen: async () => undefined,
    close: async () => undefined,
    getInstance: () => null,
  };
  registerShareLinkRoutes(http as IHttpServer, service, engine as any);

  const handler = routes.get('GET /api/v1/share-links/:token/resolve');
  if (!handler) throw new Error('the public resolve route was not mounted');

  return async (token: string): Promise<{ status: number; body: any }> => {
    const captured: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = {
      status: (code: number) => { captured.status = code; return res; },
      json: (data: any) => { captured.body = data; return res; },
      send: () => res,
      header: () => res,
    };
    const req: any = { params: { token }, query: {}, headers: {}, method: 'GET', path: '/' };
    await handler(req as IHttpRequest, res as IHttpResponse);
    return captured;
  };
}
