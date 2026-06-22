// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0062 D1/D8 — the showcase declares its `external` datasource with NO
// `onEnable` driver wiring (only fixture provisioning remains). This proves the
// declared external datasource AUTO-CONNECTS at boot and its federated objects
// are queryable end-to-end through the real REST stack — zero app code. Guards
// against a regression where dropping the `onEnable` bridge would leave the
// external objects unrouted ("Datasource 'showcase_external' is not registered").

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

function listOf(body: unknown): Array<Record<string, unknown>> {
  const b = body as { records?: unknown[]; data?: unknown[] } | unknown[];
  if (Array.isArray(b)) return b as Array<Record<string, unknown>>;
  return ((b as { records?: unknown[] }).records ?? (b as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
}

describe('showcase: external datasource auto-connects with no onEnable bridge (ADR-0062 D8)', () => {
  let stack: VerifyStack;
  let admin: string;

  beforeAll(async () => {
    // Stand up the "remote" database (the showcase's onEnable fixture provisioner).
    // The verify harness imports only the stack's default export, so its onEnable
    // never runs here — we invoke it ourselves to create the remote customers/orders
    // tables, exactly as `os dev` does at boot. Crucially this does NOT register a
    // driver (ADR-0062 D8); auto-connect (below, during bootStack) does that.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack);
    admin = await stack.signIn();
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('federated customer object is queryable (auto-connected, seeded fixture rows returned)', async () => {
    const res = await stack.apiAs(admin, 'GET', '/data/showcase_ext_customer');
    expect(res.status, 'federated object must be queryable — driver auto-connected').toBe(200);
    const rows = listOf(await res.json());
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.map((r) => r.name)).toContain('Aurora Labs');
  });

  it('federated order object (remoteName remap) is queryable too', async () => {
    const res = await stack.apiAs(admin, 'GET', '/data/showcase_ext_order');
    expect(res.status).toBe(200);
    const rows = listOf(await res.json());
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it('region filter pushes down to the remote table', async () => {
    const res = await stack.apiAs(admin, 'GET', '/data/showcase_ext_customer?region=EU');
    expect(res.status).toBe(200);
    const rows = listOf(await res.json());
    expect(rows.every((r) => r.region === 'EU')).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
