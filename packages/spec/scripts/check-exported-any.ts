// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-exported-any.ts — no exported type of @objectstack/spec may resolve to `any`.
 *
 * The spec package IS the third-party API, and #4115 made a rule out of that: a
 * symbol whose name matches a spec export must be an IMPORT, not a local
 * re-declaration. For four exports that rule actively *degraded* the consumer
 * that obeyed it (#4171) — the type it bound to was `any`:
 *
 *     declare const NavigationItemSchema: z.ZodType<any>;            // recursion annotation
 *     type NavigationItem = z.infer<typeof NavigationItemSchema>;    // → any
 *
 * A recursive Zod schema needs an explicit annotation to break the circular
 * inference, and `z.ZodType<any>` is the path of least resistance. It compiles,
 * it validates correctly at runtime, and it silently throws the type away. The
 * consumer that deletes its own 118-line `NavigationItem` in favour of the spec
 * import — exactly what #4115 asks for — ends up with *less* type safety than
 * before, and nothing anywhere fails to say so.
 *
 * The reason it survives review is that `any` answers every question
 * affirmatively: `[Local] extends [Spec]` and `[Spec] extends [Local]` are BOTH
 * true when `Spec` is `any`, so the natural "are these identical?" check reports
 * "identical, safe to re-export" and recommends precisely the wrong action. Same
 * failure family as #4075's `[key: string]: any` on `ActionDef`. A type that
 * agrees with everything cannot be caught by asking it whether it agrees.
 *
 * So it is asked structurally instead, from the built `.d.ts` a consumer's
 * import actually resolves to — the same vantage point as `build-api-surface.ts`,
 * because a source-level check would not see what the declaration bundler emits.
 *
 * TWO surfaces, because the defect has two visible faces:
 *   1. exported TYPES that resolve to `any`   — what the consumer binds to.
 *   2. exported SCHEMAS whose output is `any` — the root cause, and `any` for
 *      any consumer writing `z.infer<typeof XSchema>` even when nobody has
 *      exported a named type for it yet. `FieldNodeSchema` was exactly that:
 *      one alias away from being a fifth entry in #4171's table, and invisible
 *      to a types-only scan.
 *
 * SCOPE — the type itself must BE `any`. A type with `any` somewhere inside it
 * (`Record<string, any>`, `any[]`, an `$eq?: any` operator field) is NOT flagged:
 * that is a different and far broader question, and drawing the line here keeps
 * the gate at zero false positives so red keeps meaning broken. The authorable
 * key surface is ratcheted separately (`authorable-surface/`, #3855).
 *
 * Fix, don't declare: annotate the recursion with the type instead of `any` —
 * infer the non-recursive part and tie the recursive knot in the type (the
 * `QueryAST` pattern this repo already follows in `data/query.zod.ts`):
 *
 *     const BaseXSchema = z.object({ ...every non-recursive key });
 *     export type X = z.infer<typeof BaseXSchema> & { children?: X[] };
 *     export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({
 *       children: z.array(XSchema).optional(),
 *     }));
 *
 * `KNOWN_ANY` is the escape hatch for a case that genuinely cannot be typed, and
 * it is shrink-only: an entry that no longer resolves to `any` fails the gate
 * until it is deleted, so a fix cannot leave a stale exemption behind to cover
 * the next regression under the last one's reason. It is currently EMPTY, and
 * worth keeping that way — #4171 fixed all four rather than declaring them.
 *
 * ## Usage
 *
 *     pnpm --filter @objectstack/spec check:exported-any              # audit the built dist
 *     pnpm --filter @objectstack/spec exec tsx scripts/check-exported-any.ts --self-test
 *
 * The self-test compiles a fixture against the REAL zod, so the day zod renames
 * the internals this reads (`_output`), the gate fails loudly instead of quietly
 * passing everything forever — the failure mode that matters most for a check
 * whose green result is "nothing found".
 *
 * Reads the built dist — run after `pnpm --filter @objectstack/spec build`.
 *
 * That last sentence is a PRECONDITION, and since #7181 it is enforced rather
 * than merely documented: the audit refuses a dist that is missing or older than
 * `src/`. The self-test above is the anti-vacuity floor for a broken DETECTOR; it
 * says nothing about the vintage of the declarations the audit then reads, and on
 * a stale dist this gate reports "no exported type resolves to `any`" without
 * having read the export the developer just added. See lib/dist-freshness.ts.
 */
import ts from 'typescript';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EXIT_PREREQUISITE_NOT_MET, inspectDistFreshness, prerequisiteNotMetText } from './lib/dist-freshness';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SELF_TEST = process.argv.includes('--self-test');

