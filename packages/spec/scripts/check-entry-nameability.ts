#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-entry-nameability (#11986) — the entry-nameability invariant, held
 * closed for EVERY public entry instead of repaired one name at a time.
 *
 *   pnpm --filter @objectstack/spec check:entry-nameability   # self-test + audit
 *   tsx scripts/check-entry-nameability.ts --self-test        # fixture check only
 *   tsx scripts/check-entry-nameability.ts --list             # what it probes, per entry
 *
 * ## The invariant
 *
 * Maintainer ruling 2026-08-23, recorded on #11350:
 *
 *   > a type that appears structurally in an entry's public declarations must
 *   > be nameable from that same entry.
 *
 * Chartered by the 2026-08-25 ruling on #11709 (verbatim, untranslated:
 * 「11709 11742 同意」), which accepted a two-part recommendation: A′ — re-export
 * the two names that instance leaked — and C, this gate.
 *
 * ## The defect class, and why per-name repair kept failing
 *
 * `defineStack` returns `ObjectStackDefinition`, declared
 * `z.input<typeof ObjectStackDefinitionSchema>`. That is a generic
 * INSTANTIATION, and the declaration emitter does not preserve it as an alias:
 * an un-annotated `export default defineStack(...)` in a consumer is emitted as
 * the type's STRUCTURAL EXPANSION. Every name that expansion mentions has to be
 * nameable from the entry the consumer imported, or tsc emits TS2883 ("likely
 * not portable") pointing at a hash-named internal dist chunk no `exports` entry
 * addresses.
 *
 * Three rounds of this reached the maintainer's decision inbox — #10868 (nine
 * build-time configs, before the first was diagnosed), #11350 (three names),
 * #11709 (two more, found only because the minimal one-file program dropped a
 * fixture file that had been masking them). Each round repaired the names it
 * had measured and left the property untested, so the next round was a matter of
 * which consumer shape someone wrote next. #11986 exists to stop a fourth.
 *
 * `root-entry-type-nameability.pin.test.ts` pins ONE consumer program against
 * ONE entry, deliberately (its charter is the real configs' program shape). This
 * gate generalizes the probe: every public entry, every callable export.
 *
 * ## The instrument: one program PER ENTRY, and that is load-bearing
 *
 * For each entry the gate compiles a one-file program with `declaration: true`,
 * resolved the way a real consumer resolves it — a `node_modules/@objectstack/spec`
 * symlink, so tsc walks the package's own `exports` map — and asserts the
 * declaration emitter reports nothing it cannot name.
 *
 * ⛔ The entries are NOT batched into one program, and batching is not an
 * optimisation left on the table — it is the one change that would silently
 * empty this gate. #11350's control measured it and the pin's docblock records
 * it: a program file that imports a subpath entry makes that entry's names
 * nameable PROGRAM-WIDE. So a single program importing all 17 entries can name
 * every type any of them declares, and reports zero leaks no matter how many
 * there are — the #4690 shape, at full cost. Measured on this tree, both
 * directions, in the `--self-test`. One program per entry is the measurement;
 * the per-entry cost is what buys it.
 *
 * ## What is probed: the CALL surface, and why not every export
 *
 * Two probe shapes were measured against this tree before one was chosen.
 *
 *   - **reference** — `export const r = E.<name>;` for every value export. It
 *     re-prints each export's declared type. Measured on `cdbd9204`: 27
 *     (entry, name) pairs across 11 of 17 entries — and, decisively, it is
 *     BLIND to the defect this gate is chartered for. With A′ reverted and the
 *     dist rebuilt, the root entry's reference-probe leak set does not move:
 *     `defineStack`'s declared return type is `ObjectStackDefinition`, which IS
 *     nameable from the root entry, so the printer names it instead of
 *     expanding it. The expansion — and the leak — exists only at a CALL.
 *   - **call** — `export const c = E.<fn>(null as never, …);` for every export
 *     whose type has a call signature, with as many `never` arguments as the
 *     signature has required parameters. `never` is assignable to every
 *     parameter type, so this needs no per-factory fixture, and the emitted
 *     declaration is byte-identical to the pin's real
 *     `defineStack({ objects: [] })` call. This is the shape that moves under
 *     the A′ ablation, and it is the shape all three decided instances took.
 *
 * The call shape is what this gate enforces. The reference shape's 27 pairs are
 * a real but SEPARATE finding — no consumer has reported one, closing them is a
 * scope decision rather than this card's — so they are filed rather than
 * absorbed here (see the PR body for the per-entry table). ⚠️ Do not "extend"
 * this gate to the reference shape by adding those 27 to the ledger below: a
 * shrink-only ledger with no shrink path is a permitted accommodation surface,
 * and the ledger's whole warrant is that every row it carries is repaired by one
 * re-export line.
 *
 * ## The ledger, and why this gate did not ship at zero
 *
 * The card was written expecting the gate to be green on `main` the moment A′
 * landed. Measured, it is not: the call-shape probe finds SEVEN leaks across
 * four entries on `cdbd9204` — `Book` / `FormField` / `NavigationItem` at the
 * root, `UnknownAuthoringKeyFinding` on `/kernel`, `FilterCondition` +
 * `StateNodeConfig` on `/ai`, `FilterCondition` on `/ui`. That is not a
 * different defect class; it is the SAME one, and it is the card's own thesis
 * arriving early: A′ repaired the `defineStack` instance, and six siblings of it
 * were live the whole time with nothing measuring them.
 *
 * So the seven are recorded in `entry-nameability.baseline.json` — named, with
 * the repair for each, shrink-only in both directions — and every eighth is a
 * failure. Repairing them here would edit four entry barrels and regenerate
 * `api-surface/`, a different file surface and a different gate family from this
 * card's; they are filed for triage instead. The ledger is the ratchet, not the
 * destination: it exists to hold the line at seven while they are closed one
 * re-export at a time.
 *
 * Enumeration is TYPE-LEVEL, via the checker, not `typeof x === 'function'` on
 * the built module. Zod v4 schema objects ARE runtime functions — measured, 375
 * of `/api`'s 389 runtime functions are zod schemas with no call signature — so
 * a runtime predicate generates 375 bogus `TS2349: This expression is not
 * callable` diagnostics per entry and the checker never reaches declaration
 * emit for the real probes. The checker's own answer has neither problem.
 *
 * ## How a diagnostic is read — three buckets, no fourth
 *
 *   - **cannot-be-named** (TS2883 and the TS40xx "has or is using name … but
 *     cannot be named" family): the finding. Matched on the message substance
 *     rather than a fixed code list, the same way the pin's canary pins
 *     `TS4\d{2,3}: .*private` — a compiler renumbering must not empty this.
 *   - **TS7056**, "the inferred type of this node exceeds the maximum length the
 *     compiler will serialize": NOT MEASURED for that probe, and reported as
 *     such. The printer gives up before it reaches the name-resolution step, so
 *     neither "clean" nor "leaking" is a supportable reading. Counting them into
 *     the green total is exactly #4690.
 *   - **anything else**: a REFUSAL naming the diagnostic. A probe program that
 *     fails to compile for an unrelated reason has measured nothing, and a gate
 *     that shrugs one off is green for a reason unrelated to its subject.
 *
 * ## Anti-phantom, two independent controls
 *
 * TS2883 is a DECLARATION-EMIT diagnostic. Drop `declaration: true` from the
 * profile and every probe goes green forever — a gate only ever observed green
 * is indistinguishable from one that matches nothing.
 *
 *   1. the **canary**, borrowed from the pin: a hermetic fixture whose only
 *      error is also declaration-emit-only (TS4094, a private member on an
 *      exported anonymous class type — exit non-zero with `declaration: true`,
 *      exit 0 without). It must be RED in every run, under the same profile the
 *      probes use.
 *   2. the **self-test**, which drives the whole pipeline over a synthetic
 *      package in both directions: an entry that leaks an internal type must be
 *      reported, the same entry with that type re-exported must not, and the
 *      batched-program control above must report nothing while the per-entry
 *      run reports the leak.
 *
 * ## Dist freshness is a REFUSAL, not a skip
 *
 * The subject is `dist/**\/*.d.ts` — the surface a consumer's import resolves to
 * — so this joins `check:api-surface` / `check:exported-any` /
 * `check:dual-source-exports` in the `typecheck-consumers` lane and refuses on an
 * unbuilt or stale tree (#7122/#7181). It is a `check:` script and not a vitest
 * pin precisely so it can refuse: the pin has to declare a named skip because
 * Test Core runs spec's suite with spec's own dist deliberately unbuilt.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { inspectDistFreshness } from './lib/dist-freshness';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const RERUN = 'pnpm --filter @objectstack/spec check:entry-nameability';
const LEDGER_PATH = path.join(PKG_DIR, 'entry-nameability.baseline.json');

/** The hand-ratcheted accommodation ledger — see "The ledger" in the docblock. */
interface Ledger {
  entries: Record<string, { leaks: string[]; why: string }>;
}

function readLedger(): Map<string, Set<string>> {
  const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
  const map = new Map<string, Set<string>>();
  for (const [specifier, record] of Object.entries(raw.entries)) {
    if (!Array.isArray(record.leaks) || typeof record.why !== 'string' || record.why.trim() === '') {
      throw new Error(
        `${path.basename(LEDGER_PATH)}: entry "${specifier}" needs a non-empty \`why\`. A row that ` +
          `records only a name is a row the next reader cannot act on or retire.`,
      );
    }
    map.set(specifier, new Set(record.leaks));
  }
  return map;
}

/** The compiler profile every program in this file is judged under. */
const PROFILE = {
  target: 'ES2022',
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  strict: true,
  // Load-bearing: the whole diagnostic family this gate reads exists only on
  // the declaration-emit axis. `noEmit` keeps the sandbox clean; tsc still runs
  // the declaration emitter's checks while `declaration` is on.
  declaration: true,
  noEmit: true,
  skipLibCheck: true,
  types: [] as string[],
} as const;

/** A probe program: its files, and the tsconfig that compiles them. */
interface ProbeResult {
  /** Names the declaration emitter could not name, deduplicated and sorted. */
  leaks: string[];
  /** Probe lines the compiler refused to serialize at all (TS7056). */
  unserializable: number;
  /** Diagnostics outside the two families above — always a refusal. */
  foreign: string[];
  /** Raw tsc output, for the refusal text. */
  output: string;
  exitCode: number;
}

/**
 * The `cannot be named` family, matched on substance.
 *
 * TS2883 phrases it "cannot be named without a reference to 'X'"; the TS40xx
 * family phrases it "has or is using name 'X' from external module … but cannot
 * be named". Both name the offending type in the FIRST quoted span after the
 * phrase, which is what the two patterns capture.
 */
const NAMEABILITY_PATTERNS = [
  /cannot be named without a reference to '([^']+)'/,
  /has or is using name '([^']+)'[^\n]*but cannot be named/,
];

