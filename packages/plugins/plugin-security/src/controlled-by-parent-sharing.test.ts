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
import { recordNotFoundError } from '@objectstack/core';
import { SecurityPlugin } from './security-plugin.js';
import { SharingService, type SharingEngine } from '@objectstack/plugin-sharing';
import { matchesFilterCondition } from '@objectstack/formula';
// [#8688] The REAL required-field validator, not a restatement of it. The
// conditional stand-down's whole safety argument is "validation covers this
// omission, and does not cover those" — a hand-mirrored copy of that predicate
// would assert the belief instead of the behaviour, and would keep passing on
// the day the validator's own skip list changes. This package's vitest config
// aliases `@objectstack/objectql` to `packages/objectql/src`, so this resolves
// to the source in the checkout rather than a prebuilt dist.
import { validateRecord, assertEngineFindOnePredicate } from '@objectstack/objectql';
import type { PermissionSet } from '@objectstack/spec/security';
import { ObjectSchema, controlledByParentMasterRefusal } from '@objectstack/spec/data';

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
 * to derive access from — no master_detail field at all. The gate's
 * metadata-defect leg is the only thing between this object and a write that
 * answers a false 403.
 */
const CONTACT_SCHEMA_NO_MASTER_DETAIL = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    // A lookup, and OPTIONAL — no relation at all, before #23100 and after it
    // (a required lookup no longer resolves either; see the retired tiers).
    account: { name: 'account', type: 'lookup', reference: 'crm_account' },
  },
};

/**
 * [#8688] The declarations required-field validation does NOT cover, and the
 * reason the insert-leg stand-down is conditional rather than flat.
 *
 * `validateRecord` (`@objectstack/objectql`) walks every declared field on an
 * insert but skips provenance-flagged ones outright — `if (def.system ||
 * def.readonly) continue;` — before the required check, and never fires on a
 * field that is not `required` at all. On the `readonly` / `system` shapes
 * below this gate is therefore the only refusal an absent master FK meets —
 * the suite asserts that against the REAL validator rather than against a
 * belief about it. Neither is authorable any more: the parse refuses both
 * (`master-not-writable`, #25092), so they reach the runtime only through a
 * door that does not parse, and there the gate refuses every insert under
 * them as the declaration defect, `422 INVALID_METADATA` (#25095).
 *
 * [#23100] The first shape, a `master_detail` with no `required`, was the third
 * member of this set while `resolveCbpRelation`'s second fallback resolved it.
 * Ruling B retired that fallback, so it resolves NO relation now and meets the
 * metadata-defect leg instead — pinned with the other retired tier below.
 */
const CONTACT_SCHEMA_MASTER_NOT_REQUIRED = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: { name: 'account', type: 'master_detail', reference: 'crm_account' },
  },
};

const CONTACT_SCHEMA_MASTER_READONLY = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: {
      name: 'account', type: 'master_detail', required: true, readonly: true, reference: 'crm_account',
    },
  },
};

const CONTACT_SCHEMA_MASTER_SYSTEM = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: {
      name: 'account', type: 'master_detail', required: true, system: true, reference: 'crm_account',
    },
  },
};

/**
 * [#8688 → #23100] `controlled_by_parent` with no `master_detail` but a
 * REQUIRED lookup — `resolveCbpRelation`'s third fallback until ruling B
 * retired it, and HotCRM's `crm_campaign_member` / `crm_event_attendee` /
 * `crm_article_feedback` shape. It resolves no relation now.
 */
const CONTACT_SCHEMA_MASTER_REQUIRED_LOOKUP = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: { name: 'account', type: 'lookup', required: true, reference: 'crm_account' },
  },
};

/**
 * [#8688] The detail-object schema variants, keyed by the `boot({ detail })`
 * selector. `valid` is the shape the ruling covers; the rest are the shapes it
 * deliberately does not.
 */
/**
 * [#23100] Two REQUIRED master_details: the one tie left after the retired
 * tiers. The runtime used to take the first by field order; ADR-0055 §1 says
 * exactly one, so it derives none.
 */
const CONTACT_SCHEMA_TWO_MASTERS = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: { name: 'account', type: 'master_detail', required: true, reference: 'crm_account' },
    billing_account: { name: 'billing_account', type: 'master_detail', required: true, reference: 'crm_account' },
  },
};

