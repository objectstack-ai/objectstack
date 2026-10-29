// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A declared template edited in source and hot reloaded is what the next send
// renders. The dev loop (`os dev`, watcher on) recompiles the artifact, the
// artifact door re-reads it, and `metadata:reloaded` carries the parsed
// artifact to its subscribers. The send path reads the protocol's layered
// `email_template` list on its execution face (`template-loader.ts`), and that
// list lays the SchemaRegistry over the metadata service — so the registry
// entry the boot registered through the `manifest` service has to follow the
// reload, or every send renders the boot copy until a cold restart while the
// by-name read already serves the edit.
//
// The engine plugin is the real `ObjectQLPlugin` (its `manifest` service, its
// protocol, its `metadata:reloaded` hook); the app registers through the
// `manifest` service at init as `AppPlugin` does; the reload is announced with
// the payload the artifact door sends. The send is the real `EmailService`
// over the loader `EmailServicePlugin` wires.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { IEmailTransport, TransportSendResult } from '@objectstack/spec/contracts';
import { EmailService } from './email-service.js';
import { createRegistryEmailTemplateLoader } from './template-loader.js';

const PACKAGE_ID = 'com.test.mail-reload';

/** The app's stack body as the `manifest` service receives it, with the template's subject at `v`. */
const stack = (v: string) => ({
  manifest: { id: PACKAGE_ID, name: 'mail_reload', type: 'app', version: '1.0.0' },
  emailTemplates: [{
    name: 'mr_task_done',
    label: 'Task done',
    locale: 'en-US',
    subject: `Task done (${v}): {{title}}`,
    bodyHtml: `<p>{{title}} is done (${v}).</p>`,
    variables: [{ name: 'title', type: 'string', required: true }],
  }],
});

/** A driver that stores nothing: the template is metadata, not a row. */
const emptyDriver = {
  name: 'mail-reload-driver',
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

/** Registers the driver, and the app body through the `manifest` service, at init. */
class AppFixture implements Plugin {
  name = 'test.mail-reload.app';
  type = 'standard' as const;
  version = '1.0.0';
  ctx?: PluginContext;
  async init(ctx: PluginContext) {
    this.ctx = ctx;
    ctx.registerService('driver.mail-reload', emptyDriver);
    const body = stack('v1');
    ctx.getService<{ register(m: unknown): void }>('manifest').register({ ...body.manifest, ...body });
  }
}

class CaptureTransport implements IEmailTransport {
  readonly subjects: string[] = [];
  async send(message: { subject: string }): Promise<TransportSendResult> {
    this.subjects.push(message.subject);
    return { messageId: `<reload-${this.subjects.length}@test>` };
  }
}

describe('a hot reloaded declared email template is what the next send renders', () => {
  let kernel: ObjectKernel | undefined;

  afterEach(async () => {
    if (kernel?.getState() === 'running') await kernel.shutdown();
    kernel = undefined;
  });

  async function boot() {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const app = new AppFixture();
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(app);
    await kernel.bootstrap();
    const ctx = app.ctx!;
    const engine: any = kernel.getService('objectql');
    const protocol: any = kernel.getService('protocol');
    const transport = new CaptureTransport();
    const mail = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@example.com' },
      // The sources `EmailServicePlugin` resolves at every load.
      templateLoader: createRegistryEmailTemplateLoader(() => ({ protocol, registry: engine.registry })),
    });
    const send = async () => {
      const res = await mail.sendTemplate({ template: 'mr_task_done', to: 'ann@example.com', data: { title: 'Ship it' } });
      expect(res.status).toBe('sent');
      return transport.subjects.at(-1);
    };
    const listed = async () => ((await protocol.getMetaItems({ type: 'email_template' })).items ?? [])
      .filter((i: any) => i?.name === 'mr_task_done')
      .map((i: any) => i.subject);
    // The payload the artifact door announces: the freshly parsed artifact.
    const reload = (v: string) => ctx.trigger('metadata:reloaded', { changed: ['dist/objectstack.json'], metadata: stack(v) });
    return { send, listed, reload };
  }

  it('renders the reloaded subject, and the list read serves it', async () => {
    const { send, listed, reload } = await boot();

    // Positive control: the boot copy is what both doors serve.
    expect(await send()).toBe('Task done (v1): Ship it');
    expect(await listed()).toEqual(['Task done (v1): {{title}}']);

    await reload('v2');

    expect(await send()).toBe('Task done (v2): Ship it');
    expect(await listed()).toEqual(['Task done (v2): {{title}}']);
  });
});
