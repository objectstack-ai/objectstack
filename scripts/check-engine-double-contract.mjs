#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-engine-double-contract -- a fake ObjectQL engine's `delete` must be
// pinned to the real engine's dispatch contract, not a looser hand-written
// approximation of it (objectstack#4550, from objectstack#4434).
//
//   node scripts/check-engine-double-contract.mjs
//   node scripts/check-engine-double-contract.mjs --self-test
//
// ## The failure mode this exists for
//
// `DELETE /api/v1/sharing/rules/:idOrName` answered **500 for every rule and
// both address forms** from the day it was written. It was not untested:
// plugin-sharing's `deleteRule drops rule + all its grants` asserted success on
// it the whole time -- against a FAKE ENGINE whose `delete` accepted a call the
// real engine refuses. `deleteRule` purged `sys_record_share` with a
// predicate-shaped delete carrying neither a scalar `where.id` nor
// `options.multi`, which is precisely the one shape `ObjectQL.delete` throws
// on. The fake deleted by predicate happily, so the suite was green, the gate
// was green, and the route was dead. That is #4434.
//
// The general shape, and the reason this is a gate rather than a fixed test:
// **a test double looser than the implementation it replaces converts a green
// suite into no suite at all**, silently, on exactly the paths a double was
// introduced for -- which are the paths that were hard to test, which are
// usually the paths where the contract is densest.
//
// ## Slice: `delete` dispatch only, and only on ENGINE doubles
//
// #4550 lists four instances of the family. This gate takes exactly one of
// them, the one whose criterion is mechanically decidable with no judgment
// call: the engine's delete dispatch is a total function from an options bag to
// one of three verdicts, so "is this double looser?" has a yes/no answer that
// does not depend on reading the test's intent.
//
// Deliberately NOT covered, and why (each wants its own gate, not a vaguer
// version of this one -- a gate whose scope is fuzzy is indistinguishable from
// no gate to everyone downstream of it):
//
//   - fixtures that disable a platform constraint in prose (`// FK enforcement
//     is off in this harness`, #4441). The criterion is a comment, so it is
//     both evadable by deleting the comment and unable to find the silent
//     cases. That one wants a declared debt ledger, not a scanner.
//   - stubbing the very thing under assertion (objectui#3129) and missing
//     counterparts (objectui#3134). Both live in the `objectui` repo, which
//     this script cannot see, and #3134 names no double at all.
//   - every other method a fake engine offers (`find` filter semantics,
//     `update`'s twin dispatch, unknown-option rejection). Same family, but
//     each needs its own producer-side predicate extracted first. `delete` had
//     one available because #4434 already paid for it.
//
// ## Invariants
//
//   DISCOVERED  the scan found engine doubles at all. Zero is not "a clean
//               repo", it is a broken scan: PINNED iterates the discovered set,
//               so a discovery that silently stops matching makes this script
//               print OK while checking nothing -- the #4868 family, where a
//               check runs, is green, and structurally cannot reach its subject.
//   PINNED      every discovered engine double's `delete` routes through
//               `assertEngineDeleteDispatch` / `resolveEngineDeleteDispatch`
//               from `@objectstack/objectql` -- the predicate the real
//               `ObjectQL.delete` itself uses -- or its file carries a measured
//               baseline entry.
//   RECONCILED  in both directions. A baseline entry for a file with no
//               unguarded doubles left, for a file that no longer exists, or
//               whose count is now lower, is an error. A ratchet that can only
//               accrete rots into a list nobody trusts.
//
// ## Why "routes through the shared predicate" and not "mirrors the guard"
//
// The #4434 fix mirrored the engine's guard into that one fake by hand. That
// closes one fake and opens a second copy of the contract -- and the scalar
// test is the half a hand-written copy drops: `where: { id: { $in: [...] } }`
// LOOKS like an id and is a multi-row predicate, so the real engine rejects it
// without `multi` and a mirrored `if (!opts?.where?.id && !opts?.multi)` accepts
// it. Requiring the producer's own function removes the class: a double that
// imports the decision cannot be looser than the decision. Same reasoning as
// objectstack#4455 -- the scan and the validator must answer with ONE predicate.
//
// ## What this deliberately does NOT claim
//
// It checks that the shared predicate is CALLED, not that the double's by-id
// and multi branches then behave like the driver would. A gate cannot judge
// that, and one that pretended to would be the verifier that reports success
// while degrading. What it can do is make the rejection surface impossible to
// drift, which is the half that shipped #4434.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'engine-double-contract.baseline.json');
const SCAN_ROOTS = ['packages', 'examples'];

