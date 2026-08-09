#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-side tenant chokepoint guard (#6792, from #3724 / #6577).
 *
 * ## What it guards
 *
 * `SqlDriver.applyTenantScope()` is the single chokepoint for read-side tenant
 * isolation in the SQL driver: it owns the `tenantId` early-out, the
 * "object has no tenant field" early-out, the NULL-org platform-row rule
 * (#2734) and the ADR-0105 D2 union posture (#3623). A read door that builds
 * its own query and never arrives there is not "inconsistent" — it returns
 * other tenants' data to a caller that asked to be scoped.
 *
 * So: **a method that builds through `this.getBuilder(object, options)` and
 * lets that builder escape as a READ must call `this.applyTenantScope()` on
 * it.** Write builders are exempt and the exemption is structural, not a
 * name list — insert-side tenancy is a different mechanism
 * (`injectTenantOnInsert` stamps the column), so a builder whose only escape
 * is `.insert(...)` is correct without this call.
 *
 * ## Why the gate exists, and what it already caught
 *
 * The invariant was written down and never measured. `applyTenantScope`'s own
 * docstring claimed "every CRUD method routes through it" — false, for as long
 * as it had existed. Three doors built through `getBuilder` and never arrived:
 *
 *   - `findWithWindowFunctions()` — the documented #4286 window door. Returns
 *     ROWS. Measured on `main` at `6595262` with two tenants seeded,
 *     `tenantId: 'org_a'` returned `[a1, a2, b1, b2, p1]` here against
 *     `[a1, a2, p1]` through `find()`. Cross-tenant read exposure.
 *   - `analyzeQuery()` / `explain()` — returns a PLAN. Compiled
 *     `select * from account` where `find()` sent the `organization_id`
 *     predicate: an EXPLAIN for a statement nobody will run.
 *   - `distinct()` — returns one column's VALUES for every tenant. **This one
 *     was in no card.** #6792 asserts the opposite — that the 13 call sites
 *     include `distinct` — and both the triage comment and two rounds of PM
 *     measurement inherited that sentence without re-deriving it. The 13th
 *     read site is `aggregate()`. It was found by running this gate.
 *
 * That is the case for the gate in one line: two of the three doors were found
 * by a human reading the file, and the third was found by measuring. Nothing
 * obliged the next one to route through the chokepoint, which is exactly how
 * all three got out.
 *
 * ## Why the criterion is the BUILDER, not the signature
 *
 * #6792 sketches "every method taking `(object, …, options)` and returning
 * rows". That criterion is the intuitive one and it is measurably too narrow —
 * it misses two of the three real doors:
 *
 *   - `distinct(object, field, filters?, options?)` takes no `query` at all.
 *   - `analyzeQuery(): Promise<any>` does not return rows; it returns a plan,
 *     and its defect is that the plan describes an unscoped statement.
 *
 * Deciding "returns rows" from a return type needs dataflow the AST does not
 * carry, and `Promise<any>` is not a signal. The structural fact that actually
 * defines a door is that it BUILDS one — `getBuilder` is the single constructor
 * of every query this driver sends. So that is what is keyed on, and the check
 * is sound rather than heuristic: every builder is classified, and one that
 * cannot be classified is an error, never a default (#4690's family).
 *
 * ## Scope
 *
 * The `SqlDriver` family only — `driver-sql` plus the two subclasses that
 * inherit this chokepoint (`driver-sqlite-wasm`, `driver-turso`). Scanning the
 * subclasses is what stops a new door being added one layer down.
 *
 * `driver-memory` and `driver-mongodb` are outside it, and NOT because #5499
 * froze them: they do not use this mechanism at all. Neither file contains
 * `getBuilder` or `applyTenantScope` (mongodb enforces its own wall in
 * `mongodb-tenancy-guard.ts`, a different mechanism with a different shape).
 * There is therefore no verdict for this gate to force on a frozen driver and
 * no DEBT row to record — a real absence, stated rather than left to inference.
 *
 * ## What is NOT covered, named rather than implied
 *
 *   - A builder passed to a HELPER that applies the scope on the caller's
 *     behalf. The gate looks for `applyTenantScope(<binding>, …)` within the
 *     method; a helper indirection would read as unscoped and go red. That is
 *     the safe direction (it demands the call be visible where the door is),
 *     and if a helper is ever wanted the answer is an EXEMPT entry with a
 *     reason, not a looser rule.
 *   - Raw `this.knex(...)` construction that bypasses `getBuilder` entirely.
 *     Out of reach of this criterion by construction. Nothing in the family
 *     does it today on a read path; if that changes, this gate cannot see it,
 *     and the honest place to record that limit is here.
 *   - **WHERE the call sits.** This is the important one, and it is measured
 *     rather than assumed. The gate asserts the call EXISTS on that binding,
 *     never its position — so a call moved below `builder.toSQL()`, or below
 *     `await builder`, satisfies this gate while isolating nothing. Measured
 *     during #6792's reverse verification: with the scope call relocated after
 *     the statement was snapshotted and after the rows were fetched, this gate
 *     reported clean (19/19 bindings) while nine assertions in
 *     `sql-driver-tenant-scope-read-doors.test.ts` went red.
 *
 *     That is the division of labour, not a defect to fix here: making the
 *     gate position-aware would have it re-implement knex's evaluation order
 *     from the AST, and be wrong in a new way. **The gate proves the call is
 *     there; only the fixture proves it works.** Neither is redundant, and a
 *     change that keeps this green must still keep that file green.
 *
 *   node scripts/check-tenant-chokepoint.mjs [--self-test]
 *
 * Exit codes: 0 clean · 1 an unscoped read door · 2 the scan could not run
 * (no class found, a builder it cannot classify, or a DISCOVERED floor missed).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The `SqlDriver` family — every class that inherits this chokepoint. */
const SCAN_FILES = [
  join('packages', 'drivers', 'driver-sql', 'src', 'sql-driver.ts'),
  join('packages', 'drivers', 'driver-sqlite-wasm', 'src', 'sqlite-wasm-driver.ts'),
  join('packages', 'drivers', 'driver-turso', 'src', 'turso-driver.ts'),
];

/**
 * The floor a real scan must clear. A scan that silently stops matching reports
 * "clean" while reading nothing (#4690), and this gate's whole value is that it
 * is the only thing measuring the invariant. Set below today's count so
 * ordinary edits do not trip it, and high enough that a broken matcher does.
 */
const DISCOVERED_FLOOR = 15;

/**
 * `'<file>::<method>::<binding>'` -> reason a reader can check.
 *
 * Empty by design. #6792 closed the last three unscoped read doors, so this
 * starts from zero rather than from a ratchet. A new entry needs a reason,
 * not a name — and "the layer above catches it" is not one: the chokepoint's
 * own contract is what this asserts.
 */
const EXEMPT = Object.create(null);

const BUILDER_FACTORY = 'getBuilder';
const SCOPE_CALL = 'applyTenantScope';

/** `this.<name>(...)` — the only receiver these two ever have. */
function isThisCall(node, name) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.expression.name.text === name
  );
}

