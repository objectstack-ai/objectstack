#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-verify-stand-in-erasure -- the ESLint guard on `@objectstack/verify`'s
// structural stand-ins is guarding the real call sites, and its guarded set is
// still the whole set (#6399).
//
//   node scripts/check-verify-stand-in-erasure.mjs
//   node scripts/check-verify-stand-in-erasure.mjs --self-test
//
// ## What this exists for
//
// `verify-stand-in/no-asserted-driver-argument` (eslint.config.mjs) blocks a
// type assertion on the driver argument of `checkReadCoercion` /
// `checkDateBucketParity`. Those helpers take their driver STRUCTURALLY, so the
// parameter type is the compile-time half of the conformance they run; an
// assertion deletes it for that call site. #6354 / PR #6396 found ten such
// casts -- every call site of both helpers -- all dead, over a check that was
// provably alive, with no gate on either fact.
//
// A rule alone does not lock that. `pnpm lint` is green three ways:
//
//   - the tree is clean                     <- the state worth having
//   - the helpers were renamed or moved     <- rule matches nothing, silently
//   - a THIRD stand-in check was added      <- unguarded from birth
//
// Only the first is the point, and lint cannot tell them apart: a rule keyed on
// a hand-written list of names reports nothing in all three cases. That is the
// dead-pin shape this repo has already paid for twice (#4984's fixtures spelled
// a rejected alias and kept the tests green while the rule was dead; #5018's
// pin had inverted without anyone noticing). So the guarded set is not trusted
// as a list -- it is reconciled, in both directions, against what
// `packages/verify/src` actually exports, and the call sites are COUNTED so
// "no violations" can never mean "nothing was looked at".
//
// ## Invariants
//
//   DISCOVERED  at least one stand-in check was found in packages/verify/src.
//               A stand-in check is an exported function whose parameter 0 is
//               annotated with an interface that is declared in that package
//               AND re-exported as a type from its index. Zero is not "no
//               stand-ins", it is a broken scan -- the other invariants iterate
//               the discovered set, so they would all pass vacuously while this
//               script printed OK.
//
//   CLASSIFIED  the discovered set and VERIFY_STAND_IN_CHECKS (eslint.config.mjs)
//               name the same helpers, and agree on each one's stand-in type.
//               Both directions: a new check nobody added to the rule fails
//               here rather than shipping unguarded, and an entry for a helper
//               that no longer exists fails rather than rotting into a list
//               that means nothing. This is the half that makes the eleventh
//               call site at a NEW helper ring.
//
//   REACHED     every guarded helper has at least one call site outside
//               packages/verify itself, and the census is printed. This is the
//               anti-vacuity floor: a rename, a re-export, or an `ignores` entry
//               that quietly took the call sites out of the rule's scope shows
//               up as a helper with zero reachable calls instead of as a green
//               run over nothing.
//
//   CLEAN       no call site asserts its driver argument. Re-derived here rather
//               than trusted from lint, so this script is a complete answer on
//               its own -- if the ESLint block is ever narrowed, weakened, or
//               dropped, this still fails. The two are deliberately redundant;
//               that redundancy is the point of writing it twice.
//
// The scan is syntactic (`ts.createSourceFile`, no type information). It reads
// annotations, not inferred types -- an indirection that launders the driver
// through a typed helper is out of reach here exactly as it is for the ESLint
// rule, and is stated in that rule's comment rather than implied.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { VERIFY_STAND_IN_CHECKS } from '../eslint.config.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY_SRC = join(REPO_ROOT, 'packages', 'verify', 'src');
const SCAN_ROOTS = ['packages', 'examples'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage']);
const SOURCE_RE = /\.(ts|tsx|mts|cts)$/;

// ScriptKind follows the EXTENSION, and that is not cosmetic: `<T>expr` is a
// type assertion in `.ts` and a JSX element in `.tsx`, so parsing everything as
// TSX silently loses the angle-bracket assertion spelling — one of the shapes
// this gate has to see.
const parse = (file, text) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(abs, out);
    } else if (e.isFile() && SOURCE_RE.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
  return out;
}

/** Type names `packages/verify/src/index.ts` re-exports (`export type { X } from …`). */
function exportedTypeNames(indexText) {
  const sf = parse('index.ts', indexText);
  const names = new Set();
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.exportClause) continue;
    if (!ts.isNamedExports(st.exportClause)) continue;
    const typeOnlyDeclaration = st.isTypeOnly;
    for (const spec of st.exportClause.elements) {
      if (typeOnlyDeclaration || spec.isTypeOnly) names.add(spec.name.text);
    }
  }
  return names;
}

