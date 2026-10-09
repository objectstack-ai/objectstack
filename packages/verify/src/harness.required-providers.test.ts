// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 1 — `bootStack` mounts the providers an app's `requires` names,
 * as `objectstack serve` does: `serve`'s reader (`stackDeclaredCapabilities`),
 * `serve`'s table (`CAPABILITY_PROVIDERS`), `serve`'s "an explicit instance
 * wins" rule (`providesCapability`) — all three now in `@objectstack/core`.
 *
 * Measured before the fix (`origin/main` 28bff18d0): a `requires: ['approvals']`
 * app booted through `bootStack` registered no `com.objectstack.service.approvals`
 * plugin and no `sys_approval_request` object, in either stack shape; the app
 * had to name the plugin in `extraPlugins` (hotcrm keeps five such entries).
 *
 * One case per branch of the reader's rule — the top-level list, the package
 * bodies when there is none, and the top level winning when both are present —
 * plus the control (no `requires`), the explicit-wins rule, and the hard
 * dependencies a mounted provider brings (`triggers` → `job` / `queue`, which
 * `serve` mounts through its always-on slate).
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_PROVIDERS } from '@objectstack/core';
import { composeStacks, defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';

const APPROVALS = 'com.objectstack.service.approvals';

const svcManifest = { id: 'com.example.rqp.svc', name: 'RQP Service', namespace: 'rqp', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.rqp.app', name: 'RQP App', namespace: 'rqp', version: '1.0.0', type: 'app' };
const note = {
  name: 'rqp_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'public_read_write',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
};
const ticket = {
  name: 'rqp_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'public_read_write',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
};

type Bag = Record<string, unknown>;

/** One package, `extra` at its top level. */
const onePackage = (extra: Bag = {}): Bag =>
  defineStack({ manifest: appManifest, objects: [ticket, note], ...extra } as never) as unknown as Bag;

/** Two packages through the real producer: `requires` lives only in the bodies. */
const twoPackages = (svcExtra: Bag = {}, appExtra: Bag = {}): Bag =>
  composeStacks(
    [
      defineStack({ manifest: svcManifest, objects: [note], ...svcExtra } as never),
      defineStack({ manifest: appManifest, objects: [ticket], ...appExtra } as never),
    ],
    { manifest: 'preserve' },
  ) as unknown as Bag;

let stack: VerifyStack | undefined;
afterEach(async () => {
  await stack?.stop();
  stack = undefined;
});

const approvalsMounted = (s: VerifyStack) => ({
  plugin: s.kernel.hasPlugin(APPROVALS),
  object: s.metadata.object('sys_approval_request') !== undefined,
});

describe('bootStack mounts what `requires` names, by serve\'s reader', () => {
  it('top-level `requires` — the provider is mounted and its objects registered', async () => {
    stack = await bootStack(onePackage({ requires: ['approvals'] }));
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: true });
  }, 120_000);

  it('a package body\'s `requires` — counted when the top level carries none', async () => {
    const config = twoPackages({ requires: ['approvals'] });
    // Anti-vacuity: the producer really left `requires` out of the top level.
    expect(config.requires).toBeUndefined();
    stack = await bootStack(config);
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: true });
  }, 120_000);

  it('the top-level list wins over the bodies when present', async () => {
    stack = await bootStack({ ...twoPackages({ requires: ['approvals'] }), requires: ['cache'] });
    expect(stack.kernel.hasPlugin('com.objectstack.service.cache')).toBe(true);
    expect(approvalsMounted(stack)).toEqual({ plugin: false, object: false });
  }, 120_000);

  it('control — an app that requires nothing gets none of them', async () => {
    stack = await bootStack(onePackage());
    expect(approvalsMounted(stack)).toEqual({ plugin: false, object: false });
    expect(stack.kernel.hasPlugin('com.objectstack.service.cache')).toBe(false);
  }, 120_000);
});

describe('serve\'s other two rules', () => {
  it('an explicit instance wins: a caller\'s provider is kept, the boot\'s is not constructed', async () => {
    // A stand-in that registers under the provider's identity and nothing else
    // — so the absence of `sys_approval_request` proves the real one never ran.
    class StandInApprovals {
      readonly name = APPROVALS;
      readonly version = '0.0.0';
      readonly type = 'standard';
      async init(): Promise<void> {}
    }
    stack = await bootStack(onePackage({ requires: ['approvals'] }), { extraPlugins: [new StandInApprovals()] });
    expect(approvalsMounted(stack)).toEqual({ plugin: true, object: false });
  }, 120_000);

  it('a mounted provider\'s hard dependencies come with it: `triggers` brings `job` and `queue`', async () => {
    stack = await bootStack(onePackage({ requires: ['automation', 'triggers'] }));
    for (const name of [
      'com.objectstack.service-automation',
      'com.objectstack.trigger.record-change',
      'com.objectstack.trigger.schedule',
      'com.objectstack.trigger.time-relative',
      'com.objectstack.trigger.api',
      'com.objectstack.service.job',
      'com.objectstack.service.queue',
    ]) {
      expect(stack.kernel.hasPlugin(name), name).toBe(true);
    }
  }, 120_000);
});

describe('every provider the table names is a dependency of this package', () => {
  it('so a declared token never fails to import from @objectstack/verify', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const packages = Object.values(CAPABILITY_PROVIDERS).flatMap((spec) => [
      spec.pkg,
      ...(spec.extras ?? []).map((extra) => extra.pkg),
    ]);
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.filter((pkg) => !(pkg in manifest.dependencies))).toEqual([]);
  });
});
