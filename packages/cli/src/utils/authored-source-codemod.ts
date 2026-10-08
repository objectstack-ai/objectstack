// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta --write` — write the chain's MECHANICAL edits back into the
 * authored sources, at the sites it can prove, and list every other one (#9591).
 *
 * ## What the chain hands over, and why it is not an edit
 *
 * `applyMetaMigrations` replays the conversions over the LOADED, normalised
 * stack in memory. Each `applied` entry names a conversion and a `path` into
 * that stack, plus `from` / `to` DISPLAY strings: a token (`mongo` →
 * `mongodb`), a removal (`striped` → `(removed)`) or a rendered shape
 * (`'previousPeriod'` → `{ kind: 'previousPeriod' }`). The path's anchor also
 * differs per conversion — the renamed-to key, the removed key, or the
 * container a key was removed from. So an entry alone says WHERE a conversion
 * acted, never WHAT bytes to write, and reading `from` / `to` as edits would
 * mean a parser per conversion.
 *
 * The edit is therefore taken from the chain's own two stacks instead: a
 * structural diff of the stack the chain started from against the stack it
 * produced, which is exactly — and only — what the conversions changed. Every
 * diff change is tied back to the `applied` entries whose paths explain it
 * (the site itself, a key inside it, the container of it, or a sibling key in
 * the same container), and nothing here knows any conversion by name: a
 * conversion added to the chain is covered the day it lands.
 *
 * ## The one thing this may write: a literal it can PROVE is the source
 *
 * A diff change is a path into a runtime value. It is written only when that
 * path leads, through the authored modules' syntax, to ONE object or array
 * literal in ONE project file — and the loaded value agrees with that literal:
 *
 *  - the walk starts at the config module's default export and follows the
 *    path through object and array literals, module-level `const` bindings,
 *    relative imports and re-exports, `Object.values(<namespace import>)` (the
 *    barrel shape the example apps use, in the module namespace's sorted
 *    order), and the `@objectstack/spec` `define*` helpers and `.create`
 *    factories, which the authored-source load hands their argument through;
 *  - the literal's own statically known values must match the loaded value at
 *    that site (a helper that parsed, defaulted or rebuilt it fails the match);
 *  - every binding the walk crossed must have no reference other than the
 *    walk's own, so the edit cannot change a second use of the same literal.
 *
 * Anything else — a computed value, a spread, a call to any other helper, a
 * shared binding, a file under `node_modules` or outside the project, a key
 * the loader injected, a new value with no literal spelling, a layout an edit
 * would have to disturb — is REFUSED, by a named {@link CodemodRefusalKind},
 * and the site stays on the list for the author. Nothing is guessed.
 *
 * ## Exactness
 *
 * Edits are text splices at node positions, so every byte outside an edited
 * site — comments, formatting, key order — is unchanged. A key rename keeps
 * its value's text (and its comments); a removed property takes its own
 * line(s) with it, including a comment on those same lines, and nothing else.
 * A conversion's edits are written whole or not at all: when one of its sites
 * is refused, its other sites are left too (`entangled`), so no source is ever
 * left half-converted. The command re-runs the chain over the written sources
 * and restores every file if the written sites do not come back clean.
 *
 * ## The one edit no conversion makes: the declared protocol range (#22219)
 *
 * The load refuses a manifest whose declared protocol range excludes the
 * runtime's major, and its refusal names `migrate meta --from N` as the remedy.
 * No conversion moves that range, so a write of the chain's edits alone left
 * the refusal standing. The command therefore hands the planner one more edit,
 * a {@link RangeRewrite}, and the planner treats it as one more applied entry
 * with one more change: it is traced, proved, refused, written, re-checked and
 * restored exactly like the chain's own edits. It is reported apart
 * (`plan.range`), because it is not one of the chain's `applied` entries.
 * Which range is owed, and at which key, is the command's question, not this
 * module's.
 *
 * ## What it never writes
 *
 * The chain's semantic TODOs (`todos`) are judgment calls; nothing here reads
 * them. A site a conversion declines (the `compareTo: { offset: '7d' }` case)
 * produces no diff, so it is never written either — it stays exactly where the
 * schema verdict and the semantic notice already put it.
 */

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ts as TS } from 'ts-morph';
import type { MigrationApplication } from '@objectstack/spec/migrations';
import { syntacticDiagnostics } from './emitted-source-parses.js';

type Ts = typeof TS;

/** One step of a path into a stack: an object key or an array index. */
export type Segment = string | number;

/**
 * Why a site was not written. A closed set: the command prints the kind beside
 * the reason, and the pins hold each kind to a fixture that produces it.
 */
export type CodemodRefusalKind =
  /** The value or its container is produced by an expression, not written as a literal. */
  | 'computed'
  /** Built by a call that is not an `@objectstack/spec` `define*` helper or `.create` factory. */
  | 'helper'
  /** A spread supplies the key (or the array element), or may override it. */
  | 'spread'
  /** The literal is reachable through a binding something else also references. */
  | 'shared'
  /** The site lives under `node_modules`, in a package, or outside the project. */
  | 'outside-project'
  /** The loaded value does not match the literal, so the literal is not provably its source. */
  | 'mismatch'
  /** The key is in the loaded value but not in the literal: the loader or a helper supplied it. */
  | 'injected'
  /** The converted value has no literal spelling (a function, `undefined`, a class instance). */
  | 'unspellable'
  /** The text around the site cannot be edited without touching bytes outside it. */
  | 'layout'
  /** No edit in the migrated stack could be tied to this entry. */
  | 'unattributed'
  /** Another site of the same conversion (or of one sharing an edit with it) was refused. */
  | 'entangled';

export interface CodemodRefusal {
  kind: CodemodRefusalKind;
  /** One sentence naming what blocked the write, in the author's terms. */
  reason: string;
}

/** A mechanical change written into a source file. */
export interface WrittenSite {
  application: MigrationApplication;
  /** Project-relative path of the file written. */
  file: string;
  /** 1-based line of the site in the file as it was before the write. */
  line: number;
}

/** A mechanical change left for the author, with the reason it was not written. */
export interface ManualSite {
  application: MigrationApplication;
  refusal: CodemodRefusal;
}

/** One file the plan rewrites: its bytes before and after. */
export interface FileRewrite {
  /** Absolute path. */
  path: string;
  /** Project-relative path, for display. */
  file: string;
  before: string;
  after: string;
}

/**
 * The manifest's declared protocol range, moved to the major the migrated
 * source targets (#22219). The command decides that it is owed and at which
 * key; the planner writes it like any other edit.
 */
export interface RangeRewrite {
  /** Where the range sits in the stack, spelled like `applied[].path` (`manifest.engines.protocol`). */
  path: string;
  /** The range as authored. */
  from: string;
  /** The range written in its place. */
  to: string;
  /** The protocol major `to` admits. */
  major: number;
}

/** What became of a {@link RangeRewrite}: written at a site, or left for the author with the reason. */
export type RangeOutcome =
  | { rewrite: RangeRewrite; status: 'written'; file: string; line: number }
  | { rewrite: RangeRewrite; status: 'manual'; refusal: CodemodRefusal };

export interface AuthoredSourceWritePlan {
  /** The project directory every written file lies under (the config's directory). */
  projectRoot: string;
  rewrites: FileRewrite[];
  written: WrittenSite[];
  manual: ManualSite[];
  /**
   * Paths the migrated stack changed that no `applied` entry explains. Never
   * written. Expected to be empty: a non-empty list means a conversion rewrote
   * a site without reporting it.
   */
  unexplained: string[];
  /** The declared protocol range, when the input carried a {@link RangeRewrite}. */
  range?: RangeOutcome;
}

export interface AuthoredSourceWriteInput {
  /** Absolute path of the loaded config module. */
  configPath: string;
  /** The loaded config (`loadConfig(…, { authoredSource: true }).config`). */
  config: Record<string, unknown>;
  /** The named exports `loadConfig` merged in as top-level keys. */
  namedExports: readonly string[];
  /** The stack the chain started from (`normalizeStackInput(config, { convert: false })`). */
  normalized: Record<string, unknown>;
  /** The stack the chain produced (`result.stack`). */
  migrated: Record<string, unknown>;
  /** The chain's mechanical applications (`result.applied`), in order. */
  applied: readonly MigrationApplication[];
  /** The declared protocol range the load refuses, when the command owes it an edit (#22219). */
  range?: RangeRewrite;
}

/** Thrown inside a walk; caught at the change it was resolving. */
class Refusal extends Error {
  constructor(readonly refusal: CodemodRefusal) {
    super(refusal.reason);
  }
}

function refuse(kind: CodemodRefusalKind, reason: string): never {
  throw new Refusal({ kind, reason });
}

// ── value helpers ────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** The keys that carry a value: an own key holding `undefined` reads as absent. */
function presentKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((k) => value[k] !== undefined);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = presentKeys(a);
    const kb = presentKeys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Render a path the way the chain's `applied[].path` spells one: `a.b[0].c`. */
export function formatPath(path: readonly Segment[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out === '' ? seg : `.${seg}`;
  }
  return out;
}

/** Parse an `applied[].path` (`a.b[0].c`) into segments. */
export function parsePath(path: string): Segment[] {
  const out: Segment[] = [];
  for (const part of path.split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) {
      out.push(part);
      continue;
    }
    if (m[1] !== '') out.push(m[1]!);
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out;
}

function isPrefix(prefix: readonly Segment[], path: readonly Segment[]): boolean {
  return prefix.length <= path.length && prefix.every((s, i) => s === path[i]);
}

