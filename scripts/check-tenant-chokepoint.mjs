#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-side tenant chokepoint guard (#6792, from #3724 / #6577).
 *
 * ## What it guards
 *
 * `SqlDriver.applyTenantScope()` is the single chokepoint for read-side tenant
 * isolation in the SQL driver: it owns the `tenantId` early-out, the
 * "object has no tenant field" early-out, the one tenant predicate
 * (`tenant_column = :tenant`, ADR-0131 D8) and the ADR-0105 D2 union posture
 * (`tenant_column IN (:tenants)`). A read door that builds its own query and
 * never arrives there is not "inconsistent" — it returns other tenants' data
 * to a caller that asked to be scoped.
 *
 * So, two rules:
 *
 *   1. **A method that builds through `this.getBuilder(object, options)` and
 *      lets that builder escape as a READ must call `this.applyTenantScope()`
 *      on it.** Write builders are exempt and the exemption is structural, not
 *      a name list — insert-side tenancy is a different mechanism
 *      (`injectTenantOnInsert` stamps the column), so a builder whose only
 *      escape is `.insert(...)` is correct without this call.
 *   2. **No `IS NULL` arm on a tenant column (ADR-0131 D8).** NULL is not an
 *      owner (D1): an organization-less row is no tenant's, so no tenant
 *      predicate may reach it. The v17 predicate carried an
 *      `OR tenant_column IS NULL` arm under which such a row stood for
 *      platform state; ADR-0131 retired that reading, and this rule keeps the
 *      arm from coming back — in `applyTenantScope` or anywhere else in the
 *      three driver files. See "The D8 null-arm rule" below.
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
 *     Out of reach of this criterion by construction. One read path does it,
 *     and it returns no row: `SqlDriver.listPhysicalColumns` (#23429) reads a
 *     table's CATALOG (column names) on Knex directly, so it has no rows to
 *     scope. Any other such read path is invisible to this gate, and the
 *     honest place to record that limit is here.
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
 * ## The D8 null-arm rule
 *
 * ADR-0131 D8: "`check-tenant-chokepoint` refuses an `IS NULL` arm on a tenant
 * column." A TENANT COLUMN REFERENCE, inside any class member of the scanned
 * files, is one of:
 *
 *   - a local bound to `this.resolveTenantField(…)`, `this.computeTenantField(…)`
 *     or `this.computeAndRecordTenantField(…)` (how `applyTenantScope` spells
 *     it: `const field = this.resolveTenantField(object)`);
 *   - anything NAMED `tenantField` — a local, a parameter, or a member such as
 *     `reservation.tenantField` (the sequence-counter paths);
 *   - the literal `'organization_id'`, the canonical tenant column.
 *
 * An ARM on it is refused in each spelling Knex compiles to `IS NULL`:
 * `whereNull` / `orWhereNull` / `andWhereNull`; a `where` / `orWhere` /
 * `andWhere` with a `null` comparand (`where(field, null)`,
 * `where(field, 'is', null)`); an object-form `where({ [field]: null })`; and
 * a raw fragment (`whereRaw`, `orWhereRaw`, `andWhereRaw`, `havingRaw`, `raw`)
 * whose own literal text says `IS NULL` and that names the column — as a
 * template substitution, as a binding in its bindings array, or literally.
 * `IS NOT NULL` is not an arm and is never refused.
 *
 * Exemptions: none (`NULL_ARM_EXEMPT` is empty), and the rule needs none on
 * `main`. One NULL disjunct survives in the platform BY DESIGN and is outside
 * this rule on purpose: the `sys_audit_log.tenant_id` attribution partition
 * read by `LifecycleService`. That column is an ADR-0131 D7 attribution
 * field, not a D8 tenant column, and it lives outside the driver files this
 * gate scans.
 *
 * What it does NOT see, named: a raw SQL string assembled into a variable
 * first and passed by name, and a tenant column reached under a name not
 * listed above. The gate refuses the spellings the driver actually uses;
 * `sql-driver-tenant-scope-read-doors.test.ts` proves the compiled predicate.
 *
 *   node scripts/check-tenant-chokepoint.mjs [--self-test]
 *
 * Exit codes: 0 clean · 1 an unscoped read door, or an `IS NULL` arm on a
 * tenant column · 2 the scan could not run
 * (no class found, a builder it cannot classify, or a DISCOVERED floor missed).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
import { parseSourceFile } from './ts-parse.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The `SqlDriver` family — every class that inherits this chokepoint. */
const SCAN_FILES = [
  join('packages', 'drivers', 'driver-sql', 'src', 'sql-driver.ts'),
  join('packages', 'drivers', 'driver-sqlite-wasm', 'src', 'sqlite-wasm-driver.ts'),
  join('packages', 'drivers', 'driver-turso', 'src', 'turso-driver.ts'),
];

/**
 * The population this gate reads, declared for `scripts/pm/dispatch-gates.mjs`.
 *
 * `SCAN_FILES` is assembled with `join()`, one SEGMENT per literal, so the
 * derivation — which reads SOURCE TEXT — saw a handful of bare words and no path
 * at all. This gate was scored `undetermined` for EVERY card: absent from every
 * dispatch brief and every `--commands` harvest, while CI ran it on each pull
 * request. Worse than the usual cost, because this gate's population is THREE
 * FILES: the cards that actually implicate it are rare and precisely nameable,
 * and it was reaching none of them.
 *
 * The spelling is `DECLARED_WATCH_HINTS` rather than the directory idiom: this
 * is an enumerated population, not a walked subtree, and each hint is a whole
 * repo-relative FILE path — which carries a separator, so `hintCovers` reads it
 * without a glob suffix.
 *
 * ⛔ Not `packages/drivers/**`, and not a whole-tree marker. Both would put this
 * gate on cards it does not read a byte for; a lead that is wrong on thousands
 * of files is worse than the silence it replaces.
 *
 * The self-test derives the coupling from `SCAN_FILES` on both sides rather than
 * re-spelling it, so a driver added to or removed from the family cannot leave
 * this declaration describing the old population. The POSIX normalisation is
 * load-bearing: `join()` yields a platform separator, and the declaration is
 * read as text by a scanner that only knows `/`.
 */
const DECLARED_WATCH_HINTS = [
  'packages/drivers/driver-sql/src/sql-driver.ts',
  'packages/drivers/driver-sqlite-wasm/src/sqlite-wasm-driver.ts',
  'packages/drivers/driver-turso/src/turso-driver.ts',
];

/**
 * The floor a real scan must clear. A scan that silently stops matching reports
 * "clean" while reading nothing (#4690), and this gate's whole value is that it
 * is the only thing measuring the invariant. Set below today's count so
 * ordinary edits do not trip it, and high enough that a broken matcher does.
 */
const DISCOVERED_FLOOR = 15;

/**
 * The same floor for the D8 null-arm rule: tenant-column predicates it must
 * RECOGNISE (`where` / `whereIn` on a tenant column reference — 4 on `main`,
 * `applyTenantScope`'s two among them). Below today's count, above zero: a
 * rule that stops recognising the tenant column refuses nothing.
 */
const TENANT_PREDICATE_FLOOR = 3;

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

// ── The D8 null-arm rule ────────────────────────────────────────────────────

/** The calls that answer "which column is this object's tenant column". */
const TENANT_FIELD_RESOLVERS = new Set(['resolveTenantField', 'computeTenantField', 'computeAndRecordTenantField']);
/** A name that IS a tenant column wherever it appears — local, parameter or member. */
const TENANT_FIELD_NAME = 'tenantField';
/** The canonical tenant column, written as a literal. */
const TENANT_COLUMN_LITERAL = 'organization_id';

const NULL_CALLS = new Set(['whereNull', 'orWhereNull', 'andWhereNull']);
const WHERE_CALLS = new Set(['where', 'orWhere', 'andWhere']);
const RAW_CALLS = new Set(['whereRaw', 'orWhereRaw', 'andWhereRaw', 'havingRaw', 'raw']);
/** The calls a tenant predicate is written with — counted for the floor, never refused. */
const TENANT_PREDICATE_CALLS = new Set(['where', 'whereIn']);
/** `IS NULL`, never `IS NOT NULL` — the latter is not an arm. */
const IS_NULL_TEXT = /\bis\s+null\b/i;

/**
 * `'<file>::<method>'` -> reason a reader can check. Empty by design: the rule
 * needs no exemption on `main`, and an entry is a decision against ADR-0131
 * D8 that a superseding ADR has to make first.
 */
const NULL_ARM_EXEMPT = Object.create(null);

function isNullLiteral(node) {
  return node && node.kind === ts.SyntaxKind.NullKeyword;
}

/** Locals in `body` bound to a tenant-field resolver call. */
function tenantBindings(body) {
  const names = new Set();
  const callsResolver = (node) => {
    let hit = false;
    const walk = (n) => {
      if (hit) return;
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        TENANT_FIELD_RESOLVERS.has(n.expression.name.text)
      ) {
        hit = true;
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return hit;
  };
  const walk = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && callsResolver(node.initializer)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return names;
}

/** Is `node` a tenant column reference, as the header defines one? */
function isTenantRef(node, bindings) {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
    return isTenantRef(node.expression, bindings);
  }
  if (ts.isIdentifier(node)) return node.text === TENANT_FIELD_NAME || bindings.has(node.text);
  if (ts.isPropertyAccessExpression(node)) return node.name.text === TENANT_FIELD_NAME;
  if (ts.isStringLiteralLike(node)) return node.text === TENANT_COLUMN_LITERAL;
  // `String(field)` — the driver threads values through `String()` elsewhere.
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'String') {
    return isTenantRef(node.arguments[0], bindings);
  }
  return false;
}

