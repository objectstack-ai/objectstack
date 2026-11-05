// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The by-id write's row re-read (step 2.7 of the authorization middleware) and
 * the controlled-by-parent master read (step 2.8), measured on a REAL `ObjectQL`
 * engine over a real SQL driver with the REAL `SecurityPlugin` registered on it.
 *
 * Two rules:
 *
 *  1. A store fault raised by the re-read propagates as raised; only a declared
 *     refusal (a 4xx) keeps the record-level answer — the classification
 *     `readUnlessRefused` gives every caller-context read the write doors ask.
 *  2. The predicates the platform composes onto the re-read (the tenancy wall,
 *     the row-level write predicates) are not the caller's predicate, so the
 *     caller-predicate guard (step 2.9) does not judge them. The caller's own
 *     predicate is still judged.
 *
 * Nothing else about the re-read's answers moves: a row the caller cannot read
 * and an id naming no row answer as they do for every other caller, a row the
 * caller reads is written, and a system write is not the gate's.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';

import { SecurityPlugin } from './security-plugin.js';

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const HIDDEN = { readable: false, editable: false };
const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

const INVOICE = 'qa_reread_invoice';
const MASTER = 'qa_reread_master';
const DETAIL = 'qa_reread_detail';

const OBJECTS = [
  {
    name: INVOICE,
    label: 'Invoice',
    fields: { id: { name: 'id', type: 'text', primaryKey: true }, status: { name: 'status', type: 'text' } },
  },
  {
    name: MASTER,
    label: 'Master',
    fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } },
  },
  {
    name: DETAIL,
    label: 'Detail',
    sharingModel: 'controlled_by_parent',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      note: { name: 'note', type: 'text' },
      master: { name: 'master', type: 'master_detail', required: true, reference: MASTER },
    },
  },
];

const PERMISSION_SETS = [
  { name: 'qa_reread_member', label: 'Member', objects: { [INVOICE]: CRUD, [MASTER]: CRUD, [DETAIL]: CRUD } },
  // Field rules alone: the organization column hidden from the holder's reads.
  { name: 'qa_reread_org_hidden', label: 'Organization hidden', objects: {}, fields: { [`${INVOICE}.organization_id`]: HIDDEN } },
  { name: 'qa_reread_master_org_hidden', label: 'Master organization hidden', objects: {}, fields: { [`${MASTER}.organization_id`]: HIDDEN } },
];

const member = (...extra: string[]) => ({
  userId: 'u_member',
  positions: [] as string[],
  permissions: ['qa_reread_member', ...extra],
  tenantId: ORG_A,
  accessible_org_ids: [ORG_A],
});
const PLAIN = member();
const ORG_HIDDEN = member('qa_reread_org_hidden');
const MASTER_ORG_HIDDEN = member('qa_reread_master_org_hidden');

type Posture = 'single' | 'group' | 'isolated';
const WALLED: Posture[] = ['group', 'isolated'];
const NOWHERE = 'zz_nowhere_0001';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.by-id-write-row-reread',
    name: 'By-id write row re-read',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? PERMISSION_SETS.find((p) => p.name === name)
          : type === 'position' || type === 'capability' ? undefined
          : engine.getSchema(name)) ?? null,
      list: async (type: string) => (type === 'permission' ? PERMISSION_SETS : []),
    },
    ...(posture === 'single' ? {} : { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture } }),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'qa_reread_member' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  return engine;
}

const inOrg = (organizationId: string) => ({ context: { isSystem: true, tenantId: organizationId } });

async function seedInvoice(engine: ObjectQL, id: string, organizationId: string) {
  await engine.insert(INVOICE, { id, status: 'open', organization_id: organizationId }, inOrg(organizationId));
}

async function storedInvoice(engine: ObjectQL, id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await engine.find(INVOICE, { where: { id }, context: { isSystem: true } });
  return (Array.isArray(rows) ? rows : [])[0];
}

/** The answer a write gets: admitted, or the envelope both doors resolve, the error's name and sentence. */
async function answerOf(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run();
    return { status: 200 };
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code, name: (e as Error).name, message: (e as Error).message };
  }
}

const writeById = (engine: ObjectQL, op: 'update' | 'delete', id: string, context: object) =>
  answerOf(() => op === 'update'
    ? engine.update(INVOICE, { status: 'closed' }, { where: { id }, context: structuredClone(context) })
    : engine.delete(INVOICE, { where: { id }, context: structuredClone(context) }));

/** The caller-context re-read step 2.7 asks: `{ id }` first, then the platform's predicates. */
const isRowReRead = (query: any, id: string) =>
  !query?.context?.isSystem
  && Array.isArray(query?.where?.$and)
  && query.where.$and.length >= 2
  && query.where.$and[0]?.id === id;

/** Fault the engine's `findOne` for the row re-read of `id` alone; every other read is served. */
function faultReRead(engine: ObjectQL, id: string, error: Error) {
  const original = engine.findOne.bind(engine);
  return vi.spyOn(engine, 'findOne').mockImplementation(async (object: any, query: any, ...rest: any[]) => {
    if (object === INVOICE && isRowReRead(query, id)) throw error;
    return original(object, query, ...rest);
  });
}