function classify(output: string, lines: string[]): Omit<ProbeResult, 'output' | 'exitCode'> {
  const leaks = new Set<string>();
  let unserializable = 0;
  const foreign: string[] = [];

  for (const line of output.split('\n')) {
    const diag = /^(?<file>[^(]+)\((?<line>\d+),\d+\): error (?<code>TS\d+): (?<rest>.*)$/.exec(line);
    if (!diag?.groups) continue;
    const { code, rest } = diag.groups as { code: string; rest: string };

    const named = NAMEABILITY_PATTERNS.map((p) => p.exec(rest)).find(Boolean);
    if (named) {
      leaks.add(named[1]!);
      continue;
    }
    if (code === 'TS7056') {
      unserializable += 1;
      continue;
    }
    const source = lines[Number(diag.groups.line) - 1] ?? '(unknown probe line)';
    foreign.push(`${code}: ${rest}\n      probe line: ${source.trim()}`);
  }

  return { leaks: [...leaks].sort(), unserializable, foreign };
}

/** Compile one program in `dir` and read its declaration-emit diagnostics. */
function compile(dir: string, files: Record<string, string>): ProbeResult {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), source);
  }
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: PROFILE, include: Object.keys(files) }, null, 2),
  );

  const tscBin = path.resolve(PKG_DIR, '../../node_modules/typescript/bin/tsc');
  const res = spawnSync(process.execPath, [tscBin, '--pretty', 'false', '-p', path.join(dir, 'tsconfig.json')], {
    cwd: dir,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  // Only the FIRST file's lines are used for attribution; every generated probe
  // program in this file puts its probes there.
  const lines = (Object.values(files)[0] ?? '').split('\n');
  return { ...classify(output, lines), output, exitCode: res.status ?? 1 };
}

/**
 * Every module entry in the `exports` map, as the specifier a consumer writes.
 *
 * String-valued entries (`./openapi.json`, `./package.json`) are not module
 * entries and carry no declarations; everything else must be probed, and an
 * entry whose resolved `.d.ts` is missing is a HARD ERROR rather than a skip —
 * a build-dependent gate that silently reads nothing reports "not measured" as
 * if it were "measured and clean" (#4690).
 */
function moduleEntries(pkgDir: string): { subpath: string; specifier: string; types: string }[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
    name: string;
    exports: Record<string, unknown>;
  };
  const out: { subpath: string; specifier: string; types: string }[] = [];
  for (const [subpath, value] of Object.entries(manifest.exports)) {
    if (typeof value !== 'object' || value === null) continue;
    const requireTypes = (value as { require?: { types?: string } }).require?.types;
    if (typeof requireTypes !== 'string') {
      throw new Error(
        `exports["${subpath}"] declares no \`require.types\` — this gate resolves the entry a ` +
          `consumer's import lands on, and cannot judge a subpath with no declarations.`,
      );
    }
    const resolved = path.resolve(pkgDir, requireTypes);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `exports["${subpath}"].require.types → ${requireTypes} does not exist. Build first:\n` +
          `  pnpm --filter ${manifest.name} build`,
      );
    }
    out.push({
      subpath,
      specifier: subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
      types: resolved,
    });
  }
  return out;
}

