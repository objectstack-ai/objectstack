// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11082] `controlled_by_parent` (ADR-0055) must COMPOSE ACROSS A CHAIN.
//
// ## What was measured before this suite existed
//
// #5386 made the derivation resolve the master set through the master's own
// read scope — RLS half AND the OWD / `sys_record_share` half. That fix does
// not recurse, and the two halves it composes both answer "no restriction" for
// a master that is ITSELF `controlled_by_parent`:
//
//   • the RLS half is `null`, because a derived object authors no policy —
//     declaring `controlled_by_parent` IS its policy;
//   • the sharing half is `null` too: `plugin-sharing.buildReadFilter` opts out
//     for every model that is not `private`, and `effectiveSharingModel` maps
//     `controlled_by_parent` to `public`.
//
// Composed: `null`. `find(master, {})` then ran as SYSTEM and returned EVERY
// master row, so a two-level chain was enforced at level one and org-wide at
// level two — for READ and for WRITE — with metadata that reads as if it were
// narrowed. That is the dangerous direction: unenforced, and indistinguishable
// from enforced.
//
// The write half fails through a SEPARATE mechanism and is pinned separately
// here, never inferred from the read fix: `assertControlledByParentWrite` asks
// `resolveSharingCanEdit` on the master row, `checkEdit` returns `abstain` for a
// `public`-mapped model, and ⛔ `abstain` is not `deny` — so `canEdit` answered
// `true` for every master row of a derived master.
//
// ## What this suite refuses to let a fix do
//
// The load-bearing NEGATIVE: a blanket refusal for any chained declaration would
// pass every leak assertion below and destroy the single-level case #5386 fixed
// — which the issue's own measurement shows CORRECT today. So level one is
// pinned in this same suite, in both directions, and so is the row whose whole
// chain IS reachable (`line_us`): if a fix narrows or widens either, this file
// reddens rather than the leak tests going quiet.
//
// ## The fixture — the issue's chain, one level at a time
//
//   crm_quote_line_item  --quote-->  crm_quote  --account-->  crm_account
//     controlled_by_parent           controlled_by_parent       private
//
// Three accounts: one owned by someone else and SHARED to the rep at `edit`,
// one owned by someone else and NOT shared (the excluded row, without which
// "narrowed" would prove nothing), one the rep owns. One quote under each, one
// line under each quote. The rep holds full CRUD on all three objects and there
// is no authored `rowLevelSecurity` anywhere, so every refusal below is the
// derived record gate rather than the object gate.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { SharingService, type SharingEngine } from '@objectstack/plugin-sharing';
import { matchesFilterCondition } from '@objectstack/formula';
import type { PermissionSet } from '@objectstack/spec/security';

const REP = 'usr_rep';
const OTHER = 'usr_other';

/** Level 3 — the ROOT of the chain. Owner-scoped, no authored RLS. */
const ACCOUNT_SCHEMA = {
  name: 'crm_account',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

/**
 * Level 2 — the object the issue is about: a master that is ITSELF derived.
 * Note it has NO `owner_id` and no policy of its own; everything it can say
 * about access is the `controlled_by_parent` declaration.
 */
const QUOTE_SCHEMA = {
  name: 'crm_quote',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: { name: 'account', type: 'master_detail', required: true, reference: 'crm_account' },
    // Present, and DEAD while the model is `controlled_by_parent` — the whole
    // meaning of the declaration is that this object's rows are not scoped by
    // their own owner. The `private` boot flips the model and nothing else, so
    // the control below measures the DECLARATION rather than a second fixture.
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

/** Level 1 — the leaf that went org-wide. */
const LINE_SCHEMA = {
  name: 'crm_quote_line_item',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    quantity: { name: 'quantity', type: 'number' },
    quote: { name: 'quote', type: 'master_detail', required: true, reference: 'crm_quote' },
  },
};

/**
 * The CONTROL — the issue's own: a `controlled_by_parent` detail under a master
 * that stays `private`. It is the single-level case, it was correct before this
 * change, and it must be untouched by it. Its master is owned by someone else
 * and shared to nobody, so it reads `[]` throughout.
 */
const CASE_SCHEMA = {
  name: 'crm_case',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

const CASE_LINE_SCHEMA = {
  name: 'crm_case_line',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    case: { name: 'case', type: 'master_detail', required: true, reference: 'crm_case' },
  },
};

/**
 * A two-object CYCLE — `cyc_a`'s master is `cyc_b` and `cyc_b`'s master is
 * `cyc_a`. Authorable (nothing refuses it at publish time today) and, without
 * cycle protection, non-terminating. It must FAIL CLOSED, not widen.
 */
const CYCLE_A_SCHEMA = {
  name: 'cyc_a',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    b: { name: 'b', type: 'master_detail', required: true, reference: 'cyc_b' },
  },
};