/**
 * A driver outage shaped like `@objectstack/objectql`'s `DatasourceUnavailableError`:
 * a `code` and a `name`, and no `status`, because that class declares none.
 */
function storeFault(): Error {
  return Object.assign(new Error(`[ObjectQL] Datasource 'primary' configured for object '${INVOICE}' is declared but not connected.`), {
    name: 'DatasourceUnavailableError',
    code: 'ERR_DATASOURCE_UNAVAILABLE',
    datasource: 'primary',
  });
}

/** A declared refusal: an error carrying a 4xx status and its code. */
function declaredRefusal(): Error {
  return Object.assign(new Error('[Security] Access denied: the read is refused.'), {
    name: 'PermissionDeniedError',
    code: 'PERMISSION_DENIED',
    status: 403,
  });
}

describe("a by-id write's row re-read propagates a store fault as raised; a declared refusal keeps the record-level answer", () => {
  for (const posture of WALLED) {
    describe(`posture '${posture}'`, () => {
      it('a store fault raised by the re-read is the write\'s answer, unchanged, and nothing is written', async () => {
        const engine = await boot(posture);
        for (const op of ['update', 'delete'] as const) {
          const id = `fault_${op}`;
          await seedInvoice(engine, id, ORG_A);
          const fault = storeFault();
          const spy = faultReRead(engine, id, fault);
          let raised: unknown;
          try {
            await (op === 'update'
              ? engine.update(INVOICE, { status: 'closed' }, { where: { id }, context: structuredClone(PLAIN) })
              : engine.delete(INVOICE, { where: { id }, context: structuredClone(PLAIN) }));
          } catch (e) {
            raised = e;
          }
          expect(raised, `${op}: the fault itself, as raised`).toBe(fault);
          expect(spy.mock.calls.some(([object, query]) => object === INVOICE && isRowReRead(query, id)), `${op}: the re-read was asked`).toBe(true);
          spy.mockRestore();
          expect(await storedInvoice(engine, id), `${op}: nothing written`).toMatchObject({ id, status: 'open' });
        }
      });

      it('a declared refusal raised by the re-read keeps the record-level 403, one answer whatever the id names', async () => {
        const engine = await boot(posture);
        await seedInvoice(engine, 'refused_row', ORG_A);
        for (const op of ['update', 'delete'] as const) {
          const answers: Record<string, unknown>[] = [];
          for (const id of ['refused_row', NOWHERE]) {
            const refusal = declaredRefusal();
            const spy = faultReRead(engine, id, refusal);
            const answer = await writeById(engine, op, id, PLAIN);
            spy.mockRestore();
            expect([answer.status, answer.code, answer.name], `${op} ${id}: ${answer.message}`).toEqual([403, 'PERMISSION_DENIED', 'PermissionDeniedError']);
            expect(answer.message, `${op} ${id}: the record-level refusal, not the read's own`).not.toBe(refusal.message);
            answers.push(answer);
          }
          expect(answers[0], `${op}: a row and no row answer alike`).toEqual(answers[1]);
        }
        expect(await storedInvoice(engine, 'refused_row'), 'nothing written').toMatchObject({ status: 'open' });
      });

      it('control: with the store answering, the same writes land', async () => {
        const engine = await boot(posture);
        await seedInvoice(engine, 'steady_update', ORG_A);
        await seedInvoice(engine, 'steady_delete', ORG_A);
        expect(await writeById(engine, 'update', 'steady_update', PLAIN)).toEqual({ status: 200 });
        expect(await storedInvoice(engine, 'steady_update')).toMatchObject({ status: 'closed' });
        expect(await writeById(engine, 'delete', 'steady_delete', PLAIN)).toEqual({ status: 200 });
        expect(await storedInvoice(engine, 'steady_delete')).toBeUndefined();
      });
    });
  }
});

