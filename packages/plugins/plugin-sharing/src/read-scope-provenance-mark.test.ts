// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8430, extending #8220 / A of the #7929 maintainer ruling 2026-08-12] The
 * THIRD read-scope merge boundary's half of the filter-subtree provenance mark.
 *
 * #8220 declared the mark and set it at two boundaries — `plugin-security`'s
 * CRUD injection and `service-analytics`' `ObjectQLStrategy.withReadScope`.
 * This middleware is a third: `buildSharingMiddleware` AND-composes an OWD /
 * record-share visibility filter into `ast.where` on every read, and until this
 * card nothing in that composition said which arm the caller wrote.
 *
 * What is pinned, and why each half matters:
 *
 *  - the injected sharing scope is marked `'policy'` — a cross-field refusal
 *    raised from inside it keeps the #7929 redaction. This direction was
 *    ALREADY correct as an unmarked subtree (unmarked withholds), so the pin
 *    guards against the mark accidentally opening it, not against a regression
 *    being fixed;
 *  - the caller's own predicate is vouched `'author'` under the identity check
 *    `ast.where === options.where`, so it survives THIS boundary's rewrite —
 *    the one user-visible change on the card. A tree a sibling already rewrote
 *    gets NO mark, and unmarked withholds: the mark is permission to reveal,
 *    never a guess.
 *
 * ## What the card got wrong about the mechanism, measured here
 *
 * #8430 states the vouch is lost because "by the time plugin-security sees the
 * AST, `ast.where` has already been rewritten by the sharing composition". That
 * is not the order the platform boots in: `plugin-security` is `kernel.use`d
 * BEFORE `plugin-sharing` on both real paths (`packages/verify/src/harness.ts`,
 * `packages/cli/src/commands/serve.ts`), `resolvePluginOrder` preserves
 * insertion order for plugins with no edge between them, and both register
 * their middleware in `start()` — so security vouches FIRST and its mark, which
 * lives ON the caller's object, survives this middleware's rewrite untouched.
 *
 * The gap the card is really about is the composition it does not name: a stack
 * that mounts `plugin-sharing` WITHOUT `plugin-security` (an explicitly
 * supported shape — `serve.ts` mounts SecurityPlugin as an optional pair, and
 * `buildSharingMiddleware`'s own contract is that a stack without it "behaves
 * exactly as before"). There, nothing ever vouches, and the author's own
 * cross-field refusal stays redacted. That is the configuration every author
 * case below runs in — no security middleware is registered, deliberately.
 *
 * The composed-with-security ordering is covered by the last describe: this
 * card's marks are a NO-OP there, because `markFilterSubtreeProvenance` is
 * first-mark-wins and the identity vouch fails once a sibling has rewritten the
 * tree. That is the ruling-4 guarantee stated as a test: nothing beyond the
 * author's own refusal on the author's own subtree becomes visible.
 *
 * ## Why a real driver
 *
 * The withhold is a `driver-sql` decision (`resolveWithheldFilterRefusal`), and
 * the mark reaches it only if it survives the engine, this middleware's
 * `composeAnd`, and the AST→`DriverQuery` handoff by reference. A mocked driver
 * proves none of that — it would report green on a mark that never arrived. So
 * every disclosure assertion below runs a real `SqlDriver` on a real
 * `better-sqlite3` database behind a real `ObjectQL`, exactly as
 * `share-link-eligibility.test.ts` does in this package.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { FilterCondition } from '@objectstack/spec/data';
import { filterSubtreeProvenanceOf, markFilterSubtreeProvenance } from '@objectstack/spec/data';

import { SharingService } from './sharing-service.js';
import { buildSharingMiddleware } from './sharing-plugin.js';

const OBJECT = 'sharing_deal';

/**
 * A `private` OWD object with a real `owner_id` — the two properties that make
 * `buildReadFilter` return a filter at all, so the composition under test
 * actually happens.
 */
const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  amount: { type: 'number', name: 'amount', label: 'Amount' },
  budget: { type: 'number', name: 'budget', label: 'Budget' },
  stage: { type: 'text', name: 'stage', label: 'Stage' },
  owner_id: { type: 'text', name: 'owner_id', label: 'Owner' },
  organization_id: { type: 'text', name: 'organization_id', label: 'Org' },
};

