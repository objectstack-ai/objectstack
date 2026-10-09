// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22211 ruling A, #22387] The `viewer` block `ApprovalService` serves is the
 * block `sys_approval_request` declares under `attachedOnRead`.
 *
 * The declaration's second reader (ADR-0049: a declaration has a reader from
 * landing day). The shared build validator reads the declared leaf NAMES to
 * judge the object's action predicates; nothing there reads the declared leaf
 * TYPES. This file reads both: for every caller shape `attachViewers` serves,
 * through both doors that call it (`listRequests` and `getRequest`), the keys
 * of the served `viewer` equal the declared leaves, and each served value's
 * runtime type is the type its leaf declares.
 *
 * The expected set is read from the object, never written here: a leaf the
 * service starts emitting without a declaration, a leaf declared that the
 * service never emits, or a value of another type is red with no edit to
 * this file.
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the package's own
 * object definitions registered: no engine double stands between the service
 * and the rows it decorates.
 *
 * Each caller shape is held to being the shape it names, by the one leaf that
 * marks it (or by none, for the caller who holds no capability), and the
 * battery as a whole must observe both values of every boolean leaf, so a
 * type check that only ever saw `false` cannot pass for conformance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ServiceObject } from '@objectstack/spec/data';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';

/** The value types a read-attachment leaf may declare (the spec's closed set). */
type LeafType = NonNullable<ServiceObject['attachedOnRead']>[string][string];

/**
 * The runtime test for each declared value type. Typed against the spec's
 * vocabulary, so a fifth type added there fails to compile here until it has
 * a test of its own.
 */
const HOLDS: Record<LeafType, (value: unknown) => boolean> = {
  boolean: (v) => typeof v === 'boolean',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  text: (v) => typeof v === 'string',
  date: (v) => (v instanceof Date && !Number.isNaN(v.getTime()))
    || (typeof v === 'string' && !Number.isNaN(Date.parse(v))),
};

/** The block under test, read from the object the plugin ships. */
const DECLARED: Readonly<Record<string, LeafType>> = SysApprovalRequest.attachedOnRead?.viewer ?? {};

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string, permissions: string[] = []) =>
  ({ userId, positions: [], permissions }) as any;

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

/** The plugin's own object definitions, as its manifest registers them. */
async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

/**
 * A caller shape `attachViewers` serves: who is reading, which request, and
 * the one declared leaf that marks the shape (`null` — the caller who reads
 * the request but holds none of the three capabilities).
 */
interface Shape {
  label: string;
  context: () => any;
  request: () => string;
  marks: string | null;
}

describe('sys_approval_request — the served viewer block conforms to attachedOnRead.viewer', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  const ids: Record<string, string> = {};
  let now = Date.parse('2026-10-09T09:00:00.000Z');

  const SHAPES: Shape[] = [
    { label: 'the submitter, on a pending request', context: () => asUser('u_sub'), request: () => ids.pending, marks: 'is_submitter' },
    { label: 'a current pending approver', context: () => asUser('u_app'), request: () => ids.pending, marks: 'can_act' },
    {
      label: 'an override actor (platform admin), on a pending request',
      context: () => asUser('u_root', [ADMIN_FULL_ACCESS]),
      request: () => ids.pending,
      marks: 'can_override',
    },
    { label: 'a system context, on a pending request', context: () => SYSTEM, request: () => ids.pending, marks: 'can_override' },
    { label: 'the approver who decided, on the finalized request', context: () => asUser('u_app'), request: () => ids.decided, marks: null },
  ];

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, deal, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    for (const id of ['u_sub', 'u_app', 'u_root']) {
      await engine.insert('sys_user', { id, name: id, email: `${id}@example.com` }, { context: SYSTEM } as any);
    }
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      automation: {
        resume: async () => ({ status: 'completed' }),
        cancelRun: async () => undefined,
        getRun: async (runId: string) => ({ id: runId, status: 'paused' }),
        getFlow: async () => ({ name: 'deal_review', nodes: [{ id: 'review', type: 'approval' }], edges: [] }),
      } as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    const open = async (key: string) => {
      await engine.insert('crm_deal', { id: `D_${key}`, title: key }, { context: SYSTEM } as any);
      const row: any = await svc.openNodeRequest({
        object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName: 'deal_review',
        config: { approvers: [{ type: 'user', value: 'u_app' }], behavior: 'first_response' } as any,
        submitterId: 'u_sub', record: { id: `D_${key}`, title: key },
      }, asUser('u_sub'));
      ids[key] = row.id;
    };
    await open('pending');
    await open('decided');
    await svc.decideNode(ids.decided, { decision: 'approve' } as any, asUser('u_app'));
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the object declares the block this battery reads', () => {
    // The battery below compares against DECLARED; an empty declaration would
    // make every key comparison trivially about nothing.
    expect(Object.keys(DECLARED).length).toBeGreaterThan(0);
  });

  /** Both doors that attach the block, for one caller shape. */
  async function served(shape: Shape): Promise<Array<{ door: string; viewer: unknown }>> {
    const id = shape.request();
    const one = await svc.getRequest(id, shape.context());
    const listed = (await svc.listRequests({ object: 'crm_deal' }, shape.context())).find((r) => r.id === id);
    expect(one, `${shape.label}: getRequest serves the request`).not.toBeNull();
    expect(listed, `${shape.label}: listRequests serves the request`).toBeDefined();
    return [
      { door: 'getRequest', viewer: (one as any)?.viewer },
      { door: 'listRequests', viewer: (listed as any)?.viewer },
    ];
  }

  it.each(SHAPES)('$label: the served keys are the declared leaves, each value of its declared type', async (shape) => {
    for (const { door, viewer } of await served(shape)) {
      const where = `${shape.label} via ${door}`;
      expect(viewer, `${where}: a viewer block is attached`).toBeTypeOf('object');
      const block = viewer as Record<string, unknown>;
      expect(Object.keys(block).sort(), `${where}: emitted keys`).toEqual(Object.keys(DECLARED).sort());
      for (const [leaf, type] of Object.entries(DECLARED)) {
        expect(HOLDS[type](block[leaf]), `${where}: \`${leaf}\` declared ${type}, served ${JSON.stringify(block[leaf])}`)
          .toBe(true);
      }
      // The shape is the shape it names: its marking leaf is the only true one.
      for (const leaf of Object.keys(DECLARED)) {
        expect(block[leaf], `${where}: \`${leaf}\``).toBe(leaf === shape.marks);
      }
    }
  });

  it('the battery observes both values of every boolean leaf (the type check is not vacuous)', async () => {
    const seen = new Map<string, Set<unknown>>();
    for (const shape of SHAPES) {
      for (const { viewer } of await served(shape)) {
        for (const [leaf, value] of Object.entries(viewer as Record<string, unknown>)) {
          if (!seen.has(leaf)) seen.set(leaf, new Set());
          seen.get(leaf)!.add(value);
        }
      }
    }
    for (const [leaf, type] of Object.entries(DECLARED)) {
      if (type !== 'boolean') continue;
      expect([...(seen.get(leaf) ?? [])].sort(), `\`${leaf}\` across the battery`).toEqual([false, true]);
    }
  });
});
