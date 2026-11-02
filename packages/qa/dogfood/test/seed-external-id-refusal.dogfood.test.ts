// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28952] A keyed seed whose `externalId` names no field of its object is
// refused at the metadata save door, over the real showcase composition and
// through the REST doors the card measured.
//
// ## What was broken
//
// `PUT /api/v1/meta/seed/:name?mode=draft&package=PKG` with `mode: 'upsert'`
// and `externalId: 'no_such_field'` answered 200, and every
// `POST /api/v1/packages/PKG/publish-drafts` of the unchanged seed answered
// `seedApplied {"success":true,"inserted":1,"updated":0}`: the loader keyed
// every existing row and every incoming record on a field none of them
// carries, so nothing matched and the table gained one identical row per
// publish, with no probe issue and no log line.
//
// ## What these cases pin
//
// The save door refuses it with the envelope it gives every body it judges
// (the unknown-datasource refusal's), `422 INVALID_METADATA` with the finding
// at `externalId` naming the field (`externalId.N` for a composite member), and
// nothing is stored, so `publish-drafts` has nothing of it to publish.
// Controls: the same seed keyed on `name` saves, publishes and converges on
// replay (`inserted: 1`, then `inserted: 0, updated: 0`, one row served); an
// `insert` seed is not judged. The publish door's refusal of a draft stored
// before this rule, and of a seed whose object is drafted in the same batch,
// is pinned in-process
// (`packages/metadata-protocol/src/protocol.seed-external-id-refusal.test.ts`):
// no door can store the first any more.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG = 'app.seedkey28952';

const seed = (externalId: string | string[], mode = 'upsert') => ({
  object: 'seedkey_other',
  mode,
  externalId,
  records: [{ name: 'G1', code: 'g' }],
});

describe('dogfood: a seed whose externalId names no field of its object is refused at save (#28952)', () => {
  let stack: VerifyStack;
  let token: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  /** Publish the package's drafts and answer the receipt. */
  const publish = async () => {
    const res = await call('POST', `/packages/${PKG}/publish-drafts`, {});
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json?.data as { outcome?: string; publishedCount?: number; seedApplied?: { success: boolean; inserted: number; updated: number } };
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const created = await call('POST', '/packages', {
      manifest: { id: PKG, name: 'Seed key probe', version: '0.1.0', type: 'app', namespace: 'seedkey' },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const object = await call('PUT', `/meta/object/seedkey_other?mode=draft&package=${PKG}`, {
      name: 'seedkey_other',
      label: 'Seed key probe',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' }, code: { type: 'text', label: 'Code' } },
    });
    expect(object.status, JSON.stringify(object.json)).toBe(200);
    expect(await publish()).toMatchObject({ outcome: 'published' });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** The refusal's envelope, wherever the REST door nests it. */
  const expectRefused = (res: { status: number; json: any }, path: string, member: string) => {
    expect(res.status, JSON.stringify(res.json)).toBe(422);
    const wire = JSON.stringify(res.json);
    expect(wire).toContain('INVALID_METADATA');
    expect(wire).toContain(`keys on externalId member '${member}', which is not a field of object 'seedkey_other'`);
    expect(wire).toContain(`"path":"${path}"`);
  };

  it('the card: a draft save keyed on a field the object lacks is refused, naming it, and nothing is stored', async () => {
    const saved = await call('PUT', `/meta/seed/r_ghost?mode=draft&package=${PKG}`, seed('no_such_field'));
    expectRefused(saved, 'externalId', 'no_such_field');

    const drafts = await call('GET', `/meta/_drafts?packageId=${PKG}`);
    expect(drafts.status, JSON.stringify(drafts.json)).toBe(200);
    expect(JSON.stringify(drafts.json)).not.toContain('r_ghost');
  });

  it('a composite key with one member the object lacks is refused at that member', async () => {
    const saved = await call('PUT', `/meta/seed/r_pair?mode=draft&package=${PKG}`, seed(['code', 'no_such_field']));
    expectRefused(saved, 'externalId.1', 'no_such_field');
  });

  it('control: the same seed keyed on `name` saves, publishes and converges on replay', async () => {
    expect((await call('PUT', `/meta/seed/r_good?mode=draft&package=${PKG}`, seed('name'))).status).toBe(200);
    expect((await publish())?.seedApplied).toMatchObject({ success: true, inserted: 1, updated: 0 });

    expect((await call('PUT', `/meta/seed/r_good?mode=draft&package=${PKG}`, seed('name'))).status).toBe(200);
    expect((await publish())?.seedApplied).toMatchObject({ success: true, inserted: 0, updated: 0 });

    const listed = await call('GET', '/data/seedkey_other');
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    expect(JSON.stringify(listed.json).match(/"G1"/g) ?? []).toHaveLength(1);
  });

  it('control: an `insert` seed never matches by its key, so it is not judged', async () => {
    const saved = await call('PUT', `/meta/seed/r_insert?mode=draft&package=${PKG}`, seed('no_such_field', 'insert'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  });
});
