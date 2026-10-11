// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// [#22738] The inbox's `payload_display` reads a referenced record's title only
// from a target whose declared exposure (ADR-0049) serves `get`, asked through
// the spec's one decision. A refused target is NOT READ, so its key carries no
// display value and the snapshot's stored id stands; a declaration that cannot
// be read withholds too, and says so at `warn`. The exposed targets are the
// control. The read is asserted as well as the value: "not served" could
// otherwise be met by reading the title and dropping it.

import { describe, it, expect, vi } from 'vitest';
import { ApprovalService } from './approval-service.js';

type Row = Record<string, unknown>;
type Schema = { label?: string; enable?: Record<string, unknown>; fields: Record<string, unknown> };

/** One target per shape the decision tells apart; `open` declares no `enable` block. */
const TARGETS: Record<string, Record<string, unknown> | undefined> = {
  hidden: { apiEnabled: false },
  listonly: { apiMethods: ['list'] },
  denyall: { apiMethods: [] },
  getonly: { apiMethods: ['get'] },
  open: undefined,
};
const REFUSED = ['hidden', 'listonly', 'denyall'];
const SERVED = ['getonly', 'open'];

const schemas: Record<string, Schema> = {
  deal: {
    label: 'Deal',
    fields: { name: {}, ...Object.fromEntries(Object.keys(TARGETS).map((k) => [k, { type: 'lookup', reference: `t_${k}` }])) },
  },
  ...Object.fromEntries(Object.entries(TARGETS).map(([k, enable]) => [`t_${k}`, { fields: { name: {} }, ...(enable ? { enable } : {}) }])),
};
const tables: Record<string, Row[]> = {
  deal: [{ id: 'd1', name: 'Deal one' }],
  ...Object.fromEntries(Object.keys(TARGETS).map((k) => [`t_${k}`, [{ id: `${k}_1`, name: `${k} title` }]])),
};

function makeService(unreadable?: string) {
  const reads: string[] = [];
  const warn = vi.fn();
  const engine = {
    getSchema(object: string) {
      if (object === unreadable) throw new Error('declaration unavailable');
      return schemas[object];
    },
    async find(object: string, options?: { where?: { id?: { $in?: string[] } } }) {
      reads.push(object);
      const wanted = options?.where?.id?.$in;
      return (tables[object] ?? []).filter((r) => !wanted || wanted.includes(String(r.id)));
    },
  };
  const service = new ApprovalService({ engine: engine as any, logger: { info() {}, warn, error() {}, debug() {} } });
  // `enrichRows` is private; its public callers drag the whole request lifecycle in.
  const enrich = (rows: Row[]) => (service as unknown as { enrichRows(r: Row[]): Promise<void> }).enrichRows(rows);
  return { enrich, reads, warn };
}

const inboxRow = (): Row => ({
  object_name: 'deal',
  record_id: 'd1',
  payload: { name: 'Deal one', ...Object.fromEntries(Object.keys(TARGETS).map((k) => [k, `${k}_1`])) },
});

describe('[#22738] payload_display serves a referenced title only for a target whose exposure serves `get`', () => {
  it('does not read a refused target; its stored id stands, and the served targets keep their titles', async () => {
    const { enrich, reads } = makeService();
    const row = inboxRow();
    await enrich([row]);

    expect(row.payload_display).toEqual(Object.fromEntries(SERVED.map((k) => [k, `${k} title`])));
    for (const k of REFUSED) {
      expect(reads, `t_${k} was read`).not.toContain(`t_${k}`);
      expect((row.payload as Row)[k]).toBe(`${k}_1`);
    }
    for (const k of SERVED) expect(reads).toContain(`t_${k}`);
  });

  it('withholds a target whose declaration cannot be read (fail-closed), and says so at warn', async () => {
    const { enrich, reads, warn } = makeService('t_open');
    const row = inboxRow();
    await enrich([row]);

    expect(row.payload_display).toEqual({ getonly: 'getonly title' });
    expect(reads).not.toContain('t_open');
    expect(warn.mock.calls.some(([message]) => String(message).includes('"t_open"'))).toBe(true);
  });
});
