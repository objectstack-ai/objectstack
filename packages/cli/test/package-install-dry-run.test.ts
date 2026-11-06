// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [epic cloud#3652 Q3, #30884] `os package install --dry-run` — the
 * install-local body's `dryRun`, and how the command prints the runtime's
 * upgrade plan.
 *
 * Pinned:
 *  - the flag reaches the body as `dryRun: true`; without it the body carries
 *    no such key;
 *  - the answer prints as a dry run (nothing installed), each finding with
 *    the environment's reading beside it: rows in a touched column, rows a
 *    customer edited that the seed replay would overwrite, a reading that
 *    failed as "could not be read";
 *  - a runtime that ignored the key and installed is printed as the failure
 *    it is, exit 1.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import PackageInstall, { renderUpgradePlan } from '../src/commands/package/install.js';

type Answer = { ok: boolean; status: number; body: unknown };

function stubRuntime(answer: Answer): { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) sent.push(JSON.parse(init.body));
    return {
      ok: answer.ok,
      status: answer.status,
      statusText: answer.ok ? 'OK' : 'Refused',
      headers: { get: () => null },
      json: async () => answer.body,
    } as any;
  }));
  return { sent };
}

async function runInstall(args: string[]): Promise<{ out: string; exit: number | undefined }> {
  const lines: string[] = [];
  const capture = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as any);
  let exit: number | undefined;
  try {
    await PackageInstall.run(['com.acme.crm', '--url', 'http://runtime.test', ...args]);
  } catch (err: any) {
    exit = err?.oclif?.exit ?? err?.code ?? 1;
  }
  return { out: lines.join('\n'), exit };
}

const PLAN_ANSWER = {
  dryRun: true,
  manifestId: 'com.acme.crm',
  version: '2.0.0',
  installedVersion: '1.0.0',
  plan: {
    objects: { added: [], removed: ['acme_old'] },
    fields: {
      added: [{ object: 'acme_lead', field: 'account_name', type: 'text', required: false, stored: true }],
      removed: [{ object: 'acme_lead', field: 'company', type: 'text', required: false, stored: true }],
    },
    typeChanges: [{ object: 'acme_deal', field: 'amount_value', from: 'text', to: 'number', category: 'needs_confirm', renamedFrom: 'amount' }],
    declaredRenames: [{ object: 'acme_deal', from: 'amount', to: 'amount_value', fromType: 'text', toType: 'number' }],
    suspectedRenames: [{ object: 'acme_lead', field: 'company', type: 'text', candidates: [{ field: 'account_name', type: 'text' }] }],
    seeds: {
      added: [],
      removed: [],
      changed: [{ key: 'acme_stage', object: 'acme_stage', externalId: 'name', mode: 'upsert', records: 3, fromMode: 'upsert', fromRecords: 3, changed: ['records'] }],
    },
  },
  environment: {
    columns: [
      { object: 'acme_lead', field: 'company', reasons: ['removed', 'suspected_rename'], rows: 42 },
      { object: 'acme_deal', field: 'amount', reasons: ['renamed', 'type_change'], rows: null },
    ],
    removedObjects: [{ object: 'acme_old', rows: 7 }],
    seeds: [
      { key: 'acme_stage', object: 'acme_stage', mode: 'upsert', changed: true, matchedRows: 3, editedRows: 1, editedKeys: ['won'] },
      { key: 'acme_tier', object: 'acme_tier', mode: 'upsert', changed: false, matchedRows: 2, editedRows: 2, editedKeys: ['gold', 'silver'] },
    ],
  },
};

describe('os package install --dry-run (#30884)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends `dryRun: true`, and no such key without the flag', async () => {
    const { sent } = stubRuntime({ ok: true, status: 200, body: { success: true, data: PLAN_ANSWER } });
    await runInstall(['--dry-run']);
    expect(sent[0]).toMatchObject({ packageId: 'com.acme.crm', dryRun: true });

    vi.unstubAllGlobals();
    const second = stubRuntime({ ok: true, status: 200, body: { success: true, data: { manifestId: 'com.acme.crm', version: '2.0.0', hotLoaded: true } } });
    await runInstall([]);
    expect(second.sent[0]).not.toHaveProperty('dryRun');
  });

  it('prints the plan with each reading beside its finding, and says nothing was installed', async () => {
    stubRuntime({ ok: true, status: 200, body: { success: true, data: PLAN_ANSWER } });
    const { out, exit } = await runInstall(['--dry-run']);
    expect(exit).toBeUndefined();
    expect(out).toContain('Dry run — nothing was installed or written');
    expect(out).toContain('2.0.0 (installed: 1.0.0)');
    expect(out).not.toContain('Package installed');
  });

  it('the plan lines', () => {
    expect(renderUpgradePlan(PLAN_ANSWER)).toEqual([
      '  Objects',
      '    - acme_old — 7 row(s) in it; the table is not dropped',
      '  Fields',
      '    + acme_lead.account_name (text)',
      '    - acme_lead.company (text) — 42 row(s) hold a value; the column is not dropped',
      '  Renames declared by renamedFrom',
      '    acme_deal.amount → amount_value — its rows could not be read',
      '  Suspected renames (no renamedFrom links them)',
      '    acme_lead.company → account_name? — 42 row(s) hold a value; the new key would install as a new empty column. '
        + 'Declare renamedFrom on the new field and rebuild if it is a rename',
      '  Type changes',
      '    acme_deal.amount_value: text → number (needs_confirm), renamed from amount — its rows could not be read',
      '  Seed datasets',
      '    ~ acme_stage (mode upsert, 3 record(s)): records changed — 1 row(s) a customer edited would be overwritten (won)',
      '    = acme_tier (mode upsert, unchanged) — 2 row(s) a customer edited would be overwritten (gold, silver)',
    ]);
  });

  it('an empty plan says so', () => {
    expect(renderUpgradePlan({ plan: {}, environment: {} })).toEqual(['  No change to objects, fields or seed datasets.']);
  });

  it('a runtime that ignored --dry-run and installed is a failure, exit 1', async () => {
    stubRuntime({ ok: true, status: 200, body: { success: true, data: { manifestId: 'com.acme.crm', version: '2.0.0', hotLoaded: true } } });
    const { out, exit } = await runInstall(['--dry-run']);
    expect(exit).toBe(1);
    expect(out).toContain('does not support a dry run: it ignored `--dry-run` and INSTALLED com.acme.crm@latest');
  });
});