/** The producer-side predicate a double must route through. */
const PINNED_SYMBOLS = new Set(['assertEngineDeleteDispatch', 'resolveEngineDeleteDispatch']);
/** Where it may legitimately come from: the public export, or objectql's own relative path. */
const PINNED_MODULES = [/^@objectstack\/objectql$/, /engine-delete-dispatch(\.js)?$/];

/**
 * Members that mark an object literal as standing in for the ENGINE.
 *
 * The engine and the driver both have `delete`, so the sibling set is what
 * separates them alongside the parameter test below: drivers speak
 * `create`/`bulkCreate`/`checkHealth`, the engine speaks `insert`/`findOne`.
 */
const ENGINE_SIBLINGS = new Set([
  'find', 'findOne', 'insert', 'update', 'count', 'aggregate', 'getSchema', 'registry', 'insertMany',
]);

/** Parameter names that mean "this is the DRIVER's delete(object, id, options)". */
const ID_PARAM = /^_*(id|recordId|ids|pk)$/i;

/**
 * Members present on `IDataDriver` and on NEITHER `IDataEngine` nor the ObjectQL
 * class — so declaring one is positive evidence of the DRIVER contract.
 *
 * Consulted only when the parameter test cannot answer (see `isEngineDeleteShape`).
 * Deliberately excludes every name both contracts share — `find`, `findOne`,
 * `update`, `count`, `delete` and `execute` (the engine declares `execute?` too,
 * `data-engine.ts`) — because a name on both sides separates nothing.
 */
const DRIVER_ONLY_MEMBERS = new Set([
  'connect', 'disconnect', 'checkHealth', 'getPoolStats', 'create', 'upsert',
  'bulkCreate', 'bulkUpdate', 'bulkDelete', 'updateMany', 'deleteMany',
  'beginTransaction', 'commit', 'rollback', 'syncSchema', 'syncSchemasBatch',
  'registerExternalObject', 'getSchemaSyncStats', 'dropTable', 'reclaimSpace',
  'explain', 'temporalFilterValue', 'temporalFilterColumnSql',
]);

/**
 * The engine-side half of the same evidence: on `IDataEngine` (`insert`,
 * `aggregate`) or on the ObjectQL class itself (`getSchema`, `registry`,
 * `insertMany`), and absent from `IDataDriver`.
 *
 * A subset of ENGINE_SIBLINGS, and the distinction is the whole point: `find` /
 * `findOne` / `update` / `count` are engine siblings for DISCOVERY (they mark a
 * data-access object) while being useless for ATTRIBUTION (drivers speak all
 * four). Only the names here answer "engine, not driver".
 */
const ENGINE_ONLY_MEMBERS = new Set(['insert', 'insertMany', 'aggregate', 'getSchema', 'registry']);

// ── Discovery ───────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === '.cache') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.(ts|tsx|mts)$/.test(e.name)) out.push(p);
  }
  return out;
}

function testFiles() {
  const out = [];
  for (const r of SCAN_ROOTS) walk(join(ROOT, r), out);
  return out.sort();
}

