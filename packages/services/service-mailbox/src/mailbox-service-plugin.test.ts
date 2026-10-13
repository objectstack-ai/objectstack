// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { CAPABILITY_PROVIDERS } from '@objectstack/core';
import {
  MailboxServicePlugin,
  MailIngestService,
  MAILBOX_ADMIN_CAPABILITY,
  MAILBOX_SERVICE,
  MAILBOX_SERVICE_MANIFEST_ID,
  SysMailAssociation,
  SysMailbox,
  SysMailMessage,
} from './index.js';

/** A plugin context that records the manifest it is handed and the hooks it arms. */
function fakeContext() {
  const registered: Array<Record<string, any>> = [];
  const services = new Map<string, unknown>();
  const hooks: Record<string, Array<() => Promise<void>>> = {};
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: Record<string, any>) => registered.push(m) };
      throw new Error(`no service ${name}`);
    },
    registerService: (name: string, service: unknown) => {
      if (services.has(name)) throw new Error(`service ${name} registered twice`);
      services.set(name, service);
    },
    hook: (event: string, fn: () => Promise<void>) => (hooks[event] ??= []).push(fn),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { ctx, registered, services, hooks };
}

describe('MailboxServicePlugin', () => {
  it('registers the three inbound-mail objects under its own manifest, and nothing else', async () => {
    const { ctx, registered } = fakeContext();
    await new MailboxServicePlugin().init(ctx);
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe(MAILBOX_SERVICE_MANIFEST_ID);
    expect(registered[0].objects.map((o: { name: string }) => o.name).sort()).toEqual([
      'sys_mail_association',
      'sys_mail_message',
      'sys_mailbox',
    ]);
  });

  it('registers the ingest seam as the `mailbox` kernel service, and only that service', async () => {
    const { ctx, services } = fakeContext();
    await new MailboxServicePlugin().init(ctx);
    expect([...services.keys()]).toEqual([MAILBOX_SERVICE]);
    const service = services.get(MAILBOX_SERVICE) as MailIngestService;
    expect(service).toBeInstanceOf(MailIngestService);
    expect(typeof service.ingest).toBe('function');
    expect(typeof service.rematch).toBe('function');
  });

  it('is the provider the `mailbox` capability token names, under its registered identity', () => {
    const row = CAPABILITY_PROVIDERS.mailbox;
    expect(row?.pkg).toBe('@objectstack/service-mailbox');
    expect(row?.export).toBe('MailboxServicePlugin');
    expect(row?.identities).toContain(new MailboxServicePlugin().name);
  });

  it('says out loud, at error, when the engine offers no middleware seam for the read gates', async () => {
    const { ctx, hooks } = fakeContext();
    const errors: string[] = [];
    ctx.logger.error = (m: string) => errors.push(m);
    ctx.getService = (name: string) => {
      if (name === 'objectql') return { find: async () => [] };
      throw new Error(`no service ${name}`);
    };
    await new MailboxServicePlugin().start(ctx);
    for (const fn of hooks['kernel:ready'] ?? []) await fn();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/read gates are NOT installed/);
  });
});

describe('the mailbox administrator capability', () => {
  it('is the curated organization capability the platform declares', () => {
    expect(PLATFORM_CAPABILITIES.find((c) => c.name === MAILBOX_ADMIN_CAPABILITY)?.scope).toBe('org');
  });

  it('is held by default by platform administrators', () => {
    expect(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions).toContain(MAILBOX_ADMIN_CAPABILITY);
  });

  it('gates the mailbox directory', () => {
    expect(SysMailbox.requiredPermissions).toEqual([MAILBOX_ADMIN_CAPABILITY]);
  });
});

describe('the inbound-mail objects', () => {
  it('store the sender-controlled HTML part as plain text, never as rendered markup', () => {
    expect(SysMailMessage.fields.body_html.type).toBe('textarea');
  });

  it('are written only by the service: the data API serves get and list', () => {
    for (const object of [SysMailbox, SysMailMessage, SysMailAssociation]) {
      expect(object.managedBy, object.name).toBe('engine-owned');
      expect(object.enable?.apiMethods, object.name).toEqual(['get', 'list']);
    }
  });

  it('let a message carry attachments by file reference', () => {
    expect(SysMailMessage.enable?.files).toBe(true);
  });

  it('dedupe a message per mailbox, and keep re-match idempotent per record', () => {
    expect(SysMailMessage.indexes).toContainEqual({ fields: ['mailbox_id', 'dedupe_key'], unique: 'organization' });
    expect(SysMailAssociation.indexes).toContainEqual({
      fields: ['mail_message_id', 'object_name', 'record_id'],
      unique: 'organization',
    });
  });
});
