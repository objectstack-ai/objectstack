// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24295, widened by #24342 — no file that spawns the CLI draws a released port.
 *
 * ## The race this pin keeps closed
 *
 * `reservePort()` / `randomPort()` (`helpers/serve-process.ts`) bind
 * `0.0.0.0:0`, read the port, CLOSE the listener and hand the number over, so
 * the port is unheld between the pick and the child's own `listen()`. A port
 * taken inside that gap reds a correct tree in BOTH columns: a production-
 * posture child refuses to auto-shift (`✗ Port <n> is already in use.`, exit
 * 1 — an hourly full run went red on exactly that, port 45195), and a
 * development-posture child hops to the next port, which `portDriftError()`
 * then turns into a red on purpose. The closed mechanism is
 * `KERNEL_ASSIGNED_PORT` (`--port 0`) with `readKernelAssignedPort()`: the
 * child's own kernel picks the port at its own bind, so no number crosses a
 * gap. `runServe()` does both when its caller passes no `--port`.
 *
 * ## The population: every file that spawns the CLI
 *
 * Read off what the file's CODE (a comment is not code) can reach, not off the
 * spawn line, so it over-approximates on purpose:
 *
 *   - it spells an entry, `bin/run.js` (the built one, the only door to
 *     production posture) or `bin/run-dev.js` (the tsx one, which pins
 *     `NODE_ENV=development` before argv is parsed), in either spelling this
 *     directory uses — one string that ends with it
 *     (`resolve(HERE, '../bin/run.js')`), or path SEGMENTS in one call
 *     (`join(PACKAGE_ROOT, 'bin', 'run.js')`: a call's string-literal arguments
 *     are split on `/` and read in order, the entry's segments must all appear
 *     among them, in order, and a non-literal argument contributes nothing);
 *   - or it imports one of the harness's CLI spawners, `CLI` (the tsx entry)
 *     or `runServe()`, by name, under an alias, or as a namespace member.
 *     `TSX` alone is not one: it runs whatever script it is handed.
 *
 * A file in the population may draw only as often as its
 * {@link RELEASED_DRAW_LEDGER} entry says — zero without one — so a new draw
 * in a ledgered file is reclassified rather than waved through.
 *
 * ## What this pin does not see — named, not discovered
 *
 *   1. An entry spelled some other way — a packed tarball's bin, `dist/` run
 *      directly — or its directory held in a variable before the file name is
 *      joined on (`join(BIN_DIR, 'run.js')`). Add the suffix to
 *      {@link CLI_ENTRIES} the day a test spawns one.
 *   2. A released draw written by hand (`listen(0)`, read, close) instead of
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

/** The suffixes of the CLI's two entries: the built one and the tsx one. */
const CLI_ENTRIES = ['bin/run.js', 'bin/run-dev.js'] as const;

/** The same entries as the path segments a `join()` spells them in. */
const ENTRY_SEGMENTS: readonly (readonly string[])[] = CLI_ENTRIES.map((entry) => entry.split('/'));

/** The released-port draws `helpers/serve-process.ts` exports. */
const RELEASED_PORT_DRAWS: ReadonlySet<string> = new Set(['reservePort', 'randomPort']);

/** The harness exports that spawn the CLI: the tsx entry itself, and `runServe()`. */
const CLI_SPAWNERS: ReadonlySet<string> = new Set(['CLI', 'runServe']);

/** The module those draws come from, as an import specifier ends. */
const HARNESS_MODULE = /(?:^|\/)serve-process(?:\.[cm]?[jt]s)?$/;

/**
 * Slice 2 of #24342 converts the rest of the development column: the bespoke
 * tsx spawners (the seven `package-install-local-*` `os start` files and the
 * other files that spawn `CLI` themselves) and the four `bin/run.js --dev` /
 * `os dev` files. Until it lands, a lost race there is a drift that each file's
 * own read-back reports as a red on a correct tree.
 */
const SLICE_2 = 'slice 2 of #24342';

/**
 * Files that spawn the CLI and still draw, each with the EXACT number of draw
 * calls it may make and why. Every entry today is a file slice 1 of #24342 did
 * not convert; a site that genuinely needs a number BEFORE the spawn and has no
 * closed alternative (`KERNEL_ASSIGNED_PORT` read back afterwards, or a port
 * held for the whole boot) would earn an entry with that reason instead.
 */