/** A member's function-ish implementation, or null. */
function implOf(member) {
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) return member;
  if (ts.isPropertyAssignment(member)) {
    const init = member.initializer;
    if (init && (ts.isFunctionExpression(init) || ts.isArrowFunction(init))) return init;
    return null;
  }
  if (ts.isPropertyDeclaration(member) && member.initializer) {
    const init = member.initializer;
    if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) return init;
    return null;
  }
  if (ts.isShorthandPropertyAssignment(member)) return null;
  return null;
}

function memberName(member) {
  const n = member.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

/**
 * Is this `delete(a, b, …)` the ENGINE's shape (`object, options`) rather than
 * the DRIVER's (`object, id, options`)?
 *
 * The second parameter is the whole question: the engine takes an options bag
 * there, the driver takes a primary key. Judged on the name first (the repo
 * writes `id` when it means one) and on a scalar type annotation second.
 *
 * ## When there IS no second parameter (#5629)
 *
 * A fake omits the parameters it ignores — `async delete() { return false; }` —
 * and this function used to open with `if (params.length < 2) return false`,
 * which discarded the double before any other test ran. Not "declared out of
 * scope": unreachable. Those deletes reached neither PINNED nor the ledger and
 * produced no output at all, which is the #4868 shape this script's own
 * DISCOVERED invariant is written against. Measured on this branch: 92 such
 * deletes behind that one line, 0 of them pinned.
 *
 * So when arity cannot answer, the SIBLING SET answers instead — and it has to
 * be a real test, not a waved-through `return true`. #5629's premise for a
 * blanket admit ("a zero-parameter delete cannot be the driver's, since the
 * driver's signature has a primary-key position") does not survive measurement:
 * fake DRIVERS drop their unused parameters exactly like fake engines do, so 43
 * of those 92 are driver doubles — `spec/src/contracts/data-driver.test.ts`
 * itself, and `objectql/src/engine-aggregate-having.test.ts`'s self-described
 * "driver WITH native aggregate()". Admitting them unconditionally would have
 * pointed this gate at the wrong contract 43 times.
 *
 * The evidence that does separate them is which members the object declares
 * ALONGSIDE delete: it must show a member only the engine has, and none that
 * only the driver has. Both halves are load-bearing — `aggregate` alone admits
 * the native-aggregate driver above, and "no driver members" alone admits any
 * `{ find, findOne, update, delete }` store mock that is neither contract.
 */
function isEngineDeleteShape(fn, memberNames = new Set()) {
  const params = fn.parameters ?? [];
  if (params.length < 2) {
    let engineEvidence = false;
    for (const n of memberNames) {
      if (DRIVER_ONLY_MEMBERS.has(n)) return false;
      if (ENGINE_ONLY_MEMBERS.has(n)) engineEvidence = true;
    }
    return engineEvidence;
  }
  const second = params[1];
  const name = ts.isIdentifier(second.name) ? second.name.text : '';
  if (ID_PARAM.test(name)) return false;
  const t = second.type ? second.type.getText() : '';
  if (/^(string|number|bigint|string \| number)$/.test(t.trim())) return false;
  return true;
}

/** Collect every identifier that is CALLED anywhere inside `node`. */
function calleesIn(node) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) names.add(e.text);
      else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) names.add(e.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/**
 * LOCAL names in this file that are bound to one of the pinned predicates by an
 * import from the producer.
 *
 * Keyed on the local binding (so `import { assertEngineDeleteDispatch as guard }`
 * still counts) but only when the IMPORTED name is one of the pinned symbols —
 * a same-named local look-alike must not qualify, since the whole property is
 * that one predicate answers.
 */
function pinnedImportsOf(sourceFile) {
  const found = new Set();
  for (const st of sourceFile.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!PINNED_MODULES.some((re) => re.test(spec))) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (PINNED_SYMBOLS.has(imported)) found.add(el.name.text);
      }
    }
  }
  return found;
}

