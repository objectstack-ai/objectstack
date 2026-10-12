// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { PlatformObjectsPlugin } from './plugin.js';
import { SetupAppTranslations } from './apps/translations/index.js';

/**
 * A host's translation bundle for a platform key wins over this package's
 * bundle in either boot order — the precedence `content/docs/ui/translations.mdx`
 * publishes ("yours would override the platform's"). Pinned on a REAL
 * `II18nService` (the kernel's in-memory provider, the one every kernel without
 * `I18nServicePlugin` serves), because the defect lived in how two loads
 * compose inside that service, which a recording double cannot show.
 */

const LABEL = 'objects.sys_organization.label';
const PLURAL = 'objects.sys_organization.pluralLabel';
const SLUG_LABEL = 'objects.sys_organization.fields.slug.label';
const SLUG_HELP = 'objects.sys_organization.fields.slug.help';
const HOST_ONLY = 'objects.sys_organization.fields.host_only.label';

/** A host's zh-CN bundle: one top-level label, one nested field label, one key of its own. */
const HOST_ZH = {
  objects: {
    sys_organization: {
      label: '工作区',
      fields: { slug: { label: '工作区标识' }, host_only: { label: '仅宿主' } },
    },
  },
};

const platform = (locale: string): any => (SetupAppTranslations as any)[locale].objects.sys_organization;

/** Fake PluginContext whose hooks run in registration order, as both kernels run them. */
function makeCtx() {
  const services = new Map<string, any>();
  const byEvent: Record<string, Array<() => Promise<void> | void>> = {};
  const warns: string[] = [];
  const ctx: any = {
    logger: { info: () => {}, warn: (m: string) => { warns.push(String(m)); } },
    _warns: warns,
    registerService: (name: string, svc: any) => { services.set(name, svc); },
    getService: (name: string) => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s;
    },
    hook: (event: string, fn: () => Promise<void> | void) => { (byEvent[event] ??= []).push(fn); },
    _flush: async (event: string) => { for (const h of byEvent[event] ?? []) await h(); },
  };
  return ctx;
}

async function boot(ctx: any, plugin = new PlatformObjectsPlugin()) {
  await plugin.init(ctx);
  await plugin.start(ctx);
  await ctx._flush('kernel:ready');
}

