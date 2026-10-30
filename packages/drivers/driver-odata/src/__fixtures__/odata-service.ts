// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A small in-process OData v4 service for the conformance suite: one entity
 * set over rows held in memory, answering `$metadata`, collection reads with
 * `$filter` / `$orderby` / `$skip` / `$top` / `$count`, server-driven paging
 * through `@odata.nextLink`, and `POST` / `PATCH` / `DELETE` by key.
 *
 * Its `$filter` evaluator reads the subset of the grammar the driver's
 * translator writes (comparisons, `and` / `or` / `not`, parentheses,
 * `contains` / `startswith` / `endswith` / `tolower`, `true` / `false` /
 * `null`, quoted strings, numbers, dates, date-times and times of day). An
 * expression outside that subset is answered `400`, the way a service answers
 * a filter it cannot parse, so a translation change that writes something new
 * fails loudly here.
 *
 * Two collations, because a real service's collation is its own: `ordinal`
 * compares text by code unit, `case-insensitive` folds case first (as a SQL
 * Server-backed service does). The engine floor must answer the same rows
 * over either, which is what makes the driver's "never narrower" rule
 * checkable.
 */

import type { FetchLike } from '../transport.js';

export type EdmType = 'Edm.String' | 'Edm.Int32' | 'Edm.Double' | 'Edm.Boolean' | 'Edm.Date' | 'Edm.DateTimeOffset' | 'Edm.TimeOfDay';

export interface ServiceProperty {
  name: string;
  type: EdmType;
  nullable?: boolean;
}

export interface ODataServiceOptions {
  entitySet: string;
  /** The key is the first property. */
  properties: ServiceProperty[];
  rows: Array<Record<string, unknown>>;
  collation?: 'ordinal' | 'case-insensitive';
  /** Rows per server page; a longer answer carries `@odata.nextLink`. */
  serverPageSize?: number;
}

export const CONFORMANCE_ROOT = 'https://odata.conformance.test/svc/';

const NS = 'Conformance';

export function metadataFor(entitySet: string, properties: readonly ServiceProperty[]): string {
  const props = properties
    .map((p, i) => `<Property Name="${p.name}" Type="${p.type}" Nullable="${i === 0 || p.nullable === false ? 'false' : 'true'}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices>
<Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="${NS}">
<EntityType Name="Row"><Key><PropertyRef Name="${properties[0]!.name}"/></Key>${props}</EntityType>
<EntityContainer Name="Container"><EntitySet Name="${entitySet}" EntityType="${NS}.Row"/></EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>`;
}

// ---------------------------------------------------------------------------
// $filter: tokens, parse, evaluate
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'punct'; value: '(' | ')' | ',' }
  | { kind: 'string'; value: string }
  | { kind: 'word'; value: string };

class FilterSyntaxError extends Error {}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === ' ') { i++; continue; }
    if (ch === '(' || ch === ')' || ch === ',') { tokens.push({ kind: 'punct', value: ch }); i++; continue; }
    if (ch === "'") {
      let value = '';
      i++;
      for (;;) {
        if (i >= text.length) throw new FilterSyntaxError('unterminated string literal');
        if (text[i] === "'" && text[i + 1] === "'") { value += "'"; i += 2; continue; }
        if (text[i] === "'") { i++; break; }
        value += text[i++];
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    const match = /^[A-Za-z0-9_.:+\-]+/.exec(text.slice(i));
    if (!match) throw new FilterSyntaxError(`unexpected character '${ch}'`);
    tokens.push({ kind: 'word', value: match[0] });
    i += match[0].length;
  }
  return tokens;
}

type Node =
  | { kind: 'and' | 'or'; left: Node; right: Node }
  | { kind: 'not'; operand: Node }
  | { kind: 'compare'; op: string; left: Node; right: Node }
  | { kind: 'call'; fn: string; args: Node[] }
  | { kind: 'property'; name: string }
  | { kind: 'literal'; text: string; quoted: boolean };

const COMPARISON = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le']);
const FUNCTIONS = new Set(['contains', 'startswith', 'endswith', 'tolower']);