const RELEASED_DRAW_LEDGER: Readonly<Record<string, { draws: number; why: string }>> = {
  'artifact-flag-precedence.integration.test.ts': { draws: 1, why: SLICE_2 },
  'dev-boot-output-order.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-install-local-boot-steps.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-install-local-handlers.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-install-local-hooks.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-install-local-jobs-pull.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-install-local-jobs-shared-name.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-install-local-jobs.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-install-local-uninstall-cleanups.integration.test.ts': { draws: 1, why: SLICE_2 },
  'package-restart-acceptance.integration.test.ts': { draws: 1, why: SLICE_2 },
  'serve-app-anchored-optional-import.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-config-boot-flat-docs.integration.test.ts': { draws: 1, why: SLICE_2 },
  'serve-config-boot-residual.integration.test.ts': { draws: 2, why: SLICE_2 },
  'serve-host-config-metadata-door.integration.test.ts': { draws: 2, why: SLICE_2 },
  'serve-mcp-capability-collision.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-mcp-stdio-answers.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-migrate-exit-schema-parity.integration.test.ts': { draws: 1, why: SLICE_2 },
  'serve-organization-record-page.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-port-drift-notice.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-process-child-env.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-publishes-bound-port.e2e.test.ts': { draws: 2, why: SLICE_2 },
  'serve-runtime-assets-branding-warning.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-stdio-stdout-purity.e2e.test.ts': { draws: 1, why: SLICE_2 },
  'serve-view-container-read.integration.test.ts': { draws: 1, why: SLICE_2 },
  'start-signal-forwarding.e2e.test.ts': { draws: 1, why: SLICE_2 },
};

interface Census {
  /** CODE spells a CLI entry, or imports one of the harness's CLI spawners. */
  spawnsCli: boolean;
  /** The 1-based line of every released-port draw call. */
  drawLines: number[];
}

