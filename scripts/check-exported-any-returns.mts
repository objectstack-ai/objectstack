#!/usr/bin/env tsx
// check-exported-any-returns — no exported CALLABLE of an SDK package may
// resolve to `any` (#11927).
//
// ## The gap this closes
//
// #8140 bound 51 return-type sites across `packages/client/src/index.ts`. That
// buys a snapshot, not a property: nothing stopped the 52nd from landing the
// next morning. The card's own census said so, and the 2026-08-12 triage
// direction on #8140 asked for a client-side ratchet to be filed separately
// rather than grown inside that card.
//
// The reason the ratchet has to read a BUILT `.d.ts` rather than source text is
// measured, not stylistic. Implementing #8140 turned up a fifth erasure
// spelling that every grep in the census missed: 38 methods with no return
// annotation at all, whose type comes from `this.unwrapResponse<any>(res)`
// (#11925). A source-text search for `Promise<any>` cannot see those — the
// characters are not there. A checker reading the emitted declaration can,
// because it asks what the export RESOLVES to, which is the same vantage point
// `packages/spec`'s `check:exported-any` takes and for the same stated reason:
//
//     the `api-surface` snapshot records that an export *exists*, never what it
//     *resolves to*
//
// ## SCOPE — the awaited return type must BE `any`
//
// A return type with `any` somewhere INSIDE it (`Promise<Record<string, any>>`,
// `Promise<any[]>`, an `$eq?: any` operator field) is NOT flagged. That is a
// different and far broader question, and drawing the line here keeps the gate
// at zero false positives so red keeps meaning broken — the same line
// `packages/spec/scripts/check-exported-any.ts` draws for its own surface.
//
// ## ⛔ A caller-supplied generic is NOT erasure, and the distinction is structural
//
// `data.*` and `actions.*` take `<T = any>` BY DESIGN — the record type and the
// action handler's payload really are the caller's, and #8140 left them alone
// deliberately (#11929's report moved `actions.invoke`/`invokeGlobal` OUT of the
// erasure group after measuring them). A detector that cannot tell "the default
// is `any`" from "this method has no business knowing the shape" produces
// exactly the pressure that turns a correct generic into a wrong concrete type.
//
// This gate does not need a heuristic for that, because the type system already
// draws the line. The signature is read UNINSTANTIATED, so
//
//     invoke: <T = any>(…) => Promise<T>        awaited type is `T`, a
//                                               TypeParameter — NOT `any`
//     clone:  (…)         => Promise<any>       awaited type IS `any`
//
// The `= any` default never enters the answer: a default is what an absent type
// ARGUMENT resolves to at a call site, and no call site is being read here. Both
// directions are pinned in `--self-test` below, because a distinction that holds
// only by accident of how the checker was called is one refactor from inverting.
//
// ## Why the family name differs from `packages/spec`'s `check:exported-any`
//
// Not cosmetic, and not a territory dodge — `scripts/pm/dispatch-gates.mjs`
// dedupes discovered families by the CHECK NAME ALONE (`const key = inv.check`),
// with the `--filter` carried only on whichever invocation is scanned first. A
// second `check:exported-any` step under a different filter would therefore
// collapse INTO the spec family: one entry, one filter, and the other package's
// gate source never opened for watch hints. The gate would run in CI and be
// invisible to every dispatch brief, which is the same silence
// `scripts/pm/bare-root-worklist.mjs` exists to report on one level down. A
// distinct name is also the honest one: this gate reads METHOD RETURN TYPES over
// a walked surface, where the spec gate reads exported type aliases and Zod
// schema outputs. Same question, different populations.
//
// ## Two derivation facts about THIS file, measured rather than assumed
//
// 1. It declares NO scan root, so `scripts/pm/bare-root-worklist.mjs` has no row
//    to judge here — and that is established from the sweep's own two predicates
//    run against this source (`populationSpans` finds exactly one span, `PKG_DIR`;
//    `bareRootLiterals` finds none), not from the sweep's silence and not by
//    analogy with a neighbouring row. Structural reason: this gate never walks a
//    directory. It reads exactly ONE file — the package's declared root `.d.ts`,
//    resolved from that package's own `exports` map — so there is no population
//    for a subtree declaration to be true or false about. `PKG_DIR` holds
//    `packages/client`, which carries a separator and is therefore already
//    visible to `extractWatchHints`.
//
// 2. ⚠️ It is nevertheless INVISIBLE to the dispatch derivation today, and the
//    reason has nothing to do with this gate: `resolveCheckToFiles` matches only
//    `scripts/…{mjs,cjs,js,sh}`, so every TypeScript-authored gate in the repo —
//    all 23 of them, `check:exported-any` and `check:api-surface` included —
//    resolves to zero gate files and contributes zero watch hints. Filed as
//    #12107 rather than worked around here: writing this file in JavaScript to
//    satisfy a regex would be consumer-side tolerance for a producer-side defect,
//    and widening the regex re-attributes 23 families' matched lists fleet-wide,
//    which is a decision and not a rider on this card.
//
// ## Usage
//
//     tsx scripts/check-exported-any-returns.mts --self-test
//     tsx scripts/check-exported-any-returns.mts --package packages/client
//
// Reads the built dist — run after `pnpm --filter @objectstack/client build`.
// That is a PRECONDITION and it is enforced, not merely documented: see the
// refusal below. A gate whose green result is "nothing found" is
// indistinguishable from a gate that read nothing at all (#4690), and on a stale
// dist this one would report "no exported callable resolves to `any`" without
// ever having read the method the developer just added.