/** The plain type-reference name of a parameter's annotation, or null. */
function annotationName(param) {
  const t = param?.type;
  if (!t || !ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return null;
  return t.typeName.text;
}

/**
 * Exported functions in `packages/verify/src` whose parameter 0 could be a
 * structural stand-in, as `name -> interfaceName`.
 *
 * Two conditions, both required. The interface must be DECLARED in the package
 * (so a parameter typed with an imported domain type is not mistaken for a
 * stand-in) and EXPORTED AS A TYPE from the index (so it is part of the
 * published surface an out-of-tree implementer builds against -- which is the
 * entire reason these parameters are structural instead of concrete).
 *
 * This is deliberately a CANDIDATE set, not a verdict. "Is this interface a
 * structural driver stand-in?" has no syntactic answer worth trusting:
 * `CoercibleDriver` is all methods but `BucketableDriver` also carries a
 * `supports` data property, so "all members are methods" is already wrong on
 * one of the two, and a name test (`/Driver$/`) is a convention a future
 * stand-in is free to spell differently -- silently. A heuristic that guesses
 * here IS the dead pin, one layer up. So every candidate must be classified by
 * a human exactly once: guarded (VERIFY_STAND_IN_CHECKS, eslint.config.mjs) or
 * exempt (NOT_A_STAND_IN below, with its reason). Unclassified fails the run.
 */
function discoverStandInChecks(files = null) {
  const sources =
    files ??
    walkFiles(VERIFY_SRC)
      .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
      .map((f) => ({ file: relative(REPO_ROOT, f), text: readFileSync(f, 'utf8') }));

  const indexEntry = sources.find((s) => s.file.endsWith('index.ts'));
  const publishedTypes = exportedTypeNames(indexEntry ? indexEntry.text : '');

  const declaredInterfaces = new Set();
  for (const { file, text } of sources) {
    const sf = parse(file, text);
    for (const st of sf.statements) {
      if (ts.isInterfaceDeclaration(st)) declaredInterfaces.add(st.name.text);
    }
  }

  const found = new Map();
  for (const { file, text } of sources) {
    const sf = parse(file, text);
    for (const st of sf.statements) {
      if (!ts.isFunctionDeclaration(st) || !st.name) continue;
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      const standIn = annotationName(st.parameters[0]);
      if (!standIn) continue;
      if (!declaredInterfaces.has(standIn) || !publishedTypes.has(standIn)) continue;
      found.set(st.name.text, standIn);
    }
  }
  return found;
}

/**
 * Candidates that are NOT structural driver stand-ins, each with the reason.
 *
 * The distinction is who implements the type. `CoercibleDriver` /
 * `BucketableDriver` exist so a driver NOT in this repo -- cloud's driver-turso
 * in remote mode -- can run the identical contract without importing a concrete
 * driver type; that is what makes an assertion on the argument a deletion of
 * the check. Everything below takes a value this package itself produced, so
 * there is no second implementer and nothing for a stand-in to stand in for.
 *
 * An entry here is a claim, and RECONCILED checks it in both directions: an
 * exemption for a function that is no longer a candidate fails the run, so this
 * list cannot quietly outlive what it describes.
 */
const NOT_A_STAND_IN = {
  runCrudVerification:
    'takes the `VerifyStack` that `bootStack` in this same package returned — a concrete handle, ' +
    'not a surface an out-of-tree implementer provides.',
  runRlsProofs: 'same `VerifyStack` handle as runCrudVerification.',
  provisionRlsProbePersona:
    'same `VerifyStack` handle as runCrudVerification — it MINTS the RBAC rows for the #7685 ' +
    'object-granted RLS probe persona through that stack, so there is no second implementer.',
  formatReport: 'formats a `VerifyReport` this package produced; presentation, not conformance.',
  formatRlsReport: 'formats an `RlsReport` this package produced; presentation, not conformance.',
  fillRelationalRefs:
    'takes one `CrudCase` derived by `deriveCrudCases` — a data record this package built, with no ' +
    'external implementer.',
};

/** True when `node` is, or wraps, any type assertion. Mirrors the ESLint rule. */
function isAsserted(node) {
  for (let cur = node; cur; cur = cur.expression) {
    if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) return true;
    if (ts.isNonNullExpression(cur)) continue;
    return false;
  }
  return false;
}

