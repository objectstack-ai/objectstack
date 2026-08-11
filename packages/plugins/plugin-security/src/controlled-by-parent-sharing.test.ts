// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5386] `controlled_by_parent` (ADR-0055) must resolve the MASTER's
// accessibility through the SAME path a direct read / write of that master
// takes — owner scope and `sys_record_share` grants folded in, not the master's
// RLS policies alone.
//
// ## What was measured before this suite existed
//
// The derivation ran `computeRlsFilter(master, 'find')` and nothing else, under
// a system context. Owner scope and record shares are contributed by a SIBLING
// plugin (`plugin-sharing`), whose `buildReadFilter` returns `null` for any
// object whose effective sharing model is not `private` — and
// `controlled_by_parent` maps to `public` there. So the two halves of
// record-level access never met on a derived object:
//
//   • an app that authors NO `rowLevelSecurity` on the master got an
//     UNRESTRICTED master id set, i.e. the declared narrowing narrowed nothing
//     and every detail row was readable by any holder of object-level read;
//   • authoring RLS on the master was not a workaround, because RLS is ANDed
//     with the sharing filter rather than OR-ed into it, so it also cut off the
//     rows a grant had shared in;
//   • the write half had the same hole from the other side — its master row
//     check was SKIPPED WHOLE when the master's write RLS compiled to `null`.
//
// ## Why one fixture drives both faces
//
// The read filter and the write assertion are two implementation faces of ONE
// contract ("a child follows its parent's access"). A suite that exercised them
// on separate fixtures could not see them disagree, which is the failure this
// family produces: a third, quieter answer where one face allows what the other
// refuses. Every case below runs on the SAME three-account fixture — a master
// owned by someone else and shared to the caller, a master owned by someone
// else and NOT shared (the excluded row, without which "consistent" would prove
// nothing), and a master the caller owns.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { SharingService, type SharingEngine } from '@objectstack/plugin-sharing';
import { matchesFilterCondition } from '@objectstack/formula';
import type { PermissionSet } from '@objectstack/spec/security';

const REP = 'usr_rep';
const OTHER = 'usr_other';

/** The MASTER — owner-scoped by OWD (`private`), with no authored RLS at all. */
const ACCOUNT_SCHEMA = {
  name: 'crm_account',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

/** The DETAIL — access derived from `crm_account` through the master_detail FK. */
const CONTACT_SCHEMA = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: { name: 'account', type: 'master_detail', required: true, reference: 'crm_account' },
  },
};

/**
 * [#7474] The same detail, AUTHORED WRONG: `controlled_by_parent` with nothing
 * to derive access from — no master_detail field, and no required lookup for
 * `resolveCbpRelation` to fall back to. The gate's metadata-defect leg is the
 * only thing between this object and a write that answers a false 403.
 */
const CONTACT_SCHEMA_NO_MASTER_DETAIL = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    // A lookup, but OPTIONAL — the third fallback `resolveCbpRelation` tries
    // requires `required: true`, so this object resolves to no relation at all.
    account: { name: 'account', type: 'lookup', reference: 'crm_account' },
  },
};

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
 * The app's permission set: full CRUD on both objects (so requests reach the
 * record layer instead of being refused by RBAC) and — deliberately — NO
 * `rowLevelSecurity` anywhere. That is the shape the issue measured: the app
 * expresses its record boundary entirely through OWD + sharing, and expects
 * `controlled_by_parent` to follow it.
 */