/// <reference types="node" />
//
// The root tsc program (`tsconfig.json`) declares `lib: ["ES2020"]` and no
// `types`, so `process`, `console` and the `node:*` builtins are absent from
// every file in it. Without this line THIS file contributed 35 raw errors to
// the `@objectstack/spec-monorepo` entry of `check:type-check-debt` — a
// shrink-only ratchet, so the remedy is to make the file typecheck, never to
// raise the entry.
//
// It has to be a REFERENCE and not explicit imports, measured rather than
// assumed: with the reference removed and every builtin imported by name
// (`import process from 'node:process'`, and so on for fs/path/url/os/console),
// the file still carried 12 errors and the `node:*` specifiers THEMSELVES did
// not resolve. @types/node is not reachable in this program without being asked
// for. Because @types/node declares globals, asking for it here also supplies
// them to the rest of the program — which is why landing this file lowered the
// ledger entry by 54 errors it did not author. See the PR body.

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';

import { distIsStale } from './check-regen-pending.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SELF_TEST = process.argv.includes('--self-test');

/**
 * ⚠️ This module EXPORTS `scan` and `judge`, and everything below the
 * `isEntrypoint` guard at the bottom reads `process.argv`, reads the disk and
 * calls `process.exit`. Without that guard an importer would run the whole audit
 * — and exit — merely by importing the detector, which is the import-safety rule
 * `scripts/check-entry-guard.mjs` enforces across this directory.
 *
 * It is written here deliberately rather than left to the gate, because THE GATE
 * CANNOT SEE THIS FILE: its walk admits `.mjs`/`.js`/`.cjs` only, the same
 * TypeScript blind spot #12107 records for `resolveCheckToFiles`. Its green
 * verdict on this file is vacuous, so the convention is held by hand here.
 */

/** A flag's value, or `undefined` when the flag is absent or trailing. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
}

const LEDGER_NAME = 'exported-any-returns.json';

type Target = { dir: string; abs: string; ledger: string; name: string };

/**
 * Which package this run is judging — resolved lazily, INSIDE the entry point.
 *
 * Deliberately not a module-level `const`. As one it threw on a missing
 * `--package` while the module was still being evaluated, so importing the
 * detector crashed before the `isEntrypoint` guard below could decline to run
 * anything — the guard was present and the module was still not import-safe.
 * Caught by importing it and looking, not by reading it. `--package` itself
 * stays REQUIRED (the `check-test-typecheck.mts` rule): a gate that guessed
 * which package it was judging would report a clean run over whichever one it
 * happened to find.
 */
function resolveTarget(): Target {
  const value = flag('--package');
  if (!value) {
    throw new Error(
      'check-exported-any-returns: --package <repo-relative dir> is required (e.g. --package packages/client).',
    );
  }
  const dir = value.replace(/\/+$/, '');
  const abs = path.resolve(ROOT, dir);
  let name = dir;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
    if (typeof parsed.name === 'string' && parsed.name) name = parsed.name;
  } catch {
    // Falls through to the directory label — an unreadable manifest is a
    // diagnostic problem here, not a reason to throw out of a message path.
  }
  return { dir, abs, ledger: path.join(abs, LEDGER_NAME), name };
}

// ── The detector ────────────────────────────────────────────────────────────