/** Top-level function declarations / const-arrow functions, by name. */
function localFunctions(sourceFile) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) map.set(n.name.text, n);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer
          && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          map.set(d.name.text, d.initializer);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return map;
}

/**
 * Every engine double in one file, with a verdict on whether its `delete` is
 * pinned to the shared predicate.
 *
 * Pinning is accepted one level of indirection deep: a fake that opens with a
 * local `assertDeletable(opts)` helper which itself calls the shared predicate
 * is pinned. Two hops is not — at that point the gate would be guessing.
 */
function scanSource(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pinnedNames = pinnedImportsOf(sf);
  const locals = localFunctions(sf);
  const doubles = [];

  const bodyIsPinned = (fn) => {
    if (pinnedNames.size === 0) return false;
    const direct = calleesIn(fn);
    for (const n of direct) if (pinnedNames.has(n)) return true;
    for (const n of direct) {
      const local = locals.get(n);
      if (!local) continue;
      for (const m of calleesIn(local)) if (pinnedNames.has(m)) return true;
    }
    return false;
  };

  const consider = (members, node) => {
    const names = new Set();
    let del = null;
    for (const m of members) {
      const n = memberName(m);
      if (!n) continue;
      names.add(n);
      if (n === 'delete') del = implOf(m);
    }
    if (!del) return;
    const siblings = [...names].filter((n) => ENGINE_SIBLINGS.has(n));
    if (siblings.length < 2) return;
    if (!isEngineDeleteShape(del, names)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    doubles.push({ line, siblings: siblings.sort(), pinned: bodyIsPinned(del) });
  };

  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) consider(n.properties, n);
    else if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) consider(n.members, n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return doubles;
}

// ── Baseline ────────────────────────────────────────────────────────────────

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { entries: [] };
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

// ── Audit ───────────────────────────────────────────────────────────────────

function audit() {
  const baseline = readBaseline();
  const byFile = new Map(baseline.entries.map((e) => [e.file, e]));
  const errors = [];
  const found = [];

  for (const abs of testFiles()) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    const text = readFileSync(abs, 'utf8');
    // Cheap pre-filter: no `delete` member, nothing to parse.
    if (!/\bdelete\s*[(:]/.test(text)) continue;
    const doubles = scanSource(abs, text);
    if (doubles.length === 0) continue;
    found.push({ file: rel, doubles });
  }

  // DISCOVERED
  if (found.length === 0) {
    errors.push(
      'DISCOVERED: the scan found no engine doubles anywhere. That is not a clean repo, it is a '
        + 'broken scan — PINNED iterates this set, so every other invariant passes vacuously and '
        + 'this script reports OK while reading nothing. Fix the discovery before trusting a green run.',
    );
  }

  const seen = new Set();
  for (const { file, doubles } of found) {
    const unguarded = doubles.filter((d) => !d.pinned);
    const entry = byFile.get(file);
    if (entry) seen.add(file);

    if (unguarded.length === 0) {
      if (entry) {
        errors.push(
          `RECONCILED: ${file} has no unguarded engine double left, but the baseline still `
            + `records ${entry.unguarded}. Delete the entry in the same PR that fixed it.`,
        );
      }
      continue;
    }
    if (!entry) {
      errors.push(
        `PINNED: ${file} declares ${unguarded.length} engine double(s) whose delete() does not route `
          + `through assertEngineDeleteDispatch (line${unguarded.length > 1 ? 's' : ''} `
          + `${unguarded.map((d) => d.line).join(', ')}). A fake looser than ObjectQL.delete is how `
          + '#4434 shipped a dead REST route with its suite green. Open the fake\'s delete with '
          + "`assertEngineDeleteDispatch(options)` from '@objectstack/objectql' (add it as a "
          + 'devDependency if the package lacks it), or add a MEASURED entry to '
          + 'scripts/engine-double-contract.baseline.json saying why not.',
      );
      continue;
    }
    if (unguarded.length > entry.unguarded) {
      errors.push(
        `PINNED: ${file} now has ${unguarded.length} unguarded engine double(s), baseline records `
          + `${entry.unguarded}. The baseline is shrink-only — pin the new one rather than raising it.`,
      );
    } else if (unguarded.length < entry.unguarded) {
      errors.push(
        `RECONCILED: ${file} is down to ${unguarded.length} unguarded engine double(s) from the `
          + `baseline's ${entry.unguarded}. Lower the number in the same PR, so the ratchet holds.`,
      );
    }
  }

  for (const entry of baseline.entries) {
    if (seen.has(entry.file)) continue;
    errors.push(
      `RECONCILED: baseline entry for ${entry.file}, which declares no engine double any more `
        + '(file deleted, fake removed, or the shape changed). Delete the entry.',
    );
  }

  return { found, baseline, errors };
}

