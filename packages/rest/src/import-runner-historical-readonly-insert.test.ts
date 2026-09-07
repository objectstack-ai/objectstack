// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6640 — the historical import, end to end, through the REAL write path.
 *
 * `runImport` with `treatAsHistorical: true` puts `preserveAudit: true` on the
 * write context (pinned next door in `import-runner-historical.test.ts`) and
 * then creates through `p.createData`. The create-side static-`readonly` strip
 * has never read `preserveAudit`, so an author-declared `readonly` business
 * column survived on the rows the import UPDATED and vanished from the rows it
 * CREATED. One import, two answers — and the 2026-08-08 ruling kept the
 * enforcement and narrowed the contract to it, with the ignored request made
 * loud.
 *
 * [#14147] WHERE that strip lives moved — from the DataProtocol ingress into
 * `engine.insert` (maintainer ruling, 2026-09-03) — and WHAT it does did not.
 * So this file's harness moved with it: the engine below the protocol is a REAL
 * `ObjectQL` over a recording driver, not a mock that records payloads. That is
 * not incidental. A mock engine cannot strip, so under the new architecture the
 * old harness would have reported the historical column landing on a create and
 * called it green — the same class of blind spot the ruling's own test note was
 * written against ("every pre-existing `preserveAudit` pin drives
 * `engine.insert` directly and therefore cannot see the ingress at all").
 *
 * What it pins is the ruling's landing, not a wish: the create-side strip is
 * UNCHANGED (`preserveAudit` is an UPDATE-path exemption), the import still
 * SUCCEEDS, and the request that was silently ignored is reported by name.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from '@objectstack/objectql';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './export-format.js';

const TICKET = {
  name: 'ticket',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    subject: { name: 'subject', type: 'text' },
    // The author-declared business `readonly` column the issue names.
    closed_at: { name: 'closed_at', type: 'datetime', readonly: true },
  },
};

const metaMap = new Map<string, ExportFieldMeta>([
  ['subject', { name: 'subject', type: 'text' }],
  ['closed_at', { name: 'closed_at', type: 'datetime' }],
]);

/** Captures the engine's own WARN channel — where the loud half now prints. */
function makeCapturingLogger() {
  const lines: string[] = [];
  const logger: any = {
    lines,
    trace() {}, fatal() {}, debug() {}, info() {},
    warn(msg: string) { lines.push(String(msg)); },
    error() {},
    child() { return logger; },
  };
  return logger;
}

/** Records the rows that actually reach the store — nothing above it is faked. */
function makeRecordingDriver(inserted: any[]) {
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(_o: string, data: Record<string, unknown>) {
      const rec = { id: `t-${inserted.length + 1}`, ...data };
      inserted.push(rec);
      return rec;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => driver.create(o, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

/** A real protocol over a REAL engine — everything above the store is shipped code. */
async function makeRealProtocol() {
  const inserted: any[] = [];
  const logger = makeCapturingLogger();
  const engine = new ObjectQL({ logger });
  engine.registerDriver(makeRecordingDriver(inserted), true);
  await engine.init();
  engine.registry.registerObject(TICKET as any, 'test');
  const impl = new ObjectStackProtocolImplementation(engine as any);
  // `runImport` needs find/create only for an insert-mode run; delegate both to
  // the real implementation so the ingress is genuinely on the path.
  const p: ImportProtocolLike = {
    findData: (args: any) => impl.findData(args as any) as any,
    createData: (args: any) => impl.createData(args as any) as any,
    updateData: (args: any) => impl.updateData(args as any) as any,
  };
  return { p, inserted, logger };
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
    const { p, inserted, logger } = await makeRealProtocol();

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
    const messages = logger.lines.filter((m: string) => m.includes('preserveAudit is UPDATE-only'));
    expect(messages.length, 'the historical create path emits the signal').toBeGreaterThan(0);
    expect(messages[0]).toContain('preserveAudit is UPDATE-only and was IGNORED on this INSERT');
    expect(messages[0]).toContain('closed_at');
    expect(messages[0]).toContain('context.isSystem');
  });

  it('a NON-historical import of the same rows is stripped just as quietly as before (#3043)', async () => {
    const { p, inserted, logger } = await makeRealProtocol();

    const summary = await runImport({ ...baseOpts, p, rows: ROWS, treatAsHistorical: false });

    expect(summary.created).toBe(2);
    for (const rec of inserted) expect(rec).not.toHaveProperty('closed_at');
    // No exemption was requested, so there is no ignored request to report —
    // the new signal is specific to the contradiction, not to the strip.
    expect(logger.lines.filter((m: string) => m.includes('preserveAudit is UPDATE-only'))).toHaveLength(0);
  });

  it('the same import from a SYSTEM context replays the archival value — the documented remedy', async () => {
    const { p, inserted, logger } = await makeRealProtocol();

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
    expect(logger.lines.filter((m: string) => m.includes('preserveAudit is UPDATE-only'))).toHaveLength(0);
  });
});
