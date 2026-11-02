// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28990] A permission set whose `objects` map grants on an object that does
// not exist is refused at the metadata save door, over the real showcase
// composition and through the REST doors the card measured.
//
// ## What was broken
//
// `PUT /api/v1/meta/permission/NAME` with a grant keyed `qa_no_such_object`
// answered 200 (live save), and the same body through `?mode=draft` then
// publish answered 200 too. The permission evaluator keys a grant by the
// object's name, so the grant applied to nothing; `defineStack` refuses the
// same grant at build (#18202).
//
// ## What these cases pin
//
// The save door refuses it (live and draft), `422 INVALID_METADATA` with the
// finding at `objects.<name>` naming the object, and nothing is stored; a
// rollback to a version granting on an object deleted since is refused the
// same way. Controls: a grant on a showcase object, on a platform object (an
// RBAC link table) and the `'*'` wildcard save live; an object and a set
// granting on it, drafted together in one package, publish in one batch.
// The publish door's refusal of a draft stored before this rule is pinned
// in-process (`packages/metadata-protocol/src/protocol.unknown-grant-object-refusal.test.ts`):
// no door can store such a draft any more.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG = 'app.grantprobe28990';
/** The batch control's own package, so no other case's draft rides in its batch. */
const BATCH_PKG = 'app.grantbatch28990';

const set = (name: string, objectNames: string[], label = 'Grant probe') => ({
  name,
  label,
  objects: Object.fromEntries(objectNames.map((o) => [o, { allowRead: true }])),
});

const object = (name: string) => ({
  name,
  label: 'Grant probe widget',
  sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
});

describe('dogfood: a permission-set grant on an object that does not exist is refused at save (#28990)', () => {
  let stack: VerifyStack;
  let token: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const created = await call('POST', '/packages', {
      manifest: { id: PKG, name: 'Grant probe', version: '0.1.0', type: 'app', namespace: 'grantprobe' },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const batch = await call('POST', '/packages', {
      manifest: { id: BATCH_PKG, name: 'Grant batch probe', version: '0.1.0', type: 'app', namespace: 'grantbatch' },
    });
    expect(batch.status, JSON.stringify(batch.json)).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** The refusal's envelope, wherever the REST door nests it. */
  const expectRefused = (res: { status: number; json: any }, setName: string, objectName: string) => {
    expect(res.status, JSON.stringify(res.json)).toBe(422);
    const wire = JSON.stringify(res.json);
    expect(wire).toContain('INVALID_METADATA');
    expect(wire).toContain(`Permission '${setName}' grants on object '${objectName}' which is not defined in objects`);
    expect(wire).toContain(`"path":"objects.${objectName}"`);
  };

  it('the card: a live save granting on an unknown object is refused, naming it, and nothing is stored', async () => {
    const saved = await call('PUT', '/meta/permission/grantprobe_live', set('grantprobe_live', ['showcase_task', 'qa_no_such_object']));
    expectRefused(saved, 'grantprobe_live', 'qa_no_such_object');
    expect((await call('GET', '/meta/permission/grantprobe_live')).status).toBe(404);
  });

  it('the card: the same body as a draft is refused too, and nothing reaches the drafts', async () => {
    const saved = await call('PUT', `/meta/permission/grantprobe_draft?mode=draft&package=${PKG}`, set('grantprobe_draft', ['qa_no_such_object']));
    expectRefused(saved, 'grantprobe_draft', 'qa_no_such_object');

    const drafts = await call('GET', `/meta/_drafts?packageId=${PKG}`);
    expect(drafts.status, JSON.stringify(drafts.json)).toBe(200);
    expect(JSON.stringify(drafts.json)).not.toContain('grantprobe_draft');
  });

  it.each([
    ['a showcase object', 'showcase_task'],
    ['a platform object (an RBAC link table)', 'sys_user_position'],
    ["the `'*'` wildcard", '*'],
  ])('control: a live save granting on %s saves', async (_label, objectName) => {
    const name = `grantprobe_ok_${objectName === '*' ? 'wildcard' : objectName}`;
    const saved = await call('PUT', `/meta/permission/${name}`, set(name, [objectName]));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  });

  it('control: an object and a set granting on it, drafted in one package, publish in one batch', async () => {
    const obj = await call('PUT', `/meta/object/grantbatch_widget?mode=draft&package=${BATCH_PKG}`, object('grantbatch_widget'));
    expect(obj.status, JSON.stringify(obj.json)).toBe(200);
    const perm = await call('PUT', `/meta/permission/grantbatch_set?mode=draft&package=${BATCH_PKG}`, set('grantbatch_set', ['grantbatch_widget']));
    expect(perm.status, JSON.stringify(perm.json)).toBe(200);

    const published = await call('POST', `/packages/${BATCH_PKG}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    expect(published.json?.data, JSON.stringify(published.json)).toMatchObject({ outcome: 'published', publishedCount: 2 });
  });

  it('a rollback to a version granting on an object deleted since is refused the same way', async () => {
    const obj = await call('PUT', `/meta/object/grantprobe_gone?package=${PKG}`, object('grantprobe_gone'));
    expect(obj.status, JSON.stringify(obj.json)).toBe(200);
    for (const body of [set('grantprobe_restore', ['grantprobe_gone']), set('grantprobe_restore', ['showcase_task'])]) {
      const saved = await call('PUT', `/meta/permission/grantprobe_restore?package=${PKG}`, body);
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    }
    const removed = await call('DELETE', `/meta/object/grantprobe_gone?package=${PKG}`);
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);

    const rollback = await call('POST', '/meta/permission/grantprobe_restore/rollback', { toVersion: 1 });

    expectRefused(rollback, 'grantprobe_restore', 'grantprobe_gone');
    const current = await call('GET', '/meta/permission/grantprobe_restore');
    expect(JSON.stringify(current.json)).not.toContain('grantprobe_gone');
  });
});
