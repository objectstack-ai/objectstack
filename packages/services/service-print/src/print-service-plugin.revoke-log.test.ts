// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * The plugin as composed wires the service's logger: a revoke that fails after
 * a print reaches the PLUGIN's logger at `error`. Pinned through the plugin, not
 * the service, because that one line of composition is what makes the failure
 * loud. `playwright-core` is replaced by a staged launcher, so this runs on
 * every host; the real library is exercised in the plugin's other suites.
 */

vi.mock('playwright-core', () => {
  const page = {
    goto: async () => undefined,
    waitForFunction: async () => undefined,
    evaluate: async () => true,
    pdf: async () => Buffer.from('%PDF-1.4 staged'),
  };
  const context = { addCookies: async () => undefined, newPage: async () => page, close: async () => undefined };
  const browser = { version: () => '141.0.0.0', newContext: async () => context, close: async () => undefined };
  const server = { wsEndpoint: () => 'ws://127.0.0.1:1/staged', close: async () => undefined, kill: async () => undefined };
  return {
    chromium: {
      launchServer: async () => server,
      connect: async () => browser,
      connectOverCDP: async () => browser,
    },
  };
});

const { PrintServicePlugin, PRINT_SERVICE } = await import('./print-service-plugin.js');
const { FILE_ATTACHMENT_SERVICE } = await import('@objectstack/spec/contracts');

const TOKEN = 'minted-token-for-the-revoke-log-pin';
const USER = { userId: 'usr_alice', tenantId: 'org_1', principalKind: 'human' } as ExecutionContext;

describe('PrintServicePlugin wires its logger into the service', () => {
  it('a revoke that fails after a successful print is logged at error on the plugin’s logger, by fingerprint', async () => {
    const logged: Array<{ level: string; message: string }> = [];
    const services = new Map<string, unknown>([
      [
        'auth',
        {
          mintPrincipalSession: async () => ({
            token: TOKEN,
            cookie: { name: 'os.session_token', value: TOKEN, path: '/', httpOnly: true, secure: false },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            revoke: async () => {
              throw new Error('session store unavailable');
            },
          }),
        },
      ],
      [
        'objectql',
        {
          findOne: async () => ({ id: 'inv_1' }),
          registry: {
            getItem: () => ({ name: 'invoice_print', type: 'record', object: 'invoice', isDefault: true, print: {} }),
            getObject: () => ({ name: 'invoice', enable: { files: true } }),
          },
        },
      ],
      [
        FILE_ATTACHMENT_SERVICE,
        {
          attachFile: async () => {
            throw new Error('the system verb must not be used');
          },
          assertMayAttach: async () => undefined,
          attachFileAs: async (input: { data: Buffer }) => ({ fileId: 'file_1', attachmentId: 'att_1', size: input.data.byteLength }),
        },
      ],
    ]);
    const ctx = {
      logger: {
        info: (message: string) => logged.push({ level: 'info', message }),
        warn: (message: string) => logged.push({ level: 'warn', message }),
        error: (message: string) => logged.push({ level: 'error', message }),
        debug: () => undefined,
      },
      registerService: (name: string, service: unknown) => services.set(name, service),
      getService: (name: string) => {
        if (!services.has(name)) throw new Error(`service ${name} not found`);
        return services.get(name);
      },
      hook: () => undefined,
    } as unknown as PluginContext;

    const plugin = new PrintServicePlugin({ chromiumPath: '/staged/chromium', consoleUrl: 'http://127.0.0.1:3000/_console' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    const print = services.get(PRINT_SERVICE) as { printRecordToFile: Function; status: Function };
    expect(print.status()).toMatchObject({ state: 'ready' });

    const out = await print.printRecordToFile({ app: 'app', object: 'invoice', recordId: 'inv_1', page: 'invoice_print' }, USER);

    expect(out).toMatchObject({ fileId: 'file_1' });
    const errors = logged.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/fingerprint [0-9a-f]{12}/);
    expect(errors[0]!.message).not.toContain(TOKEN);
  });
});
