// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` — the guidance it prints for the `engine-*` ADR-0087
 * semantic entries states each lesson in words and carries no tracker number.
 *
 * ## What this pins
 *
 * Every semantic entry the replayed chain crosses is printed to the author as
 * one block — `⚠ [protocol N] <surface> → <replacement>`, then `why:` (the
 * entry's `reason`) and `verify:` (its `acceptanceCriteria`). That is text an
 * author is shown, so it carries no tracker number: a number sends the reader
 * to a page that can be deleted (some cited pages already had been), and the
 * lesson the entry exists to teach then sits behind a dead link instead of in
 * the sentence being read. The `engine-*` entries were rewritten to say what
 * each cited ruling, measurement or fix decided; ADR ids stay, because an ADR
 * lives in this repository.
 *
 * The fixture authors the shapes those entries are about — a lookup and a
 * virtual `formula` field on one object — and the CLI replays the chain from
 * the support floor to the highest major carrying an `engine-*` entry. Each
 * family block is then located VERBATIM in what the terminal printed, and that
 * printed block must hold no `#` followed by four or five digits.
 *
 * ## Why it cannot pass by reading nothing
 *
 * - The family is derived from the registry by id prefix, so an `engine-*`
 *   entry added later is held to the same line on arrival — and the derived set
 *   must still contain the five entries this rewrite covered, so an emptied
 *   prefix cannot turn every assertion below into a loop over nothing.
 * - Each block is asserted PRESENT in stdout before it is asserted clean, so a
 *   renderer change that stopped printing the prose fails here instead of
 *   passing on an absent string.
 * - The detector is exercised on both sides before it is trusted: it fires on
 *   a four- and a five-digit tracker id and stays dark on three or six digits
 *   and on an ADR id.
 *
 * ## Why a spawn, and why this file is QUEUE tier rather than `.e2e`
 *
 * The subject is the sentence a real terminal prints, which is assembled in the
 * command's human-output branch — above every seam an in-process test reaches.
 * So the CLI is spawned once and the one run is shared by every assertion. The
 * file deliberately does NOT carry the `.e2e` name: that name selects the
 * nightly population (`vitest-tiers.ts` → "The NIGHTLY tiers"), and a pin that
 * runs only nightly is not protected by the merge queue's required set. Queue
 * tier by name, `integration` by behaviour — the same combination
 * `migrate-meta-default-range.test.ts` records.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_BY_MAJOR, MIGRATION_SUPPORT_FLOOR } from '@objectstack/spec';
import { childEnv } from './helpers/serve-process.js';

const execFileP = promisify(execFile);
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** A tracker id as author-shown prose must not carry it: `#` and four or five digits. */
const TRACKER_ID = /#\d{4,5}\b/;

/** The family this pin holds, selected by entry-id prefix. */
const FAMILY_PREFIX = 'engine-';

/** The entries rewritten when the family was brought to this line — the anti-vacuity floor. */
const REWRITTEN = [
  'engine-dotted-filter-refused',
  'engine-dotted-projection-refused',
  'engine-find-formula-filter-refused',
  'engine-find-formula-order-by-refused',
  'engine-update-upsert-retired',
];

interface FamilyEntry {
  toMajor: number;
  id: string;
  surface: string;
  replacement: string;
  reason: string;
  acceptanceCriteria: string;
}

const FAMILY: FamilyEntry[] = Object.entries(MIGRATIONS_BY_MAJOR).flatMap(([major, step]) =>
  step.semantic
    .filter((s) => s.id.startsWith(FAMILY_PREFIX))
    .map((s) => ({ ...s, toMajor: Number(major) })),
);

/** The block the command prints for one semantic TODO, exactly as `meta.ts` lays it out. */
function printedBlock(e: FamilyEntry): string {
  return (
    `⚠ [protocol ${e.toMajor}] ${e.surface} → ${e.replacement}\n`
    + `        why:    ${e.reason}\n`
    + `        verify: ${e.acceptanceCriteria}`
  );
}

/**
 * A stack authoring the shapes the family's entries are about: a relation a
 * dotted path would follow, and a virtual `formula` field no driver
 * materialises a column for.
 */
const FAMILY_FIXTURE = `
export default {
  manifest: { id: 'com.example.engine-guidance-pin', name: 'Engine Guidance Pin', version: '1.0.0', type: 'app' },
  objects: [
    { name: 'pin_project', label: 'Project', fields: { name: { type: 'text', label: 'Name' } } },
    {
      name: 'pin_task',
      label: 'Task',
      fields: {
        title: { type: 'text', label: 'Title' },
        status: { type: 'text', label: 'Status' },
        project_id: { type: 'lookup', label: 'Project', reference: 'pin_project' },
        is_open: { type: 'formula', label: 'Open', expression: 'record.status == "open"' },
      },
    },
  ],
};
`;

let dir: string;
let stdout: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-migrate-meta-engine-guidance-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), FAMILY_FIXTURE);
  const toMajor = Math.max(...FAMILY.map((e) => e.toMajor));
  const run = await execFileP(
    TSX,
    [CLI, 'migrate', 'meta', '--from', String(MIGRATION_SUPPORT_FLOOR), '--to', String(toMajor)],
    { cwd: dir, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
  );
  stdout = run.stdout;
}, 120_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('os migrate meta — the engine-* guidance carries no tracker number', () => {
  it('the detector fires on a tracker id and stays dark on every other number shape', () => {
    expect(TRACKER_ID.test(`see #${'9'.repeat(4)}`)).toBe(true);
    expect(TRACKER_ID.test(`see #${'9'.repeat(5)}`)).toBe(true);
    expect(TRACKER_ID.test(`see #${'9'.repeat(3)}`)).toBe(false);
    expect(TRACKER_ID.test(`see #${'9'.repeat(6)}`)).toBe(false);
    expect(TRACKER_ID.test('ADR-0112')).toBe(false);
  });

  it('selects the whole family, including every entry the rewrite covered', () => {
    const ids = FAMILY.map((e) => e.id);
    for (const id of REWRITTEN) expect(ids, `family lost ${id}`).toContain(id);
  });

  it('prints every family block verbatim, and no printed block names a tracker id', () => {
    for (const e of FAMILY) {
      const block = printedBlock(e);
      expect(stdout.includes(block), `${e.id}: its block is not in the printed output`).toBe(true);
      expect(block.match(TRACKER_ID)?.[0], `${e.id}: the printed guidance cites a tracker id`)
        .toBeUndefined();
    }
  });
});