const SHARE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  object_name: { type: 'text', name: 'object_name', label: 'Object' },
  record_id: { type: 'text', name: 'record_id', label: 'Record' },
  recipient_type: { type: 'text', name: 'recipient_type', label: 'Recipient type' },
  recipient_id: { type: 'text', name: 'recipient_id', label: 'Recipient' },
  access_level: { type: 'text', name: 'access_level', label: 'Access' },
  granted_by: { type: 'text', name: 'granted_by', label: 'Grantor' },
};

/**
 * The #7929 capture, re-used verbatim: what `compileCelToFilter` emits for an
 * administrator's field-to-field rule, referencing a column the object does not
 * declare. Every name in it is one a refusal must not put in front of a caller
 * when it arrives as policy.
 *
 * ⚠️ A FACTORY, not a constant, and that is load-bearing. The mark is stamped
 * on the object and is permanent (`markFilterSubtreeProvenance` is
 * first-mark-wins, non-writable). A single shared literal reused across these
 * cases would carry the `'author'` vouch one case gave it into the next — which
 * is exactly how the "unmarked withholds" case below first went green by
 * DISCLOSING. Every case gets its own object, as every request does.
 */
const crossFieldRef = (): FilterCondition =>
  ({ amount: { $gt: { $field: 'secret_policy_column' } } }) as FilterCondition;

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * A real `SharingService` whose read filter is the administrator's compiled
 * predicate.
 *
 * `buildReadFilter` cannot emit `{ $field }` on its own — sharing-rule criteria
 * materialise into `sys_record_share` GRANTS rather than into the read filter —
 * so the cross-field content is supplied at the seam that produces the scope.
 * Everything the card is about is still the real thing: the real middleware
 * marks this object, composes it through the real `composeAnd`, and the real
 * driver rules on it. The subclass replaces the scope's CONTENT, never the
 * boundary under test.
 */
class CrossFieldScopeSharingService extends SharingService {
  override async buildReadFilter(): Promise<unknown | null> {
    return { amount: { $gt: { $field: 'secret_policy_column' } } };
  }
}

