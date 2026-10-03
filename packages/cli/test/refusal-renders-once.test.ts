// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — a command that renders its refusal itself never also hands the sentence
 * to oclif: no `printError(msg)` + `this.error(msg)` pair under `src/commands`.
 *
 * ## The defect
 *
 * `printError` writes the `✗` line on stdout. `this.error(msg)` throws a
 * `CLIError`, and oclif's entry point renders that as its own `Error:` block on
 * stderr. A refusal that did both was read twice, across two streams —
 * `os init demo -t bogus` printed `✗ Unknown template: bogus` and then oclif's
 * block with the same sentence, exit 2. Ten sites in `init.ts` and `compile.ts`
 * did it; each now renders its `✗` line once and ends in `this.exit(2)`, the
 * status `this.error` raised, which renders nothing.
 *
 * ## What this half pins, and what the other half pins
 *
 * This file is the STRUCTURAL half, over the WHOLE population: every function
 * under `src/commands` that calls one of `utils/format.ts`'s refusal printers
 * (`printError`, `printErrorToStderr`) must not also call `this.error`. It is
 * decided from the syntax tree — a call to an identifier bound by an import
 * from `utils/format.js` (aliases followed), and `this.error(…)` — never a text
 * match, and the population is discovered, not listed, so a command added later
 * is in it the moment its module exists. A pin naming only `init` and `compile`
 * would stay green while the next command repeated the shape.
 *
 * The DRIVEN half is `refusal-renders-once.e2e.test.ts`: it spawns the CLI
 * through each of the ten sites and counts the sentence across both streams and
 * the exit status. That half is nightly (a spawn costs seconds apiece); this
 * half costs milliseconds and runs in the queue, so the mechanism cannot come
 * back between nights.
 *
 * ## What it does NOT judge
 *
 * A function that prints a refusal line and ends in `this.exit(n)` is the
 * shape, and is not seen. A `this.error` in a function that prints nothing
 * through those printers is the other legal shape — oclif renders the sentence
 * and the command renders none — and is not seen either (`os datasource
 * introspect` is one). Only the pair is the defect.
 *
 * ## Tier
 *
 * `unit` (`vitest-tiers.ts`): it reads source text and parses it; nothing is
 * spawned and no kernel boots.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const COMMANDS_DIR = join(PKG_ROOT, 'src', 'commands');

const FORMAT_MODULE = /(?:^|\/)utils\/format\.js$/;
/** The `utils/format.ts` printers that write a refusal line (`✗ …`). */
const REFUSAL_PRINTERS: ReadonlySet<string> = new Set(['printError', 'printErrorToStderr']);

interface RefusalPair {
  /** The outermost method or function holding both calls. */
  fn: string;
  printerLines: number[];
  errorLines: number[];
}

interface Scan {
  pairs: RefusalPair[];
  /** `this.error(…)` calls seen, paired or not — the detector's own evidence. */
  errorCalls: number;
  /** Calls to a refusal printer seen, paired or not. */
  printerCalls: number;
}

/**
 * Every function in `text` that calls a refusal printer AND `this.error`.
 * Calls are grouped under the outermost method / function declaration they sit
 * in, so a callback inside `run()` counts toward `run()`.
 */