function sameParent(a: readonly Segment[], b: readonly Segment[]): boolean {
  return a.length === b.length && a.length > 0 && isPrefix(a.slice(0, -1), b);
}

// ── the structural diff ──────────────────────────────────────────────────────

/** One difference between the stack the chain started from and the one it produced. */
export type StackChange =
  | { op: 'set'; path: Segment[]; before: unknown; after: unknown }
  | { op: 'delete'; path: Segment[]; before: unknown }
  | { op: 'add'; path: Segment[]; after: unknown }
  /** Elements dropped from an array; `path` is the array, `indices` are into `before`. */
  | { op: 'remove'; path: Segment[]; indices: number[]; before: unknown[] };

/** `small` is `big` with some elements taken out, in order — the dropped indices, or null. */
function droppedIndices(big: readonly unknown[], small: readonly unknown[]): number[] | null {
  const dropped: number[] = [];
  let j = 0;
  for (let i = 0; i < big.length; i++) {
    if (j < small.length && deepEqual(big[i], small[j])) j++;
    else dropped.push(i);
  }
  return j === small.length ? dropped : null;
}

/**
 * The minimal structural difference between two stacks, as the conversions
 * made it. Copy-on-write conversions keep every untouched subtree's identity,
 * so the walk only descends where something changed.
 */
export function diffStacks(before: unknown, after: unknown, path: Segment[] = [], out: StackChange[] = []): StackChange[] {
  if (Object.is(before, after)) return out;
  if (isPlainObject(before) && isPlainObject(after)) {
    const kb = presentKeys(before);
    const ka = presentKeys(after);
    for (const k of kb) {
      if (!ka.includes(k)) out.push({ op: 'delete', path: [...path, k], before: before[k] });
      else diffStacks(before[k], after[k], [...path, k], out);
    }
    for (const k of ka) {
      if (!kb.includes(k)) out.push({ op: 'add', path: [...path, k], after: after[k] });
    }
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === after.length) {
      for (let i = 0; i < before.length; i++) diffStacks(before[i], after[i], [...path, i], out);
      return out;
    }
    const dropped = after.length < before.length ? droppedIndices(before, after) : null;
    if (dropped) out.push({ op: 'remove', path, indices: dropped, before });
    else out.push({ op: 'set', path, before, after });
    return out;
  }
  if (deepEqual(before, after)) return out;
  out.push({ op: 'set', path, before, after });
  return out;
}

// ── attribution: which applied entries explain which changes ────────────────

/**
 * The rules that tie a change to the applied entries explaining it, tried in
 * order; a change takes the entries of the FIRST rule that finds any, so a
 * looser rule never widens an entry that already has its own edits:
 *
 *  1. the change is the site, inside it, or a container replaced around it;
 *  2. the change is a sibling key of the site — a rename's old key, where the
 *     entry names the new one;
 *  3. a MOVE between two containers of one subject (`node.config.x` →
 *     `node.waitEventConfig.y`): the entry names the destination, the change is
 *     the source, and both sit under the subject two steps above the entry.
 */
const ATTRIBUTION_RULES: ReadonlyArray<(applied: readonly Segment[], change: readonly Segment[]) => boolean> = [
  (applied, change) => isPrefix(applied, change) || isPrefix(change, applied),
  (applied, change) => sameParent(applied, change),
  (applied, change) => applied.length >= 3 && isPrefix(applied.slice(0, -2), change),
];

/** The applied entries (by index) that explain a change at `change`, by {@link ATTRIBUTION_RULES}. */
function explainingEntries(appliedPaths: readonly (readonly Segment[])[], change: readonly Segment[]): number[] {
  for (const rule of ATTRIBUTION_RULES) {
    const hits = appliedPaths.flatMap((p, i) => (rule(p, change) ? [i] : []));
    if (hits.length > 0) return hits;
  }
  return [];
}

// ── the authored module graph, read statically ──────────────────────────────

interface SourceFileRec {
  readonly path: string;
  readonly text: string;
  readonly sf: TS.SourceFile;
}

/** What the walk knows about a value, read from the source rather than run. */
type SNode =
  | { k: 'object'; file: SourceFileRec; node: TS.ObjectLiteralExpression }
  | { k: 'array'; file: SourceFileRec; node: TS.ArrayLiteralExpression }
  /** A sequence the authored code assembles (`Object.values(ns)`, an array with spreads). */
  | { k: 'list'; items: Array<(trail: Trail) => SNode>; describe: string }
  | { k: 'namespace'; file: SourceFileRec }
  | { k: 'scalar'; file: SourceFileRec; node: TS.Expression }
  /** A binding imported from `@objectstack/spec` (`name` is the imported name, `*` a namespace). */
  | { k: 'spec'; name: string }
  | { k: 'specMember'; owner: string; member: string };

/** A module-level binding the walk crossed, and how to tell its references apart. */
interface BindingRef {
  readonly file: SourceFileRec;
  readonly name: string;
}

/**
 * What one walk crossed: every binding it resolved, and every identifier it
 * resolved them THROUGH. A binding whose references are not all in `uses` is
 * referenced by something the walk did not take, so its literal is shared.
 */
class Trail {
  readonly bindings = new Map<string, BindingRef>();
  readonly uses = new Set<string>();
}

/**
 * The two patterns the authored-source shim (`loadConfig`'s `authoredSource`,
 * `utils/config.ts`) wraps by: an `@objectstack/spec` entrypoint, and a
 * `define*` export of it. A call the shim makes tolerant hands its argument
 * through when the current schema refuses it, so the walk may follow the
 * argument; when the schema accepts it, the subset check below catches any
 * default or transform the real helper applied.
 *
 * `<spec export>.create(…)` is followed on the same terms: every `create` an
 * `@objectstack/spec` entrypoint exports either validates (and is wrapped by
 * the shim's `STRICT_AUTHORING_FACTORIES`) or returns its argument untouched —
 * `test/migrate-meta-strict-factories.test.ts` holds that list to the spec
 * surface in both directions.
 */
const SPEC_SPECIFIER_RE = /^@objectstack\/spec(?:\/[\w./-]+)?$/;
const DEFINE_HELPER_RE = /^define[A-Z]/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const TS_EXT_FOR_JS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx', '.js'],
  '.jsx': ['.tsx', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
};
const PROBE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const UNKNOWN = Symbol('unknown');
/** A value read from source, or {@link UNKNOWN} where the source does not say. */
type Readable = unknown;

class SourceGraph {
  private readonly files = new Map<string, SourceFileRec>();
  private readonly exportNameCache = new Map<string, Set<string>>();

  constructor(
    private readonly ts: Ts,
    readonly projectRoot: string,
  ) {}

  rel(file: SourceFileRec | string): string {
    const p = typeof file === 'string' ? file : file.path;
    const r = relative(this.projectRoot, p);
    return r === '' ? p : r.split(sep).join('/');
  }

  file(path: string): SourceFileRec {
    const hit = this.files.get(path);
    if (hit) return hit;
    const text = readFileSync(path, 'utf8');
    const kind = /\.[cm]?tsx?$/.test(path)
      ? (path.endsWith('x') ? this.ts.ScriptKind.TSX : this.ts.ScriptKind.TS)
      : (path.endsWith('x') ? this.ts.ScriptKind.JSX : this.ts.ScriptKind.JS);
    const sf = this.ts.createSourceFile(path, text, this.ts.ScriptTarget.Latest, true, kind);
    const rec = { path, text, sf };
    this.files.set(path, rec);
    return rec;
  }

  /** Every file this graph has read — the population a reference count looks across. */
  loaded(): SourceFileRec[] {
    return [...this.files.values()];
  }

  /** A RELATIVE specifier resolved the way the bundler does; `null` for a package specifier. */
  resolveModule(from: SourceFileRec, specifier: string): string | null {
    if (!specifier.startsWith('.') && !isAbsolute(specifier)) return null;
    const base = resolve(dirname(from.path), specifier);
    const ext = /\.[cm]?jsx?$/.exec(base)?.[0];
    const candidates: string[] = [];
    if (ext && TS_EXT_FOR_JS[ext]) {
      const stem = base.slice(0, -ext.length);
      for (const e of TS_EXT_FOR_JS[ext]!) candidates.push(stem + e);
    } else {
      candidates.push(base);
      for (const e of PROBE_EXTS) candidates.push(base + e);
      for (const e of PROBE_EXTS) candidates.push(resolve(base, `index${e}`));
    }
    for (const c of candidates) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  }

