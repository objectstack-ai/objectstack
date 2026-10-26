/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check`'s JSON parse arm (objectui#5237).
 *
 * `.json` on disk means JSONC in practice, and `JSON.parse` counted every
 * `tsconfig.json` in a project as a malformed file. Because a parse failure is
 * the only thing that increments the error count, and a non-zero error count is
 * the only thing that calls `process.exit(1)`, the command exited 1 in every
 * TypeScript project — 64 errors at this repository's own root.
 *
 * The other half of this file is the assertion that the fix did not become
 * "never fail on anything": `jsonc-parser`'s reader is error-TOLERANT and
 * returns a best-effort value instead of throwing, so genuinely malformed JSON
 * only still fails because the command consults the reported-error array.
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `check()` globs
 * every JSON file under the directory it is handed, so a fixture committed
 * inside this workspace would be scanned by every other run of the command as
 * well — including the repo's own `pnpm check`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { check, closingLine } from '../commands/check.js';

let cwd: string;
let lines: string[];
let restoreLog: () => void;
let exitCodes: number[];

/** Write a fixture verbatim — these are JSONC sources, not `JSON.stringify` output. */
function writeFile(name: string, body: string): void {
  writeFileSync(join(cwd, name), body);
}

/**
 * The CSI sequences chalk may add. The escape byte is built with
 * `String.fromCharCode` rather than spelled into the source, so this file holds
 * no raw control character and no escape a tooling pass could materialise into
 * one (objectui AGENTS.md byte discipline).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function stripAnsi(line: string): string {
  return line.replace(ANSI, '');
}

function plainLines(): string[] {
  return lines.map(stripAnsi);
}

function parseErrorLines(): string[] {
  return plainLines().filter((l) => l.includes('Invalid JSON in'));
}

function unknownTypeWarnings(): string[] {
  return plainLines().filter((l) => l.includes('Unknown schema type'));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-jsonc-'));
  lines = [];
  exitCodes = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  // `check()` calls `process.exit(1)` itself; record the call instead of
  // letting it tear the Vitest worker down.
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restoreLog = () => {
    console.log = original;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restoreLog();
  rmSync(cwd, { recursive: true, force: true });
});

describe('objectui check — `.json` is read as JSONC', () => {
  it('accepts a tsconfig.json with a line comment AND a trailing comma', async () => {
    // The exact shape that produced all 64 errors: TypeScript documents both.
    writeFile(
      'tsconfig.json',
      [
        '{',
        '  // Type-checking for the workspace, as tsconfig permits',
        '  /* block comments too */',
        '  "compilerOptions": {',
        '    "strict": true,',
        '  },',
        '}',
        '',
      ].join('\n')
    );

    await check(cwd);

    expect(parseErrorLines()).toEqual([]);
    // The no-error close (objectui#11007): a tsconfig has no root `type`, so
    // nothing was recognised and every bucket is empty.
    expect(plainLines()).toContain(
      closingLine({ validated: 0, notValidated: 0, didNotValidate: 0 })
    );
    expect(exitCodes).toEqual([]);
  });

  it('does not mistake a `//` inside a string value for a comment', async () => {
    // Why the reader is a real JSONC parser and not a comment-stripping regex:
    // a stripper that cannot tell a comment from a URL corrupts valid files.
    writeFile(
      'urls.json',
      '{\n  // a genuine comment\n  "homepage": "https://www.objectui.org//docs",\n  "note": "a // b"\n}\n'
    );

    await check(cwd);

    expect(parseErrorLines()).toEqual([]);
    expect(exitCodes).toEqual([]);
  });

  it('still reads plain, comment-free JSON', async () => {
    writeFile('plain.json', '{"compilerOptions":{"strict":true}}');

    await check(cwd);

    expect(parseErrorLines()).toEqual([]);
    expect(exitCodes).toEqual([]);
  });
});

