// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SYS_ACTIVITY_PLATFORM_TYPES } from '@objectstack/spec/data';
import {
  PLATFORM_ACTIVITY_METADATA_KEYS,
  appActivityEntryRefusal,
  createAppActivityWriter,
  type AppActivityEntry,
} from './app-activity-door.js';
import { ACTIVITY_FEED_EXCLUDED_OBJECTS } from './objects/sys-activity.object.js';

const entry: AppActivityEntry = { object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'Email: Quote' };
const noSchema = () => undefined;

describe('an app adds only its own kind of timeline entry', () => {
  it('takes an entry of an app type about an ordinary record', () => {
    expect(appActivityEntryRefusal(entry, noSchema)).toBeUndefined();
  });

  for (const type of SYS_ACTIVITY_PLATFORM_TYPES) {
    it(`refuses the platform-only type '${type}'`, () => {
      expect(appActivityEntryRefusal({ ...entry, type }, noSchema)).toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    });
  }

  for (const key of PLATFORM_ACTIVITY_METADATA_KEYS) {
    it(`refuses the platform metadata key '${key}'`, () => {
      expect(appActivityEntryRefusal({ ...entry, metadata: { [key]: 'x' } }, noSchema)).toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    });
  }

  it('refuses an entry about an object the feed does not show, or about an append-only ledger', () => {
    expect(appActivityEntryRefusal({ ...entry, object: ACTIVITY_FEED_EXCLUDED_OBJECTS[0] }, noSchema)).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(
      appActivityEntryRefusal({ ...entry, object: 'crm_ledger' }, (o) => (o === 'crm_ledger' ? { managedBy: 'append-only' } : undefined)),
    ).toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

function fakeEngine(fields: string[]) {
  const inserts: Array<{ object: string; row: Record<string, unknown>; options: any }> = [];
  const engine = {
    getSchema: (object: string) => (object === 'sys_activity' ? { fields: Object.fromEntries(fields.map((f) => [f, {}])) } : { fields: {} }),
    createContext: (context: unknown) => ({ context }),
    insert: async (object: string, row: Record<string, unknown>, options: unknown) => {
      inserts.push({ object, row, options });
      return { id: 'act_1' };
    },
  };
  return { engine, inserts };
}

describe('the activity door writes the actor, organization and origin the platform stamps', () => {
  const columns = ['type', 'summary', 'actor_id', 'origin', 'organization_id', 'metadata'];
  const snapshot = async () => ({ name: 'Ann Lee', avatarUrl: 'https://img.test/ann.png' });

  it('writes the stamped actor (with the platform snapshot), organization and origin', async () => {
    const { engine, inserts } = fakeEngine(columns);
    const writer = createAppActivityWriter({ getEngine: () => engine as any, getActorSnapshot: () => snapshot });
    const out = await writer.appendAppActivity(
      { ...entry, metadata: { kind: 'email' }, source: { object: 'sys_email', id: 'e1' } },
      { actorId: 'usr_ann', organizationId: 'org_acme', origin: 'com.acme.crm/action:send_quote' },
    );
    expect(out).toEqual({ id: 'act_1' });
    expect(inserts).toHaveLength(1);
    const { object, row, options } = inserts[0];
    expect(object).toBe('sys_activity');
    expect(row).toMatchObject({
      type: 'completed',
      summary: 'Email: Quote',
      actor_id: 'usr_ann',
      actor_name: 'Ann Lee',
      actor_avatar_url: 'https://img.test/ann.png',
      object_name: 'crm_contact',
      record_id: 'c1',
      source_object: 'sys_email',
      source_id: 'e1',
      metadata: JSON.stringify({ kind: 'email' }),
      origin: 'com.acme.crm/action:send_quote',
      organization_id: 'org_acme',
    });
    expect(options.context).toEqual({ isSystem: true, tenantId: 'org_acme' });
  });

  it('writes an entry with no user with an empty actor', async () => {
    const { engine, inserts } = fakeEngine(columns);
    const writer = createAppActivityWriter({ getEngine: () => engine as any, getActorSnapshot: () => snapshot });
    await writer.appendAppActivity(entry, { actorId: undefined, organizationId: 'org_acme', origin: 'p/job:nightly' });
    expect(inserts[0].row.actor_id).toBeNull();
    expect(inserts[0].row).not.toHaveProperty('actor_name');
  });

  it('refuses an entry with no organization where the feed is organization-scoped, and writes nothing', async () => {
    const { engine, inserts } = fakeEngine(columns);
    const writer = createAppActivityWriter({ getEngine: () => engine as any, getActorSnapshot: () => snapshot });
    await expect(
      writer.appendAppActivity(entry, { actorId: 'usr_ann', organizationId: undefined, origin: 'p/hook:h' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(inserts).toHaveLength(0);
  });

  it('writes nothing for a refused entry', async () => {
    const { engine, inserts } = fakeEngine(columns);
    const writer = createAppActivityWriter({ getEngine: () => engine as any, getActorSnapshot: () => snapshot });
    await expect(
      writer.appendAppActivity({ ...entry, type: 'updated' }, { actorId: 'usr_ann', organizationId: 'org_acme', origin: 'p/hook:h' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(inserts).toHaveLength(0);
  });
});
