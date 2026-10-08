// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21519] A flow's `get_record` node is a reader of the stored-metadata-body
 * family (`sys_metadata` / `sys_metadata_history`: the `metadata` body column
 * and the stored content-hash columns), and it serves that family the way the
 * generic data door does: the body as its type's read projection, with stored
 * credential material withheld, and the content hash in keyed form, under the
 * door's own key.
 *
 * Each case reads the SAME stored row the control reads through the data door
 * (`ObjectStackProtocolImplementation.findData`, the `/data` route's handler),
 * and each answer is judged against that control rather than against a fixed
 * shape:
 *  - no stored credential and no stored hash anywhere in what the node served;
 *  - the row's non-credential configuration present (the projection of THIS
 *    row, not a withheld one);
 *  - the served hash equal to the one the door serves for the same row.
 *
 * Two exits are pinned, under BOTH run identities (`runAs: 'system'`, which
 * reads elevated, and `runAs: 'user'`, which reads as the triggering user):
 *  - the run's declared OUTPUT (the node's `outputVariable`, declared
 *    `isOutput` on the flow), which a flow caller is handed back;
 *  - an ordinary RECORD the same flow writes from what the node read (a
 *    `create_record` that copies the body and the hash), the copy exit: a flow
 *    can copy only what it was served.
 * Both node branches are pinned: one row (`findOne`, no `limit`) and a row
 * list (`find`, `limit > 1`). And the key is pinned twice: with no crypto
 * provider (the process-scoped ephemeral key) and with one registered on the
 * engine (the provider's keyed digest), the node's hash equals the door's.
 *
 * Composition: the real stack the other `*.integration.test.ts` files in this
 * package boot: `ObjectKernel`, `ObjectQLPlugin` (which registers the
 * family's two tables), `driver-sql` on better-sqlite3 `:memory:`, and the
 * real `AutomationServicePlugin`.
 * The stored row is written by the engine as the system identity, with its
 * canonical content hash (`hashSpec`), the shape the metadata save door
 * stores. The credential is a synthetic sentinel in a credential slot the
 * datasource redactor withholds.
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hashSpec } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { AutomationServicePlugin } from '../plugin.js';
import type { AutomationEngine } from '../engine.js';

const SYS = { isSystem: true } as const;
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;

/** The synthetic credential, in the slot the datasource redactor withholds (turso's `encryptionKey`). */
const SENTINEL = 'flow-read-family-sentinel-4d2b';
const DS_NAME = 'pin_flow_ds';
/** Non-credential configuration of the same body: present in a projection of THIS row. */
const DS_URL = 'libsql://pin-flow.example.invalid';
const DS_BODY = { name: DS_NAME, label: 'Pin flow DS', driver: 'turso', config: { url: DS_URL, encryptionKey: SENTINEL } };
const STORED_HASH = hashSpec(DS_BODY);

/** An ordinary object a flow copies what it read into. */
const COPY_OBJECT = {
  name: 'pin_flow_copy',
  label: 'Pin flow copy',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    body: { name: 'body', label: 'Body', type: 'textarea' },
    hash: { name: 'hash', label: 'Hash', type: 'text' },
  },
};

type RunAs = 'system' | 'user';
type Branch = 'one' | 'list';

/**
 * start → get_record(family) → create_record(copy of the body and hash) → end.
 * `one` reads through `findOne` (no limit); `list` through `find` (`limit > 1`),
 * and copies the first row.
 */
