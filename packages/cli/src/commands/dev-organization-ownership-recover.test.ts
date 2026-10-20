// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { upgradeRefusedDevelopmentDatabase } from './dev.js';
import type { DevelopmentUpgradeResult } from '../utils/dev-organization-ownership-upgrade.js';

/**
 * #24833 — what `os dev` prints when the organization-ownership boot guard
 * refused its `serve` child and it upgrades the development database in place.
 *
 * The coordinator's `recover` in `dev.ts` calls `upgradeRefusedDevelopmentDatabase`
 * with `console.log` and the real upgrade. Here the upgrade is faked: what it
 * does is `utils/dev-organization-ownership-upgrade.test.ts`'s subject, and the
 * line it prints is this file's.
 *
 * ## The defect
 *
 * The first line used to say the database was "still in the v17
 * organization-ownership shape" for every refusal. The guard refuses a database
 * whose marker is absent, unverified, unreadable or from an older shape
 * generation, or whose shape or birth marker it could not read or write, and
 * only the absent marker means "17.x or an 18.0 pre-release created it". So the
 * line names no origin at all: the guard's own refusal, printed just above it
 * by the failed boot, does.
 *
 * ⛔ The sentence is not pinned verbatim. The pins are what it must not say (an
 * origin) and the things it must name: the refusal above, the in-place
 * upgrade, the copy. The copy's path is the verdict line's, from the result.
 */

const COPY = '.objectstack/data/backups/organization-ownership-2026-10-20T15-33-45-773Z';

/** Drive the seam with a fake upgrade, recording every printed line (colour stripped) and when the upgrade ran. */
async function drive(result: DevelopmentUpgradeResult): Promise<{ lines: string[]; printedBeforeUpgrade: number; ok: boolean }> {
  const lines: string[] = [];
  let printedBeforeUpgrade = -1;
  const ok = await upgradeRefusedDevelopmentDatabase({
    print: (line) => lines.push(stripVTControlCharacters(line)),
    upgrade: async () => {
      printedBeforeUpgrade = lines.length;
      return result;
    },
  });
  return { lines, printedBeforeUpgrade, ok };
}

const upgraded: DevelopmentUpgradeResult = {
  ok: true,
  backupDir: COPY,
  warnings: ['8 shipped permission set row(s) …'],
  lines: [`Upgraded the development database to the v18 organization ownership. The database as it was before the upgrade is copied to ${COPY}, beside the ceremony's log. The plan and the report are there too.`],
};

describe('#24833 os dev — the line before the in-place upgrade of a refused development database', () => {
  it('names no origin for the database: no "v17", no 17.x, no 18.0 pre-release', async () => {
    const { lines } = await drive(upgraded);
    const notice = lines[0]!;
    expect(notice, notice).not.toMatch(/v17/i);
    expect(notice, notice).not.toMatch(/\b17\.x\b|\b18\.0\b|pre-?release|next\.\*|created/i);
  });

  it('points at the refusal above, and says os dev upgrades the database in place keeping a copy first', async () => {
    const { lines, printedBeforeUpgrade } = await drive(upgraded);
    const notice = lines[0]!;
    expect(notice, notice).toMatch(/refus/i);
    expect(notice, notice).toMatch(/above/i);
    expect(notice, notice).toMatch(/os dev/);
    expect(notice, notice).toMatch(/in place/);
    expect(notice, notice).toMatch(/copy first/);
    // Printed BEFORE the copy and the ceremony run, which take seconds.
    expect(printedBeforeUpgrade).toBe(1);
  });

  it('the copy\'s path stays on the verdict line, after the warnings, and the server boots again', async () => {
    const { lines, ok } = await drive(upgraded);
    expect(ok).toBe(true);
    expect(lines.slice(1)).toEqual([
      '  ⚠ 8 shipped permission set row(s) …',
      `  ✓ ${upgraded.lines[0]}`,
    ]);
    expect(lines[2]).toContain(COPY);
  });

  it('an upgrade that did not finish prints its refusal lines and boots nothing', async () => {
    const { lines, ok } = await drive({
      ok: false,
      backupDir: COPY,
      warnings: [],
      lines: ['Refused (sys_mystery): …', `The upgrade plan was refused, and nothing was changed. The copy is at ${COPY}.`],
    });
    expect(ok).toBe(false);
    expect(lines.slice(1).every((l) => l.startsWith('  ✗ '))).toBe(true);
    expect(lines).toHaveLength(3);
  });
});
