// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The approval request's record snapshot (`payload_json`) is stored, and served
 * to approvers and submitters below the write boundary. It is built from the
 * flow's `$record`, which carries the engine's own write result — kept whole
 * for privileged in-process callers. So the snapshot applies the same rule a
 * write response does, by the same helper: credential-class fields masked,
 * `internal: true` fields omitted. The record the caller handed in is not
 * touched. Fixtures are synthetic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SECRET_MASK } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';

const OBJECT = 'probe_vault';
const CREDENTIAL = 'synthetic-credential-5d0a';
const INTERNAL = 'synthetic-internal-91fe';
const CTX = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] } as any;
const SYS = { isSystem: true, positions: [], permissions: [] } as any;

interface FakeRow { [k: string]: any }

function makeEngine(withSchema = true) {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const matches = (row: FakeRow, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return (v as any[]).some((s) => matches(row, s));
      if (k === '$and') return (v as any[]).every((s) => matches(row, s));
      if (v != null && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  };
  const engine: any = {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter((r) => matches(r, options?.filter ?? options?.where));
      return rows.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    // Opening a request and reading it back reach no update/delete verb, so
    // the double declares none (the same reasoning as
    // `approval-payload-masked-field.test.ts`).
  };
  if (withSchema) {
    engine.getSchema = (object: string) => object !== OBJECT ? undefined : {
      name: OBJECT,
      fields: {
        id: { name: 'id', type: 'text' },
        title: { name: 'title', type: 'text' },
        access_token: { name: 'access_token', type: 'secret' },
        passphrase: { name: 'passphrase', type: 'password' },
        lookup_digest: { name: 'lookup_digest', type: 'text', internal: true },
      },
    };
  }
  return engine;
}

function openInput(record: Record<string, unknown>) {
  return {
    object: OBJECT,
    recordId: 'pv_1',
    runId: 'run_1',
    nodeId: 'approve_step',
    flowName: 'vault_approval',
    config: { approvers: [{ type: 'user' as const, value: 'u9' }], behavior: 'first_response' as const, lockRecord: true },
    record,
  };
}

const submitted = () => ({
  id: 'pv_1',
  title: 'Synthetic vault',
  access_token: CREDENTIAL,
  passphrase: `${CREDENTIAL}-p`,
  lookup_digest: INTERNAL,
});

describe('approval record snapshot applies the write-response non-exposure rules', () => {
  let engine: any;
  let svc: ApprovalService;

  beforeEach(() => {
    engine = makeEngine();
    svc = new ApprovalService({ engine, clock: { now: () => new Date('2026-01-01T00:00:00Z') } });
  });

  it('stores credential-class fields masked and internal fields omitted', async () => {
    await svc.openNodeRequest(openInput(submitted()), CTX);
    const raw = engine._tables['sys_approval_request'][0];
    expect(raw.payload_json).not.toContain(CREDENTIAL);
    expect(raw.payload_json).not.toContain(INTERNAL);
    const snapshot = JSON.parse(raw.payload_json);
    expect(snapshot).toEqual({
      id: 'pv_1',
      title: 'Synthetic vault',
      access_token: SECRET_MASK,
      passphrase: SECRET_MASK,
    });
  });

  it('serves the masked snapshot on the service read door', async () => {
    const req = await svc.openNodeRequest(openInput(submitted()), CTX);
    const read = await svc.getRequest((req as any).id, SYS);
    expect(JSON.stringify(read)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(read)).not.toContain(INTERNAL);
    expect((read as any).payload.access_token).toBe(SECRET_MASK);
  });

  it('leaves the record the caller handed in untouched', async () => {
    const record = submitted();
    await svc.openNodeRequest(openInput(record), CTX);
    expect(record).toEqual(submitted());
  });

  it('an engine with no schema surface stores the snapshot as handed in', async () => {
    const bare = makeEngine(false);
    const bareSvc = new ApprovalService({ engine: bare, clock: { now: () => new Date('2026-01-01T00:00:00Z') } });
    await bareSvc.openNodeRequest(openInput({ id: 'pv_1', title: 'Plain' }), CTX);
    expect(JSON.parse(bare._tables['sys_approval_request'][0].payload_json)).toEqual({ id: 'pv_1', title: 'Plain' });
  });
});