  /** Read every file reachable from `entry` through relative imports and re-exports. */
  crawl(entry: string): void {
    const queue = [entry];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const rec = this.file(path);
      for (const stmt of rec.sf.statements) {
        const spec = (this.ts.isImportDeclaration(stmt) || this.ts.isExportDeclaration(stmt))
          && stmt.moduleSpecifier && this.ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : undefined;
        if (spec === undefined) continue;
        const target = this.resolveModule(rec, spec);
        if (target) queue.push(target);
      }
    }
  }

  // ── reading one expression ──

  private unwrap(expr: TS.Expression): TS.Expression {
    const ts = this.ts;
    let e = expr;
    for (;;) {
      if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)
        || ts.isTypeAssertionExpression(e) || ts.isNonNullExpression(e)) {
        e = e.expression;
        continue;
      }
      return e;
    }
  }

  /** The literal node an initializer is, under `as const` / parentheses — or undefined. */
  literalNode(expr: TS.Expression): TS.Expression | undefined {
    const e = this.unwrap(expr);
    return this.isScalar(e) || this.ts.isObjectLiteralExpression(e) || this.ts.isArrayLiteralExpression(e) ? e : undefined;
  }

  private isScalar(e: TS.Expression): boolean {
    const ts = this.ts;
    return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e)
      || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword
      || e.kind === ts.SyntaxKind.NullKeyword
      || (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand));
  }

  private scalarValue(e: TS.Expression): unknown {
    const ts = this.ts;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text.replace(/_/g, ''));
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (e.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text.replace(/_/g, ''));
    return UNKNOWN;
  }

  /** A property's key as the runtime spells it, or undefined when it is computed. */
  propName(name: TS.PropertyName): string | undefined {
    const ts = this.ts;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
    if (ts.isNumericLiteral(name)) return String(Number(name.text.replace(/_/g, '')));
    if (ts.isComputedPropertyName(name)) {
      const e = this.unwrap(name.expression);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    }
    return undefined;
  }

  /**
   * The value a literal spells, with whatever it cannot know left out: an
   * object keeps only the keys written after its last spread with a plain
   * name, an array marks an unreadable element UNKNOWN.
   */
  partialValue(expr: TS.Expression): Readable {
    const ts = this.ts;
    const e = this.unwrap(expr);
    if (this.isScalar(e)) return this.scalarValue(e);
    if (ts.isArrayLiteralExpression(e)) {
      if (e.elements.some((el) => ts.isSpreadElement(el) || ts.isOmittedExpression(el))) return UNKNOWN;
      return e.elements.map((el) => this.partialValue(el));
    }
    if (ts.isObjectLiteralExpression(e)) {
      const out: Record<string, unknown> = {};
      const lastSpread = lastSpreadIndex(ts, e);
      e.properties.forEach((p, i) => {
        if (i < lastSpread || !ts.isPropertyAssignment(p)) return;
        const name = this.propName(p.name);
        if (name === undefined) return;
        const v = this.partialValue(p.initializer);
        if (v !== UNKNOWN) out[name] = v;
      });
      return out;
    }
    return UNKNOWN;
  }

  /** The value a literal spells when every part of it is known, else UNKNOWN. */
  exactValue(expr: TS.Expression): Readable {
    const ts = this.ts;
    const e = this.unwrap(expr);
    if (this.isScalar(e)) return this.scalarValue(e);
    if (ts.isArrayLiteralExpression(e)) {
      const out: unknown[] = [];
      for (const el of e.elements) {
        if (ts.isSpreadElement(el) || ts.isOmittedExpression(el)) return UNKNOWN;
        const v = this.exactValue(el);
        if (v === UNKNOWN) return UNKNOWN;
        out.push(v);
      }
      return out;
    }
    if (ts.isObjectLiteralExpression(e)) {
      const out: Record<string, unknown> = {};
      for (const p of e.properties) {
        if (!ts.isPropertyAssignment(p)) return UNKNOWN;
        const name = this.propName(p.name);
        if (name === undefined) return UNKNOWN;
        const v = this.exactValue(p.initializer);
        if (v === UNKNOWN) return UNKNOWN;
        out[name] = v;
      }
      return out;
    }
    return UNKNOWN;
  }

  // ── following a value through the authored modules ──

  private identifierId(file: SourceFileRec, id: TS.Node): string {
    return `${file.path}#${id.getStart(file.sf)}`;
  }

  /** Resolve an expression to what the walk can know about its value; throws a {@link Refusal}. */
  resolveExpr(file: SourceFileRec, expr: TS.Expression, trail: Trail): SNode {
    const ts = this.ts;
    const e = this.unwrap(expr);
    if (ts.isObjectLiteralExpression(e)) return { k: 'object', file, node: e };
    if (ts.isArrayLiteralExpression(e)) {
      if (!e.elements.some((el) => ts.isSpreadElement(el) || ts.isOmittedExpression(el))) {
        return { k: 'array', file, node: e };
      }
      return this.expandArray(file, e, trail);
    }
    if (this.isScalar(e)) return { k: 'scalar', file, node: e };
    if (ts.isIdentifier(e)) {
      trail.uses.add(this.identifierId(file, e));
      return this.resolveIdentifier(file, e.text, trail);
    }
    if (ts.isPropertyAccessExpression(e)) {
      const base = this.resolveExpr(file, e.expression, trail);
      const member = e.name.text;
      if (base.k === 'namespace') return this.resolveExport(base.file, member, trail, new Set());
      if (base.k === 'spec') return { k: 'specMember', owner: base.name, member };
      if (base.k === 'object') {
        const prop = this.findProp(base, member);
        return this.resolveExpr(base.file, this.valueOf(prop), trail);
      }
      refuse('computed', `\`${this.snippet(file, e)}\` reads a member of a value that is not written as a literal`);
    }
    if (ts.isCallExpression(e)) return this.resolveCall(file, e, trail);
    refuse('computed', `the value is the expression \`${this.snippet(file, e)}\`, not a literal`);
  }

  private resolveCall(file: SourceFileRec, call: TS.CallExpression, trail: Trail): SNode {
    const ts = this.ts;
    const callee = this.unwrap(call.expression);
    const args = call.arguments;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      && callee.expression.text === 'Object' && callee.name.text === 'values'
      && args.length === 1 && !ts.isSpreadElement(args[0]!)) {
      return this.objectValues(file, args[0]!, trail);
    }
    let target: SNode | undefined;
    try {
      target = this.resolveExpr(file, callee, trail);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
    }
    const transparent = target !== undefined
      && ((target.k === 'spec' && DEFINE_HELPER_RE.test(target.name))
        || (target.k === 'specMember' && target.member === 'create'));
    if (!transparent) {
      refuse('helper', `the value is built by \`${this.snippet(file, callee)}(…)\`, not written as a literal`);
    }
    if (args.length < 1 || ts.isSpreadElement(args[0]!)) {
      refuse('helper', `\`${this.snippet(file, callee)}(…)\` is not called with a literal argument`);
    }
    return this.resolveExpr(file, args[0]!, trail);
  }

  private objectValues(file: SourceFileRec, arg: TS.Expression, trail: Trail): SNode {
    const base = this.resolveExpr(file, arg, trail);
    if (base.k === 'namespace') {
      // A module namespace enumerates its exports in sorted (code unit) order —
      // the order the bundler's namespace object, and the spec, both use.
      const names = [...this.exportNames(base.file)].sort();
      return {
        k: 'list',
        describe: `Object.values(${this.snippet(file, arg)})`,
        items: names.map((n) => (t: Trail) => this.resolveExport(base.file, n, t, new Set())),
      };
    }
    if (base.k === 'object') {
      const ts = this.ts;
      const props = base.node.properties;
      if (props.some((p) => !ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p))) {
        refuse('spread', `\`Object.values(${this.snippet(file, arg)})\` reads an object with a spread or a method`);
      }
      const named = props.map((p) => ({ p, name: this.propName((p as TS.PropertyAssignment).name) }));
      if (named.some((n) => n.name === undefined) || new Set(named.map((n) => n.name)).size !== named.length) {
        refuse('computed', `\`Object.values(${this.snippet(file, arg)})\` reads an object with a computed or repeated key`);
      }
      // Object.keys order: integer-like keys ascending, then the rest as written.
      const isIndex = (k: string) => /^(0|[1-9]\d*)$/.test(k) && Number(k) < 2 ** 32 - 1;
      const ordered = [
        ...named.filter((n) => isIndex(n.name!)).sort((a, b) => Number(a.name) - Number(b.name)),
        ...named.filter((n) => !isIndex(n.name!)),
      ];
      return {
        k: 'list',
        describe: `Object.values(${this.snippet(file, arg)})`,
        items: ordered.map(({ p }) => (t: Trail) => this.resolveExpr(base.file, this.valueOf(p as TS.ObjectLiteralElementLike), t)),
      };
    }
    refuse('computed', `\`Object.values(${this.snippet(file, arg)})\` reads a value that is not a module namespace or an object literal`);
  }

  private expandArray(file: SourceFileRec, node: TS.ArrayLiteralExpression, trail: Trail): SNode {
    const ts = this.ts;
    const items: Array<(t: Trail) => SNode> = [];
    for (const el of node.elements) {
      if (ts.isOmittedExpression(el)) {
        items.push(() => refuse('computed', 'the array has a hole at this index'));
      } else if (ts.isSpreadElement(el)) {
        const source = this.resolveExpr(file, el.expression, trail);
        if (source.k === 'array') {
          for (const inner of source.node.elements) items.push((t) => this.resolveExpr(source.file, inner, t));
        } else if (source.k === 'list') {
          items.push(...source.items);
        } else {
          refuse('spread', `\`...${this.snippet(file, el.expression)}\` spreads a value that is not a literal array`);
        }
      } else {
        items.push((t) => this.resolveExpr(file, el, t));
      }
    }
    return { k: 'list', items, describe: 'an array literal with spreads' };
  }

  private resolveIdentifier(file: SourceFileRec, name: string, trail: Trail): SNode {
    const ts = this.ts;
    for (const stmt of file.sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
          if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) {
            refuse('computed', `\`${name}\` is a \`let\`/\`var\` binding, which can be reassigned`);
          }
          if (!decl.initializer) refuse('computed', `\`${name}\` has no initializer`);
          trail.bindings.set(`${file.path}#${name}`, { file, name });
          return this.resolveExpr(file, decl.initializer, trail);
        }
      } else if (ts.isImportDeclaration(stmt) && stmt.importClause && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const clause = stmt.importClause;
        const specifier = stmt.moduleSpecifier.text;
        let imported: string | undefined;
        if (clause.name?.text === name) imported = 'default';
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) imported = '*';
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (el.name.text === name) {
              if (el.isTypeOnly) refuse('computed', `\`${name}\` is a type-only import`);
              imported = (el.propertyName ?? el.name).text;
            }
          }
        }
        if (imported === undefined) continue;
        if (clause.isTypeOnly) refuse('computed', `\`${name}\` is a type-only import`);
        if (SPEC_SPECIFIER_RE.test(specifier)) return { k: 'spec', name: imported };
        const target = this.resolveModule(file, specifier);
        if (!target) refuse('outside-project', `\`${name}\` is imported through ${unresolved(specifier)}`);
        const mod = this.file(target);
        if (imported === '*') return { k: 'namespace', file: mod };
        return this.resolveExport(mod, imported, trail, new Set());
      } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt))
        && stmt.name?.text === name) {
        refuse('computed', `\`${name}\` is a ${ts.isFunctionDeclaration(stmt) ? 'function' : ts.isClassDeclaration(stmt) ? 'class' : 'enum'}, not a literal`);
      }
    }
    refuse('computed', `\`${name}\` is not a module-level binding of ${this.rel(file)}`);
  }

  /** Resolve export `name` of `mod` to the value it carries; throws a {@link Refusal}. */
  resolveExport(mod: SourceFileRec, name: string, trail: Trail, visiting: Set<string>): SNode {
    const ts = this.ts;
    const key = `${mod.path}#${name}`;
    if (visiting.has(key)) refuse('computed', `\`${name}\` is re-exported in a cycle`);
    visiting.add(key);
    const stars: SourceFileRec[] = [];
    for (const stmt of mod.sf.statements) {
      if (ts.isVariableStatement(stmt) && hasModifier(ts, stmt, ts.SyntaxKind.ExportKeyword)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name) return this.resolveIdentifier(mod, name, trail);
        }
      } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && name === 'default') {
        trail.bindings.set(`${mod.path}#default`, { file: mod, name: 'default' });
        return this.resolveExpr(mod, stmt.expression, trail);
      } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt))
        && hasModifier(ts, stmt, ts.SyntaxKind.ExportKeyword)
        && (hasModifier(ts, stmt, ts.SyntaxKind.DefaultKeyword) ? 'default' : stmt.name?.text) === name) {
        refuse('computed', `\`${name}\` exported by ${this.rel(mod)} is a ${ts.isFunctionDeclaration(stmt) ? 'function' : 'class'}, not a literal`);
      } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
        const specifier = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined;
        const clause = stmt.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const el of clause.elements) {
            if (el.isTypeOnly || el.name.text !== name) continue;
            const local = (el.propertyName ?? el.name).text;
            if (specifier === undefined) return this.resolveIdentifier(mod, local, trail);
            if (SPEC_SPECIFIER_RE.test(specifier)) return { k: 'spec', name: local };
            const target = this.resolveModule(mod, specifier);
            if (!target) refuse('outside-project', `\`${name}\` is re-exported from ${unresolved(specifier)}`);
            return this.resolveExport(this.file(target), local, trail, visiting);
          }
        } else if (clause && ts.isNamespaceExport(clause) && clause.name.text === name && specifier !== undefined) {
          const target = this.resolveModule(mod, specifier);
          if (!target) refuse('outside-project', `\`${name}\` re-exports ${unresolved(specifier)}`);
          return { k: 'namespace', file: this.file(target) };
        } else if (!clause && specifier !== undefined && name !== 'default') {
          const target = this.resolveModule(mod, specifier);
          if (target) stars.push(this.file(target));
        }
      }
    }
    const hits = stars.filter((s) => this.exportNames(s).has(name));
    if (hits.length === 1) return this.resolveExport(hits[0]!, name, trail, visiting);
    if (hits.length > 1) refuse('computed', `\`${name}\` is exported by more than one \`export *\` of ${this.rel(mod)}`);
    refuse('computed', `\`${name}\` is not a runtime export of ${this.rel(mod)}`);
  }

  /** The runtime export names of a module — types excluded, star re-exports followed. */
  exportNames(mod: SourceFileRec, visiting: Set<string> = new Set()): Set<string> {
    const cached = this.exportNameCache.get(mod.path);
    if (cached) return cached;
    if (visiting.has(mod.path)) return new Set();
    visiting.add(mod.path);
    const ts = this.ts;
    const names = new Set<string>();
    const localTypes = new Set<string>();
    for (const stmt of mod.sf.statements) {
      if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name) localTypes.add(stmt.name.text);
    }
    for (const stmt of mod.sf.statements) {
      const exported = hasModifier(ts, stmt, ts.SyntaxKind.ExportKeyword) && !hasModifier(ts, stmt, ts.SyntaxKind.DeclareKeyword);
      if (ts.isVariableStatement(stmt) && exported) {
        for (const decl of stmt.declarationList.declarations) if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && exported) {
        if (hasModifier(ts, stmt, ts.SyntaxKind.DefaultKeyword)) names.add('default');
        else if (stmt.name) names.add(stmt.name.text);
      } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        names.add('default');
      } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
        const specifier = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined;
        const target = specifier !== undefined ? this.resolveModule(mod, specifier) : null;
        const clause = stmt.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const el of clause.elements) {
            if (el.isTypeOnly) continue;
            const local = (el.propertyName ?? el.name).text;
            if (specifier === undefined && localTypes.has(local)) continue;
            if (target && !this.exportNames(this.file(target), visiting).has(local)) continue;
            names.add(el.name.text);
          }
        } else if (clause && ts.isNamespaceExport(clause)) {
          names.add(clause.name.text);
        } else if (!clause && target) {
          for (const n of this.exportNames(this.file(target), visiting)) if (n !== 'default') names.add(n);
        }
      }
    }
    this.exportNameCache.set(mod.path, names);
    return names;
  }

  /** The value expression of an object-literal member the walk may follow. */
  valueOf(prop: TS.ObjectLiteralElementLike): TS.Expression {
    const ts = this.ts;
    if (ts.isPropertyAssignment(prop)) return prop.initializer;
    if (ts.isShorthandPropertyAssignment(prop)) return prop.name;
    refuse('computed', 'the key is a method or an accessor, not a value');
  }

  /**
   * The member of an object literal that supplies `key` at runtime. Refused
   * when a spread supplies it or could override it, or when it is not written
   * there at all.
   */
  findProp(obj: { file: SourceFileRec; node: TS.ObjectLiteralExpression }, key: string): TS.ObjectLiteralElementLike {
    const ts = this.ts;
    const props = obj.node.properties;
    const lastSpread = lastSpreadIndex(ts, obj.node);
    let found: number | undefined;
    let computed = false;
    props.forEach((p, i) => {
      if (ts.isSpreadAssignment(p)) return;
      const name = p.name ? this.propName(p.name) : undefined;
      if (name === undefined) computed = true;
      else if (name === key) {
        if (found !== undefined) refuse('mismatch', `\`${key}\` is written twice in this literal`);
        found = i;
      }
    });
    if (found === undefined) {
      if (lastSpread >= 0) refuse('spread', `\`${key}\` comes from a spread (\`...\`) in ${this.rel(obj.file)}, not from a key written there`);
      if (computed) refuse('computed', `\`${key}\` may come from a computed key in ${this.rel(obj.file)}`);
      refuse('injected', `\`${key}\` is not written in the literal at ${this.at(obj.file, obj.node)} — the loader or a helper supplied it`);
    }
    if (found < lastSpread) refuse('spread', `a spread written after \`${key}\` in ${this.rel(obj.file)} may override it`);
    return props[found]!;
  }

  snippet(file: SourceFileRec, node: TS.Node): string {
    const text = node.getText(file.sf).replace(/\s+/g, ' ');
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  }

  at(file: SourceFileRec, node: TS.Node): string {
    return `${this.rel(file)}:${file.sf.getLineAndCharacterOfPosition(node.getStart(file.sf)).line + 1}`;
  }

  // ── who else references a binding ──

  /** The binding an export resolves to (`file#local`), or null when it is not one this walk tracks. */
  private bindingOfExport(mod: SourceFileRec, name: string, visiting: Set<string> = new Set()): string | null {
    const ts = this.ts;
    const key = `${mod.path}#${name}`;
    if (visiting.has(key)) return null;
    visiting.add(key);
    const stars: SourceFileRec[] = [];
    for (const stmt of mod.sf.statements) {
      if (ts.isVariableStatement(stmt) && hasModifier(ts, stmt, ts.SyntaxKind.ExportKeyword)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name) return key;
        }
      } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && name === 'default') {
        return key;
      } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
        const specifier = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined;
        const clause = stmt.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const el of clause.elements) {
            if (el.isTypeOnly || el.name.text !== name) continue;
            const local = (el.propertyName ?? el.name).text;
            if (specifier === undefined) return `${mod.path}#${local}`;
            const target = this.resolveModule(mod, specifier);
            return target ? this.bindingOfExport(this.file(target), local, visiting) : null;
          }
        } else if (!clause && specifier !== undefined && name !== 'default') {
          const target = this.resolveModule(mod, specifier);
          if (target) stars.push(this.file(target));
        }
      }
    }
    const hits = stars.filter((s) => this.exportNames(s).has(name));
    return hits.length === 1 ? this.bindingOfExport(hits[0]!, name, visiting) : null;
  }

  /** Whether an identifier occurrence READS a binding (not a declaration, key, type or specifier). */
  private isReference(id: TS.Identifier): boolean {
    const ts = this.ts;
    const p = id.parent;
    if (!p) return false;
    if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p)
      || ts.isEnumDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)
      || ts.isParameter(p) || ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)
      || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)
      || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isEnumMember(p)) && p.name === id) return false;
    if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)
      || ts.isExportSpecifier(p) || ts.isNamespaceExport(p) || ts.isQualifiedName(p)
      || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
    for (let n: TS.Node | undefined = p; n && !ts.isSourceFile(n); n = n.parent) {
      if (ts.isTypeNode(n)) return false;
      if (ts.isStatement(n)) break;
    }
    return true;
  }

  private referenceIds(file: SourceFileRec, names: ReadonlySet<string>, keep?: (id: TS.Identifier) => boolean): string[] {
    const ts = this.ts;
    const out: string[] = [];
    const visit = (node: TS.Node): void => {
      if (ts.isIdentifier(node) && names.has(node.text) && this.isReference(node) && (!keep || keep(node))) {
        out.push(this.identifierId(file, node));
      }
      node.forEachChild(visit);
    };
    visit(file.sf);
    return out;
  }

  /**
   * Every identifier, across the files this graph read, that reads the binding
   * `file#name`: by its own name in its own module, through a default or named
   * import (under any alias), or through a namespace import of any module that
   * exports it — `ns.Name` or the namespace used whole.
   */
  references(binding: BindingRef): string[] {
    const ts = this.ts;
    const key = `${binding.file.path}#${binding.name}`;
    const out = binding.name === 'default' ? [] : this.referenceIds(binding.file, new Set([binding.name]));
    for (const g of this.loaded()) {
      for (const stmt of g.sf.statements) {
        if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        const target = this.resolveModule(g, stmt.moduleSpecifier.text);
        if (!target) continue;
        const mod = this.file(target);
        const clause = stmt.importClause;
        const aliases = new Set<string>();
        if (clause.name && this.bindingOfExport(mod, 'default') === key) aliases.add(clause.name.text);
        const nb = clause.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            if (this.bindingOfExport(mod, (el.propertyName ?? el.name).text) === key) aliases.add(el.name.text);
          }
        }
        if (aliases.size > 0) out.push(...this.referenceIds(g, aliases));
        if (nb && ts.isNamespaceImport(nb)) {
          const via = [...this.exportNames(mod)].filter((n) => this.bindingOfExport(mod, n) === key);
          if (via.length > 0) {
            out.push(...this.referenceIds(g, new Set([nb.name.text]), (id) => {
              const p = id.parent;
              // `ns.Other` reads a different export; anything else reaches this one.
              return !(p && ts.isPropertyAccessExpression(p) && p.expression === id && !via.includes(p.name.text));
            }));
          }
        }
      }
    }
    return out;
  }
}

