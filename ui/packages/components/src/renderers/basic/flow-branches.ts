/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The decision branches of a flow, and a readable form of their conditions,
 * for the business view of `element:metadata_viewer`'s `type: flow` embed
 * (ADR-0051: the embed draws the LIVE definition, so the text here is derived
 * from the served flow on every render and never copied into a manual).
 *
 * Two halves, both pure:
 *
 *  - {@link decisionBranches} reads where a decision routes, in the two forms
 *    the automation engine runs: a decision that declares `config.conditions`
 *    takes the out-edge whose `label` names the first matching branch (or the
 *    `default` / `isDefault` edge when none matches); a decision that declares
 *    none is a gateway whose out-edges carry their own `condition`.
 *  - {@link readCondition} turns a CEL predicate into text such as
 *    `Amount > 500,000`, or answers `null` when the predicate is outside the
 *    small grammar it reads. The caller shows a neutral "condition" marker for
 *    `null`, never the raw expression.
 *
 * The reader understands comparisons of one record field with one literal,
 * joined by `&&` / `||`, with parentheses. Presence guards on a compared field
 * (`has(x)`, `x != null` under `&&`; `!has(x)`, `x == null` under `||`) are
 * dropped: the platform's null-guard rule makes every ordering comparison
 * carry one, so they are plumbing, not the business rule. Anything else (a
 * function call, a field compared with a field, `previous.*`, a flow variable
 * that is not a read of the flow's own object, an escape in a string) is not
 * read at all.
 */

// ---------------------------------------------------------------------------
// Graph: decisions and their branches
// ---------------------------------------------------------------------------

/** Where one branch of a decision goes, and on what. */
export type BranchGuard =
  /** The branch carries a CEL predicate (its source). */
  | { kind: 'cel'; source: string }
  /** The branch is taken when no sibling branch matched. */
  | { kind: 'otherwise' }
  /** The branch carries a condition in a form this view does not read. */
  | { kind: 'opaque' }
  /** The out-edge carries no condition at all. */
  | { kind: 'none' };

export interface DecisionBranch {
  /** The out-edge's id, or its position when it has none. */
  key: string;
  /** The node id the branch leads to. */
  target: string;
  guard: BranchGuard;
}

/** The label a decision's fall-through branch carries (`DEFAULT_BRANCH_LABEL` in the engine). */
const DEFAULT_BRANCH = 'default';

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The guard an evaluated-expression slot carries, read as the spec's
 * `EvaluatedExpressionInputSchema` admits it: a bare CEL string, or a
 * `{ dialect: 'cel', source }` envelope (what a parse normalizes the string
 * to). Any other value is a condition this view cannot read.
 */
function guardOf(value: unknown): BranchGuard {
  if (value === undefined || value === null) return { kind: 'none' };
  if (typeof value === 'string') return value.trim() ? { kind: 'cel', source: value } : { kind: 'opaque' };
  if (isRec(value) && value.dialect === 'cel' && typeof value.source === 'string' && value.source.trim()) {
    return { kind: 'cel', source: value.source };
  }
  return { kind: 'opaque' };
}

/** Every out-edge of `nodeId`, in declaration order (the order the engine tries them in). */
function outEdges(flow: unknown, nodeId: string): Rec[] {
  const edges = isRec(flow) && Array.isArray(flow.edges) ? flow.edges : [];
  return edges.filter((e): e is Rec => isRec(e) && e.source === nodeId && typeof e.target === 'string');
}

/**
 * The branches of the decision node `node`, in declaration order. An out-edge
 * no branch can ever take (a labelled edge of a `config.conditions` decision
 * whose label no condition and no default claims) is left out.
 */
export function decisionBranches(flow: unknown, node: unknown): DecisionBranch[] {
  if (!isRec(node) || node.type !== 'decision' || typeof node.id !== 'string') return [];
  const config = isRec(node.config) ? node.config : undefined;
  const conditions = Array.isArray(config?.conditions) ? config.conditions.filter(isRec) : [];
  const branches: DecisionBranch[] = [];
  outEdges(flow, node.id).forEach((edge, i) => {
    const key = typeof edge.id === 'string' ? edge.id : String(i);
    const target = edge.target as string;
    if (edge.isDefault === true || (conditions.length > 0 && edge.label === DEFAULT_BRANCH)) {
      branches.push({ key, target, guard: { kind: 'otherwise' } });
      return;
    }
    if (conditions.length === 0) {
      branches.push({ key, target, guard: guardOf(edge.condition) });
      return;
    }
    const claimed = conditions.find((c) => typeof edge.label === 'string' && c.label === edge.label);
    if (!claimed) return;
    const guard = guardOf(claimed.expression);
    branches.push({ key, target, guard: guard.kind === 'none' ? { kind: 'opaque' } : guard });
  });
  return branches;
}

/** The predicate a flow's start node gates its runs on, if it declares one. */
export function entryGuard(flow: unknown): BranchGuard {
  const nodes = isRec(flow) && Array.isArray(flow.nodes) ? flow.nodes : [];
  const start = nodes.find((n): n is Rec => isRec(n) && n.type === 'start');
  return guardOf(isRec(start?.config) ? start.config.condition : undefined);
}

/**
 * The object the flow's conditions read: the start node's `objectName` (the
 * record that triggers the run), plus every `get_record` output variable that
 * reads the same object. A variable that reads another object is not
 * resolved, so the embed needs exactly one object definition.
 */
export interface FlowSubjects {
  object?: string;
  /** Output variables holding a row of {@link object}. */
  rowVariables: Set<string>;
}

export function flowSubjects(flow: unknown): FlowSubjects {
  const nodes = isRec(flow) && Array.isArray(flow.nodes) ? flow.nodes.filter(isRec) : [];
  const start = nodes.find((n) => n.type === 'start');
  const startConfig = isRec(start?.config) ? start.config : undefined;
  const object = typeof startConfig?.objectName === 'string' ? startConfig.objectName : undefined;
  const rowVariables = new Set<string>();
  if (object) {
    for (const n of nodes) {
      const c = isRec(n.config) ? n.config : undefined;
      if (n.type === 'get_record' && c?.objectName === object && typeof c.outputVariable === 'string') {
        rowVariables.add(c.outputVariable);
      }
    }
  }
  return { object, rowVariables };
}

/**
 * The field of the subject object a CEL path reads, or `undefined` when the
 * path is not a read of one: `record.F`, `vars.V.F` or `V.F` for a row
 * variable `V`.
 */
export function subjectFieldOf(path: readonly string[], subjects: FlowSubjects): string | undefined {
  if (!subjects.object) return undefined;
  if (path.length === 2 && path[0] === 'record') return path[1];
  if (path.length === 3 && path[0] === 'vars' && subjects.rowVariables.has(path[1])) return path[2];
  if (path.length === 2 && subjects.rowVariables.has(path[0])) return path[1];
  return undefined;
}

// ---------------------------------------------------------------------------
// CEL: a small, fail-closed reader
// ---------------------------------------------------------------------------

type Literal = number | string | boolean | null;

type Expr =
  | { kind: 'and' | 'or'; terms: Expr[] }
  | { kind: 'not'; expr: Expr }
  | { kind: 'cmp'; op: CmpOp; left: Operand; right: Operand }
  | { kind: 'has'; path: string[] }
  | { kind: 'operand'; operand: Operand };

type Operand = { kind: 'path'; path: string[] } | { kind: 'lit'; value: Literal } | { kind: 'has'; path: string[] };

type CmpOp = '==' | '!=' | '>' | '>=' | '<' | '<=';

type Token =
  | { t: 'op'; v: string }
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string };

