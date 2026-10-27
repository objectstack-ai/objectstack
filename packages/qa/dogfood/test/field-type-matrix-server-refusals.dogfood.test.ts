// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.field-type-matrix` (#26573): the api clauses
// `field-zoo-roundtrip.dogfood.test.ts` does not assert, at the REST data door
// of the booted showcase, as shipped.
//
//   acceptance[2], negative[0] — constrained types refuse invalid input with a
//     named error: an out-of-set `f_select` is 400 VALIDATION_FAILED naming
//     f_select with invalid_option; a create with no `name` names name with
//     required; the zoo's row count does not grow.
//   acceptance[5], negative[1] — the REFUSAL half of the relational types: a
//     fabricated id in f_lookup, f_master_detail or f_tree is refused naming
//     that field with reference_not_found, and nothing is stored. The
//     round-trip suite seeds real ids only, so this half was the run's.
//   acceptance[6] — summary on its real carriers (fixtures.knownGaps[0]): every
//     seeded invoice's `total` equals the sum of its lines' amounts, and the
//     seeded EXP-2001 reads total_amount 1500.5 and the summaryOperations.filter
//     variant approved_amount 960.
//
// The widget clause (acceptance[1]) stays a browser leg.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const ZOO = 'showcase_field_zoo';

type Answer = { status: number; json: any };

describe('records-forms.field-type-matrix — the server refusals and the summary carriers over REST', () => {
  let stack: VerifyStack;
  let token = '';
  let projectId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const fieldCodes = (json: any) => (json?.fields ?? []).map((f: any) => [f.field, f.code]);
  const zooCount = async () => (await stack.rows(ZOO, {})).length;
  const listOf = async (object: string, filter: unknown[]): Promise<any[]> => {
    const res = await call('GET', `/data/${object}?$filter=${encodeURIComponent(JSON.stringify(filter))}&$top=200`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.records ?? res.json.data ?? res.json.value ?? res.json;
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const [project] = await stack.rows('showcase_project', {});
    projectId = String(project.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[2], negative[0]: an out-of-set select is refused invalid_option, and the row count does not grow', async () => {
    const before = await zooCount();
    const res = await call('POST', `/data/${ZOO}`, { name: uniq('ftm-select'), f_master_detail: projectId, f_select: 'not_an_option' });
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    expect(res.json.code).toBe('VALIDATION_FAILED');
    expect(fieldCodes(res.json)).toEqual([['f_select', 'invalid_option']]);
    expect(await zooCount()).toBe(before);

    // Control: the in-set value is admitted on the same door.
    const ok = await call('POST', `/data/${ZOO}`, { name: uniq('ftm-select-ok'), f_master_detail: projectId, f_select: 'high' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
  });

  it('acceptance[2]: a create with no name is refused naming name with required, and the row count does not grow', async () => {
    const before = await zooCount();
    const res = await call('POST', `/data/${ZOO}`, { f_master_detail: projectId });
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    expect(res.json.code).toBe('VALIDATION_FAILED');
    expect(fieldCodes(res.json)).toEqual([['name', 'required']]);
    expect(await zooCount()).toBe(before);
  });

  it.each([
    ['f_lookup', { f_lookup: 'no_such_account_26573' }],
    ['f_master_detail', { f_master_detail: 'no_such_project_26573' }],
    ['f_tree', { f_tree: 'no_such_zoo_row_26573' }],
  ])('acceptance[5], negative[1]: a dangling %s is refused reference_not_found, and nothing is stored', async (field, bad) => {
    const name = uniq(`ftm-${field}`);
    const res = await call('POST', `/data/${ZOO}`, { name, f_master_detail: projectId, ...bad });
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    expect(fieldCodes(res.json)).toEqual([[field, 'reference_not_found']]);
    expect(await stack.rows(ZOO, { name })).toHaveLength(0);
  });

  it('acceptance[6]: every seeded invoice total is the server-side sum of its lines', async () => {
    const invoices = await listOf('showcase_invoice', [['name', 'startswith', 'INV-']]);
    expect(invoices.length, 'the showcase seed carries invoices').toBeGreaterThan(0);
    for (const invoice of invoices) {
      const lines = await listOf('showcase_invoice_line', [['invoice', '=', invoice.id]]);
      const sum = lines.reduce((acc: number, l: any) => acc + Number(l.amount ?? 0), 0);
      expect(Number(invoice.total ?? 0), `${invoice.name}: ${lines.length} line(s)`).toBeCloseTo(sum, 2);
    }
  });

  it('acceptance[6]: EXP-2001 reads total 1500.5 and the filtered approved roll-up 960', async () => {
    const [report] = await listOf('showcase_expense_report', [['name', '=', 'EXP-2001']]);
    expect(report, 'the showcase seed carries EXP-2001').toBeTruthy();
    expect(Number(report.total_amount)).toBeCloseTo(1500.5, 2);
    expect(Number(report.approved_amount)).toBeCloseTo(960, 2);
  });
});
