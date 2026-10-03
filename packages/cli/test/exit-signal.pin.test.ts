// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — every command lets oclif's exit signal through its `catch`: a completed
 * `--json` run prints exactly ONE document and exits 0, and a refusal on the
 * text face prints exactly ONE error line (#21434, #21496, #21523).
 *
 * ## The defect
 *
 * `this.exit(n)` does not end the process. It THROWS oclif's exit signal
 * (`code: 'EEXIT'`, `oclif.exit: n`), and the entry point turns that into the
 * exit status. A `this.exit(0)` written inside a `try` therefore lands in that
 * `try`'s own `catch` first, and a `catch` that reports what it caught reports
 * the signal as an error. The JSON face, measured at the public door on
 * `aa4632235`:
 *
 *     os migrate recorded-by --apply --yes --json     (one sentinel row)
 *     → the row converted, the result document printed, then a SECOND
 *       document `{"error":"EEXIT: 0"}`, and exit status 1.
 *
 * A completed apply reported failure, and `--json` stdout no longer parsed.
 * `os migrate resume --run` did the same for an already-concluded run, and
 * printed `{"error":"EEXIT: 1"}` under every refusal it makes inside its `try`.
 *
 * The text face has the same shape. Measured at the public door on
 * `f9a8eb889e`:
 *
 *     os package install ./does-not-exist.json
 *     → `✗ Cannot read artifact: ENOENT …`, then `✗ EEXIT: 1`, exit status 1.
 *
 * `os package publish` printed the same pair for an unreadable artifact. For an
 * icon whose type it cannot infer, it printed THREE error lines: the refusal,
 * then `✗ Cannot read --icon-file '…': EEXIT: 1` from the icon step's own
 * `catch`, then `✗ EEXIT: 1` from the outer one. The exit status was right
 * every time; the extra lines were the defect.
 *
 * `this.error(msg)` raises the same signal in another spelling: it throws
 * oclif's `CLIError`, which carries `oclif.exit` (2 unless told otherwise), and
 * leaks the same way. Measured at the public door on `bee8d1c62c`:
 *
 *     os init demo -p npm                 (the registry unreachable)
 *     → `✗ Project scaffolded, but dependency installation failed.`, then
 *       `✗ Dependency installation failed` from the outer `catch`, then
 *       oclif's own `›   Error: Dependency installation failed`, exit status 2.
 *
 * The outer `catch` printed the refusal again and raised a second `this.error`
 * with the same message. A scaffold its own self-test rejects did the same.
 *
 * The repair is the existing idiom, `if (isExitSignal(error)) throw error;` as
 * the catch's first statement (`src/utils/format.ts` — one predicate, no second
 * helper).
 *
 * ## Why an ENUMERATION, and how a new command enters it
 *
 * The idiom already sat in 17 command files; four more (`migrate recorded-by`,
 * `resume`, `account-issuer`, `apply`) lacked it. A pin naming those four goes
 * green while the next command repeats the shape. This pin's first population
 * did exactly that: it held only the JSON-capable commands, and three text-face
 * commands (`package install`, `package publish`, `plugin sign`) carried the
 * shape outside it. So the population is DISCOVERED, not listed, and it asks
 * nothing of a command's flags:
 *
 *   1. the files oclif's command table is built from — `package.json`
 *      `oclif.commands` (strategy `pattern`, `./dist/commands`, `**\/*.js`),
 *      whose `src/` twin is every non-test `.ts` under `src/commands`
 *      (`tsconfig.build.json` maps `src` → `dist` and excludes the tests);
 *   2. each module IMPORTED and its default export taken as the command class,
 *      with the superclasses that live under `src/commands` followed (`os build`
 *      extends `os compile`). It is never a text match over the source;
 *   3. every such command is a member. The signal leaks the same way through
 *      either face: a second document on `--json`, a second `✗` line on the
 *      text face. So membership has no predicate. The face (`--json`,
 *      `--<flag> json`, or `text`) is read off `static flags` only to label each
 *      case.
 *
 * There is no roster to update. A command added later is in the population the
 * moment its module exists under `src/commands`, whatever faces it has. This
 * file goes red if any of its `this.exit(…)` or `this.error(…)` calls sits in
 * a `try` whose `catch` does not let the signal through. `os secret rewrap` is
 * the first to have entered that way: it landed beside this pin with its
 * `--json` flag and its rethrow already in place, and no line here names it.
 *
 * ## The three parts
 *
 * - **Structural, over the WHOLE population** (the second `describe`): every
 *   signal-raising call — `this.exit(…)` or `this.error(…)`, the analyzer's two
 *   seeds (`SIGNAL_SEEDS`), direct or through a same-class method that reaches
 *   one — lexically inside a `try` has, in EVERY enclosing `catch`, the
 *   `isExitSignal` rethrow (imported from `utils/format.js`) as its first
 *   statement. Decided over the command's own source and its superclasses'.
 *   That property is exactly what makes "a completed run prints one document
 *   and exits 0" and "a refusal prints one error line" hold against this
 *   mechanism, for members whose runs need a server, a cloud account or a
 *   database this tier does not boot. The analyzer is pinned against fixtures
 *   first (the first `describe`), so a detector that stops detecting goes red
 *   on the fixture it stopped seeing.
 * - **Driven, JSON face, for the members the census found in-family** (the
 *   third `describe`): `migrate recorded-by`, `migrate resume` and
 *   `migrate account-issuer` run in-process through oclif with the seams that
 *   would boot a database replaced (`bootSchemaStack`, the journal runner, the
 *   sentinel scan, the collision probe). The commands' own parse, `try`/
 *   `catch`, `emitJson` and `this.exit` run for real, and each case asserts the
 *   two things a `--json` consumer reads: stdout is ONE document (a bare
 *   `JSON.parse`), and the exit status. `migrate apply`'s two sites are on its
 *   TEXT face only (its JSON face returns before them), so the structural half
 *   is its pin.
 * - **Driven, text face, for the members the widening found** (the fourth
 *   `describe`): `package install`, `package publish`, `plugin sign` and `init`
 *   run in-process through oclif. The network is replaced by a stubbed `fetch`,
 *   `plugin sign`'s self-verification by a seam (no real key fails it), and
 *   `os init`'s `<pm> install` and scaffold self-test by seams, with its working
 *   directory a scratch directory. Each case asserts the two things an operator
 *   reads: the refusal is ONE `✗` line with no `EEXIT` anywhere in the output,
 *   and the exit status, unchanged by the repair — 1 for the `this.exit(1)`
 *   refusals, 2 for `os init`'s `this.exit(2)` ones (the status its `this.error`
 *   refusals raised, until they rendered their sentence once:
 *   `refusal-renders-once.test.ts` and its `.e2e` twin).
 *
 * ## Tier
 *
 * `unit` (`vitest-tiers.ts`): nothing is spawned and no kernel boots — the
 * boot seam and `os init`'s `execSync` are replaced through `vi.mock`, never
 * value-imported here, and `fetch` is stubbed, never reached. The public-door
 * form of the driven halves (a real sqlite file, the CLI spawned; for the text
 * face, the CLI spawned against a missing file, a stub control plane, or an
 * unreachable package registry) was measured by hand before and after each fix
 * and is recorded on the pull request rather than re-run per CI shard.
 *
 * ## What this does NOT cover
 *
 * - oclif's own rendering of a `this.error` signal: the entry point prints the
 *   `›   Error: …` block after `run()` has thrown, outside an in-process run.
 *   It is one block per refusal before the repair and after it; what the
 *   repair removed is the catch's second `✗` line.
 * - Members of oclif's `Command` other than the two seeds. The one other
 *   member that throws the signal, `this.parse`, is called inside a `try` by
 *   no command, measured on `bee8d1c62c`; a command that does adds a seed.
 * - A second document a command writes by calling `emitJson` twice on one
 *   path — a different mechanism, which only the driven half would see.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Config } from '@oclif/core';
