// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6710 — the assembly-wiring pin for the declared authoring channel.
 *
 * `metadata-protocol`'s `protocol.runtime-authoring-gate.test.ts` owns the
 * POSTURE matrix (which channel gates which write). This file owns the other
 * half, which that package structurally cannot test: **that a real kernel boot
 * actually threads the declaration from the plugin option down to the protocol
 * instance** — `metadata-protocol` must not depend on `objectql`, even as a
 * devDependency, because turbo rejects the cycle (the same reason
 * `plugin.step2.test.ts` lives here).
 *
 * The defect being pinned, measured at boot level on `origin/main` @ `68feaadd6`
 * before the fix: `new ObjectQLPlugin()` — literally what
 * `packages/cli/src/commands/serve.ts`'s `config.objects && !hasObjectQL`
 * auto-register branch constructs — assembles a protocol with
 * `environmentId === undefined`, which the #4463 gate read as "the package
 * author's own bootstrap channel" and skipped. That topology is the flagship
 * showcase's own boot shape (`isHostConfig` → `shouldBootWithLibrary === false`),
 * and its `PUT /api/v1/meta/*` is an END-USER surface, so all 26 shared
 * `AUTHORING_RULES` ran on nothing. The probe verdict was:
 *
 *   environmentId : undefined
 *   PUT /meta     : THROWN "[ObjectQL] No driver available for object 'sys_metadata'"
 *   GATE FIRED?   : false
 *
 * — the throw coming from the ENGINE's persistence layer, i.e. execution had
 * already run past the gate. That is why the first test below asserts the
 * `code`/`status` envelope and not merely that something threw: on this exact
 * topology the unfixed build throws too, just from the wrong place and with
 * neither field set.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { createMetadataProtocolPlugin } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin';

/** #4463's own measured body: Zod-valid, `os lint`-rejected since #4409. */
const brokenApprovalFlow = () => ({
  name: 'leave_approval',
  label: 'Leave Approval',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'approve',
      type: 'approval',
      label: 'Approve',
      config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
    },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'approve' }],
});

/**
 * A driver just real enough that a write which PASSES the gate lands somewhere
 * observable — so "allowed" is proved by a stored row rather than by the
 * absence of one particular exception.
 */
function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
  // driver ANDs them. The short-circuiting shape this stub used to carry
  // (`if ($or) return $or.some(...)`) discarded every sibling equality key in
  // the same object, so a query like
  // `{ state:'draft', package_id, $or:[{organization_id:ORG},{organization_id:null}] }`
  // was silently answered on the `$or` alone — a different query than the one
  // written, with the suite still green. See #7620.
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      const a = row[k] === undefined ? null : row[k];
      const b = expected === undefined ? null : expected;
      if (a !== b) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

/**
 * A pre-built engine carrying the driver, handed to the plugin as `{ ql }`.
 * `sys_metadata` itself is deliberately NOT registered here — the protocol
 * assembly registers it (that is the `environmentId === undefined` branch of
 * `assembleMetadataProtocol`), and pre-claiming it makes the kernel refuse the
 * assembly's own ownership claim.
 */
function makeEngine() {
  const engine = new ObjectQL();
  const { driver, stores } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  return { engine, stores };
}

const flowRows = (stores: Map<string, Map<string, Record<string, unknown>>>) =>
  Array.from(stores.get('sys_metadata')?.values() ?? []).filter((r) => r.type === 'flow');

/** Attempt the end-user publish and report the verdict without throwing. */
async function publish(protocol: any) {
  try {
    const r = await protocol.saveMetaItem({
      type: 'flow', name: 'leave_approval', item: brokenApprovalFlow(),
    });
    return { refused: false as const, result: r };
  } catch (e: any) {
    return { refused: true as const, code: e?.code, status: e?.status, message: String(e?.message) };
  }
}

