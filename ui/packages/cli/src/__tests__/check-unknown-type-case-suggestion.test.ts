/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5247 — `objectui check` names the case-only spelling it missed.
 *
 * The maintainer ruled Option C on 2026-08-19: keep lookup strict, make the
 * failure teach. `Page` remains an UNKNOWN type on both surfaces — the CLI
 * still warns about it and `SchemaRenderer` still paints the OBJUI-001 panel —
 * and only the wording gains ` — did you mean "page"?`. Making `Page` valid is
 * the rejected option B.
 *
 * Which assertions here would survive a revert of that change, and why they are
 * present anyway:
 *
 *   - "the warning is still printed" and "the type is still reported unknown"
 *     both pass on a revert. They are the anti-option-B guard: without them a
 *     future change could satisfy the suggestion assertions by simply accepting
 *     the mis-cased type.
 *   - "no suggestion for `zzz`" passes on a revert too, by construction. It is
 *     the counter-probe against a clause that fires unconditionally, and it is
 *     only meaningful in the same run as the positive case below.
 *   - `did you mean "page"` is the one assertion that fails on a revert.
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `check()` globs
 * every JSON file under the directory it is handed, so a fixture committed
 * inside this workspace would be scanned by the repository's own `pnpm check`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { check } from '../commands/check.js';
import { KNOWN_SCHEMA_TYPES } from '../utils/known-schema-types.js';
import {
  suggestKnownTypeByCase,
  didYouMeanClause,
} from '../utils/known-type-case-suggestion.js';

let cwd: string;
let lines: string[];
let restore: () => void;

/**
 * The CSI sequences chalk may add. The escape byte is built with
 * `String.fromCharCode` rather than spelled into the source, so this file holds
 * no raw control character and no escape a tooling pass could materialise into
 * one (objectui AGENTS.md byte discipline).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function unknownTypeWarnings(): string[] {
  return lines
    .map((l) => l.replace(ANSI, ''))
    .filter((l) => l.includes('Unknown schema type'));
}

/** A file that clears the objectui#5127 marker gate and so gets type-judged. */
function writeSchema(name: string, type: string): void {
  writeFileSync(join(cwd, name), JSON.stringify({ type, children: [] }));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-case-'));
  lines = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    void code;
    return undefined as never;
  }) as never);
  restore = () => {
    console.log = originalLog;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restore();
  rmSync(cwd, { recursive: true, force: true });
});

describe('objectui check — a case-only miss names the spelling that works', () => {
  it('still reports `Page` as unknown AND names `page`', async () => {
    // Sanity: `page` is a type the derivation actually knows. Without this the
    // two assertions below could agree about a type that does not exist.
    expect(KNOWN_SCHEMA_TYPES).toContain('page');

    writeSchema('page.json', 'Page');
    await check(cwd);

    const warnings = unknownTypeWarnings();
    // Passes on a revert — the anti-option-B guard.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Unknown schema type "Page"');
    // Fails on a revert — the load-bearing pin.
    expect(warnings[0]).toContain('did you mean "page"');
  });

  it('says nothing extra when no known type differs by case alone', async () => {
    writeSchema('zzz.json', 'zzz');
    await check(cwd);

    const warnings = unknownTypeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Unknown schema type "zzz"');
    expect(warnings[0]).not.toContain('did you mean');
  });

  it('reports both, each with the right clause, in one run', async () => {
    writeSchema('a.json', 'Page');
    writeSchema('b.json', 'zzz');
    await check(cwd);

    const warnings = unknownTypeWarnings();
    expect(warnings).toHaveLength(2);
    expect(warnings.filter((w) => w.includes('did you mean'))).toHaveLength(1);
    expect(warnings.find((w) => w.includes('"Page"'))).toContain('did you mean "page"');
  });
});

describe('objectui#5247 — the suggestion is case, and only case', () => {
  it('matches a namespaced spelling', () => {
    expect(KNOWN_SCHEMA_TYPES).toContain('view:grid');
    expect(suggestKnownTypeByCase('VIEW:Grid')).toBe('view:grid');
  });

  it('does not reach for an edit distance', () => {
    // One deletion from `page`. The ruling granted case and only case.
    expect(suggestKnownTypeByCase('pge')).toBeUndefined();
    expect(suggestKnownTypeByCase('Buttonn')).toBeUndefined();
  });

  it('never suggests the spelling it was handed', () => {
    expect(suggestKnownTypeByCase('page')).toBeUndefined();
    expect(suggestKnownTypeByCase('')).toBeUndefined();
  });

  it('only ever suggests a type the derivation holds', () => {
    // The staleness guard objectui#5115 exists for: every suggestion this can
    // produce is drawn from `KNOWN_SCHEMA_TYPES` itself, so it cannot name a
    // type nothing registers.
    for (const known of KNOWN_SCHEMA_TYPES) {
      const suggestion = suggestKnownTypeByCase(known.toUpperCase());
      if (suggestion !== undefined) {
        expect(KNOWN_SCHEMA_TYPES).toContain(suggestion);
        expect(suggestion.toLowerCase()).toBe(known.toLowerCase());
      }
    }
  });

  it('emits an empty clause when there is nothing to say', () => {
    expect(didYouMeanClause('zzz')).toBe('');
    expect(didYouMeanClause('Page')).toBe(' — did you mean "page"?');
  });
});
