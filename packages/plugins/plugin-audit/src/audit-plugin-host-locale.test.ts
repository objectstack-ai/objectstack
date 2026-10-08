// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// STATIC on purpose, like audit-writers.test.ts: the plugin's own kernel:ready
// hook imports the translation bundle lazily, and a static import here moves
// that cold-start cost to collection, which no test's timeout is charged for.
import { createMemoryI18n } from '@objectstack/core';
import { AuditTranslations } from './translations/index.js';
import { AuditPlugin, type AuditPluginOptions } from './audit-plugin.js';

/**
 * `AuditPluginOptions.getLocale` — the host locale resolver, driven through the
 * PLUGIN (init → start → kernel:ready), not through `installAuditWriters`
 * directly: the option is only worth anything if the plugin really hands it to
 * the writers ahead of the settings-derived locale it builds itself.
 *
 * The settings service answers `ja-JP` throughout, so every outcome is
 * distinguishable: the host's locale (zh-CN), the settings fallback (ja-JP),
 * and the English literal a locale-less write degrades to.
 */

interface CapturedRow {
  object: string;
  row: Record<string, any>;
}

/** A fake ObjectQL engine: records hooks (honouring `object` / `excludeObjects`) and created rows. */
function makeEngine() {
  const hooks = new Map<string, Array<{ fn: (ctx: any) => any; opts: any }>>();
  const created: CapturedRow[] = [];
  const api = {
    sudo: () => ({
      object(name: string) {
        return {
          async create(row: Record<string, any>) {
            created.push({ object: name, row });
            return { id: `${name}-${created.length}`, ...row };
          },
        };
      },
    }),
  };
  const schemas: Record<string, Record<string, any>> = {
    sys_audit_log: { name: 'sys_audit_log', fields: {} },
    sys_activity: { name: 'sys_activity', fields: {} },
    person_qualification: {
      name: 'person_qualification',
      label: 'Qualification',
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    },
  };
  for (const f of ['id', 'action', 'user_id', 'actor', 'object_name', 'record_id', 'old_value', 'new_value', 'tenant_id']) {
    schemas.sys_audit_log.fields[f] = { type: 'text' };
  }
  for (const f of ['id', 'type', 'timestamp', 'summary', 'actor_id', 'object_name', 'record_id', 'record_label', 'metadata']) {
    schemas.sys_activity.fields[f] = { type: 'text' };
  }
  const engine = {
    getSchema(name: string) {
      return schemas[name];
    },
    registerHook(event: string, fn: (ctx: any) => any, opts?: any) {
      const list = hooks.get(event) ?? [];
      list.push({ fn, opts: opts ?? {} });
      hooks.set(event, list);
    },
    unregisterHooksByPackage() {
      /* no-op */
    },
  };
  async function fire(event: string, ctx: any) {
    for (const { fn, opts } of hooks.get(event) ?? []) {
      if (opts.object && opts.object !== ctx.object) continue;
      if (Array.isArray(opts.excludeObjects) && opts.excludeObjects.includes(ctx.object)) continue;
      await fn({ ...ctx, event, api });
    }
  }
  return { engine, fire, created };
}

/** A settings occupant whose `localization.locale` is `ja-JP` (the fallback every case can see). */
function makeSettings(locale = 'ja-JP') {
  const values: Record<string, unknown> = { locale };
  return {
    // `resolveLocalizationContext` takes the settings path only when `get` exists, then prefers `getMany`.
    async get(_ns: string, key: string) {
      return values[key] === undefined ? undefined : { value: values[key] };
    },
    async getMany(_ns: string, keys: string[]) {
      return Object.fromEntries(keys.map((k) => [k, values[k] === undefined ? undefined : { value: values[k] }]));
    },
  };
}

async function boot(options?: AuditPluginOptions, services: { settings?: unknown } = { settings: makeSettings() }) {
  const { engine, fire, created } = makeEngine();
  const i18n = createMemoryI18n();
  for (const [locale, data] of Object.entries(AuditTranslations)) {
    i18n.loadTranslations(locale, data as Record<string, unknown>);
  }
  const registry = new Map<string, unknown>([
    ['objectql', engine],
    ['manifest', { register() {} }],
    ['i18n', i18n],
  ]);
  if (services.settings !== undefined) registry.set('settings', services.settings);
  const readyHooks: Array<() => Promise<void> | void> = [];
  const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const logger = {
    info() {},
    warn(msg: string, meta?: Record<string, unknown>) {
      warns.push({ msg: String(msg), meta });
    },
    error() {},
    debug() {},
    child() {
      return logger;
    },
  };
  const ctx = {
    logger,
    getService(name: string) {
      return registry.get(name);
    },
    registerService(name: string, svc: unknown) {
      registry.set(name, svc);
    },
    hook(event: string, fn: () => Promise<void> | void) {
      if (event === 'kernel:ready') readyHooks.push(fn);
    },
  } as any;
  const plugin = options === undefined ? new AuditPlugin() : new AuditPlugin(options);
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const fn of readyHooks) await fn();

  const insert = (tenant = 'org-1', user = 'user-1', name = 'OC-00001') =>
    fire('afterInsert', {
      object: 'person_qualification',
      input: { id: `q-${name}` },
      result: { id: `q-${name}`, name },
      session: { organizationId: tenant, userId: user },
    });
  const summaries = () => created.filter((c) => c.object === 'sys_activity').map((c) => c.row.summary);
  const localeWarns = () => warns.filter((w) => w.msg.includes('getLocale'));
  return { insert, summaries, created, localeWarns };
}

