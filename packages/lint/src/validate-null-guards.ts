// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `has(x)` is not a null guard — publish-time rejection (#4763).
 *
 * CEL's `has(x)` asks whether the key is **present**. A declared column holding
 * `NULL` is present, and since #4649 every predicate sees a record that is
 * TOTAL over the object's declared fields — so `has(record.end_date)` is
 * uniformly `true` and tells the author nothing about the value. The idiom that
 * reads like a null guard
 *
 * ```text
 * has(record.start_date) && has(record.end_date) && record.end_date < record.start_date
 * ```
 *
 * therefore reaches `null < null`, CEL has no overload for it, the predicate
 * aborts, and (post-#4761) the write is rejected fail-closed. Before #4761 the
 * abort was swallowed: the rule was declared, listed in the metadata, and
 * enforced **nothing** on exactly the rows it was written to catch.
 *
 * The fault is fully decidable from the metadata alone — the predicate's AST
 * plus the object's declared field types say whether an operand can be null —
 * so it belongs at authoring/publish, not at a 400 on production data
 * (AGENTS.md PD #12: reject at authoring, do not tolerate at the consumer).
 * This module is that decision procedure; `validate-expressions.ts` wires it
 * into the gating `validateStackExpressions` rule, which `os build`,
 * `os validate`, `os lint` and the runtime publish gate all run.
 *
 * ## What is rejected
 *
 * An **ordering** (`< <= > >=`) or **arithmetic** (`+ - * / %`, unary `-`)
 * operator applied to an operand that
 *
 *  1. resolves to a declared field of the object (`record.<f>` / `previous.<f>`),
 *  2. that field is nullable — no `required: true`, no `defaultValue`, no
 *     default option, not an autonumber, and
 *  3. is not dominated by an explicit `!= null` / `== null` / `isBlank()` test
 *     in the same boolean branch.
 *
 * `has(x)` deliberately does **not** satisfy (3) — that is the entire point.
 * `has()` over an **undeclared** key is untouched: it never resolves to a
 * declared field, so (1) fails and the legitimate "was this key in the PATCH"
 * use stays legal. Equality (`==` / `!=`) is never flagged: CEL evaluates a
 * heterogeneous equality cleanly to `false` rather than faulting.
 *
 * ## Which surfaces this gate may cover — the totality criterion (#4811)
 *
 * #4763 wired two surfaces and left the rest "to be decided". The deciding
 * property turns out not to be a matter of taste, and it is not "is this
 * predicate CEL?" either. It is whether the record bound at evaluation time is
 * **TOTAL over the object's declared fields** (`materializeDeclaredFields`,
 * #1871/#4649). Measured against `@marcbachmann/cel-js`, the two bindings do
 * not merely differ in wording — they inarguably invert:
 *
 * | predicate                | TOTAL binding (`{a: null}`) | SPARSE binding (`{}`)  |
 * |:-------------------------|:----------------------------|:-----------------------|
 * | `has(record.a)`          | `true`  ← the trap          | `false` ← a real guard |
 * | `record.a < record.b`    | FAULT `no such overload`    | FAULT `No such key: a` |
 * | `record.a != null`       | `false` ← **the fix works** | FAULT `No such key: a` |
 *
 * So on a total binding `has()` is uniformly true and useless while `!= null`
 * is the cure; on a sparse binding `has()` is exactly the right guard and
 * `!= null` **is itself a fault**. Running this gate over a sparse-bound
 * surface would therefore reject correct metadata and prescribe a "fix" that
 * breaks it — strictly worse than not covering the surface at all. Hence:
 *
 * **This module may only be wired to a surface whose record binding is total.**
 * Necessary, not sufficient — see the `readonlyWhen` row below, where a total
 * binding is still excluded for a reason totality has nothing to say about.
 *
 * Surface ledger (each verdict traced to the code that decides it, so the next
 * author does not have to re-derive it — #4811). `binding` is the measured
 * shape TODAY; `verdict` is whether this gate runs there. Those are two
 * questions, and since #6454 they have come apart on two rows:
 *
 * | surface                        | binding | evidence                                                    | verdict |
 * |:-------------------------------|:--------|:------------------------------------------------------------|:--------|
 * | object validation rules        | TOTAL   | `rule-validator.ts` `materializeDeclaredFields(merged, …)`   | covered |
 * | lifecycle hook `condition`     | TOTAL   | `hook-wrappers.ts` `materializeDeclaredFields(…)`            | covered |
 * | field `requiredWhen`           | TOTAL   | same `merged` in `evaluateValidationRules` — fail-OPEN, so an unguarded predicate enforces NOTHING in silence | covered (#4811) |
 * | field `readonlyWhen`           | TOTAL   | `rule-validator.ts` `readonlyWhenBindings` materialises BOTH roots (#4953 clause 1, landed in #6454) | excluded — NOT on totality; see below |
 * | action `visible` / `disabled`  | sparse  | evaluated client-side; no materialization exists in `objectui` | excluded (decided — #4953 clause 2) |
 * | flow / edge `condition`        | TOTAL   | `record-change-trigger.ts` `buildContext` layers `previous` under the payload/after-row then runs BOTH `record` and `previous` through a structural-mirror `materializeDeclaredFields` (#4953 clause 1's other half, services lane) | excluded — NOT on totality; see below |
 * | sharing-rule `condition`       | n/a     | compiled to a SQL filter; `NULL > x` is three-valued, never faults | excluded |
 * | field `expression` (`Field.formula`) | n/a | product judgement, not a wiring gap — see below              | excluded |
 *
 * The four exclusions that are *not* self-evident, spelled out because a
 * surface excluded without a reason is indistinguishable from one nobody
 * looked at — the failure mode this whole family of issues is about:
 *
 *  - **Field `readonlyWhen` — the row where `binding` and `verdict` came
 *    apart.** Its binding is no longer sparse. Since #6454 (the engine-core
 *    share of the maintainer's #4953 ruling, clause 1) `rule-validator.ts`
 *    builds the two roots in `readonlyWhenBindings` and runs BOTH — `record`
 *    (the prior row overlaid with the PATCH) and `previous` — through the same
 *    `materializeDeclaredFields`. The totality criterion above is therefore
 *    SATISFIED here, and the evidence this row used to carry
 *    (`stripReadonlyWhenFields` merging `{...previous, ...data}` raw)
 *    describes code that no longer exists. What keeps the row excluded is
 *    clause 3 of the same ruling: the gate widens once BOTH server-side seams
 *    are total. The other one — flow trigger-record seeding, services lane —
 *    is ALSO wired now (#4953 clause 1's other half; see the `flow / edge
 *    condition` row below), so both server-side seams the ruling named are
 *    total as of that landing. The actual gate widening clause 3 promises is
 *    tracked separately (#4811) rather than folded into either seam's own
 *    PR — this row (and the one below) stay excluded here on purpose, so the
 *    `binding` column keeps meaning what #4811 needs it to mean: a fact about
 *    the surface, not a verdict this module renders on itself.
 *
 *    Two facts to carry into that widening; neither is bookkeeping:
 *
 *      1. **The fail policy is the OPPOSITE of the two surfaces #4763 wired.**
 *         Validation rules and hook `condition`s are fail-CLOSED. A faulting
 *         `readonlyWhen` is fail-OPEN: `isReadonlyWhenLocked` logs
 *         `failed to evaluate — change allowed through`, and the field the
 *         author declared frozen is WRITTEN. (One exception, #4889 — a fault
 *         naming an UNBOUND ROOT resolves to LOCKED.) So this face wants
 *         {@link nullGuardMessage}'s `'fail-open'` outcome for the same reason
 *         the `requiredWhen` row already carries it: the damage is a declared
 *         lock that silently enforces nothing, not a rejected write.
 *      2. **Making the binding total moved one verdict the OTHER way.** On a
 *         total record `has(record.<declared>)` is uniformly TRUE and
 *         `!has(record.<declared>)` uniformly FALSE, so a lock spelled
 *         `readonlyWhen: !has(record.b)` STOPPED locking when #6454 landed.
 *         That is the `declared-fields.ts` contract since #4649 — `has()`
 *         guards an UNDECLARED key, never an empty value; test emptiness with
 *         `!= null` — and #6454 measured the cell and pinned both spellings in
 *         `rule-validator.test.ts`. It is why "this face is materialized now"
 *         is not, on its own, an accurate summary of what changed here.
 *
 *  - **Action `visible` / `disabled`.** #4811 asked whether the ActionEngine
 *    materializes declared fields before evaluating. It does not: the record
 *    is whatever the client already fetched (a record-detail read, or a LIST
 *    ROW carrying only the view's projected columns), and `objectui` contains
 *    no materialization step on that path. The predicate does reach real CEL
 *    (a bare authored string is normalized to a `{dialect:'cel'}` envelope by
 *    `ExpressionInputSchema`, which the renderers preserve) and a fault IS
 *    fail-closed — the action silently vanishes — so the *trap* is real here.
 *    But with a sparse binding the prescription inverts (see the table), so the
 *    gate cannot be the thing that catches it. That question is now DECIDED
 *    rather than open: #4953 clause 2 defers making this binding total —
 *    it would mean every REST read padding out all declared columns — so the
 *    face stays sparse, is documented as sparse, and an author there guards
 *    with `has()` (`declared-fields.ts` says the same from the engine's side).
 *    The exclusion is permanent under the current decision, not pending one.
 *    The ruling's replacement action for this face is the MIRROR of this gate
 *    — flag `!= null` on a sparse binding — and it is an evaluation owed by
 *    the devx / objectui lanes, never a widening of `checkNullGuards`.
 *  - **Flow / edge `condition` — the row where `binding` and `verdict` came
 *    apart, same shape as `readonlyWhen` above.** #4811 originally excluded
 *    these for flattened-scope ambiguity ("a bare identifier may be a flow
 *    variable"). That reason does not actually apply to this module —
 *    {@link findUnguardedNullableOperands} only ever resolves `record.<f>` /
 *    `previous.<f>` and never a bare identifier, and the engine binds
 *    `record` / `previous` unconditionally. The real blocker was totality:
 *    the trigger used to seed the record as `{...(inputData ?? {}), ...after}`
 *    — spelled `inputDoc` here until #5671 dropped that alias read — so a
 *    declared column the write never mentioned was an ABSENT key, and the
 *    `!= null` this gate prescribes would fault.
 *
 *    #4953 (services half) closed that gap: `record-change-trigger.ts`
 *    `buildContext` now layers `previous` under the payload/after-row (so an
 *    untouched field reads its REAL persisted value instead of going
 *    missing) and runs the result through a structural-mirror
 *    `materializeDeclaredFields` for whatever is still absent — gated on the
 *    same `groundTruth` rule `evaluateValidationRules` uses (insert always;
 *    update/delete only once the prior row was fetched), so a write whose
 *    prior row genuinely cannot be read is left sparse rather than
 *    fabricating a `null` over an unknown real value. Both `record` and
 *    `previous` are covered. The totality criterion above is therefore
 *    SATISFIED here too, and the evidence this row used to carry (the raw
 *    `{...(inputData ?? {}), ...after}` seed) describes code that no longer
 *    exists.
 *
 *    What keeps the row excluded is the SAME clause-3 reason the
 *    `readonlyWhen` row states: the gate's actual widening is tracked
 *    separately (#4811), not folded into this seam's own PR.
 *    (The flattened-scope ambiguity is real for a *bare-identifier* checker —
 *    flow inputs shadow record fields, and a node's `outputVariable` can
 *    overwrite either — but that is a different, unbuilt pass.)
 *  - **Field `expression`** (the slot `Field.formula({ expression: … })`
 *    writes; spelled `formula` here until #5026 renamed the read to the key
 *    `FieldSchema` actually declares). Excluded by product judgement, not by
 *    this criterion: a formula is `value`-role and natively nullable, and
 *    `guard ? value : null` is the blessed shape (#3306 rewrites it via
 *    `dyn(...)`). Making guarded arithmetic mandatory there would change what
 *    authors are *allowed to write*, which is a decision for the maintainer,
 *    not a wiring gap to close. Note this exclusion is about the NULL-GUARD
 *    verdict only — since #5026 the slot does carry the syntax /
 *    field-existence / bare-reference verdicts, which it never did before.
 */

import { parseCelToAst } from '@objectstack/formula';
import type { CelAstNode } from '@objectstack/formula';

/**
 * The corrective sentence, lifted **verbatim** from `unevaluableRuleError` in
 * `packages/objectql/src/validation/rule-validator.ts` so the publish-time and
 * runtime messages read identically — an author who hits one and then the other
 * must not have to reconcile two phrasings of one rule (#4763).
 */
export const NULL_GUARD_HINT =
  `Guard it with '!= null'` +
  ` — 'has(x)' does NOT do that: a declared field holding null is still PRESENT, so has(x) is true.`;

/** Ordering + arithmetic operators — the ones with no `null` overload. */
const FAULTING_BINARY_OPS = new Set(['<', '<=', '>', '>=', '+', '-', '*', '/', '%']);

/** Roots that bind the object's declared record shape (total since #4649). */
const DEFAULT_RECORD_ROOTS = ['record', 'previous'] as const;

export interface NullGuardOptions {
  /** Field names of the object that may hold `null` at evaluation time. */
  nullableFields: ReadonlySet<string>;
  /** Roots bound to the object's record shape. Defaults to `record`/`previous`. */
  roots?: readonly string[];
}

export interface NullGuardFinding {
  /** The operand as written, e.g. `record.end_date`. */
  operand: string;
  /** The declared field the operand resolves to, e.g. `end_date`. */
  field: string;
  /** The operator with no null overload, e.g. `<`. */
  operator: string;
  /**
   * True when the predicate "guards" this operand with `has()` and nothing
   * else — the exact trap #4763 exists to reject. Used only to sharpen the
   * message; the verdict is the same either way.
   */
  hasOnlyGuard: boolean;
}

type AnyNode = { op?: string; args?: unknown };

function isNode(v: unknown): v is AnyNode & CelAstNode {
  return !!v && typeof v === 'object' && typeof (v as AnyNode).op === 'string';
}

function isNullLiteral(node: unknown): boolean {
  return isNode(node) && node.op === 'value' && (node as AnyNode).args === null;
}

/**
 * `record.<field>` (or `previous.<field>`) → the field name; anything else —
 * a bare id, a nested traversal `record.account.region`, an index — → null.
 * Deliberately single-segment: a nested path is a lookup traversal whose
 * nullability this object's field list cannot decide.
 */
function fieldOf(node: unknown, roots: readonly string[]): { operand: string; field: string } | null {
  if (!isNode(node)) return null;
  if (node.op !== '.' && node.op !== '.?') return null;
  const args = node.args as unknown;
  if (!Array.isArray(args) || args.length < 2) return null;
  const [recv, seg] = args as [unknown, unknown];
  if (typeof seg !== 'string') return null;
  if (!isNode(recv) || recv.op !== 'id') return null;
  const root = (recv as AnyNode).args;
  if (typeof root !== 'string' || !roots.includes(root)) return null;
  return { operand: `${root}.${seg}`, field: seg };
}

/** Children of a node, whatever its arg shape. */
function childNodes(node: AnyNode): unknown[] {
  const args = node.args;
  if (isNode(args)) return [args];
  if (!Array.isArray(args)) return [];
  const out: unknown[] = [];
  for (const a of args) {
    if (isNode(a)) out.push(a);
    else if (Array.isArray(a)) for (const b of a) if (isNode(b)) out.push(b);
  }
  return out;
}

function callName(node: AnyNode): string | null {
  if (node.op !== 'call') return null;
  const args = node.args;
  if (!Array.isArray(args) || typeof args[0] !== 'string') return null;
  return args[0];
}

function callArgs(node: AnyNode): unknown[] {
  const args = node.args;
  if (!Array.isArray(args) || !Array.isArray(args[1])) return [];
  return args[1] as unknown[];
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a, ...b]);
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

/**
 * Operands proven non-null **when `node` evaluates true**.
 *
 * `has(x)` is conspicuously absent, and its absence is the rule: a present key
 * is not a non-null value. `isBlank(x)` is absent for the mirrored reason —
 * `isBlank` being *true* says nothing about non-nullness (it is true FOR null);
 * it appears in {@link falseGuards} instead.
 */
function truthGuards(node: unknown, roots: readonly string[]): Set<string> {
  if (!isNode(node)) return new Set();
  switch (node.op) {
    case '!=': {
      const [l, r] = (node.args as [unknown, unknown]) ?? [];
      if (isNullLiteral(r)) {
        const f = fieldOf(l, roots);
        return f ? new Set([f.operand]) : new Set();
      }
      if (isNullLiteral(l)) {
        const f = fieldOf(r, roots);
        return f ? new Set([f.operand]) : new Set();
      }
      return new Set();
    }
    case '&&': {
      const [l, r] = node.args as [unknown, unknown];
      return union(truthGuards(l, roots), truthGuards(r, roots));
    }
    case '||': {
      const [l, r] = node.args as [unknown, unknown];
      // Only what BOTH arms prove survives the disjunction.
      return intersect(truthGuards(l, roots), truthGuards(r, roots));
    }
    case '!_':
      return falseGuards(node.args, roots);
    case '?:': {
      const [, t, f] = node.args as [unknown, unknown, unknown];
      return intersect(truthGuards(t, roots), truthGuards(f, roots));
    }
    default:
      return new Set();
  }
}

/** Operands proven non-null **when `node` evaluates false** (the `!`/`||` side). */
function falseGuards(node: unknown, roots: readonly string[]): Set<string> {
  if (!isNode(node)) return new Set();
  switch (node.op) {
    case '==': {
      const [l, r] = (node.args as [unknown, unknown]) ?? [];
      if (isNullLiteral(r)) {
        const f = fieldOf(l, roots);
        return f ? new Set([f.operand]) : new Set();
      }
      if (isNullLiteral(l)) {
        const f = fieldOf(r, roots);
        return f ? new Set([f.operand]) : new Set();
      }
      return new Set();
    }
    case '||': {
      const [l, r] = node.args as [unknown, unknown];
      return union(falseGuards(l, roots), falseGuards(r, roots));
    }
    case '&&': {
      const [l, r] = node.args as [unknown, unknown];
      return intersect(falseGuards(l, roots), falseGuards(r, roots));
    }
    case '!_':
      return truthGuards(node.args, roots);
    case 'call': {
      // `!isBlank(record.x)` / `isBlank(record.x) ? … : <here>` — a false
      // `isBlank` DOES prove non-null (it is the stdlib's blank-or-null test).
      if (callName(node) !== 'isBlank') return new Set();
      const [only] = callArgs(node);
      const f = fieldOf(only, roots);
      return f ? new Set([f.operand]) : new Set();
    }
    default:
      return new Set();
  }
}

/** Collect every `has(record.<f>)` operand appearing anywhere in the tree. */
function collectHasOperands(node: unknown, roots: readonly string[], out: Set<string>): void {
  if (!isNode(node)) return;
  if (callName(node) === 'has') {
    for (const a of callArgs(node)) {
      const f = fieldOf(a, roots);
      if (f) out.add(f.operand);
    }
  }
  for (const child of childNodes(node)) collectHasOperands(child, roots, out);
}

/**
 * Find every ordering/arithmetic operand that resolves to a nullable declared
 * field and is not dominated by a real null guard. Returns `[]` for anything
 * that does not parse — this pass never invents a second syntax verdict.
 *
 * "Does not parse" is deliberately **not** this module's own opinion (#4812).
 * The AST comes from `@objectstack/formula`'s `parseCelToAst`, the same front
 * end `celEngine.compile`/`evaluate` use, so the set of sources this gate can
 * reason about is exactly the set the platform accepts — rewrite (#3306) and
 * `DEFAULT_LIMITS` included. This module used to build its own bare
 * `new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true })`,
 * which carried **no limits**: it parsed, and then adjudicated, predicates that
 * `compile()` rejects outright at `Exceeded maxAstNodes (256)` / `maxDepth (32)`
 * / `maxListElements (64)`. Two parse entries, two answers to "what can be
 * parsed" — and this gate held the more permissive one.
 *
 * A source the canonical front end will not parse is therefore left entirely to
 * the gate that owns that verdict: `validateExpression` runs at the very same
 * call sites (`validate-expressions.ts` calls `check()` alongside
 * `checkNullGuards()`) and reports the syntax fault or the bounds fault as a
 * blocking error, with a message written for self-correction. Nothing is lost
 * by staying silent here — and once the author fixes the fault the null-guard
 * verdict comes back on the next run.
 */
export function findUnguardedNullableOperands(
  source: string,
  opts: NullGuardOptions,
): NullGuardFinding[] {
  if (typeof source !== 'string' || !source.trim()) return [];
  if (opts.nullableFields.size === 0) return [];
  const roots = opts.roots ?? DEFAULT_RECORD_ROOTS;

  const ast = parseCelToAst(source);
  if (!ast) return [];

  const hasOperands = new Set<string>();
  collectHasOperands(ast, roots, hasOperands);

  const findings: NullGuardFinding[] = [];
  const seen = new Set<string>();

  const report = (operandNode: unknown, operator: string, guards: ReadonlySet<string>): void => {
    const f = fieldOf(operandNode, roots);
    if (!f) return;
    if (!opts.nullableFields.has(f.field)) return;
    if (guards.has(f.operand)) return;
    // NUL separates the composite key's two halves (it can appear in neither a
    // field path nor an operator). Written as the `\u0000` ESCAPE, never as a raw
    // byte: a raw NUL makes grep/ripgrep treat the whole file as binary and
    // silently return ZERO matches, so the file drops out of code search and out
    // of every grep-based lint - and git will not warn you, because it only
    // inspects the first 8000 bytes to decide binary-ness. Same convention as
    // `packages/rest/src/rest-server.ts`. `\u0000` rather than `\0`, which turns
    // into a legacy-octal-escape error the moment a digit follows it.
    const key = `${f.operand}\u0000${operator}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      operand: f.operand,
      field: f.field,
      operator,
      hasOnlyGuard: hasOperands.has(f.operand),
    });
  };

  const visit = (node: unknown, guards: ReadonlySet<string>): void => {
    if (!isNode(node)) return;
    const op = node.op as string;

    if (op === '&&') {
      const [l, r] = node.args as [unknown, unknown];
      visit(l, guards);
      // Left-to-right: only the LEFT conjunct's proofs reach the right one.
      visit(r, union(guards, truthGuards(l, roots)));
      return;
    }
    if (op === '||') {
      const [l, r] = node.args as [unknown, unknown];
      visit(l, guards);
      // Reaching the right arm means the left one was FALSE.
      visit(r, union(guards, falseGuards(l, roots)));
      return;
    }
    if (op === '?:') {
      const [c, t, f] = node.args as [unknown, unknown, unknown];
      visit(c, guards);
      visit(t, union(guards, truthGuards(c, roots)));
      visit(f, union(guards, falseGuards(c, roots)));
      return;
    }
    if (op === 'call' && callName(node) === 'has') {
      // `has(x)` itself never faults — and it never counts as a guard either.
      return;
    }
    if (FAULTING_BINARY_OPS.has(op)) {
      const [l, r] = node.args as [unknown, unknown];
      report(l, op, guards);
      report(r, op, guards);
      visit(l, guards);
      visit(r, guards);
      return;
    }
    if (op === '-_') {
      report(node.args, '-', guards);
      visit(node.args, guards);
      return;
    }
    for (const child of childNodes(node)) visit(child, guards);
  };

  visit(ast, new Set<string>());
  return findings;
}

/**
 * What the surface actually DOES once the predicate aborts (#4811).
 *
 * Both outcomes are bugs, but they are *opposite* bugs, and an author needs to
 * be told which one they have: "your write will be refused" and "your rule will
 * never fire" send you to different places. Never guess one — read the
 * surface's runtime and name what it really implements.
 */
export type NullGuardOutcome =
  /** Validation rules + hook conditions: the fault propagates, the write is refused (#4761). */
  | 'fail-closed'
  /** Field `requiredWhen`: `rule-validator.ts` logs and skips, so nothing is enforced (#4811). */
  | 'fail-open';

const OUTCOME_CLAUSE: Record<NullGuardOutcome, string> = {
  'fail-closed':
    'so the rule enforces nothing and the write is rejected fail-closed (#4649/#4763)',
  'fail-open':
    'so the predicate is SKIPPED fail-open — the field is never actually required, the write ' +
    'proceeds unchecked, and the only trace is a `requiredWhen … failed to evaluate — skipped` ' +
    'log line (#4649/#4811)',
};

/**
 * The publish-time message for one finding. Names the rule, the operand and the
 * `!= null` fix (the three things the author needs), then closes with the
 * verbatim runtime sentence so the two gates speak with one voice.
 *
 * @param subject  How the site names itself, e.g. `validation rule 'end_after_start'`.
 * @param objectName  The object whose field list decided nullability.
 * @param finding  The unguarded operand to report.
 * @param outcome  What this surface's runtime does with the abort. Defaults to
 *   `fail-closed` — what both #4763 surfaces do.
 */
export function nullGuardMessage(
  subject: string,
  objectName: string | undefined,
  finding: NullGuardFinding,
  outcome: NullGuardOutcome = 'fail-closed',
): string {
  const owner = objectName ? `'${objectName}'` : 'this object';
  const hasNote = finding.hasOnlyGuard
    ? ` \`has(${finding.operand})\` does not guard it.`
    : '';
  return (
    `${subject} applies \`${finding.operator}\` to \`${finding.operand}\`, which ${owner} declares ` +
    `as nullable (no \`required: true\`, no \`defaultValue\`).${hasNote} At runtime the operand is ` +
    `null, CEL has no \`${finding.operator}\` overload for null, and the whole predicate aborts — ` +
    `${OUTCOME_CLAUSE[outcome]}. ` +
    `The predicate compares a value that is null. ${NULL_GUARD_HINT}`
  );
}