const DETAIL_SCHEMAS = {
  'valid': CONTACT_SCHEMA,
  'no-master-detail': CONTACT_SCHEMA_NO_MASTER_DETAIL,
  'master-not-required': CONTACT_SCHEMA_MASTER_NOT_REQUIRED,
  'master-readonly': CONTACT_SCHEMA_MASTER_READONLY,
  'master-system': CONTACT_SCHEMA_MASTER_SYSTEM,
  'master-required-lookup': CONTACT_SCHEMA_MASTER_REQUIRED_LOOKUP,
  'two-masters': CONTACT_SCHEMA_TWO_MASTERS,
} as const;

type DetailVariant = keyof typeof DETAIL_SCHEMAS;

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
function makeStore(rows: Record<string, Row[]>, detail: DetailVariant = 'valid', faultOn?: string) {
  const schemas: Record<string, unknown> = {
    crm_account: ACCOUNT_SCHEMA,
    crm_contact: DETAIL_SCHEMAS[detail],
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
      assertEngineFindOnePredicate(object, options);
      // [#7505] The one thing this double gains: a store that is DOWN for one
      // object, so "the row is not there" and "I could not look" stop being the
      // same observation.
      if (faultOn && object === faultOn) throw datasourceOutage(object);
      const all = rows[object] ?? [];
      return all.find((r) => matchesFilterCondition(r, options?.where ?? null)) ?? null;
    }),
  };
}

/**
 * [#7505] A driver outage shaped like the real one. Modelled field-for-field on
 * `@objectstack/objectql`'s `DatasourceUnavailableError` — `code`, `name`,
 * `datasource`, and NO `status`, because that class declares none: `rest`'s
 * `mapDataError` routes it to 503 off the CODE (`rest-server.ts`, pinned by
 * `rest.test.ts` "maps ERR_DATASOURCE_UNAVAILABLE → 503"). Giving the double a
 * `status` the producer does not set would let these cases pass against an
 * error no engine can throw.
 *
 * `plugin-security` does not depend on `objectql` (it is not even a
 * devDependency — the plugin talks to the engine through the injected service),
 * so the shape is restated here rather than imported.
 */
