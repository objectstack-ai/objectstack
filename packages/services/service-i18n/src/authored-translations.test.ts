// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime-authored translation sync (#2591).
 *
 * Translations authored in the Studio persist as `translation` sys_metadata
 * rows, but only static bundles (app `bundle.translations`, plugin
 * `translations/`) were ever loaded into the i18n runtime — a published
 * translation was a dead-end on publish AND after restart. The
 * I18nServicePlugin now syncs the authored layer from the rows at
 * `kernel:ready`, on `metadata:reloaded`, and on protocol `translation`
 * mutations; the FileI18nAdapter keeps that layer separate so a re-sync is
 * clear-then-reload (deleted keys stop resolving) while authored values win
 * over static bundle values on read.
 */

import { describe, it, expect, vi } from 'vitest';
import { FileI18nAdapter } from './file-i18n-adapter.js';
import { I18nServicePlugin } from './i18n-service-plugin.js';

type AnyRecord = Record<string, any>;

// ── Adapter layer ──────────────────────────────────────────────────────────

describe('FileI18nAdapter.replaceAuthoredTranslations (#2591)', () => {
  it('overlays authored values over the static bundle on t() and getTranslations()', () => {
    const i18n = new FileI18nAdapter({ defaultLocale: 'en' });
    i18n.loadTranslations('en', { messages: { save: 'Save', cancel: 'Cancel' } });

    i18n.replaceAuthoredTranslations({ en: { messages: { save: 'Save changes' } } });

    expect(i18n.t('messages.save', 'en')).toBe('Save changes'); // authored wins
    expect(i18n.t('messages.cancel', 'en')).toBe('Cancel'); // static still visible
    const merged: any = i18n.getTranslations('en');
    expect(merged.messages.save).toBe('Save changes');
    expect(merged.messages.cancel).toBe('Cancel');
  });

  it('clear-then-reload: keys removed from the authored layer stop resolving', () => {
    const i18n = new FileI18nAdapter({ defaultLocale: 'en' });
    i18n.replaceAuthoredTranslations({ en: { messages: { greeting: 'Hello' } } });
    expect(i18n.t('messages.greeting', 'en')).toBe('Hello');

    i18n.replaceAuthoredTranslations({ en: { messages: { farewell: 'Bye' } } });

    expect(i18n.t('messages.greeting', 'en')).toBe('messages.greeting'); // gone, not lingering
    expect(i18n.t('messages.farewell', 'en')).toBe('Bye');
  });

  it('does not disturb the static layer when the authored layer empties', () => {
    const i18n = new FileI18nAdapter({ defaultLocale: 'en' });
    i18n.loadTranslations('en', { messages: { save: 'Save' } });
    i18n.replaceAuthoredTranslations({ en: { messages: { save: 'Authored' } } });
    expect(i18n.t('messages.save', 'en')).toBe('Authored');

    i18n.replaceAuthoredTranslations({});

    expect(i18n.t('messages.save', 'en')).toBe('Save');
  });

  it('surfaces authored-only locales in getLocales()', () => {
    const i18n = new FileI18nAdapter({ defaultLocale: 'en' });
    i18n.loadTranslations('en', { messages: {} });
    i18n.replaceAuthoredTranslations({ 'zh-CN': { messages: { save: '保存' } } });

    expect(i18n.getLocales().sort()).toEqual(['en', 'zh-CN']);
    expect(i18n.t('messages.save', 'zh-CN')).toBe('保存');
  });

  it('invalidates the merged cache when a static bundle loads after a read', () => {
    const i18n = new FileI18nAdapter({ defaultLocale: 'en' });
    i18n.replaceAuthoredTranslations({ en: { messages: { a: 'A' } } });
    expect((i18n.getTranslations('en') as any).messages.a).toBe('A'); // primes cache

    i18n.loadTranslations('en', { messages: { b: 'B' } });

    const merged: any = i18n.getTranslations('en');
    expect(merged.messages).toEqual({ a: 'A', b: 'B' });
  });
});

// ── Plugin sync layer ──────────────────────────────────────────────────────

function makeCtx(services: AnyRecord = {}) {
  const hooks = new Map<string, Array<() => Promise<void>>>();
  return {
    ctx: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn((name: string, svc: any) => { services[name] = svc; }),
      getService: vi.fn((name: string) => {
        if (name in services) return services[name];
        throw new Error(`service '${name}' not registered`);
      }),
      hook: vi.fn((name: string, fn: () => Promise<void>) => {
        const list = hooks.get(name) ?? [];
        list.push(fn);
        hooks.set(name, list);
      }),
    } as AnyRecord,
    services,
    fire: async (name: string) => {
      for (const fn of hooks.get(name) ?? []) await fn();
    },
  };
}

const translationRow = (name: string, payload: AnyRecord, extra: AnyRecord = {}) => ({
  type: 'translation',
  name,
  state: 'active',
  metadata: JSON.stringify(payload),
  ...extra,
});

async function bootPlugin(services: AnyRecord) {
  const plugin = new I18nServicePlugin({ registerRoutes: false });
  const harness = makeCtx(services);
  await plugin.init(harness.ctx as any);
  await plugin.start(harness.ctx as any);
  const i18n = services['i18n'] as FileI18nAdapter;
  return { plugin, harness, i18n };
}

