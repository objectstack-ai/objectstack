// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20333) — `npm create objectstack`'s blank starter wires exactly the
 * barrels `os init` wires, in the lines `os init` renders.
 *
 * ## The defect
 *
 * The blank starter's `objectstack.config.ts` imported `./src/objects` alone.
 * `os g view|action|flow|dashboard|app|skill` wrote a scaffold and a barrel
 * that nothing imported, and `os validate` exited 0 with `Logic: 0 Flows`.
 * `os init` had the same config and was fixed by wiring every generator
 * barrel (#20215): `SCAFFOLD_WIRED_BARRELS`, derived from the generator
 * roster, rendered through `exportsOf` over `export {};` barrels, with
 * `SCAFFOLD_WIRED_REQUIRES` in `requires`.
 *
 * ## Why a parity pin, and why it lives in this package
 *
 * `create-objectstack` cannot import that roster. The dependency edge runs
 * the other way (this package depends on it for `created-summary`), and the
 * npx entry point must not pull the CLI's closure — the same boundary
 * `scripts/sync-scaffold-emission-policy.mjs` documents. Its template is a
 * static file tree copied byte for byte, so its wiring is a COPY of what
 * `os init` renders. A copy with nothing binding it to the source is a second
 * wiring rule, and it decays: the next generator added to the roster would be
 * wired by `os init` and silently not by the on-ramp.
 *
 * This file is the binding. Every expected value below is READ off the CLI —
 * `TEMPLATES.app`'s rendered config and barrels, and the two exported
 * rosters — and none is written down here, so a roster change, a renderer
 * change or a hand edit of the template reddens this file until the two
 * scaffolders agree again. Only this package can call the renderer; the
 * template side is a static file, so reading it IS reading its producer.
 *
 * What is compared is code, verbatim: the barrel imports, the `exportsOf`
 * helper, the stack-key lines, the `requires` tokens, and each empty barrel's
 * bytes. The prose comments around them are not compared — the starter keeps
 * its own explanation of `automation` (its connectors need it too).
 *
 * The behaviour this wiring buys is pinned through the real commands in
 * `create-objectstack-stack-reach.test.ts` (`npm create objectstack` →
 * `os g flow` → `os validate`).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAFFOLD_WIRED_BARRELS, SCAFFOLD_WIRED_REQUIRES, TEMPLATES } from '../src/commands/init.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One `resolve(HERE, …)` call per line: `check:cross-package-test-inputs`
// reconstructs these reads by SOURCE SCAN. The blank template is declared as a
// cross-package input of `@objectstack/cli` (scripts/cross-package-test-inputs.mjs,
// mirrored into turbo.json), so a template-only diff re-runs this file.
const BLANK = resolve(HERE, '../../create-objectstack/src/templates/blank');

const blankConfig = readFileSync(join(BLANK, 'objectstack.config.ts'), 'utf8');
const initConfig = TEMPLATES.app.configContent('my-app', 'my_app');

/** Every line of `text` matching `re`, sorted — order is not the contract. */
const linesMatching = (text: string, re: RegExp): string[] =>
  text.split('\n').filter((line) => re.test(line)).sort();

/** `import * as <key> from './src/<dir>';` — one per wired barrel. */
const BARREL_IMPORT = /^import \* as \w+ from '\.\/src\/[\w-]+';$/;
/** `  <key>: exportsOf(<key>),` — one per wired barrel, inside `defineStack`. */
const STACK_KEY = /^\s+\w+: exportsOf\(\w+\),$/;
/** The helper both configs read their barrels through. */
const HELPER = /^const exportsOf = /;

/** A barrel whose only code is `export {};` — comments aside. */
const isEmptyBarrel = (source: string): boolean =>
  source
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('//'))
    .join('\n') === 'export {};';

describe('[#20333] the roster this file reads is the real one', () => {
  it('wires more than objects, and includes flows', () => {
    // Vacuity guard: an empty or objects-only roster would make every
    // comparison below agree with the defect.
    expect(SCAFFOLD_WIRED_BARRELS.length).toBeGreaterThan(1);
    expect(SCAFFOLD_WIRED_BARRELS.map((b) => b.stackKey)).toContain('flows');
    expect(SCAFFOLD_WIRED_REQUIRES.length).toBeGreaterThan(0);
  });

  it('the patterns below find one line per wired barrel in the CLI render', () => {
    expect(linesMatching(initConfig, BARREL_IMPORT)).toHaveLength(SCAFFOLD_WIRED_BARRELS.length);
    expect(linesMatching(initConfig, STACK_KEY)).toHaveLength(SCAFFOLD_WIRED_BARRELS.length);
    expect(linesMatching(initConfig, HELPER)).toHaveLength(1);
  });
});

describe('[#20333] the blank config wires what `os init` wires, in its lines', () => {
  it('imports every wired barrel, and nothing else under ./src', () => {
    expect(linesMatching(blankConfig, BARREL_IMPORT)).toEqual(linesMatching(initConfig, BARREL_IMPORT));
  });

  it('reads the barrels through the same `exportsOf` helper', () => {
    expect(linesMatching(blankConfig, HELPER)).toEqual(linesMatching(initConfig, HELPER));
  });

  it('hands every wired barrel to its stack key', () => {
    expect(linesMatching(blankConfig, STACK_KEY)).toEqual(linesMatching(initConfig, STACK_KEY));
  });

  it('declares every capability the scaffolds need to run', () => {
    const declared = [...blankConfig.matchAll(/^\s+requires: \[([^\]]*)\],$/gm)];
    expect(declared, 'exactly one top-level `requires` line').toHaveLength(1);
    const tokens = declared[0][1].split(',').map((t) => t.trim().replace(/^'|'$/g, ''));
    // A superset, not an equality: the starter's connectors need `automation`
    // whether or not a scaffold does.
    for (const token of SCAFFOLD_WIRED_REQUIRES) expect(tokens, token).toContain(token);
  });
});

describe('[#20333] the blank template ships every wired barrel', () => {
  const barrels = SCAFFOLD_WIRED_BARRELS.map((b) => {
    const file = `${b.dir}/index.ts`;
    const render = TEMPLATES.app.srcFiles[file];
    return { ...b, file, init: render ? render('my-app', 'my_app') : undefined };
  });

  it.each(barrels.map((b) => [b.file, b] as const))('%s exists', (_file, b) => {
    expect(existsSync(join(BLANK, b.file))).toBe(true);
  });

  const empty = barrels.filter((b) => b.init !== undefined && isEmptyBarrel(b.init));

  it('`os init` writes an empty barrel for every wired directory but objects', () => {
    // Vacuity guard for the byte comparison below.
    expect(empty.map((b) => b.stackKey).sort())
      .toEqual(SCAFFOLD_WIRED_BARRELS.map((b) => b.stackKey).filter((k) => k !== 'objects').sort());
  });

  it.each(empty.map((b) => [b.file, b] as const))('%s is byte-identical to the one `os init` writes', (_file, b) => {
    expect(readFileSync(join(BLANK, b.file), 'utf8')).toBe(b.init);
  });
});
