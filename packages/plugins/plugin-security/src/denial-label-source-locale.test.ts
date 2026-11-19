// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A security refusal's `userMessage` names the master object (the
 * master-detail write gate) with the rule the metadata route serves the same
 * label by: a request in the
 * deployment's declared `i18n.sourceLocale` reads the label as the author
 * wrote it, never the `defaultLocale` row `t()` falls to.
 *
 * The scenario: an app authored in English (`sourceLocale: 'en'`) that
 * defaults its users to Chinese (`defaultLocale: 'zh-CN'`), declares no
 * `fallbackLocale` (the served adapter's fallback collapses to `zh-CN`) and
 * ships a `zh-CN` bundle only. CONTROLS: a `zh-CN` request still reads the
 * `zh-CN` row; with no `sourceLocale` declared an `en` request walks to it as
 * before.
 *
 * Measured with the real security layer on a real `ObjectQL` over a real
 * `SqlDriver`, through the engine's own writes. The field-write gate's half
 * of the same scenario lives in its harness,
 * `owner-queue-field-write-user-message.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { renderOperationMessage } from '@objectstack/spec/system';
import { SecurityPlugin } from './security-plugin.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

/** The deployment ships `zh-CN` rows only. */
const ZH_CN = {
  objects: {
    lsd_contract: { label: '合同' },
  },
};

/**
 * The served adapter's shape (`FileI18nAdapter`): `t()` reads the requested
 * locale, then the declared fallback, then echoes the key; the getters report
 * the declaration as `os serve` hands it over.
 */
function servedI18n(declared: { defaultLocale: string; sourceLocale?: string }) {
  const bundles: Record<string, Record<string, unknown>> = { 'zh-CN': ZH_CN };
  const fallback = declared.defaultLocale;
  const read = (data: unknown, key: string): string | undefined => {
    let cur: unknown = data;
    for (const part of key.split('.')) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return typeof cur === 'string' ? cur : undefined;
  };
  return {
    t: (key: string, locale: string) =>
      read(bundles[locale], key) ?? (fallback !== locale ? read(bundles[fallback], key) : undefined) ?? key,
    getLocales: () => Object.keys(bundles),
    getTranslations: (locale: string) => bundles[locale] ?? {},
    getDefaultLocale: () => declared.defaultLocale,
    getFallbackLocale: () => fallback,
    getSourceLocale: () => declared.sourceLocale,
  };
}

const SOURCE_EN = { defaultLocale: 'zh-CN', sourceLocale: 'en' };
const NO_SOURCE = { defaultLocale: 'zh-CN' };

const sentence = (messageKey: string, locale: string, params: Record<string, unknown>) =>
  renderOperationMessage({ messageKey, params }, { locale });

describe('master-detail write gate: the master is named in the declared sourceLocale as authored', () => {
  const SYS = { context: { isSystem: true, userId: 'usr_system', tenantId: DEFAULT_ORGANIZATION_ID } } as never;
  const WRITER = 'usr_writer';
  const READABLE_SET: PermissionSet = PermissionSetSchema.parse({
    name: 'lsd_readable',
    label: 'Readable',
    objects: {
      '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      lsd_contract: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
  });
  const OBJECTS = [
    SysUser,
    { name: 'lsd_contract', label: 'Contract', sharingModel: 'public_read_write', fields: { name: { name: 'name', type: 'text' } } },
    {
      name: 'lsd_milestone', label: 'Milestone', sharingModel: 'controlled_by_parent',
      fields: {
        name: { name: 'name', type: 'text' },
        contract: { name: 'contract', type: 'master_detail', reference: 'lsd_contract', required: true },
      },
    },
  ];
  const services: Record<string, unknown> = {};
  let engine: ObjectQL;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.denial-label-source-locale',
      name: 'A refusal names the master in the authored language',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: OBJECTS,
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    Object.assign(services, {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (type: string, name: string) =>
          (type === 'permission' ? (name === READABLE_SET.name ? READABLE_SET : null) : engine.getSchema(name)) ?? null,
        list: async () => [READABLE_SET],
      },
      sharing: { canEdit: async () => true },
      i18n: servedI18n(SOURCE_EN),
    });
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      hook: () => undefined,
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: READABLE_SET.name });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    wireEngineSecuritySource(engine, () => plugin);
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    await engine.insert('sys_user', [{ id: WRITER, name: WRITER, email: `${WRITER}@lsd.test` }], SYS);
    await engine.insert('lsd_contract', [{ id: 'ctr_1', name: 'contract' }], SYS);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const refusal = async (locale: string): Promise<any> => {
    const context = { userId: WRITER, positions: [], permissions: [READABLE_SET.name], posture: 'MEMBER', tenantId: DEFAULT_ORGANIZATION_ID, locale };
    try {
      await engine.insert('lsd_milestone', { name: 'new', contract: 'ctr_1' }, { context } as never);
    } catch (e) {
      return e;
    }
    throw new Error('expected the write to be refused');
  };

  it('en: the master is named by its declared English label', async () => {
    services.i18n = servedI18n(SOURCE_EN);
    const e = await refusal('en');
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(e.statusCode ?? e.status).toBe(403);
    expect(e.userMessage).toBe(sentence('master_record_edit_denied', 'en', { master: 'Contract' }));
    expect(e.userMessage).not.toContain('合同');
  });

  it('CONTROL: zh-CN still reads the zh-CN row', async () => {
    services.i18n = servedI18n(SOURCE_EN);
    expect((await refusal('zh-CN')).userMessage).toBe(sentence('master_record_edit_denied', 'zh-CN', { master: '合同' }));
  });

  it('CONTROL: with no sourceLocale declared, en walks to the zh-CN row as before', async () => {
    services.i18n = servedI18n(NO_SOURCE);
    expect((await refusal('en')).userMessage).toBe(sentence('master_record_edit_denied', 'en', { master: '合同' }));
  });
});
