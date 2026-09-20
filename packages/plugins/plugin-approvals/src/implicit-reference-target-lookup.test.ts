// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `resolveLookupFields` used to read the MATERIALIZED `reference` carrier, so a
// `{ type: 'user' }` field authored without one was left out of inbox display
// enrichment — silently. No refusal, no diagnostic: the reviewer just saw a raw
// user id where every other reference field showed a name.
//
// The contract says that metadata is COMPLETE. `IMPLICIT_REFERENCE_TARGETS`
// (`@objectstack/spec/data`) declares a `user` field's target "a CONSTANT OF THE
// TYPE, so `reference` on a `user` field materializes that constant; it does not
// supply it. Metadata authored without it (hand-written JSON, an AI author, a
// Studio form) is fully specified, not under-specified." `referenceTargetOf`
// lives in that same module precisely to supply it, and is now what this reader
// asks.
//
// The SILENCE is the defect, so the consumer-level cases assert what the
// enrichment now DOES — the read it issues and the display value it produces —
// rather than a happy value alone, which could not tell "enriched" apart from
// "was never asked". The controls keep this a repair rather than a widening: a
// `lookup` / `master_detail` whose author-chosen target is absent names nothing,
// nothing can supply it, and it still stays out with no read and no warning.

import { describe, it, expect, vi } from 'vitest';
import { referenceTargetOf } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';

type FieldDefs = Record<string, unknown>;
type Row = Record<string, unknown>;

/** What the enrichment read, in the order it read it. */
interface FindCall { object: string; ids: string[] }

/** The two engine members the enrichment path reads. */
function makeEngine(
  schemas: Record<string, { label?: string; fields: FieldDefs }>,
  tables: Record<string, Row[]> = {},
) {
  const finds: FindCall[] = [];
  const engine = {
    getSchema: (object: string) => schemas[object],
    async find(object: string, options?: { where?: { id?: { $in?: string[] } } }) {
      const wanted = options?.where?.id?.$in;
      finds.push({ object, ids: wanted ?? [] });
      const rows = tables[object] ?? [];
      return wanted ? rows.filter(r => wanted.includes(String(r.id))) : rows;
    },
  };
  return { engine, finds };
}

/** An inbox row as `enrichRows` reads and rewrites it. */
interface InboxRow {
  object_name: string;
  record_id: string;
  payload: Record<string, unknown>;
  payload_display?: Record<string, string>;
  record_title?: string;
}

function makeService(
  schemas: Record<string, { label?: string; fields: FieldDefs }>,
  tables: Record<string, Row[]> = {},
) {
  const warn = vi.fn();
  const { engine, finds } = makeEngine(schemas, tables);
  const service = new ApprovalService({
    engine: engine as any,
    logger: { info() {}, warn, error() {}, debug() {} },
  });
  // Both members are private and neither has a public seam that does not drag
  // the whole request lifecycle in: `resolveLookupFields`' sole consumer is
  // `enrichRows`, whose every failure is swallowed by design.
  const resolve = (object: string) =>
    (service as unknown as { resolveLookupFields(o: string): Array<{ key: string; reference: string }> })
      .resolveLookupFields(object);
  const enrich = (rows: InboxRow[]) =>
    (service as unknown as { enrichRows(r: InboxRow[]): Promise<void> }).enrichRows(rows);
  return { resolve, enrich, warn, finds };
}

const DEAL = {
  deal: {
    label: 'Deal',
    fields: {
      name: {},
      // The spelling the contract calls fully specified.
      owner: { type: 'user' },
      // The same field with the constant materialized — the control that says
      // this is one answer, not two.
      reviewer: { type: 'user', reference: 'sys_user' },
      // An author-chosen target, supplied.
      account: { type: 'lookup', reference: 'crm_account' },
      // An author-chosen target, absent: nothing can supply it.
      partner: { type: 'lookup' },
      parent_deal: { type: 'master_detail' },
      // Not a reference-typed field at all.
      stage: { type: 'text' },
    },
  },
};

describe('ApprovalService.resolveLookupFields — a target FIXED BY THE TYPE', () => {
  it('resolves a `user` field that materializes no `reference` to the type constant', () => {
    const { resolve } = makeService(DEAL);
    const owner = resolve('deal').find(f => f.key === 'owner');
    expect(owner).toEqual({ key: 'owner', reference: 'sys_user' });
    // And it is the ARBITER's answer, not a `sys_user` literal this reader owns
    // — a hand-copied constant here would be the second list the spec module
    // exists to prevent.
    expect(owner?.reference).toBe(referenceTargetOf({ type: 'user' }));
  });

  it('answers identically whether or not the constant is spelled out', () => {
    const { resolve } = makeService(DEAL);
    const byKey = new Map(resolve('deal').map(f => [f.key, f.reference]));
    expect(byKey.get('owner')).toBe(byKey.get('reviewer'));
    expect(byKey.get('account')).toBe('crm_account');
  });

  it('still leaves out an author-chosen target that names nothing, and stays silent about it', () => {
    const { resolve, warn } = makeService(DEAL);
    const keys = resolve('deal').map(f => f.key);
    expect(keys).not.toContain('partner');
    expect(keys).not.toContain('parent_deal');
    expect(keys).not.toContain('stage');
    // Absence is legal for those types (`FieldSchema.reference` is optional), so
    // it is reported nowhere — only an UNREADABLE carrier warns.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('inbox display enrichment — the previously silent path', () => {
  const TICKET = {
    ticket: { label: 'Ticket', fields: { name: {}, assignee: { type: 'user' } } },
    sys_user: { label: 'User', fields: { name: {} } },
  };

  it('issues the `sys_user` read and shows the name for an implicit-target field', async () => {
    const { enrich, finds } = makeService(TICKET, {
      ticket: [{ id: 'tk1', name: 'Printer on fire' }],
      sys_user: [{ id: 'u7', name: 'Grace Hopper' }],
    });
    const rows: InboxRow[] = [{
      object_name: 'ticket',
      record_id: 'tk1',
      payload: { name: 'Printer on fire', assignee: 'u7' },
    }];
    await enrich(rows);

    // The read the silent path never issued. `assignee` is this object's ONLY
    // reference field, so before the repair the enrichment asked `sys_user`
    // nothing at all — this is the half a happy-value assertion cannot see.
    const userReads = finds.filter(f => f.object === 'sys_user');
    expect(userReads).toHaveLength(1);
    expect(userReads[0]?.ids).toEqual(['u7']);

    // …and the value the reviewer actually sees, instead of the raw id.
    expect(rows[0]?.payload_display).toEqual({ assignee: 'Grace Hopper' });
  });

  it('asks nothing and shows nothing when the target is genuinely absent', async () => {
    const { enrich, finds } = makeService({
      ticket: { label: 'Ticket', fields: { name: {}, partner: { type: 'lookup' } } },
    }, { ticket: [{ id: 'tk1', name: 'Printer on fire' }] });
    const rows: InboxRow[] = [{
      object_name: 'ticket',
      record_id: 'tk1',
      payload: { name: 'Printer on fire', partner: 'p1' },
    }];
    await enrich(rows);

    // The other direction of the same claim: a field the contract leaves
    // under-specified is still resolved by nobody, so "enrichment runs for the
    // implicit target" cannot be read as "enrichment now runs for everything".
    expect(finds.map(f => f.object)).toEqual(['ticket']);
    expect(rows[0]?.payload_display).toBeUndefined();
  });
});
