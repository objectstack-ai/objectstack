import { describe, it, expect } from 'vitest';
import {
  MetadataEventType,
  DataEventType,
  MetadataEventSchema,
  DataEventSchema,
  type MetadataEventSubject,
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

// ===========================================================================
// MetadataEventSubject — the `{type}` half, derived rather than restated (#4627)
// ===========================================================================
//
// `@objectstack/client`'s `subscribeMetadata(type)` and the `client-react`
// hooks that delegate to it take THIS type. Its whole value is that it cannot
// disagree with the enum above, so the pins below are split in two on purpose:
//
//  - the tsc-resolved ones prove the DERIVATION is faithful (nothing lost,
//    nothing invented, and the split recomposes back to the enum exactly);
//  - the vitest-run one binds the hand-written list of 13 names to the enum's
//    runtime data, so a member added to `MetadataEventType` cannot leave the
//    type pins asserting a stale vocabulary while still passing.
//
// This file carries no entry in `test-typecheck-debt.json`, which is what makes
// "zero tsc errors" the baseline the type-level pins move away from. The
// `expect()` calls only give the type assertions a home vitest will run.

describe('MetadataEventSubject', () => {
  /** The 13 metadata types that have a realtime event contract today. */
  const COVERED = [
    'object', 'field', 'view', 'app', 'agent', 'tool', 'flow',
    'action', 'workflow', 'dashboard', 'report', 'role', 'permission',
  ] as const;

  type Covered = (typeof COVERED)[number];

  it('is exactly the {type} segment of every member — no more, no less', () => {
    // Two directions, because one is not exactness. The `extends Covered`
    // direction alone would pass VACUOUSLY if the derivation ever collapsed to
    // `never` (`never extends X` is true for any X) — the phantom this pin
    // would otherwise be. The `Covered extends …` direction is what catches
    // that collapse, and also catches a member silently dropped from the enum.
    type NoStrangers = MetadataEventSubject extends Covered ? 'exact' : never;
    type NoneMissing = Covered extends MetadataEventSubject ? 'exact' : never;
    const both: [NoStrangers, NoneMissing] = ['exact', 'exact'];
    expect(both).toEqual(['exact', 'exact']);
  });

  it('recomposes to MetadataEventType exactly, so the 13 x 3 grid stays full', () => {
    // The type-level twin of the runtime "created/updated/deleted triple"
    // assertion above, and the reason a partial extension cannot land quietly:
    // adding only `metadata.translation.created` makes this recomposition
    // produce `metadata.translation.updated` — a name the enum does not have —
    // and the first line below resolves to `never`.
    type Recomposed = `metadata.${MetadataEventSubject}.${'created' | 'updated' | 'deleted'}`;
    type NoStrangers = Recomposed extends MetadataEventType ? 'exact' : never;
    type NoneMissing = MetadataEventType extends Recomposed ? 'exact' : never;
    const both: [NoStrangers, NoneMissing] = ['exact', 'exact'];
    expect(both).toEqual(['exact', 'exact']);
  });

  it('does not admit registrable metadata types that have no event contract', () => {
    // These are all real `DEFAULT_METADATA_TYPE_REGISTRY` types. #4602 pinned
    // that the producer publishes NOTHING for them; this pins that a consumer
    // cannot claim to subscribe to them either. Wrapped in tuples so the check
    // is "this literal is not in the union", not a distributed one.
    type Rejects<T extends string> = [T] extends [MetadataEventSubject] ? never : 'rejected';
    const offContract: [
      Rejects<'translation'>,
      Rejects<'datasource'>,
      Rejects<'page'>,
      Rejects<'hook'>,
      Rejects<'trigger'>,
      Rejects<'validation'>,
    ] = ['rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected'];
    expect(offContract).toHaveLength(6);

    // Widening the enum to cover them is axis 2 of #4627 — a product question
    // about which types deserve a realtime event, deliberately left open. When
    // one is answered (e.g. #4426 putting `translation` in play), the enum
    // gains its three names, this list loses an entry, and both sides of the
    // wire move together because neither side restates the vocabulary.
  });

  it('is derived from the enum, not restated beside it', () => {
    // The runtime half of the pin: COVERED above is hand-written, so this is
    // what stops the type-level assertions from certifying a stale list. A
    // member added to `MetadataEventType` fails HERE first, by name.
    const subjects = [...new Set(MetadataEventType.options.map((v) => v.split('.')[1]))];
    expect(subjects).toEqual([...COVERED]);
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
    ]);
    expect(() => DataEventSchema.parse({
      id: '4b4720e8-97c3-4a12-9b70-b70a3d2314a3',
      type: 'data.record.upserted',
      object: 'account',
      recordId: 'rec_1',
      timestamp: new Date().toISOString(),
    })).toThrow();
  });

  // #4673 (ADR-0049 enforce-or-remove): `data.field.changed` was declared here
  // with no producer anywhere in the repo. It is gone, and the enum is the only
  // channel that can say so — an enum member cannot carry a retiredKey()
  // fix-it prescription the way an authorable object key can.
  it('no longer accepts the retired data.field.changed event name', () => {
    expect(DataEventType.options).not.toContain('data.field.changed');
    expect(() => DataEventSchema.parse({
      id: '4b4720e8-97c3-4a12-9b70-b70a3d2314a4',
      type: 'data.field.changed',
      object: 'account',
      recordId: 'rec_1',
      timestamp: new Date().toISOString(),
    })).toThrow();
  });

  // The replacement is not a different event name — it is the payload the live
  // record event already carries. This pins that FROM → TO so the changeset's
  // one-line fix stays true.
  it('carries per-field detail on data.record.updated via changes/before/after', () => {
    const event = DataEventSchema.parse({
      id: '4b4720e8-97c3-4a12-9b70-b70a3d2314a5',
      type: 'data.record.updated',
      object: 'account',
      recordId: 'rec_1',
      changes: { name: 'New Name' },
      before: { name: 'Old Name' },
      after: { name: 'New Name' },
      timestamp: new Date().toISOString(),
    });
    expect(event.changes).toEqual({ name: 'New Name' });
    expect(event.before).toEqual({ name: 'Old Name' });
    expect(event.after).toEqual({ name: 'New Name' });
  });
});