/** Call sites of `guarded` in one source, each with a verdict on its driver argument. */
function scanSource(file, text, guarded) {
  const sf = parse(file, text);
  const sites = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && guarded.has(n.expression.text)) {
      const driver = n.arguments[0];
      if (driver) {
        const { line } = sf.getLineAndCharacterOfPosition(driver.getStart(sf));
        sites.push({
          file,
          line: line + 1,
          helper: n.expression.text,
          asserted: isAsserted(driver),
          text: driver.getText(sf).split('\n')[0].slice(0, 100),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

/** Every call site of every guarded helper, repo-wide, excluding verify's own source. */
function census(guarded) {
  const sites = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const f of walkFiles(abs)) {
      const rel = relative(REPO_ROOT, f);
      // verify's own source holds the DECLARATIONS, not call sites worth
      // guarding; counting them would let the REACHED floor be satisfied by the
      // very file the helpers are defined in.
      if (rel.startsWith(join('packages', 'verify') + '/') || rel.startsWith('packages/verify/')) continue;
      const text = readFileSync(f, 'utf8');
      if (!guarded.some((g) => text.includes(g))) continue;
      sites.push(...scanSource(rel, text, new Set(guarded)));
    }
  }
  return sites;
}

function audit() {
  const candidates = discoverStandInChecks();
  const classified = new Map(Object.entries(VERIFY_STAND_IN_CHECKS));
  const exempt = new Map(Object.entries(NOT_A_STAND_IN));
  const problems = [];

  // DISCOVERED
  if (candidates.size === 0) {
    problems.push(
      'DISCOVERED: no candidate found in packages/verify/src. A candidate is an exported function whose\n' +
        '  parameter 0 names an interface declared in that package and re-exported as a type from its index.\n' +
        '  Zero means the scan broke, not that none exist — every check below iterates this set and would\n' +
        '  pass over nothing.',
    );
    return { guarded: candidates, sites: [], problems };
  }

  // CLASSIFIED, both directions, over both ledgers.
  for (const [name, standIn] of candidates) {
    const isGuarded = classified.has(name);
    const isExempt = exempt.has(name);
    if (isGuarded && isExempt) {
      problems.push(
        `CLASSIFIED: \`${name}\` is in BOTH VERIFY_STAND_IN_CHECKS and NOT_A_STAND_IN. Pick one.`,
      );
    } else if (!isGuarded && !isExempt) {
      problems.push(
        `CLASSIFIED: packages/verify exports \`${name}(x: ${standIn})\`, and nobody has said which it is.\n` +
          `  If \`${standIn}\` is a structural stand-in — a minimal surface an OUT-OF-TREE implementer\n` +
          `  satisfies, the way cloud's driver-turso satisfies BucketableDriver — add \`${name}\` to\n` +
          '  VERIFY_STAND_IN_CHECKS in eslint.config.mjs and the guard covers its call sites immediately.\n' +
          '  If it is a value this package produced (a stack handle, a report, a derived case), add it to\n' +
          '  NOT_A_STAND_IN in this script with the reason. Leaving it unclassified is the one option that\n' +
          '  ships an unguarded stand-in, which is exactly what #6399 exists to stop.',
      );
    } else if (isGuarded && classified.get(name) !== standIn) {
      problems.push(
        `CLASSIFIED: \`${name}\` takes \`${standIn}\` in packages/verify but VERIFY_STAND_IN_CHECKS records\n` +
          `  \`${classified.get(name)}\`. One of the two moved; make them agree.`,
      );
    }
  }
  for (const [name] of classified) {
    if (!candidates.has(name)) {
      problems.push(
        `RECONCILED: VERIFY_STAND_IN_CHECKS names \`${name}\`, which packages/verify no longer exports as a\n` +
          '  stand-in-taking function. The rule is now guarding a name nothing declares — drop the entry, or\n' +
          '  restore the helper. A guarded set that can only accrete stops meaning anything.',
      );
    }
  }
  for (const [name] of exempt) {
    if (!candidates.has(name)) {
      problems.push(
        `RECONCILED: NOT_A_STAND_IN exempts \`${name}\`, which is no longer a candidate in packages/verify.\n` +
          '  Drop the entry — an exemption that outlives what it describes is a claim nobody can check.',
      );
    }
  }

  const guarded = new Map([...candidates].filter(([n]) => classified.has(n)));
  const sites = census([...new Set([...guarded.keys(), ...classified.keys()])]);

  // REACHED
  for (const name of guarded.keys()) {
    if (!sites.some((s) => s.helper === name)) {
      problems.push(
        `REACHED: \`${name}\` has no call site outside packages/verify. Either the check is unused — in which\n` +
          '  case the guard on it proves nothing and the check itself wants a decision — or the call sites\n' +
          '  moved somewhere this scan does not walk. A guard over zero call sites is green for the wrong reason.',
      );
    }
  }

  // CLEAN
  for (const s of sites.filter((x) => x.asserted)) {
    problems.push(
      `CLEAN: ${s.file}:${s.line} asserts the driver argument of \`${s.helper}\` — \`${s.text}\`.\n` +
        '  That deletes the structural conformance this call was meant to run. Pass the driver unasserted;\n' +
        '  if it does not satisfy the stand-in, fix the driver or widen the stand-in in packages/verify/src.',
    );
  }

  return { guarded, sites, problems };
}

function report() {
  const { guarded, sites, problems } = audit();
  if (problems.length) {
    console.error(`\n✗ check-verify-stand-in-erasure: ${problems.length} problem(s).\n`);
    for (const p of problems) console.error(`  ${p}\n`);
    console.error(
      'Background: #6354 / PR #6396 removed ten `as never` casts — every call site of both helpers —\n' +
        'all of them dead, over a compile-time check that was provably alive. Nothing rang for either\n' +
        'fact, which is what #6399 locked.\n',
    );
    process.exit(1);
  }
  const per = [...guarded.keys()]
    .map((n) => `${n} (${sites.filter((s) => s.helper === n).length})`)
    .join(', ');
  console.log(
    `OK  check-verify-stand-in-erasure: ${guarded.size} stand-in check(s) guarded, ` +
      `${Object.keys(NOT_A_STAND_IN).length} candidate(s) explicitly exempt, ` +
      `${sites.length} call site(s) reached, 0 asserted driver arguments — ${per}.`,
  );
}

// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const expect = (label, ok) => {
    if (!ok) failures.push(label);
  };

  // --- CLEAN: the scan separates an asserted driver argument from a clean one.
  const guarded = new Set(['checkDateBucketParity', 'checkReadCoercion']);

  const clean = `
    import { checkDateBucketParity } from '@objectstack/verify';
    const problems = await checkDateBucketParity(driver, { createOptions: {} });
  `;
  expect(
    'a clean call site is not reported',
    scanSource('clean.test.ts', clean, guarded).filter((s) => s.asserted).length === 0,
  );
  expect(
    'a clean call site is still COUNTED (the anti-vacuity half)',
    scanSource('clean.test.ts', clean, guarded).length === 1,
  );

  // The exact shape PR #6396 removed, ten times over.
  const asNever = `
    import { checkDateBucketParity } from '@objectstack/verify';
    const problems = await checkDateBucketParity(brokenDriver() as never);
  `;
  const asNeverSites = scanSource('n.test.ts', asNever, guarded);
  expect(
    'the historical `as never` shape is reported, exactly once',
    asNeverSites.length === 1 && asNeverSites.filter((s) => s.asserted).length === 1,
  );

  // `as any` and the laundered chain are the same erasure wearing other words.
  for (const [label, src] of [
    ['as any', 'checkReadCoercion(raw as any);'],
    ['as unknown as StandIn', 'checkReadCoercion(raw as unknown as CoercibleDriver);'],
    ['angle-bracket assertion', 'checkReadCoercion(<CoercibleDriver>raw);'],
  ]) {
    const found = scanSource('a.ts', src, guarded);
    expect(`\`${label}\` on the driver argument is reported`, found.length === 1 && found[0].asserted);
  }

  // A non-null assertion is not an erasure — it re-labels nullability, not shape.
  expect(
    'a non-null assertion alone is not reported',
    scanSource('nn.ts', 'checkReadCoercion(raw!);', guarded).filter((s) => s.asserted).length === 0,
  );

  // Argument 1 is a different type with its own `unknown` slots — #6394's
  // subject, not this gate's. Asserting it must NOT be reported here.
  expect(
    'an assertion on the OPTIONS argument is out of scope',
    scanSource('o.ts', 'checkDateBucketParity(driver, { createOptions: {} } as never);', guarded)
      .filter((s) => s.asserted).length === 0,
  );

  // A same-named method call is a different function.
  expect(
    'a member-expression call of the same name is out of scope',
    scanSource('m.ts', 'suite.checkReadCoercion(raw as never);', guarded).length === 0,
  );

  // --- DISCOVERED: the shape test, on synthetic sources.
  const synthetic = [
    {
      file: 'index.ts',
      text:
        "export { checkThing } from './thing.js';\n" +
        "export type { ThingDriver } from './thing.js';\n" +
        "export { checkLedgerish } from './ledgerish.js';\n",
    },
    {
      file: 'thing.ts',
      text:
        'export interface ThingDriver { find(): Promise<unknown[]>; }\n' +
        'export async function checkThing(driver: ThingDriver): Promise<string[]> { return []; }\n',
    },
    {
      // Parameter 0 is a plain type this package does not declare — not a
      // stand-in, and must not be discovered as one.
      file: 'ledgerish.ts',
      text:
        "import type { Row } from '@objectstack/spec';\n" +
        'export async function checkLedgerish(rows: Row[]): Promise<string[]> { return []; }\n',
    },
    {
      // Declared and exported as a type, but the function is not exported.
      file: 'private.ts',
      text:
        'export interface PrivateDriver { find(): Promise<unknown[]>; }\n' +
        'async function checkPrivate(driver: PrivateDriver): Promise<string[]> { return []; }\n',
    },
  ];
  const synth = discoverStandInChecks(synthetic);
  expect(
    'discovery finds exactly the exported candidate',
    synth.size === 1 && synth.get('checkThing') === 'ThingDriver',
  );

  // An interface declared but NOT re-exported as a type from the index is not
  // a published stand-in — that re-export is what an out-of-tree driver
  // implements against, and is the line between "structural on purpose" and
  // "happens to take an interface".
  const unpublished = discoverStandInChecks([
    { file: 'index.ts', text: "export { checkThing } from './thing.js';\n" },
    {
      file: 'thing.ts',
      text:
        'export interface ThingDriver { find(): Promise<unknown[]>; }\n' +
        'export async function checkThing(driver: ThingDriver): Promise<string[]> { return []; }\n',
    },
  ]);
  expect('an unpublished stand-in type is not discovered', unpublished.size === 0);

  // --- Wiring: discovery must reach the REAL tree, and reach the two helpers
  // this gate was written for. Everything above is synthetic; without this the
  // whole script can be green while pointed at nothing.
  //
  // Deliberately NOT asserted here: that the real tree is clean, or that the
  // classified set matches. Those are the job of the run this self-test gates —
  // duplicating them would surface a genuine violation as a self-test failure,
  // the least legible message available.
  const real = discoverStandInChecks();
  expect('discovery reaches the real packages/verify tree', real.size > 0);
  for (const name of ['checkReadCoercion', 'checkDateBucketParity']) {
    expect(`discovery reaches \`${name}\``, real.has(name));
  }

  // Every classified name must still be a real candidate, and every real
  // candidate must be classified somewhere — asserted HERE as well as in the
  // run, because a ledger that has drifted makes the run's other invariants
  // iterate the wrong set.
  for (const name of Object.keys(VERIFY_STAND_IN_CHECKS)) {
    expect(`VERIFY_STAND_IN_CHECKS entry \`${name}\` is a real candidate`, real.has(name));
  }
  for (const name of Object.keys(NOT_A_STAND_IN)) {
    expect(`NOT_A_STAND_IN entry \`${name}\` is a real candidate`, real.has(name));
  }

  // The census must reach the REAL call sites, and reach enough of them to be
  // the thing PR #6396 measured. Ten is not a magic number: it is 8
  // `checkDateBucketParity` + 2 `checkReadCoercion`, the exact set that carried
  // an `as never` each. A census that silently fell to 3 (the count the filing
  // table guessed, having seen only the real-driver arms) would still be
  // non-zero, and the hand-written-fake arms — the ones that actually drift —
  // are precisely the seven it would have lost.
  const realSites = census([...real.keys()].filter((n) => n in VERIFY_STAND_IN_CHECKS));
  expect(
    `the census reaches the ten known call sites (found ${realSites.length})`,
    realSites.length >= 10,
  );

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-verify-stand-in-erasure --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: reports every assertion spelling on the driver argument (`as never`, `as any`, ' +
      'the `as unknown as StandIn` launder, the angle-bracket form) while leaving a clean call, a bare ' +
      'non-null assertion, the OPTIONS argument (#6394) and a same-named method call alone; counts a ' +
      'clean call site rather than skipping it; admits a candidate only when its interface is both ' +
      'declared in packages/verify and published as a type from its index; and proves discovery, both ' +
      'ledgers and the census reach the real tree — all ten known call sites of it.',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else report();
