// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3479 — a "historical" import carries curated established facts (a batch of
 * already-`closed` tickets, `closed_won` deals), so it must skip the object's
 * `state_machine` rule: otherwise `initialStates` rejects every mid-lifecycle
 * row on insert. runImport owns the option→context mapping — it sets
 * `skipStateMachine` on the write context iff `treatAsHistorical` is set. A
 * normal import must NOT set it (the FSM still applies).
 *
 * The engine's actual exemption behavior (skipStateMachine → skip the rule) is
 * tested in @objectstack/objectql (engine.test.ts); this pins the wiring the
 * import runner owns.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './export-format.js';

const metaMap = new Map<string, ExportFieldMeta>([['name', { name: 'name', type: 'text' }]]);

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

/** Provider mock that records the write context every persist call received. */
function makeProvider() {
  const contexts: any[] = [];
  let idc = 0;
  const p: ImportProtocolLike = {
    findData: vi.fn(async () => []),
    createData: vi.fn(async (args: any) => {
      contexts.push(args.context);
      return { id: `d${++idc}`, ...args.data };
    }),
    updateData: vi.fn(async (args: any) => {
      contexts.push(args.context);
      return { id: args.id, ...args.data };
    }),
    createManyData: vi.fn(async (args: any) => {
      contexts.push(args.context);
      return { records: args.records.map((r: any) => ({ id: `d${++idc}`, ...r })) };
    }),
  };
  return { p, contexts };
}

describe('runImport — historical import skips the state machine (#3479)', () => {
  it('sets skipStateMachine AND preserveAudit on the write context when treatAsHistorical is true (#3493)', async () => {
    const { p, contexts } = makeProvider();
    const summary = await runImport({
      ...baseOpts, p, rows: [{ name: 'a' }, { name: 'b' }], treatAsHistorical: true,
    });
    expect(summary.created).toBe(2);
    expect(contexts.length).toBeGreaterThan(0);
    for (const ctx of contexts) {
      expect(ctx?.skipStateMachine).toBe(true);
      expect(ctx?.preserveAudit).toBe(true);
    }
  });

  it('does NOT set skipStateMachine / preserveAudit for a normal import (auto-stamp + FSM still apply)', async () => {
    const { p, contexts } = makeProvider();
    await runImport({ ...baseOpts, p, rows: [{ name: 'a' }], treatAsHistorical: false });
    expect(contexts.length).toBeGreaterThan(0);
    for (const ctx of contexts) {
      expect(ctx?.skipStateMachine).toBeUndefined();
      expect(ctx?.preserveAudit).toBeUndefined();
    }
  });

  it('defaults to off when the option is omitted (safe default — walk the FSM)', async () => {
    const { p, contexts } = makeProvider();
    await runImport({ ...baseOpts, p, rows: [{ name: 'a' }] });
    expect(contexts.length).toBeGreaterThan(0);
    for (const ctx of contexts) expect(ctx?.skipStateMachine).toBeUndefined();
  });

  it('leaves the automation toggle independent (skipAutomations still tracks runAutomations)', async () => {
    const { p, contexts } = makeProvider();
    await runImport({ ...baseOpts, p, rows: [{ name: 'a' }], treatAsHistorical: true, runAutomations: true });
    for (const ctx of contexts) {
      expect(ctx?.skipStateMachine).toBe(true);
      expect(ctx?.skipAutomations).toBe(false); // runAutomations:true ⇒ don't skip
    }
  });
});
