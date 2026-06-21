// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical CEL → FilterCondition pushdown compiler (ADR-0058 D1/D2/D6).
 *
 * ObjectStack has ONE authoring language (CEL) and ONE good interpreter
 * (`cel-engine.ts`), but historically THREE disconnected "compile-to-filter"
 * front-ends: `plugin-security/rls-compiler.ts`'s 4-form regex, `plugin-sharing`'s
 * `celToFilter`, and the ObjectUI array-AST path. They diverged — which is the
 * root of #1887 (a sharing `condition` that the interpreter understands but no
 * compiler lowers, so it never enforces).
 *
 * This module is the single, canonical lowering. It takes the **same parsed
 * `@marcbachmann/cel-js` AST the interpreter uses** (`env.parse(src).ast`) and
 * lowers the pushdown-able subset to a Mongo-style {@link FilterCondition} — the
 * one shape BOTH backends already consume: the ObjectQL engine `where` (AND-injected
 * by plugin-security) and the analytics SQL backend
 * (`service-analytics/read-scope-sql.ts`). One AST, two backends (D6).
 *
 * ## Supported subset (ADR-0058 D2)
 *   `==` `!=` `>` `<` `>=` `<=` · `in` (→ `$in`) · `&&` `||` `!` ·
 *   `== null` / `!= null` (→ `$null`) · string methods `startsWith` / `endsWith`
 *   / `contains` (→ `$startsWith` / `$endsWith` / `$contains`).
 *   `not in` is `!(x in y)`. Negation wraps in `$not`.
 *
 * ## Hard boundaries (ADR-0055 stands)
 *   - **No subqueries, no cross-object traversal.** A field path is a SINGLE
 *     column (`record.region` → `region`, bare `owner` → `owner`). A multi-segment
 *     relation path (`record.account.region`) is an authoring-time compile error,
 *     not a silent join.
 *   - Arithmetic (`+ - * / %`), function calls (`size(...)`), ternary, maps, and
 *     any other non-pushdown shape are a compile error — NEVER silently dropped.
 *     A dropped predicate leaves an object unprotected; failing closed is the
 *     security-correct outcome (ADR-0049/0056 D4).
 *
 * ## Value resolution
 *   A leaf rooted at a `variableRoot` (default `current_user`) is resolved against
 *   `opts.variables` to a literal — `current_user.id` → the caller's id,
 *   `current_user.org_user_ids` → a pre-resolved membership array for `$in`
 *   (honours ADR-0055: the runtime pre-resolves the set; the compiler never emits
 *   a subquery). A variable that resolves to `undefined`/`null` yields
 *   `unresolved-variable` (the "no active org" fail-closed path).
 */

import { Environment } from '@marcbachmann/cel-js';
import type { ASTNode } from '@marcbachmann/cel-js';
import type { FilterCondition } from '@objectstack/spec/data';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type CelFilterFailReason =
  /** CEL did not parse (syntax error). */
  | 'parse-error'
  /** Shape is not pushdown-able (arithmetic, function call, relation traversal, …). */
  | 'unsupported'
  /** A required `variableRoot` reference was undefined/null in `variables`. */
  | 'unresolved-variable';

export type CelFilterCompileResult =
  | { ok: true; filter: FilterCondition }
  | { ok: false; reason: CelFilterFailReason; detail: string };

export interface CelFilterCompileOptions {
  /** Member-access roots that denote a record FIELD path. Default `['record']`. */
  fieldRoots?: readonly string[];
  /** Roots resolved as VALUES against {@link variables}. Default `['current_user']`. */
  variableRoots?: readonly string[];
  /**
   * Value-resolution context, keyed by variable root. e.g.
   * `{ current_user: { id, organization_id, org_user_ids } }`. A `record.*`
   * (field) reference is NEVER resolved here — only `variableRoot` leaves are.
   */
  variables?: Record<string, unknown>;
}

/** Symbol returned for a variable leaf during a shape-only check (never executed). */
const SHAPE_VALUE = Symbol('cel-filter-shape-placeholder');

class CompileError extends Error {
  constructor(public reason: CelFilterFailReason, message: string) {
    super(message);
    this.name = 'CelFilterCompileError';
  }
}

// A roots-permissive env: parsing is purely syntactic (we read `.ast`, never
// `.check()`/`.evaluate()`), so any identifier or method call parses. Built once.
let parseEnv: Environment | undefined;
function getParseEnv(): Environment {
  if (!parseEnv) {
    parseEnv = new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true });
  }
  return parseEnv;
}

