// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — every command that takes `--json` lets oclif's exit signal through its
 * `catch`, so a completed run prints exactly ONE document and exits 0 (#21434).
 *
 * ## The defect
 *
 * `this.exit(n)` does not end the process. It THROWS oclif's exit signal
 * (`code: 'EEXIT'`, `oclif.exit: n`), and the entry point turns that into the
 * exit status. A `this.exit(0)` written inside a `try` therefore lands in that
 * `try`'s own `catch` first, and a `catch` that reports what it caught reports
 * the signal as an error. Measured at the public door on `aa4632235`:
 *
 *     os migrate recorded-by --apply --yes --json     (one sentinel row)
 *     → the row converted, the result document printed, then a SECOND
 *       document `{"error":"EEXIT: 0"}`, and exit status 1.
 *
 * A completed apply reported failure, and `--json` stdout no longer parsed.
 * `os migrate resume --run` did the same for an already-concluded run, and
 * printed `{"error":"EEXIT: 1"}` under every refusal it makes inside its `try`.
 * The repair is the existing idiom, `if (isExitSignal(error)) throw error;` as
 * the catch's first statement (`src/utils/format.ts` — one predicate, no second
 * helper).
 *
 * ## Why an ENUMERATION, and how a new command enters it
 *
 * The idiom already sat in 17 command files; four more (`migrate recorded-by`,
 * `resume`, `account-issuer`, `apply`) lacked it. A pin naming those four goes
 * green while the next command repeats the shape. So the population is
 * DISCOVERED, not listed:
 *
 *   1. the files oclif's command table is built from — `package.json`
 *      `oclif.commands` (strategy `pattern`, `./dist/commands`, `**\/*.js`),
 *      whose `src/` twin is every non-test `.ts` under `src/commands`
 *      (`tsconfig.build.json` maps `src` → `dist` and excludes the tests);
 *   2. each module IMPORTED and its default export's `static flags` read — the
 *      declaration oclif itself parses, inherited flags included (`os build`
 *      extends `os compile`), never a text match over the source;
 *   3. a member is any command declaring a boolean `json` flag OR a flag whose
 *      `options` include `'json'` (`--format json`): the same audience, a
 *      program reading stdout and the exit status.
 *
 * There is no roster to update. A command added later is in the population the
 * moment its module declares either flag, and this file goes red if any of its
 * `this.exit(…)` calls sits in a `try` whose `catch` does not let the signal
 * through. `os secret rewrap` is the first to have entered that way: it landed
 * beside this pin with its `--json` flag and its rethrow already in place, and
 * no line here names it.
 *
 * ## The two halves
 *
 * - **Structural, over the WHOLE population** (the second `describe`): every
 *   `this.exit(…)` — direct, or through a same-class method that reaches one —
 *   lexically inside a `try` has, in EVERY enclosing `catch`, the
 *   `isExitSignal` rethrow (imported from `utils/format.js`) as its first
 *   statement. Decided over the command's own source and its superclasses'.
 *   That property is exactly what makes "a completed run prints one document
 *   and exits 0" hold against this mechanism, for members whose completed run
 *   needs a server, a cloud account or a database this tier does not boot.
 *   The analyzer is pinned against fixtures first (the first `describe`), so a
 *   detector that stops detecting goes red on the fixture it stopped seeing.
 * - **Driven, for the members the census found in-family** (the third
 *   `describe`): `migrate recorded-by`, `migrate resume` and
 *   `migrate account-issuer` run in-process through oclif with the seams that
 *   would boot a database replaced (`bootSchemaStack`, the journal runner, the
 *   sentinel scan, the collision probe). The commands' own parse, `try`/
 *   `catch`, `emitJson` and `this.exit` run for real, and each case asserts the
 *   two things a `--json` consumer reads: stdout is ONE document (a bare
 *   `JSON.parse`), and the exit status. `migrate apply`'s two sites are on its
 *   TEXT face only (its JSON face returns before them), so the structural half
 *   is its pin.
 *
 * ## Tier
 *
 * `unit` (`vitest-tiers.ts`): nothing is spawned and no kernel boots — the
 * boot seam is replaced through `vi.mock`, never value-imported here. The
 * public-door form of the driven half (a real sqlite file, the CLI spawned) was
 * measured by hand before and after the fix and is recorded on the pull
 * request rather than re-run per CI shard.
 *
 * ## What this does NOT cover
 *
 * - Commands with no JSON face. `os package install`, `os package publish` and
 *   `os plugin sign` carry the same shape on their text face (an extra
 *   `EEXIT: 1` error line, exit status unchanged); they are reported on the
 *   pull request, not widened into here.
 * - `this.error(…)`, which also throws a signal `isExitSignal` recognises. On
 *   this tree no JSON-capable command calls it inside a `try`.
 * - A second document a command writes by calling `emitJson` twice on one
 *   path — a different mechanism, which only the driven half would see.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Config } from '@oclif/core';