describe('objectui check — genuinely malformed JSON still fails the run', () => {
  it('reports a missing value and exits 1', async () => {
    // `jsonc-parser` RECOVERS from this and returns `{}` rather than throwing.
    // If the command trusted the absence of a throw, this file would pass.
    writeFile('broken.json', '{ "compilerOptions": }');

    await check(cwd);

    expect(parseErrorLines()).toHaveLength(1);
    expect(parseErrorLines()[0]).toContain('Invalid JSON in broken.json');
    expect(plainLines()).toContain('Found 1 errors');
    expect(exitCodes).toEqual([1]);
  });

  it.each([
    ['an unterminated object', 'unclosed.json', '{ "a": 1'],
    ['a bare unquoted word', 'bare.json', '{ broken }'],
    ['trailing garbage after the value', 'garbage.json', '{"a":1} oops'],
    ['single-quoted keys', 'quotes.json', "{'a':1}"],
    ['an empty file', 'empty.json', ''],
  ])('reports %s and exits 1', async (_label, name, body) => {
    writeFile(name, body);

    await check(cwd);

    expect(parseErrorLines()).toHaveLength(1);
    expect(parseErrorLines()[0]).toContain(`Invalid JSON in ${name}`);
    expect(exitCodes).toEqual([1]);
  });

  it('names the line and column of the failure', async () => {
    writeFile('located.json', '{\n  "a": 1,\n  "b": \n}\n');

    await check(cwd);

    expect(parseErrorLines()[0]).toMatch(
      /Invalid JSON in located\.json: \w+ at line \d+ column \d+/
    );
    expect(exitCodes).toEqual([1]);
  });

  it('counts a real error even when a valid JSONC file sits beside it', async () => {
    writeFile('tsconfig.json', '{\n  // fine\n  "compilerOptions": {},\n}\n');
    writeFile('broken.json', '{ "a": }');

    await check(cwd);

    expect(parseErrorLines()).toHaveLength(1);
    expect(parseErrorLines()[0]).toContain('broken.json');
    expect(plainLines()).toContain('Found 1 errors');
    expect(exitCodes).toEqual([1]);
  });
});

/**
 * These fixtures carry `className` — a STRUCTURAL marker key — because
 * objectui#5127 gated the warning arm behind a positive ObjectUI marker: a
 * bare `{"type": ...}` file is no longer judged at all, so without a marker
 * every assertion below would pass for the wrong reason — including the two
 * that assert SILENCE, which would then be measuring nothing.
 *
 * An earlier revision declared a `$schema` URL here instead. The maintainer's
 * 2026-08-20 ruling removed that arm, so those fixtures would have been
 * admitted by nothing at all while every assertion in this section stayed
 * green. Each silence assertion below is now paired with a counter-probe that
 * proves judgement actually ran. The gate itself is pinned in
 * `check-schema-marker.test.ts`; this section is about the warning arm the gate
 * admits files to.
 */
describe('objectui check — the unknown-type warning arm is untouched (objectui#5127)', () => {
  it('still warns for an unrecognised root type, and still does not fail the run', async () => {
    writeFile('bogus.json', '{"className":"p-0","type":"totally-made-up-xyz"}');

    await check(cwd);

    expect(unknownTypeWarnings()).toHaveLength(1);
    expect(unknownTypeWarnings()[0]).toContain('Unknown schema type "totally-made-up-xyz"');
    // The no-error close, counting the file its `className` admitted without
    // a parse (objectui#11007).
    expect(plainLines()).toContain(
      closingLine({ validated: 0, notValidated: 1, didNotValidate: 0 })
    );
    expect(exitCodes).toEqual([]);
  });

  it('reaches the warning arm for a type declared in a JSONC file', async () => {
    // Files that previously died at the parse step now reach the type check —
    // the warning arm's reach grows, but its verdict and its exit-code
    // neutrality are unchanged.
    writeFile(
      'commented.json',
      '{\n  // a comment\n  "className": "p-0",\n  "type": "totally-made-up-xyz",\n}\n'
    );

    await check(cwd);

    expect(unknownTypeWarnings()).toHaveLength(1);
    expect(exitCodes).toEqual([]);
  });

  it('stays silent for a registered type', async () => {
    writeFile(
      'grid.json',
      '{"className":"p-0","type":"object-grid","objectApiName":"account"}'
    );
    // Counter-probe: same marker, same admission path, a type nothing
    // registers. Its warning is what makes `grid.json`'s silence a verdict
    // instead of a file the gate never let through.
    writeFile('probe.json', '{"className":"p-0","type":"totally-made-up-xyz"}');

    await check(cwd);

    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining('Unknown schema type "totally-made-up-xyz" in probe.json'),
    ]);
    expect(exitCodes).toEqual([]);
  });

  it('does not run the type check on a file that failed to parse', async () => {
    // A parse failure short-circuits before the schema arm, exactly as the
    // thrown `JSON.parse` used to.
    writeFile('broken-typed.json', '{ "className": "p-0", "type": "totally-made-up-xyz", }}');
    // Counter-probe: byte-for-byte the same document minus the stray brace.
    // It warns, so the silence about `broken-typed.json` is attributable to
    // the parse short-circuit — the only difference between the two files —
    // and not to a marker the gate declined.
    writeFile('parsed-typed.json', '{ "className": "p-0", "type": "totally-made-up-xyz" }');

    await check(cwd);

    expect(parseErrorLines()).toHaveLength(1);
    expect(parseErrorLines()[0]).toContain('broken-typed.json');
    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining('Unknown schema type "totally-made-up-xyz" in parsed-typed.json'),
    ]);
    expect(exitCodes).toEqual([1]);
  });
});
