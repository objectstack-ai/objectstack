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
 */

import { Environment } from '@marcbachmann/cel-js';
import type { ASTNode } from '@marcbachmann/cel-js';

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

// A check-only parse environment: no evaluation, no stdlib needed, every
// identifier stays `dyn` so any authored predicate parses. Built once.
let parseEnv: Environment | undefined;
function getParseEnv(): Environment {
  if (!parseEnv) {
    parseEnv = new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true });
  }
  return parseEnv;
}

type AnyNode = { op?: string; args?: unknown };

function isNode(v: unknown): v is AnyNode & ASTNode {
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
 * that does not parse (syntax is reported by `validateExpression`, not here) —
 * this pass never invents a second syntax verdict.
 */
export function findUnguardedNullableOperands(
  source: string,
  opts: NullGuardOptions,
): NullGuardFinding[] {
  if (typeof source !== 'string' || !source.trim()) return [];
  if (opts.nullableFields.size === 0) return [];
  const roots = opts.roots ?? DEFAULT_RECORD_ROOTS;

  let ast: ASTNode;
  try {
    ast = getParseEnv().parse(source).ast;
  } catch {
    return [];
  }

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
 * The publish-time message for one finding. Names the rule, the operand and the
 * `!= null` fix (the three things the author needs), then closes with the
 * verbatim runtime sentence so the two gates speak with one voice.
 *
 * @param subject  How the site names itself, e.g. `validation rule 'end_after_start'`.
 * @param objectName  The object whose field list decided nullability.
 */
export function nullGuardMessage(
  subject: string,
  objectName: string | undefined,
  finding: NullGuardFinding,
): string {
  const owner = objectName ? `'${objectName}'` : 'this object';
  const hasNote = finding.hasOnlyGuard
    ? ` \`has(${finding.operand})\` does not guard it.`
    : '';
  return (
    `${subject} applies \`${finding.operator}\` to \`${finding.operand}\`, which ${owner} declares ` +
    `as nullable (no \`required: true\`, no \`defaultValue\`).${hasNote} At runtime the operand is ` +
    `null, CEL has no \`${finding.operator}\` overload for null, and the whole predicate aborts — ` +
    `so the rule enforces nothing and the write is rejected fail-closed (#4649/#4763). ` +
    `The predicate compares a value that is null. ${NULL_GUARD_HINT}`
  );
}