describe("a by-id write's row re-read judges the platform's own predicates without the caller-predicate guard; the caller's own predicate is still judged", () => {
  for (const posture of WALLED) {
    describe(`posture '${posture}'`, () => {
      it('a caller whose field rules hide the organization column updates and deletes a row of its organization by id', async () => {
        const engine = await boot(posture);
        await seedInvoice(engine, 'own_update', ORG_A);
        await seedInvoice(engine, 'own_delete', ORG_A);
        // The precondition: the caller reads the row, and the column is hidden from it.
        const seen = await engine.findOne(INVOICE, { where: { id: 'own_update' }, context: structuredClone(ORG_HIDDEN) });
        expect(seen, 'the caller reads the row').toBeTruthy();
        expect((seen as Record<string, unknown>).organization_id, 'the organization column is hidden from it').toBeUndefined();

        expect(await writeById(engine, 'update', 'own_update', ORG_HIDDEN), 'update').toEqual({ status: 200 });
        expect(await storedInvoice(engine, 'own_update'), 'update stored').toMatchObject({ status: 'closed', organization_id: ORG_A });
        expect(await writeById(engine, 'delete', 'own_delete', ORG_HIDDEN), 'delete').toEqual({ status: 200 });
        expect(await storedInvoice(engine, 'own_delete'), 'delete removed the row').toBeUndefined();
      });

      it("a row of another organization, and an id naming no row, answer that caller exactly as they answer a caller who reads the column; neither is written", async () => {
        const engine = await boot(posture);
        await seedInvoice(engine, 'other_org', ORG_B);
        for (const op of ['update', 'delete'] as const) {
          for (const id of ['other_org', NOWHERE]) {
            const reads = await writeById(engine, op, id, PLAIN);
            expect([reads.status, reads.code], `${op} ${id}, column read: ${reads.message}`).toEqual([404, 'RECORD_NOT_FOUND']);
            expect(await writeById(engine, op, id, ORG_HIDDEN), `${op} ${id}, column hidden`).toEqual(reads);
          }
        }
        expect(await storedInvoice(engine, 'other_org'), 'untouched').toMatchObject({ status: 'open', organization_id: ORG_B });
      });

      it("control: the caller's own predicate on the hidden column is still refused, on a read and on a predicate write", async () => {
        const engine = await boot(posture);
        await seedInvoice(engine, 'own_predicate', ORG_A);
        const read = await answerOf(() => engine.find(INVOICE, { where: { organization_id: ORG_A }, context: structuredClone(ORG_HIDDEN) }));
        expect([read.status, read.code], String(read.message)).toEqual([403, 'PERMISSION_DENIED']);
        const write = await answerOf(() => engine.update(INVOICE, { status: 'closed' },
          { multi: true, where: { organization_id: ORG_A }, context: structuredClone(ORG_HIDDEN) }));
        expect([write.status, write.code], String(write.message)).toEqual([403, 'PERMISSION_DENIED']);
        // ...and the same predicate from a caller who reads the column is answered.
        expect(await answerOf(() => engine.find(INVOICE, { where: { organization_id: ORG_A }, context: structuredClone(PLAIN) })))
          .toEqual({ status: 200 });
        expect(await storedInvoice(engine, 'own_predicate'), 'untouched').toMatchObject({ status: 'open' });
      });

      it('control: a system write by id is not the gate\'s, and lands', async () => {
        const engine = await boot(posture);
        await seedInvoice(engine, 'system_write', ORG_B);
        await engine.update(INVOICE, { status: 'closed' }, { where: { id: 'system_write' }, ...inOrg(ORG_B) });
        expect(await storedInvoice(engine, 'system_write')).toMatchObject({ status: 'closed' });
      });
    });
  }

  it("control, 'single': no wall is composed, and the caller who cannot read the column writes as before", async () => {
    const engine = await boot('single');
    await seedInvoice(engine, 'single_row', ORG_A);
    expect(await writeById(engine, 'update', 'single_row', ORG_HIDDEN)).toEqual({ status: 200 });
    expect(await writeById(engine, 'delete', 'single_row', ORG_HIDDEN)).toEqual({ status: 200 });
    expect(await writeById(engine, 'update', NOWHERE, ORG_HIDDEN)).toEqual(await writeById(engine, 'update', NOWHERE, PLAIN));
  });
});

describe("the controlled-by-parent master read judges the platform's own predicates on the master without the caller-predicate guard", () => {
  for (const posture of WALLED) {
    it(`posture '${posture}': a caller whose field rules hide the master's organization column writes a detail under a master of its organization; a master of another organization is refused as for a caller who reads the column`, async () => {
      const engine = await boot(posture);
      await engine.insert(MASTER, { id: 'master_a', name: 'A', organization_id: ORG_A }, inOrg(ORG_A));
      await engine.insert(MASTER, { id: 'master_b', name: 'B', organization_id: ORG_B }, inOrg(ORG_B));

      const own = await answerOf(() => engine.insert(DETAIL, { id: 'detail_own', note: 'n', master: 'master_a' },
        { context: structuredClone(MASTER_ORG_HIDDEN) }));
      expect(own, 'a detail under a master of its organization').toEqual({ status: 200 });
      const stored = await engine.find(DETAIL, { where: { id: 'detail_own' }, context: { isSystem: true } });
      expect(stored, 'the detail is stored').toHaveLength(1);

      const reads = await answerOf(() => engine.insert(DETAIL, { id: 'detail_other_plain', note: 'n', master: 'master_b' },
        { context: structuredClone(PLAIN) }));
      expect(reads.status, `column read: ${reads.message}`).not.toBe(200);
      const hidden = await answerOf(() => engine.insert(DETAIL, { id: 'detail_other_hidden', note: 'n', master: 'master_b' },
        { context: structuredClone(MASTER_ORG_HIDDEN) }));
      expect([hidden.status, hidden.code, hidden.name], `column hidden: ${hidden.message}`).toEqual([reads.status, reads.code, reads.name]);
      expect(await engine.find(DETAIL, { where: { master: 'master_b' }, context: { isSystem: true } }), 'nothing stored').toHaveLength(0);
    });
  }
});
