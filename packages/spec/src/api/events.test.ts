import { describe, it, expect } from 'vitest';
import {
  MetadataEventType,
  DataEventType,
  MetadataEventSchema,
  DataEventSchema,
} from './events.zod';

// Coverage added with the v17 dual-source cleanup (#4587): ./api is now the
// SOLE owner of the bare names MetadataEvent(Schema). This vocabulary is the
// live realtime contract — `MetadataManager` publishes
// `metadata.{type}.{created|deleted}` events and the client SDK
// (`@objectstack/client` subscribeMetadata / `@objectstack/client-react`)
// subscribes against exactly these names. The kernel-side lifecycle envelope
// (`metadata.registered/…`) that used to share the names was removed — it had
// no producer and no consumer.

describe('MetadataEventType', () => {
  it('follows the metadata.{type}.{created|updated|deleted} pattern for every member', () => {
    for (const value of MetadataEventType.options) {
      expect(value).toMatch(/^metadata\.[a-z]+\.(created|updated|deleted)$/);
    }
  });

  it('covers the created/updated/deleted triple for each covered metadata type', () => {
    const byType = new Map<string, string[]>();
    for (const value of MetadataEventType.options) {
      const [, metadataType, action] = value.split('.');
      const actions = byType.get(metadataType) ?? [];
      actions.push(action);
      byType.set(metadataType, actions);
    }
    for (const [metadataType, actions] of byType) {
      expect(actions, `actions of metadata.${metadataType}.*`).toEqual([
        'created',
        'updated',
        'deleted',
      ]);
    }
  });

  it('includes the event names the client SDK subscribes to', () => {
    // `RealtimeAPI.subscribeMetadata(type)` filters on exactly these three.
    for (const name of [
      'metadata.object.created',
      'metadata.object.updated',
      'metadata.object.deleted',
    ]) {
      expect(MetadataEventType.options).toContain(name);
    }
  });
});

describe('MetadataEventSchema', () => {
  const base = {
    id: '4b4720e8-97c3-4a12-9b70-b70a3d2314a1',
    type: 'metadata.object.created',
    metadataType: 'object',
    name: 'account',
    timestamp: new Date().toISOString(),
  };

  it('validates a minimal realtime metadata event', () => {
    const event = MetadataEventSchema.parse(base);
    expect(event.type).toBe('metadata.object.created');
    expect(event.name).toBe('account');
  });

  it('accepts the optional payload fields', () => {
    const event = MetadataEventSchema.parse({
      ...base,
      packageId: 'com.acme.crm',
      definition: { label: 'Account' },
      userId: 'usr_1',
    });
    expect(event.packageId).toBe('com.acme.crm');
    expect(event.userId).toBe('usr_1');
  });

  it('rejects event types outside the vocabulary', () => {
    expect(() => MetadataEventSchema.parse({
      ...base,
      // The retired kernel-side lifecycle vocabulary must NOT parse here —
      // it was never produced by anything and is not part of this contract.
      type: 'metadata.registered',
    })).toThrow();
  });

  it('rejects a non-uuid id and a non-datetime timestamp', () => {
    expect(() => MetadataEventSchema.parse({ ...base, id: 'evt-1' })).toThrow();
    expect(() => MetadataEventSchema.parse({ ...base, timestamp: 'yesterday' })).toThrow();
  });
});

describe('DataEventSchema', () => {
  it('validates a data record event', () => {
    const event = DataEventSchema.parse({
      id: '4b4720e8-97c3-4a12-9b70-b70a3d2314a2',
      type: 'data.record.updated',
      object: 'account',
      recordId: 'rec_1',
      changes: { name: 'New Name' },
      timestamp: new Date().toISOString(),
    });
    expect(event.object).toBe('account');
    expect(event.recordId).toBe('rec_1');
  });

  it('rejects types outside the DataEventType vocabulary', () => {
    expect(DataEventType.options).toEqual([
      'data.record.created',
      'data.record.updated',
      'data.record.deleted',
      'data.field.changed',
    ]);
    expect(() => DataEventSchema.parse({
      id: '4b4720e8-97c3-4a12-9b70-b70a3d2314a3',
      type: 'data.record.upserted',
      object: 'account',
      recordId: 'rec_1',
      timestamp: new Date().toISOString(),
    })).toThrow();
  });
});