describe('I18nServicePlugin authored-translation sync (#2591)', () => {
  it('loads active translation rows at kernel:ready, resolving locale from the item name', async () => {
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) =>
        q?.where?.type === 'translation'
          ? [translationRow('zh-CN', { messages: { save: '保存' } })]
          : []),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine });

    await harness.fire('kernel:ready');

    expect(i18n.t('messages.save', 'zh-CN')).toBe('保存');
  });

  it('prefers _meta.locale, then a top-level locale field, over the item name', async () => {
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) =>
        q?.where?.type === 'translation'
          ? [
              translationRow('branding_strings', { _meta: { locale: 'fr' }, messages: { save: 'Enregistrer' } }),
              translationRow('other_strings', { locale: 'de', messages: { save: 'Speichern' } }),
            ]
          : []),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine });

    await harness.fire('kernel:ready');

    expect(i18n.t('messages.save', 'fr')).toBe('Enregistrer');
    expect(i18n.t('messages.save', 'de')).toBe('Speichern');
  });

  it('skips items with no resolvable locale (warns) without dropping the rest', async () => {
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) =>
        q?.where?.type === 'translation'
          ? [
              translationRow('no_locale_here_at_all', { messages: { x: 'X' } }),
              translationRow('en', { messages: { ok: 'OK' } }),
            ]
          : []),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine });

    await harness.fire('kernel:ready');

    expect(i18n.t('messages.ok', 'en')).toBe('OK');
    expect(harness.ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no resolvable locale'),
    );
  });

  it('deep-merges multiple items on the same locale in name order', async () => {
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) =>
        q?.where?.type === 'translation'
          ? [
              translationRow('en', { messages: { a: 'A', shared: 'first' } }),
              translationRow('en_extras', { locale: 'en', messages: { b: 'B', shared: 'second' } }),
            ]
          : []),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine });

    await harness.fire('kernel:ready');

    expect(i18n.t('messages.a', 'en')).toBe('A');
    expect(i18n.t('messages.b', 'en')).toBe('B');
    expect(i18n.t('messages.shared', 'en')).toBe('second'); // later name wins
  });

  it('re-syncs on metadata:reloaded with clear-then-reload semantics', async () => {
    let rows = [translationRow('en', { messages: { greeting: 'Hello' } })];
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) =>
        q?.where?.type === 'translation' ? rows : []),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine });
    await harness.fire('kernel:ready');
    expect(i18n.t('messages.greeting', 'en')).toBe('Hello');

    rows = [translationRow('en', { messages: { farewell: 'Bye' } })]; // greeting deleted
    await harness.fire('metadata:reloaded');

    expect(i18n.t('messages.greeting', 'en')).toBe('messages.greeting');
    expect(i18n.t('messages.farewell', 'en')).toBe('Bye');
  });

  it('re-syncs on protocol translation mutations (skips drafts and other types)', async () => {
    const listeners: Array<(evt: AnyRecord) => void> = [];
    const protocol = {
      onMetadataMutation: vi.fn((fn: (evt: AnyRecord) => void) => { listeners.push(fn); return () => {}; }),
    };
    let rows: AnyRecord[] = [];
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) =>
        q?.where?.type === 'translation' ? rows : []),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine, protocol });
    await harness.fire('kernel:ready');
    expect(protocol.onMetadataMutation).toHaveBeenCalledTimes(1);

    rows = [translationRow('en', { messages: { live: 'Live!' } })];
    listeners[0]({ type: 'translation', name: 'en', state: 'active' });
    await new Promise((r) => setTimeout(r, 0)); // sync is fire-and-forget

    expect(i18n.t('messages.live', 'en')).toBe('Live!');

    // Draft saves and unrelated types do not churn the layer.
    const callsBefore = engine.find.mock.calls.length;
    listeners[0]({ type: 'translation', name: 'en', state: 'draft' });
    listeners[0]({ type: 'view', name: 'v', state: 'active' });
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.find.mock.calls.length).toBe(callsBefore);
  });

  it('keeps the current authored layer when the row read fails', async () => {
    let fail = false;
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) => {
        if (fail) throw new Error('db gone');
        return q?.where?.type === 'translation'
          ? [translationRow('en', { messages: { keep: 'Kept' } })]
          : [];
      }),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine });
    await harness.fire('kernel:ready');
    expect(i18n.t('messages.keep', 'en')).toBe('Kept');

    fail = true;
    await harness.fire('metadata:reloaded');

    expect(i18n.t('messages.keep', 'en')).toBe('Kept'); // failed read never tears down
  });

  it('falls back to legacy plural rows when no singular rows exist', async () => {
    const engine = {
      find: vi.fn(async (_obj: string, q: AnyRecord) => {
        if (q?.where?.type === 'translations') {
          return [translationRow('en', { messages: { legacy: 'Old' } }, { type: 'translations' })];
        }
        return [];
      }),
    };
    const { harness, i18n } = await bootPlugin({ objectql: engine });

    await harness.fire('kernel:ready');

    expect(i18n.t('messages.legacy', 'en')).toBe('Old');
  });
});