describe('#6710 — the authoring channel is threaded from plugin option to protocol', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    // Same two choices as plugin.step2.test.ts: `logger.level` is the real
    // config key, and gracefulShutdown:false keeps process signal handlers out
    // of vitest's fork workers (#4250).
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  });
  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  it('the serve.ts host-config shape — `new ObjectQLPlugin()` — is GATED', async () => {
    // Byte-for-byte what serve.ts's auto-register branch constructs. No
    // options bag at all, so this also pins the fail-safe default reached
    // through the legacy/empty construction path rather than through an
    // explicit `authoringChannel: 'environment'`.
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const protocol = kernel.getService('protocol') as any;

    expect(
      protocol.environmentId,
      'the topology is unchanged — #6710 re-keys the gate, it does not bind an environment id',
    ).toBeUndefined();

    const verdict = await publish(protocol);
    expect(verdict.refused, 'the end-user PUT /api/v1/meta/* surface must meet the gate').toBe(true);
    // Both envelope halves (ADR-0112). Asserting only "it threw" would have
    // been green on the UNFIXED build too: that build reached the engine and
    // threw "No driver available", an Error whose code and status are both
    // undefined. This pair is what separates "refused by the gate" from
    // "failed somewhere downstream".
    expect((verdict as any).code).toBe('INVALID_METADATA');
    expect((verdict as any).status).toBe(422);
  });

  it('declaring `authoringChannel: package-author` restores the ADR-0005 carve-out', async () => {
    const { engine, stores } = makeEngine();
    await kernel.use(new ObjectQLPlugin({ ql: engine, authoringChannel: 'package-author' }));
    await kernel.bootstrap();

    const verdict = await publish(kernel.getService('protocol') as any);
    expect(verdict.refused, `unexpected refusal: ${(verdict as any).message}`).toBe(false);
    expect(flowRows(stores).length, 'the control plane still installs its own packages').toBe(1);
  });

  it('the SAME kernel without the declaration refuses and stores nothing', async () => {
    // Identical harness to the case above — engine, driver, kernel, body. The
    // only difference is the one option, which is what makes this pair the
    // wiring evidence rather than two unrelated boots.
    const { engine, stores } = makeEngine();
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    await kernel.bootstrap();

    const verdict = await publish(kernel.getService('protocol') as any);
    expect(verdict.refused).toBe(true);
    expect((verdict as any).code).toBe('INVALID_METADATA');
    expect((verdict as any).status).toBe(422);
    expect(flowRows(stores), 'a gate that rejects after persisting is a log line').toEqual([]);
  });

  it('the DELEGATED mount (ADR-0076 Step 2) threads it identically', async () => {
    // `assembleMetadataProtocol` is the one seam both mounts share, so the
    // declaration must not depend on how the host chose to mount the protocol.
    // A regression here would be the worst shape available: enforcement that
    // silently differs by mount style.
    const { engine, stores } = makeEngine();
    await kernel.use(new ObjectQLPlugin({ ql: engine, registerProtocol: false }));
    await kernel.use(createMetadataProtocolPlugin({ authoringChannel: 'package-author' }));
    await kernel.bootstrap();

    const verdict = await publish(kernel.getService('protocol') as any);
    expect(verdict.refused, `unexpected refusal: ${(verdict as any).message}`).toBe(false);
    expect(flowRows(stores).length).toBe(1);
  });

  it('the DELEGATED mount without the option is GATED too', async () => {
    const { engine, stores } = makeEngine();
    await kernel.use(new ObjectQLPlugin({ ql: engine, registerProtocol: false }));
    await kernel.use(createMetadataProtocolPlugin());
    await kernel.bootstrap();

    const verdict = await publish(kernel.getService('protocol') as any);
    expect(verdict.refused).toBe(true);
    expect((verdict as any).code).toBe('INVALID_METADATA');
    expect((verdict as any).status).toBe(422);
    expect(flowRows(stores)).toEqual([]);
  });

  it('a declared kernel still publishes a body the rules accept (the carve-out is not a mute button)', async () => {
    const { engine, stores } = makeEngine();
    await kernel.use(new ObjectQLPlugin({ ql: engine, authoringChannel: 'package-author' }));
    await kernel.bootstrap();

    const flow = brokenApprovalFlow();
    (flow.nodes[1] as any).config = {
      approvers: [{ type: 'expression', value: 'current.owner' }],
      emptyApproverPolicy: 'reject',
    };
    const result = await (kernel.getService('protocol') as any).saveMetaItem({
      type: 'flow', name: 'leave_approval', item: flow,
    });
    expect(result.success).toBe(true);
    expect(flowRows(stores).length).toBe(1);
  });
});