/** Why a specifier leads nowhere the walk reads. */
function unresolved(specifier: string): string {
  return specifier.startsWith('.') || isAbsolute(specifier)
    ? `\`${specifier}\`, which resolves to no project file`
    : `\`${specifier}\` — a package or a path alias, not a project file this walk reads`;
}

function hasModifier(ts: Ts, node: TS.Node, kind: TS.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === kind);
}

function lastSpreadIndex(ts: Ts, node: TS.ObjectLiteralExpression): number {
  let last = -1;
  node.properties.forEach((p, i) => { if (ts.isSpreadAssignment(p)) last = i; });
  return last;
}

// ── locating a change's container in the source ─────────────────────────────

interface Located {
  readonly key: string;
  readonly node: Extract<SNode, { k: 'object' } | { k: 'array' }>;
  /** The loaded value at the container's path. */
  readonly rt: unknown;
}

function subsetOf(partial: unknown, rt: unknown): boolean {
  if (partial === UNKNOWN) return true;
  if (Array.isArray(partial)) {
    return Array.isArray(rt) && rt.length === partial.length && partial.every((v, i) => subsetOf(v, rt[i]));
  }
  if (isPlainObject(partial)) {
    return isPlainObject(rt) && Object.keys(partial).every((k) => Object.prototype.hasOwnProperty.call(rt, k) && subsetOf(partial[k], rt[k]));
  }
  return Object.is(partial, rt);
}