/**
 * The callable exports of one entry, with each one's REQUIRED arity, read from
 * the checker rather than from the built module (see the docblock: zod v4
 * schemas are runtime functions with no call signature, and a runtime predicate
 * generates hundreds of bogus TS2349s that stop the checker before it emits).
 *
 * Required arity is counted from the signature's own parameter declarations —
 * a parameter is optional when it carries `?`, an initializer, or `...`. Passing
 * exactly the required count keeps every call arity-valid without a per-function
 * fixture.
 */
function callableExports(specifier: string, sandbox: string): { name: string; arity: number }[] {
  const probeFile = path.join(sandbox, '__enumerate.ts');
  fs.writeFileSync(probeFile, `import * as E from '${specifier}';\nexport type __E = typeof E;\n`);

  const program = ts.createProgram([probeFile], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(probeFile);
  if (!source) throw new Error(`could not create the enumeration program for ${specifier}`);

  const decl = source.statements.find(ts.isImportDeclaration);
  const clause = decl?.importClause?.namedBindings;
  if (!clause || !ts.isNamespaceImport(clause)) {
    throw new Error(`could not find the namespace import for ${specifier}`);
  }
  const nsSymbol = checker.getSymbolAtLocation(clause.name);
  if (!nsSymbol) {
    throw new Error(
      `the checker could not resolve \`import * as E from '${specifier}'\` — the entry does not ` +
        `resolve through the package's \`exports\` map from a consumer's position.`,
    );
  }

  // ⚠️ `getSymbolAtLocation` on a namespace import returns the ALIAS, whose own
  // export list is empty; the module's exports hang off the aliased symbol. The
  // first draft of this gate read the alias directly, found zero exports on all
  // 17 entries, generated zero probes, and reported "0 unnameable structural
  // mentions" at exit 0 — a green run that had measured nothing, i.e. the exact
  // #4690 shape this gate is written against. The calibration refusal in `main`
  // is the second half of that lesson: enumeration going silently empty must be
  // a REFUSAL, never a pass.
  const moduleSymbol =
    nsSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(nsSymbol) : nsSymbol;

  const result: { name: string; arity: number }[] = [];
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const type = checker.getTypeOfSymbolAtLocation(symbol, clause.name);
    const signatures = type.getCallSignatures();
    if (signatures.length === 0) continue;
    // The narrowest overload decides the arity: a call that satisfies the
    // fewest required parameters satisfies at least one signature.
    const arity = Math.min(
      ...signatures.map((sig) =>
        sig.getParameters().filter((p) => {
          const d = p.valueDeclaration;
          if (!d || !ts.isParameter(d)) return true;
          return !d.questionToken && !d.initializer && !d.dotDotDotToken;
        }).length,
      ),
    );
    result.push({ name, arity });
  }
  fs.rmSync(probeFile, { force: true });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** The probe source for one entry. */
function probeSource(specifier: string, callables: { name: string; arity: number }[]): string {
  const head = `import * as E from '${specifier}';\n\n`;
  const body = callables
    .map(({ name, arity }, i) => {
      const args = Array.from({ length: arity }, () => 'null as never').join(', ');
      return `export const c${i}_${name} = E.${name}(${args});`;
    })
    .join('\n');
  return `${head}${body}\n`;
}

/** A sandbox whose `node_modules` resolves `@objectstack/spec` to the real package. */
function makeSandbox(pkgDir: string, packageName: string, prefix: string): string {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const scopeName = packageName.startsWith('@') ? packageName.split('/')[0]! : '';
  const scope = path.join(sandbox, 'node_modules', scopeName);
  fs.mkdirSync(scope, { recursive: true });
  const linkName = packageName.startsWith('@') ? packageName.split('/')[1]! : packageName;
  fs.symlinkSync(pkgDir, path.join(scope, linkName), 'dir');
  return sandbox;
}

// ---------------------------------------------------------------------------
// The canary — see "Anti-phantom" in the docblock.
// ---------------------------------------------------------------------------

const CANARY_FILES = {
  'canary.ts': 'export const probe = new (class { private x = 1; })();\n',
};

function runCanary(sandbox: string): { ok: boolean; output: string } {
  const res = compile(path.join(sandbox, '__canary'), CANARY_FILES);
  // Measured: TS4094 ("Property 'x' of exported anonymous class type may not be
  // private or protected"). Pinned as the TS40xx declaration-emit family plus
  // the message's substance, not the bare number.
  const ok = res.exitCode !== 0 && /error TS4\d{2,3}: .*private/.test(res.output);
  return { ok, output: res.output };
}

// ---------------------------------------------------------------------------
// Self-test — the positive control, driven over a synthetic package.
// ---------------------------------------------------------------------------

/**
 * A two-entry synthetic package built to leak on purpose.
 *
 * `leaky` exports a factory whose return type is a generic instantiation that
 * expands to mention `Hidden`, declared in an internal module the entry does not
 * re-export — the #11350 shape in miniature. `clean` is the same entry with the
 * one re-export added, i.e. the A′ repair.
 */
function writeFixture(root: string, reExportHidden: boolean): void {
  const pkg = path.join(root, 'node_modules', 'synthetic-spec');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify(
      {
        name: 'synthetic-spec',
        version: '0.0.0',
        exports: {
          '.': { require: { types: './dist/index.d.ts', default: './dist/index.js' } },
          './other': { require: { types: './dist/other.d.ts', default: './dist/other.js' } },
        },
      },
      null,
      2,
    ),
  );
  // The internal chunk: the analogue of a hash-named dist chunk no `exports`
  // entry addresses.
  fs.writeFileSync(
    path.join(pkg, 'dist', 'internal.d.ts'),
    'export interface Hidden { tag: string }\nexport type Box<T> = { value: T };\n',
  );
  fs.writeFileSync(
    path.join(pkg, 'dist', 'index.d.ts'),
    `import type { Hidden, Box } from './internal.js';\n` +
      `export declare function makeThing(config: Box<Hidden>): Box<Hidden>;\n` +
      (reExportHidden ? `export type { Hidden } from './internal.js';\n` : '') +
      `export type { Box } from './internal.js';\n`,
  );
  // A second entry that names `Hidden` publicly. In a BATCHED program this file
  // is what makes `Hidden` nameable program-wide and empties the measurement.
  fs.writeFileSync(
    path.join(pkg, 'dist', 'other.d.ts'),
    `export type { Hidden } from './internal.js';\nexport declare function unrelated(): string;\n`,
  );
  for (const js of ['index', 'other', 'internal']) {
    fs.writeFileSync(path.join(pkg, 'dist', `${js}.js`), 'module.exports = {};\n');
  }
}