const CYCLE_B_SCHEMA = {
  name: 'cyc_b',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    a: { name: 'a', type: 'master_detail', required: true, reference: 'cyc_a' },
  },
};

/**
 * Generated `controlled_by_parent` chains, for the DEPTH BOUND. Each `<p>_k`
 * is derived from `<p>_(k+1)`; the last link is `private` and owned by the rep,
 * so the whole chain is reachable and any empty answer is the BOUND talking
 * rather than the fixture.
 *
 * Two of them, because a bound has two failure directions and only pinning one
 * is how a "safe" bound of 1 would pass: `ok_*` is inside the bound and must
 * resolve, `deep_*` overruns it and must fail CLOSED.
 */
function chainSchemas(prefix: string, links: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let k = 0; k < links; k++) {
    out[`${prefix}_${k}`] = {
      name: `${prefix}_${k}`,
      sharingModel: 'controlled_by_parent',
      fields: {
        id: { name: 'id', type: 'text' },
        up: { name: 'up', type: 'master_detail', required: true, reference: `${prefix}_${k + 1}` },
      },
    };
  }
  out[`${prefix}_${links}`] = {
    name: `${prefix}_${links}`,
    sharingModel: 'private',
    fields: {
      id: { name: 'id', type: 'text' },
      owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
    },
  };
  return out;
}

function chainRows(prefix: string, links: number): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (let k = 0; k < links; k++) {
    out[`${prefix}_${k}`] = [{ id: `${prefix}_${k}_r`, up: `${prefix}_${k + 1}_r` }];
  }
  out[`${prefix}_${links}`] = [{ id: `${prefix}_${links}_r`, owner_id: REP }];
  return out;
}

/** Inside the bound (3 derived links). */
const OK_LINKS = 3;
/** Over the bound of 8 (10 derived links). */
const DEEP_LINKS = 10;