/** The literal text of a raw fragment, and the expressions substituted into it. */
function rawParts(node) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return { text: node.text, spans: [] };
  if (ts.isTemplateExpression(node)) {
    return {
      text: node.head.text + node.templateSpans.map((s) => ` ${s.literal.text}`).join(''),
      spans: node.templateSpans.map((s) => s.expression),
    };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = rawParts(node.left) ?? { text: '', spans: [node.left] };
    const r = rawParts(node.right) ?? { text: '', spans: [node.right] };
    return { text: `${l.text} ${r.text}`, spans: [...l.spans, ...r.spans] };
  }
  return null;
}

/** The spelling of a refused arm, or null when `call` is not one. */
function nullArmOf(call, bindings) {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const verb = call.expression.name.text;
  const args = call.arguments;
  if (NULL_CALLS.has(verb) && isTenantRef(args[0], bindings)) return `${verb}(<tenant column>)`;
  if (WHERE_CALLS.has(verb)) {
    if (args.length >= 2 && isTenantRef(args[0], bindings) && isNullLiteral(args[args.length - 1])) {
      return `${verb}(<tenant column>, …null)`;
    }
    const obj = args[0];
    if (args.length === 1 && obj && ts.isObjectLiteralExpression(obj)) {
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p) || !isNullLiteral(p.initializer)) continue;
        const key = ts.isComputedPropertyName(p.name)
          ? isTenantRef(p.name.expression, bindings)
          : (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === TENANT_COLUMN_LITERAL;
        if (key) return `${verb}({ <tenant column>: null })`;
      }
    }
  }
  if (RAW_CALLS.has(verb)) {
    const parts = rawParts(args[0]);
    if (parts && IS_NULL_TEXT.test(parts.text)) {
      const bound = args[1] && ts.isArrayLiteralExpression(args[1]) && args[1].elements.some((e) => isTenantRef(e, bindings));
      const named =
        parts.spans.some((e) => isTenantRef(e, bindings)) ||
        new RegExp(`\\b${TENANT_COLUMN_LITERAL}\\b`).test(parts.text);
      if (bound || named) return `${verb}('… <tenant column> IS NULL …')`;
    }
  }
  return null;
}