class Locator {
  private readonly cache = new Map<string, Located | Refusal>();
  private readonly configFile: SourceFileRec;

  constructor(
    private readonly ts: Ts,
    private readonly graph: SourceGraph,
    private readonly config: Record<string, unknown>,
    private readonly namedExports: readonly string[],
    configPath: string,
  ) {
    this.configFile = graph.file(configPath);
  }

  private root(trail: Trail): SNode {
    const ts = this.ts;
    for (const stmt of this.configFile.sf.statements) {
      if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) return this.graph.resolveExpr(this.configFile, stmt.expression, trail);
    }
    if (this.graph.exportNames(this.configFile).has('default')) {
      return this.graph.resolveExport(this.configFile, 'default', trail, new Set());
    }
    return { k: 'namespace', file: this.configFile };
  }

  private step(node: SNode, seg: Segment, trail: Trail, rtParent: unknown, atRoot: boolean): SNode {
    const g = this.graph;
    switch (node.k) {
      case 'object': {
        if (typeof seg !== 'string') refuse('mismatch', `the literal at ${g.at(node.file, node.node)} is an object where the loaded value is an array`);
        try {
          return g.resolveExpr(node.file, g.valueOf(g.findProp(node, seg)), trail);
        } catch (error) {
          // A config's named export is merged in as a top-level key when the
          // default export does not carry it (`loadConfig`).
          if (atRoot && error instanceof Refusal && error.refusal.kind === 'injected' && this.namedExports.includes(seg)) {
            return g.resolveExport(this.configFile, seg, trail, new Set());
          }
          throw error;
        }
      }
      case 'array': {
        if (typeof seg !== 'number') refuse('mismatch', `the literal at ${g.at(node.file, node.node)} is an array where the loaded value is an object`);
        const elements = node.node.elements;
        if (!Array.isArray(rtParent) || rtParent.length !== elements.length || seg >= elements.length) {
          refuse('mismatch', `the array at ${g.at(node.file, node.node)} has ${elements.length} element(s) where the loaded value has ${Array.isArray(rtParent) ? rtParent.length : 'none'}`);
        }
        return g.resolveExpr(node.file, elements[seg]!, trail);
      }
      case 'list': {
        if (typeof seg !== 'number') refuse('mismatch', `${node.describe} is a list where the loaded value is an object`);
        if (!Array.isArray(rtParent) || rtParent.length !== node.items.length || seg >= node.items.length) {
          refuse('mismatch', `${node.describe} reads as ${node.items.length} element(s) where the loaded value has ${Array.isArray(rtParent) ? rtParent.length : 'none'}`);
        }
        return node.items[seg]!(trail);
      }
      case 'namespace':
        if (typeof seg !== 'string') refuse('mismatch', `the module namespace of ${g.rel(node.file)} has no index ${seg}`);
        return g.resolveExport(node.file, seg, trail, new Set());
      case 'scalar':
        refuse('mismatch', `the literal at ${g.at(node.file, node.node)} is a scalar where the loaded value has members`);
      default:
        refuse('computed', 'the value comes from `@objectstack/spec`, not from the project');
    }
  }

  /** The literal that holds the site at `path` (a normalised-stack path); throws a {@link Refusal}. */
  container(path: readonly Segment[]): Located {
    const key = JSON.stringify(path);
    const hit = this.cache.get(key);
    if (hit instanceof Refusal) throw hit;
    if (hit) return hit;
    try {
      const located = this.locate(path, key);
      this.cache.set(key, located);
      return located;
    } catch (error) {
      if (error instanceof Refusal) this.cache.set(key, error);
      throw error;
    }
  }

  private locate(path: readonly Segment[], key: string): Located {
    const g = this.graph;
    const trail = new Trail();
    let node = this.root(trail);
    let rt: unknown = this.config;
    path.forEach((raw, depth) => {
      let seg = raw;
      // A map-form collection (`objects: { account: {…} }`) is normalised to an
      // array in `Object.entries` order before the chain runs.
      if (typeof seg === 'number' && isPlainObject(rt)) {
        const keys = Object.keys(rt);
        if (seg >= keys.length) refuse('mismatch', `the loaded map has no entry ${seg}`);
        seg = keys[seg]!;
      }
      node = this.step(node, seg, trail, rt, depth === 0);
      rt = rt !== null && typeof rt === 'object' ? (rt as Record<string, unknown>)[seg as string] : undefined;
    });

    if (node.k === 'list') refuse('spread', `the container is assembled by ${node.describe}, not written as one literal`);
    if (node.k === 'namespace') refuse('computed', 'the container is a module namespace, not a literal');
    if (node.k === 'scalar') refuse('mismatch', `the literal at ${g.at(node.file, node.node)} is a scalar where the loaded value is a container`);
    if (node.k !== 'object' && node.k !== 'array') refuse('computed', 'the value comes from `@objectstack/spec`, not from the project');

    const real = realpathSafe(node.file.path);
    const inside = relative(g.projectRoot, real);
    if (inside.startsWith('..') || isAbsolute(inside) || real.split(sep).includes('node_modules')) {
      refuse('outside-project', `the literal is in ${real}, outside the project at ${g.projectRoot}`);
    }

    if (!subsetOf(g.partialValue(node.node), rt)) {
      refuse('mismatch', `the loaded value does not match the literal at ${g.at(node.file, node.node)} — a helper parsed or rebuilt it, or code changed it after it was written`);
    }

    for (const binding of trail.bindings.values()) {
      const others = g.references(binding).filter((id) => !trail.uses.has(id));
      if (others.length > 0) {
        refuse('shared', `\`${binding.name}\` (${g.rel(binding.file)}) is referenced ${others.length} more time(s) than this site, so editing its literal would change those uses too`);
      }
    }
    return { key, node, rt };
  }
}

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