/**
 * Deliberate, reasoned exemptions — `'<subpath>:<name>': 'why'`.
 *
 * Shrink-only: an entry listed here that no longer resolves to `any` is a
 * failure, not a pass. Every entry is debt with a name on it.
 */
const KNOWN_ANY: Record<string, string> = {};

/** Public entry points → their built CJS `.d.ts`, read from the exports map. */
function collectEntries(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const entries: Record<string, string> = {};
  for (const [sub, val] of Object.entries<any>(pkg.exports ?? {})) {
    if (!sub.startsWith('.')) continue;
    const dts = val?.require?.types ?? val?.import?.types;
    if (typeof dts === 'string' && dts.endsWith('.d.ts')) entries[sub] = resolve(PKG_DIR, dts);
  }
  return entries;
}

type Violation = { key: string; kind: 'type' | 'schema'; detail: string };
type ScanResult = { violations: Violation[]; declared: Set<string>; types: number; schemas: number };

/**
 * Scan a program's module exports for symbols that resolve to `any`.
 *
 * `entries` maps a public subpath to the `.d.ts` that serves it, so a violation
 * is reported as `./ui:NavigationItem` — the import path a consumer would write.
 */
function scan(program: ts.Program, entries: Record<string, string>, exempt: Record<string, string>): ScanResult {
  const checker = program.getTypeChecker();
  const result: ScanResult = { violations: [], declared: new Set(), types: 0, schemas: 0 };

  const unalias = (s: ts.Symbol): ts.Symbol =>
    s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
  const isAny = (t: ts.Type | undefined): boolean => Boolean(t && t.flags & ts.TypeFlags.Any);

  /**
   * The output type of a Zod schema value, or undefined when the symbol is not a
   * schema. `_output` is `Internals['output']` on zod's `ZodType`, i.e. exactly
   * what `z.infer<typeof X>` resolves to — so this asks the consumer's question
   * without reimplementing `z.infer`.
   */
  const schemaOutput = (sym: ts.Symbol, decl: ts.Declaration): ts.Type | undefined => {
    const output = checker.getPropertyOfType(checker.getTypeOfSymbolAtLocation(sym, decl), '_output');
    return output ? checker.getTypeOfSymbolAtLocation(output, decl) : undefined;
  };

  for (const [sub, file] of Object.entries(entries)) {
    const sf = program.getSourceFile(file);
    const moduleSym = sf && checker.getSymbolAtLocation(sf);
    if (!moduleSym) throw new Error(`Could not resolve module symbol for ${sub} (${file}). Is the package built?`);

    for (const exported of checker.getExportsOfModule(moduleSym)) {
      const name = exported.getName();
      const sym = unalias(exported);
      const flags = sym.getFlags();
      const key = `${sub}:${name}`;
      const record = (kind: Violation['kind'], detail: string) => {
        if (exempt[key]) result.declared.add(key);
        else result.violations.push({ key, kind, detail });
      };

      // 1. Exported types — what a consumer following #4115 binds its symbol to.
      if (flags & ts.SymbolFlags.TypeAlias) {
        result.types++;
        if (isAny(checker.getDeclaredTypeOfSymbol(sym))) {
          record('type', `exported type \`${name}\` resolves to \`any\``);
        }
        continue;
      }

      // 2. Exported schemas — the root cause, and `any` for `z.infer<typeof X>`
      //    even when no named type has been exported for it yet.
      if (flags & ts.SymbolFlags.Variable) {
        const decl = sym.valueDeclaration ?? sym.declarations?.[0];
        if (!decl) continue;
        const output = schemaOutput(sym, decl);
        if (!output) continue;
        result.schemas++;
        if (isAny(output)) {
          record(
            'schema',
            `exported schema \`${name}\` has output \`any\`, so \`z.infer<typeof ${name}>\` is \`any\``,
          );
        }
      }
    }
  }

  return result;
}

function makeProgram(files: string[], extra: ts.CompilerOptions = {}): ts.Program {
  return ts.createProgram(files, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    ...extra,
  });
}

