// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata-mutation listener contract (#2588).
 *
 * `onMetadataMutation` is the post-persistence notification every authoring
 * surface funnels through (saveMetaItem / publishMetaItem / deleteMetaItem
 * all emit). Runtime consumers — first: ObjectQLPlugin's authored-hook
 * rebind — subscribe to it instead of each HTTP surface hand-announcing.
 * The end-to-end emit points are exercised by the runtime integration flow;
 * these tests pin the listener contract itself.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataMutationEvent } from './protocol.js';

function makeProtocol() {
  // The listener plumbing never touches the engine.
  return new ObjectStackProtocolImplementation({} as any);
}

const evt = (over: Partial<MetadataMutationEvent> = {}): MetadataMutationEvent => ({
  type: 'hook',
  name: 'rebind_probe_hook',
  state: 'active',
  organizationId: null,
  ...over,
});

describe('ObjectStackProtocolImplementation.onMetadataMutation', () => {
  it('notifies subscribed listeners with the event', () => {
    const p = makeProtocol();
    const seen: MetadataMutationEvent[] = [];
    p.onMetadataMutation((e) => seen.push(e));

    (p as any).emitMetadataMutation(evt());
    (p as any).emitMetadataMutation(evt({ state: 'deleted' }));

    expect(seen.map((e) => e.state)).toEqual(['active', 'deleted']);
    expect(seen[0].type).toBe('hook');
    expect(seen[0].name).toBe('rebind_probe_hook');
  });

  it('returns an unsubscribe function that stops delivery', () => {
    const p = makeProtocol();
    const listener = vi.fn();
    const unsubscribe = p.onMetadataMutation(listener);

    (p as any).emitMetadataMutation(evt());
    unsubscribe();
    (p as any).emitMetadataMutation(evt());

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing listener — remaining listeners still run', () => {
    const p = makeProtocol();
    const after = vi.fn();
    p.onMetadataMutation(() => { throw new Error('boom'); });
    p.onMetadataMutation(after);

    expect(() => (p as any).emitMetadataMutation(evt())).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

// ADR-0094 — the AWAITED per-type projector seam. Unlike the listeners above
// (fire-and-forget), a registered projector runs inside the metadata write and
// its outcome is surfaced as `projectionApplied`. These tests pin the seam's
// contract (dispatch, plural normalization, replace-on-reregister, failure
// isolation); the save/publish/delete invocation points are exercised by the
// plugin-security projection suite against a mock protocol.
describe('ObjectStackProtocolImplementation.registerMutationProjector (ADR-0094)', () => {
  it('runs the registered projector for its type and reports success', async () => {
    const p = makeProtocol();
    const seen: any[] = [];
    p.registerMutationProjector('permission', async (e) => { seen.push(e); });

    const out = await (p as any).runMutationProjector(evt({ type: 'permission', body: { name: 'x' } }));
    expect(out).toEqual({ success: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('permission');
    expect(seen[0].body).toEqual({ name: 'x' });
  });

  it('returns undefined when no projector is registered for the type', async () => {
    const p = makeProtocol();
    p.registerMutationProjector('permission', async () => {});
    expect(await (p as any).runMutationProjector(evt({ type: 'view' }))).toBeUndefined();
  });

  it('normalizes plural type names on registration', async () => {
    const p = makeProtocol();
    const projector = vi.fn(async () => {});
    p.registerMutationProjector('permissions', projector);
    await (p as any).runMutationProjector(evt({ type: 'permission' }));
    expect(projector).toHaveBeenCalledTimes(1);
  });

  it('a second registration replaces the first (idempotent re-init)', async () => {
    const p = makeProtocol();
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    p.registerMutationProjector('permission', first);
    p.registerMutationProjector('permission', second);
    await (p as any).runMutationProjector(evt({ type: 'permission' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a throwing projector is surfaced as { success:false, error }, never thrown', async () => {
    const p = makeProtocol();
    p.registerMutationProjector('permission', async () => { throw new Error('projection boom'); });
    const out = await (p as any).runMutationProjector(evt({ type: 'permission' }));
    expect(out).toEqual({ success: false, error: 'projection boom' });
  });
});

// #3050 — the pre-persistence AUTHORING GATE seam (ADR-0094 addendum). The
// inverse contract of the projector: it runs BEFORE persistence and a throw
// PROPAGATES (rejecting the write) instead of being swallowed. saveMetaItem
// invokes it for env writes only, both draft and publish-mode saves; the
// domain-gate behavior itself (OWD posture) is pinned in plugin-security's
// object-posture-gate suite.
describe('ObjectStackProtocolImplementation.registerAuthoringGate (#3050)', () => {
  const save = (over: Record<string, unknown> = {}) => ({
    type: 'object', name: 'crm_account', state: 'active' as const, body: { sharingModel: 'private' }, ...over,
  });

  it('dispatches the registered gate with the body and state', async () => {
    const p = makeProtocol();
    const seen: any[] = [];
    p.registerAuthoringGate('object', (ctx) => { seen.push(ctx); });
    await (p as any).runAuthoringGate(save({ state: 'draft' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'object', name: 'crm_account', state: 'draft',
      body: { sharingModel: 'private' }, isArtifactBacked: false,
    });
  });

  it('normalizes plural registrations to the singular type', async () => {
    const p = makeProtocol();
    const gate = vi.fn();
    p.registerAuthoringGate('objects', gate);
    await (p as any).runAuthoringGate(save());
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('a gate throw PROPAGATES with its status/code (the write is rejected)', async () => {
    const p = makeProtocol();
    p.registerAuthoringGate('object', () => {
      const err: any = new Error('[owd_widening_forbidden] no widening');
      err.code = 'owd_widening_forbidden'; err.status = 403;
      throw err;
    });
    await expect((p as any).runAuthoringGate(save())).rejects.toMatchObject({
      code: 'owd_widening_forbidden', status: 403,
    });
  });

  it('is a no-op for types with no registered gate', async () => {
    const p = makeProtocol();
    await expect((p as any).runAuthoringGate(save({ type: 'view' }))).resolves.toBeUndefined();
  });

  it('resolves isArtifactBacked + declaredBody from the artifact registry', async () => {
    const declared = { name: 'crm_account', sharingModel: 'private', _packageId: 'crm' };
    const engine = { registry: { getItem: (_t: string, n: string) => (n === 'crm_account' ? declared : undefined) } };
    const p = new ObjectStackProtocolImplementation(engine as any);
    const seen: any[] = [];
    p.registerAuthoringGate('object', (ctx) => { seen.push(ctx); });
    await (p as any).runAuthoringGate(save());
    expect(seen[0].isArtifactBacked).toBe(true);
    expect(seen[0].declaredBody).toBe(declared);
  });

  it('a second registration replaces the first (idempotent re-init)', async () => {
    const p = makeProtocol();
    const first = vi.fn(); const second = vi.fn();
    p.registerAuthoringGate('object', first);
    p.registerAuthoringGate('object', second);
    await (p as any).runAuthoringGate(save());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
