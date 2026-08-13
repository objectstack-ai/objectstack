// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4602 — MetadataManager publishes TRUE `MetadataEvent`s (contract-first).
 *
 * `@objectstack/spec/api`'s `MetadataEvent` is the single declared contract
 * for realtime metadata changes. Before this fix the producer published a
 * bare `RealtimeEventPayload` envelope with `metadataType`/`name`/`definition`
 * nested under `payload` and never generated `id`/`userId` — so every
 * subscriber that wrote `event.name` (as the types promised) read `undefined`
 * at runtime.
 *
 * These tests pin the producer half of the contract:
 *  - the transport envelope's `payload` IS a schema-valid `MetadataEvent`
 *    (top-level `id` uuid, `type`, `metadataType`, `name`, `definition`,
 *    `timestamp`);
 *  - a register() overwrite publishes `.updated` (mirroring the
 *    'added'/'changed' watcher split);
 *  - `userId` is carried when the write declares an actor;
 *  - a metadata type outside the closed `MetadataEventType` enum publishes
 *    NOTHING (no off-contract event a compliant consumer must reject).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataEventSchema } from '@objectstack/spec/api';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { MetadataManager } from './metadata-manager';
import { MemoryLoader } from './loaders/memory-loader';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('#4602 — register()/unregister() publish true MetadataEvents', () => {
  let manager: MetadataManager;
  let published: RealtimeEventPayload[];
  let realtime: IRealtimeService;

  beforeEach(() => {
    published = [];
    realtime = {
      publish: vi.fn(async (event: RealtimeEventPayload) => {
        published.push(event);
      }),
      subscribe: vi.fn(async () => 'sub-1'),
      unsubscribe: vi.fn(async () => undefined),
    };
    manager = new MetadataManager({
      formats: ['json'],
      loaders: [new MemoryLoader()],
    });
    manager.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);
    manager.setRealtimeService(realtime);
  });

  it('register() publishes an envelope whose payload IS a schema-valid MetadataEvent', async () => {
    await manager.register('object', 'account', {
      name: 'account',
      label: 'Account',
      packageId: 'com.acme.crm',
    });

    expect(published).toHaveLength(1);
    const envelope = published[0];

    // Transport envelope keeps its shape (nothing else changes on the wire).
    expect(envelope.type).toBe('metadata.object.created');
    expect(envelope.object).toBe('object');
    expect(typeof envelope.timestamp).toBe('string');

    // The payload is the full MetadataEvent — parse with the SPEC schema, not
    // a hand-rolled shape, so this pin fails the moment either side drifts.
    const event = MetadataEventSchema.parse(envelope.payload);
    expect(event.id).toMatch(UUID_RE);
    expect(event.type).toBe('metadata.object.created');
    expect(event.metadataType).toBe('object');
    expect(event.name).toBe('account');
    expect(event.packageId).toBe('com.acme.crm');
    expect(event.definition).toEqual({
      name: 'account',
      label: 'Account',
      packageId: 'com.acme.crm',
    });
    expect(event.timestamp).toBe(envelope.timestamp);
  });

  it('register() overwrite publishes .updated, not a second .created', async () => {
    await manager.register('object', 'account', { name: 'account', label: 'V1' });
    await manager.register('object', 'account', { name: 'account', label: 'V2' });

    expect(published.map((e) => e.type)).toEqual([
      'metadata.object.created',
      'metadata.object.updated',
    ]);
    const updated = MetadataEventSchema.parse(published[1].payload);
    expect(updated.type).toBe('metadata.object.updated');
    expect(updated.definition).toEqual({ name: 'account', label: 'V2' });
  });

  it('unregister() publishes a schema-valid .deleted event without a definition', async () => {
    await manager.register('object', 'account', { name: 'account' });
    published.length = 0;

    await manager.unregister('object', 'account');

    expect(published).toHaveLength(1);
    const event = MetadataEventSchema.parse(published[0].payload);
    expect(event.type).toBe('metadata.object.deleted');
    expect(event.metadataType).toBe('object');
    expect(event.name).toBe('account');
    expect(event.id).toMatch(UUID_RE);
    expect(event.definition).toBeUndefined();
  });

  it('carries userId when the write declares an actor (MetadataWriteOptions.userId)', async () => {
    await manager.register(
      'view',
      'account_grid',
      { name: 'account_grid' },
      { userId: 'usr_123' },
    );
    await manager.unregister('view', 'account_grid', { userId: 'usr_456' });

    const created = MetadataEventSchema.parse(published[0].payload);
    const deleted = MetadataEventSchema.parse(published[1].payload);
    expect(created.userId).toBe('usr_123');
    expect(deleted.userId).toBe('usr_456');
  });

  it('omits userId for system-initiated writes (no actor known)', async () => {
    await manager.register('view', 'account_grid', { name: 'account_grid' });
    const event = MetadataEventSchema.parse(published[0].payload);
    expect(event.userId).toBeUndefined();
  });

  it('publishes NOTHING for a type outside the closed MetadataEventType enum', async () => {
    // 'translation' is registrable metadata but has no declared realtime
    // event type. Producing `metadata.translation.created` would be an event
    // every compliant consumer (MetadataEventSchema.parse at the client
    // boundary) must reject — declared = enforced means we don't emit it.
    await manager.register('translation', 'zh_cn', { name: 'zh_cn' });
    await manager.unregister('translation', 'zh_cn');

    expect(published).toHaveLength(0);
  });

  it('omits a non-string packageId instead of publishing an invalid event', async () => {
    await manager.register('object', 'account', {
      name: 'account',
      packageId: 42 as unknown as string,
    });

    expect(published).toHaveLength(1);
    const event = MetadataEventSchema.parse(published[0].payload);
    expect(event.packageId).toBeUndefined();
  });

  it('event ids are unique per event', async () => {
    await manager.register('object', 'a', { name: 'a' });
    await manager.register('object', 'b', { name: 'b' });

    const ids = published.map((e) => MetadataEventSchema.parse(e.payload).id);
    expect(new Set(ids).size).toBe(2);
  });

  it('a publish failure never fails the write itself', async () => {
    (realtime.publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('transport down'),
    );

    await expect(
      manager.register('object', 'account', { name: 'account' }),
    ).resolves.toBeUndefined();
    expect(await manager.get('object', 'account')).toEqual({ name: 'account' });
  });
});
