// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
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
 *
 * [#26167] What the write locale localizes is the @mention notification title:
 * `sys_activity.summary` is stored in English and served in each READER's
 * locale, so it is the title these cases read. The plugin wires the real
 * recipient gate, which this fake engine cannot answer, so the writers are
 * handed a messaging double and an admitting gate — every other option is the
 * plugin's own.
 */
const mentionTitles = vi.hoisted(() => [] as string[]);
vi.mock('./audit-writers.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./audit-writers.js')>();
  return {
    ...mod,
    installAuditWriters: (engine: any, packageId: string, opts: any) =>
      mod.installAuditWriters(engine, packageId, {
        ...opts,
        getMessaging: () => ({
          emit: async (e: any) => {
            if (e.topic === 'collab.mention') mentionTitles.push(String(e.payload?.title));
            return {};
          },
        }),
        admitMentionRecipients: async ({ mentions }: { mentions: string[] }) => [...mentions],
      }),
  };
});

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
  mentionTitles.length = 0;
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
  // An @mention of `recipient` in an organization, by `Alice` — the write whose title the locale picks.
  const mention = (tenant = 'org-1', recipient = 'user-2', id = 'c-1') =>
    fire('afterInsert', {
      object: 'sys_comment',
      input: {},
      result: {
        id,
        thread_id: 'person_qualification:q-1',
        author_id: 'user-1',
        author_name: 'Alice',
        body: 'hello',
        mentions: JSON.stringify([recipient]),
      },
      session: { organizationId: tenant, userId: 'user-1' },
    });
  const titles = () => [...mentionTitles];
  const summaries = () => created.filter((c) => c.object === 'sys_activity').map((c) => c.row.summary);
  const localeWarns = () => warns.filter((w) => w.msg.includes('getLocale'));
  return { insert, mention, titles, summaries, created, localeWarns };
}

const ZH = 'Alice 提到了你';
const JA = 'Aliceさんがあなたをメンションしました';
const EN = 'Alice mentioned you';

describe('AuditPlugin — host locale resolver (AuditPluginOptions.getLocale)', () => {
  it('pin: an @mention title is written in the resolver\'s locale; the activity summary asks it nothing', async () => {
    const calls: Array<[string | undefined, string | undefined]> = [];
    const { insert, mention, titles, summaries, localeWarns } = await boot({
      getLocale: async (tenantId, userId) => {
        calls.push([tenantId, userId]);
        return 'zh-CN';
      },
    });
    // [#26167] The summary is stored in English, whatever the resolver says…
    await insert();
    expect(summaries()).toEqual(['Created Qualification "OC-00001"']);
    expect(calls).toEqual([]);
    // …and the title is the resolver's language.
    await mention();
    expect(titles()).toEqual([ZH]);
    // Asked with the write's organization and the mentioned recipient, ahead of the settings read.
    expect(calls).toEqual([['org-1', 'user-2']]);
    expect(localeWarns()).toEqual([]);
  });

  it('a synchronous answer counts, and is used in its canonical form', async () => {
    const { mention, titles } = await boot({ getLocale: () => ' zh-cn ' });
    await mention();
    expect(titles()).toEqual([ZH]);
  });

  it('fallback: a resolver answering undefined gives today\'s settings-derived locale', async () => {
    const { mention, titles, localeWarns } = await boot({ getLocale: async () => undefined });
    await mention();
    expect(titles()).toEqual([JA]);
    expect(localeWarns()).toEqual([]);
  });

  it('fallback: null and a blank string are "no answer" too, silently', async () => {
    const asNull = await boot({ getLocale: (async () => null) as unknown as AuditPluginOptions['getLocale'] });
    await asNull.mention();
    expect(asNull.titles()).toEqual([JA]);
    expect(asNull.localeWarns()).toEqual([]);

    const blank = await boot({ getLocale: () => '   ' });
    await blank.mention();
    expect(blank.titles()).toEqual([JA]);
    expect(blank.localeWarns()).toEqual([]);
  });

  it('absent: with no option the title is the settings-derived one (the existing-behaviour control)', async () => {
    const withSettings = await boot();
    await withSettings.mention();
    expect(withSettings.titles()).toEqual([JA]);

    // An options bag without the member is the same as no bag at all.
    const emptyBag = await boot({});
    await emptyBag.mention();
    expect(emptyBag.titles()).toEqual([JA]);

    // And no settings service either: the built-in en-US default — English.
    const bare = await boot(undefined, {});
    await bare.mention();
    expect(bare.titles()).toEqual([EN]);
  });

  it('throw: falls through to the settings-derived locale, logged once at warn with the error, and the write lands', async () => {
    let calls = 0;
    const { mention, titles, localeWarns } = await boot({
      getLocale: () => {
        calls += 1;
        throw new Error('locale store unreachable');
      },
    });
    await mention('org-1', 'user-2', 'c-1');
    // A second scope asks again (the writer memoizes per tenant/user) and throws again.
    await mention('org-2', 'user-3', 'c-2');
    expect(calls).toBe(2);
    // The notification is not failed by the host's fault: both titles landed.
    expect(titles()).toEqual([JA, JA]);
    const warned = localeWarns();
    expect(warned).toHaveLength(1);
    expect(warned[0].msg).toMatch(/host getLocale resolver threw/);
    expect(warned[0].meta).toEqual({ err: 'locale store unreachable' });
  });

  it('throw: a rejected promise falls through the same way', async () => {
    const { mention, titles, localeWarns } = await boot({
      getLocale: () => Promise.reject(new Error('timeout')),
    });
    await mention();
    expect(titles()).toEqual([JA]);
    expect(localeWarns()).toHaveLength(1);
    expect(localeWarns()[0].meta).toEqual({ err: 'timeout' });
  });

  it('an answer that is not a well-formed BCP-47 tag falls back, logged once at warn', async () => {
    const { mention, titles, localeWarns } = await boot({ getLocale: () => 'zh_CN' });
    await mention('org-1', 'user-2', 'c-1');
    await mention('org-2', 'user-3', 'c-2');
    expect(titles()).toEqual([JA, JA]);
    const warned = localeWarns();
    expect(warned).toHaveLength(1);
    expect(warned[0].msg).toContain('"zh_CN"');
    expect(warned[0].msg).toMatch(/not a well-formed BCP-47 locale tag/);
  });
});