function report() {
  const { found, baseline, errors } = audit();
  const doubles = found.reduce((n, f) => n + f.doubles.length, 0);
  const pinned = found.reduce((n, f) => n + f.doubles.filter((d) => d.pinned).length, 0);

  console.log(
    `\nengine doubles: ${doubles} in ${found.length} test file(s) — ${pinned} pinned to `
      + `ObjectQL.delete's dispatch predicate, ${doubles - pinned} in the shrink-only baseline.\n`,
  );

  if (errors.length) {
    for (const e of errors) console.error(`  x ${e}`);
    console.error(`\ncheck-engine-double-contract: ${errors.length} problem(s).\n`);
    process.exit(1);
  }

  for (const f of found.filter((f) => f.doubles.some((d) => d.pinned))) {
    console.log(`  pinned  ${f.file}`);
  }

  // Print the EXEMPT reasons, not only the count. An entry whose justification
  // is never surfaced is how a ledger decays into a list nobody reads — and
  // these rows are part of why this run is green.
  const exempt = baseline.entries.filter((e) => e.kind === 'EXEMPT');
  if (exempt.length) console.log('');
  for (const e of exempt) {
    console.log(`  EXEMPT  ${e.file}`);
    console.log(`          ${e.why}`);
  }
  console.log('');
  const debt = baseline.entries.filter((e) => e.kind !== 'EXEMPT').length;
  console.log(
    `check-engine-double-contract: OK — ${pinned} pinned, ${debt} in the DEBT ledger, `
      + `${exempt.length} exempt.\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard (#4118). This drives the detector
// against synthetic sources on BOTH sides of every decision it makes, so a
// refactor that neuters it fails here instead of turning every future PR green.

function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };

  const IMPORT = "import { assertEngineDeleteDispatch } from '@objectstack/objectql';\n";
  const engineFake = (deleteBody, header = '') => `${header}
function makeEngine() {
  return {
    async find(o: string, opts?: any) { return []; },
    async insert(o: string, data: any) { return data; },
    async update(o: string, d: any) { return d; },
    async delete(o: string, opts?: any) { ${deleteBody} },
  };
}
`;

  // ── Detection: an unpinned engine fake is found, a pinned one is not flagged.
  let d = scanSource('a.test.ts', engineFake('return { ok: true };'));
  expect('finds an unpinned engine double', d.length === 1 && d[0].pinned === false);

  d = scanSource('a.test.ts', engineFake('assertEngineDeleteDispatch(opts); return { ok: true };', IMPORT));
  expect('a directly pinned double is not flagged', d.length === 1 && d[0].pinned === true);

  // One level of indirection through a local helper counts; the helper must
  // itself reach the shared predicate.
  d = scanSource('a.test.ts', engineFake('assertDeletable(opts); return 1;',
    IMPORT + 'function assertDeletable(o: any) { assertEngineDeleteDispatch(o); }\n'));
  expect('a local helper that calls the predicate counts as pinned', d.length === 1 && d[0].pinned === true);

  d = scanSource('a.test.ts', engineFake('assertDeletable(opts); return 1;',
    IMPORT + 'function assertDeletable(o: any) { if (!o?.where?.id && !o?.multi) throw new Error("x"); }\n'));
  expect('a HAND-MIRRORED local helper does not count as pinned',
    d.length === 1 && d[0].pinned === false);

  // Importing the symbol without calling it is not pinning — the #4434 fake
  // would have passed a check that only looked at imports.
  d = scanSource('a.test.ts', engineFake('return { ok: true };', IMPORT));
  expect('an unused import is not pinning', d.length === 1 && d[0].pinned === false);

  // ── Scope: the DRIVER's delete(object, id, options) is a different contract
  //    and must not be swept in, or the gate drowns in false positives.
  const driverFake = `
const driver = {
  async find(o: string) { return []; },
  async create(o: string, d: any) { return d; },
  async update(o: string, id: string, d: any) { return d; },
  async delete(object: string, id: string) { return true; },
};
`;
  expect('a driver double (delete by scalar id) is out of scope', scanSource('d.test.ts', driverFake).length === 0);

  const typedIdDriver = `
const driver = {
  async find(o: string) { return []; },
  async insert(o: string, d: any) { return d; },
  async delete(object: string, key: string) { return true; },
};
`;
  expect('a scalar-typed second parameter is out of scope',
    scanSource('d.test.ts', typedIdDriver).length === 0);

  // A lone `delete` with no engine siblings is a Map-ish or route helper.
  const bare = 'const cache = { delete(k: string, o: any) { return true; } };\n';
  expect('an object with no engine siblings is out of scope', scanSource('c.test.ts', bare).length === 0);

  // ── Shape coverage: the fake shapes this repo actually writes.
  const classFake = `${IMPORT}
class FakeEngine {
  async find(o: string, q?: any) { return []; }
  async insert(o: string, d: any) { return d; }
  async delete(o: string, opts?: any) { assertEngineDeleteDispatch(opts); return 1; }
}
`;
  d = scanSource('k.test.ts', classFake);
  expect('a class-shaped fake engine is in scope and pinnable', d.length === 1 && d[0].pinned === true);

  const arrowFake = `
const engine = {
  find: async (o: string) => [],
  insert: async (o: string, d: any) => d,
  update: async (o: string, d: any) => d,
  delete: async (o: string, opts: any) => ({ ok: true }),
};
`;
  d = scanSource('p.test.ts', arrowFake);
  expect('an arrow-property fake engine is in scope', d.length === 1 && d[0].pinned === false);

  // ── Arity: a fake omits the parameters it ignores (#5629).
  //
  // `async delete() { return false; }` is the commonest engine-double spelling
  // in this repo, and it used to leave the scan before any other test ran — 92
  // deletes, none of them pinned, none of them in the ledger, no output. These
  // cases drive both halves of the sibling evidence that admits them now,
  // because the obvious cheap fix (admit every short-arity delete) is WRONG:
  // fake drivers drop their unused parameters exactly like fake engines do.
  const zeroArityEngine = `
const engine = {
  async find(o: string) { return []; },
  async findOne(o: string) { return null; },
  async insert(o: string, d: any) { return d; },
  async update(o: string, d: any) { return d; },
  async delete() { return false; },
};
`;
  d = scanSource('z.test.ts', zeroArityEngine);
  expect('a zero-parameter engine delete is in scope', d.length === 1 && d[0].pinned === false);

  // Same shape, one parameter — `action-body-identity.test.ts`'s scoped facade.
  const oneArityEngine = `
const engine = {
  find: async (o: string) => [],
  insert: async (o: string, d: any) => d,
  update: async (o: string, d: any) => d,
  delete: async (opts?: any) => ({ ok: true }),
};
`;
  d = scanSource('y.test.ts', oneArityEngine);
  expect('a single-parameter engine delete is in scope', d.length === 1 && d[0].pinned === false);

  // A fake DRIVER with the same zero-parameter delete must stay out: driver-only
  // members veto. `spec/src/contracts/data-driver.test.ts` is this shape.
  const zeroArityDriver = `
const driver = {
  async find(o: string) { return []; },
  async findOne(o: string) { return null; },
  async update(o: string, id: string, d: any) { return d; },
  async create(o: string, d: any) { return d; },
  async checkHealth() { return true; },
  async delete() { return true; },
};
`;
  expect('a zero-parameter DRIVER delete stays out of scope',
    scanSource('zd.test.ts', zeroArityDriver).length === 0);

  // The veto has to outrank engine-looking evidence, or `engine-aggregate-
  // having.test.ts`'s self-described "driver WITH native aggregate()" is read as
  // an engine: drivers may implement `aggregate` for pushdown.
  const nativeAggregateDriver = `
const driver = {
  async find() { return []; },
  async count() { return 0; },
  async create(o: string, d: any) { return d; },
  async bulkCreate(o: string, rows: any[]) { return rows; },
  async aggregate(o: string, ast: any) { return []; },
  async delete() { return true; },
};
`;
  expect('a zero-parameter driver that implements aggregate() stays out of scope',
    scanSource('zn.test.ts', nativeAggregateDriver).length === 0);

  // And the positive half must be required too, or every `{ find, findOne,
  // update, delete }` store mock — neither contract — becomes a finding.
  const zeroArityStoreMock = `
const store = {
  async find(k: string) { return []; },
  async findOne(k: string) { return null; },
  async update(k: string, v: any) { return v; },
  async delete() { return true; },
};
`;
  expect('a zero-parameter mock with no engine-only member stays out of scope',
    scanSource('zs.test.ts', zeroArityStoreMock).length === 0);

  // The import must come from the producer. A same-named local function is not
  // the contract — the whole point is that ONE predicate answers.
  d = scanSource('q.test.ts', engineFake('assertEngineDeleteDispatch(opts); return 1;',
    'function assertEngineDeleteDispatch(o: any) { /* look-alike */ }\n'));
  expect('a locally re-declared look-alike is not pinning', d.length === 1 && d[0].pinned === false);

  d = scanSource('r.test.ts', engineFake('assertEngineDeleteDispatch(opts); return 1;',
    "import { assertEngineDeleteDispatch } from './my-helpers.js';\n"));
  expect('the predicate imported from an unrelated module is not pinning',
    d.length === 1 && d[0].pinned === false);

  // objectql's own tests import it by relative path; that IS the producer.
  d = scanSource('s.test.ts', engineFake('assertEngineDeleteDispatch(opts); return 1;',
    "import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';\n"));
  expect("objectql's relative import of the producer counts", d.length === 1 && d[0].pinned === true);

  expect('a file with no fakes yields no doubles',
    scanSource('empty.test.ts', 'export const x = 1;\n').length === 0);

  // Discovery must reach the real tree, and specifically must reach the fake
  // #4434 was shipped past. Everything above is synthetic; this is the wiring.
  //
  // Deliberately NOT asserted here: that the real tree is clean, or that any
  // particular fake is pinned. That is the job of the run this self-test gates,
  // and duplicating it would make a genuine violation surface as a self-test
  // failure — the least legible message available.
  const { found } = audit();
  expect('discovers engine doubles in the real tree', found.length > 0);
  expect(
    'discovery reaches the #4434 fake',
    found.some((f) => f.file === 'packages/plugins/plugin-sharing/src/sharing-rule.test.ts'),
  );

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-engine-double-contract --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: separates engine doubles from driver doubles, admits a delete that declares '
      + 'fewer than two parameters only on engine-vs-driver sibling evidence, accepts only the '
      + 'producer\'s predicate (direct or one helper deep), rejects unused imports, hand-mirrored '
      + 'guards and look-alikes, and proves discovery reaches the real tree.',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else report();
