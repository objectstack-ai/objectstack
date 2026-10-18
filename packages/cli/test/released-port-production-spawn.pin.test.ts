// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24295 — no file that can spawn a PRODUCTION-posture child draws a released
 * port.
 *
 * ## The race this pin keeps closed
 *
 * `reservePort()` / `randomPort()` (`helpers/serve-process.ts`) bind
 * `0.0.0.0:0`, read the port, CLOSE the listener and hand the number over, so
 * the port is unheld between the pick and the child's own `listen()`. A child
 * in production posture refuses to auto-shift by design (`serve.ts`:
 * `✗ Port <n> is already in use.`, exit 1), so for that column a port taken
 * inside the gap is a RED. It reached `main`: an hourly full run went red on
 * `start-mcp-stdio-early-initialize.integration.test.ts`, whose `os start`
 * child found port 45195 taken. The closed mechanism is `KERNEL_ASSIGNED_PORT`
 * (`--port 0`) with `readKernelAssignedPort()`: the child's own kernel picks
 * the port at its own bind, so no number crosses a gap.
 *
 * ## The population: every file that names `bin/run.js`
 *
 * A production-posture child can only come from the BUILT entry. The source
 * entry `bin/run-dev.js` sets `process.env.NODE_ENV = 'development'`
 * unconditionally before argv is parsed, so every tsx child — `runServe()`'s,
 * and an `os start` whose `serve` child inherits that value — is in the
 * development column, where `serve` auto-shifts instead of exiting. So the
 * population is read off the entry, not off the spawn line: any file whose
 * CODE spells `bin/run.js` (a comment naming it is not code), in either of the
 * two spellings this directory uses —
 *
 *   - one string that ends with it: `resolve(HERE, '../bin/run.js')`;
 *   - path SEGMENTS in one call: `join(PACKAGE_ROOT, 'bin', 'run.js')`. A
 *     call's string-literal arguments are split on `/` and read in order, and
 *     the entry's segments must all appear among them, in order; a non-literal
 *     argument contributes nothing. Both segments must sit in ONE call, so a
 *     file holding `'bin'` and `'run.js'` in unrelated expressions is not
 *     admitted, while the first spelling is the one-argument case of the same
 *     reading.
 *
 * That over-approximates on purpose — a file that names the built entry may
 * spawn it in development posture too (`--dev`, `os dev`) — and those files
 * sit in {@link OUTSIDE_THE_PRODUCTION_COLUMN} with their reason and their
 * EXACT draw count, so a new draw added to one of them is reclassified rather
 * than waved through.
 *
 * ## What this pin does not see — named, not discovered
 *
 *   1. The development column: every tsx child still draws, and a lost race
 *      there is a drift that `portDriftError()` turns into a red. That race is
 *      real and unclosed; it is outside this pin by its population.
 *   2. A production-capable entry spelled some other way — a packed tarball's
 *      bin, `dist/` run directly — or its directory held in a variable before
 *      the file name is joined on (`join(BIN_DIR, 'run.js')`). Add the suffix
 *      to {@link PRODUCTION_CAPABLE_ENTRIES} the day a test spawns one.
 *   3. A released draw written by hand (`listen(0)`, read, close) instead of
 *      calling the helper. The census counts calls of the two helpers only.
 *
 * ⛔ Not a gate script and not a CI step: an ordinary unit-tier test in the
 * package whose tests it reads (the card's ruling: no new gate).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** The suffixes of the entries that can produce a production-posture child. */
const PRODUCTION_CAPABLE_ENTRIES = ['bin/run.js'] as const;

/** The same entries as the path segments a `join()` spells them in. */
const ENTRY_SEGMENTS: readonly (readonly string[])[] = PRODUCTION_CAPABLE_ENTRIES.map((entry) => entry.split('/'));

/** The released-port draws `helpers/serve-process.ts` exports. */
const RELEASED_PORT_DRAWS: ReadonlySet<string> = new Set(['reservePort', 'randomPort']);

/** The module those draws come from, as an import specifier ends. */
const HARNESS_MODULE = /(?:^|\/)serve-process(?:\.[cm]?[jt]s)?$/;

const DEVELOPMENT_ONLY_DRIFT_RED =
  'every spawn here is development posture (bin/run.js with --dev), which auto-shifts; a lost race '
  + 'is a drift that this file\'s own port read-back reports as a red — the development-column '
  + 'residual reservePort() documents, not the production column this pin closes.';

/**
 * Files that name `bin/run.js` and still draw, each with the EXACT number of
 * draw calls it may make and why none of them feeds a production-posture spawn.
 *
 * An entry is earned one of two ways, and its `why` says which: every spawn the
 * file makes is development posture, or a production-posture site needs the
 * number BEFORE the spawn and has no closed alternative (`KERNEL_ASSIGNED_PORT`
 * read back afterwards, or a port held for the whole boot). None of the second
 * kind exists today.
 */
const OUTSIDE_THE_PRODUCTION_COLUMN: Readonly<Record<string, { draws: number; why: string }>> = {
  'dev-boot-output-order.integration.test.ts': {
    draws: 1,
    why: '`os dev` under a pty — development posture, which auto-shifts; the file reads no port, so '
      + 'a lost race is neither a red nor a wrong reading.',
  },
  'serve-mcp-capability-collision.e2e.test.ts': { draws: 1, why: DEVELOPMENT_ONLY_DRIFT_RED },
  'serve-mcp-stdio-answers.e2e.test.ts': { draws: 1, why: DEVELOPMENT_ONLY_DRIFT_RED },
  'serve-stdio-stdout-purity.e2e.test.ts': { draws: 1, why: DEVELOPMENT_ONLY_DRIFT_RED },
};

interface Census {
  /** CODE spells a production-capable entry: one string, or one call's segments. */
  namesProductionEntry: boolean;
  /** The 1-based line of every released-port draw call. */
  drawLines: number[];
}

/**
 * Do this call's string-literal arguments, read as path segments in order,
 * spell a production-capable entry — `join(PACKAGE_ROOT, 'bin', 'run.js')`?
 */
function spellsEntryInSegments(call: ts.CallExpression): boolean {
  const segments = call.arguments
    .filter((arg): arg is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => ts.isStringLiteralLike(arg))
    .flatMap((arg) => arg.text.split('/'))
    .filter((segment) => segment !== '' && segment !== '.');
  return ENTRY_SEGMENTS.some((entry) => {
    let matched = 0;
    for (const segment of segments) {
      if (matched < entry.length && segment === entry[matched]) matched += 1;
    }
    return matched === entry.length;
  });
}

/** The enclosing function declaration's name, if any. */
function enclosingFunctionName(node: ts.Node): string | undefined {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor)) return cursor.name?.text;
  }
  return undefined;
}