export type Violation = { key: string; detail: string };
export type ScanResult = {
  /** Every callable reached, whether or not it is a violation — the anti-vacuity counter. */
  callables: number;
  /** Callables carrying their own type parameters — the caller-supplied-generic population. */
  generics: number;
  /** Reached callables whose awaited return type IS `any`, keyed by walk path. */
  anyReturns: Map<string, string>;
};

function makeProgram(files: string[], extra: ts.CompilerOptions = {}): ts.Program {
  return ts.createProgram(files, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    strict: true,
    ...extra,
  });
}

/**
 * Walk a module's exported surface and record every callable whose awaited
 * return type IS `any`.
 *
 * The walk descends through ANONYMOUS object types only — `client.data = { … }`,
 * `client.datasources.external = { … }`, the namespacing idiom this SDK is built
 * out of. It deliberately does not descend into a NAMED type a property happens
 * to hold (`PaginatedResult`, `QueryAST`): those are data shapes, not the
 * package's callable surface, and following them would turn a method census
 * into a whole-type-graph census — the broad question this gate's SCOPE note
 * refuses. A named class that IS part of the surface (`RealtimeAPI`,
 * `QueryBuilder`) is reached anyway, as its own module export.
 */
export function scan(program: ts.Program, entryFile: string): ScanResult {
  const checker = program.getTypeChecker();
  const result: ScanResult = { callables: 0, generics: 0, anyReturns: new Map() };

  const sf = program.getSourceFile(entryFile);
  const moduleSym = sf && checker.getSymbolAtLocation(sf);
  if (!moduleSym) {
    throw new Error(
      `check-exported-any-returns: could not resolve the module symbol for ${entryFile}. Is the package built?`,
    );
  }

  const isAny = (t: ts.Type | undefined): boolean => Boolean(t && t.flags & ts.TypeFlags.Any);
  const unalias = (s: ts.Symbol): ts.Symbol =>
    s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

  /** A `{ … }` type literal — the namespacing shape, not a named data type. */
  const isAnonymousObject = (t: ts.Type): boolean => {
    if (!(t.flags & ts.TypeFlags.Object)) return false;
    if (!((t as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous)) return false;
    const decl = t.getSymbol()?.declarations?.[0];
    return Boolean(decl && ts.isTypeLiteralNode(decl));
  };

  const record = (key: string, sig: ts.Signature): void => {
    result.callables++;
    if ((sig.getTypeParameters() ?? []).length > 0) result.generics++;
    const ret = checker.getReturnTypeOfSignature(sig);
    // The awaited type is the unit that matters: every method on this surface is
    // async, so the erasure a consumer feels is `Promise<any>`, not `any`. A
    // synchronous `(): any` is the same defect and falls out of the same read,
    // because `getAwaitedType` of a non-promise is the type itself.
    const awaited = checker.getAwaitedType(ret) ?? ret;
    if (!isAny(awaited)) return;
    result.anyReturns.set(
      key,
      `\`${key}\` resolves to \`${ret === awaited ? 'any' : 'Promise<any>'}\``,
    );
  };

  // Cycle-breaking is per-BRANCH (the ancestors on the current path), not a
  // global visited set. A global one is the obvious spelling and it silently
  // DROPS population: two paths onto the same type — the shape this SDK produces
  // whenever a namespace object is shared between `ObjectStackClient` and
  // `ScopedEnvironmentClient` — would census the type once, under whichever path the
  // walk happened to reach first, so the second path's sites are invisible to the
  // ratchet and the ledger keys silently depend on walk order. A per-branch set
  // still terminates (a cycle must revisit an ancestor) and reports every path.
  const walk = (type: ts.Type, path: string, depth: number, ancestors: ReadonlySet<ts.Type>): void => {
    if (depth > 8 || ancestors.has(type)) return;
    const branch = new Set(ancestors).add(type);
    for (const prop of checker.getPropertiesOfType(type)) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      if (!decl) continue;
      const key = `${path}.${prop.getName()}`;
      const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
      const sigs = propType.getCallSignatures();
      if (sigs.length > 0) {
        for (const sig of sigs) record(key, sig);
        continue;
      }
      if (isAnonymousObject(propType)) walk(propType, key, depth + 1, branch);
    }
  };

  for (const exported of checker.getExportsOfModule(moduleSym)) {
    const sym = unalias(exported);
    const name = exported.getName();
    const flags = sym.getFlags();

    if (flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) {
      walk(checker.getDeclaredTypeOfSymbol(sym), name, 0, new Set());
      continue;
    }
    // A directly exported function or callable const.
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!decl) continue;
    for (const sig of checker.getTypeOfSymbolAtLocation(sym, decl).getCallSignatures()) {
      record(name, sig);
    }
  }

  return result;
}

