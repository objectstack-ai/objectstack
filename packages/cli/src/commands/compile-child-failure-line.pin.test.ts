// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: **the line a command prints when its `os compile` child exits non-zero
 * says the config did not load or compile, and that the reason is printed
 * above — never that the failure was a code error, never that it was a
 * refusal** (ruling record 6998194814, letter D).
 *
 * The parent sees only the child's exit status. A syntax error in the config, a
 * refusal thrown while it loads and a refusal that prints and calls
 * `process.exit(1)` all reach the same branch, so the one line printed there must
 * be true of each; the reason itself is on screen already, from the child. The
 * old line, "Compile failed — fix errors above", sent an operator whose boot was
 * refused at config load looking for a code error.
 *
 * Asserted over the command sources, for the reason `child-env-source-loader.pin.test.ts`
 * gives: driving these boot sites means spawning the built CLI, which this suite
 * cannot rely on and which is its dominant cost. The watch recompile's line is
 * driven for real in `dev-watch-compile-refusal.pin.test.ts`.
 *
 * Each site keeps its own tail. Per site the scan asserts: exactly one code line
 * carries the neutral phrase; it carries the site's tail; it sits in a
 * `status !== 0` branch (within the lines above it); and it says neither
 * "compile error" nor "refused". Per file: no code line says "compile failed".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const PHRASE = 'did not load or compile — the reason is printed above;';

const SITES = [
  { file: 'dev.ts', tail: 'fix it before starting dev server' },
  { file: 'start.ts', tail: 'fix it before starting the server' },
  { file: 'serve.ts', tail: 'fix it before starting the dev server.' },
  { file: 'environments/bind.ts', tail: 'fix it before binding' },
] as const;

const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);

function codeLines(file: string): { text: string; index: number }[] {
  return readFileSync(resolve(HERE, file), 'utf8')
    .split('\n')
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => !isComment(text));
}

describe('os compile child failure line: neutral at every site (ruling record 6998194814)', () => {
  for (const { file, tail } of SITES) {
    it(`${file}: one neutral line, its own tail, in the status !== 0 branch`, () => {
      const lines = codeLines(file);
      const hits = lines.filter(({ text }) => text.includes(PHRASE));
      expect(hits.map((h) => h.text.trim()), file).toHaveLength(1);
      const [hit] = hits;
      expect(hit.text, file).toContain(tail);
      expect(hit.text, file).not.toMatch(/compile error|refused/i);

      const above = lines.filter(({ index }) => index < hit.index && index >= hit.index - 8);
      expect(above.some(({ text }) => /\.status !== 0\b/.test(text)), `${file}: not in a status !== 0 branch`).toBe(true);
    });

    it(`${file}: no code line still says "compile failed"`, () => {
      const stale = codeLines(file).filter(({ text }) => /compile failed/i.test(text));
      expect(stale.map((s) => `${s.index + 1}: ${s.text.trim()}`), file).toEqual([]);
    });
  }
});
