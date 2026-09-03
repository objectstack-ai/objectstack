// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The verify runner — executes derived proofs against a live dogfood stack.
//
// This is what a consumer (a framework example OR a third-party app like hotcrm)
// would run: boot my app in-process, auto-derive a runtime contract from my
// metadata, exercise it through the real HTTP surface, and tell me where the
// declared behavior doesn't actually hold at runtime.


import type { VerifyStack } from './harness.js';
import { deriveCrudCases, fillRelationalRefs, type CrudCase } from './derive.js';

export interface ObjectVerifyResult {
  object: string;
  status: 'verified' | 'fidelity-gaps' | 'create-failed' | 'read-failed' | 'skipped' | 'needs-fixture';
  checked?: number;
  reason?: string;
  code?: number;
  detail?: string;
  mismatches?: Array<{ field: string; type: string; wrote: unknown; read: unknown }>;
}

export interface VerifyReport {
  app: string;
  results: ObjectVerifyResult[];
  summary: {
    objects: number;
    verified: number;
    fidelityGaps: number;
    createFailed: number;
    needsFixture: number;
    readFailed: number;
    skipped: number;
    mismatchTotal: number;
  };
}

function setEqual(a: unknown, b: unknown[]): boolean {
  if (!Array.isArray(a)) return false;
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Run auto-derived CRUD round-trip proofs for every object in `config`, as the
 * authenticated `token`, against the live `stack`. Returns a structured report;
 * never throws on a per-object failure (collects them).
 */
export async function runCrudVerification(
  stack: VerifyStack,
  token: string,
  config: any,
): Promise<VerifyReport> {
  const cases = deriveCrudCases(config);
  const results: ObjectVerifyResult[] = [];
  // Registry of created record ids, threaded so a dependent object's required
  // relation is filled with a real target id (topological order guarantees the
  // target was created first). One instance per object — reused across refs.
  const createdIds = new Map<string, string>();

  for (const c of cases as CrudCase[]) {
    if (c.blocked) {
      results.push({ object: c.object, status: 'skipped', reason: c.blocked });
      continue;
    }
    const { body, missing } = fillRelationalRefs(c, createdIds);
    if (missing) {
      results.push({ object: c.object, status: 'skipped', reason: missing });
      continue;
    }
    let created: Response;
    try {
      created = await stack.apiAs(token, 'POST', `/data/${c.object}`, body);
    } catch (e: any) {
      results.push({ object: c.object, status: 'create-failed', detail: String(e?.message ?? e).slice(0, 200) });
      continue;
    }
    if (created.status >= 300) {
      const text = (await created.text()).slice(0, 280);
      // A 400 validation failure means our auto-derived record didn't satisfy the
      // app's own validation rules (record-level format/json-schema/CEL) — that's
      // a fixture gap, not a platform finding. A 5xx (or crypto/driver error) is a
      // real runtime failure the app's author needs to see.
      const isValidation = created.status === 400 && /VALIDATION_FAILED|Validation failed/i.test(text);
      results.push({
        object: c.object,
        status: isValidation ? 'needs-fixture' : 'create-failed',
        code: created.status,
        detail: text,
      });
      continue;
    }
    const cj = (await created.json()) as any;
    const id = cj?.id ?? cj?.record?.id;
    if (!id) {
      results.push({ object: c.object, status: 'create-failed', detail: 'no id returned' });
      continue;
    }
    createdIds.set(c.object, String(id));

    const got = await stack.apiAs(token, 'GET', `/data/${c.object}/${id}`);
    if (got.status !== 200) {
      results.push({ object: c.object, status: 'read-failed', code: got.status });
      continue;
    }
    const rec = ((await got.json()) as any)?.record ?? {};

    const mismatches: ObjectVerifyResult['mismatches'] = [];
    for (const a of c.asserts ?? []) {
      const actual = rec[a.field];
      const ok = a.kind === 'set' ? setEqual(actual, a.value as unknown[]) : deepEqual(actual, a.value);
      if (!ok) mismatches.push({ field: a.field, type: a.type, wrote: a.value, read: actual });
    }
    results.push({
      object: c.object,
      status: mismatches.length ? 'fidelity-gaps' : 'verified',
      checked: (c.asserts ?? []).length,
      ...(mismatches.length ? { mismatches } : {}),
    });
  }

  const summary = {
    objects: results.length,
    verified: results.filter((r) => r.status === 'verified').length,
    fidelityGaps: results.filter((r) => r.status === 'fidelity-gaps').length,
    createFailed: results.filter((r) => r.status === 'create-failed').length,
    needsFixture: results.filter((r) => r.status === 'needs-fixture').length,
    readFailed: results.filter((r) => r.status === 'read-failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    mismatchTotal: results.reduce((n, r) => n + (r.mismatches?.length ?? 0), 0),
  };
  return { app: config?.manifest?.id ?? config?.manifest?.namespace ?? 'app', results, summary };
}

/** Pretty one-line-per-object summary for logs. */
export function formatReport(report: VerifyReport): string {
  const lines: string[] = [`\n=== objectstack verify — ${report.app} ===`];
  for (const r of report.results) {
    if (r.status === 'verified') lines.push(`  ✓ ${r.object}  (${r.checked} fields)`);
    else if (r.status === 'fidelity-gaps') {
      lines.push(`  ⚠ ${r.object}  ${r.mismatches!.length} fidelity gap(s):`);
      for (const m of r.mismatches!) lines.push(`      ${m.field} <${m.type}>: wrote ${JSON.stringify(m.wrote)} → read ${JSON.stringify(m.read)}`);
    }
    else if (r.status === 'skipped') lines.push(`  – ${r.object}  skipped: ${r.reason}`);
    else if (r.status === 'needs-fixture') lines.push(`  ~ ${r.object}  needs-fixture (app validation rejected the auto-record): ${(r.detail ?? '').slice(0,120)}`);
    else lines.push(`  ✗ ${r.object}  ${r.status}${r.code ? ` (${r.code})` : ''}: ${r.detail ?? ''}`);
  }
  const s = report.summary;
  lines.push(`  ── ${s.verified} verified, ${s.fidelityGaps} gaps, ${s.createFailed + s.readFailed} FAILED, ${s.needsFixture} needs-fixture, ${s.skipped} skipped (${s.mismatchTotal} mismatches)`);
  return lines.join('\n');
}