function censusOf(fileName: string, source: string): Census {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  // Local names a draw arrives under: the exported names themselves, plus any
  // alias an import from the harness module binds. A namespace import needs no
  // entry: `harness.randomPort()` is read off the member name below.
  const drawNames = new Set(RELEASED_PORT_DRAWS);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!HARNESS_MODULE.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if (RELEASED_PORT_DRAWS.has((specifier.propertyName ?? specifier.name).text)) drawNames.add(specifier.name.text);
      }
    }
  }

  let namesProductionEntry = false;
  const drawLines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node))
      && PRODUCTION_CAPABLE_ENTRIES.some((entry) => node.text.endsWith(entry))
    ) {
      namesProductionEntry = true;
    }
    if (ts.isCallExpression(node) && spellsEntryInSegments(node)) namesProductionEntry = true;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDraw = ts.isIdentifier(callee)
        ? drawNames.has(callee.text)
        : ts.isPropertyAccessExpression(callee) && RELEASED_PORT_DRAWS.has(callee.name.text);
      // The helper's own definitions (`randomPort()` is `String(reservePort())`)
      // are where the draw is declared, not a site that draws for a spawn.
      const inDefinition = RELEASED_PORT_DRAWS.has(enclosingFunctionName(node) ?? '');
      if (isDraw && !inDefinition) {
        drawLines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { namesProductionEntry, drawLines };
}

/** Every `.ts` source under this directory, keyed by its POSIX path relative to it. */
function liveTree(): Map<string, Census> {
  const out = new Map<string, Census>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.ts')) {
        out.set(relative(HERE, abs).split(sep).join('/'), censusOf(abs, readFileSync(abs, 'utf8')));
      }
    }
  };
  walk(HERE);
  return out;
}

/** The files a census puts in this pin's population, with the draws each makes. */
function productionCapable(tree: Map<string, Census>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [path, census] of tree) if (census.namesProductionEntry) out.set(path, census.drawLines);
  return out;
}

// The fixture sources are assembled from pieces so that no string in THIS file
// is itself code a reader would take for a spawn: a quote, then the entry.
const Q = "'";
const BUILT = `${Q}../bin/run.js${Q}`;
const SOURCE = `${Q}../bin/run-dev.js${Q}`;
const FROM_HARNESS = `from ${Q}./helpers/serve-process.js${Q};`;
const BIN_SEGMENT = `${Q}bin${Q}`;
const RUN_SEGMENT = `${Q}run.js${Q}`;
const RUN_DEV_SEGMENT = `${Q}run-dev.js${Q}`;

