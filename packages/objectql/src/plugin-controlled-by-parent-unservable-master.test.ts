// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D5.2 / D5.3 · ADR-0049] A `controlled_by_parent` detail whose
 * master the engine composes no `ReadableIds` leaf over fails the BOOT, naming
 * the detail, the master, the class and the remedy — never admitted to answer
 * 500 at read time:
 *
 *  - (a) a master bound to another datasource than the detail;
 *  - (b) a master an object-scoped read middleware narrows.
 *
 * Booted through a real `ObjectKernel` and `ObjectQLPlugin`. The middleware is
 * registered the way the platform's own gates are (mailbox, audit, attachment):
 * from the owning plugin's `kernel:ready` handler, which runs AFTER the
 * engine's — so a check made at the engine's `kernel:ready` would not see it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

interface ManifestService {
  register(artifact: unknown): Promise<void> | void;
}

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    try { if (kernel.getState() === 'running') await kernel.shutdown(); } catch { /* noop */ }
  }
});

const driver = (name: string): any => ({
  name, version: '0.0.0', supports: {},
  async connect() {}, async disconnect() {}, async checkHealth() { return true; },
  async find() { return []; }, async findOne() { return null; }, async count() { return 0; },
});

/** Registers the drivers and the artifacts during init, the way a host composes a stack. */
function stack(artifacts: unknown[], drivers: string[] = ['primary']) {
  return {
    name: 'test.stack',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      const ql = ctx.getService<ObjectQL>('objectql');
      drivers.forEach((name, i) => ql.registerDriver(driver(name), i === 0));
      const manifest = ctx.getService<ManifestService>('manifest');
      for (const artifact of artifacts) await manifest.register(artifact);
    },
  };
}

/** Registers a read middleware from its own `kernel:ready` handler — as late as the platform's gates register. */
function lateReadGate(options?: { object?: string }) {
  return {
    name: 'test.late-read-gate',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async () => {},
    start: async (ctx: PluginContext) => {
      ctx.hook('kernel:ready', async () => {
        ctx.getService<ObjectQL>('objectql').registerMiddleware(async (_op, next) => next(), options);
      });
    },
  };
}

async function boot(...plugins: any[]): Promise<{ kernel: ObjectKernel; err: any }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  for (const p of plugins) await kernel.use(p);
  const err = await kernel.bootstrap().then(() => undefined, (e) => e);
  return { kernel, err };
}

const master = (name: string, extra: Record<string, unknown> = {}) => ({
  name, ...extra, fields: { title: { name: 'title', type: 'text' } },
});
const detail = (name: string, masterName: string, extra: Record<string, unknown> = {}) => ({
  name,
  sharingModel: 'controlled_by_parent',
  ...extra,
  fields: { parent: { name: 'parent', type: 'master_detail', reference: masterName, required: true } },
});
const app = (objects: unknown[]) => ({ id: 'com.test.cbp', name: 'cbp', objects });

const REMEDY = 'Bind the detail and its master to one datasource; or choose a master without an object-scoped read '
  + 'middleware; or declare the detail without `controlled_by_parent`.';