function datasourceOutage(object: string): Error {
  const e = new Error(
    `[ObjectQL] Datasource 'primary' configured for object '${object}' is declared but not connected: ` +
      `it failed to connect at startup and the server was started with OS_ALLOW_DRIVER_CONNECT_FAILURE.`,
  ) as Error & { code: string; datasource: string };
  e.name = 'DatasourceUnavailableError';
  e.code = 'ERR_DATASOURCE_UNAVAILABLE';
  e.datasource = 'primary';
  return e;
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
   *
   * [#8688] `'master-readonly'` / `'master-system'` swap in the
   * master-reference declarations required-field validation does not cover —
   * see {@link DETAIL_SCHEMAS}. [#23100] `'master-not-required'`,
   * `'master-required-lookup'` and `'two-masters'` are the shapes ruling B
   * stopped resolving.
   */
  detail?: DetailVariant;
  /** [#7474] Replace the detail rows — e.g. one whose master FK is null. */
  contacts?: Row[];
  /** [#7474] Replace the caller's permission set (the master-CRUD / master-RLS legs). */
  sets?: PermissionSet[];
  /**
   * [#7505] Make `findOne` on this object throw a datasource outage, so a gate
   * that probes it gets "could not read" rather than "not there".
   */
  faultOn?: string;
}

async function boot(options: BootOptions = {}) {
  const shareLevel = options.shareLevel === undefined ? 'edit' : options.shareLevel;
  const fixture = fixtureRows(shareLevel);
  if (options.contacts) fixture.crm_contact = options.contacts;
  const store = makeStore(fixture, options.detail ?? 'valid', options.faultOn);
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

  /**
   * [#7474] The INSERT face — the one leg that reads the master FK off the body.
   *
   * [#8688] Resolves to whether the EXECUTOR was reached. The gate standing
   * down is not the absence of a throw, it is the write continuing down the
   * chain to the executor — which is where `validateRecord` runs and where the
   * missing-required-field answer now comes from. A middleware that swallowed
   * the operation would also "not throw", and that is a different outcome
   * entirely, so the two are told apart here rather than conflated.
   */
  const insertContact = async (data: Row): Promise<boolean> => {
    const opCtx: any = {
      object: 'crm_contact',
      operation: 'insert',
      data,
      options: {},
      context: repContext(),
    };
    let executorReached = false;
    await middleware(opCtx, async () => {
      executorReached = true;
    });
    return executorReached;
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

  it('a delegated (on-behalf-of) read whose delegator does not exist still denies outright — unchanged by the added layer', async () => {
    // [ADR-0090 D10] getReadFilter composes the delegator intersection for a
    // delegated context (ADR-0139 D5.1 as amended). This fixture stores no
    // `sys_user` row, so the link names a delegator who does not exist and the
    // read fails closed BEFORE any layer is composed. Pinned here because the
    // added layer must not become a reason to compute a scope for a context
    // whose delegator cannot be resolved.
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
 *
 * [#8688] The last row has since NARROWED — the maintainer ruling of
 * 2026-08-15 supersedes #7474's envelope choice for one of its two shapes. An
 * INSERT that omits the FK is handed to required-field validation (`400
 * VALIDATION_FAILED` with `fields[]`) wherever validation provably refuses it;
 * the row above still holds for the stored-row shape. [#25095] Of the three
 * declarations validation does not cover, the two flagged ones now answer an
 * insert `422 INVALID_METADATA` instead (the third resolves no relation). The insert leg below was rewritten
 * for that ruling, not adjusted to match observed behaviour — the successor
 * asserts both sides of the condition.
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
    // [#23100] Reworded with the rule: "no relation" is now "not exactly one
    // required master_detail" (ADR-0055 §1), and the remedy says so.
    expect(err.message).toContain('not exactly one required master_detail field');
    expect(err.message).toContain('Declare one master_detail field with required: true');
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
    // [#21771] The addressed by-id write now asks the read door first, so a
    // missing id gets the READ door's own not-found producer — which spells
    // the status once — rather than the master gate's detail copy.
    expect(err.message).toBe(recordNotFoundError('crm_contact', 'ct_deleted_concurrently').message);
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

  /**
   * [#8688] THE PIN THAT MOVED, rewritten deliberately.
   *
   * Until the maintainer ruling of 2026-08-15 this leg read:
   *
   *     it('422 MISSING_REQUIRED_FIELD: an insert that omits the master reference')
   *       expect(err.code).toBe('MISSING_REQUIRED_FIELD');
   *       expect(err.status).toBe(422);
   *       expect(err.message).toContain("did not supply 'account'");
   *
   * That assertion was correct about the code and wrong about who should be
   * answering. The gate runs in the middleware chain OUTSIDE the executor that
   * calls `validateRecord`, so on an insert it short-circuited required-field
   * validation on the one field they share — and the same omission that every
   * other required field answers `400 VALIDATION_FAILED` with `fields[]` came
   * back `422 MISSING_REQUIRED_FIELD` with no `fields[]` and a `[Security]`
   * prefix. Measured live on 17.0.0 GA, on the very same field whose
   * present-but-unresolvable case already answers the wanted envelope.
   *
   * The ruling supersedes #7474's envelope choice on that ruling's own
   * rationale: if a detail without its master is "precisely a required value
   * that is absent", the platform's contract for that is the validation
   * envelope. `fields[]` cannot be added while keeping the old code — BOTH
   * transport doors emit `fields[]` only for the `VALIDATION_FAILED` duck-type
   * and each overwrites `code` when it matches (`mapDataError`,
   * `packages/rest/src/rest-server.ts`; `validationFailureDetails` /
   * `VALIDATION_FAILED_STATUS = 400`, `packages/types/src/validation-failure.ts`)
   * — so the pin had to move for the defect to be fixable at all.
   *
   * ⛔ The successor is NOT "the gate no longer refuses". The stand-down is
   * CONDITIONAL, and the three cases below it are the condition: they are the
   * shapes where nothing downstream would refuse, and the gate must still.
   */
  it('[#8688] a REQUIRED master_detail omitted on insert is validation\'s answer, not the gate\'s', async () => {
    const h = await boot({ shareLevel: 'edit' });
    const payload = { name: 'New contact' };

    // ── half 1: the gate stands down, and the write CONTINUES ───────────────
    // Not merely "it did not throw": the executor is where `validateRecord`
    // runs, so reaching it is the whole content of the hand-over. A middleware
    // that silently swallowed the operation would also not throw.
    await expect(h.insertContact(payload)).resolves.toBe(true);

    // ── half 2: …and the subsystem it handed to really does refuse ──────────
    // The REAL `validateRecord` (aliased to `packages/objectql/src` by this
    // package's vitest config, so this is a verdict about the source in the
    // checkout, never a prebuilt dist), on the same payload and the same
    // schema. Without this half, half 1 would be indistinguishable from
    // silently admitting an orphan row.
    let err: any;
    try {
      validateRecord(CONTACT_SCHEMA as any, payload, 'insert');
    } catch (e) {
      err = e;
    }
    // The ADR-0112 envelope. `ValidationError` declares no `status` of its own:
    // 400 is the transports' constant for exactly this duck-type, and BOTH
    // properties the two doors branch on are asserted here rather than the
    // status they derive from them.
    expect(err?.name).toBe('ValidationError');
    expect(err?.code).toBe('VALIDATION_FAILED');
    // …and the half the card is actually about — a form can now highlight the
    // offending input, which no `MISSING_REQUIRED_FIELD` body ever carried.
    expect(err.fields).toContainEqual(
      expect.objectContaining({ field: 'account', code: 'required' }),
    );
  });

  /**
   * [#8688] The shapes the stand-down deliberately does NOT cover.
   *
   * `validateRecord` skips provenance-flagged fields before the required check
   * (`if (def.system || def.readonly) continue;`) and never fires on a field
   * that is not `required`. Handing those over would mint a detail row with a
   * null master FK — unmatchable by the `controlled_by_parent` read filter
   * (`fk IN (readable masters)`), so readable by nobody, and answering 422 on
   * every later by-id write. Each case asserts BOTH halves: the gate still
   * refuses, AND the real validator raises nothing, which is why it must.
   *
   * [#25095] The gate's answer for the two flagged shapes moved: the parse
   * refuses the declaration (`master-not-writable`), and the gate refuses every
   * insert under it as that defect, `422 INVALID_METADATA` with the parse's own
   * message, before the empty-master branch is reached.
   */
  it.each([
    ['`required` + `readonly`', 'master-readonly' as const, CONTACT_SCHEMA_MASTER_READONLY],
    ['`required` + `system`', 'master-system' as const, CONTACT_SCHEMA_MASTER_SYSTEM],
  ])('[#8688 → #25095] the gate still refuses an insert omitting the master: %s', async (_label, detail, schema) => {
    const payload = { name: 'New contact' };

    // Validation does not cover this shape — nothing downstream would refuse.
    expect(() => validateRecord(schema as any, payload, 'insert')).not.toThrow();

    // …so the gate answers, as the declaration defect the parse refuses.
    const h = await boot({ shareLevel: 'edit', detail });
    const err = await refusalOf(h.insertContact(payload));
    expect(err.code).toBe('INVALID_METADATA');
    expect(err.status).toBe(422);
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain(controlledByParentMasterRefusal(schema.name, schema.sharingModel, schema.fields)!.message);
    expect(err.message).not.toContain('requires edit access to its master record');
  });

  it('[#8688] the master-access verdict SURVIVES the stand-down: present but not writable is still 403', async () => {
    // The ruling requires this pinned as surviving. The stand-down is keyed on
    // the FK being ABSENT; a supplied master still runs every access leg, so
    // an insert under a master the caller cannot edit is refused exactly as
    // before — `acct_eu` exists and is shared to nobody.
    const h = await boot({ shareLevel: 'edit' });
    const err = await refusalOf(h.insertContact({ name: 'New contact', account: 'acct_eu' }));
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('requires edit access to its master record');
    // …and it is NOT the stand-down's envelope: a caller who supplied the
    // master must never be told they omitted it.
    expect(err.message).not.toContain("did not supply 'account'");
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

// ---------------------------------------------------------------------------

/**
 * [ADR-0055 §1 · #23100, maintainer ruling B] The runtime derives a master from
 * EXACTLY ONE required `master_detail` and from nothing else. Its second tier
 * (any `master_detail`) and third tier (a required `lookup`) retired, and two
 * required `master_detail` fields are no longer resolved by field order — so
 * each of those three shapes now meets BOTH fail-closed halves the no-relation
 * object always met: every read denied, every by-id write and every insert
 * refused with `422 INVALID_METADATA`, and the object reported once.
 *
 * Each shape is also held against `ObjectSchema`'s parse, which refuses it with
 * the same rule — the card behind the ruling was precisely the parse, the lint
 * and this gate disagreeing about which objects the rule covers.
 */
describe('[#23100] the retired master tiers derive NO master — fail-closed on both faces', () => {
  const refusalOf = async (run: Promise<unknown>): Promise<any> => {
    try {
      await run;
    } catch (e) {
      return e;
    }
    throw new Error('expected the write to be refused, but it resolved');
  };

  /** The parse's controlled_by_parent issues on one schema, by path. */
  const cbpParseIssuePaths = (schema: Record<string, unknown>) => {
    const parsed = ObjectSchema.safeParse(schema);
    if (parsed.success) return [];
    return parsed.error.issues
      .filter((i) => /declares sharingModel 'controlled_by_parent'/.test(i.message))
      .map((i) => i.path.join('.'));
  };

  const unresolvedReports = (h: Awaited<ReturnType<typeof boot>>) =>
    (h.ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter(([msg]) =>
      String(msg).startsWith('[security/controlled-by-parent] object "crm_contact"'),
    );

  // ── ACCEPTED CONTROL — the one tier ADR-0055 §1 records ──────────────────
  it('CONTROL: one required master_detail derives — rows readable, writes reach the executor, nothing reported', async () => {
    const h = await boot({ shareLevel: 'edit' });
    expect(await h.visibleContacts()).toEqual(['ct_us', 'ct_own']);
    await expect(h.updateContact('ct_own')).resolves.toBeUndefined();
    await expect(h.insertContact({ name: 'New contact', account: 'acct_own' })).resolves.toBe(true);
    expect(unresolvedReports(h)).toEqual([]);
    expect(cbpParseIssuePaths(CONTACT_SCHEMA)).toEqual([]);
  });

  it.each([
    ['a master_detail without `required` (the retired second tier)', 'master-not-required' as const, CONTACT_SCHEMA_MASTER_NOT_REQUIRED, 'sharingModel', /no required master_detail field; master_detail without required: true: account/],
    ['a required lookup (the retired third tier — the HotCRM shape)', 'master-required-lookup' as const, CONTACT_SCHEMA_MASTER_REQUIRED_LOOKUP, 'sharingModel', /no required master_detail field; required lookup: account/],
    ['two required master_details (no longer resolved by field order)', 'two-masters' as const, CONTACT_SCHEMA_TWO_MASTERS, 'fields', /2 required master_detail fields \(account, billing_account\)/],
  ])('%s: every read DENIED, every write 422 INVALID_METADATA, reported once', async (_label, detail, schema, parsePath, why) => {
    const h = await boot({ shareLevel: 'edit', detail });

    // READ: the master the old tier would have picked holds readable rows
    // (the control above reads two of them) — none survive now.
    expect(await h.visibleContacts()).toEqual([]);
    expect(await h.analyticsVisibleContacts()).toEqual([]);

    // WRITE: a by-id update under a master the caller CAN edit, and an insert
    // naming one — the metadata-defect leg, not an authorization verdict, and
    // not the null-FK leg the second tier used to reach.
    for (const run of [h.updateContact('ct_own'), h.insertContact({ name: 'New contact', account: 'acct_own' })]) {
      const err = await refusalOf(run);
      expect(err.code).toBe('INVALID_METADATA');
      expect(err.status).toBe(422);
      expect(err.message).toMatch(/^\[Security\] Configuration defect: (update|insert) on 'crm_contact' cannot be authorized because/);
    }

    // REPORTED, once per object per cache generation — not once per request.
    const reports = unresolvedReports(h);
    expect(reports).toHaveLength(1);
    expect(String(reports[0][0])).toMatch(why);

    // …and the parse refuses the same object, at the path the lint shares.
    expect(cbpParseIssuePaths(schema)).toEqual([parsePath]);
  });
});

// ---------------------------------------------------------------------------

/**
 * [#7505] The FIFTH condition the by-id gate can meet, and the one it used to
 * answer with somebody else's envelope: the store could not be read at all.
 *
 * `readRowById` flattened a thrown read into `null`, and `null` on this path
 * means "no such row" — so a driver outage arrived at the client as `404
 * RECORD_NOT_FOUND`. #7474 made that leg explicit and thereby made the lie
 * specific: an SDK treats 404 as TERMINAL (drop the id, stop retrying) exactly
 * when the truthful answer was "come back in a minute".
 *
 * Maintainer ruling of 2026-08-11: fail-closed, and never 404 for an outage.
 * The write is still refused — the gate throws before `next()`, so nothing
 * reaches the driver — but it is refused with the ENGINE's error, not with a
 * verdict this gate invented.
 *
 * Both directions are pinned per case: a genuinely absent row keeps its 404
 * (the steady state #7474 shipped), and only the fault path moved.
 */
describe('[#7505] a store fault is not an absent row', () => {
  /** REP_SET plus a write RLS on the MASTER — the leg that runs the master probe. */
  const MASTER_WRITE_RLS_SET: PermissionSet = {
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

  const refusalOf = async (run: Promise<unknown>): Promise<any> => {
    try {
      await run;
    } catch (e) {
      return e;
    }
    throw new Error('expected the write to be refused, but it resolved');
  };

  it('the detail-row probe faulting propagates ERR_DATASOURCE_UNAVAILABLE, not 404', async () => {
    const h = await boot({ shareLevel: 'edit', faultOn: 'crm_contact' });
    const err = await refusalOf(h.updateContact('ct_own'));

    // The engine's own error, unchanged: this gate is not the producer of a
    // datasource outage and re-badging one under a security code would relabel
    // a dependency failure as an authorization event. `rest`'s `mapDataError`
    // turns this code into 503 (pinned in `rest.test.ts`), which is the answer
    // an SDK can actually act on.
    expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
    expect(err.name).toBe('DatasourceUnavailableError');

    // …and the negative half, which is the whole ruling: NOT the absent-row
    // envelope, and not a borrowed 403 either.
    expect(err.code).not.toBe('RECORD_NOT_FOUND');
    expect(err.status ?? err.statusCode).not.toBe(404);
    expect(err.code).not.toBe('PERMISSION_DENIED');
    expect(err.message).not.toContain('does not exist');
    expect(err.message).not.toContain('requires edit access to its master record');
  });

  it('an engine error with NO code still never becomes a 404', async () => {
    // Not every read failure is a declared-datasource outage — a timeout or a
    // dropped socket arrives as a bare `Error`. It has no code for a transport
    // to map, so it lands in the 5xx catch-all: still fail-closed, still
    // truthful about being OUR problem, and still not "that record is gone".
    const h = await boot({ shareLevel: 'edit' });
    h.store.findOne.mockImplementation(async (object: string) => {
      if (object === 'crm_contact') throw new Error('read ECONNRESET');
      return null;
    });
    const err = await refusalOf(h.updateContact('ct_own'));
    expect(err.message).toContain('ECONNRESET');
    expect(err.code).toBeUndefined();
    expect(err.code).not.toBe('RECORD_NOT_FOUND');
    expect(err.name).not.toBe('DetailRecordNotFoundError');
  });

  it('STEADY STATE: a genuinely absent row still answers 404 RECORD_NOT_FOUND', async () => {
    // The other direction, on the same fixture and in the same describe, so
    // "fault propagates" can never be satisfied by a probe that simply throws
    // on everything. This is #7474's leg, unchanged.
    const h = await boot({ shareLevel: 'edit' });
    const err = await refusalOf(h.updateContact('ct_deleted_concurrently'));
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(err.status).toBe(404);
  });

  it('STEADY STATE: the three authorization verdicts are untouched by the change', async () => {
    // A fault-path change that quietly moved a real 403 would be a regression
    // the case above cannot see, because it never reaches the master legs.
    const envelope = (e: any) => `${e.status ?? e.statusCode}/${e.code}`;
    const noShare = await refusalOf((await boot({ shareLevel: 'read' })).updateContact('ct_us'));
    const hidden = await refusalOf((await boot({ shareLevel: 'edit' })).updateContact('ct_eu'));
    expect([envelope(noShare), envelope(hidden)]).toEqual([
      '403/PERMISSION_DENIED',
      '403/PERMISSION_DENIED',
    ]);
    // And a write that should SUCCEED still does — the fail-closed direction
    // must not have swallowed the happy path.
    await expect((await boot({ shareLevel: 'edit' })).updateContact('ct_own')).resolves.toBeUndefined();
  });

  it('the MASTER-visibility probe deliberately still fails closed to 403, not 503', async () => {
    // The per-caller half of the ruling, pinned so the asymmetry reads as a
    // decision instead of an oversight. Two probes, two questions:
    //
    //   • "does this detail row exist?" — an outage leaves it UNANSWERED, and
    //     answering "no" is the terminal lie the case above removes;
    //   • "is the master visible to you under your own write policy?" — an
    //     outage leaves it unanswered too, but the fail-closed default for a
    //     visibility question is "not visible", which is precisely what the
    //     403 says. The issue and the ruling both name this probe as the house
    //     posture to MATCH, not a site to change.
    //
    // Faulting `crm_account` reaches it: the detail read succeeds, so the gate
    // gets as far as resolving the master.
    const h = await boot({ shareLevel: 'edit', sets: [MASTER_WRITE_RLS_SET], faultOn: 'crm_account' });
    const err = await refusalOf(h.updateContact('ct_own'));
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('row-level security');
  });
});