/** The name an outermost container (method, accessor, function, property) is reported under. */
function containerName(node) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (
    (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
      ts.isFunctionDeclaration(node) || (ts.isPropertyDeclaration(node) && node.initializer)) &&
    node.name
  ) {
    return ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name) ? node.name.text : node.name.getText();
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return node.name.text;
  }
  return null;
}

/**
 * Every refused arm in one source file — every class member AND every
 * module-level function, so a helper outside the class is no hiding place.
 * Tenant bindings are scoped to the outermost container they are declared in:
 * a `field` that is the tenant column in `applyTenantScope` is not the tenant
 * column in the filter compiler that also names a local `field`.
 */
export function nullArmsOf(fileName, text) {
  const sf = parseSourceFile(fileName, text);
  const arms = [];
  // Tenant-column predicates the rule SAW (`where` / `whereIn` on a tenant
  // column reference). The floor in main() reads this: a matcher that stops
  // recognising the tenant column refuses nothing and still reports clean.
  let predicates = 0;
  const walk = (node, ctx) => {
    let here = ctx;
    if (!ctx) {
      const name = containerName(node);
      if (name) here = { name, bindings: tenantBindings(node) };
    }
    if (ts.isCallExpression(node)) {
      const bindings = here?.bindings ?? new Set();
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        TENANT_PREDICATE_CALLS.has(node.expression.name.text) &&
        isTenantRef(node.arguments[0], bindings)
      ) {
        predicates += 1;
      }
      const shape = nullArmOf(node, bindings);
      if (shape) {
        arms.push({
          method: here?.name ?? '(module scope)',
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          shape,
        });
      }
    }
    ts.forEachChild(node, (child) => walk(child, here));
  };
  walk(sf, null);
  return { arms, predicates };
}

