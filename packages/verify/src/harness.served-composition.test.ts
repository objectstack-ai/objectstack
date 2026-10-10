// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 1, the composition gap the stage-2 contract review recorded:
 * for one configuration `bootStack` composes what `objectstack serve`
 * composes (ruling A), and two halves of that were still `serve`'s alone —
 *
 *  - the always-on slate `serve` mounts for EVERY app
 *    (`PLATFORM_ALWAYS_ON_CAPABILITIES`): the handle mounted a slate provider
 *    only where a mounted plugin hard-depended on it;
 *  - the configuration each provider is built from: the handle built every
 *    provider with its own defaults — the analytics service with no cubes, the
 *    email service with no mail configuration.
 *
 * Both now come from the rule `serve` reads (`resolveServedCapabilities` /
 * `resolveCapabilityArgument`, `@objectstack/core`). One pin per half, each
 * with its control; each was turned red by an ablation of exactly the half it
 * pins (recorded in the PR that added this file).
 *
 * The configuration-built cases add `email` to the configuration object, not
 * through `defineStack`: that is the shape `serve`'s reader reads, and this
 * file pins that both boots hand it to the provider — what an author may
 * declare is the stack schema's question, not this file's.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_PROVIDERS } from '@objectstack/core';
import { composeStacks, defineStack } from '@objectstack/spec';
import { PLATFORM_ALWAYS_ON_CAPABILITIES } from '@objectstack/spec/kernel';
import { bootStack, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 120_000;

const svcManifest = { id: 'com.example.svc.svc', name: 'SVC Service', namespace: 'svc', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.svc.app', name: 'SVC App', namespace: 'svc', version: '1.0.0', type: 'app' };
const note = {
  name: 'svc_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'public_read_write',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
};
const ticket = {
  name: 'svc_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'public_read_write',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
};
const CUBE = 'svc_note_cube';
const cube = {
  name: CUBE, title: 'Notes', sql: 'svc_note',
  measures: { count: { label: 'Count', type: 'count', sql: '*' } },
  dimensions: { name: { label: 'Name', type: 'string', sql: 'name' } },
};

type Bag = Record<string, unknown>;

/** One package, `extra` at its top level — a fresh object per call (the instance rule keys on identity). */
const onePackage = (extra: Bag = {}): Bag =>
  defineStack({ manifest: appManifest, objects: [ticket, note], ...extra } as never) as unknown as Bag;

/** Two packages through the real producer: `svcExtra` lives only in the service package's body. */
const twoPackages = (svcExtra: Bag): Bag =>
  composeStacks(
    [
      defineStack({ manifest: svcManifest, objects: [note], ...svcExtra } as never),
      defineStack({ manifest: appManifest, objects: [ticket] } as never),
    ],
    { manifest: 'preserve' },
  ) as unknown as Bag;

let stack: VerifyStack | undefined;
afterEach(async () => {
  await stack?.stop();
  stack = undefined;
});

/** The registered plugin name each slate token's provider registers under (the table's first identity). */
const SLATE_PROVIDERS = PLATFORM_ALWAYS_ON_CAPABILITIES.flatMap((token) => {
  const spec = CAPABILITY_PROVIDERS[token];
  return spec ? [{ token, name: spec.identities[0]! }] : [];
});

describe('the always-on slate `serve` mounts for every app is mounted', () => {
  it('an app that requires nothing gets every slate provider — and nothing off the slate', async () => {
    // Anti-vacuity: the slate is the spec's, and most of it has a provider row.
    expect(SLATE_PROVIDERS.length).toBeGreaterThanOrEqual(8);
    const config = onePackage();
    expect(config.requires).toBeUndefined();
    stack = await bootStack(config);
    const missing = SLATE_PROVIDERS.filter(({ name }) => !stack!.kernel.hasPlugin(name)).map(({ token }) => token);
    expect(missing).toEqual([]);
    // Control: a provider neither declared nor on the slate is not mounted, so
    // the cases above prove the slate, not the whole table.
    expect(stack.kernel.hasPlugin(CAPABILITY_PROVIDERS.approvals!.identities[0]!)).toBe(false);
    expect(stack.kernel.hasPlugin(CAPABILITY_PROVIDERS.realtime!.identities[0]!)).toBe(false);
  }, BOOT_TIMEOUT);
});

/** The cube names the booted analytics service holds. */
async function cubeNames(s: VerifyStack): Promise<string[]> {
  const analytics = await s.kernel.getServiceAsync<{ cubeRegistry: { names(): string[] } }>('analytics');
  return analytics.cubeRegistry.names();
}

describe('the analytics service is built with the app\'s `analyticsCubes`', () => {
  it('a cube the app declares is registered', async () => {
    stack = await bootStack(onePackage({ analyticsCubes: [cube] }));
    expect(await cubeNames(stack)).toContain(CUBE);
  }, BOOT_TIMEOUT);

  it('a cube a package body declares is registered — the top level carries none', async () => {
    const config = twoPackages({ analyticsCubes: [cube] });
    expect(config.analyticsCubes).toBeUndefined();
    stack = await bootStack(config);
    expect(await cubeNames(stack)).toContain(CUBE);
  }, BOOT_TIMEOUT);

  it('control — an app that declares no cube registers none of this name', async () => {
    stack = await bootStack(onePackage());
    expect(await cubeNames(stack)).not.toContain(CUBE);
  }, BOOT_TIMEOUT);
});

const PROBE_SUBJECT = 'served-composition probe';

/** Send one message through the booted email service and count the `sys_email` rows it left. */
async function probeRowsAfterSend(s: VerifyStack): Promise<number> {
  const email = await s.kernel.getServiceAsync<{ send(input: Record<string, unknown>): Promise<unknown> }>('email');
  await email.send({ to: 'probe@example.com', subject: PROBE_SUBJECT, text: 'probe' });
  const engine = await s.kernel.getServiceAsync<{
    find(object: string, query: Record<string, unknown>): Promise<unknown>;
  }>('objectql');
  const found = await engine.find('sys_email', { where: { subject: PROBE_SUBJECT }, context: { isSystem: true } });
  const rows = Array.isArray(found) ? found : ((found as { records?: unknown[] })?.records ?? []);
  return rows.length;
}

describe('the email service is built from the app\'s mail configuration', () => {
  it('`email.persist: false` reaches the provider: a send leaves no `sys_email` row', async () => {
    stack = await bootStack({ ...onePackage(), email: { persist: false } });
    expect(await probeRowsAfterSend(stack)).toBe(0);
  }, BOOT_TIMEOUT);

  it('control — with no mail configuration, the same send leaves one row', async () => {
    stack = await bootStack(onePackage());
    expect(await probeRowsAfterSend(stack)).toBe(1);
  }, BOOT_TIMEOUT);

  it('a mail configuration no transport can deliver through fails the boot, naming the provider and the fix', async () => {
    const saved = process.env.OS_EMAIL_SMTP_HOST;
    delete process.env.OS_EMAIL_SMTP_HOST;
    try {
      await expect(bootStack({ ...onePackage(), email: { provider: 'smtp' } })).rejects.toThrow(
        /EmailServicePlugin[\s\S]*provider='smtp'[\s\S]*OS_EMAIL_SMTP_HOST/,
      );
    } finally {
      if (saved !== undefined) process.env.OS_EMAIL_SMTP_HOST = saved;
    }
  }, BOOT_TIMEOUT);
});