/**
 * Does this initializer build through `this.getBuilder(...)`? Unwraps the
 * chained forms the driver really uses — `this.getBuilder(o, opts).where(...)`,
 * `.whereIn(...)`, `.withSchema(...)` — so a chain is still recognised as one
 * builder rather than passed over.
 */
function buildsThroughGetBuilder(node) {
  let cur = node;
  while (cur) {
    if (isThisCall(cur, BUILDER_FACTORY)) return true;
    if (ts.isCallExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isPropertyAccessExpression(cur)) { cur = cur.expression; continue; }
    return false;
  }
  return false;
}

/** Every identifier-rooted `<name>.<member>` use inside `body`. */
function memberUses(body, name) {
  const members = new Set();
  const walk = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      members.add(node.name.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return members;
}

/** Is `this.applyTenantScope(<name>, …)` called anywhere in `body`? */
function isScoped(body, name) {
  let found = false;
  const walk = (node) => {
    if (found) return;
    if (isThisCall(node, SCOPE_CALL)) {
      const first = node.arguments[0];
      if (first && ts.isIdentifier(first) && first.text === name) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return found;
}

/**
 * Classify every `getBuilder` binding in one source file.
 *
 * Exported so `--self-test` can drive it over synthetic sources in BOTH
 * directions without needing the repo in any particular state — the half a
 * green run over a clean tree cannot exercise at all.
 */
export function analyzeSource(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const builders = [];
  const unclassifiable = [];

  const visitMethod = (methodName, body) => {
    if (!body) return;

    const walk = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && buildsThroughGetBuilder(node.initializer)) {
        if (!ts.isIdentifier(node.name)) {
          // A destructured builder. Nothing does this today and the binding
          // cannot be tracked by name — refuse rather than skip.
          unclassifiable.push({
            method: methodName,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            why: 'a getBuilder() result bound by destructuring — cannot track the binding',
          });
          return;
        }
        const name = node.name.text;
        const members = memberUses(body, name);
        builders.push({
          method: methodName,
          binding: name,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          scoped: isScoped(body, name),
          // Insert-side tenancy is injectTenantOnInsert's job, structurally.
          write: members.has('insert'),
        });
        return;
      }

      // A getBuilder() call that is never bound to a name — an inline read this
      // criterion cannot follow. Refuse; do not pass over.
      if (isThisCall(node, BUILDER_FACTORY)) {
        let p = node.parent;
        while (p && (ts.isCallExpression(p) || ts.isPropertyAccessExpression(p))) p = p.parent;
        if (p && !ts.isVariableDeclaration(p)) {
          unclassifiable.push({
            method: methodName,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            why: 'a getBuilder() result used inline, never bound — cannot tell a read from a write',
          });
        }
      }

      ts.forEachChild(node, walk);
    };

    walk(body);
  };

  const walkTop = (node) => {
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        if (
          (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          const body = ts.isMethodDeclaration(member) ? member.body : member.initializer;
          visitMethod(member.name.text, body);
        }
      }
    }
    ts.forEachChild(node, walkTop);
  };
  walkTop(sf);

  return { builders, unclassifiable };
}