import { isExitSignal } from '../src/utils/format.js';
import MigrateRecordedBy from '../src/commands/migrate/recorded-by.js';
import MigrateResume from '../src/commands/migrate/resume.js';
import MigrateAccountIssuer from '../src/commands/migrate/account-issuer.js';

// ---------------------------------------------------------------------------
// Seams for the driven half. Replaced, never value-imported: the commands'
// own control flow is what runs.
// ---------------------------------------------------------------------------

const seams = vi.hoisted(() => ({
  bootSchemaStack: vi.fn(),
  runMigrationJournal: vi.fn(),
  resumeMigrationJournal: vi.fn(),
  findInterruptedRuns: vi.fn(),
  readRunJournal: vi.fn(),
  findSentinelHistoryRows: vi.fn(),
  probeAccountIdentityCollisions: vi.fn(),
}));

vi.mock('../src/utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bootSchemaStack: seams.bootSchemaStack,
}));
vi.mock('../src/utils/data-migration-plugins.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildDataMigrationPlugins: async () => [],
}));
vi.mock('@objectstack/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runMigrationJournal: seams.runMigrationJournal,
  resumeMigrationJournal: seams.resumeMigrationJournal,
  findInterruptedRuns: seams.findInterruptedRuns,
  readRunJournal: seams.readRunJournal,
}));
vi.mock('@objectstack/metadata-protocol', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findSentinelHistoryRows: seams.findSentinelHistoryRows,
}));
// Only `migrate account-issuer` / `migrate apply` import it, and only
// dynamically, inside `run()` — nothing at module scope asks for more.
vi.mock('@objectstack/plugin-auth', () => ({
  probeAccountIdentityCollisions: seams.probeAccountIdentityCollisions,
  formatAccountIdentityPreflightReport: () => '',
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const COMMANDS_DIR = resolve(HERE, '../src/commands');

// ---------------------------------------------------------------------------
// The analyzer
// ---------------------------------------------------------------------------

interface ExitSite {
  file: string;
  line: number;
  /** The call that raises the signal, as written. */
  call: string;
}

interface ExitSignalLeak extends ExitSite {
  /** Line of the `catch` that swallows the signal. */
  catchLine: number;
  reason: string;
}

interface ExitSignalFlow {
  /** Every signal-raising call that sits inside at least one `try` block. */
  sites: ExitSite[];
  /** Each (site, enclosing catch) pair where the catch does not let it through. */
  leaks: ExitSignalLeak[];
}

const FORMAT_MODULE = /(?:^|\/)utils\/format\.js$/;

function isThisCall(node: ts.Node, names: ReadonlySet<string>): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    && names.has(node.expression.name.text);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** The local name `isExitSignal` is bound to by an import from `utils/format.js`, if any. */
function formatIsExitSignalBinding(sf: ts.SourceFile): string | null {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!FORMAT_MODULE.test(stmt.moduleSpecifier.text)) continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      if ((el.propertyName ?? el.name).text === 'isExitSignal') return el.name.text;
    }
  }
  return null;
}

function isRethrowOf(stmt: ts.Statement, binding: string): boolean {
  const target = ts.isBlock(stmt) && stmt.statements.length === 1 ? stmt.statements[0] : stmt;
  return ts.isThrowStatement(target)
    && target.expression !== undefined
    && ts.isIdentifier(target.expression)
    && target.expression.text === binding;
}