describe('PlatformObjectsPlugin: a host translation bundle wins over the platform bundle', () => {
  it('precondition: the host label differs from the platform label, so a pass cannot be vacuous', () => {
    expect(platform('zh-CN').label).not.toBe('工作区');
    expect(platform('zh-CN').fields.slug.label).not.toBe('工作区标识');
  });

  it('a host bundle loaded BEFORE the platform bundles serves the host label', async () => {
    const ctx = makeCtx();
    const i18n = createMemoryI18n();
    ctx.registerService('i18n', i18n);
    i18n.loadTranslations('zh-CN', HOST_ZH); // a host plugin's init-time bundle

    await boot(ctx);

    expect(i18n.t(LABEL, 'zh-CN')).toBe('工作区');
    expect(i18n.t(SLUG_LABEL, 'zh-CN')).toBe('工作区标识');
  });

  it('a host bundle loaded AFTER kernel:ready also serves the host label', async () => {
    const ctx = makeCtx();
    const i18n = createMemoryI18n();
    ctx.registerService('i18n', i18n);
    const plugin = new PlatformObjectsPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    ctx.hook('kernel:ready', () => i18n.loadTranslations('zh-CN', HOST_ZH)); // registered after the plugin's

    await ctx._flush('kernel:ready');

    expect(i18n.t(LABEL, 'zh-CN')).toBe('工作区');
    expect(i18n.t(SLUG_LABEL, 'zh-CN')).toBe('工作区标识');
  });

  it('CONTROL: a key the host does not ship serves the platform text, and a host-only key survives', async () => {
    const ctx = makeCtx();
    const i18n = createMemoryI18n();
    ctx.registerService('i18n', i18n);
    i18n.loadTranslations('zh-CN', HOST_ZH);

    await boot(ctx);

    expect(i18n.t(PLURAL, 'zh-CN')).toBe(platform('zh-CN').pluralLabel);
    expect(i18n.t(SLUG_HELP, 'zh-CN')).toBe(platform('zh-CN').fields.slug.help);
    expect(i18n.t(HOST_ONLY, 'zh-CN')).toBe('仅宿主');
  });

  it('CONTROL: a locale the host does not ship serves the platform text unchanged', async () => {
    const ctx = makeCtx();
    const i18n = createMemoryI18n();
    ctx.registerService('i18n', i18n);
    i18n.loadTranslations('zh-CN', HOST_ZH);

    await boot(ctx);

    expect(i18n.t(LABEL, 'ja-JP')).toBe(platform('ja-JP').label);
    expect(i18n.t(SLUG_LABEL, 'ja-JP')).toBe(platform('ja-JP').fields.slug.label);
    expect(i18n.t(LABEL, 'en')).toBe(platform('en').label);
  });

  it('an authored overlay synced at kernel:ready is never written into the bundle layer', async () => {
    // `AppPlugin` wires the authored-translation sync in init(), so its
    // kernel:ready hook is registered ahead of anything registered in start().
    const ctx = makeCtx();
    const i18n = createMemoryI18n();
    ctx.registerService('i18n', i18n);
    ctx.hook('kernel:ready', () => {
      i18n.replaceAuthoredTranslations({
        'zh-CN': { objects: { sys_organization: { pluralLabel: '已编写' } } },
      });
    });

    await boot(ctx);
    expect(i18n.t(PLURAL, 'zh-CN')).toBe('已编写');

    i18n.replaceAuthoredTranslations({}); // the Studio override is deleted
    expect(i18n.t(PLURAL, 'zh-CN')).toBe(platform('zh-CN').pluralLabel);
  });

  it('an i18n service that appears only after start() gets the bundles on kernel:ready, host still winning', async () => {
    const ctx = makeCtx();
    const plugin = new PlatformObjectsPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx); // no i18n service yet: nothing to load into

    // A later plugin's start() (an AppPlugin on a lean kernel) registers one and loads its bundle.
    const i18n = createMemoryI18n();
    ctx.registerService('i18n', i18n);
    i18n.loadTranslations('zh-CN', HOST_ZH);

    await ctx._flush('kernel:ready');

    expect(i18n.t(LABEL, 'zh-CN')).toBe('工作区');
    expect(i18n.t(PLURAL, 'zh-CN')).toBe(platform('zh-CN').pluralLabel);
  });

  it('loads each bundle once per service: the kernel:ready backstop adds nothing after start()', async () => {
    const ctx = makeCtx();
    const real = createMemoryI18n();
    const loads: string[] = [];
    ctx.registerService('i18n', {
      ...real,
      loadTranslations: (locale: string, data: Record<string, unknown>) => {
        loads.push(locale);
        real.loadTranslations(locale, data);
      },
    });

    await boot(ctx);

    // Two bundles (Setup, MetadataForms) times the four locales each ships.
    expect(loads.sort()).toEqual(['en', 'en', 'es-ES', 'es-ES', 'ja-JP', 'ja-JP', 'zh-CN', 'zh-CN']);
  });

  it('fail-safe: a provider with no getTranslations still gets the platform bundles, and says so', async () => {
    const ctx = makeCtx();
    const withoutRead: any = { ...createMemoryI18n() };
    delete withoutRead.getTranslations;
    ctx.registerService('i18n', withoutRead);

    await boot(ctx);

    expect(withoutRead.t(LABEL, 'zh-CN')).toBe(platform('zh-CN').label);
    expect(ctx._warns.filter((w: string) => w.includes('getTranslations'))).toHaveLength(1);
  });
});
