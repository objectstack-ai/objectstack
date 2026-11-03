// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28880] The duly shape, booted: an app ships an `en` + `zh-CN` bundle (no
// `en-US` row), and the real `EmailServicePlugin` sends it through the
// built-in registry loader it wires. Measured on `origin/main` (`b15b634c`):
// `en-GB` and `zh-TW` recipients both threw `TEMPLATE_NOT_FOUND` (the ladder
// tried the named tag, then `en-US`), so each delivery dead-lettered. On this
// head `en-GB` reaches the `en` row and `zh-TW` the `zh-CN` row, and a
// recipient whose language the bundle lacks reaches the stack's declared
// fallback (the i18n service's `getFallbackLocale`) before `en-US`.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { IEmailService, IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import { EmailServicePlugin } from './email-plugin.js';

const PACKAGE_ID = 'com.test.mail-locale-fold';

const bundle = (locale: string) => ({
  name: 'lf_lead_time',
  label: 'Lead time',
  locale,
  subject: `[${locale}] {{title}} is due`,
  bodyHtml: `<p>[${locale}] {{title}}</p>`,
});

/** A driver that stores nothing: the template is metadata, not a row. */
const emptyDriver = {
  name: 'mail-locale-fold-driver',
  version: '1.0.0',
  supports: {},
  connect: async () => {},
  disconnect: async () => {},
  find: async () => [],
  findOne: async () => null,
  count: async () => 0,
  create: async (_o: string, d: any) => d,
  update: async (_o: string, _i: any, d: any) => d,
  delete: async () => true,
  syncSchema: async () => {},
};

/** Registers the driver, the app body through the `manifest` service, and an i18n service declaring `fallback`. */
class AppFixture implements Plugin {
  name = 'test.mail-locale-fold.app';
  type = 'standard' as const;
  version = '1.0.0';
  constructor(private readonly fallback: string | undefined) {}
  async init(ctx: PluginContext) {
    ctx.registerService('driver.mail-locale-fold', emptyDriver);
    if (this.fallback !== undefined) {
      const fallback = this.fallback;
      ctx.registerService('i18n', { getFallbackLocale: () => fallback });
    }
    const manifest = { id: PACKAGE_ID, name: 'mail_locale_fold', type: 'app', version: '1.0.0' };
    ctx.getService<{ register(m: unknown): void }>('manifest').register({
      ...manifest, manifest, emailTemplates: [bundle('en'), bundle('zh-CN')],
    });
  }
}

class CaptureTransport implements IEmailTransport {
  readonly subjects: string[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.subjects.push(message.subject);
    return { messageId: `<fold-${this.subjects.length}@test>` };
  }
}

describe('[#28880] the booted email service folds a recipient locale over the built-in loader', () => {
  let kernel: ObjectKernel | undefined;

  afterEach(async () => {
    if (kernel?.getState() === 'running') await kernel.shutdown();
    kernel = undefined;
  });

  async function boot(fallback?: string) {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const transport = new CaptureTransport();
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AppFixture(fallback));
    await kernel.use(new EmailServicePlugin({ persist: false, transport, defaultFrom: { address: 'no-reply@example.com' } }));
    await kernel.bootstrap();
    const email = kernel.getService<IEmailService>('email');
    return async (locale: string) => {
      const res = await email.sendTemplate({ template: 'lf_lead_time', to: 'ann@example.com', locale, data: { title: 'Visa' } });
      expect(res.status).toBe('sent');
      return transport.subjects[transport.subjects.length - 1];
    };
  }

  it('en-GB reaches the en row and zh-TW the zh-CN row', async () => {
    const send = await boot();
    expect(await send('en-GB')).toBe('[en] Visa is due');
    expect(await send('zh-TW')).toBe('[zh-CN] Visa is due');
  });

  it('a recipient language the bundle lacks reaches the declared fallback', async () => {
    const send = await boot('zh-CN');
    expect(await send('ja')).toBe('[zh-CN] Visa is due');
  });
});