/** `null` when the catch lets an exit signal through; otherwise why it does not. */
function catchSwallowReason(cc: ts.CatchClause | undefined, guardName: string | null): string | null {
  if (!cc) return null; // try/finally: the signal propagates
  const decl = cc.variableDeclaration;
  if (!decl || !ts.isIdentifier(decl.name)) return 'the catch has no binding, so it cannot rethrow';
  const binding = decl.name.text;
  const first = cc.block.statements[0];
  if (!first) return 'the catch is empty';
  if (isRethrowOf(first, binding)) return null; // unconditional rethrow
  if (
    ts.isIfStatement(first)
    && !first.elseStatement
    && ts.isCallExpression(first.expression)
    && ts.isIdentifier(first.expression.expression)
    && first.expression.arguments.length === 1
    && ts.isIdentifier(first.expression.arguments[0])
    && first.expression.arguments[0].text === binding
    && isRethrowOf(first.thenStatement, binding)
  ) {
    const callee = first.expression.expression.text;
    if (guardName !== null && callee === guardName) return null;
    return `the first statement rethrows on \`${callee}\`, not on \`isExitSignal\` from utils/format.js`;
  }
  return 'its first statement is not `if (isExitSignal(error)) throw error;`';
}

/**
 * Decide, over one command's source files (its own and its superclasses'),
 * which signal-raising calls are swallowed by an enclosing `catch`.
 */
function analyzeExitSignalFlow(sources: ReadonlyArray<{ file: string; text: string }>): ExitSignalFlow {
  const parsed = sources.map(({ file, text }) => ({
    file,
    sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }));

  // Class members with a body, across the whole chain: a subclass's `run()`
  // may call a helper its superclass defines.
  const members = new Map<string, ts.Node[]>();
  for (const { sf } of parsed) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        for (const m of node.members) {
          const name = m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : null;
          if (!name) continue;
          const body = ts.isMethodDeclaration(m)
            ? m.body
            : ts.isPropertyDeclaration(m) && m.initializer
              && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))
              ? m.initializer
              : undefined;
          if (body) members.set(name, [...(members.get(name) ?? []), body]);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // Fixpoint: a member raises the signal if its body calls `this.exit` or a
  // member that does.
  const raising = new Set<string>(['exit']);
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, bodies] of members) {
      if (raising.has(name)) continue;
      let hit = false;
      const scan = (node: ts.Node): void => {
        if (hit) return;
        if (isThisCall(node, raising)) { hit = true; return; }
        ts.forEachChild(node, scan);
      };
      bodies.forEach(scan);
      if (hit) { raising.add(name); changed = true; }
    }
  }

  const sites: ExitSite[] = [];
  const leaks: ExitSignalLeak[] = [];
  for (const { file, sf } of parsed) {
    const guardName = formatIsExitSignalBinding(sf);
    const walk = (node: ts.Node): void => {
      if (isThisCall(node, raising)) {
        const site: ExitSite = { file, line: lineOf(sf, node), call: node.getText(sf).replace(/\s+/g, ' ') };
        let inTry = false;
        for (let child: ts.Node = node, p = node.parent; p && !ts.isClassElement(p) && !ts.isSourceFile(p); child = p, p = p.parent) {
          if (!ts.isTryStatement(p) || p.tryBlock !== child) continue;
          inTry = true;
          const reason = catchSwallowReason(p.catchClause, guardName);
          if (reason) leaks.push({ ...site, catchLine: lineOf(sf, p.catchClause!), reason });
        }
        if (inTry) sites.push(site);
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return { sites, leaks };
}

// ---------------------------------------------------------------------------
// Discovery — the population, read off oclif's command table
// ---------------------------------------------------------------------------

/** What `package.json` must say for the `src/` walk below to BE oclif's table. */
const OCLIF_COMMANDS = { strategy: 'pattern', target: './dist/commands', glob: '**/*.js' };

/** The `src/` twin of `./dist/commands/**\/*.js` (`tsconfig.build.json`'s exclusions). */
function commandSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry !== '__tests__') out.push(...commandSourceFiles(abs));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(abs);
  }
  return out;
}