// ── text: spelling values and splicing them in ──────────────────────────────

/** How far an inline rendering may run before it breaks across lines. */
const INLINE_WIDTH = 100;

function quoteString(value: string, quote: string): string {
  let out = quote;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out + quote;
}

function keyText(key: string, quote: string): string {
  return IDENTIFIER_RE.test(key) ? key : quoteString(key, quote);
}

/** A converted value as TypeScript source; throws `unspellable` for a value no literal can spell. */
export function spellValue(value: unknown, indent: string, quote = "'"): string {
  if (typeof value === 'string') return quoteString(value, quote);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) refuse('unspellable', `the converted value ${String(value)} has no literal spelling`);
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts = value.map((v) => spellValue(v, inner, quote));
    const inline = `[${parts.join(', ')}]`;
    if (!inline.includes('\n') && indent.length + inline.length <= INLINE_WIDTH) return inline;
    return `[\n${parts.map((p) => inner + p).join(',\n')},\n${indent}]`;
  }
  if (isPlainObject(value)) {
    const keys = presentKeys(value);
    if (keys.length === 0) return '{}';
    const parts = keys.map((k) => `${keyText(k, quote)}: ${spellValue(value[k], inner, quote)}`);
    const inline = `{ ${parts.join(', ')} }`;
    if (!inline.includes('\n') && indent.length + inline.length <= INLINE_WIDTH) return inline;
    return `{\n${parts.map((p) => inner + p).join(',\n')},\n${indent}}`;
  }
  refuse('unspellable', `the converted value is ${value === undefined ? '`undefined`' : `a ${typeof value === 'function' ? 'function' : 'non-plain object'}`}, which has no literal spelling`);
}

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

function indentAt(text: string, pos: number): string {
  const ls = lineStart(text, pos);
  return /^[ \t]*/.exec(text.slice(ls))![0];
}

/**
 * The range a member occupies when it sits on lines of its own: from the start
 * of its first line through the line break after it, taking its separator and
 * a comment on that same line with it. Null when other code shares the lines.
 */
function ownLines(text: string, start: number, end: number): [number, number] | null {
  const ls = lineStart(text, start);
  if (!/^[ \t]*$/.test(text.slice(ls, start))) return null;
  let p = end;
  const skip = () => { while (text[p] === ' ' || text[p] === '\t') p++; };
  skip();
  if (text[p] === ',') p++;
  skip();
  if (text.startsWith('//', p)) {
    const nl = text.indexOf('\n', p);
    p = nl < 0 ? text.length : nl;
    if (text[p - 1] === '\r') p--;
  } else if (text.startsWith('/*', p)) {
    const close = text.indexOf('*/', p);
    if (close < 0 || text.slice(p, close).includes('\n')) return null;
    p = close + 2;
    skip();
  }
  if (p === text.length) return [ls, p];
  if (text[p] === '\r' && text[p + 1] === '\n') return [ls, p + 2];
  if (text[p] === '\n') return [ls, p + 1];
  return null;
}

/** Where a member's line ends: the offset of its line break (or the end of the text). */
function lineBreakAfter(range: [number, number], text: string): number {
  const [, end] = range;
  if (end === text.length && text[end - 1] !== '\n') return end;
  return text[end - 2] === '\r' ? end - 2 : end - 1;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
  component: number;
}

/** A change resolved to the literal it edits. */
interface Resolved {
  readonly change: StackChange;
  readonly component: number;
  readonly container: Located;
  /** The changed key (object container) or element index (array `set`). */
  readonly member?: Segment;
  /** 1-based line of the site in the file as read. */
  readonly line: number;
}

// ── planning ────────────────────────────────────────────────────────────────

class Planner {
  constructor(
    private readonly ts: Ts,
    private readonly graph: SourceGraph,
    private readonly locator: Locator,
  ) {}

  private lineOf(file: SourceFileRec, pos: number): number {
    return file.sf.getLineAndCharacterOfPosition(pos).line + 1;
  }

  /** Phase 1: tie one change to the literal it would edit, proving what can be proved. */
  resolve(change: StackChange, component: number): Resolved {
    const ts = this.ts;
    const g = this.graph;
    const containerPath = change.op === 'remove' ? change.path : change.path.slice(0, -1);
    const container = this.locator.container(containerPath);
    const { node, rt } = container;
    const file = node.file;

    if (change.op === 'remove') {
      if (node.k !== 'array') refuse('mismatch', `the literal at ${g.at(file, node.node)} is not an array`);
      const first = node.node.elements[change.indices[0]!];
      if (!first) refuse('mismatch', `the array at ${g.at(file, node.node)} has no element ${change.indices[0]}`);
      return { change, component, container, line: this.lineOf(file, first.getStart(file.sf)) };
    }

    const member = change.path[change.path.length - 1]!;
    if (node.k === 'array') {
      if (change.op !== 'set' || typeof member !== 'number') refuse('mismatch', `the literal at ${g.at(file, node.node)} is an array`);
      const el = node.node.elements[member];
      if (!el) refuse('mismatch', `the array at ${g.at(file, node.node)} has no element ${member}`);
      this.provenLiteral(file, el, (rt as unknown[])[member]);
      spellValue(change.after, '');
      return { change, component, container, member, line: this.lineOf(file, el.getStart(file.sf)) };
    }

    if (typeof member !== 'string') refuse('mismatch', `the literal at ${g.at(file, node.node)} is an object`);
    const rtObject = rt as Record<string, unknown>;
    if (change.op === 'add') {
      const written = node.node.properties.some((p) => !ts.isSpreadAssignment(p) && p.name && g.propName(p.name) === member);
      if (written) refuse('mismatch', `\`${member}\` is already written in the literal at ${g.at(file, node.node)}`);
      spellValue(change.after, '');
      return { change, component, container, member, line: this.lineOf(file, node.node.getStart(file.sf)) };
    }
    const prop = g.findProp(node, member);
    if (change.op === 'set') {
      if (!ts.isPropertyAssignment(prop)) refuse('computed', `\`${member}\` is written as the binding \`${g.snippet(file, prop)}\`, not a literal`);
      this.provenLiteral(file, prop.initializer, rtObject[member]);
      spellValue(change.after, '');
    } else if (ts.isPropertyAssignment(prop)) {
      // A delete: a literal value, when there is one, must be the loaded one.
      const lit = g.literalNode(prop.initializer);
      if (lit) {
        const exact = g.exactValue(lit);
        if (exact !== UNKNOWN && !deepEqual(exact, rtObject[member])) {
          refuse('mismatch', `\`${member}\` at ${g.at(file, prop)} is not the value that was loaded`);
        }
      }
    }
    return { change, component, container, member, line: this.lineOf(file, prop.getStart(file.sf)) };
  }

  /** The node is a literal whose value is exactly the loaded one; throws otherwise. */
  private provenLiteral(file: SourceFileRec, expr: TS.Expression, loaded: unknown): TS.Expression {
    const g = this.graph;
    const lit = g.literalNode(expr);
    if (!lit) refuse('computed', `the value is the expression \`${g.snippet(file, expr)}\`, not a literal`);
    const exact = g.exactValue(lit);
    if (exact === UNKNOWN) refuse('computed', `the literal \`${g.snippet(file, lit)}\` holds a value that is not itself a literal`);
    if (!deepEqual(exact, loaded)) refuse('mismatch', `the literal at ${g.at(file, lit)} is not the value that was loaded`);
    return lit;
  }

  private quoteOf(file: SourceFileRec, node: TS.Node | undefined): string {
    if (node && (this.ts.isStringLiteral(node) || this.ts.isNoSubstitutionTemplateLiteral(node))) {
      const q = file.text[node.getStart(file.sf)]!;
      if (q === '"' || q === "'") return q;
    }
    return "'";
  }