const SHARE_SCHEMA = {
  name: 'sys_record_share',
  isSystem: true,
  fields: {
    id: { name: 'id', type: 'text' },
    object_name: { name: 'object_name', type: 'text' },
    record_id: { name: 'record_id', type: 'text' },
    recipient_type: { name: 'recipient_type', type: 'text' },
    recipient_id: { name: 'recipient_id', type: 'text' },
    access_level: { name: 'access_level', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

/**
 * Full CRUD on every object in the chain and — deliberately — NO
 * `rowLevelSecurity` at all. That is the shape the issue measured: the app
 * expresses its record boundary through OWD + sharing and expects
 * `controlled_by_parent` to follow it, at every level.
 */
const REP_SET: PermissionSet = {
  name: 'crm_rep',
  label: 'CRM Rep',
  objects: {
    crm_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_quote: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_quote_line_item: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_case: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_case_line: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    cyc_a: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    cyc_b: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    // Full CRUD on every generated link too, so a depth-bound refusal is never
    // the object gate wearing the bound's clothes.
    ...Object.fromEntries(
      [
        ...Array.from({ length: OK_LINKS + 1 }, (_, k) => `ok_${k}`),
        ...Array.from({ length: DEEP_LINKS + 1 }, (_, k) => `deep_${k}`),
      ].map((n) => [n, { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true }]),
    ),
  },
} as unknown as PermissionSet;

type Row = Record<string, unknown>;

/**
 * READ-surface-only engine double — `find`, `findOne`, `getSchema`, and no
 * write verb at all: nothing under test writes through it, and a double
 * without a verb cannot be looser than the engine on that verb
 * (`check:engine-double-contract`, #4434/#5480). Filtering runs through
 * `matchesFilterCondition`, the evaluator the plugin itself uses, so a filter
 * asserted here is a filter that was really applied.
 */
function makeStore(rows: Record<string, Row[]>, quoteModel: string = 'controlled_by_parent') {
  const schemas: Record<string, unknown> = {
    crm_account: ACCOUNT_SCHEMA,
    crm_quote: { ...QUOTE_SCHEMA, sharingModel: quoteModel },
    crm_quote_line_item: LINE_SCHEMA,
    crm_case: CASE_SCHEMA,
    crm_case_line: CASE_LINE_SCHEMA,
    cyc_a: CYCLE_A_SCHEMA,
    cyc_b: CYCLE_B_SCHEMA,
    sys_record_share: SHARE_SCHEMA,
    sys_user: {
      name: 'sys_user',
      isSystem: true,
      fields: { id: { name: 'id', type: 'text' }, name: { name: 'name', type: 'text' } },
    },
    ...chainSchemas('ok', OK_LINKS),
    ...chainSchemas('deep', DEEP_LINKS),
  };
  const findCalls: string[] = [];
  return {
    rows,
    findCalls,
    getSchema: (object: string) => schemas[object],
    find: vi.fn(async (object: string, options: any = {}) => {
      findCalls.push(object);
      const all = rows[object] ?? [];
      const hits = all.filter((r) => matchesFilterCondition(r, options?.where ?? null));
      return typeof options?.limit === 'number' ? hits.slice(0, options.limit) : hits;
    }),
    findOne: vi.fn(async (object: string, options: any = {}) => {
      const all = rows[object] ?? [];
      return all.find((r) => matchesFilterCondition(r, options?.where ?? null)) ?? null;
    }),
  };
}

function fixtureRows(): Record<string, Row[]> {
  return {
    crm_account: [
      { id: 'acct_us', name: 'US Corp', owner_id: OTHER }, // shared to the rep at `edit`
      { id: 'acct_jp', name: 'JP Corp', owner_id: OTHER }, // NOT shared — the excluded row
      { id: 'acct_own', name: 'Own Corp', owner_id: REP }, // the rep's own
    ],
    crm_quote: [
      { id: 'quote_us', name: 'US quote', account: 'acct_us', owner_id: OTHER },
      { id: 'quote_jp', name: 'JP quote', account: 'acct_jp', owner_id: OTHER },
      { id: 'quote_own', name: 'Own quote', account: 'acct_own', owner_id: REP },
    ],
    crm_quote_line_item: [
      { id: 'line_us', quantity: 1, quote: 'quote_us' },
      { id: 'line_jp', quantity: 3, quote: 'quote_jp' },
      { id: 'line_own', quantity: 5, quote: 'quote_own' },
    ],
    // The control: a private master the rep neither owns nor was granted.
    crm_case: [{ id: 'case_other', owner_id: OTHER }],
    crm_case_line: [{ id: 'case_line_other', case: 'case_other' }],
    // The cycle.
    cyc_a: [{ id: 'a1', b: 'b1' }],
    cyc_b: [{ id: 'b1', a: 'a1' }],
    // [ADR-0090 D10] Real principals, so the delegated-read case below resolves
    // a delegator instead of failing closed on a dangling link.
    sys_user: [
      { id: REP, name: 'Rep' },
      { id: OTHER, name: 'Other' },
    ],
    ...chainRows('ok', OK_LINKS),
    ...chainRows('deep', DEEP_LINKS),
    sys_record_share: [
      {
        id: 'shr_1',
        object_name: 'crm_account',
        record_id: 'acct_us',
        recipient_type: 'user',
        recipient_id: REP,
        access_level: 'edit',
      },
    ],
  };
}

interface BootOptions {
  /**
   * The MIDDLE object's model. `controlled_by_parent` is the chain under test;
   * `private` collapses the fixture to the single-level shape #5386 fixed, so
   * the same assertions can pin that level one is untouched.
   */
  quoteModel?: 'controlled_by_parent' | 'private';
}

async function boot(options: BootOptions = {}) {
  const store = makeStore(fixtureRows(), options.quoteModel ?? 'controlled_by_parent');
  const sets = [REP_SET];

  let middleware: any;
  const ql = {
    registerMiddleware: (mw: any) => {
      if (!middleware) middleware = mw;
    },
    getSchema: store.getSchema,
    find: store.find,
    findOne: store.findOne,
  };

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async (n: string) => store.getSchema(n), list: async () => sets },
    // The REAL sharing service over the same store: the point of the fix is that
    // the derivation reuses this exact producer at EVERY level instead of
    // re-deriving owner/share semantics inside plugin-security.
    sharing: new SharingService({ engine: store as unknown as SharingEngine }),
  };

  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({
    defaultPermissionSets: sets,
    fallbackPermissionSet: 'crm_rep',
  });
  await plugin.init(ctx);
  await plugin.start(ctx);

  const repContext = () => ({ userId: REP, tenantId: 'org-1', positions: [], permissions: [] });

  /** The CRUD READ face: run the middleware, then apply the filter it injected. */
  const visible = async (object: string, context?: any): Promise<string[]> => {
    const opCtx: any = {
      object,
      operation: 'find',
      ast: {},
      options: {},
      context: context ?? repContext(),
    };
    await middleware(opCtx, async () => {});
    return (store.rows[object] ?? [])
      .filter((r) => matchesFilterCondition(r, opCtx.ast.where ?? null))
      .map((r) => String(r.id));
  };

  /**
   * The ANALYTICS read face — the scope `getReadFilter` hands the raw-SQL path.
   * No middleware runs here; this method IS the whole enforcement on that
   * surface, and it is the THIRD call site of the derivation.
   */
  const analyticsVisible = async (object: string): Promise<string[]> => {
    const filter = await plugin.getReadFilter(object, repContext());
    return (store.rows[object] ?? [])
      .filter((r) => matchesFilterCondition(r, (filter ?? null) as any))
      .map((r) => String(r.id));
  };

  /**
   * [ADR-0090 D10] The DELEGATED read face — an agent reading on behalf of a
   * user. The middleware resolves the delegator's own sets and context and ANDs
   * a SECOND derivation in, at `security-plugin.ts`'s delegator call site. That
   * site is a distinct consumer of the derivation, and a fix that reached only
   * the caller's call site would leave this one org-wide.
   */
  const delegatedVisible = async (object: string, delegator: string): Promise<string[]> => {
    const opCtx: any = {
      object,
      operation: 'find',
      ast: {},
      options: {},
      context: { ...repContext(), onBehalfOf: { userId: delegator } },
    };
    await middleware(opCtx, async () => {});
    return (store.rows[object] ?? [])
      .filter((r) => matchesFilterCondition(r, opCtx.ast.where ?? null))
      .map((r) => String(r.id));
  };

  /** The WRITE face: a by-id update of one row. Resolves or throws. */
  const update = async (object: string, id: string): Promise<void> => {
    const opCtx: any = {
      object,
      operation: 'update',
      data: { id, quantity: 99 },
      options: { where: { id } },
      context: repContext(),
    };
    await middleware(opCtx, async () => {});
  };

  const writable = async (object: string): Promise<string[]> => {
    const out: string[] = [];
    for (const row of store.rows[object] ?? []) {
      try {
        await update(object, String(row.id));
        out.push(String(row.id));
      } catch {
        /* denied */
      }
    }
    return out;
  };

  return { store, ctx, plugin, repContext, visible, analyticsVisible, delegatedVisible, update, writable };
}

// ─────────────────────────────────────────────────────────────────────────────
// The issue's reproduction table, row for row.
// ─────────────────────────────────────────────────────────────────────────────

describe("[#11082] controlled_by_parent composes across a chain — READ", () => {
  it('LEVEL ONE is unchanged: the derived master narrows to the reachable accounts', async () => {
    // The issue measured this as ALREADY CORRECT, and it is the case a blanket
    // refusal would destroy. `acct_own` by ownership, `acct_us` by the grant,
    // `acct_jp` by neither.
    const h = await boot();
    expect(await h.visible('crm_quote')).toEqual(['quote_us', 'quote_own']);
  });

  it('LEVEL TWO: the leaf follows the WHOLE chain — the unreachable branch is gone', async () => {
    const h = await boot();
    // `line_jp` is the leak: its quote hangs off an account the rep can neither
    // own nor was granted. `line_us` MUST survive — its entire chain is
    // reachable — and it is the assertion a blanket deny fails.
    expect(await h.visible('crm_quote_line_item')).toEqual(['line_us', 'line_own']);
  });

  it('the decisive pair, same boot: the master is unreadable and so is its child', async () => {
    const h = await boot();
    const quotes = await h.visible('crm_quote');
    const lines = await h.visible('crm_quote_line_item');
    expect(quotes).not.toContain('quote_jp');
    expect(lines).not.toContain('line_jp');
  });

  it('ANALYTICS (getReadFilter) composes the chain identically to the CRUD path', async () => {
    // The two surfaces disagreeing is its own defect class; pinned so a fix
    // applied to one path cannot pass while the other stays org-wide.
    const h = await boot();
    expect(await h.analyticsVisible('crm_quote_line_item')).toEqual(['line_us', 'line_own']);
    expect(await h.analyticsVisible('crm_quote')).toEqual(['quote_us', 'quote_own']);
  });

  it('the DELEGATOR call site composes the chain too — not only the caller\'s', async () => {
    // The derivation has FOUR consumers (the CRUD middleware's caller leg, its
    // D10 delegator leg, and `getReadFilter`); the recursion lives inside the
    // shared helper so all of them inherit it. This pins the delegator leg
    // specifically, because it is the one a fix aimed at "the" call site misses.
    //
    // Agent REP reaches {quote_us (grant), quote_own (ownership)}; delegator
    // OTHER owns acct_us and acct_jp, so reaches {quote_us, quote_jp}. The
    // delegated read is the INTERSECTION — `line_us` alone. Before the fix the
    // delegator's own derivation was org-wide, so the intersection collapsed to
    // the agent's set and `line_own` came back too.
    const h = await boot();
    expect(await h.delegatedVisible('crm_quote_line_item', OTHER)).toEqual(['line_us']);
  });

  it('CONTROL: a detail under a `private` master is untouched — `[]` throughout', async () => {
    // The issue's own control. The leak tracked the MASTER's model, not the
    // object, so this row must stay exactly as it was.
    const h = await boot();
    expect(await h.visible('crm_case_line')).toEqual([]);
    expect(await h.analyticsVisible('crm_case_line')).toEqual([]);
  });

  it('CONTROL: the walk STOPS at the first master that governs its own rows', async () => {
    // Flip the middle object's model and nothing else. `crm_quote` now scopes
    // by its own owner, the walk must not continue past it into `crm_account`,
    // and the leaf follows the quote — `quote_own` / `line_own` only, even
    // though `acct_us` is still shared to the rep at `edit`.
    //
    // ⚠️ This is the row the issue's `private` measurement recorded, and it is
    // NOT the expected answer for the `controlled_by_parent` chain above: there
    // `line_us` stays readable because its whole chain is reachable. The two
    // are pinned side by side because reading one as the other is exactly how a
    // fix ends up over-denying and still passing every leak test.
    //
    // The master is read through the ANALYTICS face here, deliberately: only
    // the security middleware is booted, and a `private` object's owner-match
    // is contributed by plugin-sharing's OWN middleware, which is not. The leaf
    // is read through the CRUD face because its derivation folds that same
    // sharing half in itself — which is the equality #5386 established and this
    // case re-checks one level down.
    const h = await boot({ quoteModel: 'private' });
    expect(await h.analyticsVisible('crm_quote')).toEqual(['quote_own']);
    expect(await h.visible('crm_quote_line_item')).toEqual(['line_own']);
  });
});

describe('[#11082] controlled_by_parent composes across a chain — WRITE', () => {
  it('a detail whose grandmaster is unreachable is DENIED (its own mechanism, not the read fix)', async () => {
    const h = await boot();
    // `abstain` is not `deny`: before this change `canEdit` on a derived master
    // answered `true` for every row and this resolved.
    await expect(h.update('crm_quote_line_item', 'line_jp')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      statusCode: 403,
    });
  });

  it('the write set follows the chain — reachable branches stay WRITABLE', async () => {
    const h = await boot();
    // Not a blanket refusal: `line_us` is writable because the rep's grant on
    // `acct_us` is `edit`, and `line_own` because the rep owns `acct_own`.
    expect(await h.writable('crm_quote_line_item')).toEqual(['line_us', 'line_own']);
  });

  it('LEVEL ONE writes are unchanged: the derived master itself follows its own master', async () => {
    const h = await boot();
    expect(await h.writable('crm_quote')).toEqual(['quote_us', 'quote_own']);
  });

  it('the denial names the CALLER\'s object and operation, not the ancestor (#7474 envelope)', async () => {
    const h = await boot();
    await expect(h.update('crm_quote_line_item', 'line_jp')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      statusCode: 403,
      details: { operation: 'update', object: 'crm_quote_line_item' },
    });
  });

  it('CONTROL: a detail under a `private` master is still denied for the ORIGINAL reason', async () => {
    const h = await boot();
    expect(await h.writable('crm_case_line')).toEqual([]);
  });
});

