/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check` on the two spellings objectui#9533 moved — the
 * AUTHORING-TIME half of that convergence, on the published surface.
 *
 * ## Why this pin and not only the derivation's
 *
 * `scripts/__tests__/known-schema-types-derivation-5115.test.ts` holds the
 * generated snapshot against the derivation, which is the MECHANISM. This holds
 * the outcome an author observes from outside the repository, in both
 * directions, because objectui#9533 moved a key in each:
 *
 *   - `plugin-dashboard:dashboard` was WHITELISTED AND UNRENDERABLE. The console
 *     declared the lazy stub under that name while the package registered
 *     `view:dashboard`, so `register()` never cleared the stub and nothing was
 *     ever stored under it. This command was silent on a document that could
 *     only ever paint `Loading plugin-dashboard:dashboard…` — the objectui#8760
 *     shape, whose grading is the line this pin sits on: "an unknown key is
 *     refused loudly at authoring time; a registered-but-unfulfilled key passes
 *     every check, is taught by the documentation, and fails only at render in
 *     front of a user."
 *   - `view:dashboard` was the package's published full name and is now RETIRED.
 *     It stays registered at runtime — a tombstone that refuses by name and
 *     names its replacement — but its keys are WITHHELD from the derived
 *     universe by declaration (`INDIRECT_REGISTRATIONS` in
 *     `scripts/check-doc-component-types.mjs`, the disposition objectui#9717
 *     holds open), precisely so that this command NAMES it instead of blessing
 *     it. Blessing it here would rebuild the defect the card removed, one
 *     spelling over.
 *
 * ## The controls
 *
 * Silence is one of the two readings under test, so the silent cases must be
 * individually non-zero — a command that judged nothing at all would pass them.
 * Bare `dashboard` and `plugin-dashboard:dashboard` are each asserted to be IN
 * the shipped vocabulary before their documents are checked.
 *
 * Fixtures live under `os.tmpdir()` and carry the `className` marker, for the
 * two reasons `check-known-types.test.ts` states at length: a fixture inside
 * this workspace would be scanned by the repo's own `pnpm check`, and a file
 * with no ObjectUI marker key is not judged at all (objectui#5127) — which would
 * leave the silence assertions green while measuring nothing.
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

/** The escape byte chalk opens a CSI sequence with, spelled rather than typed. */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function writeSchema(name: string, type: string): void {
  writeFileSync(join(cwd, name), JSON.stringify({ className: 'p-0', type, widgets: [] }));
}

function unknownTypeWarnings(): string[] {
  return lines.map((l) => l.replace(ANSI, '')).filter((l) => l.includes('Unknown schema type'));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-9533-'));
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

describe('objectui#9533 — the retired `view:dashboard` spelling is named, not blessed', () => {
  it('`objectui check` reports it by name', async () => {
    writeSchema('retired.json', 'view:dashboard');
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining('Unknown schema type "view:dashboard" in retired.json'),
    ]);
  });

  it('it is gone from the shipped vocabulary', () => {
    // Non-vacuity for the assertion beside it: the snapshot must be a real,
    // populated set, or "does not contain" is true of everything.
    expect(KNOWN_SCHEMA_TYPES.length).toBeGreaterThan(100);
    expect(KNOWN_SCHEMA_TYPES).not.toContain('view:dashboard');
  });
});

describe('objectui#9533 — CONTROL: the spellings that now really resolve stay silent', () => {
  it.each(['dashboard', 'plugin-dashboard:dashboard'])(
    '`%s` is in the vocabulary and draws no warning',
    async (type) => {
      // Individually non-zero: each names a key the plugin really registers.
      // `plugin-dashboard:dashboard` was in this list BEFORE the fix too — what
      // changed is that it now names a component rather than a stub nothing ever
      // fulfilled, which is why the runtime half is pinned next to the plugin
      // (`packages/plugin-dashboard/src/__tests__/dashboardBareKeyOwnership.test.tsx`)
      // and not here.
      expect(KNOWN_SCHEMA_TYPES).toContain(type);
      writeSchema('live.json', type);
      await check(cwd);
      expect(unknownTypeWarnings()).toEqual([]);
    },
  );
});
