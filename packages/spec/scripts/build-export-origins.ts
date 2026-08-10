// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-export-origins.ts — resolve, ONCE at build time, which source
 * declaration every public entry point of @objectstack/spec exports under
 * every name.
 *
 * ## Why this artifact exists
 *
 * The dual-source and retirement lanes leave a *pin test* behind for each
 * cleared name (`#4658` `EventSchema`, `#4739` `TenantPlan`, `#4740`
 * `EnvironmentArtifact`, …). Each of those pins asked the same question — "which
 * declaration does entry X export under name Y?" — and each answered it by
 * building its OWN `ts.createProgram` over every entry point and running
 * `getTypeChecker()` inside a vitest `it()`.
 *
 * That is one full TypeScript compilation per pin. Measured on #4796: 17 such
 * cases, ~3.4s each, ~55s of pure compilation per CI lap — 88% of those files'
 * total test time — and it grew by one compilation per retirement PR. It was
 * also NON-DETERMINISTIC in the only way that matters: at ~3.4s against vitest's
 * 5s default the cases sat on the timeout line, and a loaded merge-queue runner
 * pushed them over it six times in one night, each time ejecting an unrelated
 * PR from the queue (#4796). Two stop-the-bleed laps raised the timeout
 * (PR #4856, then PR #4864's `testTimeout: 30_000`); neither saved a millisecond
 * of compilation, because the compilation was never the bug's *cause* — it was
 * the bug's *material*.
 *
 * So the resolution moves here, to build time, and the pins become comparisons.
 * The facts are identical — the same program, the same compiler options, the
 * same `getExportsOfModule` / alias-unwinding walk the pins ran — computed once
 * and checked in. `export-origins/<entry>.json` is what the pins read.
 *
 * ## What an "origin" is, and why it carries no line number
 *
 * `<src path>#<declared name> (<kind>)` — the file that DECLARES the symbol an
 * export resolves to after its alias chain is unwound, the identifier it is
 * declared under there, and its symbol kind.
 *
 * Two exports have the same origin string iff they are the same declaration, so
 * a plain string comparison answers the question `api-surface/` cannot (#4446):
 * a name on two entries is a harmless RE-EXPORT when the origins match and the
 * #4411 DUAL-SOURCE trap when they differ. Within one source file one
 * identifier binds one symbol per declaration space, and `kind` separates the
 * value/type spaces — so the triple is an identity, not an approximation.
 *
 * The pins used `<path>:<line>` and asserted the line as `\d+`, i.e. never. A
 * line number here would be strictly worse than useless: it would rewrite this
 * artifact on every edit that shifts a line in any `.zod.ts`, turning a
 * comparison baseline into the repo's next merge-conflict magnet. The pins'
 * real claim — WHICH FILE declares it — survives verbatim, and tighter (the
 * successor asserts the path exactly rather than by regex).
 *
 * ## Sharded, for the same reason `api-surface/` is (#5837)
 *
 * One file per entry point. Retirement PRs land continuously and each rewrites
 * the entries it touched; a single file would be a textual conflict in the
 * merge queue, where no custom merge driver runs. Two PRs retiring names on
 * different entries now touch disjoint files.
 *
 * ## Freshness
 *
 * `--check` recomputes from source and compares bytes. It runs inside
 * `check:generated`, hence inside lint.yml's required `TypeScript Type Check`
 * job — a stale or hand-edited artifact is CI-red, not silent drift. The pins
 * carry a second, independent guard that needs no compiler: the testkit
 * cross-checks every value-kind origin against the entry's real runtime
 * namespace, so `pnpm test` alone is not blind to a doctored artifact either.
 *
 * ## Usage
 *
 *     pnpm --filter @objectstack/spec gen:export-origins     # regenerate + write
 *     pnpm --filter @objectstack/spec check:export-origins   # CI: fail on drift
 *     tsx scripts/build-export-origins.ts --self-test        # fixture check only
 *
 * Reads `src/`, NOT the built dist — deliberately. The pins it replaces ran over
 * `src/` so they were part of `pnpm test` without a build, and `check:api-surface`
 * already covers the dist side. Nothing here needs `pnpm build` to have run.
 */
import ts from 'typescript';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_ORIGINS_DIR_NAME,
  exportOriginsShardTexts,
  readExportOriginShards,
} from './lib/export-origins-layout';
import { writeShards } from './lib/sharded-artifacts';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ORIGINS_DIR = resolve(PKG_DIR, EXPORT_ORIGINS_DIR_NAME);
const CHECK = process.argv.includes('--check');
const SELF_TEST = process.argv.includes('--self-test');

/**
 * Public entry points → their SOURCE index, read from the exports map.
 *
 * Byte-identical to the enumeration the pins ran: `.` is `src/index.ts` and
 * `./<name>` is `src/<name>/index.ts`, while `./openapi.json` and
 * `./package.json` are not TypeScript entry points. Reading the map rather than
 * a hardcoded list is what stops a future entry point escaping the artifact —
 * the pins made that same choice, in each of their seventeen copies.
 */
export function collectSourceEntries(pkgDir: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  const entries: Record<string, string> = {};
  for (const sub of Object.keys(pkg.exports ?? {})) {
    if (sub === '.') entries[sub] = resolve(pkgDir, 'src/index.ts');
    else if (/^\.\/[a-z-]+$/.test(sub)) entries[sub] = resolve(pkgDir, `src/${sub.slice(2)}/index.ts`);
  }
  return entries;
}

function kindOf(flags: ts.SymbolFlags): string {
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Enum) return 'enum';
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type';
  if (flags & ts.SymbolFlags.Variable) return 'const';
  if (flags & ts.SymbolFlags.Namespace) return 'namespace';
  return 'other';
}

/**
 * The compiler options the seventeen pins used, verbatim.
 *
 * Not a detail: `moduleResolution: Bundler` is what lets extensionless relative
 * imports across `src/` resolve at all. Under `NodeNext` they would not, every
 * symbol would degrade to `any`, and this generator would confidently write an
 * artifact describing nothing (AGENTS.md records that trap in the type-check
 * ledger). The count assertions below are what turn that into a failure.
 */
const PROGRAM_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
};