const ZH = '创建了 Qualification "OC-00001"';
const JA = 'Qualification「OC-00001」を作成しました';
const EN = 'Created Qualification "OC-00001"';

describe('AuditPlugin — host locale resolver (AuditPluginOptions.getLocale)', () => {
  it('pin: a create on a tracked object writes sys_activity.summary in the resolver\'s locale', async () => {
    const calls: Array<[string | undefined, string | undefined]> = [];
    const { insert, summaries, localeWarns } = await boot({
      getLocale: async (tenantId, userId) => {
        calls.push([tenantId, userId]);
        return 'zh-CN';
      },
    });
    await insert();
    expect(summaries()).toEqual([ZH]);
    // Asked with the write's organization and user, ahead of the settings read.
    expect(calls).toEqual([['org-1', 'user-1']]);
    expect(localeWarns()).toEqual([]);
  });

  it('a synchronous answer counts, and is used in its canonical form', async () => {
    const { insert, summaries } = await boot({ getLocale: () => ' zh-cn ' });
    await insert();
    expect(summaries()).toEqual([ZH]);
  });

  it('fallback: a resolver answering undefined gives today\'s settings-derived locale', async () => {
    const { insert, summaries, localeWarns } = await boot({ getLocale: async () => undefined });
    await insert();
    expect(summaries()).toEqual([JA]);
    expect(localeWarns()).toEqual([]);
  });

  it('fallback: null and a blank string are "no answer" too, silently', async () => {
    const asNull = await boot({ getLocale: (async () => null) as unknown as AuditPluginOptions['getLocale'] });
    await asNull.insert();
    expect(asNull.summaries()).toEqual([JA]);
    expect(asNull.localeWarns()).toEqual([]);

    const blank = await boot({ getLocale: () => '   ' });
    await blank.insert();
    expect(blank.summaries()).toEqual([JA]);
    expect(blank.localeWarns()).toEqual([]);
  });

  it('absent: with no option the summary is the settings-derived one (the existing-behaviour control)', async () => {
    const withSettings = await boot();
    await withSettings.insert();
    expect(withSettings.summaries()).toEqual([JA]);

    // An options bag without the member is the same as no bag at all.
    const emptyBag = await boot({});
    await emptyBag.insert();
    expect(emptyBag.summaries()).toEqual([JA]);

    // And no settings service either: the built-in en-US default — English.
    const bare = await boot(undefined, {});
    await bare.insert();
    expect(bare.summaries()).toEqual([EN]);
  });

  it('throw: falls through to the settings-derived locale, logged once at warn with the error, and the write lands', async () => {
    let calls = 0;
    const { insert, summaries, created, localeWarns } = await boot({
      getLocale: () => {
        calls += 1;
        throw new Error('locale store unreachable');
      },
    });
    await insert('org-1', 'user-1', 'OC-00001');
    // A second scope asks again (the writer memoizes per tenant/user) and throws again.
    await insert('org-2', 'user-2', 'OC-00002');
    expect(calls).toBe(2);
    expect(summaries()).toEqual([JA, 'Qualification「OC-00002」を作成しました']);
    // The audited write is not failed by the host's fault: both ledger rows landed.
    expect(created.filter((c) => c.object === 'sys_audit_log')).toHaveLength(2);
    const warned = localeWarns();
    expect(warned).toHaveLength(1);
    expect(warned[0].msg).toMatch(/host getLocale resolver threw/);
    expect(warned[0].meta).toEqual({ err: 'locale store unreachable' });
  });

  it('throw: a rejected promise falls through the same way', async () => {
    const { insert, summaries, localeWarns } = await boot({
      getLocale: () => Promise.reject(new Error('timeout')),
    });
    await insert();
    expect(summaries()).toEqual([JA]);
    expect(localeWarns()).toHaveLength(1);
    expect(localeWarns()[0].meta).toEqual({ err: 'timeout' });
  });

  it('an answer that is not a well-formed BCP-47 tag falls back, logged once at warn', async () => {
    const { insert, summaries, localeWarns } = await boot({ getLocale: () => 'zh_CN' });
    await insert('org-1', 'user-1', 'OC-00001');
    await insert('org-2', 'user-2', 'OC-00002');
    expect(summaries()).toEqual([JA, 'Qualification「OC-00002」を作成しました']);
    const warned = localeWarns();
    expect(warned).toHaveLength(1);
    expect(warned[0].msg).toContain('"zh_CN"');
    expect(warned[0].msg).toMatch(/not a well-formed BCP-47 locale tag/);
  });
});
