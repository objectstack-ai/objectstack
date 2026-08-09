// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6640 — the historical import, end to end, through the REAL DataProtocol
 * ingress.
 *
 * `runImport` with `treatAsHistorical: true` puts `preserveAudit: true` on the
 * write context (pinned next door in `import-runner-historical.test.ts`) and
 * then creates through `p.createData`. That call lands in
 * `stripReadonlyForInsert` — the entry that has never read `preserveAudit` —
 * so an author-declared `readonly` business column survived on the rows the
 * import UPDATED and vanished from the rows it CREATED. One import, two
 * answers.
 *
 * This file exists because every pre-existing `preserveAudit` pin drives
 * `engine.insert` directly and therefore cannot see the ingress at all; the
 * ruling's test note makes going through the real entry binding. So the
 * protocol here is a real `ObjectStackProtocolImplementation` over a mock
 * ENGINE, not a mock protocol: the runner, the ingress strip and the loud
 * signal are all the shipped code, and only the storage below them is faked.
 *
 * What it pins is the ruling's landing, not a wish: the create-side strip is
 * UNCHANGED (`preserveAudit` is an UPDATE-path exemption), the import still
 * SUCCEEDS, and the request that was silently ignored is now reported.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './export-format.js';

const TICKET = {
  name: 'ticket',
  fields: {
    subject: { name: 'subject', type: 'text' },
    // The author-declared business `readonly` column the issue names.
    closed_at: { name: 'closed_at', type: 'datetime', readonly: true },
  },
};

const metaMap = new Map<string, ExportFieldMeta>([
  ['subject', { name: 'subject', type: 'text' }],
  ['closed_at', { name: 'closed_at', type: 'datetime' }],
]);

/** A real protocol over a mock engine — everything above the store is shipped code. */
function makeRealProtocol() {
  const inserted: any[] = [];
  const engine = {
    registry: { getObject: (n: string) => (n === 'ticket' ? TICKET : undefined) },
    insert: vi.fn(async (_object: string, data: any) => {
      const rows = Array.isArray(data) ? data : [data];
      const out = rows.map((r, i) => { const rec = { id: `t-${inserted.length + i + 1}`, ...r }; return rec; });
      inserted.push(...out);
      return Array.isArray(data) ? out : out[0];
    }),
    find: vi.fn(async () => []),
  };
  const impl = new ObjectStackProtocolImplementation(engine as any);
  // `runImport` needs find/create only for an insert-mode run; delegate both to
  // the real implementation so the ingress is genuinely on the path.
  const p: ImportProtocolLike = {
    findData: (args: any) => impl.findData(args as any) as any,
    createData: (args: any) => impl.createData(args as any) as any,
    updateData: (args: any) => impl.updateData(args as any) as any,
  };
  return { p, inserted };
}

const baseOpts = {
  objectName: 'ticket',
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

const ROWS = [
  { subject: 'legacy A', closed_at: '2019-04-01T00:00:00Z' },
  { subject: 'legacy B', closed_at: '2019-05-02T00:00:00Z' },
];

describe('runImport (treatAsHistorical) → the REAL insert ingress (#6640)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('still CREATES every row — the loud signal replaces the silence, not the flow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { p, inserted } = makeRealProtocol();

    const summary = await runImport({ ...baseOpts, p, rows: ROWS, treatAsHistorical: true });

    // THE measurement behind the error-vs-warning half of the ruling. A hard
    // refusal at the ingress would land here as {created: 0, errors: 2} —
    // `runImport` collects a write error into a per-row failure instead of
    // aborting — which is the "breaks the shipped treatAsHistorical flow for
    // new rows" condition the ruling names. A warning keeps this green.
    expect(summary.created, 'historical import of new rows still succeeds').toBe(2);
    expect(summary.errors, 'no row was refused').toBe(0);

    // The enforcement is unchanged: the exemption really is UPDATE-only.
    expect(inserted).toHaveLength(2);
    for (const rec of inserted) {
      expect(rec, 'author-declared readonly column stripped on the CREATE half').not.toHaveProperty('closed_at');
    }

    // …and the ignored request is now reported, by name and with the rule.
    const messages = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('preserveAudit'));
    expect(messages.length, 'the historical create path emits the signal').toBeGreaterThan(0);
    expect(messages[0]).toContain('preserveAudit is UPDATE-only and was IGNORED on this INSERT');
    expect(messages[0]).toContain('closed_at');
    expect(messages[0]).toContain('context.isSystem');
  });

  it('a NON-historical import of the same rows is stripped just as quietly as before (#3043)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { p, inserted } = makeRealProtocol();

    const summary = await runImport({ ...baseOpts, p, rows: ROWS, treatAsHistorical: false });

    expect(summary.created).toBe(2);
    for (const rec of inserted) expect(rec).not.toHaveProperty('closed_at');
    // No exemption was requested, so there is no ignored request to report —
    // the new signal is specific to the contradiction, not to the strip.
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('preserveAudit'))).toHaveLength(0);
  });

  it('the same import from a SYSTEM context replays the archival value — the documented remedy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { p, inserted } = makeRealProtocol();

    const summary = await runImport({
      ...baseOpts, p, rows: ROWS, treatAsHistorical: true, context: { isSystem: true },
    });

    expect(summary.created).toBe(2);
    // Compare the INSTANT, not its spelling: the runner's cell coercion
    // canonicalizes a datetime cell (`…T00:00:00Z` → `…T00:00:00.000Z`) before
    // the write, which is orthogonal to what this pins — that the archival
    // value reaches the insert at all instead of being stripped.
    expect(inserted[0].closed_at, 'system context is how archival readonly facts reach a create')
      .toBeDefined();
    expect(new Date(inserted[0].closed_at).toISOString()).toBe(new Date('2019-04-01T00:00:00Z').toISOString());
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('preserveAudit'))).toHaveLength(0);
  });
});