/**
 * The declaring file, package-relative, with any dependency's install layout
 * normalised away.
 *
 * `./contracts` re-exports ten types straight from `ai` / `@ai-sdk/provider-utils`,
 * and their real declaration paths run through the pnpm store:
 *
 *     ../../node_modules/.pnpm/@ai-sdk+provider-utils@5.0.16_zod@4.4.3/node_modules/@ai-sdk/…
 *
 * That string carries a VERSION and a peer-resolution hash, so recording it
 * verbatim would rewrite this artifact on every dependency bump — the same
 * churn the omitted line numbers would have caused, arriving from the other
 * side. Everything up to and including the last `node_modules/` segment is
 * therefore dropped, leaving `node_modules/<package>/<path>`: still an identity
 * (one package, one file, one declared name), and stable across bumps and
 * across pnpm/npm layouts alike.
 */
function declaringFile(rootDir: string, fileName: string): string {
  const posix = fileName.split('\\').join('/');
  const marker = posix.lastIndexOf('/node_modules/');
  if (marker >= 0) return `node_modules/${posix.slice(marker + '/node_modules/'.length)}`;
  return relative(rootDir, posix).split('\\').join('/');
}

/** `<file>#<declared name> (<kind>)`, or `null` when the symbol has no declaration. */
function originOf(checker: ts.TypeChecker, rootDir: string, exported: ts.Symbol): string | null {
  const original =
    exported.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const decl = original.declarations?.[0];
  if (!decl) return null;
  const file = declaringFile(rootDir, decl.getSourceFile().fileName);
  return `${file}#${original.getName()} (${kindOf(original.getFlags())})`;
}

export interface ResolvedOrigins {
  /** entry → (export name → origin string), both sorted. */
  byEntry: Record<string, Record<string, string>>;
  /** Exports whose symbol carried no declaration at all — always a resolution failure. */
  undeclared: string[];
}

/**
 * Resolve every export of every entry to its declaring source symbol.
 *
 * Throws rather than returning a partial map when a module symbol does not
 * resolve. The pins guarded this with an explicit `expect(moduleSym).toBeTruthy()`
 * and said why: without it every downstream `not.toContain` passes vacuously,
 * which is precisely how a gate goes dormant while reporting success (#4642).
 * A generator has the same failure mode and a worse blast radius — it would
 * write the empty answer down and hand it to seventeen pins.
 */