// ── The ledger ──────────────────────────────────────────────────────────────

export type Ledger = { $comment?: string; entries: Record<string, string> };

/**
 * The shrink-only ratchet, judged EXACTLY — the `check-test-typecheck.mts` rule,
 * per site rather than per file:
 *
 *   • an unledgered callable resolving to `any` → red. The everyday case, and
 *     the whole point: this is the 52nd site.
 *   • a ledgered callable that no longer resolves to `any` → red ("graduated,
 *     delete the entry"). A stale entry stays available to cover the NEXT
 *     regression under the last one's reason, which is how a ratchet quietly
 *     stops ratcheting.
 *
 * Every entry carries a WRITTEN reason, and the reason is the point. A ledger of
 * bare keys is a silencer; a ledger of reasons is a worklist, and each of the
 * two reasons on file today names the issue that will close it out.
 */
export function judge(
  ledger: Ledger,
  found: Map<string, string>,
): { unledgered: Violation[]; stale: string[] } {
  const unledgered: Violation[] = [];
  for (const [key, detail] of found) {
    if (!(key in ledger.entries)) unledgered.push({ key, detail });
  }
  const stale = Object.keys(ledger.entries).filter((key) => !found.has(key));
  return { unledgered, stale };
}

function readLedger(target: Target): Ledger {
  let raw: string;
  try {
    raw = fs.readFileSync(target.ledger, 'utf8');
  } catch {
    console.error(
      `\n❌ ${target.dir}/${LEDGER_NAME} is missing.\n\n` +
        `   This gate is a shrink-only ratchet over a NAMED baseline, never a demand for zero:\n` +
        `   some sites keep \`any\` because no contract exists to bind yet, and a gate demanding\n` +
        `   zero would either block on that work or invite a false declaration to reach green.\n` +
        `   Seed the ledger with every site and a written reason each.`,
    );
    process.exit(1);
  }
  const parsed = JSON.parse(raw) as Ledger;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
    throw new Error(`check-exported-any-returns: ${target.dir}/${LEDGER_NAME} has no \`entries\` object.`);
  }
  for (const [key, reason] of Object.entries(parsed.entries)) {
    if (typeof reason !== 'string' || reason.trim().length < 12) {
      console.error(
        `\n❌ ${target.dir}/${LEDGER_NAME}: entry \`${key}\` carries no usable reason.\n\n` +
          `   Every entry is debt with a name on it. A ledger of bare keys is a silencer;\n` +
          `   a ledger of reasons is a worklist. Say why this site cannot be bound yet, and\n` +
          `   name the issue that will close it.`,
      );
      process.exit(1);
    }
  }
  return parsed;
}

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * Verify the detector still detects what it exists to detect, in BOTH
 * directions. A false negative makes the gate dormant (green forever, which is
 * indistinguishable from "clean"); a false positive makes it noise that someone
 * routes around — and here the false positive has a specific victim, because the
 * pressure it creates is "replace this correct generic with a concrete type".
 *
 * Compiled from a temp fixture that mirrors the real emitted shape (a class with
 * nested type-literal namespaces), so it exercises the walk and not just the
 * predicate.
 */
