/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins for `scripts/census-recorder-wait-shape.mjs` (objectui#8704).
 *
 * The six fixtures next to this file are objectui#8703's five throwaway cases,
 * kept, plus the sixth objectui#8704 asked for. Each one was FIRST observed
 * giving the wrong answer on the pre-repair script — that is why the regex
 * block below exists at all. Both matchers are asserted over the SAME six
 * files, so the repair is pinned as a direction and not just as a state:
 *
 *   fixture                          regex ident   regex path   AST
 *   f1  member push / member read    miss          FLAG         FLAG
 *   f2  member push / bare read      FLAG          miss         FLAG
 *   f3  bare push / member read      miss          miss         FLAG
 *   f4  runaway window (D1 + D2)     6 wrong       6 wrong      none
 *   f5  hazard behind one await      miss          miss         FLAG
 *   f6  absence read (the control)   FLAG          FLAG         FLAG
 *
 * ⛔ This suite runs the matcher over the FIXTURES ONLY, never over the
 * corpus. The census stays out of CI (objectui#8703's fence, restated in the
 * script header): nothing here depends on what the repository reads.
 *
 * ⭐ f6 is the anti-caricature control. "Flag nothing" is strictly worse than
 * the bug this card repairs, and it passes every other assertion in this file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { analyzeAst, analyzeRegex } from '../census-recorder-wait-shape.mjs';

const DIR = join(__dirname, 'fixtures', 'census-recorder-wait-shape');

const F1 = 'f1-member-push-member-read.fixture.ts';
const F2 = 'f2-member-push-bare-read.fixture.ts';
const F3 = 'f3-bare-push-member-read.fixture.ts';
const F4 = 'f4-window-crosses-test.fixture.ts';
const F5 = 'f5-window-truncated.fixture.ts';
const F6 = 'f6-absence-read-must-stay-flagged.fixture.ts';
const ALL = [F1, F2, F3, F4, F5, F6];

const paths = ALL.map((f) => join(DIR, f));

interface Flag {
  file: string;
  line: number;
  waitLine: number;
  recorder: string;
  waitSet: string[];
}

/** The source line a flag points at, trimmed — the only address that survives an edit. */
const lineAt = (file: string, line: number) =>
  readFileSync(file, 'utf8').split('\n')[line - 1]!.trim();

/** Strict flags for one fixture, as `<what the flagged line says>` entries. */
const strictLines = (flags: Flag[], fixture: string) =>
  flags
    .filter((f) => f.waitSet.length > 0 && basename(f.file) === fixture)
    .sort((a, b) => a.line - b.line)
    .map((f) => lineAt(f.file, f.line));

const ast = () => analyzeAst(paths) as Flag[];
const regex = (mode: 'ident' | 'path') => analyzeRegex(paths, mode) as Flag[];

describe('the pre-repair regex matcher — objectui#8704\'s three defects, executable', () => {
  it('D1+D2: flags DECLARATIONS in the next test, and a reset in this one', () => {
    // Every one of these was measured on the pre-repair script before the AST
    // matcher existed. `scratch.length = 0` is D2 with the window rule already
    // correct (same test); `expect(shared[0])` is D1 with the occurrence rule
    // already correct (a genuine read, wrong test).
    const wrong = [
      'const second: number[] = [];',
      'const third: number[] = [];',
      'const scratch: number[] = [];',
      'scratch.length = 0;',
      'const shared: number[] = [];',
      'expect(shared[0]).toBe(4);',
    ];
    expect(strictLines(regex('path'), F4)).toEqual(wrong);
    expect(strictLines(regex('ident'), F4)).toEqual(wrong);
  });

  it('D1, the mirror: a real hazard one ordinary `await` further on draws ZERO', () => {
    expect(strictLines(regex('path'), F5)).toEqual([]);
    expect(strictLines(regex('ident'), F5)).toEqual([]);
  });

  it('M2: a recorder pushed bare and read through its host is invisible to BOTH modes', () => {
    expect(strictLines(regex('path'), F3)).toEqual([]);
    expect(strictLines(regex('ident'), F3)).toEqual([]);
  });

  it('M1: the two modes are incomparable — each sees a shape the other cannot', () => {
    expect(strictLines(regex('path'), F1)).toEqual(['expect(server.savedOpts[0]).toMatchObject({ mode: \'draft\' });']);
    expect(strictLines(regex('ident'), F1)).toEqual([]);

    expect(strictLines(regex('ident'), F2)).toEqual(['expect(inits[0]).toBe(1);']);
    expect(strictLines(regex('path'), F2)).toEqual([]);
  });

  it('gets f6 right — so the repair has something it must NOT break', () => {
    expect(strictLines(regex('path'), F6)).toEqual(['expect(deletes).toEqual([]);']);
    expect(strictLines(regex('ident'), F6)).toEqual(['expect(deletes).toEqual([]);']);
  });
});

describe('the AST matcher — identity, test-scoped windows, read/write/declare', () => {
  it('D1+D2 repaired: the runaway window flags NOTHING in f4', () => {
    expect(strictLines(ast(), F4)).toEqual([]);
  });

  it('D1 mirror repaired: the hazard behind an ordinary `await` is found', () => {
    // A bare `await` settles nothing, so it must not close the window.
    expect(strictLines(ast(), F5)).toEqual(['expect(payloads[0]).toBe(2);']);
  });

  it('M2 repaired: a host member and the bare array it holds are ONE recorder', () => {
    expect(strictLines(ast(), F3)).toEqual(['expect(host.inits[0]).toBe(1);']);
  });

  it('M1 dissolved: both spellings flag, with no mode to choose', () => {
    expect(strictLines(ast(), F1)).toEqual(['expect(server.savedOpts[0]).toMatchObject({ mode: \'draft\' });']);
    expect(strictLines(ast(), F2)).toEqual(['expect(inits[0]).toBe(1);']);
  });

  it('⭐ still flags the absence read objectui#8690 repaired — NOT a matcher that reports nothing', () => {
    // The caricature this card names: an implementation strictly worse than the
    // bug ("flag nothing") passes f4 and every "must be empty" case above. It
    // fails here, and here is the only place it can fail.
    expect(strictLines(ast(), F6)).toEqual(['expect(deletes).toEqual([]);']);
    expect(ast().filter((f) => f.waitSet.length > 0)).toHaveLength(5);
  });

  it('names the recorder as the READ site spells it, not as its push site does', () => {
    // Two distinct arrays can share a push-site spelling; printing that made a
    // correct flag read as "waits [calls] reads calls" on the real corpus.
    const f3 = ast().find((f) => basename(f.file) === F3)!;
    expect({ waits: f3.waitSet, reads: f3.recorder }).toEqual({
      waits: ['host.calls'],
      reads: 'host.inits',
    });
  });
});
