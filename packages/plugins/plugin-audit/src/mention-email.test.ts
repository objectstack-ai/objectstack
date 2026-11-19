// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
// STATIC on purpose, like audit-plugin-host-locale.test.ts: the plugin's
// kernel:ready hook imports the translation bundle lazily, and a static import
// here moves that cold-start cost to collection.
import { AuditTranslations } from './translations/index.js';
import { AuditPlugin } from './audit-plugin.js';
import {
  MENTION_EMAIL_LINK_LINES,
  MENTION_EMAIL_TEMPLATES,
  MENTION_EMAIL_WINDOW_MS,
  mentionEmailDedupKey,
} from './mention-email.js';

/**
 * The mention e-mail's declarations (`mention-email.ts`), and the plugin's
 * wiring of them: `AuditPlugin` registers the templates with the messaging
 * service at kernel:ready and hands the writers the auth service's Console
 * page composer. The end-to-end delivery is pinned in
 * `mention-email.integration.test.ts`.
 */

const captured = vi.hoisted(() => ({ opts: undefined as any }));

vi.mock('./audit-writers.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./audit-writers.js')>();
  return {
    ...mod,
    installAuditWriters: (engine: any, packageId: string, opts: any) => {
      captured.opts = opts;
      return mod.installAuditWriters(engine, packageId, opts);
    },
  };
});

describe('the mention e-mail templates', () => {
  it('declare one plain-text e-mail per locale the plugin-audit message catalog carries', () => {
    expect(MENTION_EMAIL_TEMPLATES.map((t) => t.locale).sort()).toEqual(Object.keys(AuditTranslations).sort());
    for (const t of MENTION_EMAIL_TEMPLATES) {
      expect(t).toMatchObject({ topic: 'collab.mention', channel: 'email', subject: '{{title}}', format: 'text' });
      // The comment preview, then the one line that opens the record.
      expect([...t.body!.matchAll(/\{\{\s*([\w.$]+)\s*\}\}/g)].map((m) => m[1])).toEqual(['body', 'mentionUrl']);
      expect(t.body).toBe(`{{body}}\n\n${MENTION_EMAIL_LINK_LINES[t.locale as keyof typeof MENTION_EMAIL_LINK_LINES]}`);
    }
  });
});

describe('the burst window', () => {
  it('is 10 minutes, keyed per organization and person, and clock-aligned', () => {
    expect(MENTION_EMAIL_WINDOW_MS).toBe(600_000);
    const start = 1_000 * MENTION_EMAIL_WINDOW_MS;
    const key = mentionEmailDedupKey('org_1', 'u_1', start);
    expect(mentionEmailDedupKey('org_1', 'u_1', start + MENTION_EMAIL_WINDOW_MS - 1)).toBe(key);
    expect(mentionEmailDedupKey('org_1', 'u_1', start + MENTION_EMAIL_WINDOW_MS)).not.toBe(key);
    expect(mentionEmailDedupKey('org_1', 'u_2', start)).not.toBe(key);
    expect(mentionEmailDedupKey('org_2', 'u_1', start)).not.toBe(key);
    // Never the inbox notice's per-comment key family.
    expect(key.startsWith('collab.mention:')).toBe(false);
  });
});

describe('AuditPlugin wires the mention e-mail', () => {
  async function boot(services: Record<string, unknown>) {
    const engine = {
      getSchema: () => undefined,
      registerHook() {},
      unregisterHooksByPackage() {},
    };
    const registry = new Map<string, unknown>([['objectql', engine], ['manifest', { register() {} }], ...Object.entries(services)]);
    const readyHooks: Array<() => Promise<void> | void> = [];
    const warns: string[] = [];
    const logger: any = { info() {}, error() {}, debug() {}, warn: (m: string) => warns.push(String(m)) };
    logger.child = () => logger;
    const ctx: any = {
      logger,
      getService: (name: string) => {
        if (!registry.has(name)) throw new Error(`[Kernel] Service '${name}' not found`);
        return registry.get(name);
      },
      registerService: (name: string, svc: unknown) => registry.set(name, svc),
      hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') readyHooks.push(fn); },
    };
    captured.opts = undefined;
    const plugin = new AuditPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const fn of readyHooks) await fn();
    return { opts: captured.opts, warns };
  }

  it('registers the templates with the messaging service and links through the auth service', async () => {
    const registered: unknown[] = [];
    const { opts } = await boot({
      messaging: { emit: async () => ({}), registerBuiltinTemplates: (t: readonly unknown[]) => registered.push(t) },
      auth: { getConsoleUrl: (path: string) => `https://app.example.test/_console${path}` },
    });
    expect(registered).toEqual([MENTION_EMAIL_TEMPLATES]);
    expect(opts.getConsoleUrl('/me_task/t1')).toBe('https://app.example.test/_console/me_task/t1');
  });

  it('without an auth service the link composer answers nothing (the writer keeps the relative link)', async () => {
    const { opts } = await boot({ messaging: { emit: async () => ({}) } });
    expect(opts.getConsoleUrl('/me_task/t1')).toBeUndefined();
  });

  it('a refused registration is said once at warn and does not stop the writers', async () => {
    const { opts, warns } = await boot({
      messaging: { emit: async () => ({}), registerBuiltinTemplates: () => { throw new TypeError('already declared'); } },
    });
    expect(opts).toBeDefined();
    expect(warns.filter((w) => w.includes('@mention e-mail templates were NOT registered'))).toHaveLength(1);
  });
});