function scanRefusalPairs(fileName: string, text: string): Scan {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

  // The local names the refusal printers are bound to, alias-aware: a call to a
  // function that merely happens to be called `printError` is not one.
  const printers = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!FORMAT_MODULE.test(stmt.moduleSpecifier.text)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (REFUSAL_PRINTERS.has((el.propertyName ?? el.name).text)) printers.add(el.name.text);
    }
  }

  const groups = new Map<string, { printerLines: number[]; errorLines: number[] }>();
  let errorCalls = 0;
  let printerCalls = 0;

  const visit = (node: ts.Node, owner: string): void => {
    let next = owner;
    if (owner === '<module>') {
      if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name) {
        next = node.name.getText(sf);
      } else if (
        ts.isVariableDeclaration(node)
        && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        next = node.name.getText(sf);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const group = groups.get(next) ?? groups.set(next, { printerLines: [], errorLines: [] }).get(next)!;
      if (ts.isIdentifier(callee) && printers.has(callee.text)) {
        group.printerLines.push(line);
        printerCalls++;
      } else if (
        ts.isPropertyAccessExpression(callee)
        && callee.expression.kind === ts.SyntaxKind.ThisKeyword
        && callee.name.text === 'error'
      ) {
        group.errorLines.push(line);
        errorCalls++;
      }
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(sf, '<module>');

  const pairs: RefusalPair[] = [];
  for (const [fn, g] of groups) {
    if (g.printerLines.length > 0 && g.errorLines.length > 0) pairs.push({ fn, ...g });
  }
  return { pairs, errorCalls, printerCalls };
}

// ---------------------------------------------------------------------------
// 1. The scan, against fixtures — it must be able to fail
// ---------------------------------------------------------------------------

const IMPORT = "import { printError } from '../utils/format.js';";

const FIXTURES: Array<{ name: string; src: string; pairs: number }> = [
  {
    name: 'a refusal printed and then raised with `this.error` (the defect)',
    src: `${IMPORT} class C { async run() { printError('no'); this.error('no'); } }`,
    pairs: 1,
  },
  {
    name: 'the stderr printer is a refusal printer too',
    src: "import { printErrorToStderr } from '../utils/format.js'; class C { async run() { printErrorToStderr('no'); this.error('no'); } }",
    pairs: 1,
  },
  {
    name: 'an aliased import is followed',
    src: "import { printError as fail } from '../utils/format.js'; class C { async run() { fail('no'); this.error('no'); } }",
    pairs: 1,
  },
  {
    name: 'a call inside a callback counts toward the method that holds it',
    src: `${IMPORT} class C { async run() { [1].forEach(() => { printError('no'); }); this.error('no'); } }`,
    pairs: 1,
  },
  {
    name: 'the shape: print the refusal, then `this.exit(n)`',
    src: `${IMPORT} class C { async run() { printError('no'); this.exit(2); } }`,
    pairs: 0,
  },
  {
    name: 'the other legal shape: `this.error` and nothing printed through the refusal printers',
    src: `class C { async run() { this.log('checked'); this.error('no'); } }`,
    pairs: 0,
  },
  {
    name: 'a printer and a `this.error` in different methods',
    src: `${IMPORT} class C { async a() { printError('no'); } async b() { this.error('no'); } }`,
    pairs: 0,
  },
  {
    name: 'a local function that is merely named `printError` is not the refusal printer',
    src: `function printError(m) {} class C { async run() { printError('no'); this.error('no'); } }`,
    pairs: 0,
  },
  {
    name: 'an `error` method on something other than `this`',
    src: `${IMPORT} class C { async run() { printError('no'); logger.error('no'); } }`,
    pairs: 0,
  },
];

describe('the scan decides the fixtures it was written against', () => {
  it.each(FIXTURES)('$name', ({ src, pairs }) => {
    expect(scanRefusalPairs('src/commands/fixture.ts', src).pairs).toHaveLength(pairs);
  });
});

// ---------------------------------------------------------------------------
// 2. The population — every command module, structurally
// ---------------------------------------------------------------------------

/** Every non-test `.ts` module under `src/commands`, the files oclif's command table is built from. */
function commandFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return commandFiles(full);
    return /\.ts$/.test(entry.name) && !/\.(?:test|d)\.ts$/.test(entry.name) ? [full] : [];
  });
}

const FILES = commandFiles(COMMANDS_DIR);
const SCANS = FILES.map((file) => ({ file: relative(PKG_ROOT, file), scan: scanRefusalPairs(file, readFileSync(file, 'utf8')) }));

/**
 * Floors, measured on `fd5a1cd597`: 65 command modules, 57 of them calling a
 * refusal printer, and `this.error` raised from 3 (`os datasource introspect`,
 * `list-tables`, `validate`) once `init.ts` and `compile.ts` stopped. A scan
 * that silently finds nothing reports zero pairs, and zero passes every
 * assertion below; these are what notice. A drop below them is a broken
 * detector or a deliberate removal — say which when you lower one.
 */
const FILE_FLOOR = 60;
const PRINTER_FILE_FLOOR = 50;
const ERROR_FILE_FLOOR = 3;

describe('no command renders a refusal and also raises it with this.error', () => {
  it('the population is not vacuous — the floors hold', () => {
    expect(FILES.length, 'fewer command modules than this pin was written over').toBeGreaterThanOrEqual(FILE_FLOOR);
    expect(SCANS.filter((s) => s.scan.printerCalls > 0).length, 'refusal printers not found').toBeGreaterThanOrEqual(PRINTER_FILE_FLOOR);
    expect(SCANS.filter((s) => s.scan.errorCalls > 0).length, '`this.error` not found').toBeGreaterThanOrEqual(ERROR_FILE_FLOOR);
  });

  it('every command module is clear of the pair', () => {
    const pairs = SCANS.flatMap(({ file, scan }) =>
      scan.pairs.map(
        (p) => `${file} ${p.fn}(): refusal printed at line ${p.printerLines.join(', ')}, then \`this.error\` at line ${p.errorLines.join(', ')} — oclif renders the sentence a second time on stderr; end in \`this.exit(n)\` instead`,
      ),
    );
    expect(pairs).toEqual([]);
  });
});