const REP_SET: PermissionSet = {
  name: 'crm_rep',
  label: 'CRM Rep',
  objects: {
    crm_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_contact: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
} as unknown as PermissionSet;

type Row = Record<string, unknown>;

/**
 * In-memory store standing in for the engine's READ surface only — `find`,
 * `findOne`, `getSchema`. It declares NO write verb: nothing under test writes
 * through it, and a double that does not have a verb cannot be looser than the
 * engine on that verb (the `check:engine-double-contract` family, #4434/#5480).
 * Filtering runs through `matchesFilterCondition`, the same evaluator the
 * security plugin itself uses, so a filter this suite asserts on is a filter
 * that was really applied rather than one merely inspected.
 */
function makeStore(rows: Record<string, Row[]>, brokenDetail = false) {
  const schemas: Record<string, unknown> = {
    crm_account: ACCOUNT_SCHEMA,
    crm_contact: brokenDetail ? CONTACT_SCHEMA_NO_MASTER_DETAIL : CONTACT_SCHEMA,
    sys_record_share: SHARE_SCHEMA,
  };
  return {
    rows,
    getSchema: (object: string) => schemas[object],
    find: vi.fn(async (object: string, options: any = {}) => {
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

/** The fixture rows — identical for every case; only the grant level varies. */
function fixtureRows(shareLevel: 'read' | 'edit' | null): Record<string, Row[]> {
  return {
    crm_account: [
      { id: 'acct_us', name: 'US Corp', owner_id: OTHER }, // shared to the rep
      { id: 'acct_eu', name: 'EU Corp', owner_id: OTHER }, // NOT shared — the excluded row
      { id: 'acct_own', name: 'Own Corp', owner_id: REP }, // the rep's own
    ],
    crm_contact: [
      { id: 'ct_us', name: 'US contact', account: 'acct_us' },
      { id: 'ct_eu', name: 'EU contact', account: 'acct_eu' },
      { id: 'ct_own', name: 'Own contact', account: 'acct_own' },
    ],
    sys_record_share: shareLevel
      ? [
          {
            id: 'shr_1',
            object_name: 'crm_account',
            record_id: 'acct_us',
            recipient_type: 'user',
            recipient_id: REP,
            access_level: shareLevel,
          },
        ]
      : [],
  };
}

interface BootOptions {
  /** The single grant's level, or `null` for a fixture with no grant at all. */
  shareLevel?: 'read' | 'edit' | null;
  /** `'none'` boots a deployment WITHOUT plugin-sharing; `'throws'` a broken one. */
  sharing?: 'real' | 'none' | 'throws';
  /**
   * [#7474] `'no-master-detail'` swaps the detail's schema for the AUTHORING
   * DEFECT the metadata-defect leg exists to report: `controlled_by_parent`
   * declared on an object with no relation to derive access from.
   */
  detail?: 'valid' | 'no-master-detail';
  /** [#7474] Replace the detail rows — e.g. one whose master FK is null. */
  contacts?: Row[];
  /** [#7474] Replace the caller's permission set (the master-CRUD / master-RLS legs). */
  sets?: PermissionSet[];
}

async function boot(options: BootOptions = {}) {
  const shareLevel = options.shareLevel === undefined ? 'edit' : options.shareLevel;
  const fixture = fixtureRows(shareLevel);
  if (options.contacts) fixture.crm_contact = options.contacts;
  const store = makeStore(fixture, options.detail === 'no-master-detail');
  const sets = options.sets ?? [REP_SET];

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
  };
  if ((options.sharing ?? 'real') === 'real') {
    // The REAL sharing service over the same store — the point of the fix is
    // that the derivation reuses this exact producer instead of re-deriving
    // owner/share semantics inside plugin-security.
    services.sharing = new SharingService({ engine: store as unknown as SharingEngine });
  } else if (options.sharing === 'throws') {
    services.sharing = {
      buildReadFilter: async () => {
        throw new Error('sharing store unreachable');
      },
      canEdit: async () => {
        throw new Error('sharing store unreachable');
      },
    };
  }

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

  /** The READ face: run the middleware, then apply the filter it injected. */
  const visibleContacts = async (): Promise<string[]> => {
    const opCtx: any = {
      object: 'crm_contact',
      operation: 'find',
      ast: {},
      options: {},
      context: repContext(),
    };
    await middleware(opCtx, async () => {});
    return (store.rows.crm_contact ?? [])
      .filter((r) => matchesFilterCondition(r, opCtx.ast.where ?? null))
      .map((r) => String(r.id));
  };

  /**
   * [#5815] The ANALYTICS read face: the scope `getReadFilter` hands the
   * raw-SQL path, applied to the same rows. No middleware runs here — this
   * method IS the whole enforcement on that surface.
   */
  const analyticsVisibleContacts = async (context?: any): Promise<string[]> => {
    const filter = await plugin.getReadFilter('crm_contact', context ?? repContext());
    return (store.rows.crm_contact ?? [])
      .filter((r) => matchesFilterCondition(r, (filter ?? null) as any))
      .map((r) => String(r.id));
  };

  /** The WRITE face: a by-id update of one detail row. Resolves or throws. */
  const updateContact = async (id: string): Promise<void> => {
    const opCtx: any = {
      object: 'crm_contact',
      operation: 'update',
      data: { id, name: 'renamed' },
      options: { where: { id } },
      context: repContext(),
    };
    await middleware(opCtx, async () => {});
  };

  const writableContacts = async (): Promise<string[]> => {
    const out: string[] = [];
    for (const row of store.rows.crm_contact ?? []) {
      try {
        await updateContact(String(row.id));
        out.push(String(row.id));
      } catch {
        /* denied */
      }
    }
    return out;
  };

  /** [#7474] The INSERT face — the one leg that reads the master FK off the body. */
  const insertContact = async (data: Row): Promise<void> => {
    const opCtx: any = {
      object: 'crm_contact',
      operation: 'insert',
      data,
      options: {},
      context: repContext(),
    };
    await middleware(opCtx, async () => {});
  };

  return {
    store,
    ctx,
    plugin,
    repContext,
    visibleContacts,
    analyticsVisibleContacts,
    updateContact,
    insertContact,
    writableContacts,
  };
}

describe('[#5386] controlled_by_parent folds the master\'s ownership and share grants in', () => {
  // ── READ face ────────────────────────────────────────────────────────────
  it('READ: only children of masters the caller can actually read are visible', async () => {
    const h = await boot({ shareLevel: 'edit' });
    // acct_own is reachable by OWNERSHIP, acct_us by the single GRANT,
    // acct_eu by neither — so its contact must not appear.
    expect(await h.visibleContacts()).toEqual(['ct_us', 'ct_own']);
  });

  it('READ: with no grant at all, only the caller-owned master\'s children survive', async () => {
    const h = await boot({ shareLevel: null });
    expect(await h.visibleContacts()).toEqual(['ct_own']);
  });

  it('READ: the derived master id set equals what a direct find of the master returns', async () => {
    const h = await boot({ shareLevel: 'edit' });
    // The master half, resolved exactly as a direct read would: owner-match
    // OR-ed with the caller's grants. This is the set the child filter must
    // quantify over — asserted here so a future change that widens the derived
    // set without widening the master's own read is caught at the seam.
    const sharing = new SharingService({ engine: h.store as unknown as SharingEngine });
    const masterFilter = await sharing.buildReadFilter('crm_account', {
      userId: REP,
      tenantId: 'org-1',
    } as any);
    const directlyReadable = (h.store.rows.crm_account ?? [])
      .filter((r) => matchesFilterCondition(r, masterFilter as any))
      .map((r) => String(r.id));
    expect(directlyReadable).toEqual(['acct_us', 'acct_own']);
  });

  // ── WRITE face ───────────────────────────────────────────────────────────
  it('WRITE: a by-id update of a child under an unreachable master is denied', async () => {
    const h = await boot({ shareLevel: 'edit' });
    await expect(h.updateContact('ct_eu')).rejects.toThrow(/requires edit access to its master/);
  });

  it('WRITE: children of an owned master and of an edit-shared master stay writable', async () => {
    const h = await boot({ shareLevel: 'edit' });
    await expect(h.updateContact('ct_own')).resolves.toBeUndefined();
    await expect(h.updateContact('ct_us')).resolves.toBeUndefined();
  });

  // ── the invariant the two faces owe each other ───────────────────────────
  it('INVARIANT: read-visible and by-id-writable agree on the same fixture', async () => {
    const h = await boot({ shareLevel: 'edit' });
    const readable = await h.visibleContacts();
    const writable = await h.writableContacts();
    expect(readable.sort()).toEqual(writable.sort());
    // …and the agreement is not the empty agreement: exactly one row is
    // excluded, so "consistent" carries information.
    expect(readable).not.toContain('ct_eu');
    expect(readable).toHaveLength(2);
  });

  it('a READ-level grant opens the child for reading but NOT for writing — the master\'s own verb boundary', async () => {
    const h = await boot({ shareLevel: 'read' });
    // Same asymmetry a DIRECT access of the master has: a `read` share widens
    // rows for reads only; `canEdit` refuses it. The derived faces must track
    // that per-verb answer rather than collapsing to one of them.
    expect(await h.visibleContacts()).toEqual(['ct_us', 'ct_own']);
    expect(await h.writableContacts()).toEqual(['ct_own']);
    await expect(h.updateContact('ct_us')).rejects.toThrow(/record sharing/);
  });

  // ── boundary conditions ──────────────────────────────────────────────────
  it('the fold reads the grant table, resolves the master ONCE, and never re-enters the detail', async () => {
    const h = await boot({ shareLevel: 'edit' });
    h.store.find.mockClear();
    await h.visibleContacts();
    const reads = h.store.find.mock.calls.map((c: any[]) => String(c[0]));
    // The grant table was consulted — direct evidence the sharing half ran and
    // not merely that some filter came back.
    expect(reads).toContain('sys_record_share');
    // The master id set is resolved by ONE system-context read. More than one
    // would mean the derivation re-entered the middleware (v1 is single-level,
    // ADR-0055 — the master's own controlled_by_parent is not walked).
    expect(reads.filter((o) => o === 'crm_account')).toHaveLength(1);
    expect(reads).not.toContain('crm_contact');
  });

  it('a deployment WITHOUT plugin-sharing is unchanged — RLS-only derivation, nothing to fold', async () => {
    // No sharing service means no owner scope and no grants anywhere in the
    // deployment, so a direct find of the master returns every row too: the
    // derived set stays point-for-point equal to it.
    const h = await boot({ shareLevel: 'edit', sharing: 'none' });
    expect(await h.visibleContacts()).toEqual(['ct_us', 'ct_eu', 'ct_own']);
    await expect(h.updateContact('ct_eu')).resolves.toBeUndefined();
  });

  it('fail-closed: a sharing service that throws denies BOTH faces', async () => {
    const h = await boot({ shareLevel: 'edit', sharing: 'throws' });
    expect(await h.visibleContacts()).toEqual([]);
    await expect(h.updateContact('ct_us')).rejects.toThrow(/record sharing/);
  });
});

// ---------------------------------------------------------------------------

/**
 * [#5815] The THIRD face of the same contract — `getReadFilter`, the read-scope
 * provider bound by the analytics / raw-SQL path.
 *
 * The suite above pins the engine middleware and the by-id write gate against
 * one fixture precisely so a third, quieter answer cannot hide between them.
 * There WAS one: `getReadFilter` composed the RLS layer and the sharing layer
 * and never called the controlled_by_parent derivation at all. On this exact
 * fixture both of those layers legitimately return `null` — the app authors no
 * RLS, and plugin-sharing maps `controlled_by_parent` to `public` — so the
 * composed scope came back `undefined`: NO predicate. A caller who could not
 * read `acct_eu` could still `COUNT(*)` and `GROUP BY` its contacts.
 *
 * These cases therefore assert AGREEMENT, not a filter shape. The two read
 * surfaces may compose their layers in any order and produce different ASTs;
 * what they may never do is disagree about which rows are visible.
 */
describe('[#5815] getReadFilter enforces the same read scope as the engine middleware', () => {
  it('PARITY: the analytics read scope and the middleware-injected `ast.where` see the same rows', async () => {
    const h = await boot({ shareLevel: 'edit' });
    const viaMiddleware = await h.visibleContacts();
    const viaReadFilter = await h.analyticsVisibleContacts();
    expect(viaReadFilter.sort()).toEqual(viaMiddleware.sort());
    // …and the agreement carries information: one row is excluded on BOTH
    // surfaces. Without this, "identical" would be satisfied by two surfaces
    // that each return everything — which is exactly the broken state.
    expect(viaReadFilter).not.toContain('ct_eu');
    expect(viaReadFilter).toHaveLength(2);
  });

  it('the returned scope is a real predicate, not `undefined` — the defect measured', async () => {
    const h = await boot({ shareLevel: 'edit' });
    const filter = await h.plugin.getReadFilter('crm_contact', h.repContext());
    // Before the fix this was `undefined` (RLS null AND sharing null), which
    // the raw-SQL path spreads into a WHERE that constrains nothing.
    expect(filter).toBeDefined();
    expect(JSON.stringify(filter)).toContain('acct_own');
    expect(JSON.stringify(filter)).not.toContain('acct_eu');
  });

  it('PARITY with no grant at all: both surfaces narrow to the caller-owned master', async () => {
    const h = await boot({ shareLevel: null });
    expect(await h.analyticsVisibleContacts()).toEqual(await h.visibleContacts());
    expect(await h.analyticsVisibleContacts()).toEqual(['ct_own']);
  });

  it('PARITY on a READ-level grant: the read share widens the analytics face too', async () => {
    const h = await boot({ shareLevel: 'read' });
    expect(await h.analyticsVisibleContacts()).toEqual(['ct_us', 'ct_own']);
    expect(await h.analyticsVisibleContacts()).toEqual(await h.visibleContacts());
  });

  it('PARITY without plugin-sharing: neither surface narrows, for the same reason', async () => {
    // Both faces stand down together — there is no owner scope and there are no
    // grants anywhere in the deployment, so a direct find of the master returns
    // every row. Parity must hold in the WIDE direction as well, or the pin
    // would merely be asserting that the analytics face is always narrower.
    const h = await boot({ shareLevel: 'edit', sharing: 'none' });
    expect(await h.analyticsVisibleContacts()).toEqual(['ct_us', 'ct_eu', 'ct_own']);
    expect(await h.analyticsVisibleContacts()).toEqual(await h.visibleContacts());
  });

  it('fail-closed: a sharing service that throws denies the analytics face too', async () => {
    const h = await boot({ shareLevel: 'edit', sharing: 'throws' });
    expect(await h.analyticsVisibleContacts()).toEqual([]);
    expect(await h.analyticsVisibleContacts()).toEqual(await h.visibleContacts());
  });

  it('fail-closed: the derivation resolves the master ONCE per call, never re-entering the detail', async () => {
    const h = await boot({ shareLevel: 'edit' });
    h.store.find.mockClear();
    await h.analyticsVisibleContacts();
    const reads = h.store.find.mock.calls.map((c: any[]) => String(c[0]));
    // Direct evidence the derivation (and its sharing half) ran on THIS path
    // rather than a filter merely coming back from somewhere.
    expect(reads).toContain('sys_record_share');
    expect(reads.filter((o) => o === 'crm_account')).toHaveLength(1);
    expect(reads).not.toContain('crm_contact');
  });

  it('a delegated (on-behalf-of) read still denies outright — unchanged by the added layer', async () => {
    // [#2852] The D10 delegator intersection is not implemented on this path,
    // so it fails closed BEFORE any layer is composed. Pinned here because the
    // added layer must not become a reason to compute a scope for a context
    // this method refuses to scope at all.
    const h = await boot({ shareLevel: 'edit' });
    const delegated = { ...h.repContext(), onBehalfOf: { userId: OTHER } };
    expect(await h.analyticsVisibleContacts(delegated)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * [#7474] SIX conditions refuse a write in `assertControlledByParentWrite`, and
 * until the maintainer ruling of 2026-08-11 they answered with ONE sentence and
 * ONE code: `403 PERMISSION_DENIED — requires edit access to its master record`.
 *
 * Three of them are genuine authorization verdicts and keep exactly that. Three
 * are not verdicts at all — a broken `master_detail` declaration, a row that
 * does not exist, a null master FK — and the shared sentence was a false
 * statement with a false remedy: "ask whoever owns the parent record" cannot
 * fix any of them. Worse for the app author, the metadata defect is a precisely
 * detectable AUTHORING error that was wearing the costume of routine RBAC
 * noise, which is the class of thing nobody ever investigates.
 *
 * ## Why these cases assert `code` and `status`, never just a throw
 *
 * The defect is the ENVELOPE, not the refusal: every one of these six threw
 * before this change too. A `rejects.toThrow()` — or a message-only assertion —
 * carries one bit where the defect has two, so it stays green on precisely the
 * behaviour the issue reported. The minimum here is therefore the ADR-0112 pair
 * (`code` + `status`), plus the message where the WORDING is the contract: the
 * three authorization legs must keep their sentence verbatim, because that
 * sentence is what a user reads and what consumers already pin.
 *
 * The pinned pairs are the split itself:
 *
 *   | leg                                    | status | code                    |
 *   |----------------------------------------|--------|-------------------------|
 *   | no object-level `update` on the master | 403    | PERMISSION_DENIED       |
 *   | master row outside the write RLS       | 403    | PERMISSION_DENIED       |
 *   | no `edit`-level share grant            | 403    | PERMISSION_DENIED       |
 *   | controlled_by_parent, no master_detail | 422    | INVALID_METADATA        |
 *   | target record not found                | 404    | RECORD_NOT_FOUND        |
 *   | detail has no master reference         | 422    | MISSING_REQUIRED_FIELD  |
 */
describe('[#7474] the six refusal legs answer with six envelopes, not one', () => {
  /** The thrown error itself — `rejects.toThrow` cannot see `code` / `status`. */
  const refusalOf = async (run: Promise<unknown>): Promise<any> => {
    try {
      await run;
    } catch (e) {
      return e;
    }
    throw new Error('expected the write to be refused, but it resolved');
  };

  /** REP_SET with the master's object-level `update` withheld. */
  const NO_MASTER_EDIT: PermissionSet = {
    name: 'crm_rep',
    label: 'CRM Rep',
    objects: {
      crm_account: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: true },
      crm_contact: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    },
  } as unknown as PermissionSet;

  /** REP_SET plus a write RLS on the MASTER that matches no row in the fixture. */
  const MASTER_WRITE_RLS: PermissionSet = {
    name: 'crm_rep',
    label: 'CRM Rep',
    objects: {
      crm_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      crm_contact: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    },
    rowLevelSecurity: [
      { object: 'crm_account', operation: 'update', using: "name = 'No Such Corp'" },
    ],
  } as unknown as PermissionSet;

  // ── the three GENUINE authorization verdicts — unchanged, verbatim ────────

  it('403 PERMISSION_DENIED: the caller holds no object-level update on the master', async () => {
    const h = await boot({ shareLevel: 'edit', sets: [NO_MASTER_EDIT] });
    const err = await refusalOf(h.updateContact('ct_own'));
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode).toBe(403);
    // The sentence is contract on this leg — a user reads it, and consumers
    // pin it. It must survive the split byte-for-byte.
    expect(err.message).toContain("requires edit access to its master record");
    expect(err.message).toContain("no edit permission on master 'crm_account'");
  });

  it('403 PERMISSION_DENIED: the master row is outside the caller\'s write RLS', async () => {
    const h = await boot({ shareLevel: 'edit', sets: [MASTER_WRITE_RLS] });
    const err = await refusalOf(h.updateContact('ct_own'));
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('requires edit access to its master record');
    expect(err.message).toContain('row-level security');
  });

  it('403 PERMISSION_DENIED: the master carries no edit-level share grant', async () => {
    const h = await boot({ shareLevel: 'read' });
    const err = await refusalOf(h.updateContact('ct_us'));
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('requires edit access to its master record');
    expect(err.message).toContain('record sharing');
  });

  // ── the three NON-VERDICT legs — split by true semantics ──────────────────

  it('422 INVALID_METADATA: controlled_by_parent declared with no master_detail relation', async () => {
    const h = await boot({ shareLevel: 'edit', detail: 'no-master-detail' });
    const err = await refusalOf(h.updateContact('ct_own'));
    expect(err.code).toBe('INVALID_METADATA');
    expect(err.status).toBe(422);
    expect(err.statusCode).toBe(422);
    // The remedy has to be IN the message: `details` is not a carrier the
    // client can rely on (#7450), so the sentence is the whole fix-it.
    expect(err.message).toContain('no master_detail relation');
    expect(err.message).toContain('Declare a required master_detail field');
    // …and it must NOT wear the 403's costume: that prefix is a MATCHER at both
    // transports, so borrowing it would re-flatten this to PERMISSION_DENIED.
    expect(err.message).not.toContain('[Security] Access denied');
    expect(err.message).not.toContain('requires edit access to its master record');
  });

  it('404 RECORD_NOT_FOUND: the by-id write targets a detail row that does not exist', async () => {
    const h = await boot({ shareLevel: 'edit' });
    const err = await refusalOf(h.updateContact('ct_deleted_concurrently'));
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('ct_deleted_concurrently');
    expect(err.message).not.toContain('requires edit access to its master record');
  });

  it('404 is real absence, not an RLS-hidden row: the probe reads under a SYSTEM context', async () => {
    // The one thing a 404 must never become is an oracle. `ct_eu` exists but
    // its master is unreachable to the caller — the row is read as system, so
    // it is FOUND here and falls through to the authorization leg. Both halves
    // asserted together: this is what makes the 404 above mean "absent".
    const h = await boot({ shareLevel: 'edit' });
    const hidden = await refusalOf(h.updateContact('ct_eu'));
    expect(hidden.code).toBe('PERMISSION_DENIED');
    expect(hidden.statusCode).toBe(403);
    expect(hidden.message).toContain('requires edit access to its master record');
  });

  it('422 MISSING_REQUIRED_FIELD: the stored detail row has no master reference', async () => {
    const h = await boot({
      shareLevel: 'edit',
      contacts: [{ id: 'ct_orphan', name: 'Orphan contact', account: null }],
    });
    const err = await refusalOf(h.updateContact('ct_orphan'));
    expect(err.code).toBe('MISSING_REQUIRED_FIELD');
    expect(err.status).toBe(422);
    expect(err.statusCode).toBe(422);
    // The stored-row wording names the row, because the caller cannot fix this
    // one by sending a different payload.
    expect(err.message).toContain("record 'ct_orphan' has no value in 'account'");
    expect(err.message).not.toContain('requires edit access to its master record');
  });

  it('422 MISSING_REQUIRED_FIELD: an insert that omits the master reference', async () => {
    const h = await boot({ shareLevel: 'edit' });
    const err = await refusalOf(h.insertContact({ name: 'New contact' }));
    expect(err.code).toBe('MISSING_REQUIRED_FIELD');
    expect(err.status).toBe(422);
    // Same condition, same code, and the wording says which shape it is: the
    // REQUEST omitted the FK, so the remedy is to send it.
    expect(err.message).toContain("did not supply 'account'");
    expect(err.message).not.toContain('requires edit access to its master record');
  });

  // ── the split itself ─────────────────────────────────────────────────────

  it('the non-verdict legs are DISTINGUISHABLE from the verdicts and from each other', async () => {
    const authorization = await refusalOf(
      (await boot({ shareLevel: 'read' })).updateContact('ct_us'),
    );
    const metadataDefect = await refusalOf(
      (await boot({ shareLevel: 'edit', detail: 'no-master-detail' })).updateContact('ct_own'),
    );
    const missingRow = await refusalOf(
      (await boot({ shareLevel: 'edit' })).updateContact('ct_gone'),
    );
    const nullMaster = await refusalOf(
      (await boot({
        shareLevel: 'edit',
        contacts: [{ id: 'ct_orphan', name: 'Orphan contact', account: null }],
      })).updateContact('ct_orphan'),
    );

    // Four conditions, four envelopes. Before the split these were one:
    // `403 PERMISSION_DENIED` with a single sentence, which is exactly what an
    // assertion set that only checked "it threw" could not see.
    const envelope = (e: any) => `${e.status ?? e.statusCode}/${e.code}`;
    expect([authorization, metadataDefect, missingRow, nullMaster].map(envelope)).toEqual([
      '403/PERMISSION_DENIED',
      '422/INVALID_METADATA',
      '404/RECORD_NOT_FOUND',
      '422/MISSING_REQUIRED_FIELD',
    ]);
    // The two 422s share a status and must still be told apart by `code` —
    // which is the field ADR-0112 makes the branch point.
    expect(metadataDefect.code).not.toBe(nullMaster.code);
  });
});