const FIXTURES: Array<{ name: string; source: string; population: boolean; draws: number }> = [
  {
    name: 'a released draw handed to the built entry',
    source: `import { randomPort } ${FROM_HARNESS}\nconst CLI = resolve(HERE, ${BUILT});\n`
      + `const port = randomPort();\nspawn(process.execPath, [CLI, 'start', '-p', port]);\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'the closed mechanism on the built entry',
    source: `import { KERNEL_ASSIGNED_PORT } ${FROM_HARNESS}\nconst CLI = resolve(HERE, ${BUILT});\n`
      + `spawn(process.execPath, [CLI, 'start', '-p', KERNEL_ASSIGNED_PORT]);\n`,
    population: true,
    draws: 0,
  },
  {
    name: 'an aliased draw',
    source: `import { reservePort as pick } ${FROM_HARNESS}\nconst CLI = ${BUILT};\nconst port = pick();\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'a namespace-imported draw',
    source: `import * as harness ${FROM_HARNESS}\nconst CLI = ${BUILT};\nconst port = harness.randomPort();\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'the built entry named only in a comment',
    source: `// spawns bin/run.js\nimport { randomPort } ${FROM_HARNESS}\nconst port = randomPort();\n`,
    population: false,
    draws: 1,
  },
  {
    name: 'the source entry, which pins development posture',
    source: `import { randomPort } ${FROM_HARNESS}\nconst CLI = resolve(HERE, ${SOURCE});\nconst port = randomPort();\n`,
    population: false,
    draws: 1,
  },
  {
    name: 'the built entry spelled in path segments',
    source: `import { randomPort } ${FROM_HARNESS}\nconst RUN_JS = join(PACKAGE_ROOT, ${BIN_SEGMENT}, ${RUN_SEGMENT});\n`
      + `const port = randomPort();\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'the source entry spelled in path segments',
    source: `import { randomPort } ${FROM_HARNESS}\nconst CLI = join(PACKAGE_ROOT, ${BIN_SEGMENT}, ${RUN_DEV_SEGMENT});\n`
      + `const port = randomPort();\n`,
    population: false,
    draws: 1,
  },
  {
    name: 'the two segments in two different calls (a variable-held directory, named in the header)',
    source: `import { randomPort } ${FROM_HARNESS}\nconst BIN_DIR = join(PACKAGE_ROOT, ${BIN_SEGMENT});\n`
      + `const RUN_JS = join(BIN_DIR, ${RUN_SEGMENT});\nconst port = randomPort();\n`,
    population: false,
    draws: 1,
  },
  {
    name: 'the helper\'s own definitions',
    source: 'export function reservePort(): number { return 1; }\n'
      + 'export function randomPort(): string { return String(reservePort()); }\n',
    population: false,
    draws: 0,
  },
];

describe('#24295: no file that can spawn a production-posture child draws a released port', () => {
  it('the census tells apart every shape it has to', () => {
    for (const fixture of FIXTURES) {
      const census = censusOf(`${fixture.name}.ts`, fixture.source);
      expect(census.namesProductionEntry, `${fixture.name}: population`).toBe(fixture.population);
      expect(census.drawLines, `${fixture.name}: draws`).toHaveLength(fixture.draws);
    }
  });

  it('the census reaches the live tree: the built entry and the draw are both found', () => {
    const tree = liveTree();
    const population = productionCapable(tree);
    // ⭐ Positive controls, so an empty finding list below cannot mean "read nothing".
    // The file whose red filed #24295 spawns the built entry…
    expect(population.has('start-mcp-stdio-early-initialize.integration.test.ts'), 'the red site is not in the population')
      .toBe(true);
    // …and the two files that spell it in path segments are read as naming it too.
    for (const segmented of [
      'published-entry-stderr-error-listener.test.ts',
      'published-entry-stderr-nonblocking.e2e.test.ts',
    ]) {
      expect(population.has(segmented), `${segmented} spells bin/run.js in segments but is not in the population`)
        .toBe(true);
    }
    // …and the instrument that measures the draw itself still draws, outside the population.
    const instrument = tree.get('serve-port-bind-probe.test.ts');
    expect(instrument?.drawLines.length ?? 0, 'the draw census finds no draw in the bind-probe instrument').toBeGreaterThan(0);
    expect(instrument?.namesProductionEntry).toBe(false);
  });

  it('every file that names bin/run.js draws exactly what its ledger entry allows — zero without one', () => {
    const offenders: string[] = [];
    for (const [path, drawLines] of productionCapable(liveTree())) {
      const allowed = OUTSIDE_THE_PRODUCTION_COLUMN[path]?.draws ?? 0;
      if (drawLines.length === allowed) continue;
      offenders.push(
        `${path}: ${drawLines.length} released-port draw(s) (line ${drawLines.join(', ')}), ledger allows ${allowed}`,
      );
    }
    expect(
      offenders,
      'A file that can spawn a production-posture child draws a released port. Such a child refuses to '
      + 'auto-shift, so a port taken between reservePort()/randomPort() and its bind is a red. Spawn it '
      + 'with `--port KERNEL_ASSIGNED_PORT` and read the port back with readKernelAssignedPort() '
      + '(helpers/serve-process.ts); a port the test must know but the child must not bind is a '
      + 'holdPort() kept for the whole boot. A development-posture-only file, or a site with no closed '
      + 'alternative, goes in OUTSIDE_THE_PRODUCTION_COLUMN with its reason and exact draw count.',
    ).toEqual([]);
  });

  it('every ledger entry still names a file in the population', () => {
    const population = productionCapable(liveTree());
    const stale = Object.keys(OUTSIDE_THE_PRODUCTION_COLUMN).filter((path) => !population.has(path));
    expect(stale, 'remove these entries: the file is gone or no longer names bin/run.js').toEqual([]);
  });
});