describe('[ADR-0139 D5.2 / D5.3] a controlled_by_parent detail over a master the engine cannot compose a read over', () => {
  it('(a) a master bound to another datasource refuses the boot, naming both datasources and the remedy', async () => {
    const { err } = await boot(stack(
      [app([master('cbp_master', { datasource: 'archive' }), detail('cbp_detail', 'cbp_master')])],
      ['primary', 'archive'],
    ));
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toContain(
      "'cbp_detail' (master field 'parent') over master 'cbp_master', which is bound to datasource 'archive' "
      + "while 'cbp_detail' is bound to 'primary' (ADR-0139 D5.3)",
    );
    expect(err.message).toContain(REMEDY);
  });

  it('(b) a master an object-scoped read middleware narrows — registered at kernel:ready — refuses the boot', async () => {
    const { err } = await boot(
      stack([app([master('cbp_master'), detail('cbp_detail', 'cbp_master')])]),
      lateReadGate({ object: 'cbp_master' }),
    );
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toContain(
      "'cbp_detail' (master field 'parent') over master 'cbp_master', whose rows an object-scoped read middleware "
      + 'narrows (ADR-0139 D5.2)',
    );
    expect(err.message).toContain(REMEDY);
  });

  it('(b) a detail mastered by sys_attachment, gated as the storage plugin gates it, refuses the boot', async () => {
    const { err } = await boot(
      stack([app([master('sys_attachment'), detail('cbp_attachment_note', 'sys_attachment')])]),
      lateReadGate({ object: 'sys_attachment' }),
    );
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toContain("'cbp_attachment_note' (master field 'parent') over master 'sys_attachment'");
  });

  it('names every offending detail in one refusal', async () => {
    const { err } = await boot(
      stack(
        [app([
          master('cbp_gated'), detail('cbp_detail_b', 'cbp_gated'),
          master('cbp_far', { datasource: 'archive' }), detail('cbp_detail_a', 'cbp_far'),
        ])],
        ['primary', 'archive'],
      ),
      lateReadGate({ object: 'cbp_gated' }),
    );
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toMatch(/^2 controlled_by_parent details derive their access/);
    expect(err.message).toContain("over master 'cbp_gated'");
    expect(err.message).toContain("over master 'cbp_far'");
  });
});

describe('[ADR-0139 D5.2 / D5.3] controls: a servable controlled_by_parent master boots unchanged', () => {
  // HotCRM's six controlled_by_parent shapes (e6d5d3e): every master a crm_* object on the one datasource, with no
  // object-scoped read middleware on any of them — while the platform gates its own system objects.
  const HOTCRM = [
    master('crm_account'), master('crm_opportunity'), master('crm_activity'),
    detail('crm_contact', 'crm_account'),
    detail('crm_quote', 'crm_opportunity'),
    detail('crm_contract', 'crm_account'),
    detail('crm_quote_line', 'crm_quote'), // a two-level chain: its master is controlled_by_parent too
    detail('crm_opportunity_line', 'crm_opportunity'),
    detail('crm_activity_participant', 'crm_activity'),
  ];

  it("HotCRM's six details boot, with an object-scoped read middleware on a system object no detail is mastered by", async () => {
    const { kernel, err } = await boot(stack([app([...HOTCRM, master('sys_comment')])]), lateReadGate({ object: 'sys_comment' }));
    expect(err).toBeUndefined();
    expect(kernel.getService<ObjectQL>('objectql').findUnservableControlledByParentMasters()).toEqual([]);
  });

  it('a global middleware (no object, or "*") is keyed to no master and does not refuse', async () => {
    const one = await boot(stack([app([master('cbp_master'), detail('cbp_detail', 'cbp_master')])]), lateReadGate());
    expect(one.err).toBeUndefined();
    const star = await boot(stack([app([master('cbp_master'), detail('cbp_detail', 'cbp_master')])]), lateReadGate({ object: '*' }));
    expect(star.err).toBeUndefined();
  });

  it('a detail and its master bound explicitly to the same second datasource boot', async () => {
    const { err } = await boot(stack(
      [app([master('cbp_master', { datasource: 'archive' }), detail('cbp_detail', 'cbp_master', { datasource: 'archive' })])],
      ['primary', 'archive'],
    ));
    expect(err).toBeUndefined();
  });

  it('a master on another datasource under a detail that is NOT controlled_by_parent boots', async () => {
    const { err } = await boot(stack(
      [app([master('cbp_master', { datasource: 'archive' }), { ...detail('cbp_detail', 'cbp_master'), sharingModel: 'private' }])],
      ['primary', 'archive'],
    ));
    expect(err).toBeUndefined();
  });
});