function parse(text: string, types: ReadonlyMap<string, EdmType>): Node {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const isWord = (value: string) => peek()?.kind === 'word' && peek()!.value === value;
  const expect = (value: string) => {
    const t = tokens[pos++];
    if (!t || t.value !== value) throw new FilterSyntaxError(`expected '${value}'`);
  };

  const orExpr = (): Node => {
    let left = andExpr();
    while (isWord('or')) { pos++; left = { kind: 'or', left, right: andExpr() }; }
    return left;
  };
  const andExpr = (): Node => {
    let left = unary();
    while (isWord('and')) { pos++; left = { kind: 'and', left, right: unary() }; }
    return left;
  };
  // OData's precedence: `not` is unary and binds tighter than the comparisons, so
  // `not P eq 1` is `(not P) eq 1`. Its operand must be Boolean, as a real service's
  // parser requires; a non-Boolean one is refused (400), never read as `not (P eq 1)`.
  const negation = (): Node => {
    if (!isWord('not')) return operand();
    pos++;
    const inner = negation();
    if (!isBoolean(inner)) throw new FilterSyntaxError("the operand of 'not' is not Boolean");
    return { kind: 'not', operand: inner };
  };
  const isBoolean = (node: Node): boolean => {
    switch (node.kind) {
      case 'and': case 'or': case 'not': case 'compare': return true;
      case 'call': return node.fn !== 'tolower';
      case 'property': return types.get(node.name) === 'Edm.Boolean';
      case 'literal': return !node.quoted && (node.text === 'true' || node.text === 'false');
    }
  };
  const unary = (): Node => {
    const left = negation();
    const t = peek();
    if (t?.kind === 'word' && COMPARISON.has(t.value)) {
      pos++;
      return { kind: 'compare', op: t.value, left, right: operand() };
    }
    return left;
  };
  const operand = (): Node => {
    const t = tokens[pos++];
    if (!t) throw new FilterSyntaxError('unexpected end of expression');
    if (t.kind === 'punct' && t.value === '(') {
      const inner = orExpr();
      expect(')');
      return inner;
    }
    if (t.kind === 'string') return { kind: 'literal', text: t.value, quoted: true };
    if (t.kind === 'punct') throw new FilterSyntaxError(`unexpected '${t.value}'`);
    if (FUNCTIONS.has(t.value) && peek()?.value === '(') {
      pos++;
      const args: Node[] = [orExpr()];
      while (peek()?.value === ',') { pos++; args.push(orExpr()); }
      expect(')');
      return { kind: 'call', fn: t.value, args };
    }
    if (types.has(t.value)) return { kind: 'property', name: t.value };
    if (/^[A-Za-z_]/.test(t.value) && !['true', 'false', 'null'].includes(t.value)) {
      throw new FilterSyntaxError(`'${t.value}' is not a property of the entity type`);
    }
    return { kind: 'literal', text: t.value, quoted: false };
  };

  const tree = orExpr();
  if (pos !== tokens.length) throw new FilterSyntaxError('trailing tokens');
  return tree;
}

type Value = string | number | boolean | null;

interface EvalContext {
  row: Record<string, unknown>;
  types: ReadonlyMap<string, EdmType>;
  fold: (text: string) => string;
}

/** A comparable reading of a property value or literal, by the property's EDM type. */
function comparable(value: unknown, type: EdmType | undefined): Value {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'Edm.DateTimeOffset': return Date.parse(String(value));
    case 'Edm.TimeOfDay': {
      const [h, m, s = '0'] = String(value).split(':');
      return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000;
    }
    case 'Edm.Int32':
    case 'Edm.Double': return typeof value === 'number' ? value : Number(value);
    case 'Edm.Boolean': return typeof value === 'boolean' ? value : value === 'true';
    default: return typeof value === 'string' ? value : String(value);
  }
}

function evaluate(node: Node, ctx: EvalContext): unknown {
  switch (node.kind) {
    case 'and': return evaluate(node.left, ctx) === true && evaluate(node.right, ctx) === true;
    case 'or': return evaluate(node.left, ctx) === true || evaluate(node.right, ctx) === true;
    case 'not': return evaluate(node.operand, ctx) !== true;
    case 'property': return ctx.row[node.name] ?? null;
    case 'literal': {
      if (node.quoted) return node.text;
      if (node.text === 'null') return null;
      if (node.text === 'true') return true;
      if (node.text === 'false') return false;
      return node.text;
    }
    case 'call': {
      const args = node.args.map((a) => evaluate(a, ctx));
      if (node.fn === 'tolower') return typeof args[0] === 'string' ? args[0].toLowerCase() : null;
      const [subject, needle] = args;
      if (typeof subject !== 'string' || typeof needle !== 'string') return false;
      const s = ctx.fold(subject);
      const n = ctx.fold(needle);
      if (node.fn === 'contains') return s.includes(n);
      if (node.fn === 'startswith') return s.startsWith(n);
      return s.endsWith(n);
    }
    case 'compare': {
      const type = typeOfSide(node.left, ctx) ?? typeOfSide(node.right, ctx);
      const left = comparable(evaluate(node.left, ctx), type);
      const right = comparable(evaluate(node.right, ctx), type);
      // OData null semantics: null eq null is true, null ne a value is true, ordering against null is false.
      if (left === null || right === null) {
        if (node.op === 'eq') return left === right;
        if (node.op === 'ne') return left !== right;
        return false;
      }
      const a = typeof left === 'string' ? ctx.fold(left) : left;
      const b = typeof right === 'string' ? ctx.fold(right) : right;
      switch (node.op) {
        case 'eq': return a === b;
        case 'ne': return a !== b;
        case 'gt': return a > b;
        case 'ge': return a >= b;
        case 'lt': return a < b;
        default: return a <= b;
      }
    }
  }
}