// ── Self-test: the handshake flag ────────────────────────────────────────────
//
// Set by `selfTest()` only after its verdict line prints, and read at the
// dispatch below: a `return` that leaves the function above that line prints
// nothing, and here it does not even stop — control falls through to the audit,
// which on a fresh dist prints its own green line and exits 0. A self-test that
// never finished, reported as one that passed. ⛔ AN EXIT CODE IS NOT A
// HANDSHAKE: `fail()` below exits 1 on its own, so the exit code stays
// load-bearing; the flag is the thing an early return cannot carry with it.
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor ─────────────────────────────
//
// Reaching the `✅ self-test` line used to be this self-test's ONLY success
// condition, so "every case held" and "the cases never ran" printed the same
// line. Measured on THIS file rather than inherited from the sibling it is
// copied from: deleting `'InferredFromAnySchema'` from the RED-leg name list
// below de-registers one of the two type-half detection pins, and the run still
// prints that line byte-identically and still exits 0 — the
// 「a printed case count is EVIDENCE, NOT PROOF」 shape with the evidence
// missing as well, since this self-test printed no count at all.
//
// Closed the way `scripts/check-agent-model-declared.mjs` and its TypeScript
// ports (`scripts/check-test-typecheck.mts`, `check-duration-unit-keys.ts` in
// this very directory) closed it — COPIED and ⛔ never imported, because
// every self-test has to keep running standalone as
// `tsx scripts/check-exported-any.ts --self-test`, and a shared assertion
// module would be one point of failure for every instrument at once. What is
// pinned is the registered NAMES, not a number.
//
// A BATTERY HERE IS A SECTION: this self-test is a sequence of assertions
// grouped by what they hold, so each group opens with `battery('<name>')` and
// every `expect()` after it is attributed to that name until the next opens.
//
// ⛔ A pinned TOTAL is not the repair — a battery falling from 8 cases to 1
// keeps a total "right" the moment a sibling grows — and ⛔ neither is a roster
// DERIVED from the run: a count taken from the cases that ran can never notice
// one that stopped. The two fixture name lists are exactly what a shrink
// deletes from, so their floors are their live lengths.
//
// The counts are a FLOOR, not an equality: adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running.
const SELF_TEST_BATTERIES: Readonly<Record<string, number>> = Object.freeze({
  'the fixture compiles against the real zod': 1,
  'the fixture RESOLVES: the counts that keep every assertion below non-vacuous': 2,
  'the RED leg: an exported TYPE that IS `any` is flagged': 2,
  'the RED leg: an exported SCHEMA whose output is `any` is flagged': 1,
  'the GREEN leg: precise, `any`-CONTAINING and non-schema exports are NOT flagged': 8,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 5;

// The key a case is filed under when no battery is open. It is not a declared
// battery, so it reds by the same set difference rather than silently inflating
// whichever battery happened to open last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Verify the checker still detects what it exists to detect, against the real
 * zod. Both halves matter: a false negative makes the gate dormant (green
 * forever, which is indistinguishable from "clean"), a false positive makes it
 * noise that someone will route around.
 */
function selfTest(): void {
  const fail = (msg: string): never => {
    console.error(`✗ self-test: ${msg}`);
    process.exit(1);
  };

  // The battery ledger this self-test's floor is evaluated against.
  // `battery()` opens a battery; every `expect()` below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  //
  // Registration is the FIRST statement of `expect()`, before the outcome is
  // consulted, because the floor asserts REACH: a case that runs and FAILS
  // still registers (and `fail()` exits loudly on its own), and only a case that
  // never runs at all goes missing from the ledger. Routing registration
  // through the failure path instead would register a case only when it failed
  // — a fully green run would register 0 and every battery would read DID NOT
  // RUN, the floor inverted rather than installed.
  const seen = new Map<string, number>();
  let openBattery: string | undefined;
  const battery = (name: string): void => {
    openBattery = name;
  };
  const expect = (ok: boolean, msg: string | (() => string)): void => {
    const attributedTo = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(attributedTo, (seen.get(attributedTo) ?? 0) + 1);
    if (!ok) fail(typeof msg === 'function' ? msg() : msg);
  };

  // Resolve the real zod so the fixture exercises the actual `ZodType` internals
  // this checker reads — a stub would keep passing after zod renamed them.
  const require = createRequire(import.meta.url);
  const zodDir = dirname(require.resolve('zod/package.json', { paths: [PKG_DIR] }));

  const dir = mkdtempSync(join(tmpdir(), 'spec-exported-any-'));
  const fixture = join(dir, 'fixture.ts');
  writeFileSync(
    fixture,
    `import { z } from 'zod';\n` +
      // Should be flagged: the type IS `any`, however it got there.
      `export type BareAny = any;\n` +
      `export const AnySchema: z.ZodType<any> = z.lazy(() => z.object({ a: z.string() }));\n` +
      `export type InferredFromAnySchema = z.infer<typeof AnySchema>;\n` +
      // Should NOT be flagged: precisely typed, or merely `any`-CONTAINING.
      `export type Precise = { a: string };\n` +
      `export const PreciseSchema: z.ZodType<Precise> = z.lazy(() => z.object({ a: z.string() }));\n` +
      `export const PlainSchema = z.object({ a: z.string() });\n` +
      `export type InferredFromPlain = z.infer<typeof PlainSchema>;\n` +
      `export type AnyInside = Record<string, any>;\n` +
      `export type AnyArray = any[];\n` +
      `export const LooseSchema = z.record(z.string(), z.any());\n` +
      `export const NotASchema = { a: 1 };\n` +
      `export function notASchemaEither(): void {}\n`,
    'utf8',
  );

  try {
    const program = makeProgram([fixture], {
      // Node10 resolution + an explicit `paths` mapping so the fixture's bare
      // `zod` import resolves from a temp dir outside any node_modules tree.
      moduleResolution: ts.ModuleResolutionKind.Node10,
      baseUrl: dir,
      paths: { zod: [zodDir], 'zod/*': [`${zodDir}/*`] },
    });

    battery('the fixture compiles against the real zod');
    const syntactic = program.getSyntacticDiagnostics();
    expect(
      syntactic.length === 0,
      () => `fixture does not parse: ${ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ')}`,
    );

    const { violations, types, schemas } = scan(program, { './fixture': fixture }, {});
    const flagged = new Set(violations.map((v) => v.key.split(':')[1]));

    // The fixture exports 6 type aliases and 4 schemas. A lower count means the
    // scan is not seeing them at all — which would make every assertion below
    // pass vacuously, the exact way a gate goes dormant.
    battery('the fixture RESOLVES: the counts that keep every assertion below non-vacuous');
    expect(types === 6, `saw ${types} exported types, expected 6 — the fixture's types are not resolving (zod unresolved?)`);
    expect(schemas === 4, `saw ${schemas} exported schemas, expected 4 — \`_output\` no longer resolves, so the schema half of this gate is DORMANT`);

    battery('the RED leg: an exported TYPE that IS `any` is flagged');
    for (const name of ['BareAny', 'InferredFromAnySchema']) {
      expect(flagged.has(name), `missed exported type \`${name}\` — the type half of this gate is DORMANT`);
    }
    battery('the RED leg: an exported SCHEMA whose output is `any` is flagged');
    expect(flagged.has('AnySchema'), 'missed `AnySchema` — the schema half of this gate is DORMANT');

    battery('the GREEN leg: precise, `any`-CONTAINING and non-schema exports are NOT flagged');
    for (const name of ['Precise', 'PreciseSchema', 'PlainSchema', 'InferredFromPlain', 'AnyInside', 'AnyArray', 'LooseSchema', 'NotASchema']) {
      expect(!flagged.has(name), `false positive on \`${name}\` — only a type that IS \`any\` may be flagged`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases ──────────────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered EQUALS the set declared, each at or above its own
  // count. A set difference names WHICH battery stopped; a count says only that
  // something did — and, before this block existed, not even that.
  const floorProblems: string[] = [];
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorProblems.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorProblems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorProblems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — ${SELF_TEST_BATTERIES[name] - count} case(s) that used to run no longer do.`,
    );
  }
  if (floorProblems.length > 0) {
    for (const problem of floorProblems) console.error(`✗ self-test floor: ${problem}`);
    console.error(
      '✗ self-test floor: A battery below its floor means cases STOPPED RUNNING — the battery is the ' +
        'bug, not the number. Find what stopped registering (a name deleted from a fixture name list, ' +
        'a guard that now skips, an early return) and restore it.',
    );
    process.exit(1);
  }

  // The count is printed because a reader had to hand-tally the assertions to
  // get one, and it is printed AFTER the floor rather than instead of it: the
  // number is evidence, the floor is the proof.
  const registered = [...seen.values()].reduce((a, b) => a + b, 0);
  console.log(
    '✅  self-test: detects `any` types and `any`-output schemas, and nothing else — ' +
      `${registered} case(s) across ${declaredBatteries.length} batteries, every battery at or above ` +
      'its pinned floor.',
  );
  selfTestReachedVerdict = true;
}

if (SELF_TEST) {
  selfTest();
  // The handshake. Without it a `return` above the verdict prints nothing and
  // does not even stop: control reaches the audit below, which on a fresh dist
  // prints its own green line and exits 0 — a self-test that never finished,
  // reported as one that passed. `fail()`'s own exit code stays load-bearing;
  // this refuses to believe a SILENT success.
  if (!selfTestReachedVerdict) {
    console.error(
      '\n✗ check-exported-any self-test: selfTest() returned without reaching its verdict,\n' +
        'so no verdict line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
  process.exit(0);
}

// ── Audit ────────────────────────────────────────────────────────────────────

// BEFORE a single `.d.ts` is read (#7181, adopting #7122's primitive). The
// existing floors — the self-test's count assertions, and the "Could not resolve
// module symbol … Is the package built?" throw in `scan` — cover a MISSING dist
// and a broken detector. Neither can see the case this refuses: a dist that is
// present and resolves fine but predates the edit under test. There the audit
// runs to completion and prints `✅ no exported type resolves to \`any\`` about a
// build nobody made, which is a false green on exactly the export the developer
// just wrote. It sits after `--self-test` deliberately: that path compiles a temp
// fixture against the real zod and never touches `dist/`, so refusing it on a
// stale dist would be over-reach.
const freshness = inspectDistFreshness(
  PKG_DIR,
  'check',
  'pnpm --filter @objectstack/spec check:exported-any',
);
if (!freshness.fresh) {
  // PREREQUISITE NOT MET, not a finding (#19227). The `process.exit(1)` above —
  // the self-test's — stays exactly what it was: that one IS a finding about
  // the detector. This path measured nothing at all.
  console.error(prerequisiteNotMetText('check:exported-any', freshness));
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

const entries = collectEntries();
const { violations, declared, types, schemas } = scan(makeProgram(Object.values(entries)), entries, KNOWN_ANY);

// Ratchet: an exemption that no longer applies must be deleted, or it stays
// available to cover the next regression under the last one's reason.
const stale = Object.keys(KNOWN_ANY).filter((key) => !declared.has(key));

if (violations.length === 0 && stale.length === 0) {
  const exemptions = Object.keys(KNOWN_ANY).length;
  console.log(
    `✅  no exported type resolves to \`any\`: ${types} types + ${schemas} schemas across ` +
      `${Object.keys(entries).length} entry points` +
      `${exemptions > 0 ? `, ${exemptions} declared exemption(s)` : ''}.`,
  );
  process.exit(0);
}

if (violations.length > 0) {
  console.error(`❌  ${violations.length} exported symbol(s) of @objectstack/spec resolve to \`any\`:\n`);
  for (const v of violations) console.error(`    • ${v.key} — ${v.detail}`);
  console.error(
    '\nAn exported `any` is worse than a missing export: #4115 tells every consumer to replace its own\n' +
      'declaration with the spec import, and `any` is mutually assignable with everything, so the check\n' +
      'that would catch the swap reports "identical, safe to re-export" (#4171). The damage is silent —\n' +
      'no compile error, just a type that stopped constraining anything.\n\n' +
      'Almost always a recursive schema annotated `z.ZodType<any>` to break the circular inference.\n' +
      'Annotate it with the type instead — infer the non-recursive part, tie the knot in the type:\n\n' +
      '    const BaseXSchema = z.object({ ...every non-recursive key });\n' +
      '    export type X = z.infer<typeof BaseXSchema> & { children?: X[] };\n' +
      '    export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({\n' +
      '      children: z.array(XSchema).optional(),\n' +
      '    }));\n\n' +
      '(`QueryAST` in src/data/query.zod.ts is the in-repo precedent.) If a case genuinely cannot be\n' +
      'typed, add it to KNOWN_ANY in scripts/check-exported-any.ts with a reason — it is shrink-only.',
  );
}

if (stale.length > 0) {
  console.error(`\n❌  ${stale.length} stale KNOWN_ANY exemption(s) — the gap is closed, delete the entry:\n`);
  for (const key of stale) console.error(`    • ${key} — no longer \`any\` (reason on file: ${KNOWN_ANY[key]})`);
  console.error(
    '\nThe ledger is shrink-only. A stale entry stays available to cover the NEXT regression under the\n' +
      "last one's reason, which is how a ratchet quietly stops ratcheting.",
  );
}

process.exit(1);