describe('[#8430] plugin-sharing stamps filter-subtree provenance at its read merge', () => {
  let driver: SqlDriver;
  let ql: ObjectQL;
  /** Everything the driver relocated to the server log during one read. */
  let logged: string[];
  /** Swapped per case so one engine serves both the real and the policy scope. */
  let crossFieldScope = false;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    logged = [];
    // The withheld half has to land somewhere for the redaction to be a
    // relocation rather than a deletion; `logger` is the sink `SqlDriver` owns
    // and a host injects.
    (driver as unknown as { logger: unknown }).logger = {
      warn: (m: string) => { logged.push(String(m)); },
      error: () => {},
      info: () => {},
      debug: () => {},
    };

    ql = new ObjectQL();
    ql.registerDriver(driver as never, true);
    await ql.init();
    ql.registerObject({
      name: OBJECT,
      label: 'Sharing deal',
      sharingModel: 'private',
      fields: FIELDS,
    } as never);
    ql.registerObject({
      name: 'sys_record_share',
      label: 'Record share',
      isSystem: true,
      fields: SHARE_FIELDS,
    } as never);
    await driver.initObjects([
      { name: OBJECT, fields: FIELDS } as never,
      { name: 'sys_record_share', fields: SHARE_FIELDS } as never,
    ]);
    await driver.create(OBJECT, {
      id: '1', amount: 10, budget: 5, stage: 'won', owner_id: 'u1', organization_id: 'o1',
    });

    // ⚠️ NO security middleware is registered — see the file header. This is
    // the composition the card's gap actually lives in, and the one where this
    // boundary is the only thing that can vouch for the caller.
    const real = new SharingService({ engine: ql as never });
    const policy = new CrossFieldScopeSharingService({ engine: ql as never });
    ql.registerMiddleware(
      (async (ctx: unknown, next: () => Promise<void>) => {
        const mw = buildSharingMiddleware(crossFieldScope ? policy : real);
        return mw(ctx as never, next);
      }) as never,
      { object: '*' },
    );
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  beforeEach(() => {
    logged = [];
    crossFieldScope = false;
  });

  /** Run one read as `u1` and hand back the refusal it produced. */
  const readAs = async (where?: unknown): Promise<{ err: WireBearingError; logged: string }> => {
    let err: WireBearingError | null = null;
    try {
      await ql.find(OBJECT, {
        ...(where === undefined ? {} : { where }),
        context: { userId: 'u1' },
      } as never);
    } catch (e) {
      err = e as WireBearingError;
    }
    if (!err) throw new Error('expected the read to be refused, but it returned rows');
    return { err, logged: logged.join('\n') };
  };

  // ── the author half — the card's user-visible fix ────────────────────────

  describe("the caller's own predicate, vouched across this boundary's rewrite", () => {
    it('names its columns again after the sharing filter is AND-ed in', async () => {
      const { err, logged: log } = await readAs(crossFieldRef());
      // Same envelope as before the fix — ADR-0112 identity is unchanged, only
      // the words are.
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('amount');
      expect(err.message).toContain('secret_policy_column');
      expect(err.message).toContain('not a declared field');
      // Disclosed on the wire ⇒ nothing left to relocate to the server log.
      expect(log).not.toContain('secret_policy_column');
    });

    it('…including when the caller wrote a pure `{ $and: […] }`, which composeAnd FLATTENS', async () => {
      // The regression this shape guards: `composeAnd` spreads a pure `$and`
      // root's arms into a NEW object, so a mark left only on that root drops
      // out of the tree and the vouch is silently lost. `parseFilterAST` emits
      // exactly this shape for the array authoring form, so it is the common
      // case, not an edge one.
      const { err } = await readAs({
        $and: [{ stage: 'won' }, { amount: { $gt: { $field: 'secret_policy_column' } } }],
      });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('amount');
      expect(err.message).toContain('secret_policy_column');
    });
  });

  // ── the policy half — fail-closed, and it must STAY closed ───────────────

  describe('the scope this middleware injects', () => {
    it('withholds its operands even though it now carries a mark', async () => {
      crossFieldScope = true;
      const { err, logged: log } = await readAs();
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      for (const name of ['secret_policy_column', 'amount']) {
        expect(err.message, `the refusal names "${name}"`).not.toContain(name);
      }
      expect(err.message).toContain('withheld from the message');
      // …and the operator's copy is intact, so this is a relocation.
      expect(log).toContain('secret_policy_column');
    });

    it('⚠️ still withholds when the SAME tree also carries an author-vouched arm', async () => {
      // The sharpest disclosure guard on this card: the caller's arm is vouched
      // 'author' and the policy arm sits beside it in one `$and`. A refusal
      // raised inside the policy arm must resolve to 'policy', not inherit the
      // sibling's vouch. If this ever goes green-by-disclosure, the fix has
      // handed an administrator's rule to a caller who wrote none of it.
      crossFieldScope = true;
      const { err, logged: log } = await readAs({ stage: 'won' });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).not.toContain('secret_policy_column');
      expect(log).toContain('secret_policy_column');
    });

    it('an UNMARKED predicate handed straight to the driver withholds byte-identically', async () => {
      // The fail-closed invariant: "no boundary vouched" and "a boundary said
      // policy" must be the same answer. ⛔ Never "restore the columns" here.
      crossFieldScope = true;
      const { err: policyErr } = await readAs();
      let unmarked: WireBearingError | null = null;
      try {
        await driver.find(OBJECT, { where: crossFieldRef() } as never);
      } catch (e) {
        unmarked = e as WireBearingError;
      }
      if (!unmarked) throw new Error('expected the unmarked read to be refused');
      expect(unmarked.code).toBe('INVALID_FILTER');
      expect(unmarked.message).toBe(policyErr.message);
    });
  });

  // ── the marks themselves, at the boundary that sets them ─────────────────

  describe('the marks this boundary sets', () => {
    /** Drive the middleware alone, so the marked objects can be inspected. */
    const runMiddleware = async (opCtx: Record<string, unknown>, service?: SharingService) => {
      const mw = buildSharingMiddleware(service ?? new SharingService({ engine: ql as never }));
      await mw(opCtx as never, async () => {});
      return opCtx;
    };

    it("marks the injected sharing scope 'policy' and the caller's verbatim where 'author'", async () => {
      const callerWhere = { stage: 'won' };
      const opCtx: Record<string, any> = {
        object: OBJECT,
        operation: 'find',
        ast: { object: OBJECT, where: callerWhere },
        options: { where: callerWhere },
        context: { userId: 'u1' },
      };
      await runMiddleware(opCtx);

      expect(filterSubtreeProvenanceOf(callerWhere)).toBe('author');
      // The merge really happened — caller's arm first, scope after.
      const arms = opCtx.ast.where.$and;
      expect(Array.isArray(arms)).toBe(true);
      expect(arms[0]).toBe(callerWhere);
      expect(filterSubtreeProvenanceOf(arms[arms.length - 1])).toBe('policy');
      // The mark is invisible to enumeration — nothing downstream serialises it.
      expect(JSON.stringify(callerWhere)).toBe('{"stage":"won"}');
    });

    it('⚠️ fail closed: a where a SIBLING already rewrote gets NO author mark', async () => {
      // plugin-security's shape, in the ordering where it runs second: the tree
      // is no longer the caller's verbatim object, so this boundary cannot know
      // which of its arms the caller wrote — and vouches nothing.
      const callerWhere = { stage: 'won' };
      const rewritten = { $and: [callerWhere, { organization_id: 'o1' }] };
      const opCtx: Record<string, any> = {
        object: OBJECT,
        operation: 'find',
        ast: { object: OBJECT, where: rewritten },
        options: { where: callerWhere },
        context: { userId: 'u1' },
      };
      await runMiddleware(opCtx);
      expect(filterSubtreeProvenanceOf(rewritten)).toBe(null);
      expect(filterSubtreeProvenanceOf(callerWhere)).toBe(null);
    });

    it("marks the `sys_record_share` self-scope 'policy' too", async () => {
      // The other read merge in this middleware (ADR-0111 D5): a non-admin
      // caller is scoped to share rows that name them. As platform-authored as
      // any sharing filter, and marked the same way.
      const opCtx: Record<string, any> = {
        object: 'sys_record_share',
        operation: 'find',
        ast: { object: 'sys_record_share', where: undefined },
        options: {},
        context: { userId: 'u1', systemPermissions: [] },
      };
      await runMiddleware(opCtx);
      expect(filterSubtreeProvenanceOf(opCtx.ast.where)).toBe('policy');
    });
  });

  // ── ruling 4: nothing else becomes visible ───────────────────────────────

  describe('composed WITH a security-shaped boundary (the real boot order)', () => {
    it('changes nothing: security vouched first, and first mark wins', async () => {
      // `plugin-security` registers its middleware before this one on both real
      // boot paths, so it vouches the caller's verbatim `where` while identity
      // still holds. By the time this boundary runs, `ast.where` is the
      // security-composed tree — identity FAILS, this boundary vouches nothing,
      // and the pre-existing 'author' mark on the caller's own object is what
      // carries. The card's marks are inert in this ordering, which is the
      // proof that they add no new disclosure.
      const callerWhere = { stage: 'won' };
      const securityScope = { organization_id: 'o1' };
      markFilterSubtreeProvenance(callerWhere, 'author');
      markFilterSubtreeProvenance(securityScope, 'policy');
      const opCtx: Record<string, any> = {
        object: OBJECT,
        operation: 'find',
        ast: { object: OBJECT, where: { $and: [callerWhere, securityScope] } },
        options: { where: callerWhere },
        context: { userId: 'u1' },
      };
      const mw = buildSharingMiddleware(new SharingService({ engine: ql as never }));
      await mw(opCtx as never, async () => {});

      // The caller's object keeps security's vouch, by reference, through the
      // rewrite — and the security scope keeps its 'policy'.
      expect(filterSubtreeProvenanceOf(callerWhere)).toBe('author');
      expect(filterSubtreeProvenanceOf(securityScope)).toBe('policy');
      // Nothing new was vouched: the composed root this boundary produced is
      // unmarked, which withholds.
      expect(filterSubtreeProvenanceOf(opCtx.ast.where)).toBe(null);
    });
  });
});