  /** Phase 3: the edits one literal needs for every change written into it. */
  edits(items: readonly Resolved[]): TextEdit[] {
    const ts = this.ts;
    const g = this.graph;
    const { node } = items[0]!.container;
    const file = node.file;
    const text = file.text;
    const open = node.node.getStart(file.sf);
    const close = node.node.end - 1;
    const out: TextEdit[] = [];
    const members: readonly TS.Node[] = node.k === 'object' ? node.node.properties : node.node.elements;
    const deleted = new Map<number, number>(); // member index → component
    const adds: Array<{ key: string; value: unknown; component: number }> = [];

    const indexOfKey = (key: Segment): number => {
      if (node.k !== 'object') return -1;
      return node.node.properties.findIndex((p) => !ts.isSpreadAssignment(p) && p.name && g.propName(p.name) === key);
    };

    // Group the object changes by component so a rename pairs only within its own conversion.
    const byComponent = new Map<number, Resolved[]>();
    for (const r of items) {
      const list = byComponent.get(r.component) ?? [];
      list.push(r);
      byComponent.set(r.component, list);
    }

    for (const [component, list] of byComponent) {
      const dels = list.filter((r) => r.change.op === 'delete');
      const addsHere = list.filter((r) => r.change.op === 'add');
      for (const r of list) {
        const c = r.change;
        if (c.op === 'remove') {
          for (const i of c.indices) deleted.set(i, component);
        } else if (c.op === 'set') {
          const target = node.k === 'array'
            ? node.node.elements[r.member as number]!
            : (members[indexOfKey(r.member!)] as TS.PropertyAssignment).initializer;
          const lit = g.literalNode(target)!;
          const start = lit.getStart(file.sf);
          out.push({ start, end: lit.end, text: spellValue(c.after, indentAt(text, start), this.quoteOf(file, lit)), component });
        }
      }
      // Renames: a removed key and an added key holding the same value.
      const pairedAdds = new Set<Resolved>();
      const unpairedDels: Resolved[] = [];
      for (const d of dels) {
        const before = (d.change as { before: unknown }).before;
        const a = addsHere.find((x) => !pairedAdds.has(x) && deepEqual((x.change as { after: unknown }).after, before));
        if (!a) { unpairedDels.push(d); continue; }
        pairedAdds.add(a);
        const prop = members[indexOfKey(d.member!)] as TS.ObjectLiteralElementLike;
        const newKey = a.member as string;
        if (ts.isShorthandPropertyAssignment(prop)) {
          out.push({ start: prop.getStart(file.sf), end: prop.end, text: `${keyText(newKey, "'")}: ${prop.name.text}`, component });
        } else {
          const name = prop.name!;
          out.push({ start: name.getStart(file.sf), end: name.end, text: keyText(newKey, this.quoteOf(file, name)), component });
        }
      }
      const unpairedAdds = addsHere.filter((a) => !pairedAdds.has(a));
      if (unpairedDels.length === 1 && unpairedAdds.length === 1) {
        // One key out, one key in, values differ: the member is rewritten in place.
        const d = unpairedDels[0]!;
        const a = unpairedAdds[0]!;
        const prop = members[indexOfKey(d.member!)] as TS.ObjectLiteralElementLike;
        if (!ts.isPropertyAssignment(prop) || !g.literalNode(prop.initializer)) {
          refuse('computed', `\`${String(d.member)}\` at ${g.at(file, prop)} becomes \`${String(a.member)}\` with a new value, and its old value is not a literal`);
        }
        const start = prop.getStart(file.sf);
        const quote = this.quoteOf(file, g.literalNode(prop.initializer));
        out.push({
          start,
          end: prop.end,
          text: `${keyText(a.member as string, quote)}: ${spellValue((a.change as { after: unknown }).after, indentAt(text, start), quote)}`,
          component,
        });
      } else {
        for (const d of unpairedDels) deleted.set(indexOfKey(d.member!), component);
        for (const a of unpairedAdds) adds.push({ key: a.member as string, value: (a.change as { after: unknown }).after, component });
      }
    }

    out.push(...this.deletions(file, open, close, members, deleted));
    out.push(...this.insertions(file, open, close, members, deleted, adds));
    return out;
  }

  private deletions(file: SourceFileRec, open: number, close: number, members: readonly TS.Node[], deleted: ReadonlyMap<number, number>): TextEdit[] {
    if (deleted.size === 0) return [];
    const text = file.text;
    const span = (m: TS.Node): [number, number] => [m.getStart(file.sf), m.end];
    const out: TextEdit[] = [];
    if (text.slice(open, close).includes('\n')) {
      for (const [i, component] of deleted) {
        const [s, e] = span(members[i]!);
        const range = ownLines(text, s, e);
        if (!range) refuse('layout', `the member at ${this.graph.at(file, members[i]!)} shares its line with other code`);
        out.push({ start: range[0], end: range[1], text: '', component });
      }
      return out;
    }
    // One line: delete each run of neighbours together with the separators around it.
    const sepOk = (from: number, to: number) => /^\s*,\s*$/.test(text.slice(from, to));
    const indices = [...deleted.keys()].sort((a, b) => a - b);
    let k = 0;
    while (k < indices.length) {
      let j = k;
      while (j + 1 < indices.length && indices[j + 1] === indices[j]! + 1) j++;
      const first = indices[k]!;
      const last = indices[j]!;
      const component = deleted.get(first)!;
      for (let t = first; t < last; t++) {
        if (!sepOk(span(members[t]!)[1], span(members[t + 1]!)[0])) refuse('layout', `a comment sits between the members at ${this.graph.at(file, members[t]!)}`);
      }
      if (last + 1 < members.length) {
        if (!sepOk(span(members[last]!)[1], span(members[last + 1]!)[0])) refuse('layout', `a comment sits beside the member at ${this.graph.at(file, members[last]!)}`);
        out.push({ start: span(members[first]!)[0], end: span(members[last + 1]!)[0], text: '', component });
      } else if (first > 0) {
        if (!sepOk(span(members[first - 1]!)[1], span(members[first]!)[0])) refuse('layout', `a comment sits beside the member at ${this.graph.at(file, members[first]!)}`);
        out.push({ start: span(members[first - 1]!)[1], end: span(members[last]!)[1], text: '', component });
      } else {
        const after = text.slice(span(members[last]!)[1], close);
        if (!/^\s*$/.test(text.slice(open + 1, span(members[0]!)[0])) || !/^\s*,?\s*$/.test(after)) {
          refuse('layout', `a comment sits inside the literal at ${this.graph.at(file, members[0]!)}`);
        }
        out.push({ start: open + 1, end: close, text: '', component });
      }
      k = j + 1;
    }
    return out;
  }

  private insertions(
    file: SourceFileRec,
    open: number,
    close: number,
    members: readonly TS.Node[],
    deleted: ReadonlyMap<number, number>,
    adds: ReadonlyArray<{ key: string; value: unknown; component: number }>,
  ): TextEdit[] {
    if (adds.length === 0) return [];
    const text = file.text;
    const component = adds[0]!.component;
    const quote = "'";
    if (members.length === 0) {
      if (!/^\s*$/.test(text.slice(open + 1, close))) refuse('layout', `a comment sits inside the empty literal at ${this.graph.at(file, members[0] ?? file.sf)}`);
      const indent = indentAt(text, open);
      return [{ start: open + 1, end: close, text: ` ${adds.map((a) => `${keyText(a.key, quote)}: ${spellValue(a.value, indent, quote)}`).join(', ')} `, component }];
    }
    const kept = members.map((_, i) => i).filter((i) => !deleted.has(i));
    if (kept.length === 0) refuse('layout', 'every key of this literal is replaced; rewrite it by hand');
    const anchor = members[kept[kept.length - 1]!]!;
    const s = anchor.getStart(file.sf);
    let p = anchor.end;
    while (text[p] === ' ' || text[p] === '\t') p++;
    const hasComma = text[p] === ',';
    if (!text.slice(open, close).includes('\n')) {
      const entries = adds.map((a) => `${keyText(a.key, quote)}: ${spellValue(a.value, indentAt(text, s), quote)}`);
      // A trailing comma is kept trailing; a separator before deleted members
      // is theirs, and goes with them.
      const trailing = anchor === members[members.length - 1] && hasComma;
      return trailing
        ? [{ start: p + 1, end: p + 1, text: ` ${entries.map((x) => `${x},`).join(' ')}`, component }]
        : [{ start: anchor.end, end: anchor.end, text: `, ${entries.join(', ')}`, component }];
    }
    const range = ownLines(text, s, anchor.end);
    if (!range) refuse('layout', `the member at ${this.graph.at(file, anchor)} shares its line with other code`);
    const indent = indentAt(text, s);
    const entries = adds.map((a) => `${keyText(a.key, quote)}: ${spellValue(a.value, indent, quote)}`);
    const out: TextEdit[] = [];
    if (!hasComma) out.push({ start: anchor.end, end: anchor.end, text: ',', component });
    const at = lineBreakAfter(range, text);
    out.push({
      start: at,
      end: at,
      text: entries.map((x, i) => `\n${indent}${x}${hasComma || i < entries.length - 1 ? ',' : ''}`).join(''),
      component,
    });
    return out;
  }
}

// ── the plan ────────────────────────────────────────────────────────────────

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  // Last first, so every offset still points into the original text; at one
  // offset a removal goes before the insertion that lands where it starts.
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * The first edit that collides with the one before it — a range that starts
 * inside another, or two insertions at one offset (whose order would be a
 * guess). An insertion where a removal starts, or where a replacement ends, is
 * not a collision.
 */
function overlapping(edits: readonly TextEdit[]): TextEdit | undefined {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    const twoInsertions = prev.start === prev.end && cur.start === cur.end && cur.start === prev.start;
    if (cur.start < prev.end || twoInsertions) return cur;
  }
  return undefined;
}

/**
 * The entry a {@link RangeRewrite} stands as among the chain's: its label sits
 * where a conversion id would, so a re-check names it the way it names theirs.
 */
function rangeApplication(range: RangeRewrite): MigrationApplication {
  return {
    toMajor: range.major,
    conversionId: 'declared protocol range',
    surface: range.path,
    from: range.from,
    to: range.to,
    path: range.path,
  };
}

/**
 * `root` with `value` at `path`, copying only the containers on the way. A path
 * that leads nowhere changes nothing, so the edit is then attributed to nothing.
 */
function withValueAt(root: unknown, path: readonly Segment[], value: unknown): Record<string, unknown> {
  const set = (node: unknown, depth: number): unknown => {
    if (depth === path.length) return value;
    const seg = path[depth]!;
    if (Array.isArray(node) && typeof seg === 'number' && seg < node.length) {
      const copy = [...node];
      copy[seg] = set(node[seg], depth + 1);
      return copy;
    }
    if (isPlainObject(node) && typeof seg === 'string' && node[seg] !== undefined) {
      return { ...node, [seg]: set(node[seg], depth + 1) };
    }
    return node;
  };
  return set(root, 0) as Record<string, unknown>;
}