function commandId(abs: string): string {
  return relative(COMMANDS_DIR, abs).replace(/\.ts$/, '').split(sep).filter((p) => p !== 'index').join(' ');
}

type FlagDecl = { type?: unknown; options?: unknown };
type CommandClass = (abstract new (...args: never[]) => unknown) & { flags?: Record<string, FlagDecl> };

interface JsonCommand {
  id: string;
  /** How it takes a JSON face: `--json`, or `--<flag> json`. */
  faces: string[];
  /** Its own source file, then each superclass's that lives under src/commands. */
  chain: string[];
}

function jsonFaces(cls: CommandClass): string[] {
  const flags = cls.flags ?? {};
  const faces: string[] = [];
  if (flags.json?.type === 'boolean') faces.push('--json');
  for (const [name, decl] of Object.entries(flags)) {
    if (Array.isArray(decl?.options) && decl.options.includes('json')) faces.push(`--${name} json`);
  }
  return faces;
}

const PKG = JSON.parse(readFileSync(resolve(HERE, '../package.json'), 'utf8')) as {
  oclif?: { commands?: unknown };
};

// Paid at module scope — collection is unclocked; every case below only reads.
const COMMAND_FILES = commandSourceFiles(COMMANDS_DIR);
const classFile = new Map<unknown, string>();
for (const file of COMMAND_FILES) {
  const mod = (await import(file)) as { default?: unknown };
  if (typeof mod.default === 'function') classFile.set(mod.default, file);
}

const POPULATION: JsonCommand[] = [];
for (const [cls, file] of classFile) {
  const faces = jsonFaces(cls as CommandClass);
  if (faces.length === 0) continue;
  const chain: string[] = [];
  for (let k: unknown = cls; k && classFile.has(k); k = Object.getPrototypeOf(k)) chain.push(classFile.get(k)!);
  POPULATION.push({ id: commandId(file), faces, chain });
}
POPULATION.sort((a, b) => a.id.localeCompare(b.id));

const FLOW = new Map(
  POPULATION.map((c) => [c.id, analyzeExitSignalFlow(c.chain.map((file) => ({ file, text: readFileSync(file, 'utf8') })))]),
);

/**
 * Floors, not counts of today: the population and the `this.exit`-in-`try`
 * sites this landed over (46 JSON-capable commands: 32 `--json`, 14
 * `--format json`; 105 sites, 21 of them `os build`'s through `compile.ts`). A
 * discovery or analyzer that silently stops finding anything returns zero, and
 * zero passes every per-member assertion — these are what notice. A drop below
 * them is a broken detector or a deliberate removal; say which when you lower
 * one.
 */
const POPULATION_FLOOR = 46;
const SITE_FLOOR = 105;

// ---------------------------------------------------------------------------
// 1. The analyzer, against fixtures — it must be able to fail
// ---------------------------------------------------------------------------

const IMPORT_GUARD = "import { isExitSignal } from '../../utils/format.js';";