/** The gate's verdict as a pure function of a classification. Self-testable. */
export function violationsOf(file, { builders, unclassifiable }, exempt = EXEMPT) {
  const problems = [];
  for (const u of unclassifiable) {
    problems.push({
      fatal: true,
      text: `${file}:${u.line}  ${u.method}() — ${u.why}`,
    });
  }
  for (const b of builders) {
    if (b.scoped || b.write) continue;
    if (exempt[`${file}::${b.method}::${b.binding}`]) continue;
    problems.push({
      fatal: false,
      text:
        `${file}:${b.line}  ${b.method}() builds \`${b.binding}\` through ${BUILDER_FACTORY}() ` +
        `and never calls this.${SCOPE_CALL}(${b.binding}, …)`,
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// --self-test
//
// Every shape is proved to REPORT and its canonical counterpart proved to stay
// SILENT. A gate that has only ever been green cannot be told apart from a gate
// that matches nothing.

const wrap = (body) => `class SqlDriver {\n${body}\n}`;

function selfTest() {
  const failures = [];
  const assert = (cond, msg) => { if (!cond) failures.push(msg); };
  const run = (src) => {
    const a = analyzeSource('t.ts', wrap(src));
    return { ...a, problems: violationsOf('t.ts', a) };
  };

  const reports = [
    [
      'a new row-returning door — the #6792 shape itself',
      `async findWithWindowFunctions(object, query, options) {
         const builder = this.getBuilder(object, options);
         builder.select('*');
         return await builder;
       }`,
    ],
    [
      'a plan door — returns no rows, still a read',
      `async analyzeQuery(object, query, options) {
         const builder = this.getBuilder(object, options);
         const sql = builder.toSQL();
         return { sql: sql.sql };
       }`,
    ],
    [
      'a values door with no `query` parameter at all — what the signature criterion misses',
      `async distinct(object, field, filters, options) {
         const builder = this.getBuilder(object, options);
         builder.distinct(field);
         return await builder;
       }`,
    ],
    [
      'a chained builder',
      `async readOne(object, id, options) {
         const builder = this.getBuilder(object, options).where('id', id);
         return await builder;
       }`,
    ],
    [
      'scoping the WRONG binding does not count as scoping this one',
      `async two(object, options) {
         const a = this.getBuilder(object, options);
         const b = this.getBuilder(object, options);
         this.applyTenantScope(a, object, options);
         return [await a, await b];
       }`,
    ],
    [
      'an update builder is a read predicate too — it must be scoped',
      `async update(object, id, patch, options) {
         const builder = this.getBuilder(object, options).where('id', id);
         return await builder.update(patch);
       }`,
    ],
  ];
  for (const [name, src] of reports) {
    const { problems } = run(src);
    assert(problems.length >= 1, `expected a report for: ${name}`);
  }

  const silent = [
    [
      'the canonical door — scoped beside getBuilder',
      `async findRows(object, query, options) {
         const b = this.getBuilder(object, options);
         this.applyTenantScope(b, object, options);
         return await b;
       }`,
    ],
    [
      'scoped inside a nested closure, which is how findRows really spells it',
      `async findRows(object, query, options) {
         const buildBase = () => {
           const b = this.getBuilder(object, options);
           this.applyTenantScope(b, object, options);
           return b;
         };
         return await buildBase();
       }`,
    ],
    [
      'an INSERT builder — write-side tenancy is injectTenantOnInsert',
      `async create(object, row, options) {
         this.injectTenantOnInsert(object, row, options);
         const builder = this.getBuilder(object, options);
         return await builder.insert(row).returning('*');
       }`,
    ],
    [
      'an upsert insert builder, conflict-merged',
      `async upsert(object, row, options) {
         const builder = this.getBuilder(object, options);
         const insertion = builder.insert(row).onConflict(['id']);
         await insertion.merge();
       }`,
    ],
    [
      'a method that never builds at all',
      `async disconnect() { await this.knex.destroy(); }`,
    ],
    [
      'scope applied after other builder calls — position is not the assertion',
      `async count(object, query, options) {
         const builder = this.getBuilder(object, options);
         builder.count('* as c');
         this.applyTenantScope(builder, object, options);
         return await builder;
       }`,
    ],
  ];
  for (const [name, src] of silent) {
    const { problems } = run(src);
    assert(problems.length === 0, `expected NO report for: ${name} (got ${problems.map((p) => p.text).join('; ')})`);
  }

  // A builder the criterion cannot classify must ABORT, never pass.
  {
    const { problems } = run(
      `async sneaky(object, options) { return await this.getBuilder(object, options).select('*'); }`,
    );
    assert(problems.some((p) => p.fatal), 'an unbound inline getBuilder() must be reported as fatal');
  }

  // The exemption channel is real, and it is keyed to one binding.
  {
    const src = `async door(object, options) {
       const builder = this.getBuilder(object, options);
       return await builder;
     }`;
    const a = analyzeSource('t.ts', wrap(src));
    assert(violationsOf('t.ts', a).length === 1, 'the exemption fixture must report without an entry');
    assert(
      violationsOf('t.ts', a, { 't.ts::door::builder': 'because' }).length === 0,
      'an EXEMPT entry must silence exactly its own binding',
    );
    assert(
      violationsOf('t.ts', a, { 't.ts::door::other': 'because' }).length === 1,
      'an EXEMPT entry for a different binding must NOT silence this one',
    );
  }

  // The DISCOVERED floor must be able to fail. A matcher that stops matching
  // is the failure mode this whole gate is protecting against.
  {
    const { builders } = run(`async nothing() { return 1; }`);
    assert(builders.length === 0, 'the empty fixture must discover no builders');
  }

  if (failures.length > 0) {
    console.error(`✗ check:tenant-chokepoint self-test (${failures.length} failure(s)):\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check:tenant-chokepoint self-test: ${reports.length} reporting shape(s), ` +
    `${silent.length} silent counterpart(s), fatal/exemption/floor channels proved in both directions.`,
  );
}

// ---------------------------------------------------------------------------
// main

function main() {
  const problems = [];
  let discovered = 0;
  let scannedFiles = 0;

  for (const rel of SCAN_FILES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      console.error(
        `check:tenant-chokepoint: ${rel} does not exist.\n` +
        'The scan set is stale — a driver was renamed or moved. Refusing to report clean\n' +
        'over a file set that no longer describes the SqlDriver family.',
      );
      process.exit(2);
    }
    scannedFiles += 1;
    const analysis = analyzeSource(rel, readFileSync(abs, 'utf8'));
    discovered += analysis.builders.length;
    problems.push(...violationsOf(relative(ROOT, abs).replace(/\\/g, '/'), analysis));
  }

  if (discovered < DISCOVERED_FLOOR) {
    console.error(
      `check:tenant-chokepoint: discovered only ${discovered} ${BUILDER_FACTORY}() binding(s) across ` +
      `${scannedFiles} file(s), below the floor of ${DISCOVERED_FLOOR}.\n` +
      'A scan that stops matching reports "clean" while reading nothing (#4690). Either the\n' +
      'driver was refactored away from getBuilder() — in which case this gate needs rewriting\n' +
      'against the new constructor — or the matcher is broken. Both are errors, not passes.',
    );
    process.exit(2);
  }

  const fatal = problems.filter((p) => p.fatal);
  if (fatal.length > 0) {
    console.error(`✗ check:tenant-chokepoint: ${fatal.length} builder(s) this gate cannot classify\n`);
    for (const p of fatal) console.error(`  • ${p.text}`);
    console.error(
      '\nA builder it cannot classify is an error, never a default. Bind the builder to a\n' +
      'local and apply the scope on it, or widen the criterion in\n' +
      'scripts/check-tenant-chokepoint.mjs deliberately.',
    );
    process.exit(2);
  }

  if (problems.length > 0) {
    console.error(`✗ check:tenant-chokepoint: ${problems.length} unscoped read door(s)\n`);
    for (const p of problems) console.error(`  • ${p.text}`);
    console.error(`
\`applyTenantScope\` is the single chokepoint for read-side tenant isolation: it owns
the tenantId early-out, the no-tenant-field early-out, the NULL-org platform-row rule
(#2734) and the ADR-0105 D2 union posture (#3623). A read door that skips it returns
OTHER TENANTS' data to a caller that asked to be scoped — measured, not theoretical
(#6792: three doors, one of them documented with a runnable example).

Add the call beside the getBuilder() line, as every other door does:

    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);

Do not re-derive the predicate locally — a bare equality silently drops NULL-org
platform rows (#2734) and collapses the group posture to active-org reach (#3623).

If a door genuinely must build unscoped, add it to EXEMPT in
scripts/check-tenant-chokepoint.mjs with a reason a reader can check. "The layer
above catches it" is not one: this asserts the chokepoint's own contract.`);
    process.exit(1);
  }

  console.log(
    `✓ check:tenant-chokepoint: ${discovered} ${BUILDER_FACTORY}() binding(s) across ${scannedFiles} ` +
    'file(s); every read builder routes through applyTenantScope(), every unscoped one is an insert.',
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

main();