function selfTest(): boolean {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os-entry-nameability-selftest-'));

  const probeFor = (specifier: string) =>
    compile(path.join(root, `__probe_${specifier.replace(/[^\w]/g, '_')}`), {
      'probe.ts':
        `import * as E from '${specifier}';\n\n` +
        `export const c0_makeThing = E.makeThing(null as never);\n`,
    });

  // 1. LEAKY: the gate must report exactly `Hidden`.
  writeFixture(root, false);
  const leaky = probeFor('synthetic-spec');
  if (!leaky.leaks.includes('Hidden')) {
    problems.push(
      `positive control did not fire: a synthetic entry leaking \`Hidden\` was reported as ` +
        `${JSON.stringify(leaky.leaks)}.\n${leaky.output}`,
    );
  }
  if (leaky.foreign.length > 0) {
    problems.push(`positive control produced foreign diagnostics:\n  ${leaky.foreign.join('\n  ')}`);
  }

  // 2. REPAIRED: the same entry with the re-export added must be clean — the
  //    A′ repair shape. Without this direction a gate that reports every entry
  //    would also pass step 1.
  writeFixture(root, true);
  const repaired = probeFor('synthetic-spec');
  if (repaired.leaks.length > 0) {
    problems.push(
      `negative control fired: the repaired fixture re-exports \`Hidden\`, so nothing should be ` +
        `unnameable, but the gate reported ${JSON.stringify(repaired.leaks)}.\n${repaired.output}`,
    );
  }

  // 3. BATCHING CONTROL: back to the leaky fixture, but with the sibling entry
  //    imported in the SAME program. This is the design the docblock refuses,
  //    and the self-test is where the refusal is measured rather than asserted.
  writeFixture(root, false);
  const batched = compile(path.join(root, '__probe_batched'), {
    'probe.ts':
      `import * as E from 'synthetic-spec';\n` +
      `import * as O from 'synthetic-spec/other';\n\n` +
      `export const c0_makeThing = E.makeThing(null as never);\n` +
      `export const c1_unrelated = O.unrelated();\n`,
  });
  if (batched.leaks.length > 0) {
    problems.push(
      `the batching control reported ${JSON.stringify(batched.leaks)} — it is supposed to report ` +
        `NOTHING, which is the whole reason entries are never batched into one program. If this ` +
        `stopped being true the docblock's central design claim needs re-measuring, not editing.`,
    );
  }

  // 4. CANARY: the declaration-emit axis must still be checked.
  const canary = runCanary(root);
  if (!canary.ok) {
    problems.push(
      `the canary did not go red under the shared compiler profile — if \`declaration: true\` were ` +
        `dropped, every probe in this gate would be green forever.\n${canary.output}`,
    );
  }

  fs.rmSync(root, { recursive: true, force: true });

  if (problems.length > 0) {
    console.error('❌ check-entry-nameability --self-test FAILED\n');
    for (const p of problems) console.error(`  • ${p}\n`);
    return false;
  }
  console.log(
    '✅ self-test: positive control fires (`Hidden`), repaired fixture is clean, ' +
      'the batched program reports nothing (why entries are never batched), canary red.',
  );
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  const argv = process.argv.slice(2);
  const selfTestOnly = argv.includes('--self-test');
  const list = argv.includes('--list');

  if (!selfTest()) return 1;
  if (selfTestOnly) return 0;

  const freshness = inspectDistFreshness(PKG_DIR, 'check', RERUN);
  if (!freshness.fresh) {
    console.error(freshness.message);
    return 1;
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')) as {
    name: string;
  };
  const entries = moduleEntries(PKG_DIR);
  const sandbox = makeSandbox(PKG_DIR, manifest.name, 'os-entry-nameability-');

  const canary = runCanary(sandbox);
  if (!canary.ok) {
    console.error(
      `\n❌ REFUSING: the canary is not red under this run's compiler profile.\n\n` +
        `   TS2883 and its family are DECLARATION-EMIT diagnostics. If the profile lost\n` +
        `   \`declaration: true\`, every probe below would report clean no matter what leaks.\n\n` +
        `   tsc said:\n${canary.output}`,
    );
    fs.rmSync(sandbox, { recursive: true, force: true });
    return 1;
  }

  const started = Date.now();
  const rows: {
    specifier: string;
    probes: number;
    leaks: string[];
    unserializable: number;
    foreign: string[];
    ms: number;
  }[] = [];

  for (const entry of entries) {
    const t0 = Date.now();
    const callables = callableExports(entry.specifier, sandbox);
    if (callables.length === 0) {
      // Not a skip: an entry with no callable export cannot exhibit this defect
      // class, but it also cannot be measured, so it is reported as such rather
      // than counted into the green total.
      rows.push({ specifier: entry.specifier, probes: 0, leaks: [], unserializable: 0, foreign: [], ms: Date.now() - t0 });
      continue;
    }
    const dir = path.join(sandbox, `__probe_${entry.subpath.replace(/[^\w]/g, '_')}`);
    const res = compile(dir, { 'probe.ts': probeSource(entry.specifier, callables) });
    rows.push({
      specifier: entry.specifier,
      probes: callables.length,
      leaks: res.leaks,
      unserializable: res.unserializable,
      foreign: res.foreign,
      ms: Date.now() - t0,
    });
    if (res.foreign.length > 0) {
      console.error(`\n❌ REFUSING on ${entry.specifier}: diagnostics outside this gate's two families.\n`);
      for (const f of res.foreign.slice(0, 10)) console.error(`   ${f}`);
      console.error(
        `\n   A probe program that fails to compile for an unrelated reason has measured NOTHING.\n` +
          `   Fix the probe surface (or teach this gate the new family, with a --self-test case)\n` +
          `   rather than letting the run be green for a reason unrelated to its subject.\n`,
      );
      fs.rmSync(sandbox, { recursive: true, force: true });
      return 1;
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  fs.rmSync(sandbox, { recursive: true, force: true });

  if (list) {
    for (const r of rows) {
      console.log(
        `${r.specifier.padEnd(34)} probes=${String(r.probes).padStart(4)}  ` +
          `unserializable=${String(r.unserializable).padStart(3)}  ${String(r.ms).padStart(6)}ms  ` +
          `leaks=${r.leaks.length ? r.leaks.join(', ') : '—'}`,
      );
    }
  }

  const totalProbes = rows.reduce((a, b) => a + b.probes, 0);

  // CALIBRATION, the `check:browser-reachable-entries` pattern: a gate whose
  // green result is "nothing found" must prove it can still find something on
  // the real tree. Enumeration is the one step that can go silently empty —
  // measured, during this gate's own development: reading the namespace import's
  // ALIAS symbol instead of the aliased module symbol produced 0 callable
  // exports on all 17 entries, 0 probes, and a clean green. The floor is not a
  // hardcoded count (that rots against a changing surface) but the structural
  // fact that this package's entries export callable factories at all.
  if (totalProbes === 0) {
    console.error(
      `\n❌ REFUSING: enumeration found ZERO callable exports across all ${rows.length} public entries.\n\n` +
        `   Every probe this gate compiles comes from that enumeration, so a run in this state\n` +
        `   asserts nothing while reporting clean. Either the checker stopped resolving the entries\n` +
        `   through the \`exports\` map, or this package genuinely exports no callable value from any\n` +
        `   entry — the first is a bug in this gate, the second would be a change nobody makes by\n` +
        `   accident. Both are findings; neither is a pass.\n\n` +
        `   Re-run with --list to see the per-entry counts: ${RERUN} -- --list\n`,
    );
    return 1;
  }
  const totalUnserializable = rows.reduce((a, b) => a + b.unserializable, 0);
  const unprobed = rows.filter((r) => r.probes === 0).map((r) => r.specifier);

  // Ratchet, both directions — see "The ledger" in the docblock.
  const ledger = readLedger();
  const added: { specifier: string; names: string[] }[] = [];
  const repaired: { specifier: string; names: string[] }[] = [];
  for (const row of rows) {
    const recorded = ledger.get(row.specifier) ?? new Set<string>();
    const now = new Set(row.leaks);
    const newNames = row.leaks.filter((n) => !recorded.has(n));
    const goneNames = [...recorded].filter((n) => !now.has(n)).sort();
    if (newNames.length > 0) added.push({ specifier: row.specifier, names: newNames });
    if (goneNames.length > 0) repaired.push({ specifier: row.specifier, names: goneNames });
  }
  for (const specifier of ledger.keys()) {
    if (!rows.some((r) => r.specifier === specifier)) {
      repaired.push({ specifier, names: [...(ledger.get(specifier) ?? [])].sort() });
    }
  }

  if (added.length > 0) {
    console.error(
      `\n❌ entry-nameability: ${added.reduce((a, b) => a + b.names.length, 0)} NEW unnameable ` +
        `structural mention(s) across ${added.length} public entr${added.length === 1 ? 'y' : 'ies'}.\n`,
    );
    for (const r of added) {
      console.error(`   ${r.specifier}`);
      for (const name of r.names) console.error(`      • ${name}`);
    }
    console.error(
      `\n   The invariant (maintainer ruling 2026-08-23, recorded on #11350): a type that appears\n` +
        `   structurally in an entry's public declarations must be nameable from that same entry.\n\n` +
        `   Each name above appears in the declaration emitted for a consumer that CALLS one of the\n` +
        `   entry's exported functions, and cannot be named through the package's \`exports\` map —\n` +
        `   so a consumer writing an un-annotated \`export const x = <thatCall>\` gets TS2883 and\n` +
        `   cannot build. Fix it the way #11350 and #11709 were fixed: re-export the type from the\n` +
        `   module that declares it, on the entry that leaks it. Do NOT annotate around it in the\n` +
        `   consumer — that repairs one consumer and leaves the entry broken for the rest, and do\n` +
        `   NOT add it to ${path.basename(LEDGER_PATH)} — that ledger is closed to new rows.\n\n` +
        `   Re-run: ${RERUN}\n`,
    );
    return 1;
  }

  if (repaired.length > 0) {
    console.error(
      `\n❌ entry-nameability: ${path.basename(LEDGER_PATH)} records name(s) that no longer leak.\n`,
    );
    for (const r of repaired) {
      console.error(`   ${r.specifier}`);
      for (const name of r.names) console.error(`      • ${name} — repaired; delete this row`);
    }
    console.error(
      `\n   The ledger is shrink-only in BOTH directions. A row kept after its repair stops\n` +
        `   describing the tree and starts covering for it: the next leak of that exact name would\n` +
        `   land pre-accommodated, silently. Delete the rows above.\n\n` +
        `   Re-run: ${RERUN}\n`,
    );
    return 1;
  }

  const accommodated = [...ledger.values()].reduce((a, b) => a + b.size, 0);
  console.log(
    `✅ entry-nameability: ${totalProbes} call probes across ${rows.length} public entries, ` +
      `0 new unnameable structural mentions (${elapsed}s).`,
  );
  if (accommodated > 0) {
    console.log(
      `   ⚠️ ${accommodated} pre-existing leak(s) carried in ${path.basename(LEDGER_PATH)}, ` +
        `shrink-only. They are real consumer breakage,\n      not a clean bill — each is repaired ` +
        `by one re-export line on the leaking entry.`,
    );
  }
  if (totalUnserializable > 0) {
    console.log(
      `   ⚠️ NOT MEASURED: ${totalUnserializable} probe(s) hit TS7056 (the compiler refused to\n` +
        `      serialize the inferred type). Those calls are neither clean nor leaking — the printer\n` +
        `      gives up before name resolution. Counted here so the number cannot grow unnoticed.`,
    );
  }
  if (unprobed.length > 0) {
    console.log(`   ⚠️ NOT MEASURED: no callable export on ${unprobed.join(', ')}.`);
  }
  return 0;
}

process.exit(main());