describe('[#11082] the walk is bounded — both guards fail CLOSED', () => {
  it('READ: a metadata CYCLE denies rather than recursing or widening', async () => {
    const h = await boot();
    expect(await h.visible('cyc_a')).toEqual([]);
    expect(await h.visible('cyc_b')).toEqual([]);
  });

  it('WRITE: a metadata CYCLE denies rather than recursing or widening', async () => {
    const h = await boot();
    await expect(h.update('cyc_a', 'a1')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      statusCode: 403,
    });
  });

  it('a cycle is REPORTED as a cycle — a silent empty result would read as "no data"', async () => {
    // The refusal and the reason are two different deliverables. Denying with
    // no log reproduces this defect's own worst property: indistinguishable
    // from the enforced case, and unattributable when someone asks why.
    const h = await boot();
    await h.visible('cyc_a');
    const messages = h.ctx.logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(messages.some((m: string) => m.includes('CYCLE') && m.includes('cyc_a'))).toBe(true);
  });

  it('a chain INSIDE the bound resolves — the bound must not be the new blanket deny', async () => {
    // The direction a "safe" bound gets wrong. Every link is reachable (the
    // root is owned by the rep), so anything but the row is over-denial.
    const h = await boot();
    expect(await h.visible(`ok_0`)).toEqual(['ok_0_r']);
    expect(await h.visible(`ok_${OK_LINKS}`)).toEqual([`ok_${OK_LINKS}_r`]);
  });

  it('a chain OVER the bound fails CLOSED — never "no restriction"', async () => {
    // 10 derived links against a bound of 8. The root is owned by the rep, so a
    // walk that completed would make `deep_0` readable; the empty answer is the
    // bound refusing, and refusing in the narrow direction.
    const h = await boot();
    expect(await h.visible('deep_0')).toEqual([]);
  });

  it('overrunning the bound is REPORTED, naming the bound', async () => {
    const h = await boot();
    await h.visible('deep_0');
    const messages = h.ctx.logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(messages.some((m: string) => m.includes('depth bound'))).toBe(true);
  });

  it('WRITE respects the same bound, in the same direction', async () => {
    const h = await boot();
    expect(await h.writable('ok_0')).toEqual(['ok_0_r']);
    await expect(h.update('deep_0', 'deep_0_r')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      statusCode: 403,
    });
  });

  it('the bound caps WORK: resolving the two-level chain costs a bounded number of finds', async () => {
    // Guards the cost limit ADR-0055 books, and would redden if the walk ever
    // re-entered an ancestor without the visited set catching it.
    const h = await boot();
    h.store.findCalls.length = 0;
    await h.visible('crm_quote_line_item');
    expect(h.store.findCalls.length).toBeLessThanOrEqual(8);
  });
});
