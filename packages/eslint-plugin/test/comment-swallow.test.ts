// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import {
  COMMENT_SWALLOW_FILES,
  commentSwallowPlugin,
  looksLikeSwallowedCode,
} from '../src/index.mjs';
import { ruleTester } from './rule-tester.js';

const rule = commentSwallowPlugin.rules['no-code-inside-block-comment'];

/**
 * The predicate's contract, pinned as cases rather than trusted.
 *
 * A rule with a ZERO baseline is green three ways — the tree is clean, the
 * predicate was edited into matching nothing, or the config block stopped
 * matching files — and `pnpm lint` reports the same nothing in all three. The
 * predicate is a pure function of one line, so its cases run here; the span
 * half is the parser's answer, and the RuleTester cases below only pin which
 * lines of a span the rule reads.
 */
const COMMENT_SWALLOW_CASES: ReadonlyArray<readonly [string, boolean]> = [
  // FIRES — the class.
  ['export { maskComments };', true],              // the #9640 statement itself
  ['const RE = /a*' + '/;', true],
  ['  const limit = 10;', true],                   // indented, inside a function body
  ['module.exports = { a: 1 };', true],
  ['export type Id = string;', true],
  ['export function selfTest() {', true],
  ['import { readFileSync } from "node:fs";', true],
  ['/** the docblock whose terminator closed the phantom span */', true],
  // SILENT — prose, and marked-up example code.
  // Split so the workspace-import census does not read test data as an import.
  [' * import { createHonoApp } from "@objectstack/' + 'hono";', false],
  [' * export default app;', false],
  ['let us assume the value is null, and', false],
  ['class hierarchies are not the point here;', false],
  ['import lists are checked elsewhere,', false],
  ['export the module however you like;', false],
  ['type checking happens later', false],
  [' */', false],
  ['', false],
];

describe('looksLikeSwallowedCode', () => {
  // Fix COMMENT_SWALLOW_PATTERNS, or amend the case if the contract really
  // changed — never delete a case to get the suite green.
  it.each(COMMENT_SWALLOW_CASES)('%j → %s', (line, expected) => {
    expect(looksLikeSwallowedCode(line)).toBe(expected);
  });
});

describe('COMMENT_SWALLOW_FILES', () => {
  it('covers plain JavaScript, where the one instance of this class occurred', () => {
    // The instance was a `.mjs` file under `scripts/`, so a TypeScript-only
    // scope is a guard that cannot see the only place the defect has occurred.
    expect(COMMENT_SWALLOW_FILES.some((glob) => /\bmjs\b/.test(glob) && /\bjs\b/.test(glob))).toBe(true);
  });
});

const swallowed = { messageId: 'swallowed' };

ruleTester.run('comment-swallow/no-code-inside-block-comment', rule, {
  valid: [
    { code: '/* one line */ const a = 1;' },
    { code: '/**\n * import { createHonoApp } from "@objectstack/' + 'hono";\n * export default app;\n */\nexport const a = 1;' },
    { code: '/*\n  let us assume the value is null, and\n  class hierarchies are not the point here;\n*/\nconst a = 1;' },
    // Whatever precedes the opener on its own line is live code.
    { code: 'const a = 1; /*\n * note\n */' },
  ],
  invalid: [
    {
      // The #9640 shape: an unterminated opener closed by the next docblock.
      code: '/* re-exported for the self-test\nexport { maskComments };\n/** The docblock below. */\nfunction selfTest() {}',
      errors: [{ ...swallowed, line: 2 }, { ...swallowed, line: 3 }],
    },
    {
      // The terminator's own line is read too: a span can close mid-line.
      code: '/*\n * prose\nconst RE = /a*' + '/;',
      errors: [{ ...swallowed, line: 3 }],
    },
  ],
});