/** The D8 verdict as a pure function of the arms found. Self-testable. */
export function nullArmViolationsOf(file, arms, exempt = NULL_ARM_EXEMPT) {
  return arms
    .filter((a) => !exempt[`${file}::${a.method}`])
    .map((a) => ({ fatal: false, nullArm: true, text: `${file}:${a.line}  ${a.method}() — ${a.shape}` }));
}

/**
 * Classify every `getBuilder` binding in one source file.
 *
 * Exported so `--self-test` can drive it over synthetic sources in BOTH
 * directions without needing the repo in any particular state — the half a
 * green run over a clean tree cannot exercise at all.
 */
export function analyzeSource(fileName, text) {
  const sf = parseSourceFile(fileName, text);
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

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-tenant-chokepoint self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. The floor requires the OPENED set to equal the
// DECLARED set with each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. Its
// blocks are headed by unmarked prose comments, so it carries fewer than the two
// named section banners the sectioning criterion needs, and ⛔ a comment is NOT
// promoted to a section head — that is a judgement per comment this transplant
// does not make. The hoisted single battery is the shape PR #14896 and PR #15003
// landed for exactly this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-tenant-chokepoint self-test': 17,
  'D8 null-arm rule': 22,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 2;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('check-tenant-chokepoint self-test');
  const failures = [];
  const assert = (cond, msg) => { registerCase(); if (!cond) failures.push(msg); };
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

  // ── the D8 null-arm rule: every spelling reports, its counterpart stays silent
  battery('D8 null-arm rule');
  const arms = (src) => nullArmsOf('t.ts', wrap(src)).arms;
  const nullArmReports = [
    [
      'the retired v17 arm itself, inside the chokepoint',
      `applyTenantScope(builder, object, options) {
         const field = this.resolveTenantField(object);
         if (!field) return builder;
         return builder.where((qb) => qb.where(field, String(options.tenantId)).orWhereNull(field));
       }`,
    ],
    [
      'whereNull on a parameter named tenantField',
      `nextValue(table, tenantField, tenantId) { return this.knex(table).whereNull(tenantField); }`,
    ],
    [
      'andWhereNull on a member named tenantField',
      `reserve(reservation) { return this.knex(reservation.table).andWhereNull(reservation.tenantField); }`,
    ],
    [
      'the literal tenant column',
      `scan(table) { return this.knex(table).orWhereNull('organization_id'); }`,
    ],
    [
      'a null comparand — Knex compiles where(col, null) to IS NULL',
      `scope(builder, object) {
         const f = this.resolveTenantField(object);
         return builder.orWhere(f, null);
       }`,
    ],
    [
      "the three-argument form, where(col, 'is', null)",
      `scope(builder, object) {
         const f = this.computeTenantField(object);
         return builder.orWhere(f, 'is', null);
       }`,
    ],
    [
      'the object form with a computed tenant key',
      `scope(builder, object) {
         const f = this.resolveTenantField(object);
         return builder.orWhere({ [f]: null });
       }`,
    ],
    [
      'a raw fragment substituting the tenant column',
      'scope(builder, object) { const f = this.resolveTenantField(object); return builder.orWhereRaw(`${f} is null`); }',
    ],
    [
      'a raw fragment binding the tenant column',
      `scope(builder, object) {
         const f = this.resolveTenantField(object);
         return builder.whereRaw('(?? = ? OR ?? IS NULL)', [f, 'org', f]);
       }`,
    ],
    [
      'a raw fragment naming the literal tenant column',
      `census(table) { return this.knex.raw('select * from ?? where organization_id is null', [table]); }`,
    ],
    [
      'a module-level helper outside the class is no hiding place',
      `x() {}
       }
       function widen(qb, tenantField) { return qb.orWhereNull(tenantField); }
       class Tail {`,
    ],
  ];
  for (const [name, src] of nullArmReports) {
    assert(arms(src).length >= 1, `D8: expected an IS NULL arm report for: ${name}`);
  }

  const nullArmSilent = [
    [
      'the one predicate, as applyTenantScope spells it today',
      `applyTenantScope(builder, object, options) {
         const field = this.resolveTenantField(object);
         if (!field) return builder;
         return builder.where(field, String(options.tenantId));
       }`,
    ],
    [
      'IS NOT NULL on the tenant column is not an arm',
      `scope(builder, object) {
         const field = this.resolveTenantField(object);
         return builder.whereNotNull(field).whereRaw('?? is not null', [field]);
       }`,
    ],
    [
      'whereNull on an ordinary column (the filter compiler)',
      `compile(qb, field) { return qb.whereNull(field).orWhere(field, ''); }`,
    ],
    [
      'a tenant binding does not leak into a sibling method that reuses the name',
      `scope(builder, object) { const field = this.resolveTenantField(object); return builder.where(field, 'o'); }
       compile(qb, field) { return qb.orWhereNull(field); }`,
    ],
    [
      'a raw IS NULL over a non-tenant expression',
      'negate(qb, expr, testSql) { return qb.whereRaw(`(${expr.sql} IS NULL OR ${testSql})`, expr.bindings); }',
    ],
    [
      'a null comparand on an ordinary column',
      `clear(qb) { return qb.where('deleted_at', null); }`,
    ],
  ];
  for (const [name, src] of nullArmSilent) {
    const found = arms(src);
    assert(found.length === 0, `D8: expected NO arm report for: ${name} (got ${found.map((a) => a.shape).join('; ')})`);
  }

  // The predicate counter the floor reads must see the real predicate, and not
  // count an ordinary column.
  assert(
    nullArmsOf('t.ts', wrap(nullArmSilent[0][1])).predicates === 1,
    'D8: the one predicate must be counted for the TENANT_PREDICATE_FLOOR',
  );
  assert(
    nullArmsOf('t.ts', wrap(nullArmSilent[5][1])).predicates === 0,
    'D8: a predicate on an ordinary column must not be counted',
  );

  // The exemption channel is keyed to one file::method, and empty on main.
  {
    const found = arms(nullArmReports[0][1]);
    assert(nullArmViolationsOf('t.ts', found).length === 1, 'D8: an arm reports without an exemption');
    assert(
      nullArmViolationsOf('t.ts', found, { 't.ts::applyTenantScope': 'because' }).length === 0,
      'D8: a NULL_ARM_EXEMPT entry silences exactly its own method',
    );
    assert(
      nullArmViolationsOf('t.ts', found, { 't.ts::other': 'because' }).length === 1,
      'D8: an entry for another method must NOT silence this one',
    );
  }

  // ── the dispatch-gates population declaration ────────────────────────────
  battery('check-tenant-chokepoint self-test');
  const scannedPosix = SCAN_FILES.map((f) => f.split(sep).join('/'));
  assert(
    scannedPosix.every((f) => DECLARED_WATCH_HINTS.includes(f)),
    'every SCAN_FILES entry is declared for dispatch-gates — a join()-assembled path is invisible to '
      + 'the hint extractor, which is how this gate came to declare nothing at all',
  );
  assert(
    DECLARED_WATCH_HINTS.every((h) => scannedPosix.includes(h)),
    'and nothing is declared that this gate does not read — a declaration that has drifted from the '
      + 'scan replaces a silent gate with a lying one',
  );
  assert(
    DECLARED_WATCH_HINTS.every((h) => !h.includes('*')),
    'the declaration stays file-exact — a `packages/drivers/**` widening would name this gate on '
      + 'cards it does not read a byte for',
  );

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => { failures.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  if (failures.length > 0) {
    console.error(`✗ check:tenant-chokepoint self-test (${failures.length} failure(s)):\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check:tenant-chokepoint self-test: ${reports.length} reporting shape(s), ` +
    `${silent.length} silent counterpart(s), fatal/exemption/floor channels proved in both directions; ` +
    `D8 null-arm rule: ${nullArmReports.length} refused spelling(s), ${nullArmSilent.length} silent counterpart(s).`,
  );

  return SELF_TEST_VERDICT;
}

// ---------------------------------------------------------------------------
// main

function main() {
  const problems = [];
  const nullArms = [];
  let tenantPredicates = 0;
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
    const text = readFileSync(abs, 'utf8');
    const analysis = analyzeSource(rel, text);
    discovered += analysis.builders.length;
    const posix = relative(ROOT, abs).replace(/\\/g, '/');
    problems.push(...violationsOf(posix, analysis));
    const d8 = nullArmsOf(rel, text);
    tenantPredicates += d8.predicates;
    nullArms.push(...nullArmViolationsOf(posix, d8.arms));
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

  if (tenantPredicates < TENANT_PREDICATE_FLOOR) {
    console.error(
      `check:tenant-chokepoint: the D8 null-arm rule recognised only ${tenantPredicates} tenant-column ` +
      `predicate(s) across ${scannedFiles} file(s), below the floor of ${TENANT_PREDICATE_FLOOR}.\n` +
      'A rule that no longer recognises the tenant column refuses nothing and reports clean. Either\n' +
      'the driver now names its tenant column some other way — teach isTenantRef() that spelling —\n' +
      'or the matcher is broken. Both are errors, not passes.',
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
the tenantId early-out, the no-tenant-field early-out, the one tenant predicate
(tenant_column = :tenant, ADR-0131 D8) and the ADR-0105 D2 union posture
(tenant_column IN (:tenants)). A read door that skips it returns OTHER TENANTS' data
to a caller that asked to be scoped — measured, not theoretical: three such doors
were found, one of them documented with a runnable example.

Add the call beside the getBuilder() line, as every other door does:

    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);

Do not re-derive the predicate locally — a local copy drifts from the one computed
predicate, and an equality written where the group posture is in force collapses
its union to active-org reach.

If a door genuinely must build unscoped, add it to EXEMPT in
scripts/check-tenant-chokepoint.mjs with a reason a reader can check. "The layer
above catches it" is not one: this asserts the chokepoint's own contract.`);
  }

  if (nullArms.length > 0) {
    console.error(`✗ check:tenant-chokepoint: ${nullArms.length} IS NULL arm(s) on a tenant column\n`);
    for (const p of nullArms) console.error(`  • ${p.text}`);
    console.error(`
ADR-0131 D8: no layer has a NULL arm. NULL is not an owner (D1) — an
organization-less row belongs to no tenant, so no tenant predicate may reach it.
The tenant predicate is \`tenant_column = :tenant\` (or \`IN (:tenants)\` under the
group posture), and nothing else: an \`OR tenant_column IS NULL\` arm hands every
tenant the rows no organization owns.

Remove the arm. A row that should be readable by a tenant carries that tenant's
organization; deployment-level state lives on an object with no tenant column (D7).
Reading organization-less rows on purpose (a census, a repair) is not a tenant
predicate: do it outside the driver's tenant scope, or record the exemption in
NULL_ARM_EXEMPT in scripts/check-tenant-chokepoint.mjs — which reverses an ADR
decision and needs a superseding ADR first.`);
  }

  if (problems.length > 0 || nullArms.length > 0) process.exit(1);

  console.log(
    `✓ check:tenant-chokepoint: ${discovered} ${BUILDER_FACTORY}() binding(s) across ${scannedFiles} ` +
    'file(s); every read builder routes through applyTenantScope(), every unscoped one is an insert; ' +
    'no IS NULL arm on a tenant column (ADR-0131 D8).',
  );
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
          '\n✗ check-tenant-chokepoint self-test: selfTest() returned without reaching its verdict,\n'
              + 'so no success line was printed. Exiting 0 here would report a self-test\n'
              + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
  }
  process.exit(0);
}

if (invokedDirectly) main();
