// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7451 — the END-USER-facing half of the `[Security] Access denied …` family,
 * driven through the REAL `SecurityPlugin` middleware.
 *
 * #7414 (PR #7449) converted ONE template: the object-CRUD grant denial. This
 * file covers the other gates of that middleware an ordinary, non-admin
 * business principal reaches on ordinary business work:
 *
 * | Gate | Was | Now renders |
 * |---|---|---|
 * | capability AND-gate (ADR-0066 D3/⑤) | `'crm_contract' (operation 'delete') requires capability [manage_contracts] — caller is missing […]` | `permission_denied` |
 * | row-level pre-image write denial (step 2.7) | `not permitted to update this 'crm_opportunity' record (row-level security)` | `record_access_denied` |
 * | row-level CHECK post-image denial (ADR-0058 D4) | `the update would violate a row-level CHECK on 'crm_opportunity'` | `record_change_not_allowed` |
 *
 * ## Why three keys and not one
 *
 * The catalog's rule is one key per SITUATION, not per wire code (#7307 gave
 * the single code `DELETE_RESTRICTED` two sentences). The situations here are
 * genuinely different in what the user can DO next: ask an administrator / ask
 * the record's owner / change what they just typed. The distinction the copy
 * deliberately does NOT make is "missing CRUD bit" vs "missing capability" —
 * that is a fact about our authorization model, the user's situation and remedy
 * are identical, so both render `permission_denied`.
 *
 * ## Why a real `II18nService` and not a stub
 *
 * A hand-written `t` can agree with a producer that disagrees with the shipped
 * implementation — this repo has two brace conventions in flight (#7333), and a
 * stub picks whichever one the test author had in mind. So the override rung is
 * measured against `FileI18nAdapter`, the actual `II18nService` the platform
 * ships, loaded the way `loadTranslations` loads a real bundle.
 *
 * The catalog half is pinned in
 * `packages/spec/src/system/operation-message.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { matchesFilterCondition } from '@objectstack/formula';
import { FileI18nAdapter } from '@objectstack/service-i18n';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata ───────────────────────────────────────────────────────────────

/** An ordinary tenant business object — the reporter's shape, not a `sys_` table. */
const OPPORTUNITY_SCHEMA = {
  name: 'crm_opportunity',
  fields: {
    id: { name: 'id' },
    name: { name: 'name' },
    stage: { name: 'stage' },
    owner_id: { name: 'owner_id' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * The capability AND-gate's object. `requiredPermissions` is an authorable
 * TOP-LEVEL object key (ADR-0066 D3, `object.zod.ts`), which is what makes this
 * gate reachable by a business user rather than only by an administrator: an
 * app author gates an ordinary object on an ordinary capability and every
 * member who lacks it meets this sentence on a normal click.
 */
const CONTRACT_SCHEMA = {
  name: 'crm_contract',
  requiredPermissions: ['manage_contracts'],
  fields: {
    id: { name: 'id' },
    title: { name: 'title' },
    owner_id: { name: 'owner_id' },
    organization_id: { name: 'organization_id' },
  },
};

const SCHEMAS: Record<string, any> = {
  crm_opportunity: OPPORTUNITY_SCHEMA,
  crm_contract: CONTRACT_SCHEMA,
};

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * Full object-level CRUD on both objects — so the CRUD grant gate (the one
 * #7414 already converted) ADMITS, and the refusals measured below come from
 * the gates this card is about. The row-level policies are the shape an app
 * author actually writes: showcase authors `using: 'assignee == current_user.email'`
 * and `check: 'owner == current_user.email'` on its own business objects.
 */
const APP_WRITER: PermissionSet = PermissionSetSchema.parse({
  name: 'app_writer',
  objects: {
    crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_contract: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [
    { name: 'own_opportunities_update', object: 'crm_opportunity', operation: 'update', using: 'owner_id == current_user.id' },
    { name: 'own_opportunities_delete', object: 'crm_opportunity', operation: 'delete', using: 'owner_id == current_user.id' },
    // check-only, so it governs the POST-image without also filtering the
    // pre-image — the two row-level gates stay independently reachable.
    { name: 'stage_stays_open', object: 'crm_opportunity', operation: 'update', check: "stage == 'open'" },
  ],
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, APP_WRITER];

const USER = 'u_rep';
const MINE = { id: 'opp_mine', name: 'Mine', stage: 'open', owner_id: USER, created_by: USER, organization_id: 'org1' };
const THEIRS = { id: 'opp_theirs', name: 'Theirs', stage: 'open', owner_id: 'u_other', created_by: 'u_other', organization_id: 'org1' };

// ── in-memory engine ───────────────────────────────────────────────────────

/**
 * ⚠️ `find` HONOURS its predicate, through the PRODUCER'S OWN matcher
 * (`matchesFilterCondition`, the function `security-plugin.ts` itself uses for
 * post-image checks). Both halves of that are load-bearing rather than
 * thoroughness:
 *
 *  1. A double whose `find` ignores the `where` hands every seeded row back for
 *     any query. `SecurityPlugin.start()` seeds its bootstrap permission sets
 *     through `insert`, and permission-set resolution reads them back with
 *     `find('sys_permission_set', { where: { name: { $in: … } } })` — so an
 *     ignoring double returns `admin_full_access` for any unresolved name and
 *     the gates ADMIT everything. That is measured, not hypothesised: it is
 *     exactly what the first draft of #7449's harness did, 12 green assertions
 *     all measuring an admission.
 *  2. A double with a HAND-WRITTEN matcher is the mirror failure. The row-level
 *     pre-image gate re-reads with `where: { $and: [{ id }, <rls filter>] }`;
 *     a matcher that does not understand `$and` matches nothing, every by-id
 *     write "is denied", and the denial cases below would pass while measuring
 *     the double's blindness instead of the gate's verdict. The positive
 *     controls in each describe exist to make that failure impossible to miss.
 */
function makeEngine() {
  const tables: Record<string, any[]> = {
    crm_opportunity: [{ ...MINE }, { ...THEIRS }],
    crm_contract: [{ id: 'ct_1', title: 'Theirs', owner_id: 'u_other', organization_id: 'org1' }],
  };
  const middlewares: any[] = [];
  const matches = (row: any, filter: any): boolean =>
    !filter || typeof filter !== 'object' ? true : matchesFilterCondition(row, filter);
  return {
    _tables: tables,
    _middlewares: middlewares,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => SCHEMAS[name],
    async find(object: string, options: any = {}) {
      return (tables[object] ??= []).filter((r) => matches(r, options?.where ?? options?.filter));
    },
    async findOne(object: string, options: any = {}) {
      return (await this.find(object, options))[0] ?? null;
    },
    async insert(object: string, data: any) { (tables[object] ??= []).push({ ...data }); return data; },
    // Both write verbs open with the PRODUCER's dispatch predicate, never a
    // hand-mirrored guard: a fake looser than `ObjectQL` collects greens from
    // call shapes the real engine would refuse.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      tables[object] = rows.filter((r) => !targets.includes(r));
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

// ── the stack ──────────────────────────────────────────────────────────────

interface Outcome {
  /** Did the middleware reach `next()`? */
  admitted: boolean;
  /** The END USER's half — what Console puts in the toast. */
  message: string;
  /** The DEVELOPER's half — must never be the same string as `message`. */
  developerMessage?: string;
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
  /** Everything the plugin logged, so the developer half can be located. */
  logged: { warn: string[]; error: string[] };
}

type OpShape = { object: string; operation: string; data?: any; options?: any };

/**
 * @param i18n a real `II18nService`, or `undefined` to run the deployment that
 *             registers none — the built-in catalog must still localize.
 */
async function run(op: OpShape, locale?: string, i18n?: FileI18nAdapter): Promise<Outcome> {
  const engine = makeEngine();
  const metadata = {
    get: async (_type: string, name: string) => SCHEMAS[name] ?? null,
    list: async () => PERMISSION_SETS,
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    'org-scoping': { name: 'org-scoping' },
    ...(i18n ? { i18n } : {}),
  };
  const warn: string[] = [];
  const error: string[] = [];
  const ctx: any = {
    logger: {
      info: vi.fn(), debug: vi.fn(),
      warn: (m: string) => { warn.push(String(m)); },
      error: (m: string) => { error.push(String(m)); },
    },
    registerService: vi.fn(),
    getService: (name: string) => {
      // A kernel that has no such service THROWS — the shape the plugin's own
      // ADR-0029 D8 contribution guards against, and the reason the i18n lookup
      // at the throw site is wrapped.
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  const securityMw = engine._middlewares[0];

  const opCtx: any = {
    ...op,
    context: {
      userId: USER,
      tenantId: 'org1',
      positions: ['org_member'],
      permissions: ['app_writer'],
      ...(locale ? { locale } : {}),
    },
  };
  let admitted = false;
  try {
    await securityMw(opCtx, async () => { admitted = true; });
  } catch (e: any) {
    return {
      admitted: false,
      message: String(e?.message ?? e),
      developerMessage: e?.developerMessage,
      code: e?.code,
      status: e?.statusCode,
      details: e?.details,
      logged: { warn, error },
    };
  }
  return { admitted, message: '', logged: { warn, error } };
}

const denyCapability = (locale?: string, i18n?: FileI18nAdapter) =>
  run({ object: 'crm_contract', operation: 'delete', options: { where: { id: 'ct_1' } } }, locale, i18n);

const denyRowLevel = (locale?: string, i18n?: FileI18nAdapter) =>
  run({ object: 'crm_opportunity', operation: 'update', data: { id: THEIRS.id, name: 'taken' } }, locale, i18n);

const denyRowCheck = (locale?: string, i18n?: FileI18nAdapter) =>
  run({ object: 'crm_opportunity', operation: 'update', data: { id: MINE.id, stage: 'closed' } }, locale, i18n);

/** The developer sentences the three messages used to be — the "byte for byte" rule. */
const DEV_CAPABILITY =
  "[Security] Access denied: 'crm_contract' (operation 'delete') requires capability " +
  '[manage_contracts] — caller is missing [manage_contracts]';
const DEV_ROW_LEVEL =
  "[Security] Access denied: not permitted to update this 'crm_opportunity' record (row-level security)";
const DEV_ROW_CHECK =
  "[Security] Access denied: the update would violate a row-level CHECK on 'crm_opportunity'";

/**
 * Everything a business user must never read in one of these toasts: object and
 * capability API names, the internal authorization nouns, the machine operation
 * token, and the developer prefix the sentences used to open with.
 */
const FORBIDDEN_IN_USER_COPY = [
  'crm_opportunity', 'crm_contract', 'manage_contracts',
  'positions', 'org_member', 'row-level', 'CHECK', 'capability',
  '[Security]', 'Access denied',
];

// ── the harness must be able to say YES ────────────────────────────────────

describe('#7451 — harness controls (a denial only means something if an admission is reachable)', () => {
  /**
   * ⚠️ These three are not padding. Every denial case in this file would also
   * pass against a harness that refuses EVERYTHING — a `find` that ignores its
   * predicate, a matcher blind to `$and`, a permission set that failed to
   * parse. These controls are the only assertions here that go red on that
   * class of harness bug, which is precisely the failure #7449 recorded.
   */
  it('ADMITS an update to a row the caller owns (the pre-image re-read really can return a row)', async () => {
    const out = await run({ object: 'crm_opportunity', operation: 'update', data: { id: MINE.id, name: 'renamed' } });
    expect(out.admitted, out.message).toBe(true);
  });

  it('ADMITS a post-image that satisfies the CHECK policy', async () => {
    const out = await run({ object: 'crm_opportunity', operation: 'update', data: { id: MINE.id, stage: 'open' } });
    expect(out.admitted, out.message).toBe(true);
  });

  it('ADMITS a delete of the caller\'s own row', async () => {
    const out = await run({ object: 'crm_opportunity', operation: 'delete', options: { where: { id: MINE.id } } });
    expect(out.admitted, out.message).toBe(true);
  });
});

// ── the three gates ────────────────────────────────────────────────────────

const GATES = [
  {
    label: 'capability AND-gate',
    deny: denyCapability,
    key: 'permission_denied',
    developer: DEV_CAPABILITY,
  },
  {
    label: 'row-level pre-image write denial',
    deny: denyRowLevel,
    key: 'record_access_denied',
    developer: DEV_ROW_LEVEL,
  },
  {
    label: 'row-level CHECK post-image denial',
    deny: denyRowCheck,
    key: 'record_change_not_allowed',
    developer: DEV_ROW_CHECK,
  },
] as const;

describe.each(GATES)('#7451 — the 403 an end user reads: $label', ({ deny, key, developer }) => {
  it('speaks the caller locale, not English', async () => {
    const zh = await deny('zh-CN');
    expect(zh.message).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'][key]);

    const ja = await deny('ja-JP');
    expect(ja.message).toBe(BUILTIN_OPERATION_MESSAGES['ja-JP'][key]);
    // Two locales, two different sentences — "localized" is measured, not
    // assumed from a single catalog read.
    expect(ja.message).not.toBe(zh.message);
  });

  it('falls back to en for a locale-less context and an uncarried locale', async () => {
    for (const locale of [undefined, 'de-DE']) {
      const out = await deny(locale);
      expect(out.message, `locale=${String(locale)}`).toBe(BUILTIN_OPERATION_MESSAGES.en[key]);
    }
  });

  it('names no object, no capability and no authorization vocabulary — in every locale it can render', async () => {
    const locales = Object.keys(BUILTIN_OPERATION_MESSAGES);
    // Guard the guard: a catalog that lost its locales would make this loop
    // vacuously true, which is the shape of an assertion that cannot fail.
    expect(locales.length).toBeGreaterThanOrEqual(4);
    for (const locale of locales) {
      const out = await deny(locale);
      // Pinned to the catalog sentence FIRST: a message that had gone empty
      // would satisfy every absence assertion below, so the absences are only
      // meaningful on top of a positive identity.
      expect(out.message).toBe(BUILTIN_OPERATION_MESSAGES[locale][key]);
      expect(out.message.length).toBeGreaterThan(10);
      for (const forbidden of FORBIDDEN_IN_USER_COPY) {
        expect(out.message.toLowerCase(), `${locale} must not say "${forbidden}"`)
          .not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('carries the previous sentence byte for byte on `developerMessage`, and logs it in English', async () => {
    const out = await deny('zh-CN');
    expect(out.developerMessage).toBe(developer);
    expect(out.developerMessage).not.toBe(out.message);
    expect(out.logged.warn).toContain(developer);
    // The log must not go out in the caller's language — the operator reading
    // it is not the caller.
    expect(out.logged.warn.join('\n')).not.toContain(out.message);
  });

  it('keeps `developerMessage` OUT of `details` — `details` is what the dispatcher serialises', async () => {
    // The measurement this decision rests on (#7414): the runtime dispatcher
    // does `this.error(e.message, 403, { code: 'PERMISSION_DENIED', ...(e.details ?? {}) })`
    // and `buildApiError` puts the remainder on the wire as `error.details`, so
    // anything inside `details` reaches the browser. REST's `mapDataError` does
    // not even read it, so there the message is the ONLY channel — which is why
    // the developer half is logged on both transports rather than shipped on
    // either. Widening that is #7450's question, not this card's.
    const out = await deny('zh-CN');
    expect(Object.keys(out.details ?? {})).not.toContain('developerMessage');
    expect(JSON.stringify(out.details)).not.toContain('[Security]');
  });
});

// ── the three situations are three sentences ───────────────────────────────

describe('#7451 — one key per SITUATION, not per wire code', () => {
  it('gives the row-level gates sentences of their own, distinct from the grant denial', async () => {
    const [cap, row, check] = await Promise.all([denyCapability('en'), denyRowLevel('en'), denyRowCheck('en')]);
    expect(row.message).not.toBe(cap.message);
    expect(check.message).not.toBe(cap.message);
    expect(check.message).not.toBe(row.message);
  });

  it('deliberately gives the capability gate the SAME sentence as the CRUD grant gate', async () => {
    // Not an oversight — the classification. A caller missing a CRUD bit and a
    // caller missing a `requiredPermissions` capability are in one situation
    // with one remedy ("an administrator can grant this"); which of the two
    // gates answered is a developer fact and stays on `developerMessage` and in
    // `details.missingPermissions`. If a future card gives them separate
    // sentences it should do so because a USER can act on the difference.
    const cap = await denyCapability('en');
    expect(cap.message).toBe(BUILTIN_OPERATION_MESSAGES.en.permission_denied);
    expect(cap.developerMessage).toContain('requires capability');
    expect(cap.details?.missingPermissions).toEqual(['manage_contracts']);
  });
});

// ── enforcement is untouched ───────────────────────────────────────────────

describe('#7451 — enforcement is untouched', () => {
  /**
   * ⚠️ Pins in this block are NON-REGRESSION guards, not revert-detectors:
   * they are green on `origin/main` too, BY CONSTRUCTION. That is the point —
   * this card is copy-only, and its reverse verification is that these do NOT
   * move while the messages do. Anything that moves here is a bug in the copy
   * change, not a passing revert test.
   */
  it('is still a 403 PERMISSION_DENIED at every converted gate', async () => {
    for (const { deny } of GATES) {
      const out = await deny('zh-CN');
      expect(out.code).toBe('PERMISSION_DENIED');
      expect(out.status).toBe(403);
    }
  });

  it('carries the same structured payload as before — byte for byte', async () => {
    expect((await denyCapability('zh-CN')).details).toEqual({
      operation: 'delete',
      object: 'crm_contract',
      positions: ['org_member'],
      permissionSets: ['app_writer'],
      requiredPermissions: ['manage_contracts'],
      missingPermissions: ['manage_contracts'],
    });
    expect((await denyRowLevel('zh-CN')).details).toEqual({
      operation: 'update',
      object: 'crm_opportunity',
      positions: ['org_member'],
      permissionSets: ['app_writer'],
      recordId: THEIRS.id,
    });
    expect((await denyRowCheck('zh-CN')).details).toEqual({
      operation: 'update',
      object: 'crm_opportunity',
      positions: ['org_member'],
      permissionSets: ['app_writer'],
    });
  });

  it('still refuses the write — the row is untouched', async () => {
    const out = await denyRowLevel('zh-CN');
    expect(out.admitted).toBe(false);
  });
});

// ── the resolution ladder, against the REAL II18nService ───────────────────

describe('#7451 — resolution ladder, against the REAL II18nService', () => {
  const bundleFor = (entries: Record<string, unknown>) => {
    const adapter = new FileI18nAdapter({ defaultLocale: 'en' });
    adapter.loadTranslations('zh-CN', entries);
    return adapter;
  };

  it('a deployment override under `errors.record_access_denied` wins', async () => {
    const out = await denyRowLevel('zh-CN', bundleFor({
      errors: { record_access_denied: '这条记录不在您的负责范围内,请联系记录负责人。' },
    }));
    expect(out.message).toBe('这条记录不在您的负责范围内,请联系记录负责人。');
  });

  it('overriding one key does NOT bleed into its siblings', async () => {
    const bundle = bundleFor({ errors: { record_access_denied: '仅覆盖这一条。' } });
    expect((await denyRowLevel('zh-CN', bundle)).message).toBe('仅覆盖这一条。');
    expect((await denyRowCheck('zh-CN', bundle)).message)
      .toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].record_change_not_allowed);
    expect((await denyCapability('zh-CN', bundle)).message)
      .toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].permission_denied);
  });

  it('a bundle that carries no such key falls through to the built-in catalog', async () => {
    // The real adapter echoes the KEY back on a miss — the contract
    // `renderOperationMessage` detects a miss by. Measured here rather than
    // stubbed, because a stub is free to answer `undefined` and hide the fact
    // that the producer must recognise an echo.
    const out = await denyRowCheck('zh-CN', bundleFor({ objects: { crm_opportunity: { label: '商机' } } }));
    expect(out.message).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].record_change_not_allowed);
  });

  it('leaves a broken override visibly broken rather than silently blank', async () => {
    // These sentences take no parameters, so an override that references one is
    // an authoring mistake. It must stay legible as a mistake — the #7333
    // brace-convention trap is only findable if the placeholder survives.
    const out = await denyRowLevel('zh-CN', bundleFor({
      errors: { record_access_denied: '无权访问:{{objectLabel}}' },
    }));
    expect(out.message).toBe('无权访问:{{objectLabel}}');
  });

  it('a deployment with NO i18n service still gets the caller locale', async () => {
    for (const { deny, key } of GATES) {
      const out = await deny('zh-CN');
      expect(out.message).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'][key]);
    }
  });
});
