// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26724] An object whose `datasource` names a datasource that does not exist
// is refused at the metadata save door, over the real showcase composition and
// through the REST doors the card measured.
//
// ## What was broken
//
// `PUT /api/v1/meta/object/:name?mode=draft&package=PKG` with
// `datasource: 'gapdata_nosuch'` answered 200, and `publish-drafts` answered
// `outcome: 'published'`. The engine routes an explicit `datasource` to the
// driver of that name only, so the object never registered: every
// `/api/v1/data/:object` call answered 404 "not registered", and nothing told
// the author why.
//
// ## What these cases pin
//
// The save door refuses it (draft and live), `422 INVALID_METADATA` with the
// finding at `datasource` naming the datasource, and nothing is stored, so
// `publish-drafts` has nothing of it to publish. Controls, each saved as a
// draft, published with `publish-drafts` and then served through
// `/api/v1/data`: an object with no `datasource`; one bound to a driver a
// plugin registers at run time under a name no datasource item declares; and
// one bound to a datasource drafted in the same package and published in the
// same batch. The publish door's own refusal of a draft stored before this
// rule is pinned in-process
// (`packages/metadata-protocol/src/protocol.unknown-datasource-refusal.test.ts`):
// no door can store such a draft any more.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG = 'app.dsprobe26724';
/** A driver registered at run time under this name, with no datasource item. */
const RUNTIME_DRIVER = 'dsprobe_rt_store';

/**
 * Registers an in-memory SQL driver as a `driver.*` service — the run-time
 * registration ObjectQL discovers at start — named so an object can bind it.
 */
const runtimeDriverPlugin = {
  name: 'dogfood.runtime-driver-26724',
  version: '0.0.0',
  init: async (ctx: { registerService: (name: string, service: unknown) => void }) => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as unknown as { name: string }).name = RUNTIME_DRIVER;
    ctx.registerService(`driver.${RUNTIME_DRIVER}`, driver);
  },
};

const object = (name: string, datasource?: string) => ({
  name,
  label: 'Bad DS',
  sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
  ...(datasource !== undefined ? { datasource } : {}),
});

describe('dogfood: an object bound to a datasource that does not exist is refused at save (#26724)', () => {
  let stack: VerifyStack;
  let token: string;
  let dir: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-26724-'));
    stack = await bootShowcase({ extraPlugins: [runtimeDriverPlugin] });
    token = await stack.signIn();
    const created = await call('POST', '/packages', {
      manifest: { id: PKG, name: 'Datasource probe', version: '0.1.0', type: 'app', namespace: 'dsprobe' },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** The refusal's envelope, wherever the REST door nests it. */
  const expectRefused = (res: { status: number; json: any }, objectName: string, datasource: string) => {
    expect(res.status, JSON.stringify(res.json)).toBe(422);
    const wire = JSON.stringify(res.json);
    expect(wire).toContain('INVALID_METADATA');
    expect(wire).toContain(`Object '${objectName}' names datasource '${datasource}', and no datasource of that name exists here`);
    expect(wire).toContain('"path":"datasource"');
  };

  /** Publish the package's drafts and answer the receipt's outcome. */
  const publish = async () => {
    const res = await call('POST', `/packages/${PKG}/publish-drafts`, {});
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json?.data as { outcome?: string; publishedCount?: number; failed?: unknown[] };
  };

  /** A record created and read back through the data door. */
  const expectServesData = async (objectName: string) => {
    const created = await call('POST', `/data/${objectName}`, { name: `row of ${objectName}` });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const listed = await call('GET', `/data/${objectName}`);
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    expect(JSON.stringify(listed.json)).toContain(`row of ${objectName}`);
  };

  it('the card: a draft save naming an unknown datasource is refused, naming it, and nothing is stored', async () => {
    const saved = await call('PUT', `/meta/object/dsprobe_badds?mode=draft&package=${PKG}`, object('dsprobe_badds', 'dsprobe_nosuch'));
    expectRefused(saved, 'dsprobe_badds', 'dsprobe_nosuch');

    const drafts = await call('GET', `/meta/_drafts?packageId=${PKG}`);
    expect(drafts.status, JSON.stringify(drafts.json)).toBe(200);
    expect(JSON.stringify(drafts.json)).not.toContain('dsprobe_badds');
  });

  it('a live save naming an unknown datasource is refused the same way', async () => {
    const saved = await call('PUT', `/meta/object/dsprobe_badds2?package=${PKG}`, object('dsprobe_badds2', 'nope_ds_2'));
    expectRefused(saved, 'dsprobe_badds2', 'nope_ds_2');
    expect((await call('POST', '/data/dsprobe_badds2', { name: 'x' })).status).toBe(404);
  });

  it('control: an object with no `datasource` saves, publishes and serves data', async () => {
    expect((await call('PUT', `/meta/object/dsprobe_plain?mode=draft&package=${PKG}`, object('dsprobe_plain'))).status).toBe(200);
    expect(await publish()).toMatchObject({ outcome: 'published' });
    await expectServesData('dsprobe_plain');
  });

  it('control: an object bound to a driver registered at run time saves, publishes and serves data', async () => {
    const saved = await call('PUT', `/meta/object/dsprobe_rt_item?mode=draft&package=${PKG}`, object('dsprobe_rt_item', RUNTIME_DRIVER));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(await publish()).toMatchObject({ outcome: 'published' });
    await expectServesData('dsprobe_rt_item');
  });

  it('control: an object bound to a datasource drafted in the same package publishes in the same batch and serves data', async () => {
    const ds = await call('PUT', `/meta/datasource/dsprobe_lake?mode=draft&package=${PKG}`, {
      name: 'dsprobe_lake', label: 'Lake', driver: 'sqlite', config: { filename: join(dir, 'lake.db') },
    });
    expect(ds.status, JSON.stringify(ds.json)).toBe(200);
    const saved = await call('PUT', `/meta/object/dsprobe_lake_item?mode=draft&package=${PKG}`, object('dsprobe_lake_item', 'dsprobe_lake'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(await publish()).toMatchObject({ outcome: 'published', publishedCount: 2 });
    await expectServesData('dsprobe_lake_item');
  });
});
