// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7414 — the CALL SITE of the object-CRUD `403 PERMISSION_DENIED` copy, driven
 * through the REAL `SecurityPlugin` middleware.
 *
 * The refusal was never in doubt: the gate correctly declines the operation and
 * both transports ship a real 403. What reached the END USER was the problem.
 * `Error.message` is the body's human-readable string on every transport
 * (`mapDataError`'s `body.error`, the dispatcher's `error.message`) and Console
 * renders it verbatim in a toast, so an operator in a fully localized app read:
 *
 *   `[Security] Access denied: operation 'delete' on object 'app_child_object'
 *    is not permitted for positions [org_member, everyone]`
 *
 * English-only, naming a table they have never seen — on a cascade delete, a
 * CHILD object they never addressed, because `cascadeDeleteRelations`
 * re-authorises every child independently — and ending in `positions [...]`,
 * internal authorization vocabulary that reads as a contradiction to someone
 * who does hold rights on the record they clicked.
 *
 * These cases assert the SPLIT: `message` is the user's half (their locale, no
 * object, no operation, no positions) and `developerMessage` is the developer's
 * half, byte for byte what the message used to be. Enforcement is untouched:
 * `code`, `statusCode` and the whole structured `details` payload are pinned
 * unchanged.
 *
 * The catalog half is pinned in
 * `packages/spec/src/system/operation-message.test.ts`.
 *
 * ## Why a real `II18nService` and not a stub
 *
 * A hand-written `t` can agree with a producer that disagrees with the shipped
 * implementation — this repo has two brace conventions in flight (#7333), and a
 * stub picks whichever one the test author had in mind. So the override rung
 * below is measured against `FileI18nAdapter`, the actual `II18nService` the
 * platform ships, loaded the same way `loadTranslations` loads a real bundle.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { FileI18nAdapter } from '@objectstack/service-i18n';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata ───────────────────────────────────────────────────────────────

/**
 * The reporter's shape: an ordinary tenant business object. `crm_contract`
 * stands in for the `app_child_object` of the report — a table the operator has
 * never seen, whose API name is exactly what must not reach their toast.
 */
const CONTRACT_SCHEMA = {
  name: 'crm_contract',
  sharingModel: 'private',
  fields: {
    id: { name: 'id' },
    title: { name: 'title' },
    owner_id: { name: 'owner_id' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

const SCHEMAS: Record<string, any> = { crm_contract: CONTRACT_SCHEMA };

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * Read-and-edit, no DELETE bit — so the refusal below comes from the
 * OBJECT-level CRUD gate (step 2) and not from the row-level pre-image gate
 * further down, which produces a different sentence. The `developerMessage`
 * assertions pin which producer answered.
 */
const APP_READER: PermissionSet = PermissionSetSchema.parse({
  name: 'app_reader',
  objects: {
    crm_contract: { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, APP_READER];

const ROW = {
  id: 'ct_1', title: 'Theirs', owner_id: 'u_other', created_by: 'u_other', organization_id: 'org1',
};

// ── in-memory engine ───────────────────────────────────────────────────────

/**
 * ⚠️ `find` HONOURS its predicate, and that is load-bearing rather than
 * thoroughness. `SecurityPlugin.start()` seeds its bootstrap permission sets
 * through `insert`, and the `dbLoader` that backs permission-set resolution
 * reads them back with `find('sys_permission_set', { where: { name: { $in: … } } })`.
 * A double whose `find` ignores the `where` hands EVERY seeded set back for any
 * unresolved name — including `admin_full_access` — and the CRUD gate then
 * admits the delete this file exists to see refused. That is exactly what the
 * first draft of this harness did: 12 green-looking cases, all of them
 * measuring an admission. Measured, not hypothesised.
 */
function makeEngine() {
  const tables: Record<string, any[]> = { crm_contract: [{ ...ROW }] };
  const middlewares: any[] = [];
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
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
    // Both write verbs open with the PRODUCER's own dispatch predicate, never a
    // hand-mirrored guard: a fake looser than `ObjectQL` collects greens from
    // call shapes the engine would refuse. Nothing in this file reaches them
    // (the gate refuses first, which is the point), so they exist to keep the
    // double honest for whatever case is added next.
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

interface Denial {
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

/**
 * @param i18n a real `II18nService`, or `undefined` to run the deployment that
 *             registers none — the built-in catalog must still localize.
 */
async function denyDelete(
  locale: string | undefined,
  i18n?: FileI18nAdapter,
): Promise<Denial> {
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
      // ADR-0029 D8 contribution already guards against, and the reason the
      // i18n lookup at the throw site is wrapped.
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  const securityMw = engine._middlewares[0];

  const opCtx: any = {
    object: 'crm_contract',
    operation: 'delete',
    options: { where: { id: ROW.id } },
    context: {
      userId: 'u_rep',
      tenantId: 'org1',
      positions: ['org_member'],
      permissions: ['app_reader'],
      ...(locale ? { locale } : {}),
    },
  };
  try {
    await securityMw(opCtx, async () => { /* reached only if the gate admits */ });
  } catch (e: any) {
    return {
      message: String(e?.message ?? e),
      developerMessage: e?.developerMessage,
      code: e?.code,
      status: e?.statusCode,
      details: e?.details,
      logged: { warn, error },
    };
  }
  throw new Error('expected the CRUD gate to refuse the delete, but it admitted it');
}

/** The developer sentence the message used to be — the #7307 "byte for byte" rule. */
const DEVELOPER_SENTENCE =
  "[Security] Access denied: operation 'delete' on object 'crm_contract' " +
  'is not permitted for positions [org_member]';

/**
 * Everything a business user must never read in this toast: the object's API
 * name, the internal authorization noun, the machine operation token, and the
 * developer prefix the sentence used to open with.
 */
const FORBIDDEN_IN_USER_COPY = ['crm_contract', 'positions', 'org_member', '[Security]', 'Access denied'];

describe('#7414 — the 403 an end user reads', () => {
  it('speaks the caller locale, not English', async () => {
    const zh = await denyDelete('zh-CN');
    expect(zh.message).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].permission_denied);
    expect(zh.message).toBe('您没有执行此操作的权限,如需访问请联系管理员。');

    const ja = await denyDelete('ja-JP');
    expect(ja.message).toBe(BUILTIN_OPERATION_MESSAGES['ja-JP'].permission_denied);
    // Two locales, two different sentences — so "localized" is measured, not
    // assumed from one catalog read.
    expect(ja.message).not.toBe(zh.message);
  });

  it('falls back to en for a locale-less context and an uncarried locale', async () => {
    for (const locale of [undefined, 'de-DE']) {
      const denial = await denyDelete(locale);
      expect(denial.message, `locale=${String(locale)}`)
        .toBe(BUILTIN_OPERATION_MESSAGES.en.permission_denied);
    }
  });

  it('names no object, no operation and no position — in every locale it can render', async () => {
    const locales = Object.keys(BUILTIN_OPERATION_MESSAGES);
    expect(locales.length).toBeGreaterThanOrEqual(4);
    for (const locale of locales) {
      const denial = await denyDelete(locale);
      // Pinned to the catalog sentence FIRST: a message that had gone empty
      // would satisfy every absence assertion below, so the absences are only
      // meaningful on top of a positive identity.
      expect(denial.message).toBe(BUILTIN_OPERATION_MESSAGES[locale].permission_denied);
      expect(denial.message.length).toBeGreaterThan(10);
      for (const forbidden of FORBIDDEN_IN_USER_COPY) {
        expect(denial.message.toLowerCase(), `${locale} must not say "${forbidden}"`)
          .not.toContain(forbidden.toLowerCase());
      }
    }
  });
});

describe('#7414 — the developer half is moved, not lost', () => {
  it('carries the previous sentence byte for byte on `developerMessage`', async () => {
    const denial = await denyDelete('zh-CN');
    expect(denial.developerMessage).toBe(DEVELOPER_SENTENCE);
    expect(denial.developerMessage).not.toBe(denial.message);
  });

  it('logs it server-side, in English, whatever the caller locale is', async () => {
    const denial = await denyDelete('zh-CN');
    expect(denial.logged.warn).toContain(DEVELOPER_SENTENCE);
    // The log must not go out in the caller's language — the operator reading
    // it is not the caller.
    expect(denial.logged.warn.join('\n')).not.toContain('您没有执行此操作的权限');
  });

  it('keeps `developerMessage` OUT of `details` — `details` is what the dispatcher serialises', async () => {
    // The measurement this decision rests on: `http-dispatcher.ts`'s catch does
    // `this.error(e.message, 403, { code: 'PERMISSION_DENIED', ...(e.details ?? {}) })`
    // and `buildApiError` puts the remainder on the wire as `error.details`.
    // Anything inside `details` therefore reaches the browser; the developer
    // sentence must not.
    const denial = await denyDelete('zh-CN');
    expect(Object.keys(denial.details ?? {})).not.toContain('developerMessage');
    expect(JSON.stringify(denial.details)).not.toContain('[Security]');
  });
});

describe('#7414 — enforcement is untouched', () => {
  /**
   * ⚠️ Pins in this block are NON-REGRESSION guards, not revert-detectors:
   * they are green on `origin/main` too, by construction. That is the point —
   * this card is copy-only, and the reverse verification for it is that these
   * do NOT move while the message does.
   */
  it('is still a 403 PERMISSION_DENIED', async () => {
    const denial = await denyDelete('zh-CN');
    expect(denial.code).toBe('PERMISSION_DENIED');
    expect(denial.status).toBe(403);
  });

  it('carries the same structured payload as before', async () => {
    const denial = await denyDelete('zh-CN');
    expect(denial.details).toEqual({
      operation: 'delete',
      object: 'crm_contract',
      positions: ['org_member'],
      permissionSets: ['app_reader'],
    });
  });
});

describe('#7414 — resolution ladder, against the REAL II18nService', () => {
  const bundleFor = (entries: Record<string, unknown>) => {
    const adapter = new FileI18nAdapter({ defaultLocale: 'en' });
    adapter.loadTranslations('zh-CN', entries);
    return adapter;
  };

  it('a deployment override under `errors.permission_denied` wins', async () => {
    const denial = await denyDelete('zh-CN', bundleFor({
      errors: { permission_denied: '此操作已被安全策略阻止,请联系系统管理员。' },
    }));
    expect(denial.message).toBe('此操作已被安全策略阻止,请联系系统管理员。');
  });

  it('a bundle that carries no such key falls through to the built-in catalog', async () => {
    // The real adapter echoes the KEY back on a miss — the contract
    // `renderOperationMessage` detects a miss by. Measured here rather than
    // stubbed, because a stub is free to answer `undefined` and hide the fact
    // that the producer must recognise an echo.
    const denial = await denyDelete('zh-CN', bundleFor({
      objects: { crm_contract: { label: '合同' } },
    }));
    expect(denial.message).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].permission_denied);
  });

  it('leaves a broken override visibly broken rather than silently blank', async () => {
    // This sentence takes no parameters, so an override that references one is
    // an authoring mistake. It must stay legible as a mistake — the #7333
    // brace-convention trap is only findable if the placeholder survives.
    const denial = await denyDelete('zh-CN', bundleFor({
      errors: { permission_denied: '无权限:{{objectLabel}}' },
    }));
    expect(denial.message).toBe('无权限:{{objectLabel}}');
  });

  it('a deployment with NO i18n service still gets the caller locale', async () => {
    const denial = await denyDelete('zh-CN');
    expect(denial.message).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].permission_denied);
  });
});
