/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check` refuses the three chart keys objectui#8760 retired — the
 * AUTHORING-TIME half of that retirement, on the published surface.
 *
 * ## Why this pin is the one that matters
 *
 * The card's grading rests on a comparison: "an unknown key is refused loudly
 * at authoring time; a registered-but-unfulfilled key passes every check, is
 * taught by the documentation, and fails only at render in front of a user."
 * `line-chart`, `area-chart` and `advanced-chart` were on the wrong side of it.
 * They were `registerLazy` stubs in `apps/console` that
 * `@object-ui/plugin-charts` never fulfilled, and a stub is enough to put a key
 * into `getKnownTypes()` — so the derivation behind `KNOWN_SCHEMA_TYPES`
 * carried all three (measured on `b775500af`: `line-chart`, `area-chart`,
 * `advanced-chart` and their three `plugin-charts:`-namespaced spellings) and
 * this command was SILENT on a document that could only ever paint a skeleton.
 *
 * So the outcome under test is the one an author observes from outside the
 * repository: the command now NAMES the type. Not "the key left the snapshot" —
 * that is the mechanism, and
 * `scripts/__tests__/known-schema-types-derivation-5115.test.ts` already holds
 * it against the derivation.
 *
 * ## The controls
 *
 * Silence is the pre-repair reading, so a test that only asserts warnings could
 * pass against a command that warns about everything. Two fulfilled variants
 * from the SAME stub sweep — `bar-chart` and `chart:bar` (the `pie-chart`
 * control until objectui#10859 batch 8 retired that key) — must stay silent,
 * and so must the spelling the corrected documentation now teaches,
 * `{ "type": "chart", "chartType": "line" }`. Each is checked on its own: all
 * three are non-zero readings (a real registered key, judged), not an absence
 * that would read the same either way.
 *
 * Fixtures live under `os.tmpdir()` and carry the `className` marker, for the
 * two reasons `check-known-types.test.ts` states at length: a fixture inside
 * this workspace would be scanned by the repo's own `pnpm check`, and a file
 * with no ObjectUI marker key is not judged at all (objectui#5127) — which
 * would leave the silence assertions green while measuring nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { check } from '../commands/check.js';
import { KNOWN_SCHEMA_TYPES } from '../utils/known-schema-types.js';

let cwd: string;
let lines: string[];
let restoreLog: () => void;

function writeSchema(name: string, body: Record<string, unknown>): void {
  writeFileSync(join(cwd, name), JSON.stringify({ className: 'p-0', ...body }));
}

/** The escape byte chalk opens a CSI sequence with, spelled rather than typed. */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function unknownTypeWarnings(): string[] {
  return lines.map((l) => l.replace(ANSI, '')).filter((l) => l.includes('Unknown schema type'));
}

const RETIRED = ['line-chart', 'area-chart', 'advanced-chart'] as const;

const ROWS = [
  { month: 'Jan', revenue: 4000 },
  { month: 'Feb', revenue: 3000 },
];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-8760-'));
  lines = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  restoreLog = () => {
    console.log = original;
  };
});

afterEach(() => {
  restoreLog();
  rmSync(cwd, { recursive: true, force: true });
});

describe('objectui#8760 — `objectui check` names the retired chart keys', () => {
  it.each(RETIRED)('warns about `%s`, which the charts plugin never registered', async (type) => {
    writeSchema(`${type}.json`, {
      type,
      data: ROWS,
      xAxisKey: 'month',
      series: [{ dataKey: 'revenue' }],
    });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining(`Unknown schema type "${type}" in ${type}.json`),
    ]);
  });

  it.each(RETIRED)('`%s` is gone from the shipped vocabulary, bare and namespaced', (type) => {
    // Non-vacuity for the assertion beside it: the snapshot must be a real,
    // populated set, or "does not contain" is true of everything.
    expect(KNOWN_SCHEMA_TYPES.length).toBeGreaterThan(100);
    expect(KNOWN_SCHEMA_TYPES).not.toContain(type);
    expect(KNOWN_SCHEMA_TYPES).not.toContain(`plugin-charts:${type}`);
  });
});

describe('objectui#8760 — CONTROL: what still passes, each verified on its own', () => {
  it.each(['bar-chart', 'chart:bar'])(
    '`%s` — a fulfilled variant from the same sweep — stays silent',
    async (type) => {
      // Individually non-zero on both sides: each is a key the charts plugin
      // really registers, so it was judged and accepted before this change and
      // is judged and accepted after it.
      expect(KNOWN_SCHEMA_TYPES).toContain(type);
      expect(KNOWN_SCHEMA_TYPES).toContain(`plugin-charts:${type}`);
      writeSchema(`${type}.json`, {
        type,
        data: ROWS,
        xAxisKey: 'month',
        dataKey: 'revenue',
        series: [{ dataKey: 'revenue' }],
      });
      await check(cwd);
      expect(unknownTypeWarnings()).toEqual([]);
    },
  );

  it('the spelling the corrected dashboard doc teaches is accepted', async () => {
    // `content/docs/plugins/plugin-dashboard.mdx` taught `"type": "line-chart"`
    // and now teaches this. The repair is only complete if the replacement
    // survives the very command the removed key was hiding from.
    expect(KNOWN_SCHEMA_TYPES).toContain('chart');
    writeSchema('sales-trend.json', {
      type: 'chart',
      chartType: 'line',
      data: ROWS,
      xAxisKey: 'month',
      series: [{ dataKey: 'revenue' }],
    });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
  });

  it('the instrument can still hear a warning at all', async () => {
    // The firing control for every silence above. Without it, a command that
    // stopped judging types would satisfy all four of them.
    writeSchema('nonsense.json', { type: 'not-a-real-component-zzz' });
    await check(cwd);
    expect(unknownTypeWarnings()).toHaveLength(1);
  });
});
