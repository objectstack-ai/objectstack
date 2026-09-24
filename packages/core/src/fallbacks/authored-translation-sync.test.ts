// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19620 — the stored-row half of retiring `settings` from the `translation`
 * item door (ruling batch #210 item 2 letter B).
 *
 * Narrowing `TranslationItemSchema` refuses NEW items carrying `settings` at
 * the metadata door, but it cannot reach a row already stored: this sync reads
 * `sys_metadata` itself and used to merge the RAW payload into the authored
 * layer, which both i18n adapters read OVER the shipped bundles. So a row
 * written before the door closed kept overriding the platform's own Settings
 * copy on every boot. The sync is a rehydration seam and now replays the
 * ADR-0087 chain over each row before merging it, which is what drops the
 * group — loudly, once per row.
 *
 * `@objectstack/spec` resolves to its BUILT `dist/` here (no alias), and the
 * conversion that does the dropping lives there: rebuild spec before reading
 * a result from this file.
 */

import { describe, expect, it, vi } from 'vitest';

import { readAuthoredTranslationLayer, wireAuthoredTranslationSync } from './authored-translation-sync.js';
import { createMemoryI18n } from './memory-i18n.js';

type AnyRecord = Record<string, any>;

const row = (name: string, payload: AnyRecord) => ({
  type: 'translation',
  name,
  state: 'active',
  metadata: JSON.stringify(payload),
});

const engineOf = (rows: AnyRecord[]) => ({
  find: vi.fn(async (_object: string, q: AnyRecord) => (q?.where?.type === 'translation' ? rows : [])),
});

/** An item stored before the door closed: `settings` beside an app-owned group. */
const storedWithSettings = () => row('zh-CN', {
  locale: 'zh-CN',
  settings: { mail: { title: '应用改写的邮件标题', keys: { host: { label: '应用改写的主机' } } } },
  apps: { crm: { label: '客户关系管理' } },
});

describe('authored-translation sync replays the conversion chain over stored rows (#19620)', () => {
  it('drops a stored item\'s `settings` before the merge and keeps the rest of the item', async () => {
    const warn = vi.fn();
    const layer = await readAuthoredTranslationLayer(engineOf([storedWithSettings()]), { warn });

    expect(layer).not.toBeNull();
    expect(layer!['zh-CN']).not.toHaveProperty('settings');
    // The app-owned group on the same row still loads — the row is converted,
    // not skipped.
    expect(layer!['zh-CN']).toEqual({ apps: { crm: { label: '客户关系管理' } } });
  });

  it('says so, naming the row, the group and the conversion — never a silent strip', async () => {
    const warn = vi.fn();
    await readAuthoredTranslationLayer(engineOf([storedWithSettings()]), { warn });

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("authored translation 'zh-CN'");
    expect(line).toContain("'settings' → '(removed)'");
    expect(line).toContain("'translation-per-app-settings-removed'");
    expect(line).toContain('os migrate meta --stored --apply');
  });

  it('warns once per row per wiring, not on every sync', async () => {
    const warn = vi.fn();
    const warnedConversions = new Set<string>();
    const engine = engineOf([storedWithSettings()]);
    await readAuthoredTranslationLayer(engine, { warn }, { warnedConversions });
    await readAuthoredTranslationLayer(engine, { warn }, { warnedConversions });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('CONTROL — a canonical row converts to itself and warns nothing', async () => {
    const warn = vi.fn();
    const layer = await readAuthoredTranslationLayer(
      engineOf([row('zh-CN', { locale: 'zh-CN', apps: { crm: { label: '客户关系管理' } } })]),
      { warn },
    );

    expect(layer!['zh-CN']).toEqual({ apps: { crm: { label: '客户关系管理' } } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('end to end: the platform\'s own settings copy renders again, not the stored override', async () => {
    // The platform bundle as `SettingsServicePlugin` contributes it — static.
    const i18n = createMemoryI18n();
    i18n.loadTranslations('zh-CN', {
      settings: { mail: { title: '邮件投递', keys: { host: { label: 'SMTP 主机' } } } },
    });

    const hooks = new Map<string, Array<() => Promise<void> | void>>();
    const warn = vi.fn();
    const services: AnyRecord = { i18n, objectql: engineOf([storedWithSettings()]) };
    wireAuthoredTranslationSync({
      logger: { warn, info: vi.fn(), debug: vi.fn() },
      getService: (name: string) => {
        if (name in services) return services[name];
        throw new Error(`service '${name}' not registered`);
      },
      hook: (name, fn) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
    });
    for (const fn of hooks.get('kernel:ready') ?? []) await fn();
    for (const fn of hooks.get('metadata:reloaded') ?? []) await fn();

    // Before the seam replayed the chain, the authored layer (read OVER the
    // static bundle) answered these two with the stored row's strings.
    expect(i18n.t('settings.mail.title', 'zh-CN')).toBe('邮件投递');
    expect(i18n.t('settings.mail.keys.host.label', 'zh-CN')).toBe('SMTP 主机');
    expect(i18n.t('apps.crm.label', 'zh-CN')).toBe('客户关系管理');
    // Two syncs, one warning: the wiring owns its dedupe set.
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
