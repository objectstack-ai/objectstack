// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3043 — static `readonly: true` fields must not be SEEDABLE via a non-system
// create through the external data API. The strip lives at the DataProtocol
// ingress (createData / createManyData / batchData / cloneData) — the seam every
// external REST/GraphQL/MCP create funnels through — while trusted internal
// writers call engine.insert directly and are unaffected. It runs BEFORE
// engine.insert, so a stripped field falls back to its defaultValue (re-derived
// by the engine, which the mock stands in for). System context is exempt.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
  name: 'approval_case',
  fields: {
    title: { name: 'title', type: 'text' },
    // readonly approval column — the #3003 attack target
    approval_status: { name: 'approval_status', type: 'text', readonly: true, defaultValue: 'draft' },
    // readonly provenance stamp with no default
    source: { name: 'source', type: 'text', readonly: true },
  },
};

function makeProtocol() {
  const inserts: Array<{ object: string; data: any; options: any }> = [];
  const engine = {
    registry: { getObject: (n: string) => (n === 'approval_case' ? SCHEMA : undefined) },
    insert: vi.fn(async (object: string, data: any, options?: any) => {
      inserts.push({ object, data, options });
      const rows = Array.isArray(data) ? data : [data];
      const out = rows.map((r, i) => ({ id: `rec-${i + 1}`, ...r }));
      return Array.isArray(data) ? out : out[0];
    }),
  };
  const p = new ObjectStackProtocolImplementation(engine as any);
  return { p, engine, inserts };
}