export function resolveOrigins(
  program: ts.Program,
  entries: Record<string, string>,
  rootDir: string,
): ResolvedOrigins {
  const checker = program.getTypeChecker();
  const byEntry: Record<string, Record<string, string>> = {};
  const undeclared: string[] = [];

  for (const entry of Object.keys(entries).sort()) {
    const file = entries[entry];
    const sourceFile = program.getSourceFile(file);
    const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      throw new Error(
        `could not resolve the module symbol for ${entry} (${relative(rootDir, file)}). Every ` +
          `assertion built on this artifact would pass vacuously, so this is fatal rather than ` +
          `an empty entry (#4642).`,
      );
    }
    const exports: Record<string, string> = {};
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const name = exported.getName();
      const origin = originOf(checker, rootDir, exported);
      if (origin === null) {
        undeclared.push(`${entry} → ${name}`);
        continue;
      }
      exports[name] = origin;
    }
    byEntry[entry] = Object.fromEntries(Object.keys(exports).sort().map((n) => [n, exports[n]]));
  }

  return { byEntry, undeclared };
}

function makeProgram(files: string[]): ts.Program {
  return ts.createProgram(files, PROGRAM_OPTIONS);
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Pin the resolver's two edges on a fixture, the way `check:dual-source-exports`
 * pins its own detector.
 *
 * The artifact's whole value is that origin equality means declaration identity.
 * If alias unwinding broke, every re-export would read as its own origin and
 * every single-source pin would go red for nothing; if it over-unwound, two
 * genuinely different declarations would read as one and every dual-source pin
 * would go DORMANT — green forever, indistinguishable from clean. Neither edge
 * is observable from the real surface, where both answers look plausible.
 */
function selfTest(): never {
  const fail = (message: string): never => {
    console.error(`✗ self-test: ${message}`);
    process.exit(1);
  };

  const dir = mkdtempSync(join(tmpdir(), 'spec-export-origins-'));
  try {
    writeFileSync(
      join(dir, 'shared.ts'),
      ['export type SharedType = { a: string };', 'export const sharedConst = 1;'].join('\n'),
      'utf8',
    );
    // Entry A re-exports both shared declarations and adds its own `Dup`.
    writeFileSync(
      join(dir, 'a.ts'),
      [
        `export { SharedType, sharedConst } from './shared';`,
        'export type Dup = { fromA: true };',
        'export type OnlyA = { onlyA: true };',
      ].join('\n'),
      'utf8',
    );
    // Entry B re-exports the same two and declares its OWN `Dup` — same name,
    // different declaration: the #4411 trap in miniature.
    writeFileSync(
      join(dir, 'b.ts'),
      [
        `export type { SharedType } from './shared';`,
        `export { sharedConst } from './shared';`,
        'export type Dup = { fromB: true };',
      ].join('\n'),
      'utf8',
    );
    // Entry C re-exports A's `Dup` under an ALIAS — the origin must name A's
    // declaration under its DECLARED name, not the alias, or a renamed
    // re-export would read as a second declaration.
    writeFileSync(join(dir, 'c.ts'), [`export type { Dup as RenamedDup } from './a';`].join('\n'), 'utf8');

    const entries = { './a': join(dir, 'a.ts'), './b': join(dir, 'b.ts'), './c': join(dir, 'c.ts') };
    const program = makeProgram(Object.values(entries));
    const syntactic = program.getSyntacticDiagnostics();
    if (syntactic.length > 0) {
      fail(`fixture does not parse: ${ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ')}`);
    }

    const { byEntry, undeclared } = resolveOrigins(program, entries, dir);
    if (undeclared.length > 0) fail(`fixture produced undeclared exports: ${undeclared.join(', ')}`);

    const a = byEntry['./a'];
    const b = byEntry['./b'];
    const c = byEntry['./c'];

    // Anti-vacuity: the fixture's modules resolved. Fewer names means the
    // assertions below would all hold over an empty map.
    if (Object.keys(a).length !== 4) fail(`./a resolved ${Object.keys(a).length} exports, expected 4`);
    if (Object.keys(b).length !== 3) fail(`./b resolved ${Object.keys(b).length} exports, expected 3`);

    // Edge 1 — a re-export must read as ONE declaration from both entries.
    for (const name of ['SharedType', 'sharedConst']) {
      if (a[name] !== b[name]) {
        fail(`\`${name}\` is one declaration re-exported twice, but reads as ${a[name]} ≠ ${b[name]} — ` +
          `alias unwinding is broken and every single-source pin would go red for nothing`);
      }
      if (!a[name].startsWith('shared.ts#')) fail(`\`${name}\` must originate in shared.ts, got ${a[name]}`);
    }

    // Edge 2 — two declarations sharing a name must NOT read as one.
    if (a.Dup === b.Dup) {
      fail('`Dup` is declared separately in a.ts and b.ts but reads as one origin — the dual-source ' +
        'pins built on this artifact would be DORMANT');
    }

    // Edge 3 — an aliased re-export resolves to the declaration's own name, so
    // renaming at the re-export site does not manufacture a second origin.
    if (c.RenamedDup !== a.Dup) {
      fail(`\`RenamedDup\` re-exports a.ts's \`Dup\` but reads as ${c.RenamedDup} ≠ ${a.Dup}`);
    }

    // Edge 4 — the value/type spaces are distinguishable, so a const and a type
    // of the same name in the same file are not conflated.
    if (!a.sharedConst.endsWith('(const)')) fail(`\`sharedConst\` must read as a const, got ${a.sharedConst}`);
    if (!a.OnlyA.endsWith('(type)')) fail(`\`OnlyA\` must read as a type, got ${a.OnlyA}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('✅  self-test: re-exports share one origin, distinct declarations do not, aliases resolve to the declaration.');
  process.exit(0);
}

if (SELF_TEST) selfTest();

// ── Generate / check ─────────────────────────────────────────────────────────

const entries = collectSourceEntries(PKG_DIR);

// The pins each asserted this floor themselves (`> 10` entry points) because an
// enumeration that silently found nothing makes every `not.toContain` below it
// true. The floor moves here, once, for all of them.
if (Object.keys(entries).length <= 10) {
  console.error(
    `❌  enumerated only ${Object.keys(entries).length} TypeScript entry point(s) from package.json's ` +
      `exports map. @objectstack/spec publishes far more; something is wrong with the map or with ` +
      `this reader, and writing the artifact anyway would hand every pin an empty surface.`,
  );
  process.exit(1);
}

const { byEntry, undeclared } = resolveOrigins(makeProgram(Object.values(entries)), entries, PKG_DIR);

if (undeclared.length > 0) {
  console.error(
    `❌  ${undeclared.length} export(s) resolved to a symbol with no declaration — the compiler could ` +
      `not follow them to a source file:\n`,
  );
  for (const line of undeclared) console.error(`    • ${line}`);
  process.exit(1);
}

const totalExports = Object.values(byEntry).reduce((sum, names) => sum + Object.keys(names).length, 0);
const shardTexts = exportOriginsShardTexts(byEntry);

if (!CHECK) {
  const { written, removed } = writeShards(ORIGINS_DIR, shardTexts);
  console.log(
    `✅  ${EXPORT_ORIGINS_DIR_NAME}/: ${totalExports} exports across ${Object.keys(byEntry).length} entry ` +
      `points — ${written.length} shard(s) rewritten${removed.length ? `, ${removed.length} removed` : ''}.`,
  );
  process.exit(0);
}

const onDisk = readExportOriginShards(ORIGINS_DIR);
const problems: string[] = [];

for (const [name, text] of [...shardTexts].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const found = onDisk.get(name);
  if (found === undefined) {
    problems.push(`missing shard ${EXPORT_ORIGINS_DIR_NAME}/${name}.json`);
  } else if (found.raw !== text) {
    problems.push(`${EXPORT_ORIGINS_DIR_NAME}/${name}.json is stale — the source resolves differently`);
  }
}
for (const name of onDisk.keys()) {
  if (!shardTexts.has(name)) {
    problems.push(`${EXPORT_ORIGINS_DIR_NAME}/${name}.json is for an entry point that no longer exists`);
  }
}

if (problems.length === 0) {
  console.log(
    `✅  ${EXPORT_ORIGINS_DIR_NAME}/ is current: ${totalExports} exports across ` +
      `${Object.keys(byEntry).length} entry points resolve exactly as recorded.`,
  );
  process.exit(0);
}

console.error(`❌  ${problems.length} problem(s) with ${EXPORT_ORIGINS_DIR_NAME}/:\n`);
for (const problem of problems) console.error(`    • ${problem}`);
console.error(
  `\nThis artifact records WHICH SOURCE DECLARATION each public entry point exports under each name.\n` +
    `The export-surface pin tests read it instead of building their own TypeScript program, so it\n` +
    `being current is what makes them mean anything (#4796).\n\n` +
    `If you changed the export surface on purpose — added, removed, renamed or re-homed an export —\n` +
    `regenerate and commit the diff:\n\n` +
    `    pnpm --filter @objectstack/spec gen:export-origins\n\n` +
    `Then READ the diff. A name whose origin moved to a different file is a re-homed declaration; a\n` +
    `name that gained an entry with a DIFFERENT origin is a new dual-source, the #4411 trap, and the\n` +
    `fix is at the declaration rather than here (see check:dual-source-exports).`,
);
process.exit(1);