const TWO_CHAR = new Set(['&&', '||', '==', '!=', '>=', '<=']);
const ONE_CHAR = new Set(['>', '<', '!', '(', ')', ',', '.', '-']);

/** The tokens of `src`, or `null` on any character outside the grammar. */
function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/u.test(c)) {
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (/[0-9]/u.test(c)) {
      const m = /^[0-9]+(?:\.[0-9]+)?/u.exec(src.slice(i));
      if (!m) return null;
      // A suffix (`1u`, `1e3`) or a second dot is outside the grammar.
      if (/^[A-Za-z_.]/u.test(src.slice(i + m[0].length))) return null;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end === -1) return null;
      const body = src.slice(i + 1, end);
      // Escapes and multi-line strings are left to the real parser.
      if (body.includes('\\') || body.includes('\n')) return null;
      out.push({ t: 'str', v: body });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/u.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (ONE_CHAR.has(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

const CMP_OPS = new Set<string>(['==', '!=', '>', '>=', '<', '<=']);

class Fail extends Error {}

/** The expression tree of `src`, or `null` when it is outside the grammar. */
function parse(src: string): Expr | null {
  const tokens = tokenize(src);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (v: string): boolean => {
    const tok = peek();
    return tok?.t === 'op' && tok.v === v;
  };
  const expect = (v: string): void => {
    if (!isOp(v)) throw new Fail();
    pos++;
  };

  const junction = (kind: 'and' | 'or', op: string, next: () => Expr) => (): Expr => {
    const terms = [next()];
    while (isOp(op)) {
      pos++;
      terms.push(next());
    }
    if (terms.length === 1) return terms[0];
    // `a && (b && c)` is one conjunction.
    return { kind, terms: terms.flatMap((x) => (x.kind === kind ? x.terms : [x])) };
  };

  const operand = (): Operand => {
    const tok = peek();
    if (!tok) throw new Fail();
    pos++;
    if (tok.t === 'num') return { kind: 'lit', value: tok.v };
    if (tok.t === 'str') return { kind: 'lit', value: tok.v };
    if (tok.t === 'op' && tok.v === '-') {
      const n = peek();
      if (n?.t !== 'num') throw new Fail();
      pos++;
      return { kind: 'lit', value: -n.v };
    }
    if (tok.t !== 'id') throw new Fail();
    if (tok.v === 'true' || tok.v === 'false') return { kind: 'lit', value: tok.v === 'true' };
    if (tok.v === 'null') return { kind: 'lit', value: null };
    const path = [tok.v];
    while (isOp('.')) {
      pos++;
      const seg = peek();
      if (seg?.t !== 'id') throw new Fail();
      pos++;
      path.push(seg.v);
    }
    if (isOp('(')) {
      // A call: only the presence macro `has(path)` is read.
      if (path.length !== 1 || path[0] !== 'has') throw new Fail();
      pos++;
      const arg = operand();
      expect(')');
      if (arg.kind !== 'path') throw new Fail();
      return { kind: 'has', path: arg.path };
    }
    return { kind: 'path', path };
  };

  const primary = (): Expr => {
    if (isOp('(')) {
      pos++;
      const inner = or();
      expect(')');
      return inner;
    }
    const left = operand();
    if (left.kind === 'has') return { kind: 'has', path: left.path };
    const tok = peek();
    if (tok?.t === 'op' && CMP_OPS.has(tok.v)) {
      pos++;
      const right = operand();
      if (right.kind === 'has') throw new Fail();
      return { kind: 'cmp', op: tok.v as CmpOp, left, right };
    }
    return { kind: 'operand', operand: left };
  };

  const unary = (): Expr => {
    if (isOp('!')) {
      pos++;
      return { kind: 'not', expr: unary() };
    }
    return primary();
  };

  const and = junction('and', '&&', unary);
  const or = junction('or', '||', and);

  try {
    const tree = or();
    return pos === tokens.length ? tree : null;
  } catch (e) {
    if (e instanceof Fail) return null;
    throw e;
  }
}

/** One field as the reader needs it, resolved by the caller from the object definition. */
export interface ConditionField {
  label: string;
  type?: string;
  options?: ReadonlyArray<{ value?: unknown; label?: unknown }>;
  /** The ISO 4217 code a currency field's amounts are in, handed back to `formatNumber`. */
  currency?: string;
}

export interface ConditionContext {
  /** The field a CEL path reads, or `undefined` when it is not a field of the subject object. */
  field(path: readonly string[]): ConditionField | undefined;
  /** A number literal compared with `field`, formatted for the reader. */
  formatNumber(value: number, field: ConditionField): string;
  /** The reader's words for the junctions. `more` stands for terms of a conjunction left unread. */
  words: { and: string; or: string; more: string };
}

const SYMBOL: Record<CmpOp, string> = { '==': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };
const FLIP: Record<CmpOp, CmpOp> = { '==': '==', '!=': '!=', '>': '<', '>=': '<=', '<': '>', '<=': '>=' };
const NUMBER_TYPES = new Set(['number', 'currency']);
const CHOICE_TYPES = new Set(['select', 'radio']);
const TEXT_TYPES = new Set(['text', 'textarea', 'email', 'url', 'phone']);

const pathKey = (path: readonly string[]): string => path.join('.');

/** The field path a comparison reads and the literal it reads it against, path on the left. */
function comparison(e: Expr): { path: string[]; op: CmpOp; value: Literal } | undefined {
  if (e.kind !== 'cmp') return undefined;
  if (e.left.kind === 'path' && e.right.kind === 'lit') return { path: e.left.path, op: e.op, value: e.right.value };
  if (e.left.kind === 'lit' && e.right.kind === 'path') return { path: e.right.path, op: FLIP[e.op], value: e.left.value };
  return undefined;
}

/** Whether `prefix` is `path` or one of its ancestors (`vars.row` of `vars.row.amount`). */
function covers(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((seg, i) => seg === path[i]);
}

/**
 * Whether `term` only guards the presence of a compared path: under `&&`,
 * `has(p)` or `p != null`; under `||`, `!has(p)` or `p == null`.
 */
function isGuard(term: Expr, junction: 'and' | 'or', compared: readonly string[][]): boolean {
  const hasArg =
    junction === 'and'
      ? term.kind === 'has' ? term.path : undefined
      : term.kind === 'not' && term.expr.kind === 'has' ? term.expr.path : undefined;
  if (hasArg) return compared.some((p) => covers(hasArg, p));
  const c = comparison(term);
  if (!c || c.value !== null || c.op !== (junction === 'and' ? '!=' : '==')) return false;
  return compared.some((p) => pathKey(p) === pathKey(c.path));
}

function readComparison(e: Expr, ctx: ConditionContext): string | null {
  const c = comparison(e);
  if (!c || c.value === null) return null;
  const field = ctx.field(c.path);
  if (!field) return null;
  const type = field.type ?? '';
  let value: string;
  if (typeof c.value === 'number' && NUMBER_TYPES.has(type)) {
    value = ctx.formatNumber(c.value, field);
  } else if (typeof c.value === 'string' && (c.op === '==' || c.op === '!=') && CHOICE_TYPES.has(type)) {
    const option = field.options?.find((o) => o?.value === c.value);
    if (!option || typeof option.label !== 'string') return null;
    value = option.label;
  } else if (typeof c.value === 'string' && (c.op === '==' || c.op === '!=') && TEXT_TYPES.has(type)) {
    value = `“${c.value}”`;
  } else {
    return null;
  }
  return `${field.label} ${SYMBOL[c.op]} ${value}`;
}

function read(e: Expr, ctx: ConditionContext, top: boolean): string | null {
  if (e.kind !== 'and' && e.kind !== 'or') return readComparison(e, ctx);
  const compared = e.terms
    .map(comparison)
    .filter((c): c is NonNullable<typeof c> => !!c && c.value !== null)
    .map((c) => c.path);
  const terms = e.terms.filter((term) => !isGuard(term, e.kind, compared));
  if (terms.length === 0) return null;
  const parts = terms.map((term) => {
    const text = read(term, ctx, false);
    return text !== null && (term.kind === 'and' || term.kind === 'or') && terms.length > 1 ? `(${text})` : text;
  });
  const readable = parts.filter((p): p is string => p !== null);
  if (readable.length === parts.length) return readable.join(` ${ctx.words[e.kind]} `);
  // Every term of a top-level conjunction must hold, so the terms that read are
  // each true of a matching record; the rest are named, not dropped.
  if (e.kind === 'and' && top && readable.length > 0) {
    return [...readable, ctx.words.more].join(` ${ctx.words.and} `);
  }
  return null;
}

/**
 * `source` as text a business reader can follow (`Amount > 500,000`), or
 * `null` when it is outside the reader's grammar or reads anything but the
 * fields `ctx` resolves.
 */
export function readCondition(source: string, ctx: ConditionContext): string | null {
  const tree = parse(source);
  return tree ? read(tree, ctx, true) : null;
}