function familyReadFlow(name: string, object: string, runAs: RunAs, branch: Branch, fields?: string[]) {
  // A CEL path (#19939 — the `{…}` template dialect is retired from value
  // slots): the list branch reads its first row by index.
  const ref = branch === 'one' ? 'rec' : 'rec[0]';
  return {
    name,
    label: name,
    type: 'autolaunched',
    runAs,
    variables: [{ name: 'rec', type: 'object', isOutput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'read',
        type: 'get_record',
        label: 'Read',
        config: {
          objectName: object,
          filter: { name: DS_NAME },
          outputVariable: 'rec',
          ...(branch === 'list' ? { limit: 5 } : {}),
          ...(fields ? { fields } : {}),
        },
      },
      {
        id: 'copy',
        type: 'create_record',
        label: 'Copy',
        config: {
          objectName: COPY_OBJECT.name,
          fields: {
            title: name,
            body: { dialect: 'cel', source: `${ref}.metadata` },
            hash: { dialect: 'cel', source: `${ref}.checksum` },
          },
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'read' },
      { id: 'e2', source: 'read', target: 'copy' },
      { id: 'e3', source: 'copy', target: 'end' },
    ],
  };
}

/** The trigger a user-identity run needs: a real acting user. */
const TRIGGER = { userId: 'usr_flow_reader', tenantId: 'org_1', positions: [] as string[], permissions: [] as string[] };

describe('flow get_record serves the stored-metadata family the way the data door does (#21519)', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let door: ObjectStackProtocolImplementation;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(COPY_OBJECT as any, 'pin-21519', 'pin-21519');
    await ql.syncSchemas();

    const metadata = JSON.stringify(DS_BODY);
    await ql.insert('sys_metadata', {
      id: 'meta_pin_flow_ds', name: DS_NAME, type: 'datasource', scope: 'platform', state: 'active',
      metadata, checksum: STORED_HASH,
    }, { context: SYS });
    await ql.insert('sys_metadata_history', {
      id: 'hist_pin_flow_ds', name: DS_NAME, type: 'datasource', version: 1, operation_type: 'create',
      metadata, checksum: STORED_HASH, previous_checksum: null,
    }, { context: SYS });

    door = new ObjectStackProtocolImplementation(ql as any);
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  /** The data door's answer for the same row: the control every case is judged against. */
  async function doorRow(object: string): Promise<Record<string, any>> {
    const res: any = await door.findData({ object, query: { name: DS_NAME } });
    expect(res.records, `the data door must serve the ${object} row`).toHaveLength(1);
    return res.records[0];
  }

  /** Run the flow and return its declared output and the record it wrote. */
  async function runFlow(def: ReturnType<typeof familyReadFlow>): Promise<{ output: any; copy: any }> {
    automation.registerFlow(def.name, def as any);
    const res: any = await automation.execute(def.name, { ...TRIGGER });
    expect(res.success, `run failed: ${JSON.stringify(res.error ?? res)}`).toBe(true);
    const copy = await ql.findOne(COPY_OBJECT.name, { where: { title: def.name }, context: SYS });
    expect(copy, 'the flow must have written its copy').toBeTruthy();
    return { output: res.output?.rec, copy };
  }

  /** What the family's rule asks of anything a reader serves or copies. */
  function expectServedLikeTheDoor(served: unknown, door: Record<string, any>, where: string) {
    const text = JSON.stringify(served);
    expect(text.includes(SENTINEL), `${where}: the stored credential reached it`).toBe(false);
    expect(text.includes(STORED_HASH), `${where}: the stored content hash reached it`).toBe(false);
    expect(door.checksum, 'control: the door serves the hash keyed').toMatch(KEYED);
  }

  it('control: the data door serves both tables with the body projected and the hash keyed', async () => {
    for (const object of ['sys_metadata', 'sys_metadata_history']) {
      const row = await doorRow(object);
      const text = JSON.stringify(row);
      expect(text.includes(SENTINEL), `${object}: the door served the stored credential`).toBe(false);
      expect(text.includes(STORED_HASH), `${object}: the door served the stored hash`).toBe(false);
      expect(row.checksum).toMatch(KEYED);
      expect(JSON.parse(row.metadata).config.url).toBe(DS_URL);
    }
  });

  for (const runAs of ['system', 'user'] as const) {
    for (const branch of ['one', 'list'] as const) {
      it(`runAs:'${runAs}', ${branch === 'one' ? 'findOne' : 'find'} branch: the output and the written record carry the projected body and the door's keyed hash`, async () => {
        const control = await doorRow('sys_metadata');
        const { output, copy } = await runFlow(familyReadFlow(`fam_${runAs}_${branch}`, 'sys_metadata', runAs, branch));
        const row = branch === 'one' ? output : output?.[0];
        expect(row, 'the node must have served the row').toBeTruthy();

        expectServedLikeTheDoor(output, control, 'the run output');
        expectServedLikeTheDoor(copy, control, 'the written record');

        // The projection of THIS row: its non-credential configuration is
        // served, and the served body is exactly the door's.
        expect(JSON.parse(row.metadata).config.url).toBe(DS_URL);
        expect(JSON.parse(row.metadata)).toEqual(JSON.parse(control.metadata));
        expect(JSON.parse(copy.body)).toEqual(JSON.parse(control.metadata));
        // One key: the node's hash is the door's keyed hash for the same row.
        expect(row.checksum).toBe(control.checksum);
        expect(copy.hash).toBe(control.checksum);
      });
    }
  }

  it('the history table is served the same way, its parent hash included', async () => {
    const control = await doorRow('sys_metadata_history');
    const { output, copy } = await runFlow(familyReadFlow('fam_history', 'sys_metadata_history', 'system', 'one'));
    expectServedLikeTheDoor(output, control, 'the run output');
    expectServedLikeTheDoor(copy, control, 'the written record');
    expect(output.checksum).toBe(control.checksum);
    expect(output.previous_checksum).toBeNull();
    expect(JSON.parse(output.metadata)).toEqual(JSON.parse(control.metadata));
  });

  // [#22344] The single-row branch names `id` in the projection it hands the
  // engine (its `output.id` is read off the row), so the served row carries the
  // columns named plus `id`; the `type` column the family's projection adds is
  // still taken back off.
  it('a projection naming the body without its type is served projected, with exactly the columns named and the row id', async () => {
    const control = await doorRow('sys_metadata');
    const { output } = await runFlow(familyReadFlow('fam_projection', 'sys_metadata', 'system', 'one', ['name', 'metadata', 'checksum']));
    expectServedLikeTheDoor(output, control, 'the run output');
    expect(Object.keys(output).sort()).toEqual(['checksum', 'id', 'metadata', 'name']);
    expect(output.id).toBe('meta_pin_flow_ds');
    expect(JSON.parse(output.metadata)).toEqual(JSON.parse(control.metadata));
    expect(output.checksum).toBe(control.checksum);
  });

  it("with a crypto provider registered on the engine, the node serves the provider's keyed digest, as the door does", async () => {
    const keyedDigest = async (plain: string): Promise<string> =>
      `hmac-sha256:${createHmac('sha256', 'pin-21519-provider-key').update(plain, 'utf8').digest('hex')}`;
    ql.setCryptoProvider({ keyedDigest } as any);
    const control = await doorRow('sys_metadata');
    expect(control.checksum, 'control: the door serves the provider digest').toBe(await keyedDigest(STORED_HASH));
    const { output, copy } = await runFlow(familyReadFlow('fam_provider', 'sys_metadata', 'user', 'one'));
    expectServedLikeTheDoor(output, control, 'the run output');
    expect(output.checksum).toBe(control.checksum);
    expect(copy.hash).toBe(control.checksum);
  });

  it('an ordinary object is read and copied exactly as stored', async () => {
    await ql.insert(COPY_OBJECT.name, { title: 'plain_source', body: SENTINEL, hash: STORED_HASH }, { context: SYS });
    const def = {
      name: 'plain_read', label: 'plain_read', type: 'autolaunched', runAs: 'system',
      variables: [{ name: 'rec', type: 'object', isOutput: true }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: COPY_OBJECT.name, filter: { title: 'plain_source' }, outputVariable: 'rec' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'read' }, { id: 'e2', source: 'read', target: 'end' }],
    };
    automation.registerFlow(def.name, def as any);
    const res: any = await automation.execute(def.name, { ...TRIGGER });
    expect(res.success).toBe(true);
    expect(res.output.rec.body).toBe(SENTINEL);
    expect(res.output.rec.hash).toBe(STORED_HASH);
  });
});
