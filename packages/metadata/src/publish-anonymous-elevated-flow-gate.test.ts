// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 D2b on `publishPackage` — the metadata layer's door for both items.
 *
 * The record refuses an `authRequired: false` endpoint of `type: 'flow'` whose
 * target flow declares `runAs: 'system'`, "in both directions, because either
 * item can be the last one edited". This door publishes `api` and `flow` items
 * alike, minted item by item (`metadata.register()`) and never parsed as a
 * stack — the path #5189 pinned the per-endpoint gates on
 * (`publish-endpoint-gate.test.ts`). So both directions are pinned here:
 *
 *  - ENDPOINT: an `api` item of the package names a `system` flow (in the
 *    package, or anywhere in the manager's index) — refused at the endpoint;
 *  - FLOW: a `flow` item of the package declares `runAs: 'system'` while an
 *    anonymous endpoint OUTSIDE the package names it — refused at the flow.
 *
 * Each refusal is paired with the control the record leaves open (an
 * authenticated endpoint on a `system` flow; an anonymous endpoint on a `user`
 * flow), asserts that NOTHING was published, and reads the prescription the
 * author is given. The judge itself is `@objectstack/spec/api`'s, pinned in
 * `anonymous-elevated-flow-gate.test.ts` there.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager.js';
import { MemoryLoader } from './loaders/memory-loader.js';

vi.mock('@objectstack/core', async (orig) => ({
  // Spread the REAL module: MetadataManager imports the shared register
  // contract guard from @objectstack/core, and a mock naming only
  // createLogger breaks on every export the class gains.
  ...((await orig()) as object),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const PKG = 'com.acme.intake';
const OTHER = 'com.acme.partner';
const NS = 'acme';
const FLOW = 'acme_partner_intake';
const ENDPOINT = 'acme_partner_intake_api';
const ARMED = { enabled: true, windowMs: 60_000, maxRequests: 100 };

/** A `type: 'api'` flow — the type the runtime's elevated-start refusal does not cover. */
function flowItem(runAs: 'system' | 'user', packageId = PKG): Record<string, unknown> {
  return {
    name: FLOW,
    label: 'Partner intake',
    type: 'api',
    runAs,
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    packageId,
    state: 'draft',
  };
}

/** The AUTHORED endpoint body: a flow endpoint naming {@link FLOW}. */
function endpointBody(authRequired: boolean): Record<string, unknown> {
  return {
    name: ENDPOINT,
    path: `/api/v1/apps/${NS}/partner/intake`,
    method: 'POST',
    type: 'flow',
    target: FLOW,
    authRequired,
    ...(authRequired ? {} : { rateLimit: ARMED }),
  };
}

/** The stored flat shape: body plus the layer's bookkeeping at one level. */
function apiItem(authRequired: boolean, packageId = PKG): Record<string, unknown> {
  return { ...endpointBody(authRequired), packageId, state: 'draft' };
}

describe('ADR-0138 D2b — publishPackage refuses the anonymous endpoint × system flow pair', () => {
  let manager: MetadataManager;

  beforeEach(() => {
    manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
  });

  it('control: an AUTHENTICATED endpoint on a `system` flow, both in the package, publishes', async () => {
    await manager.register('api', ENDPOINT, apiItem(true));
    await manager.register('flow', FLOW, flowItem('system'));

    const result = await manager.publishPackage(PKG, { namespace: NS });

    expect(result.validationErrors ?? []).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.itemsPublished).toBe(2);
  });

  it('control: an ANONYMOUS endpoint on a `user` flow publishes', async () => {
    await manager.register('api', ENDPOINT, apiItem(false));
    await manager.register('flow', FLOW, flowItem('user'));

    const result = await manager.publishPackage(PKG, { namespace: NS });

    expect(result.validationErrors ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('ENDPOINT direction, the pair inside the package: refused once, at the endpoint; nothing published', async () => {
    await manager.register('api', ENDPOINT, apiItem(false));
    await manager.register('flow', FLOW, flowItem('system'));

    const result = await manager.publishPackage(PKG, { namespace: NS });

    expect(result.success).toBe(false);
    expect(result.itemsPublished).toBe(0);
    const d2b = (result.validationErrors ?? []).filter((e) => e.message.includes('ADR-0138 D2b'));
    expect(d2b.map(({ type, name }) => ({ type, name }))).toEqual([{ type: 'api', name: ENDPOINT }]);
    expect(d2b[0]!.message).toContain(`flow '${FLOW}'`);
    expect(d2b[0]!.message).toContain('authenticated endpoint');
    expect(d2b[0]!.message).toContain('signed inbound hook');
    expect(d2b[0]!.message).toContain('public form');
    expect((await manager.get('api', ENDPOINT) as any)?.state).toBe('draft');
  });

  it('ENDPOINT direction, the flow in ANOTHER package: the endpoint\'s publish reads its target wherever it is', async () => {
    await manager.register('api', ENDPOINT, apiItem(false));
    await manager.register('flow', FLOW, flowItem('system', OTHER));

    const result = await manager.publishPackage(PKG, { namespace: NS });

    expect(result.success).toBe(false);
    expect((result.validationErrors ?? []).map(({ type, name }) => ({ type, name })))
      .toEqual([{ type: 'api', name: ENDPOINT }]);
  });

  it('FLOW direction: a `system` flow of the package that an anonymous endpoint elsewhere names is refused, at the flow', async () => {
    await manager.register('api', ENDPOINT, apiItem(false, OTHER));
    await manager.register('flow', FLOW, flowItem('system'));

    const result = await manager.publishPackage(PKG);

    expect(result.success).toBe(false);
    expect(result.itemsPublished).toBe(0);
    const errors = result.validationErrors ?? [];
    expect(errors.map(({ type, name }) => ({ type, name }))).toEqual([{ type: 'flow', name: FLOW }]);
    expect(errors[0]!.message).toContain(`Flow '${FLOW}'`);
    expect(errors[0]!.message).toContain(`'${ENDPOINT}'`);
    expect(errors[0]!.message).toContain('signed inbound hook');
    expect((await manager.get('flow', FLOW) as any)?.state).toBe('draft');
  });

  it('FLOW direction control: the same flow under `user` publishes beside the anonymous endpoint', async () => {
    await manager.register('api', ENDPOINT, apiItem(false, OTHER));
    await manager.register('flow', FLOW, flowItem('user'));

    const result = await manager.publishPackage(PKG);

    expect(result.validationErrors ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('`validate: false` does not turn it off — a security refusal has no opt-out flag', async () => {
    await manager.register('api', ENDPOINT, apiItem(false));
    await manager.register('flow', FLOW, flowItem('system'));

    const result = await manager.publishPackage(PKG, { namespace: NS, validate: false });

    expect(result.success).toBe(false);
    expect((result.validationErrors ?? []).some((e) => e.type === 'api' && e.message.includes('ADR-0138 D2b'))).toBe(true);
  });

  it('the publish envelope shape is peeled first: a body under `metadata` is judged, not missed', async () => {
    await manager.register('api', ENDPOINT, {
      name: ENDPOINT,
      packageId: PKG,
      state: 'draft',
      metadata: endpointBody(false),
    });
    await manager.register('flow', FLOW, flowItem('system'));

    const result = await manager.publishPackage(PKG, { namespace: NS });

    expect(result.success).toBe(false);
    expect((result.validationErrors ?? []).filter((e) => e.message.includes('ADR-0138 D2b')).map((e) => e.name))
      .toEqual([ENDPOINT]);
  });
});