/**
 * Plan `os migrate meta --write`: which of the chain's mechanical changes can be
 * written into which authored files, the bytes each file would hold, and the
 * reason for every change left to the author. Reads the sources; writes nothing.
 * A {@link RangeRewrite} rides the same plan as one more entry (#22219).
 */
export async function planAuthoredSourceWrite(input: AuthoredSourceWriteInput): Promise<AuthoredSourceWritePlan> {
  const { ts } = await import('ts-morph');
  const configPath = realpathSafe(input.configPath);
  const projectRoot = dirname(configPath);
  const graph = new SourceGraph(ts, projectRoot);
  graph.crawl(configPath);
  const locator = new Locator(ts, graph, input.config, input.namedExports, configPath);
  const planner = new Planner(ts, graph, locator);

  // The declared range joins as the last entry, and its new value joins the
  // migrated stack, so every phase below plans it as it plans a conversion's.
  const rangeIndex = input.range ? input.applied.length : -1;
  const applied: readonly MigrationApplication[] = input.range
    ? [...input.applied, rangeApplication(input.range)]
    : input.applied;
  const migrated = input.range
    ? withValueAt(input.migrated, parsePath(input.range.path), input.range.to)
    : input.migrated;

  // Attribution: each change to the entries that explain it.
  const changes = diffStacks(input.normalized, migrated);
  const appliedPaths = applied.map((a) => parsePath(a.path));
  const entriesOf = changes.map((c) => explainingEntries(appliedPaths, c.path));

  // Components: entries that share a change are written together or not at all.
  const parent = applied.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const entries of entriesOf) for (const e of entries.slice(1)) parent[find(e)] = find(entries[0]!);
  const componentOf = (entry: number) => find(entry);

  const unexplained: string[] = [];
  const changesOf = new Map<number, number[]>(); // component → change indices
  changes.forEach((c, ci) => {
    const entries = entriesOf[ci]!;
    if (entries.length === 0) { unexplained.push(formatPath(c.path)); return; }
    const comp = componentOf(entries[0]!);
    changesOf.set(comp, [...(changesOf.get(comp) ?? []), ci]);
  });

  // Phase 1 — resolve every change; a refusal refuses its component.
  const refusedChange = new Map<number, CodemodRefusal>(); // change index → refusal
  const refusedComponent = new Map<number, CodemodRefusal>();
  const resolved = new Map<number, Resolved>();
  for (const [comp, cis] of changesOf) {
    for (const ci of cis) {
      try {
        resolved.set(ci, planner.resolve(changes[ci]!, comp));
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        refusedChange.set(ci, error.refusal);
        if (!refusedComponent.has(comp)) refusedComponent.set(comp, error.refusal);
      }
    }
  }

  // Phases 2–4 — build the edits of the components still standing; a layout
  // refusal, an overlap or an edit that would not parse refuses its
  // component(s) and the build starts over without them.
  let rewrites: FileRewrite[] = [];
  for (;;) {
    const byContainer = new Map<string, Resolved[]>();
    for (const [ci, r] of resolved) {
      if (refusedComponent.has(r.component)) continue;
      const k = `${r.container.node.file.path}#${r.container.node.node.getStart(r.container.node.file.sf)}`;
      byContainer.set(k, [...(byContainer.get(k) ?? []), r]);
      void ci;
    }
    let retry = false;
    const editsByFile = new Map<string, { file: SourceFileRec; edits: TextEdit[] }>();
    for (const items of byContainer.values()) {
      try {
        const file = items[0]!.container.node.file;
        const slot = editsByFile.get(file.path) ?? { file, edits: [] };
        slot.edits.push(...planner.edits(items));
        editsByFile.set(file.path, slot);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        for (const r of items) {
          if (!refusedComponent.has(r.component)) refusedComponent.set(r.component, error.refusal);
          for (const [ci, x] of resolved) if (x === r) refusedChange.set(ci, error.refusal);
        }
        retry = true;
      }
    }
    if (retry) continue;

    const next: FileRewrite[] = [];
    for (const { file, edits } of editsByFile.values()) {
      if (edits.length === 0) continue;
      const clash = overlapping(edits);
      if (clash) {
        refusedComponent.set(clash.component, {
          kind: 'layout',
          reason: `its edit in ${graph.rel(file)} overlaps another site's edit at line ${file.sf.getLineAndCharacterOfPosition(clash.start).line + 1}`,
        });
        retry = true;
        break;
      }
      const after = applyEdits(file.text, edits);
      if (syntacticDiagnostics(ts, after).length > syntacticDiagnostics(ts, file.text).length) {
        for (const e of edits) {
          if (!refusedComponent.has(e.component)) {
            refusedComponent.set(e.component, { kind: 'layout', reason: `the edited ${graph.rel(file)} would not parse` });
          }
        }
        retry = true;
        break;
      }
      next.push({ path: file.path, file: graph.rel(file), before: file.text, after });
    }
    if (retry) continue;
    rewrites = next.sort((a, b) => a.file.localeCompare(b.file));
    break;
  }

  /** Where entry `i` was written, or why it was not. */
  const entrySite = (i: number): { file: string; line: number } | { refusal: CodemodRefusal } => {
    const comp = componentOf(i);
    const mine = (changesOf.get(comp) ?? []).filter((ci) => entriesOf[ci]!.includes(i));
    if (mine.length === 0) {
      return { refusal: { kind: 'unattributed', reason: 'no edit in the migrated stack could be tied to this site' } };
    }
    const compRefusal = refusedComponent.get(comp);
    if (compRefusal) {
      const own = mine.map((ci) => refusedChange.get(ci)).find((r) => r !== undefined);
      return {
        refusal: own ?? { kind: 'entangled', reason: `a conversion's edits are written whole or not at all, and a linked site was refused: ${compRefusal.reason}` },
      };
    }
    // The line of a member that was there (a rename's old key, a removed or
    // rewritten value) over the line of the literal a new key went into.
    const at = mine.find((ci) => changes[ci]!.op !== 'add') ?? mine[0]!;
    const r = resolved.get(at)!;
    return { file: graph.rel(r.container.node.file), line: r.line };
  };

  // Report by applied entry, in chain order; the declared range apart.
  const written: WrittenSite[] = [];
  const manual: ManualSite[] = [];
  let range: RangeOutcome | undefined;
  for (const [i, application] of applied.entries()) {
    const site = entrySite(i);
    if (i === rangeIndex && input.range) {
      range = 'refusal' in site
        ? { rewrite: input.range, status: 'manual', refusal: site.refusal }
        : { rewrite: input.range, status: 'written', file: site.file, line: site.line };
    } else if ('refusal' in site) {
      manual.push({ application, refusal: site.refusal });
    } else {
      written.push({ application, file: site.file, line: site.line });
    }
  }

  return { projectRoot, rewrites, written, manual, unexplained, ...(range ? { range } : {}) };
}

/**
 * Write a plan's files. Refuses — before writing any of them — when a file no
 * longer holds the bytes the plan was made from.
 */
export function writeAuthoredSources(plan: AuthoredSourceWritePlan): void {
  for (const r of plan.rewrites) {
    if (readFileSync(r.path, 'utf8') !== r.before) {
      throw new Error(`${r.file} changed on disk while the migration was planned; nothing was written. Re-run the command.`);
    }
  }
  for (const r of plan.rewrites) writeFileSync(r.path, r.after, 'utf8');
}

/** Put every file a plan wrote back to the bytes it held before. */
export function restoreAuthoredSources(plan: AuthoredSourceWritePlan): void {
  for (const r of plan.rewrites) writeFileSync(r.path, r.before, 'utf8');
}

/** What a re-run of the chain over the written sources says about the write. */
export interface WriteVerification {
  ok: boolean;
  /** Mechanical changes the re-run still applies that the plan reported written. */
  stillApplied: string[];
  /** Changes the plan left manual that the re-run no longer applies. */
  vanished: string[];
}

/**
 * Hold a write to its own report: re-run over the written sources, the chain
 * must apply exactly the changes the plan left manual — every written site
 * gone, every manual one still there. The declared range is held the same
 * way (#22219): `rerunRange` is the range edit the written sources still owe,
 * which must be absent when the plan wrote it and present when it left it.
 */
export function verifyAuthoredSourceWrite(
  plan: AuthoredSourceWritePlan,
  rerun: readonly MigrationApplication[],
  rerunRange?: RangeRewrite,
): WriteVerification {
  const key = (a: MigrationApplication) => `${a.path} (${a.conversionId})`;
  const expected = new Map<string, number>();
  const leave = (a: MigrationApplication) => expected.set(key(a), (expected.get(key(a)) ?? 0) + 1);
  for (const m of plan.manual) leave(m.application);
  if (plan.range?.status === 'manual') leave(rangeApplication(plan.range.rewrite));
  const owed = rerunRange ? [...rerun, rangeApplication(rerunRange)] : rerun;
  const stillApplied: string[] = [];
  for (const a of owed) {
    const k = key(a);
    const n = expected.get(k) ?? 0;
    if (n > 0) expected.set(k, n - 1);
    else stillApplied.push(k);
  }
  const vanished = [...expected].flatMap(([k, n]) => Array.from({ length: n }, () => k));
  return { ok: stillApplied.length === 0 && vanished.length === 0, stillApplied, vanished };
}
