// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-node-refs — every place a flow draft names a node by its id, and the
 * expression references among them, read through the expression parsers
 * (objectui#11838).
 *
 * The engine writes each node's output under `<nodeId>.<key>` (the run's
 * variable map, `AutomationEngine` in `@objectstack/service-automation`), so a
 * later node reads it by the node's id: `x.decision == 'approve'` on a branch,
 * `{{x.field}}` in a notify message. A node id therefore appears in four
 * kinds of position ({@link NODE_ID_POSITION_KINDS}): an edge's `source`, an
 * edge's `target`, a boundary event's host (`boundaryConfig.attachedToNodeId`),
 * and the ROOT of an expression reference. {@link nodeIdPositions} is the one
 * list of them, and every designer write that adds, removes or renames a node
 * is pinned against it (`FlowPreview.nodeIdPositions-11838.test.tsx`).
 *
 * ## Where expressions sit
 *
 * {@link exprSites} walks every node and edge of the flow, the regions of an
 * ADR-0031 container included (`FLOW_REGION_SLOTS_BY_TYPE`), and reads each
 * string by the dialect its position declares, in this order:
 *
 *   1. Code — a text field the node's config descriptor marks
 *      `refMode: 'expression'` (a script body). No parser here reads it.
 *   2. CEL — a descriptor field of `kind: 'expression'`
 *      (`fieldsForNodeType` in `flow-node-config.ts`, e.g. a start node's
 *      `criteria`, or a body-less loop's `collection`, the bare name of a list
 *      variable), an `expression` column of an `objectList` field (a screen
 *      field's `visibleWhen`), or a slot the spec's ledger declares
 *      `predicate` (`FLOW_NODE_EXPRESSION_PATHS`).
 *   3. CEL — any other `condition` or `expression` key: the structural predicate
 *      every node and edge carries, and a key no descriptor describes (the
 *      platform linter's `CEL_KEYS` rule).
 *   4. Template — every other string in `config`, and in a connector node's
 *      `connectorConfig.input`: text whose only references are ADR-0032 §3
 *      `{{ }}` holes, the spelling the spec's text slots render
 *      (`FLOW_NODE_TEXT_SLOTS`). A single-brace `{…}` is no reference
 *      anywhere (objectui#12390): `@objectstack/spec` 18 deleted the flow's
 *      single-brace interpolator (objectstack#19939), so in a string no slot
 *      judges it is literal text, and a rename leaves it as written.
 *
 * An edge's `condition` is CEL, and a `{ dialect, source }` envelope anywhere is
 * read by its own `dialect` (an assignment or record field value).
 *
 * ## How a reference is read
 *
 * A CEL source is parsed by `parseCelToAst` (`@objectstack/formula`, the
 * platform's one canonical front end), and a reference is an `id` node of that
 * AST that no comprehension macro (`all` / `exists` / `exists_one` / `map` /
 * `filter`) or `cel.bind` binds. So `x` never matches `xy` or `ax` (another
 * identifier), `.x` (a member name), `"x.decision"` (a string literal), or the
 * `x` that `rows.map(x, x.v)` declares. A template hole is a `{{…}}`, and its
 * content is a dotted variable path, or CEL for the arithmetic a hole may hold
 * (`{{round(x.total)}}`); the hole's ADR-0032 §3 `| formatter` is not part of
 * the reference.
 *
 * A source that does not parse is never rewritten. A rename that would leave
 * one naming the old id is refused instead, naming it
 * ({@link expressionRefsAfterNodeRename}).
 */

import { parseCelToAst, SCOPE_ROOTS } from '@objectstack/formula';
import {
  FLOW_NODE_EXPRESSION_PATHS,
  FLOW_REGION_SLOTS_BY_TYPE,
  isExpressionEnvelopeShaped,
} from '@objectstack/spec/automation';
import { fieldsForNodeType, type FlowConfigColumn } from '../inspectors/flow-node-config.js';
import { nodeOutputRefs } from '../inspectors/flow-scope.js';

type Rec = Record<string, unknown>;
type Path = ReadonlyArray<string | number>;

function isRec(v: unknown): v is Rec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

// ── Where expressions sit ───────────────────────────────────────────────────

/** One expression in a flow: where it sits, its dialect and its text. */
export interface ExprSite {
  /**
   * The top-level node or edge that holds it. An expression inside a region is
   * held by the region's container: that is the element a write replaces.
   */
  owner: { kind: 'node'; index: number; id: string } | { kind: 'edge'; index: number; source: string; target: string };
  /** Key path from the owner to the source string. */
  path: Path;
  /** The node or edge the expression belongs to — the nested one inside a region. */
  holder: { kind: 'node'; id: string } | { kind: 'edge'; source: string; target: string };
  /** Key path from the holder to the source string, for the words that name it. */
  holderPath: Path;
  /**
   * `'template'` is text with ADR-0032 §3 `{{ }}` holes — the spec's
   * `template` expression dialect, never the retired single-brace one.
   */
  dialect: 'cel' | 'template';
  source: string;
  /** On a `start` node, whose entry condition reads the trigger record's fields bare. */
  onStart: boolean;
}

/** A path pattern into `config`: `'[]'` is every element of an array, `'*'` every key of an object. */
type Pattern = ReadonlyArray<string>;

interface NodeSlots {
  code: Pattern[];
  cel: Pattern[];
}

const NO_SLOTS: NodeSlots = { code: [], cel: [] };

function columnPatterns(columns: ReadonlyArray<FlowConfigColumn> | undefined, base: Pattern, slots: NodeSlots): void {
  for (const col of columns ?? []) {
    const at = [...base, '[]', col.key];
    if (col.kind === 'expression') slots.cel.push(at);
    else if (col.kind === 'objectList') columnPatterns(col.columns, at, slots);
  }
}

const slotCache = new Map<string, NodeSlots>();

/** The dialect each declared slot of a node type takes, read off its descriptor and the spec's ledger. */
function slotsForType(type: string): NodeSlots {
  const cached = slotCache.get(type);
  if (cached) return cached;
  const slots: NodeSlots = { code: [], cel: [] };
  for (const field of fieldsForNodeType(type)) {
    if (field.path[0] !== 'config') continue;
    const at = field.path.slice(1);
    if (field.kind === 'expression') slots.cel.push(at);
    else if ((field.kind === 'text' || field.kind === 'textarea') && field.refMode === 'expression') slots.code.push(at);
    else if (field.kind === 'objectList') columnPatterns(field.columns, at, slots);
    // Any other text field — a literal, or a `{{ }}` text slot (`refMode: 'hole'`) —
    // reads as every other string does: its `{{ }}` holes, nothing else.
  }
  for (const entry of FLOW_NODE_EXPRESSION_PATHS) {
    if (entry.nodeType !== type) continue;
    const at = entry.path.split('.').flatMap((seg) => (seg.endsWith('[]') ? [seg.slice(0, -2), '[]'] : [seg]));
    if (entry.role === 'predicate') slots.cel.push(at);
    // `value`: an envelope is read by its own dialect; a string there is a literal
    // (a `{…}` token is refused by the spec), and reads its `{{ }}` holes only.
  }
  slotCache.set(type, slots);
  return slots;
}

function matches(pattern: Pattern, path: Path): boolean {
  if (pattern.length !== path.length) return false;
  return pattern.every((seg, i) =>
    seg === '[]' ? typeof path[i] === 'number' : seg === '*' ? typeof path[i] === 'string' : seg === path[i],
  );
}

/** The `config` keys this node type keeps a region in — walked as a graph, never as strings. */
function regionKeys(type: string): string[] {
  return (FLOW_REGION_SLOTS_BY_TYPE.get(type) ?? []).map((s) => s.key);
}

/** The region graphs a container node holds, each with its key path from the node. */
function regionGraphs(node: Rec): Array<{ graph: Rec; at: Path }> {
  const out: Array<{ graph: Rec; at: Path }> = [];
  if (!isRec(node.config)) return out;
  for (const key of regionKeys(str(node.type) ?? '')) {
    const region = node.config[key];
    if (Array.isArray(region)) {
      region.forEach((g, j) => {
        if (isRec(g)) out.push({ graph: g, at: ['config', key, j] });
      });
    } else if (isRec(region)) {
      out.push({ graph: region, at: ['config', key] });
    }
  }
  return out;
}

interface Walk {
  owner: ExprSite['owner'];
  /** Path from the owner to the current holder. */
  base: Path;
  holder: ExprSite['holder'];
  onStart: boolean;
  out: ExprSite[];
}

function pushSite(w: Walk, rel: Path, dialect: ExprSite['dialect'], source: string): void {
  w.out.push({ owner: w.owner, path: [...w.base, ...rel], holder: w.holder, holderPath: rel, dialect, source, onStart: w.onStart });
}

/**
 * One value at `rel` (a path from the holder). An envelope is read by its own
 * `dialect`; a string by the slot its path declares — `local` is the path
 * inside `config` (or `connectorConfig.input`) the slot patterns are written
 * against.
 */
function walkValue(w: Walk, value: unknown, rel: Path, local: Path, slots: NodeSlots): void {
  if (isExpressionEnvelopeShaped(value)) {
    const { dialect, source } = value as { dialect: string; source?: unknown };
    if (typeof source !== 'string') return;
    if (dialect === 'cel' || dialect === 'template') pushSite(w, [...rel, 'source'], dialect, source);
    return;
  }
  if (typeof value === 'string') {
    if (slots.code.some((p) => matches(p, local))) return;
    const key = local[local.length - 1];
    const dialect = slots.cel.some((p) => matches(p, local)) || key === 'condition' || key === 'expression' ? 'cel' : 'template';
    pushSite(w, rel, dialect, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkValue(w, v, [...rel, i], [...local, i], slots));
    return;
  }
  if (isRec(value)) {
    for (const [k, v] of Object.entries(value)) walkValue(w, v, [...rel, k], [...local, k], slots);
  }
}

function walkNode(w: Walk, node: Rec): void {
  const type = str(node.type) ?? '';
  if (isRec(node.config)) {
    const slots = slotsForType(type);
    const regions = new Set(regionKeys(type));
    for (const [k, v] of Object.entries(node.config)) {
      if (!regions.has(k)) walkValue(w, v, ['config', k], [k], slots);
    }
    for (const { graph, at } of regionGraphs(node)) walkGraph(w, graph, [...w.base, ...at]);
  }
  if (isRec(node.connectorConfig) && node.connectorConfig.input !== undefined) {
    walkValue(w, node.connectorConfig.input, ['connectorConfig', 'input'], [], NO_SLOTS);
  }
}

function walkEdge(w: Walk, edge: Rec): void {
  const c = edge.condition;
  if (typeof c === 'string') {
    pushSite(w, ['condition'], 'cel', c);
  } else if (isExpressionEnvelopeShaped(c)) {
    const { dialect, source } = c as { dialect: string; source?: unknown };
    if (dialect === 'cel' && typeof source === 'string') pushSite(w, ['condition', 'source'], 'cel', source);
  }
}

/** A region's own nodes and edges, held by the top-level container `w.owner`. */
function walkGraph(w: Walk, graph: Rec, base: Path): void {
  (Array.isArray(graph.nodes) ? graph.nodes : []).forEach((n, i) => {
    if (!isRec(n)) return;
    walkNode({ ...w, base: [...base, 'nodes', i], holder: { kind: 'node', id: str(n.id) ?? '' }, onStart: n.type === 'start' }, n);
  });
  (Array.isArray(graph.edges) ? graph.edges : []).forEach((e, k) => {
    if (!isRec(e)) return;
    const holder = { kind: 'edge' as const, source: str(e.source) ?? '', target: str(e.target) ?? '' };
    walkEdge({ ...w, base: [...base, 'edges', k], holder, onStart: false }, e);
  });
}

/** Every expression in the flow, top-level and in every region, in document order. */
export function exprSites(flow: { nodes?: unknown; edges?: unknown }): ExprSite[] {
  const out: ExprSite[] = [];
  (Array.isArray(flow.nodes) ? flow.nodes : []).forEach((n, index) => {
    if (!isRec(n)) return;
    const id = str(n.id) ?? '';
    walkNode({ owner: { kind: 'node', index, id }, base: [], holder: { kind: 'node', id }, onStart: n.type === 'start', out }, n);
  });
  (Array.isArray(flow.edges) ? flow.edges : []).forEach((e, index) => {
    if (!isRec(e)) return;
    const source = str(e.source) ?? '';
    const target = str(e.target) ?? '';
    walkEdge({ owner: { kind: 'edge', index, source, target }, base: [], holder: { kind: 'edge', source, target }, onStart: false, out }, e);
  });
  return out;
}

// ── How a reference is read ─────────────────────────────────────────────────

/** One reference in an expression: its root identifier and where the root sits in the source. */
export interface ExprRef {
  root: string;
  /** Offsets of the root identifier in the site's source. */
  start: number;
  end: number;
  /** The root is read through a member (`x.decision`, `x['k']`): the shape of a node output. */
  member: boolean;
  /** The reference as it reads, root and first member (`x.decision`). */
  text: string;
}

/**
 * What a source holds: the references the parser found, and the text it could
 * not read — the whole source for CEL, each hole that does not parse for a
 * template (the holes that do parse still give their references).
 */
export interface ParsedExpr {
  refs: ExprRef[];
  unparsed: string[];
}

/** CEL's comprehension macros: the first argument declares a variable bound in the rest (objectui#10538). */
const COMPREHENSION_MACROS: ReadonlySet<string> = new Set(['all', 'exists', 'exists_one', 'map', 'filter']);

interface CelNode {
  op: string;
  args: unknown;
  start: number;
  end: number;
}
function isCelNode(v: unknown): v is CelNode {
  return !!v && typeof v === 'object' && typeof (v as CelNode).op === 'string';
}
function isIdNode(v: unknown): v is CelNode & { args: string } {
  return isCelNode(v) && v.op === 'id' && typeof v.args === 'string';
}

/** One `id` node: whether it is a reference (free) or bound, and the member read off it. */
interface IdHit {
  name: string;
  start: number;
  end: number;
  free: boolean;
  /** `.decision` / `[…]` when the identifier is the object of a member read. */
  member?: string;
}

/**
 * Collect every `id` node of a parsed CEL AST in pre-order, which is source
 * order for every operator (operands are stored left to right; a receiver
 * call stores its receiver before its arguments). The shapes read, as
 * `screen-spec.ts`'s `collectFreeRoots` reads them: `.` / `.?` is `[object,
 * name]`, `[]` is `[object, index]`, `call` is `[name, [args…]]`, `rcall` is
 * `[name, receiver, [args…]]`; a string in `args` is a name, never an
 * identifier.
 */
function collectIds(node: unknown, bound: ReadonlySet<string>, out: IdHit[], member?: string): void {
  if (Array.isArray(node)) {
    for (const n of node) collectIds(n, bound, out);
    return;
  }
  if (!isCelNode(node)) return;
  const { op, args } = node;
  if (op === 'id') {
    if (typeof args === 'string') out.push({ name: args, start: node.start, end: node.end, free: !bound.has(args), member });
    return;
  }
  if ((op === '.' || op === '.?') && Array.isArray(args)) {
    collectIds(args[0], bound, out, typeof args[1] === 'string' ? `.${args[1]}` : '');
    return;
  }
  if (op === '[]' && Array.isArray(args)) {
    collectIds(args[0], bound, out, '[…]');
    collectIds(args[1], bound, out);
    return;
  }
  if (op === 'call' && Array.isArray(args)) {
    collectIds(args[1], bound, out);
    return;
  }
  if (op === 'rcall' && Array.isArray(args)) {
    const [name, receiver, rest] = args as [unknown, unknown, unknown];
    collectIds(receiver, bound, out);
    const list = Array.isArray(rest) ? rest : [];
    const decl = list[0];
    const isBind = name === 'bind' && isIdNode(receiver) && receiver.args === 'cel' && list.length === 3;
    if (typeof name === 'string' && isIdNode(decl) && (COMPREHENSION_MACROS.has(name) || isBind)) {
      // The declaration is not a reference, and the name is bound only inside this call.
      out.push({ name: decl.args, start: decl.start, end: decl.end, free: false });
      const inner = new Set(bound);
      inner.add(decl.args);
      if (isBind) {
        collectIds(list[1], bound, out);
        collectIds(list[2], inner, out);
      } else {
        collectIds(list.slice(1), inner, out);
      }
      return;
    }
    collectIds(list, bound, out);
    return;
  }
  collectIds(args, bound, out);
}

const CEL_KEYWORDS: ReadonlySet<string> = new Set(['true', 'false', 'null', 'in']);

/**
 * The identifier tokens of a CEL source that the parser turns into `id` nodes,
 * in source order: not a member name (after `.` or `.?`), not a function name
 * (before `(`), not a keyword, not inside a string literal. Read only to place
 * the AST's own `id` nodes back on the author's text when the canonical parse
 * rewrote it first (see {@link celIds}); the parser decides what each one is.
 */
function lexIds(source: string): Array<{ name: string; start: number; end: number }> | null {
  const out: Array<{ name: string; start: number; end: number }> = [];
  let i = 0;
  let prev = '';
  while (i < source.length) {
    const rest = source.slice(i);
    if (/^\s/.test(rest)) {
      i++;
      continue;
    }
    const prefix = /^[rRbB]{0,2}(?=['"])/.exec(rest);
    if (prefix) {
      const q = i + prefix[0].length;
      const quote = source[q];
      const close = source.startsWith(quote.repeat(3), q) ? quote.repeat(3) : quote;
      const raw = /[rR]/.test(prefix[0]);
      let j = q + close.length;
      while (j < source.length && !source.startsWith(close, j)) j += !raw && source[j] === '\\' ? 2 : 1;
      if (j >= source.length) return null;
      i = j + close.length;
      prev = '"';
      continue;
    }
    const num = /^\d[\w.]*/.exec(rest);
    if (num) {
      i += num[0].length;
      prev = '0';
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (ident) {
      const name = ident[0];
      const end = i + name.length;
      const next = /^\s*(.)/.exec(source.slice(end))?.[1];
      if (prev !== '.' && next !== '(' && !CEL_KEYWORDS.has(name)) out.push({ name, start: i, end });
      i = end;
      prev = 'a';
      continue;
    }
    // `.?` is one member operator.
    prev = rest[0] === '?' && prev === '.' ? '.' : rest[0];
    i++;
  }
  return out;
}

/**
 * Every `id` node of one CEL source, `offset` added to each position. `null`
 * when it does not parse — or when the parse is of a rewritten text whose
 * identifiers cannot be placed back on the author's.
 *
 * `parseCelToAst` parses what the runtime runs, so a `cond ? value : null`
 * reaches the parser rewritten (`rewriteNullableTernary` wraps an arm in
 * `dyn(…)`), and the AST's positions are then the rewritten text's. The
 * rewrite adds no identifier and keeps their order, so the `id` nodes are
 * placed on the author's text by order — and only when the author's
 * identifiers are exactly the AST's, name for name.
 */
function celIds(source: string, offset = 0): IdHit[] | null {
  const ast = parseCelToAst(source) as unknown as (CelNode & { input?: unknown }) | null;
  if (!ast) return null;
  const hits: IdHit[] = [];
  collectIds(ast, new Set(), hits);
  if (ast.input !== source) {
    const lexed = lexIds(source);
    if (!lexed || lexed.length !== hits.length || lexed.some((t, i) => t.name !== hits[i].name)) return null;
    hits.forEach((h, i) => {
      h.start = lexed[i].start;
      h.end = lexed[i].end;
    });
  }
  for (const h of hits) {
    h.start += offset;
    h.end += offset;
  }
  return hits;
}

/**
 * An ADR-0032 §3 template hole, `{{…}}` (objectui#12390). A single-brace `{…}`
 * is literal text: no flow string reads one since `@objectstack/spec` 18.
 */
const HOLE_RE = /\{\{([^{}]+)\}\}/g;
/** A hole's direct variable path: a head, then identifier or index segments. */
const VARIABLE_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/;

/** Where an ADR-0032 §3 `path | formatter` pipe starts in a hole, or -1 (a `||` is CEL's or). */
function formatterPipe(content: string): number {
  let quote = '';
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '|' && content[i + 1] !== '|' && content[i - 1] !== '|') return i;
  }
  return -1;
}

/** One hole's `id` nodes, or `null` when its content does not parse. */
function holeIds(content: string, offset: number): IdHit[] | null {
  const lead = content.length - content.trimStart().length;
  let expr = content.trim();
  const pipe = formatterPipe(expr);
  if (pipe >= 0) expr = expr.slice(0, pipe).trimEnd();
  if (!expr) return null;
  if (VARIABLE_PATH_RE.test(expr)) {
    const segs = expr.split('.');
    const start = offset + lead;
    return [{ name: segs[0], start, end: start + segs[0].length, free: true, member: segs.length > 1 ? `.${segs[1]}` : undefined }];
  }
  return celIds(expr, offset + lead);
}

function toRefs(hits: IdHit[]): ExprRef[] {
  return hits
    .filter((h) => h.free)
    .map((h) => ({ root: h.name, start: h.start, end: h.end, member: h.member !== undefined, text: h.name + (h.member ?? '') }));
}

/** Read one expression's references through the parser its dialect takes. */
export function parseExpr(dialect: ExprSite['dialect'], source: string): ParsedExpr {
  if (dialect === 'cel') {
    if (!source.trim()) return { refs: [], unparsed: [] };
    const hits = celIds(source);
    return hits ? { refs: toRefs(hits), unparsed: [] } : { refs: [], unparsed: [source] };
  }
  const out: ParsedExpr = { refs: [], unparsed: [] };
  for (const m of source.matchAll(HOLE_RE)) {
    const hits = holeIds(m[1], (m.index ?? 0) + 2);
    if (hits) out.refs.push(...toRefs(hits));
    else out.unparsed.push(m[0]);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether text that does not parse reads `id` as a root anywhere: an identifier
 * token equal to it that is not a member name and not inside a string literal.
 * Never used to rewrite — only to decide that a rename would leave it behind.
 */
function mentions(text: string, id: string): boolean {
  const bare = text.replace(/'(?:[^'\\]|\\.)*'/g, ' ').replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  return new RegExp(`(?<![.\\w$])${escapeRe(id)}(?![\\w$])`).test(bare);
}

// ── The names a root may mean besides a node ────────────────────────────────

/**
 * Roots a run binds that are not node ids: what the platform's scope baseline
 * mounts on some surface (`SCOPE_ROOTS`), the globals the designer's scope
 * check allows (`flow-ref-check.ts`), and `cel` (`cel.bind`). A `$`-prefixed
 * root (`$error`, `$User`, `$record`) is the engine's too.
 */
const RUNTIME_ROOTS: ReadonlySet<string> = new Set([...SCOPE_ROOTS, 'env', 'request', 'context', 'user', 'now', 'today', 'self', 'data', 'cel']);

/**
 * Roots every flow run binds besides node ids, which a rename would have to
 * tell apart from the node (`seedRunVariables` and `celScope` in the engine):
 * the trigger record, its previous values, and the `vars` namespace.
 */
const RUN_ROOTS: ReadonlySet<string> = new Set(['record', 'previous', 'vars']);

function isRuntimeRoot(root: string): boolean {
  return root.startsWith('$') || RUNTIME_ROOTS.has(root);
}

/** Every node of the flow, at every depth — the walk `exprSites` takes. */
function allNodes(flow: { nodes?: unknown }): Rec[] {
  const out: Rec[] = [];
  const visit = (nodes: unknown) => {
    for (const n of Array.isArray(nodes) ? nodes : []) {
      if (!isRec(n)) continue;
      out.push(n);
      for (const { graph } of regionGraphs(n)) visit(graph.nodes);
    }
  };
  visit(flow.nodes);
  return out;
}

/** Every node id in the flow — one id space across the top level and every region. */
export function flowNodeIds(flow: { nodes?: unknown }): Set<string> {
  return new Set(allNodes(flow).flatMap((n) => (typeof n.id === 'string' && n.id ? [n.id] : [])));
}

/**
 * The root names the flow declares as variables: its `variables[]`, every name
 * a node writes under a name of its own rather than its id — an
 * `outputVariable`, assignment keys, screen fields, a loop's iterator
 * (`nodeOutputRefs`, the data picker's reading) — and a try/catch
 * `errorVariable`. A dotted name declares its head (the engine's `celScope`
 * nests it).
 */
export function declaredRoots(flow: { nodes?: unknown; variables?: unknown }): Set<string> {
  const out = new Set<string>();
  const add = (name: string | undefined) => {
    if (name) out.add(name.split('.')[0]);
  };
  for (const v of Array.isArray(flow.variables) ? flow.variables : []) add(isRec(v) ? str(v.name) : str(v));
  for (const node of allNodes(flow)) {
    const id = str(node.id);
    for (const ref of nodeOutputRefs(node)) {
      if (!(id && ref.token.startsWith(`${id}.`))) add(ref.token);
    }
    if (isRec(node.config)) add(str(node.config.errorVariable));
  }
  return out;
}

// ── The one list ────────────────────────────────────────────────────────────

/** The kinds of position that name a node id — the rows of the enumeration pin. */
export const NODE_ID_POSITION_KINDS = ['edge-source', 'edge-target', 'boundary-host', 'expression-root'] as const;
export type NodeIdPositionKind = (typeof NODE_ID_POSITION_KINDS)[number];

/** One place in a flow that names a node id. */
export type NodeIdPosition =
  | { kind: 'edge-source' | 'edge-target'; id: string; edge: { source: string; target: string } }
  /** `node` is the boundary event itself, for naming it (objectui#13242). */
  | { kind: 'boundary-host'; id: string; nodeId: string; node: { id: string; type?: unknown; label?: unknown } }
  | { kind: 'expression-root'; id: string; site: ExprSite; ref: ExprRef };

function edgePositions(edges: unknown, out: NodeIdPosition[]): void {
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!isRec(e)) continue;
    const edge = { source: str(e.source) ?? '', target: str(e.target) ?? '' };
    out.push({ kind: 'edge-source', id: edge.source, edge }, { kind: 'edge-target', id: edge.target, edge });
  }
}

/**
 * Every position in the flow that names a node id (objectui#11838), at every
 * depth:
 *
 *   - `edge-source` / `edge-target` — every edge's endpoints, a region's too;
 *   - `boundary-host` — a boundary event's `boundaryConfig.attachedToNodeId`,
 *     the one key on the spec's `FlowNodeSchema` besides an edge endpoint that
 *     names another node ("Host node ID this boundary event monitors");
 *   - `expression-root` — the root of an expression reference that names a
 *     node: one that IS a node id, or one read as a node output (`x.decision`)
 *     whose root no node, declared variable or runtime root answers to.
 *
 * The start node's own expressions are left out of that last half: its entry
 * condition reads the trigger record's fields bare, which this pure pass has
 * no field list for. Nor does a source that does not parse name anything here:
 * what it means is unknown, and the expression checks report it as malformed.
 */
export function nodeIdPositions(flow: { nodes?: unknown; edges?: unknown; variables?: unknown }): NodeIdPosition[] {
  const out: NodeIdPosition[] = [];
  const nodes = allNodes(flow);
  edgePositions(flow.edges, out);
  for (const node of nodes) for (const { graph } of regionGraphs(node)) edgePositions(graph.edges, out);
  for (const node of nodes) {
    const bc = node.boundaryConfig;
    if (isRec(bc) && typeof bc.attachedToNodeId === 'string') {
      const nodeId = str(node.id) ?? '';
      out.push({ kind: 'boundary-host', id: bc.attachedToNodeId, nodeId, node: { id: nodeId, type: node.type, label: node.label } });
    }
  }
  const ids = flowNodeIds(flow);
  const declared = declaredRoots(flow);
  for (const site of exprSites(flow)) {
    for (const ref of parseExpr(site.dialect, site.source).refs) {
      const namesNode =
        ids.has(ref.root) || (ref.member && !site.onStart && !declared.has(ref.root) && !isRuntimeRoot(ref.root));
      if (namesNode) out.push({ kind: 'expression-root', id: ref.root, site, ref });
    }
  }
  return out;
}

/** The positions in {@link nodeIdPositions} that name a node the flow does not have. */
export function missingNodePositions(flow: { nodes?: unknown; edges?: unknown; variables?: unknown }): NodeIdPosition[] {
  const ids = flowNodeIds(flow);
  return nodeIdPositions(flow).filter((p) => !ids.has(p.id));
}

// ── A rename carries the references ─────────────────────────────────────────

/**
 * One expression as a refusal names it: where it sits and its text, in no
 * language's words (`d › config.conditions[0].expression: \`x.decision ==\``).
 */
export function describeExprSite(site: ExprSite): string {
  const path = site.holderPath.map((seg, i) => (typeof seg === 'number' ? `[${seg}]` : i === 0 ? seg : `.${seg}`)).join('');
  const where = site.holder.kind === 'node' ? site.holder.id : `${site.holder.source} → ${site.holder.target}`;
  return `${where} › ${path}: \`${site.source}\``;
}

/** Why a rename cannot carry the expressions that read the node; see {@link expressionRefsAfterNodeRename}. */
export type ExprRenameRefusal =
  /** Each site reads the old id but does not parse, so no parser can say where the reference is. */
  | { kind: 'unparsed'; sites: ExprSite[] }
  /** `name` (the old id or the new one) also names a variable or a run root, so a reference to it cannot be told apart. */
  | { kind: 'ambiguous'; name: string; sites: ExprSite[] };

export type ExprRenameResult<N, E> = { ok: true; nodes: N[]; edges: E[] } | { ok: false; refusal: ExprRenameRefusal };

function setAt(target: unknown, path: Path, value: string): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(target) && typeof head === 'number') {
    const next = target.slice();
    next[head] = setAt(target[head], rest, value);
    return next;
  }
  if (isRec(target)) return { ...target, [head]: setAt(target[head], rest, value) };
  return target;
}

/** The roots of a reading, as a comparable key (identifiers hold no spaces). */
function rootsKey(parsed: ParsedExpr): string {
  return `${parsed.refs.map((r) => r.root).sort().join(' ')} | ${parsed.unparsed.join(' ')}`;
}

/**
 * `site.source` with every reference rooted at `oldId` renamed — only the
 * root's own characters change — or `null` when the result does not read back
 * as the same references with the root renamed (nothing newly bound by a macro
 * variable that shares the new id, nothing lost).
 */
function rewritten(site: ExprSite, parsed: ParsedExpr, oldId: string, newId: string): string | null {
  let next = site.source;
  const moved = parsed.refs.filter((r) => r.root === oldId).sort((a, b) => b.start - a.start);
  for (const r of moved) {
    if (next.slice(r.start, r.end) !== oldId) return null;
    next = next.slice(0, r.start) + newId + next.slice(r.end);
  }
  const expected: ParsedExpr = {
    refs: parsed.refs.map((r) => (r.root === oldId ? { ...r, root: newId } : r)),
    unparsed: parsed.unparsed,
  };
  return rootsKey(parseExpr(site.dialect, next)) === rootsKey(expected) ? next : null;
}

/**
 * The flow's top-level nodes and edges with every expression reference whose
 * root is `oldId` reading `newId` instead (objectui#11838) — the expression
 * half of a node rename, beside `edgesAfterNodeRename` and
 * `boundaryRefsAfterNodeRename` (`flow-problems.ts`), in the same patch.
 *
 * Every reference is found through the parser its position takes
 * ({@link exprSites}, {@link parseExpr}) and only the root's own characters
 * change: an identifier that merely contains the old id, a member name, a
 * string literal and a macro-bound variable are left alone, and the rest of the
 * author's text is kept byte for byte. Each rewritten source is parsed again
 * and must read the same references with the root renamed.
 *
 * Refused, with nothing changed ({@link ExprRenameRefusal}):
 *   - `unparsed` — a source (or a template hole) that reads the old id as a
 *     root does not parse, so no parser can say where the reference is; it is
 *     named for the author to fix first.
 *   - `ambiguous` — the old id or the new one also names a declared variable
 *     or a root every run binds (`record`, `previous`, `vars`, `$…`), so a
 *     reference to it may read either; or a rewrite does not read back the
 *     same.
 *
 * `flow` is the draft with the rename already written to the node (its
 * `variables` included). Untouched nodes and edges come back as the same
 * objects, and with nothing to carry the very same arrays come back. While
 * another node still carries `oldId` (a duplicate id), the references are that
 * node's too and stay — the rule the edge and boundary halves apply.
 */
export function expressionRefsAfterNodeRename<N, E>(
  flow: { nodes?: N[]; edges?: E[]; variables?: unknown },
  oldId: string,
  newId: string,
): ExprRenameResult<N, E> {
  const nodes: N[] = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edges: E[] = Array.isArray(flow.edges) ? flow.edges : [];
  if (oldId === newId || nodes.some((n) => isRec(n) && n.id === oldId)) return { ok: true, nodes, edges };

  const unparsed: ExprSite[] = [];
  const reading: Array<{ site: ExprSite; parsed: ParsedExpr }> = [];
  for (const site of exprSites(flow)) {
    const parsed = parseExpr(site.dialect, site.source);
    if (parsed.unparsed.some((text) => mentions(text, oldId))) unparsed.push(site);
    else if (parsed.refs.some((r) => r.root === oldId)) reading.push({ site, parsed });
  }
  if (unparsed.length > 0) return { ok: false, refusal: { kind: 'unparsed', sites: unparsed } };
  if (reading.length === 0) return { ok: true, nodes, edges };

  const declared = declaredRoots(flow);
  for (const name of [oldId, newId]) {
    if (declared.has(name) || RUN_ROOTS.has(name) || name.startsWith('$')) {
      return { ok: false, refusal: { kind: 'ambiguous', name, sites: reading.map((r) => r.site) } };
    }
  }

  const nextNodes: unknown[] = nodes.slice();
  const nextEdges: unknown[] = edges.slice();
  const lost: ExprSite[] = [];
  for (const { site, parsed } of reading) {
    const text = rewritten(site, parsed, oldId, newId);
    if (text === null) {
      lost.push(site);
      continue;
    }
    const list = site.owner.kind === 'node' ? nextNodes : nextEdges;
    list[site.owner.index] = setAt(list[site.owner.index], site.path, text);
  }
  if (lost.length > 0) return { ok: false, refusal: { kind: 'ambiguous', name: newId, sites: lost } };
  const nodesMoved = nextNodes.some((n, i) => n !== nodes[i]);
  const edgesMoved = nextEdges.some((e, i) => e !== edges[i]);
  return { ok: true, nodes: nodesMoved ? (nextNodes as N[]) : nodes, edges: edgesMoved ? (nextEdges as E[]) : edges };
}