function typeOfSide(node: Node, ctx: EvalContext): EdmType | undefined {
  return node.kind === 'property' ? ctx.types.get(node.name) : undefined;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface ODataService {
  fetch: FetchLike;
  /** Every `$filter` the service was sent, in order. */
  filters: string[];
  rows: Array<Record<string, unknown>>;
}

export function odataService(options: ODataServiceOptions): ODataService {
  const { entitySet, properties } = options;
  const key = properties[0]!.name;
  const types = new Map(properties.map((p) => [p.name, p.type] as const));
  const fold = options.collation === 'case-insensitive' ? (t: string) => t.toLowerCase() : (t: string) => t;
  const pageSize = options.serverPageSize ?? 1000;
  const rows = options.rows.map((r) => ({ ...r }));
  const filters: string[] = [];
  const metadata = metadataFor(entitySet, properties);

  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const refused = (status: number, message: string) => json(status, { error: { code: String(status), message } });
  const project = (row: Record<string, unknown>) =>
    Object.fromEntries(properties.map((p) => [p.name, row[p.name] ?? null]));
  const keyOf = (segment: string): string | undefined => {
    const m = new RegExp(`^${entitySet}\\('((?:[^']|'')*)'\\)$`).exec(segment);
    return m ? m[1]!.replace(/''/g, "'") : undefined;
  };

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const path = decodeURIComponent(url.pathname.slice(new URL(CONFORMANCE_ROOT).pathname.length));
    const method = init.method ?? 'GET';
    if (method === 'GET' && path === '$metadata') return new Response(metadata, { status: 200 });

    if (path === entitySet && method === 'GET') {
      let matched = rows;
      const filter = url.searchParams.get('$filter');
      if (filter !== null) {
        filters.push(filter);
        let tree: Node;
        try {
          tree = parse(filter, types);
        } catch (error) {
          return refused(400, `The query specified in the URI is not valid: ${(error as Error).message}`);
        }
        matched = rows.filter((row) => evaluate(tree, { row, types, fold }) === true);
      }
      const orderby = url.searchParams.get('$orderby');
      if (orderby) {
        const terms = orderby.split(',').map((term) => {
          const [name, dir] = term.trim().split(' ');
          return { name: name!, desc: dir === 'desc', type: types.get(name!) };
        });
        matched = [...matched].sort((x, y) => {
          for (const t of terms) {
            const a = comparable(x[t.name], t.type);
            const b = comparable(y[t.name], t.type);
            if (a === b) continue;
            // OData: null sorts first ascending.
            const x1 = typeof a === 'string' ? fold(a) : a;
            const y1 = typeof b === 'string' ? fold(b) : b;
            const cmp = a === null ? -1 : b === null ? 1 : x1! < y1! ? -1 : x1! > y1! ? 1 : 0;
            if (cmp === 0) continue;
            return t.desc ? -cmp : cmp;
          }
          return 0;
        });
      }
      const count = matched.length;
      const skip = Number(url.searchParams.get('$skip') ?? 0);
      const top = url.searchParams.has('$top') ? Number(url.searchParams.get('$top')) : undefined;
      const selected = matched.slice(skip, top === undefined ? undefined : skip + top);
      const pageRows = selected.slice(0, pageSize);
      const body: Record<string, unknown> = { value: pageRows.map(project) };
      if (url.searchParams.get('$count') === 'true') body['@odata.count'] = count;
      if (selected.length > pageSize) {
        const next = new URL(url);
        next.searchParams.set('$skip', String(skip + pageSize));
        if (top !== undefined) next.searchParams.set('$top', String(top - pageSize));
        body['@odata.nextLink'] = next.toString();
      }
      return json(200, body);
    }

    if (path === entitySet && method === 'POST') {
      const created = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (created[key] === undefined) return refused(400, `The key property '${key}' is required.`);
      if (rows.some((r) => r[key] === created[key])) return refused(409, 'An entity with this key already exists.');
      rows.push(created);
      return json(201, project(created));
    }

    const id = keyOf(path);
    const index = id === undefined ? -1 : rows.findIndex((r) => String(r[key]) === id);
    if (id !== undefined && method === 'GET') return index < 0 ? refused(404, 'Not found.') : json(200, project(rows[index]!));
    if (id !== undefined && method === 'PATCH') {
      if (index < 0) return refused(404, 'Not found.');
      Object.assign(rows[index]!, JSON.parse(String(init.body)));
      return json(200, project(rows[index]!));
    }
    if (id !== undefined && method === 'DELETE') {
      if (index < 0) return refused(404, 'Not found.');
      rows.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    return refused(404, `No resource at '${path}'.`);
  };

  return { fetch, filters, rows };
}