import { isExitSignal } from '../src/utils/format.js';
import MigrateRecordedBy from '../src/commands/migrate/recorded-by.js';
import MigrateResume from '../src/commands/migrate/resume.js';
import MigrateAccountIssuer from '../src/commands/migrate/account-issuer.js';
import PackageInstall from '../src/commands/package/install.js';
import PackagePublish from '../src/commands/package/publish.js';
import PluginSign from '../src/commands/plugin/sign.js';
import Init from '../src/commands/init.js';

// ---------------------------------------------------------------------------
// Seams for the driven halves. Replaced, never value-imported: the commands'
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
  verifyPayload: vi.fn(),
  execSync: vi.fn(),
  validateScaffold: vi.fn(),
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
  // `os plugin sign`'s self-check. No real key makes it fail (measured: Ed25519,
  // Ed448, RSA, RSA-PSS, EC and DSA keys all verify), so the refusal behind it
  // is reachable only through this seam. `signPayload` stays real.
  verifyPayload: seams.verifyPayload,
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
// `os init`'s dependency install (`<pm> install`) and the scaffold self-test
// that follows a successful one. Nothing is spawned and nothing is bundled:
// the command's own `try`/`catch` around them is what runs.
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  execSync: seams.execSync,
}));
vi.mock('../src/utils/scaffold-validate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  validateScaffold: seams.validateScaffold,
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

/**
 * The oclif `Command` members that THROW the signal instead of ending the
 * process — the analyzer's seeds. `this.exit(n)` throws oclif's exit error
 * (`code: 'EEXIT'`, `oclif.exit: n`); `this.error(msg)` throws a `CLIError`
 * carrying `oclif.exit` (2 unless `{ exit }` says otherwise). `isExitSignal`
 * recognises both, so both leak the same way through a `catch` that reports
 * what it caught. `this.error(msg, { exit: false })` throws nothing; no command
 * writes it, and the analyzer judges it like any other `this.error` call — a
 * guard on its catch is harmless, a missing one a false red, never a false green.
 */
const SIGNAL_SEEDS = ['exit', 'error'] as const;

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

  // Fixpoint: a member raises the signal if its body calls a seed — `this.exit`
  // or `this.error` — or a member that does.
  const raising = new Set<string>(SIGNAL_SEEDS);
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

interface Member {
  id: string;
  /**
   * A LABEL, never a filter: how it takes a JSON face (`--json`, or
   * `--<flag> json`), or `text` when it has none.
   */
  faces: string[];
  /** Its own source file, then each superclass's that lives under src/commands. */
  chain: string[];
}

function faceLabels(cls: CommandClass): string[] {
  const flags = cls.flags ?? {};
  const faces: string[] = [];
  if (flags.json?.type === 'boolean') faces.push('--json');
  for (const [name, decl] of Object.entries(flags)) {
    if (Array.isArray(decl?.options) && decl.options.includes('json')) faces.push(`--${name} json`);
  }
  return faces.length > 0 ? faces : ['text'];
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

// Every command is a member — there is deliberately no `continue` here.
const POPULATION: Member[] = [];
for (const [cls, file] of classFile) {
  const faces = faceLabels(cls as CommandClass);
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
 * sites this was widened over, on `f9a8eb889e`. That is 65 commands: 46
 * JSON-capable (32 `--json`, 14 `--format json`, the first population) and 19
 * text-face only. It is 127 sites: 105 in the first population, 21 of them
 * `os build`'s through `compile.ts`, and 22 in the three text-face commands
 * the widening was filed on. A discovery or analyzer that silently stops
 * finding anything returns zero, and zero passes every per-member assertion —
 * these are what notice. A drop below them is a broken detector or a
 * deliberate removal; say which when you lower one.
 *
 * Seeding `this.error` raised the site floor to 131, measured on
 * `bee8d1c62c` over the same 65 commands: the 127 `this.exit` sites, plus
 * four `this.error` sites — `compile.ts`'s bundling refusal, counted for
 * `os compile` and again for `os build` through it, and `os init`'s two
 * refusals inside its outer `try`. Those four sites now spell `this.exit(2)`
 * (the status `this.error` raised, with the sentence rendered once): both
 * spellings are seeds, so the floor is unchanged.
 */
const POPULATION_FLOOR = 65;
const SITE_FLOOR = 131;
/** The first population's floor, kept so a face-label regression is seen too. */
const JSON_FACE_FLOOR = 46;

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
  // The second seed: `this.error` throws a CLIError that leaks the same way.
  {
    name: 'an error inside a try whose catch re-reports it (`os init`, before its repair)',
    src: `class C { async run() { try { this.error('install failed'); } catch (error) { report(error); this.error(error.message); } } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'an error under the idiom',
    src: `${IMPORT_GUARD} class C { async run() { try { this.error('install failed'); } catch (error) { if (isExitSignal(error)) throw error; report(error); } } }`,
    sites: 1, leaks: 0,
  },
  {
    name: 'an error outside every try (the refusal the catch-all itself raises)',
    src: `class C { async run() { try { work(); } catch (e) { report(e); this.error(e.message); } } }`,
    sites: 0, leaks: 0,
  },
  {
    name: 'an error reached through a same-class helper',
    src: `class C { async run() { try { this.fail('no'); } catch (e) { report(e); } } private fail(msg) { this.error(msg); } }`,
    sites: 1, leaks: 1,
  },
  {
    name: 'an error sharing a guarded catch with an exit (`os compile`)',
    src: `${IMPORT_GUARD} class C { async run() { try { try { bundle(); } catch (err) { if (json) this.exit(1); this.error(err.message); } } catch (error) { if (isExitSignal(error)) throw error; report(error); } } }`,
    sites: 2, leaks: 0,
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
// 2. The population — every command, structurally
// ---------------------------------------------------------------------------

describe('every command lets the exit signal through', () => {
  it("discovers from the table oclif builds — package.json's command strategy is the one the walk mirrors", () => {
    expect(PKG.oclif?.commands).toEqual(OCLIF_COMMANDS);
    // Every module under the walk is a command: a file the walk lists but
    // that exports no class would be a hole in the population, not a member.
    expect(COMMAND_FILES.filter((f) => ![...classFile.values()].includes(f)).map((f) => relative(PKG_ROOT, f))).toEqual([]);
  });

  it('the population is not vacuous — the floor holds and the commands this was filed on are in it', () => {
    expect(POPULATION.length, 'fewer commands discovered than this pin was widened over').toBeGreaterThanOrEqual(POPULATION_FLOOR);
    // The population IS the walk: every module the walk lists is a member.
    expect(POPULATION).toHaveLength(COMMAND_FILES.length);
    expect(
      POPULATION.filter((c) => !c.faces.includes('text')).length,
      'fewer JSON-capable commands labelled than the first population held',
    ).toBeGreaterThanOrEqual(JSON_FACE_FLOOR);
    const ids = POPULATION.map((c) => c.id);
    for (const anchor of ['migrate recorded-by', 'migrate resume', 'migrate account-issuer', 'migrate apply', 'build']) {
      expect(ids).toContain(anchor);
    }
    // The text-face commands this was widened on: members with no JSON face.
    for (const anchor of ['package install', 'package publish', 'plugin sign', 'init']) {
      expect(POPULATION.find((c) => c.id === anchor)?.faces).toEqual(['text']);
    }
    // Inheritance is followed: `os build` declares nothing itself.
    expect(POPULATION.find((c) => c.id === 'build')?.chain.map((f) => relative(COMMANDS_DIR, f))).toEqual(['build.ts', 'compile.ts']);
  });

  it('the scan reaches the sites — including the completed-apply exit and the text-face refusals this was filed on', () => {
    const total = [...FLOW.values()].reduce((n, f) => n + f.sites.length, 0);
    expect(total, 'fewer signal-raising calls inside a try found than this pin was widened over').toBeGreaterThanOrEqual(SITE_FLOOR);
    expect(FLOW.get('migrate recorded-by')?.sites.map((s) => s.call)).toContain(
      "this.exit(result.status === 'completed' ? 0 : 1)",
    );
    for (const id of ['package install', 'package publish', 'plugin sign']) {
      expect(FLOW.get(id)?.sites.map((s) => s.call), `os ${id}`).toContain('this.exit(1)');
    }
  });

  it("the scan reaches `os init`'s two refusals inside its outer try, and `os compile`'s bundling refusal — each ends in `this.exit(2)`", () => {
    const refusalCalls = (id: string) => FLOW.get(id)?.sites.map((s) => s.call).filter((call) => call === 'this.exit(2)') ?? [];
    // Scaffold self-test and dependency install: both sit inside the outer `try`
    // whose `catch` must let the signal through, so both are sites.
    expect(refusalCalls('init'), 'os init').toHaveLength(2);
    // Inherited: `os build` is judged on `compile.ts`'s site as well.
    for (const id of ['compile', 'build']) expect(refusalCalls(id), `os ${id}`).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// 4. The text-face members, driven — ONE error line, the exit status unchanged
// ---------------------------------------------------------------------------

// Paid at module scope, like the imports above — never inside a clocked case.
const SCRATCH = mkdtempSync(join(tmpdir(), 'exit-signal-pin-'));
const MISSING_ARTIFACT = join(SCRATCH, 'does-not-exist.json');
const ARTIFACT = join(SCRATCH, 'objectstack.json');
writeFileSync(ARTIFACT, JSON.stringify({ manifest: { id: 'com.acme.pin', name: 'pin', version: '1.0.0' } }));
/** An icon whose type `os package publish` cannot infer: its refusal sits inside the icon step's own `try`. */
const UNTYPED_ICON = join(SCRATCH, 'icon.bmp');
writeFileSync(UNTYPED_ICON, 'not an image');
const OSPLUGIN = join(SCRATCH, 'pin.osplugin');
writeFileSync(OSPLUGIN, 'artifact bytes');
const KEY = join(SCRATCH, 'publisher.key.pem');
writeFileSync(KEY, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
const SIDECAR = join(SCRATCH, 'pin.osplugin.sig');
/** The working directory `os init` resolves its target against: each case scaffolds a fresh child of it. */
const INIT_CWD = join(SCRATCH, 'init');
mkdirSync(INIT_CWD);

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

const RUNTIME = 'http://runtime.exit-signal-pin.test';
const CLOUD = 'http://cloud.exit-signal-pin.test';

/** The colour codes chalk adds, stripped so a line reads as the operator sees it. */
const SGR = /\u001b\[[0-9;]*m/g;

interface DrivenText {
  /** Everything the command printed, on either stream, one entry per line. */
  lines: string[];
  /** The lines that report an error: `printError`'s `✗` glyph. */
  errors: string[];
  /** The status the shell would see, read as `drive` reads it. */
  exit: number;
}

async function driveText(cmd: Runnable, argv: string[], cwd?: string): Promise<DrivenText> {
  const lines: string[] = [];
  const capture = (...args: unknown[]): void => {
    lines.push(...args.map(String).join(' ').replace(SGR, '').split('\n'));
  };
  const captureWrite = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
    capture(String(chunk).replace(/\n$/, ''));
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write;
  const spies: Array<{ mockRestore(): void }> = [
    vi.spyOn(console, 'log').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
    vi.spyOn(process.stdout, 'write').mockImplementation(captureWrite),
    vi.spyOn(process.stderr, 'write').mockImplementation(captureWrite),
  ];
  // A command that resolves its target against the working directory reads
  // the case's scratch directory instead, so nothing lands in this package.
  if (cwd !== undefined) spies.push(vi.spyOn(process, 'cwd').mockReturnValue(cwd));
  process.exitCode = undefined;
  let exit: number;
  try {
    await cmd.run(argv, config);
    exit = typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (!isExitSignal(error)) throw error;
    exit = (error as { oclif: { exit: number } }).oclif.exit;
  } finally {
    for (const spy of spies) spy.mockRestore();
    process.exitCode = OUTER_EXIT_CODE;
  }
  return { lines, errors: lines.filter((line) => /^\s*✗ /.test(line)), exit };
}

/**
 * The refusal is reported ONCE, the signal is never named, and the status is
 * the one it always was: 1 for a `this.exit(1)` refusal, 2 for `os init`'s
 * `this.exit(2)` ones (what its `this.error` refusals raised). `subject` is what
 * the one line must be about — a path, a URL or an error the case chose, never
 * the refusal's wording.
 */
function expectOneRefusal(run: DrivenText, subject?: string, exit = 1): void {
  const output = run.lines.join('\n');
  expect(run.errors, `expected ONE error line; the command printed:\n${output}`).toHaveLength(1);
  if (subject !== undefined) expect(run.errors[0]).toContain(subject);
  expect(output).not.toContain('EEXIT');
  expect(run.exit).toBe(exit);
}

const fetchStub = vi.fn<typeof fetch>();

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('the text-face members, driven — ONE error line, the exit status unchanged', () => {
  beforeEach(() => {
    fetchStub.mockReset();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('os package install, an unreadable artifact (refused inside a nested catch): ONE error line, exit 1', async () => {
    const run = await driveText(PackageInstall, [MISSING_ARTIFACT]);
    expectOneRefusal(run, MISSING_ARTIFACT);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('os package install, a runtime with no install-local endpoint (refused in the try itself): ONE error line, exit 1', async () => {
    fetchStub.mockImplementation(async () => answer(404, { error: { message: 'not found' } }));
    const run = await driveText(PackageInstall, [ARTIFACT, '--runtime', RUNTIME]);
    expectOneRefusal(run, RUNTIME);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('os package publish, an unreadable artifact: ONE error line, exit 1', async () => {
    const run = await driveText(PackagePublish, [MISSING_ARTIFACT, '--token', 'pin-token', '--server', CLOUD]);
    expectOneRefusal(run, MISSING_ARTIFACT);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("os package publish, an icon whose type it cannot infer (refused inside the icon step's own try): ONE error line, exit 1", async () => {
    fetchStub.mockImplementation(async () => answer(200, { data: { id: 'pkg_pin', created: true } }));
    const run = await driveText(PackagePublish, [ARTIFACT, '--token', 'pin-token', '--server', CLOUD, '--icon-file', UNTYPED_ICON]);
    expectOneRefusal(run, UNTYPED_ICON);
    // The package was registered, and the refusal came before any icon upload.
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('os plugin sign, a signature that fails its self-verification: ONE error line, exit 1, no sidecar', async () => {
    seams.verifyPayload.mockReturnValue(false);
    const run = await driveText(PluginSign, [OSPLUGIN, '--key', KEY, '--out', SIDECAR]);
    expectOneRefusal(run);
    expect(seams.verifyPayload).toHaveBeenCalledTimes(1);
    expect(existsSync(SIDECAR)).toBe(false);
  });

  it('os init, a dependency install that fails (refused inside its outer try): ONE error line, exit 2', async () => {
    seams.execSync.mockImplementation(() => {
      throw new Error('exit-signal pin: npm install exited 1');
    });
    const run = await driveText(Init, ['install-refused', '-p', 'npm'], INIT_CWD);
    expectOneRefusal(run, undefined, 2);
    expect(seams.execSync).toHaveBeenCalledTimes(1);
    expect(seams.execSync.mock.calls[0]?.[1]).toMatchObject({ cwd: join(INIT_CWD, 'install-refused') });
    // A failed install never reaches the self-test.
    expect(seams.validateScaffold).not.toHaveBeenCalled();
  });

  it('os init, a scaffold its own self-test rejects (refused inside its outer try): ONE error line, exit 2', async () => {
    const rejection = 'exit-signal pin: the rendered config did not load';
    seams.validateScaffold.mockRejectedValue(new Error(rejection));
    const run = await driveText(Init, ['scaffold-refused', '-p', 'npm'], INIT_CWD);
    expectOneRefusal(run, rejection, 2);
    // The install "succeeded" (the seam returned), so the self-test ran.
    expect(seams.execSync).toHaveBeenCalledTimes(1);
    expect(seams.validateScaffold).toHaveBeenCalledWith(join(INIT_CWD, 'scaffold-refused'));
  });
});
