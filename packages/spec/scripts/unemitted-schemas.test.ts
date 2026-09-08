// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the never-published ratchet's adjudication and its cause classifier
 * (#16431), separately from the generator that feeds them.
 *
 * `build-schemas.ts` is a top-level script with side effects, so this logic is
 * extracted for the same reason `def-key-collisions` (#5832) and `zod-graph`
 * (#5317) were: the only other way to assert on it is to run the whole
 * generator, and the end-to-end cases that do (in
 * `build-schemas-check-mode.test.ts`) cost a spawn each.
 *
 * The properties that matter, and why each one is a test rather than a comment:
 *
 *  1. GROWTH IS REFUSED — an un-emitted export absent from the ledger is the
 *     one thing this ratchet exists for. Everything else here defends that
 *     signal against a ledger that has stopped describing the tree.
 *  2. SHRINK-ONLY IN BOTH DIRECTIONS — an entry whose export now emits, and an
 *     entry naming no export at all, are separate reports because their PR
 *     descriptions differ ("we fixed it" vs "it was renamed"), even though the
 *     remedy is the same deleted line.
 *  3. THE CAUSE IS RE-CHECKED — the `reason` prose is written about the cause,
 *     so an entry whose cause moved is prose describing a repair nobody made.
 *  4. A REASON IS REQUIRED — a ledger that records only that a member EXISTS is
 *     a count wearing a ledger's shape, and cannot show which member a new
 *     arrival replaced.
 *
 * Plus the classifier's own boundary: an unrecognised message must degrade to
 * `other`, never throw. A Zod upgrade that re-words a message has to surface as
 * a ledger mismatch naming the raw text — a crash inside the classifier would
 * take the whole generator down for a wording change.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  UNEMITTED_BASELINE_FILE,
  causeOf,
  checkUnemittedSchemas,
  countByCause,
  hasUnemittedProblems,
  ledgerKey,
  readUnemittedBaseline,
  type UnemittedBaseline,
  type UnemittedSkip,
} from './lib/unemitted-schemas';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');

const FUNCTION_MSG = 'Function types cannot be represented in JSON Schema';
const DATE_MSG = 'Date cannot be represented in JSON Schema';

const skip = (namespace: string, exportKey: string, message: string): UnemittedSkip => ({
  namespace,
  exportKey,
  message,
});

const ledger = (entries: UnemittedBaseline['entries']): UnemittedBaseline => ({ entries });

const check = (args: {
  skips: readonly UnemittedSkip[];
  exported: readonly string[];
  baseline: UnemittedBaseline;
}) =>
  checkUnemittedSchemas({
    skips: args.skips,
    exportedZodKeys: new Set(args.exported),
    baseline: args.baseline,
  });

describe('causeOf — the unrepresentable family, by distinctive word', () => {
  it.each([
    [FUNCTION_MSG, 'function'],
    [DATE_MSG, 'date'],
    ['Custom types cannot be represented in JSON Schema', 'custom'],
    ['Undefined cannot be represented in JSON Schema', 'undefined'],
    ['Literal `undefined` cannot be represented in JSON Schema', 'undefined'],
    ['BigInt cannot be represented in JSON Schema', 'bigint'],
    ['BigInt literals cannot be represented in JSON Schema', 'bigint'],
    ['Symbols cannot be represented in JSON Schema', 'symbol'],
    ['Void cannot be represented in JSON Schema', 'void'],
    ['NaN cannot be represented in JSON Schema', 'nan'],
    ['Transforms cannot be represented in JSON Schema', 'transform'],
    ['Map cannot be represented in JSON Schema', 'map'],
    ['Set cannot be represented in JSON Schema', 'set'],
  ])('classifies %j as %s', (message, expected) => {
    expect(causeOf(message)).toBe(expected);
  });

  it('degrades an unrecognised message to `other` instead of throwing', () => {
    // A Zod upgrade that re-words a message must fail as a LEDGER mismatch
    // naming the raw text, never as a crash inside the classifier.
    expect(causeOf('Quaternions cannot be represented in JSON Schema')).toBe('other');
  });
});

describe('checkUnemittedSchemas — growth is refused, and the ledger must keep describing the tree', () => {
  it('reports an un-emitted export the ledger does not name — the growth this ratchet exists for', () => {
    const problems = check({
      skips: [skip('Data', 'NewThingSchema', DATE_MSG)],
      exported: ['Data.NewThingSchema', 'Data.EmittedSchema'],
      baseline: ledger({}),
    });

    expect(problems.undeclared.map(ledgerKey)).toEqual(['Data.NewThingSchema']);
    expect(hasUnemittedProblems(problems)).toBe(true);
  });

  it('is silent when the ledger names exactly the population, with matching causes', () => {
    // The negative control. Without it, "always report something" would satisfy
    // every other case in this file.
    const problems = check({
      skips: [skip('Data', 'KnownSchema', FUNCTION_MSG)],
      exported: ['Data.KnownSchema', 'Data.EmittedSchema'],
      baseline: ledger({ 'Data.KnownSchema': { cause: 'function', reason: 'a code interface' } }),
    });

    expect(hasUnemittedProblems(problems)).toBe(false);
    expect(problems).toEqual({
      undeclared: [],
      repaired: [],
      vanished: [],
      miscaused: [],
      unreasoned: [],
    });
  });

  it('separates a REPAIRED entry from a VANISHED one — same remedy, different PR', () => {
    const problems = check({
      skips: [],
      // `Data.FixedSchema` still exists and now emits; `Data.GoneSchema` is not
      // an export any more.
      exported: ['Data.FixedSchema'],
      baseline: ledger({
        'Data.FixedSchema': { cause: 'date', reason: 'was unprojectable' },
        'Data.GoneSchema': { cause: 'function', reason: 'was a code interface' },
      }),
    });

    expect(problems.repaired).toEqual(['Data.FixedSchema']);
    expect(problems.vanished).toEqual(['Data.GoneSchema']);
  });

  it('reports an entry whose recorded cause this build does not observe', () => {
    const problems = check({
      skips: [skip('Data', 'MovedSchema', FUNCTION_MSG)],
      exported: ['Data.MovedSchema'],
      baseline: ledger({ 'Data.MovedSchema': { cause: 'date', reason: 'the date comparand' } }),
    });

    expect(problems.miscaused).toEqual([
      { key: 'Data.MovedSchema', recorded: 'date', observed: 'function', message: FUNCTION_MSG },
    ]);
    // And it is NOT reported as undeclared: the entry exists, it is just wrong.
    expect(problems.undeclared).toEqual([]);
  });

  it('reports an empty reason, whitespace included', () => {
    const problems = check({
      skips: [skip('Data', 'BlankSchema', DATE_MSG)],
      exported: ['Data.BlankSchema'],
      baseline: ledger({ 'Data.BlankSchema': { cause: 'date', reason: '   ' } }),
    });

    expect(problems.unreasoned).toEqual(['Data.BlankSchema']);
  });

  it('keys by EXPORT, not by schema name — an alias pair is two members', () => {
    // `System.BatchTask` and `System.BatchTaskSchema` are one Zod object reached
    // by two export names, and NEITHER reaches a published surface. The unit is
    // the export, because that is what an author or a `gen:docs` run looks up.
    const problems = check({
      skips: [skip('System', 'Thing', FUNCTION_MSG), skip('System', 'ThingSchema', FUNCTION_MSG)],
      exported: ['System.Thing', 'System.ThingSchema'],
      baseline: ledger({ 'System.Thing': { cause: 'function', reason: 'alias' } }),
    });

    expect(problems.undeclared.map(ledgerKey)).toEqual(['System.ThingSchema']);
  });
});

describe('countByCause — the population report groups by family, widest first', () => {
  it('counts each family and orders by size, then name', () => {
    const counts = countByCause([
      skip('Data', 'A', FUNCTION_MSG),
      skip('Data', 'B', DATE_MSG),
      skip('Data', 'C', FUNCTION_MSG),
      skip('Data', 'D', 'Custom types cannot be represented in JSON Schema'),
    ]);

    expect([...counts]).toEqual([
      ['function', 2],
      ['custom', 1],
      ['date', 1],
    ]);
  });
});

describe('the committed ledger', () => {
  it('parses, and every entry carries a non-empty reason', () => {
    const baseline = readUnemittedBaseline(PKG);
    expect(baseline, `packages/spec/${UNEMITTED_BASELINE_FILE} is missing`).not.toBeNull();

    const entries = Object.entries(baseline!.entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, entry] of entries) {
      expect(entry.reason.trim(), `${key} has an empty reason`).not.toBe('');
      expect(key, `${key} is not \`Namespace.ExportKey\``).toMatch(/^[A-Z][A-Za-z0-9]*\.[A-Za-z0-9_]+$/);
    }
  });

  it('rejects a malformed entry loudly rather than reading it as empty', () => {
    // A ledger that silently reads as `{}` is a ratchet that silently accepts
    // the whole population — the state this file exists to end.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unemitted-ledger-fixture-'));
    try {
      fs.writeFileSync(
        path.join(dir, UNEMITTED_BASELINE_FILE),
        JSON.stringify({ entries: { 'Data.X': { cause: 'date' } } }),
      );
      expect(() => readUnemittedBaseline(dir)).toThrow(/needs a string `cause` and a string `reason`/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for an absent ledger, so the generator can report it in its own words', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unemitted-ledger-absent-'));
    try {
      expect(readUnemittedBaseline(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