describe('createData — static readonly INSERT strip (#3043)', () => {
  it('drops a non-system caller forging a readonly field; editable sibling lands', async () => {
    const { p, inserts } = makeProtocol();
    await p.createData({
      object: 'approval_case',
      data: { title: 'Case A', approval_status: 'approved' },
      context: { userId: 'u1' },
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].data).toEqual({ title: 'Case A' }); // approval_status stripped
    expect(inserts[0].data).not.toHaveProperty('approval_status');
  });

  it('ALLOWS a system-context caller to seed the readonly field', async () => {
    const { p, inserts } = makeProtocol();
    await p.createData({
      object: 'approval_case',
      data: { title: 'Seed', approval_status: 'approved' },
      context: { isSystem: true },
    });
    expect(inserts[0].data.approval_status).toBe('approved');
  });

  it('strips a forged readonly field even when no context is supplied (non-system default)', async () => {
    const { p, inserts } = makeProtocol();
    await p.createData({ object: 'approval_case', data: { title: 'X', source: 'attacker' } });
    expect(inserts[0].data).not.toHaveProperty('source');
  });

  it('does NOT strip a PLATFORM object — defers to its own field guards (ADR-0086 / #3004)', async () => {
    // A `sys_`/managedBy object carries dedicated write governance (e.g. the
    // ADR-0086 provenance guard REJECTS a forged managed_by/package_id with 403);
    // the generic silent strip must not pre-empt that. Proven with both markers.
    const platformSchema = {
      name: 'sys_permission_set',
      fields: { managed_by: { name: 'managed_by', type: 'select', readonly: true } },
    };
    const managedSchema = {
      name: 'crm_thing', managedBy: 'package',
      fields: { locked: { name: 'locked', type: 'text', readonly: true } },
    };
    const inserts: any[] = [];
    const engine = {
      registry: { getObject: (n: string) => (n === 'sys_permission_set' ? platformSchema : managedSchema) },
      insert: vi.fn(async (object: string, data: any) => { inserts.push({ object, data }); return { id: 'x', ...data }; }),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    await p.createData({ object: 'sys_permission_set', data: { managed_by: 'package' }, context: { userId: 'u1' } });
    await p.createData({ object: 'crm_thing', data: { locked: 'forged' }, context: { userId: 'u1' } });
    expect(inserts[0].data.managed_by, 'sys_ object: readonly field passed through to its guard').toBe('package');
    expect(inserts[1].data.locked, 'managedBy object: readonly field passed through to its guard').toBe('forged');
  });
});

describe('createManyData / batchData — per-row readonly INSERT strip (#3043)', () => {
  it('createManyData strips the forged readonly column on every row', async () => {
    const { p, inserts } = makeProtocol();
    await p.createManyData({
      object: 'approval_case',
      records: [
        { title: 'A', approval_status: 'approved' },
        { title: 'B', approval_status: 'approved' },
      ],
      context: { userId: 'u1' },
    });
    expect(inserts[0].data).toEqual([{ title: 'A' }, { title: 'B' }]);
  });

  it('batchData create strips the forged readonly column', async () => {
    const { p, inserts } = makeProtocol();
    await p.batchData({
      object: 'approval_case',
      request: { operation: 'create', records: [{ data: { title: 'A', approval_status: 'approved' } }] } as any,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].data).toEqual({ title: 'A' });
  });
});

// ---------------------------------------------------------------------------
// #6640 — `preserveAudit` is an UPDATE-path exemption, and a non-system INSERT
// that asks for it is TOLD so.
//
// The contract used to promise the historical-import exemption (#3493) on both
// write paths (FieldSchema.readonly's `.describe()`, security.mdx), but only
// UPDATE ever read it: this ingress knows `isSystem` and nothing else. REST
// import's `treatAsHistorical` puts `preserveAudit: true` on the write context
// and creates through `createData` — so one import preserved an author-declared
// readonly column on the rows it updated and silently dropped it on the rows it
// created. Maintainer ruling 2026-08-08 (option 2 + loudness rider): the
// contract narrows to the enforcement, and the ignored request stops being
// silent.
//
// Every pin below goes through the REAL entry (`createData` / `createManyData` /
// `batchData` → `stripReadonlyForInsert`). That is the binding half of the test
// note: the pre-existing `preserveAudit` pins all call `engine.insert` directly,
// bypassing this ingress, which is how the gap survived.
// ---------------------------------------------------------------------------

/**
 * A historical-import target: two author-declared business `readonly` columns
 * (the `closed_at` / `resolved_by` family the issue names) plus the injected
 * audit column, which the registry's `AUDIT_FIELD_DEFS` also marks
 * `readonly: true` — so an ordinary export→import round-trip trips this on
 * every row, not only a hand-built payload.
 */
const TICKET = {
  name: 'ticket',
  fields: {
    subject: { name: 'subject', type: 'text' },
    closed_at: { name: 'closed_at', type: 'datetime', readonly: true },
    resolved_by: { name: 'resolved_by', type: 'lookup', reference: 'sys_user', readonly: true },
    created_at: { name: 'created_at', type: 'datetime', readonly: true, system: true },
  },
};

function makeTicketProtocol() {
  const inserts: Array<{ object: string; data: any }> = [];
  const engine = {
    registry: { getObject: (n: string) => (n === 'ticket' ? TICKET : undefined) },
    insert: vi.fn(async (object: string, data: any) => {
      inserts.push({ object, data });
      const rows = Array.isArray(data) ? data : [data];
      const out = rows.map((r, i) => ({ id: `t-${i + 1}`, ...r }));
      return Array.isArray(data) ? out : out[0];
    }),
  };
  return { p: new ObjectStackProtocolImplementation(engine as any), inserts };
}

/** Capture `console.warn` for one test without letting it reach the reporter. */
function captureWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

const HISTORICAL_CTX = { userId: 'importer', skipStateMachine: true, preserveAudit: true };

describe('#6640 — a non-system INSERT requesting preserveAudit is stripped AND warned', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('strips the readonly fields (enforcement unchanged) and names them in one loud warning', async () => {
    const warn = captureWarn();
    const { p, inserts } = makeTicketProtocol();

    await p.createData({
      object: 'ticket',
      data: {
        subject: 'legacy ticket',
        closed_at: '2019-04-01T00:00:00Z',
        resolved_by: 'usr_alice',
        created_at: '2019-03-28T00:00:00Z',
      },
      context: HISTORICAL_CTX,
    });

    // 1. The strip still applies — the ruling narrowed the CONTRACT, not the guard.
    expect(inserts[0].data, 'readonly fields still stripped on a non-system create')
      .toEqual({ subject: 'legacy ticket' });

    // 2. …and it is no longer silent about the exemption it refused to honour.
    expect(warn, 'exactly one signal per ingress call, not one per field').toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0]);
    // The rule, stated: the reader must learn WHY, not just THAT.
    expect(msg).toContain('preserveAudit is UPDATE-only and was IGNORED on this INSERT');
    expect(msg).toContain("(object 'ticket')");
    // Every field it cost them, by name.
    expect(msg).toContain('closed_at');
    expect(msg).toContain('resolved_by');
    expect(msg).toContain('created_at');
    // The remedy, so the warning is actionable rather than merely loud.
    expect(msg).toContain('context.isSystem');
    expect(msg).toContain('#6640');
  });

  it('leaves a SYSTEM insert untouched — preserveAudit or not, isSystem is still the exemption', async () => {
    const warn = captureWarn();
    const { p, inserts } = makeTicketProtocol();
    await p.createData({
      object: 'ticket',
      data: { subject: 'seed', closed_at: '2019-04-01T00:00:00Z' },
      context: { ...HISTORICAL_CTX, isSystem: true },
    });
    expect(inserts[0].data.closed_at, 'system context replays archival readonly facts').toBe('2019-04-01T00:00:00Z');
    expect(warn, 'nothing was ignored, so nothing is reported').not.toHaveBeenCalled();
  });

  it('stays SILENT for an ordinary create that never asked for the exemption (#3043 unchanged)', async () => {
    const warn = captureWarn();
    const { p, inserts } = makeTicketProtocol();
    await p.createData({
      object: 'ticket',
      data: { subject: 'x', closed_at: '2019-04-01T00:00:00Z' },
      context: { userId: 'u1' },
    });
    expect(inserts[0].data).toEqual({ subject: 'x' });
    // This is what makes the signal INFORMATIVE: it distinguishes "your fields
    // were stripped by the ordinary rule" (already reported via droppedFields)
    // from "the exemption you requested does not exist on this path".
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays SILENT when preserveAudit was requested but nothing was actually stripped', async () => {
    const warn = captureWarn();
    const { p, inserts } = makeTicketProtocol();
    await p.createData({ object: 'ticket', data: { subject: 'plain row' }, context: HISTORICAL_CTX });
    expect(inserts[0].data).toEqual({ subject: 'plain row' });
    expect(warn, 'a request that loses nothing has nothing to report').not.toHaveBeenCalled();
  });

  it('createManyData warns ONCE with the UNION of what every row lost', async () => {
    const warn = captureWarn();
    const { p, inserts } = makeTicketProtocol();
    await p.createManyData({
      object: 'ticket',
      records: [
        { subject: 'A', closed_at: '2019-04-01T00:00:00Z' },
        { subject: 'B', resolved_by: 'usr_bob' },
      ],
      context: HISTORICAL_CTX,
    });
    expect(inserts[0].data).toEqual([{ subject: 'A' }, { subject: 'B' }]);
    expect(warn, 'one signal per ingress call — the strip is schema-uniform').toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0]);
    expect(msg).toContain('closed_at');
    expect(msg).toContain('resolved_by');
  });

  it('batchData create carries the same signal (every ingress, by construction)', async () => {
    const warn = captureWarn();
    const { p, inserts } = makeTicketProtocol();
    await p.batchData({
      object: 'ticket',
      request: { operation: 'create', records: [{ data: { subject: 'A', closed_at: '2019-04-01T00:00:00Z' } }] } as any,
      context: HISTORICAL_CTX,
    } as any);
    expect(inserts[0].data).toEqual({ subject: 'A' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('preserveAudit is UPDATE-only');
  });
});
