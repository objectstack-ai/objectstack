// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A mail template's `{{ stage | option:opportunity.stage }}` hole, booted: an
// app declares the object and the template, an i18n service carries the zh-CN
// labels, and the real `EmailServicePlugin` sends through the label sources it
// wires (the data engine's served object and the `i18n` service, resolved at
// each send). Each recipient reads their own language's label; an object the
// deployment does not serve refuses the send `TEMPLATE_INVALID`.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { IEmailService, IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import { EmailServicePlugin } from './email-plugin.js';

const PACKAGE_ID = 'com.test.mail-option-labels';

const template = (name: string, hole: string) => ({
  name,
  label: 'Stalled deal',
  locale: 'en-US',
  subject: `{{ name }} is stalled at ${hole}`,
  bodyHtml: `<p>${hole}</p>`,
});

/** A driver that stores nothing: the template is metadata, not a row. */
const emptyDriver = {
  name: 'mail-option-labels-driver',
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

const translations: Record<string, Record<string, unknown>> = {
  'zh-CN': { objects: { mol_opportunity: { fields: { stage: { options: { needs_analysis: '需求分析' } } } } } },
  en: {},
};

/** Registers the driver, an i18n service carrying zh-CN labels, and the app body through `manifest`. */
class AppFixture implements Plugin {
  name = 'test.mail-option-labels.app';
  type = 'standard' as const;
  version = '1.0.0';
  async init(ctx: PluginContext) {
    ctx.registerService('driver.mail-option-labels', emptyDriver);
    ctx.registerService('i18n', {
      t: (key: string) => key,
      getLocales: () => Object.keys(translations),
      getTranslations: (locale: string) => translations[locale] ?? {},
      getFallbackLocale: () => 'en',
      getDefaultLocale: () => 'en',
    });
    const manifest = { id: PACKAGE_ID, name: 'mail_option_labels', type: 'app', version: '1.0.0' };
    ctx.getService<{ register(m: unknown): void }>('manifest').register({
      ...manifest,
      manifest,
      objects: [{
        name: 'mol_opportunity',
        label: 'Opportunity',
        fields: {
          name: { name: 'name', label: 'Name', type: 'text' },
          stage: {
            name: 'stage', label: 'Stage', type: 'select',
            options: [{ value: 'needs_analysis', label: 'Needs Analysis' }, { value: 'closed_won', label: 'Closed Won' }],
          },
        },
      }],
      emailTemplates: [
        template('mol_stalled', '{{ stage | option:mol_opportunity.stage }}'),
        template('mol_stalled_unknown', '{{ stage | option:mol_deal.stage }}'),
      ],
    });
  }
}

class CaptureTransport implements IEmailTransport {
  readonly subjects: string[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.subjects.push(message.subject);
    return { messageId: `<option-${this.subjects.length}@test>` };
  }
}

describe('the booted email service labels an option hole in each recipient\'s language', () => {
  let kernel: ObjectKernel | undefined;

  afterEach(async () => {
    if (kernel?.getState() === 'running') await kernel.shutdown();
    kernel = undefined;
  });

  async function boot() {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const transport = new CaptureTransport();
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AppFixture());
    await kernel.use(new EmailServicePlugin({ persist: false, transport, defaultFrom: { address: 'no-reply@example.com' } }));
    await kernel.bootstrap();
    return { email: kernel.getService<IEmailService>('email'), transport };
  }

  it('an en-US and a zh-CN recipient each read their own label', async () => {
    const { email, transport } = await boot();
    const data = { name: 'Acme', stage: 'needs_analysis' };
    for (const [to, locale] of [['ann@example.com', 'en-US'], ['li@example.com', 'zh-CN']] as const) {
      const res = await email.sendTemplate({ template: 'mol_stalled', to, locale, data });
      expect(res.status).toBe('sent');
    }
    expect(transport.subjects).toEqual(['Acme is stalled at Needs Analysis', 'Acme is stalled at 需求分析']);
  });

  it('an object the deployment does not serve refuses the send, and nothing is sent', async () => {
    const { email, transport } = await boot();
    await expect(email.sendTemplate({
      template: 'mol_stalled_unknown', to: 'ann@example.com', locale: 'zh-CN', data: { name: 'Acme', stage: 'needs_analysis' },
    })).rejects.toThrow(/^TEMPLATE_INVALID: email template mol_stalled_unknown \(locale=en-US\): the hole \{\{ stage \| option:mol_deal\.stage \}\} names the object `mol_deal`/);
    expect(transport.subjects).toEqual([]);
  });
});