/** Unwrap a CEL expression input — accepts a raw string or `{ source }`. */
function toSource(input: string | { source?: string } | null | undefined): string | null {
  if (typeof input === 'string') return input.trim() || null;
  if (input && typeof input === 'object' && typeof input.source === 'string') {
    return input.source.trim() || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Compile a CEL predicate into a {@link FilterCondition}, resolving `variableRoot`
 * leaves against `opts.variables`. Returns a discriminated result — never throws
 * for an authoring-level fault; a `false` result with a reason is the caller's
 * cue to fail closed (deny) or surface a compile error.
 */
export function compileCelToFilter(
  input: string | { source?: string },
  opts: CelFilterCompileOptions = {},
): CelFilterCompileResult {
  const source = toSource(input);
  if (!source) return { ok: false, reason: 'parse-error', detail: 'empty expression' };
  let ast: ASTNode;
  try {
    ast = getParseEnv().parse(source).ast;
  } catch (err) {
    return { ok: false, reason: 'parse-error', detail: (err as Error).message?.split('\n')[0] ?? 'parse error' };
  }
  return lowerCelAst(ast, opts, 'value');
}

/**
 * Shape-only check: is this CEL predicate pushdown-able at all? Used by the
 * authoring gate (ADR-0056 D4) to REJECT a predicate the runtime could only
 * silently drop. Does not resolve `variables`.
 */
export function isPushdownableCel(
  input: string | { source?: string },
  opts: Pick<CelFilterCompileOptions, 'fieldRoots' | 'variableRoots'> = {},
): { ok: true } | { ok: false; reason: CelFilterFailReason; detail: string } {
  const source = toSource(input);
  if (!source) return { ok: false, reason: 'parse-error', detail: 'empty expression' };
  let ast: ASTNode;
  try {
    ast = getParseEnv().parse(source).ast;
  } catch (err) {
    return { ok: false, reason: 'parse-error', detail: (err as Error).message?.split('\n')[0] ?? 'parse error' };
  }
  const res = lowerCelAst(ast, opts, 'shape');
  return res.ok ? { ok: true } : { ok: false, reason: res.reason, detail: res.detail };
}

/**
 * Lower a pre-parsed cel-js AST node — the variant that lets the interpreter and
 * the compiler share ONE parse (ADR-0058 D6, "one AST, two backends").
 */
export function lowerCelAst(
  ast: ASTNode,
  opts: CelFilterCompileOptions = {},
  mode: 'value' | 'shape' = 'value',
): CelFilterCompileResult {
  const ctx: Ctx = {
    fieldRoots: new Set(opts.fieldRoots ?? ['record']),
    variableRoots: new Set(opts.variableRoots ?? ['current_user']),
    variables: opts.variables ?? {},
    mode,
  };
  try {
    return { ok: true, filter: lowerCondition(ast, ctx) };
  } catch (err) {
    if (err instanceof CompileError) return { ok: false, reason: err.reason, detail: err.message };
    return { ok: false, reason: 'unsupported', detail: (err as Error).message ?? 'compile error' };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Ctx {
  fieldRoots: Set<string>;
  variableRoots: Set<string>;
  variables: Record<string, unknown>;
  mode: 'value' | 'shape';
}

type Leaf =
  | { kind: 'field'; path: string }
  | { kind: 'literal'; value: unknown }
  | { kind: 'var'; path: string[] };

const FLIP: Record<string, string> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=', '==': '==', '!=': '!=' };
const CMP_OP: Record<string, string> = { '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte' };
const STRING_METHOD: Record<string, string> = { startsWith: '$startsWith', endsWith: '$endsWith', contains: '$contains' };

/** Lower a boolean-valued node into a FilterCondition. Throws CompileError. */
function lowerCondition(node: ASTNode, ctx: Ctx): FilterCondition {
  const op = node.op;
  const args = node.args as unknown;
  switch (op) {
    case '&&':
      return combine('$and', node, ctx);
    case '||':
      return combine('$or', node, ctx);
    case '!_':
      return { $not: lowerCondition(args as ASTNode, ctx) };
    case '==':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=':
      return lowerComparison(op, (args as [ASTNode, ASTNode])[0], (args as [ASTNode, ASTNode])[1], ctx);
    case 'in':
      return lowerMembership((args as [ASTNode, ASTNode])[0], (args as [ASTNode, ASTNode])[1], ctx);
    case 'rcall':
      return lowerStringMethod(args as [string, ASTNode, ASTNode[]], ctx);
    case 'value': {
      // A bare boolean condition. `true` → no restriction; anything else fails
      // closed (we never let a non-true constant become allow-all).
      const v = coerceLiteral(args);
      if (v === true) return {};
      throw new CompileError('unsupported', `constant non-true predicate (${String(v)})`);
    }
    default:
      throw new CompileError('unsupported', `unsupported operator "${String(op)}"`);
  }
}

function combine(key: '$and' | '$or', node: ASTNode, ctx: Ctx): FilterCondition {
  const [l, r] = node.args as [ASTNode, ASTNode];
  const parts: FilterCondition[] = [];
  for (const child of [lowerCondition(l, ctx), lowerCondition(r, ctx)]) {
    // Flatten same-key nesting so `a && b && c` is one `$and: [a,b,c]`.
    const nested = (child as Record<string, unknown>)[key];
    if (Array.isArray(nested) && Object.keys(child).length === 1) parts.push(...(nested as FilterCondition[]));
    else parts.push(child);
  }
  return { [key]: parts } as FilterCondition;
}

function lowerComparison(op: string, lNode: ASTNode, rNode: ASTNode, ctx: Ctx): FilterCondition {
  const L = classify(lNode, ctx);
  const R = classify(rNode, ctx);
  const lField = L.kind === 'field';
  const rField = R.kind === 'field';

  if (lField && rField) {
    // field-to-field comparison → `{ $field: otherPath }` reference.
    return emit((L as { path: string }).path, op, { $field: (R as { path: string }).path }, true);
  }
  if (lField) return emit((L as { path: string }).path, op, resolveValue(R, ctx), false);
  if (rField) return emit((R as { path: string }).path, FLIP[op] ?? op, resolveValue(L, ctx), false);

  // Neither side is a field: a constant comparison. Fold the always-true case
  // (`1 == 1`, the RLS allow-all) to "no restriction"; refuse the rest (a
  // non-true constant must fail closed, never become allow-all).
  const lv = resolveValue(L, ctx);
  const rv = resolveValue(R, ctx);
  if (ctx.mode === 'shape') return {}; // shape check: structurally fine
  const truth = constFold(op, lv, rv);
  if (truth === true) return {};
  throw new CompileError('unsupported', `constant ${op} predicate that is not always-true`);
}

function lowerMembership(elemNode: ASTNode, containerNode: ASTNode, ctx: Ctx): FilterCondition {
  const elem = classify(elemNode, ctx);
  if (elem.kind !== 'field') {
    throw new CompileError('unsupported', `\`in\` requires a field on the left (got ${elem.kind})`);
  }
  const container = classify(containerNode, ctx);
  const value = resolveValue(container, ctx);
  if (value !== SHAPE_VALUE && !Array.isArray(value)) {
    throw new CompileError('unsupported', `\`in\` requires an array/list on the right`);
  }
  return { [(elem as { path: string }).path]: { $in: value } } as FilterCondition;
}

function lowerStringMethod(args: [string, ASTNode, ASTNode[]], ctx: Ctx): FilterCondition {
  const [method, receiver, callArgs] = args;
  const mapped = STRING_METHOD[method];
  if (!mapped) throw new CompileError('unsupported', `unsupported method "${method}()"`);
  const recv = classify(receiver, ctx);
  if (recv.kind !== 'field') throw new CompileError('unsupported', `"${method}()" must be called on a field`);
  if (!Array.isArray(callArgs) || callArgs.length !== 1) {
    throw new CompileError('unsupported', `"${method}()" takes exactly one argument`);
  }
  const arg = resolveValue(classify(callArgs[0], ctx), ctx);
  if (arg !== SHAPE_VALUE && typeof arg !== 'string') {
    throw new CompileError('unsupported', `"${method}()" argument must be a string literal`);
  }
  return { [(recv as { path: string }).path]: { [mapped]: arg } } as FilterCondition;
}

/** Build `{ field: <op> value }`. `isRef` true → value is a `{ $field }` reference. */
function emit(field: string, op: string, value: unknown, isRef: boolean): FilterCondition {
  if (op === '==') {
    if (!isRef && value === null) return { [field]: { $null: true } } as FilterCondition;
    if (isRef) return { [field]: { $eq: value } } as FilterCondition;
    return { [field]: value } as FilterCondition; // implicit equality
  }
  if (op === '!=') {
    if (!isRef && value === null) return { [field]: { $null: false } } as FilterCondition;
    return { [field]: { $ne: value } } as FilterCondition;
  }
  const cmp = CMP_OP[op];
  if (cmp) return { [field]: { [cmp]: value } } as FilterCondition;
  throw new CompileError('unsupported', `unsupported comparison "${op}"`);
}

/** Syntactically classify an operand node. Throws on a non-pushdown shape. */
function classify(node: ASTNode, ctx: Ctx): Leaf {
  switch (node.op) {
    case 'value':
      return { kind: 'literal', value: coerceLiteral(node.args) };
    case 'list': {
      const items = (node.args as ASTNode[]).map((n) => {
        const leaf = classify(n, ctx);
        if (leaf.kind !== 'literal') {
          throw new CompileError('unsupported', 'list elements must be literals');
        }
        return leaf.value;
      });
      return { kind: 'literal', value: items };
    }
    case 'id': {
      const name = node.args as string;
      if (ctx.variableRoots.has(name)) return { kind: 'var', path: [name] };
      // Bare identifier = a single record field (RLS convention).
      return { kind: 'field', path: name };
    }
    case '.':
    case '.?': {
      const [recv, field] = node.args as [ASTNode, string];
      const chain = memberChain(recv, field);
      if (!chain) throw new CompileError('unsupported', 'unsupported member-access expression');
      const [root, ...rest] = chain;
      if (ctx.variableRoots.has(root)) return { kind: 'var', path: chain };
      if (ctx.fieldRoots.has(root)) {
        if (rest.length !== 1) {
          // `record.account.region` = cross-object traversal (ADR-0055): refuse.
          throw new CompileError('unsupported', `cross-object/nested field path "${chain.join('.')}" is not pushdown-able`);
        }
        return { kind: 'field', path: rest[0] };
      }
      // A `.`-chain rooted at an unknown identifier = relation traversal.
      throw new CompileError('unsupported', `cross-object field path "${chain.join('.')}" is not pushdown-able`);
    }
    default:
      throw new CompileError('unsupported', `unsupported operand "${String(node.op)}"`);
  }
}

/** Flatten a `.`-member chain into `[root, seg, seg, …]`, or null if not a pure path. */
function memberChain(recv: ASTNode, field: string): string[] | null {
  if (recv.op === 'id') return [recv.args as string, field];
  if (recv.op === '.' || recv.op === '.?') {
    const [innerRecv, innerField] = recv.args as [ASTNode, string];
    const inner = memberChain(innerRecv, innerField);
    return inner ? [...inner, field] : null;
  }
  return null;
}

/** Resolve a leaf to its VALUE (literal directly; var via `variables`). */
function resolveValue(leaf: Leaf, ctx: Ctx): unknown {
  if (leaf.kind === 'literal') return leaf.value;
  if (leaf.kind === 'field') {
    throw new CompileError('unsupported', `expected a value but got field "${leaf.path}"`);
  }
  // var
  if (ctx.mode === 'shape') return SHAPE_VALUE;
  let cur: unknown = ctx.variables;
  for (const seg of leaf.path) {
    if (cur == null || typeof cur !== 'object') {
      throw new CompileError('unresolved-variable', `variable "${leaf.path.join('.')}" is not resolvable`);
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur === undefined || cur === null) {
    throw new CompileError('unresolved-variable', `variable "${leaf.path.join('.')}" is ${String(cur)}`);
  }
  return cur;
}

/** Coerce a cel-js literal to a plain JS value (cel-js uses BigInt for ints). */
function coerceLiteral(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  // `v` is already non-null here (the line above returns for null), so a
  // further `v !== null` would be a dead comparison; rely on the early return.
  if (typeof v === 'object' && typeof (v as { valueOf?: unknown }).valueOf === 'function') {
    const prim = (v as { valueOf: () => unknown }).valueOf();
    if (typeof prim === 'bigint') return Number(prim);
    if (typeof prim === 'number' || typeof prim === 'string' || typeof prim === 'boolean') return prim;
  }
  throw new CompileError('unsupported', `unsupported literal type "${typeof v}"`);
}

/** Compile-time fold of a comparison between two concrete values. */
function constFold(op: string, l: unknown, r: unknown): boolean | undefined {
  switch (op) {
    case '==': return l === r;
    case '!=': return l !== r;
    case '>': return (l as number) > (r as number);
    case '>=': return (l as number) >= (r as number);
    case '<': return (l as number) < (r as number);
    case '<=': return (l as number) <= (r as number);
    default: return undefined;
  }
}