/**
 * Do this call's string-literal arguments, read as path segments in order,
 * spell a CLI entry — `join(PACKAGE_ROOT, 'bin', 'run.js')`?
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
  // entry: `harness.randomPort()` is read off the member name below. A CLI
  // spawner imported from the harness — by name, under an alias, or as a
  // namespace member — puts the file in the population on its own.
  const drawNames = new Set(RELEASED_PORT_DRAWS);
  const namespaces = new Set<string>();
  let spawnsCli = false;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!HARNESS_MODULE.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        const exported = (specifier.propertyName ?? specifier.name).text;
        if (RELEASED_PORT_DRAWS.has(exported)) drawNames.add(specifier.name.text);
        if (CLI_SPAWNERS.has(exported)) spawnsCli = true;
      }
    }
  }

  const drawLines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node))
      && CLI_ENTRIES.some((entry) => node.text.endsWith(entry))
    ) {
      spawnsCli = true;
    }
    if (ts.isCallExpression(node) && spellsEntryInSegments(node)) spawnsCli = true;
    if (
      ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
      && namespaces.has(node.expression.text) && CLI_SPAWNERS.has(node.name.text)
    ) {
      spawnsCli = true;
    }
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
  return { spawnsCli, drawLines };
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
function cliSpawners(tree: Map<string, Census>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [path, census] of tree) if (census.spawnsCli) out.set(path, census.drawLines);
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
// Spelled in pieces as well: the literal call shape in this file's code would put it in the
// `integration` tier, whose predicate (`vitest-tiers.ts`) reads `runServe` + `(` in code position.
const RUN_SERVE = 'runServe';

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
    name: 'the source entry, which pins development posture — a lost race there drifts and reds',
    source: `import { randomPort } ${FROM_HARNESS}\nconst CLI = resolve(HERE, ${SOURCE});\nconst port = randomPort();\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'the harness runServe helper, handed a released draw',
    source: `import { randomPort, ${RUN_SERVE} } ${FROM_HARNESS}\nawait ${RUN_SERVE}(dir, ['--port', randomPort()], opts);\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'the harness CLI under an alias',
    source: `import { CLI as ENTRY, randomPort } ${FROM_HARNESS}\nspawn(TSX, [ENTRY, 'serve', '-p', randomPort()]);\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'the harness CLI as a namespace member',
    source: `import * as harness ${FROM_HARNESS}\nspawn(harness.TSX, [harness.CLI, 'serve', '-p', harness.randomPort()]);\n`,
    population: true,
    draws: 1,
  },
  {
    name: 'TSX alone, running a script that is not the CLI',
    source: `import { TSX, randomPort } ${FROM_HARNESS}\nspawn(TSX, [CHILD_SCRIPT, randomPort()]);\n`,
    population: false,
    draws: 1,
  },
  {
    name: 'a local CLI that is no entry and no harness import',
    source: `import { randomPort } ${FROM_HARNESS}\nconst CLI = someOtherTool();\nspawn(CLI, [randomPort()]);\n`,
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
    population: true,
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

describe('#24295 / #24342: no file that spawns the CLI draws a released port', () => {
  it('the census tells apart every shape it has to', () => {
    for (const fixture of FIXTURES) {
      const census = censusOf(`${fixture.name}.ts`, fixture.source);
      expect(census.spawnsCli, `${fixture.name}: population`).toBe(fixture.population);
      expect(census.drawLines, `${fixture.name}: draws`).toHaveLength(fixture.draws);
    }
  });

  it('the census reaches the live tree: every way of spawning the CLI, and the draw, are found', () => {
    const tree = liveTree();
    const population = cliSpawners(tree);
    // ⭐ Positive controls, so an empty finding list below cannot mean "read nothing".
    for (const [file, how] of [
      // The file whose red filed #24295 spawns the built entry…
      ['start-mcp-stdio-early-initialize.integration.test.ts', 'spawns bin/run.js'],
      // …two files spell it in path segments…
      ['published-entry-stderr-error-listener.test.ts', 'spells bin/run.js in segments'],
      ['published-entry-stderr-nonblocking.e2e.test.ts', 'spells bin/run.js in segments'],
      // …and the development column (#24342): a runServe caller, a harness-CLI spawner, a run-dev.js speller.
      ['serve-boot-diagnostics.e2e.test.ts', 'calls the runServe helper'],
      ['package-install-local-handlers.integration.test.ts', 'spawns the harness CLI'],
      ['start-signal-forwarding.e2e.test.ts', 'spells bin/run-dev.js'],
    ]) {
      expect(population.has(file), `${file} ${how} but is not in the population`).toBe(true);
    }
    // …and the instrument that measures the draw itself still draws, outside the population.
    const instrument = tree.get('serve-port-bind-probe.test.ts');
    expect(instrument?.drawLines.length ?? 0, 'the draw census finds no draw in the bind-probe instrument').toBeGreaterThan(0);
    expect(instrument?.spawnsCli).toBe(false);
  });

  it('every file that spawns the CLI draws exactly what its ledger entry allows — zero without one', () => {
    const offenders: string[] = [];
    for (const [path, drawLines] of cliSpawners(liveTree())) {
      const allowed = RELEASED_DRAW_LEDGER[path]?.draws ?? 0;
      if (drawLines.length === allowed) continue;
      offenders.push(
        `${path}: ${drawLines.length} released-port draw(s) (line ${drawLines.join(', ')}), ledger allows ${allowed}`,
      );
    }
    expect(
      offenders,
      'A file that spawns the CLI draws a released port. A port taken between reservePort()/randomPort() '
      + 'and the child\'s bind is a red in either posture: production refuses to auto-shift, development '
      + 'shifts and the read-back reds the drift. Spawn with `--port KERNEL_ASSIGNED_PORT` and read the '
      + 'port back with readKernelAssignedPort() (helpers/serve-process.ts), or give the runServe helper no '
      + '`--port` and use the port it returns; a port the test must know but the child must not bind is '
      + 'a holdPort() kept for the whole boot. A site with no closed alternative goes in '
      + 'RELEASED_DRAW_LEDGER with its reason and exact draw count.',
    ).toEqual([]);
  });

  it('every ledger entry still names a file in the population', () => {
    const population = cliSpawners(liveTree());
    const stale = Object.keys(RELEASED_DRAW_LEDGER).filter((path) => !population.has(path));
    expect(stale, 'remove these entries: the file is gone or no longer spawns the CLI').toEqual([]);
  });
});
