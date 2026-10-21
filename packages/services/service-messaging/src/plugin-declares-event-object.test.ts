// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4154 — this service must DECLARE the L2 event object it writes.
//
// `MessagingService.emit()` writes `sys_notification` on every call; it is the
// pipeline's single ingress. The object is owned by `@objectstack/platform-
// objects`, but ownership of the DEFINITION is not the same as contributing it
// to a running kernel: the engine needs it in the registry before it can issue
// DDL, and nothing else in a lean boot puts it there.
//
// Until #4154 the contribution came from `AuditPlugin`, parked there with a
// comment saying it would stay "until that [ADR-0030] migration lands". The
// migration landed, the parking did not move, and AuditPlugin is an OPTIONAL
// pair in the CLI — so a deployment that installed messaging without audit had
// every `notify()` fail with `no such table: sys_notification`. AuditPlugin
// never wrote the row itself; it routes through this service's `emit()`.
//
// This test pins the invariant directly rather than through a booted stack, so
// a regression names the cause instead of surfacing three layers away as a 404
// or a `Find operation failed`.

import { describe, it, expect } from 'vitest';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import { NOTIFICATION_EVENT_OBJECT } from './messaging-service.js';

/** Capture what the plugin hands the `manifest` service during `init()`. */
interface CapturedManifest {
  objects: Array<{ name: string }>;
  navigationContributions: Array<{ items?: Array<{ id?: string; objectName?: string }> }>;
}

async function collectManifest(): Promise<CapturedManifest> {
  let captured: Partial<CapturedManifest> | undefined;
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService() {},
    // `init()` resolves `manifest` to register objects, and may probe other
    // services; anything it does not need for this assertion resolves to
    // undefined and the plugin's own optional-service guards handle it.
    getService(name: string) {
      if (name === 'manifest') {
        return { register(m: Partial<CapturedManifest>) { captured = m; } };
      }
      return undefined;
    },
    hook() {},
  };

  await new MessagingServicePlugin().init(ctx as never);
  return { objects: captured?.objects ?? [], navigationContributions: captured?.navigationContributions ?? [] };
}

describe('MessagingServicePlugin declares the object it writes (#4154)', () => {
  it('contributes the L2 event object to the manifest', async () => {
    const { objects } = await collectManifest();
    const names = objects.map((o) => o?.name);

    // The exact name `emit()` writes — read from the service's own constant so
    // the two cannot drift apart.
    expect(names).toContain(NOTIFICATION_EVENT_OBJECT);
  });

  it('still contributes the rest of the pipeline alongside it', async () => {
    const { objects } = await collectManifest();
    const names = objects.map((o) => o?.name);

    // Guards the other direction: adding the event object must not have
    // displaced the objects this service already owned.
    for (const name of [
      'sys_inbox_message',
      'sys_notification_receipt',
      'sys_notification_delivery',
      'sys_notification_preference',
      'sys_notification_template',
    ]) {
      expect(names).toContain(name);
    }
  });

  // ADR-0087 semantic entry `sys-notification-subscription-retired`: no reader
  // ever expanded a subscription into recipients (`EmitInput.audience` is
  // required), so the object is neither registered nor offered in Setup nav.
  // The positive halves above are the vacuity control: the same capture sees
  // the surviving siblings and the surviving nav items.
  it('registers no sys_notification_subscription and offers no nav item for it', async () => {
    const { objects, navigationContributions } = await collectManifest();
    expect(objects.map((o) => o?.name)).not.toContain('sys_notification_subscription');

    const items = navigationContributions.flatMap((c) => c.items ?? []);
    expect(items.map((i) => i.objectName)).toContain('sys_notification_preference');
    expect(items.map((i) => i.objectName)).not.toContain('sys_notification_subscription');
    expect(items.map((i) => i.id)).not.toContain('nav_notification_subscriptions');
  });
});