function selfTest(): never {
  const fail = (msg: string): never => {
    console.error(`✗ self-test: ${msg}`);
    process.exit(1);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exported-any-returns-'));
  const fixture = path.join(dir, 'fixture.d.ts');
  fs.writeFileSync(
    fixture,
    `export interface Row { id: string }\n` +
      `export interface Paginated<T = any> { items: T[] }\n` +
      `export declare class Client {\n` +
      // FLAGGED — the erasure this gate exists for, in both spellings.
      `  erased(): Promise<any>;\n` +
      `  erasedSync(): any;\n` +
      // NOT FLAGGED — caller-supplied generics. The whole #11929 distinction.
      `  generic<T = any>(): Promise<T>;\n` +
      `  genericWrapped<T = any>(): Promise<Paginated<T>>;\n` +
      `  genericArray<T = any>(): Promise<T[]>;\n` +
      // NOT FLAGGED — merely `any`-CONTAINING, the line the SCOPE note draws.
      `  loose(): Promise<Record<string, any>>;\n` +
      `  looseArray(): Promise<any[]>;\n` +
      `  precise(): Promise<Row>;\n` +
      // The namespacing idiom: the walk must descend a type literal…
      `  ns: {\n` +
      `    nested(): Promise<any>;\n` +
      `    deep: { deeper(): Promise<any> };\n` +
      `    fine(): Promise<Row>;\n` +
      `  };\n` +
      // …and must NOT descend a named data type held as a property.
      `  page: Paginated<Row>;\n` +
      `}\n` +
      `export declare function bare(): Promise<any>;\n`,
    'utf8',
  );

  try {
    const program = makeProgram([fixture]);
    const syntactic = program.getSyntacticDiagnostics();
    if (syntactic.length > 0) {
      fail(`fixture does not parse: ${ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ')}`);
    }

    const { callables, generics, anyReturns } = scan(program, fixture);

    // Anti-vacuity floor, enumerated rather than estimated — the first draft of
    // this line said 11 by miscounting the `ns` namespace, and a count assertion
    // that is merely plausible is worth nothing. The fixture declares 12:
    // `erased`, `erasedSync`, `generic`, `genericWrapped`, `genericArray`,
    // `loose`, `looseArray`, `precise` on the class (8); `ns.nested`, `ns.fine`,
    // `ns.deep.deeper` through the type-literal namespaces (3); `bare` at module
    // level (1). Three carry type parameters. A LOWER count means the walk is not
    // reaching the surface, which would make every assertion below pass for the
    // wrong reason — the exact way a gate goes dormant while reading green.
    if (callables !== 12) fail(`reached ${callables} callables, expected 12 — the WALK is not seeing the surface`);
    if (generics !== 3) fail(`saw ${generics} generic signatures, expected 3 — type parameters are not resolving`);

    for (const key of ['Client.erased', 'Client.erasedSync', 'Client.ns.nested', 'Client.ns.deep.deeper', 'bare']) {
      if (!anyReturns.has(key)) fail(`missed \`${key}\` — this gate is DORMANT`);
    }
    for (const key of [
      'Client.generic',
      'Client.genericWrapped',
      'Client.genericArray',
      'Client.loose',
      'Client.looseArray',
      'Client.precise',
      'Client.ns.fine',
    ]) {
      if (anyReturns.has(key)) {
        fail(
          `false positive on \`${key}\` — only a callable whose AWAITED return type IS \`any\` may be ` +
            `flagged. A caller-supplied generic is not erasure (#11929), and an \`any\`-CONTAINING type is a ` +
            `different question`,
        );
      }
    }
    // The walk must not wander into a named data type held as a property.
    for (const key of anyReturns.keys()) {
      if (key.startsWith('Client.page')) fail(`walked into the named data type at \`${key}\``);
    }

    // Ledger semantics, both directions.
    const found = new Map([['a.b', 'detail']]);
    const clean = judge({ entries: { 'a.b': 'reason' } }, found);
    if (clean.unledgered.length !== 0 || clean.stale.length !== 0) fail('a ledgered, still-`any` site must be green');
    const grew = judge({ entries: {} }, found);
    if (grew.unledgered.length !== 1) fail('an UNLEDGERED `any` return must be red — this is the 52nd site');
    const graduated = judge({ entries: { 'a.b': 'reason', 'c.d': 'reason' } }, found);
    if (graduated.stale.length !== 1) fail('a ledgered site that no longer resolves to `any` must be red until the entry is deleted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    '✅  self-test: flags awaited-`any` returns through nested namespaces, and NOT caller-supplied generics, ' +
      '`any`-containing types, or named data properties. Ledger is exact in both directions.',
  );
  process.exit(0);
}

// ── Entry point ─────────────────────────────────────────────────────────────
//
// Both modes live behind the guard: `--self-test` calls `process.exit` too, so
// running it on import would be the same defect wearing a friendlier name.
if (isEntrypoint(import.meta.url)) {
  if (SELF_TEST) selfTest();

  const target = resolveTarget();

  // ── Audit ───────────────────────────────────────────────────────────────────

  // BEFORE a single declaration is read. The existing floors — the self-test's
  // count assertions, and the "could not resolve the module symbol … Is the
  // package built?" throw in `scan` — cover a BROKEN DETECTOR and a MISSING dist.
  // Neither can see the case this refuses: a dist that is present and resolves
  // fine but predates the edit under test. There the audit runs to completion and
  // prints a green verdict about a build nobody made, on exactly the method the
  // developer just wrote (#7122, #4690).
  //
  // The freshness RULE is imported rather than re-derived: `distIsStale` is the
  // one shared notion of "is this package's dist current", already read by
  // `check-regen-pending.mjs`'s own callers and by
  // `packages/spec/scripts/lib/dist-freshness.ts`. A second copy drifts, and the
  // direction it drifts in is the one that believes a stale dist. The refusal TEXT
  // is local because the remedy is: `dist-freshness.ts` lives inside
  // `packages/spec` and a root-level gate depending on a package's private script
  // module would invert the layering this repo already has the right way round.
  if (distIsStale(target.abs)) {
    const hasDts = fs.existsSync(path.join(target.abs, 'dist'))
      && fs.readdirSync(path.join(target.abs, 'dist')).some((n) => n.endsWith('.d.ts'));
    console.error(
      `\n❌ ${target.dir}/dist ${
        hasDts
          ? `holds .d.ts declarations OLDER than ${target.dir}/src — they predate the sources.`
          : 'holds no .d.ts declarations — the package is not built (or was built with\n   OS_SKIP_DTS=1, which emits JS and skips exactly the artifact this reads).'
      }\n\n` +
        `   A verdict now would be computed against a build that no longer matches src, so this\n` +
        `   check would reach its conclusion without ever reading the declarations under test —\n` +
        `   a FALSE GREEN on exactly the change it exists to catch (#7122, #4690).\n\n` +
        `   Build first, then re-run:\n\n` +
        `     pnpm --filter ${target.name} build\n` +
        `     pnpm --filter ${target.name} check:exported-any-returns\n\n` +
        `   (Do NOT use OS_SKIP_DTS=1 for this one — it emits JS and skips the declarations this reads.)`,
    );
    process.exit(1);
  }

  const entryDts = ((): string => {
    const pkg = JSON.parse(fs.readFileSync(path.join(target.abs, 'package.json'), 'utf8'));
    const dts = pkg.exports?.['.']?.types ?? pkg.types;
    if (typeof dts !== 'string' || !dts.endsWith('.d.ts')) {
      throw new Error(
        `check-exported-any-returns: ${target.dir}/package.json declares no root \`.d.ts\` entry to read.`,
      );
    }
    return path.resolve(target.abs, dts);
  })();

  const ledger = readLedger(target);
  const { callables, generics, anyReturns } = scan(makeProgram([entryDts]), entryDts);
  const { unledgered, stale } = judge(ledger, anyReturns);

  if (unledgered.length === 0 && stale.length === 0) {
    console.log(
      `✅  no NEW exported callable of ${target.name} resolves to \`any\`: ${callables} callables reached ` +
        `(${generics} caller-supplied generics, not counted as erasure), ` +
        `${anyReturns.size} ledgered site(s) still open.`,
    );
    process.exit(0);
  }

  if (unledgered.length > 0) {
    console.error(
      `\n❌  ${unledgered.length} exported callable(s) of ${target.name} resolve to \`any\` and are not ledgered:\n`,
    );
    for (const v of unledgered) console.error(`    • ${v.detail}`);
    console.error(
      `\nThis is the 52nd site — #8140 bound 51 of them by hand and this gate exists so the next one\n` +
        `cannot land silently. The erasure is invisible in source when the method has NO return\n` +
        `annotation and takes its type from \`unwrapResponse<any>\` (#11925), which is why the check\n` +
        `reads the built declaration instead of the text.\n\n` +
        `FIX, don't declare: annotate the method with the contract type the route actually answers.\n` +
        `Mind the envelope — a route answering \`sendOk(res, { tables })\` gives the caller\n` +
        `\`{ tables: RemoteTable[] }\`, NOT \`RemoteTable[]\`, and against \`any\` the obvious-but-wrong\n` +
        `binding typechecks. \`packages/client/src/return-type-precision.test.ts\` is where the pin goes.\n\n` +
        `If no contract exists to bind yet, add the site to ${target.dir}/${LEDGER_NAME} with a written\n` +
        `reason and the issue that will close it. ⛔ MAINTAINER-ONLY: that path EXPANDS a shrink-only\n` +
        `ratchet, and it is a visible line in the diff for the same reason every other DEBT entry is.`,
    );
  }

  if (stale.length > 0) {
    console.error(`\n❌  ${stale.length} stale ${LEDGER_NAME} entr(y/ies) — the gap is closed, delete the entry:\n`);
    for (const key of stale) console.error(`    • ${key} — no longer resolves to \`any\` (reason on file: ${ledger.entries[key]})`);
    console.error(
      `\nThe ledger is shrink-only and judged EXACTLY. A stale entry stays available to cover the NEXT\n` +
        `regression under the last one's reason, which is how a ratchet quietly stops ratcheting.`,
    );
  }

  process.exit(1);

}