const FIXTURES: Array<{ name: string; src: string; sites: number; leaks: number }> = [
  {
    name: 'an exit inside a try whose catch re-reports it (the defect)',
    src: `class C { async run() { try { this.exit(0); } catch (error) { report(error); this.exit(1); } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'the idiom: the catch opens with the isExitSignal rethrow',
    src: `${IMPORT_GUARD} class C { async run() { try { this.exit(0); } catch (error) { if (isExitSignal(error)) throw error; report(error); } } }`,
    sites: 1, leaks: 0,
  },
  {
    name: 'the idiom with a braced rethrow',
    src: `${IMPORT_GUARD} class C { async run() { try { this.exit(0); } catch (e) { if (isExitSignal(e)) { throw e; } report(e); } } }`,
    sites: 1, leaks: 0,
  },
  {
    name: 'an unconditional rethrow',
    src: `class C { async run() { try { this.exit(0); } catch (e) { throw e; } } }`,
    sites: 1, leaks: 0,
  },
  {
    name: 'an exit outside every try',
    src: `class C { async run() { try { work(); } catch (e) { report(e); } this.exit(0); } }`,
    sites: 0, leaks: 0,
  },
  {
    name: 'a try/finally with no catch',
    src: `class C { async run() { try { this.exit(0); } finally { cleanup(); } } }`,
    sites: 1, leaks: 0,
  },
  {
    name: 'a catch with no binding',
    src: `class C { async run() { try { this.exit(0); } catch { report(); } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'the rethrow present but not first',
    src: `${IMPORT_GUARD} class C { async run() { try { this.exit(0); } catch (e) { log(e); if (isExitSignal(e)) throw e; } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'a second helper in place of isExitSignal',
    src: `class C { async run() { try { this.exit(0); } catch (e) { if (isExit(e)) throw e; report(e); } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'isExitSignal imported from somewhere other than utils/format.js',
    src: `import { isExitSignal } from './local.js'; class C { async run() { try { this.exit(0); } catch (e) { if (isExitSignal(e)) throw e; } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'an exit reached through a same-class helper',
    src: `class C { async run() { try { await this.finish(); } catch (e) { report(e); } } private async finish() { this.exit(0); } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'an exit reached through a helper that is an arrow-function property',
    src: `class C { private done = () => { this.exit(0); }; async run() { try { this.done(); } catch (e) { report(e); } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'nested tries: inner catch guarded, outer catch re-reports',
    src: `${IMPORT_GUARD} class C { async run() { try { try { this.exit(0); } catch (e) { if (isExitSignal(e)) throw e; } } catch (e) { report(e); } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: "an exit in an inner try's catch, inside an outer try that re-reports",
    src: `class C { async run() { try { try { read(); } catch (e) { this.exit(1); } } catch (e) { report(e); } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'an exit inside a callback within the try (judged conservatively)',
    src: `class C { async run() { try { await Promise.all([1].map(async () => { this.exit(1); })); } catch (e) { report(e); } } }`,
    sites: 1, leaks: 1,
  },
];

describe('the analyzer decides the fixtures it was written against', () => {
  it.each(FIXTURES)('$name', ({ src, sites, leaks }) => {
    const flow = analyzeExitSignalFlow([{ file: 'src/commands/fixture.ts', text: src }]);
    expect(flow.sites).toHaveLength(sites);
    expect(flow.leaks).toHaveLength(leaks);
  });
});

// ---------------------------------------------------------------------------
// 2. The population — every JSON-capable command, structurally
// ---------------------------------------------------------------------------

describe('every command that takes a JSON face lets the exit signal through', () => {
  it("discovers from the table oclif builds — package.json's command strategy is the one the walk mirrors", () => {
    expect(PKG.oclif?.commands).toEqual(OCLIF_COMMANDS);
    // Every module under the walk is a command: a file the walk lists but
    // that exports no class would be a hole in the population, not a member.
    expect(COMMAND_FILES.filter((f) => ![...classFile.values()].includes(f)).map((f) => relative(PKG_ROOT, f))).toEqual([]);
  });

  it('the population is not vacuous — the floor holds and the commands this was filed on are in it', () => {
    expect(POPULATION.length, 'fewer JSON-capable commands discovered than this pin landed over').toBeGreaterThanOrEqual(POPULATION_FLOOR);
    const ids = POPULATION.map((c) => c.id);
    for (const anchor of ['migrate recorded-by', 'migrate resume', 'migrate account-issuer', 'migrate apply', 'build']) {
      expect(ids).toContain(anchor);
    }
    // Inheritance is followed: `os build` declares nothing itself.
    expect(POPULATION.find((c) => c.id === 'build')?.chain.map((f) => relative(COMMANDS_DIR, f))).toEqual(['build.ts', 'compile.ts']);
  });

  it('the scan reaches the sites — including the completed-apply exit this was filed on', () => {
    const total = [...FLOW.values()].reduce((n, f) => n + f.sites.length, 0);
    expect(total, 'fewer this.exit-in-try sites found than this pin landed over').toBeGreaterThanOrEqual(SITE_FLOOR);
    expect(FLOW.get('migrate recorded-by')?.sites.map((s) => s.call)).toContain(
      "this.exit(result.status === 'completed' ? 0 : 1)",
    );
  });

  it.each(POPULATION.map((c) => [c.id, c.faces.join(' | ')]))('os %s (%s)', (id) => {
    const leaks = FLOW.get(id)!.leaks.map(
      (l) => `${relative(PKG_ROOT, l.file)}:${l.line} ${l.call} — swallowed by the catch at line ${l.catchLine}: ${l.reason}`,
    );
    expect(leaks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The in-family members, driven — one document, the right exit status
// ---------------------------------------------------------------------------

/** Paid at module scope, like the imports above — never inside a clocked case. */
const config = await Config.load({ root: PKG_ROOT });

/**
 * The top-level JSON values in `text`, in order. A residue that is not JSON
 * throws — that is a failure too. Used for the MESSAGE (it names the extra
 * document); the contract itself is the bare `JSON.parse` each case also makes.
 */
function jsonDocuments(text: string): unknown[] {
  const docs: unknown[] = [];
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return docs;
    const start = i;
    let depth = 0;
    let inString = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    docs.push(JSON.parse(text.slice(start, i)));
  }
}

interface Driven {
  stdout: string;
  documents: unknown[];
  /** The status the shell would see: the signal's code, else `process.exitCode`, else 0. */
  exit: number;
}

type Runnable = { run(argv: string[], opts?: Config): Promise<unknown> };

const OUTER_EXIT_CODE = process.exitCode;

async function drive(cmd: Runnable, argv: string[]): Promise<Driven> {
  const chunks: string[] = [];
  // `emitJson` awaits the write's drain callback, so the double must call it.
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, enc?: unknown, cb?: unknown) => {
    chunks.push(String(chunk));
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.exitCode = undefined;
  let exit: number;
  try {
    await cmd.run(argv, config);
    exit = typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (!isExitSignal(error)) throw error;
    exit = (error as { oclif: { exit: number } }).oclif.exit;
  } finally {
    write.mockRestore();
    log.mockRestore();
    process.exitCode = OUTER_EXIT_CODE;
  }
  const stdout = chunks.join('');
  return { stdout, documents: jsonDocuments(stdout), exit };
}

function expectOneDocument(run: Driven): Record<string, unknown> {
  expect(run.documents, `stdout carried ${run.documents.length} JSON documents:\n${run.stdout}`).toHaveLength(1);
  // What a consumer actually does with `--json` stdout.
  const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
  expect(parsed).toEqual(run.documents[0]);
  return parsed;
}

const engine = { find: vi.fn(async () => []) };

function stackWith(services: Record<string, unknown>) {
  return {
    kernel: {
      getService: (name: string): unknown => {
        if (name in services) return services[name];
        throw new Error(`service '${name}' is not composed in this fixture`);
      },
    },
    dbLabel: 'file:exit-signal-pin.db',
    shutdown: vi.fn(async () => {}),
  };
}

function runResult(status: 'completed' | 'compensated' | 'failed') {
  return {
    runId: 'run-1',
    status,
    chunksTotal: 1,
    chunksCommitted: status === 'completed' ? 1 : 0,
    chunksCompensated: status === 'compensated' ? 1 : 0,
    planHash: 'hash',
    ...(status === 'completed' ? {} : { error: new Error('chunk 0 failed') }),
  };
}

const INTERRUPTED = {
  runId: 'run-1', planId: 'plan-1', planHash: 'hash', committedChunks: [], unknownChunks: [0], compensatedChunks: [],
};

beforeEach(() => {
  for (const seam of Object.values(seams)) seam.mockReset();
});

afterEach(() => {
  process.exitCode = OUTER_EXIT_CODE;
});

describe('os migrate recorded-by --json, driven', () => {
  beforeEach(() => {
    seams.bootSchemaStack.mockResolvedValue(stackWith({ objectql: engine }));
    seams.findSentinelHistoryRows.mockResolvedValue([{ id: 'history-1' }]);
  });

  it.each([
    ['completed', 0],
    ['compensated', 1],
    ['failed', 1],
  ] as const)('--apply --yes, journal %s: ONE document, exit %i', async (status, code) => {
    seams.runMigrationJournal.mockResolvedValue(runResult(status));
    const run = await drive(MigrateRecordedBy, ['--apply', '--yes', '--json']);
    expect(expectOneDocument(run)).toMatchObject({ status, applied: true, pending: 1 });
    expect(run.exit).toBe(code);
  });

  it('--apply without --yes: the confirmation refusal is ONE document, exit 1', async () => {
    const run = await drive(MigrateRecordedBy, ['--apply', '--json']);
    expect(expectOneDocument(run)).toMatchObject({ error: 'confirmation_required' });
    expect(run.exit).toBe(1);
    expect(seams.runMigrationJournal).not.toHaveBeenCalled();
  });
});

describe('os migrate resume --json, driven', () => {
  const plan = { id: 'plan-1', onCrash: 'resume' };

  beforeEach(() => {
    seams.bootSchemaStack.mockResolvedValue(stackWith({
      objectql: engine,
      'migration-plans': { get: (id: string) => (id === plan.id ? plan : undefined) },
    }));
    seams.findInterruptedRuns.mockResolvedValue([INTERRUPTED]);
  });

  it.each([
    ['completed', 0],
    ['compensated', 0],
    ['failed', 1],
  ] as const)('--run --yes, resumed run %s: ONE document, exit %i', async (status, code) => {
    seams.resumeMigrationJournal.mockResolvedValue(runResult(status));
    const run = await drive(MigrateResume, ['--run', 'run-1', '--yes', '--json']);
    expect(expectOneDocument(run)).toMatchObject({ runId: 'run-1', status });
    expect(run.exit).toBe(code);
  });

  it('--run on a run that already concluded: ONE document, exit 0', async () => {
    seams.findInterruptedRuns.mockResolvedValue([]);
    seams.readRunJournal.mockResolvedValue([{ kind: 'run_started' }, { kind: 'run_done' }]);
    const run = await drive(MigrateResume, ['--run', 'run-1', '--json']);
    expect(String(expectOneDocument(run).error)).toContain('already concluded');
    expect(run.exit).toBe(0);
  });

  it('--run on an id the journal never saw: ONE document, exit 1', async () => {
    seams.findInterruptedRuns.mockResolvedValue([]);
    seams.readRunJournal.mockResolvedValue([]);
    const run = await drive(MigrateResume, ['--run', 'run-9', '--json']);
    expect(String(expectOneDocument(run).error)).toContain('No journal rows');
    expect(run.exit).toBe(1);
  });

  it('--run without --yes: the confirmation refusal is ONE document, exit 1', async () => {
    const run = await drive(MigrateResume, ['--run', 'run-1', '--json']);
    expect(expectOneDocument(run)).toMatchObject({ error: 'confirmation_required' });
    expect(run.exit).toBe(1);
    expect(seams.resumeMigrationJournal).not.toHaveBeenCalled();
  });

  it('--run on a run whose plan no loaded package registers: ONE document, exit 1', async () => {
    seams.findInterruptedRuns.mockResolvedValue([{ ...INTERRUPTED, planId: 'plan-unloaded' }]);
    const run = await drive(MigrateResume, ['--run', 'run-1', '--yes', '--json']);
    expect(expectOneDocument(run)).toMatchObject({ planId: 'plan-unloaded' });
    expect(run.exit).toBe(1);
  });
});

describe('os migrate account-issuer --json, driven', () => {
  beforeEach(() => {
    seams.bootSchemaStack.mockResolvedValue(stackWith({ objectql: engine }));
  });

  it.each([
    [true, 0],
    [false, 1],
  ] as const)('pre-flight ok=%s: ONE document, exit %i', async (ok, code) => {
    seams.probeAccountIdentityCollisions.mockResolvedValue({ ok, scanned: 2, collisions: ok ? [] : [{ key: 'k' }] });
    const run = await drive(MigrateAccountIssuer, ['--json']);
    expect(expectOneDocument(run)).toMatchObject({ ok, database: 'file:exit-signal-pin.db' });
    expect(run.exit).toBe(code);
  });
});
