// SCRATCH PROBE for #20039 — not committed.
import { describe, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { RemoteTransport } from './remote-transport.js';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';

const OUT = process.env.PROBE_OUT ?? '/tmp/probe-remote-20039.json';

const DOORS: Array<{ name: string; where: () => any; secrets: string[] }> = [
  { name: 'icontains empty', where: () => ({ policy_stage: { $icontains: '' } }), secrets: ['policy_stage'] },
  { name: 'icontains non-string', where: () => ({ policy_stage: { $icontains: 424242 } }), secrets: ['policy_stage', '424242'] },
  { name: 'like non-string', where: () => ({ policy_stage: { $like: 737373 } }), secrets: ['policy_stage', '737373'] },
  { name: 'like dangling escape', where: () => ({ policy_stage: { $like: 'PSECRET3\\' } }), secrets: ['policy_stage', 'PSECRET3'] },
  { name: 'contains object comparand', where: () => ({ policy_stage: { $contains: { k: 'PSECRET4' } } }), secrets: ['policy_stage', 'PSECRET4'] },
  { name: 'in object member', where: () => ({ policy_stage: { $in: ['a', { k: 'PSECRET5' }] } }), secrets: ['policy_stage', 'PSECRET5'] },
  { name: 'undefined direct comparand', where: () => ({ policy_stage: undefined, stage: 'won' }), secrets: ['policy_stage'] },
  { name: 'undefined operator comparand', where: () => ({ policy_stage: { $eq: undefined } }), secrets: ['policy_stage'] },
  { name: 'undefined list member', where: () => ({ policy_stage: { $in: ['a', undefined] } }), secrets: ['policy_stage'] },
  { name: 'non-node element of $or', where: () => ({ $or: ['PSECRETX7'] }), secrets: ['PSECRETX7'] },
  { name: 'non-node $not operand', where: () => ({ $not: 'PSECRETX8' }), secrets: ['PSECRETX8'] },
  { name: 'undeclared node combinator', where: () => ({ $psecret_comb: 'x' }), secrets: ['$psecret_comb'] },
  { name: 'misplaced field operator at node', where: () => ({ $eq: 'PSECRET10' }), secrets: ['PSECRET10'] },
  { name: 'array root', where: () => [{ policy_stage: 'PSECRET9' }], secrets: ['policy_stage', 'PSECRET9'] },
  { name: 'empty operator map', where: () => ({ policy_stage: {} }), secrets: ['policy_stage'] },
  { name: '$between reaching transport', where: () => ({ policy_stage: { $between: [1, 2] } }), secrets: ['policy_stage'] },
];

describe('probe remote #20039', () => {
  it('measures', async () => {
    const rows: any[] = [];
    for (const door of DOORS) {
      for (const mark of ['policy', 'author', 'unmarked'] as const) {
        const client = { execute: vi.fn(async () => ({ rows: [], columns: [] })), close: vi.fn() };
        const sink: string[] = [];
        const t = new RemoteTransport();
        t.setClient(client as any);
        t.setDiagnosticSink((m) => sink.push(m));
        const w = door.where();
        const where = mark === 'unmarked' ? w : markFilterSubtreeProvenance(w, mark);
        let err: any = null;
        try { await t.find('deal', { where } as never); } catch (e) { err = e; }
        const message = err ? String(err.message) : '(resolved)';
        rows.push({ door: door.name, mark, code: err?.code, status: err?.status,
          leaks: door.secrets.filter((s) => message.includes(s)),
          inSink: door.secrets.filter((s) => sink.join('\n').includes(s)),
          message: message.slice(0, 240) });
      }
    }
    writeFileSync(OUT, JSON.stringify(rows, null, 1));
  });
});
