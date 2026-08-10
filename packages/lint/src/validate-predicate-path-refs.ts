// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Publish-time resolution of predicate PATH references** (#7010, the
 * producer-side companion to #6936).
 *
 * #6936 was ruled Option C: the objectui evaluator keeps failing OPEN, with a
 * warning. That settles the RENDERER's posture and deliberately leaves the
 * producer side open — the filing's own words for what should happen instead:
 * 「谓词表达式应在发布期被校验(引用的路径必须存在于对应 schema),而不是让渲染
 * 器在运行期猜」. This file is that check.
 *
 * ## What was already covered, and the hole between the two
 *
 * `validate-visibility-predicates.ts` (ADR-0089 D3b) judges three things about a
 * conditional-visibility predicate, and **none of them looks at the target
 * schema**:
 *
 *  - `visibility-predicate-syntax` (#6253) — does it parse at all;
 *  - `visibility-bare-identifier` (#6128) — is a reference rooted at *anything*;
 *  - `visibility-root-mislayered` (ADR-0089 D3) — is that root the right one for
 *    the layer (`record.` on a runtime surface, `data.` on a metadata form).
 *
 * A predicate can pass all three and still name a path that does not exist:
 * `data.tpye == 'formula'` is valid CEL, is rooted, and is rooted on the right
 * root — and resolves to nothing. The evaluator then faults, visibility falls
 * back to `true`, and the element renders unconditionally, pixel-identical to
 * one carrying no predicate at all. That is the #5149 fail-open family, arriving
 * through the one door the family's own gates leave open.
 *
 * The gap is not hypothetical on this exact surface. #6254 measured 16
 * predicates in `packages/spec/src/data/object.form.ts` written as BARE
 * identifiers (`type == 'formula'`) where the sibling `field.form.ts` wrote
 * `data.type` — and stated, in as many words, why the #6128 gate structurally
 * could not catch them: `type` is an identifier **CEL itself declares** (it
 * denotes a type value), so the strict-environment checker reports a type
 * overload rather than an unknown variable, and `visibility-bare-identifier`
 * skips it by design (widening it to read overload messages would kill the
 * legitimate `type(record.x) == string`).
 *
 * This rule does not have that blind spot, because it never asks CEL what
 * resolves. It asks the **target schema** — a closed, enumerable key set — and
 * CEL's own type-name vocabulary has no bearing on whether `type` is a key of
 * `FieldSchema`. Measured: restoring #6254's pre-fix `object.form.ts` makes this
 * rule report exactly those 16 sites (see the reverse-verification test).
 *
 * ## Scope: the `data.*` layer only, and why that is a decision
 *
 * The target-schema oracle has to be CLOSED for an `error`-level gate — a key
 * set the rule can enumerate, where "absent" really means "cannot resolve". That
 * is true for exactly one of the two binding layers ADR-0089 D3 names:
 *
 *  - **metadata-editing forms** (`data`, a `defineForm` whose data source is
 *    `{ provider: 'schema', schemaId }` — `view.zod.ts:151-161`). The row under
 *    edit is an instance of a metadata type, and its shape is a Zod schema this
 *    package can read key by key through the canonical
 *    `getMetadataTypeSchema` registry. Closed. **This rule's scope.**
 *  - **runtime record surfaces** (`record`, a form bound to an ObjectQL object).
 *    Not closed today, and not closable by this rule: `record.<x>` legitimately
 *    reaches related records through lookup traversal, system columns the
 *    authored `fields` map never lists, and formula/rollup outputs. An
 *    `error`-level gate over an open set is a false-build-error generator, which
 *    is the one direction a gate may not fail in. Left to the sibling rules,
 *    and recorded as an open question on #7010 rather than guessed at here.
 *
 * ## Two limbs, one question
 *
 * Both limbs ask "does this identifier name something the target schema
 * declares?" — they differ only in whether the author supplied the root:
 *
 *  - `predicate-path-unresolved` — a `data.`-rooted path whose first
 *    unresolvable segment is not declared by the schema at that point.
 *    `data.tpye`, `data.enable.trahs`.
 *  - `predicate-path-unrooted` — a BARE identifier that IS a declared key of the
 *    scope. This is #6254's shape verbatim: the author wrote the right name and
 *    dropped the root. Deliberately narrower than "any bare identifier" (that is
 *    `visibility-bare-identifier`'s question, and this rule must not answer it a
 *    second time): the schema-key membership is what makes the verdict
 *    unambiguous, and it is precisely the evidence CEL's declaration table
 *    cannot supply.
 *
 * ## Where the walk stops, deliberately
 *
 * Every one of these is a MISSED CATCH, never a false build error — the only
 * safe direction for a gate:
 *
 *  - **A predicate the canonical front end will not parse.** No AST, no paths,
 *    no verdict — that source is `visibility-predicate-syntax`'s (#6253), and
 *    one broken predicate must produce one finding, not two.
 *  - **A scope that is not key-bearing.** `z.record(z.string(), z.unknown())`,
 *    `z.unknown()`, `z.any()`, an array reached by `.` — the schema declares no
 *    key set, so "absent" carries no information. The walk stops at that segment
 *    and everything below it is unjudged.
 *  - **A `record` map's KEY segment.** `z.record(z.string(), FieldSchema)`
 *    accepts any key by construction, so `data.fields.acme` consumes `acme`
 *    unconditionally and resolves the REST against `FieldSchema`. Treating the
 *    map key as a declared name would report every real map entry.
 *  - **Comprehension-macro variables.** `data.tags.all(t, t != '')` binds `t`
 *    inside the macro body; a bare `t` there is not a dropped root, whatever the
 *    schema happens to declare.
 *  - **Index access** (`data.x['y']`, `data.list[0]`). The path chain is built
 *    from `.`-member access only; an `[]` node ends the chain and the rest is
 *    unjudged.
 *  - **A `schemaId` that resolves to no schema.** A stack may name a schema this
 *    package cannot see (a custom one, or a type served only at runtime). No
 *    oracle, no verdict.
 *
 * ## Repeater rows rebind `data`, and the rule follows (#6254)
 *
 * A sub-field of a `type: 'record'` / `repeater` / `composite` entry is rendered
 * with its own activation: objectui's metadata SchemaForm evaluates it as
 * `evaluatePredicate(spec.visibleOn, { data: row })`. So inside `object.form.ts`'s
 * `fields` repeater, `data.type` means *this row's* `type` — `FieldSchema.type`,
 * not `ObjectSchema.type` (which does not exist). `view.zod.ts:1647-1657` states
 * both halves: the root is still spelled `data` at every depth, and the object it
 * binds is the ROW. This rule descends with the same rebinding, which is what
 * makes the shipped corpus read 0 instead of 16 false positives.
 */

import { parseCelToAst } from '@objectstack/formula';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { findClosestMatches, formatSuggestion } from '@objectstack/spec';

import { collectionEntries } from './collection-entries.js';
import { formViewSites } from './view-walk.js';

export const PREDICATE_PATH_UNRESOLVED = 'predicate-path-unresolved';
export const PREDICATE_PATH_UNROOTED = 'predicate-path-unrooted';

/** Both rules GATE — see the module note for why each is safe at `error`. */
export type PredicatePathSeverity = 'error' | 'warning';

export interface PredicatePathFinding {
  severity: PredicatePathSeverity;
  /** Diagnostic rule id — `predicate-path-unresolved` / `predicate-path-unrooted`. */
  rule: string;
  /** Human-readable location, e.g. `view "object" · schema form "object"`. */
  where: string;
  /** Config path, e.g. `views[0].sections[1].fields[0].fields[21].visibleWhen`. */
  path: string;
  /** What is wrong — always names the unresolvable path. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/** Options for {@link validatePredicatePathRefs}. */
export interface PredicatePathOptions {
  /**
   * Schema oracle: `schemaId` → the Zod schema of the row under edit. Defaults
   * to the canonical `getMetadataTypeSchema` registry
   * (`packages/spec/src/kernel/metadata-type-schemas.ts`), which is the same
   * entry `saveMetaItem` validates against — so this rule can never disagree
   * with the parse that judges the saved row. Injectable so a test can pin the
   * traversal against a small schema, and so a future caller holding a richer
   * registry (runtime `/meta/types`, a package-declared type) can supply it
   * without this file growing a second lookup path.
   */
  resolveSchema?: (schemaId: string) => unknown;
}

type AnyRec = Record<string, unknown>;

/**
 * The predicate keys a form field / section can carry. Canonical first
 * (ADR-0089): `visibleOn` is the deprecated view-side alias, folded into
 * `visibleWhen` by the ADR-0087 D2 conversion one layer above the `normalized`
 * tier — so on the three CLI commands the alias limb is already unreachable. It
 * stays for the reason `validate-visibility-predicates.ts` states about its own
 * limbs: this is a PUBLISHED export, and a caller handing it a raw authored
 * object must have the alias-spelled predicate judged rather than skipped.
 * Canonical-first ordering means the limb can only ever add coverage.
 */
const PREDICATE_KEYS = ['visibleWhen', 'visibleOn'] as const;

/** The binding root this rule resolves. Metadata-editing forms only — see the module note. */
const ROOT = 'data';

/**
 * CEL comprehension macros: the receiver-call forms that BIND their first
 * argument as a loop variable. A bare identifier that is one of those is not a
 * dropped root, so it is declared before the unrooted limb runs.
 */
const COMPREHENSION_MACROS = new Set(['all', 'exists', 'exists_one', 'map', 'filter']);

// ── Zod introspection ───────────────────────────────────────────────
//
// Reads `.def` directly rather than importing zod's internals, and tolerates
// the `lazySchema` proxy. This is the same peeling
// `packages/spec/src/kernel/metadata-authoring-lint.ts` and the metadata-form ↔
// Zod reconciliation gate already do — including the `pipe` fork, which is
// load-bearing rather than defensive: `a.transform(fn)` authors against the IN
// side while `z.preprocess(fn, schema)` puts the transform on IN and the
// authorable schema on OUT, and taking `def.in` unconditionally makes the walker
// return the transform and go silent on the type (#4488 measured it on
// `translation`, #5074 on `view`). A gate that stops covering a type is worse
// than one that fails.

type ZodNode = { def?: { type?: string;[k: string]: unknown }; _def?: { type?: string;[k: string]: unknown }; shape?: AnyRec };

/**
 * The node's `def`, or `undefined` when it is not a schema node.
 *
 * `typeof s === 'function'` is NOT defensive padding — several of this repo's
 * canonical schemas arrive as the `lazySchema` proxy, which is CALLABLE, and a
 * plain `typeof s === 'object'` guard silently answers "not a schema" for every
 * one of them. Measured while building this rule: with the object-only guard the
 * whole `METADATA_FORM_REGISTRY` corpus resolved to a key set of size 0, so the
 * gate reported clean over 46 predicates and over a deliberately corrupted copy
 * of the same corpus alike. A green gate that reads nothing is the failure mode
 * the corpus tests exist to catch, and this is the line it turned on.
 */
function defOf(schema: unknown): AnyRec | undefined {
  if (!schema || (typeof schema !== 'object' && typeof schema !== 'function')) return undefined;
  const s = schema as ZodNode;
  return (s.def ?? s._def) as AnyRec | undefined;
}

/**
 * Peel WRAPPER nodes only — optionality, defaults, laziness, pipes. Container
 * nodes (`array` / `record`) are deliberately NOT peeled here: whether a
 * container is transparent depends on the question being asked, and the two
 * questions have opposite answers (see {@link rowScopeOf} vs {@link stepInto}).
 */
function peel(schema: unknown, depth = 0): unknown {
  if (!schema || depth > 25) return schema;
  const d = defOf(schema);
  if (!d) return schema;
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return peel(d.innerType, depth + 1);
    case 'lazy':
      return peel((d.getter as () => unknown)(), depth + 1);
    case 'pipe': {
      const inner = peel(d.in, depth + 1);
      return defOf(inner)?.type === 'transform' ? peel(d.out, depth + 1) : inner;
    }
    default:
      return schema;
  }
}

function optionsOf(d: AnyRec | undefined): unknown[] {
  return Array.isArray(d?.options) ? (d.options as unknown[]) : [];
}

/**
 * Every key the node declares, or `null` when it is not key-bearing.
 *
 * A union contributes the UNION of its members' keys: an author may legally
 * write any member's shape, so a key declared by one member is declared. That is
 * the same safe direction the metadata-form reconciliation gate takes, and it
 * matters here — `view`'s schema is a three-way union (#3095).
 */
function keysOf(schema: unknown, depth = 0): string[] | null {
  if (depth > 25) return null;
  const u = peel(schema);
  const d = defOf(u);
  if (d?.type === 'object') return Object.keys((d.shape ?? (u as ZodNode).shape ?? {}) as AnyRec);
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    const all = new Set<string>();
    let keyBearing = false;
    for (const option of optionsOf(d)) {
      const k = keysOf(option, depth + 1);
      if (!k) continue;
      keyBearing = true;
      for (const key of k) all.add(key);
    }
    return keyBearing ? [...all] : null;
  }
  if (d?.type === 'intersection') {
    const left = keysOf(d.left, depth + 1);
    const right = keysOf(d.right, depth + 1);
    if (!left && !right) return null;
    return [...new Set([...(left ?? []), ...(right ?? [])])];
  }
  return null;
}

/** The sub-schema stored under `key`, looking through union / intersection members. */
function propertyOf(schema: unknown, key: string, depth = 0): unknown {
  if (depth > 25) return undefined;
  const u = peel(schema);
  const d = defOf(u);
  if (d?.type === 'object') return ((d.shape ?? (u as ZodNode).shape ?? {}) as AnyRec)[key];
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    for (const option of optionsOf(d)) {
      const found = propertyOf(option, key, depth + 1);
      if (found !== undefined) return found;
    }
  }
  if (d?.type === 'intersection') {
    return propertyOf(d.left, key, depth + 1) ?? propertyOf(d.right, key, depth + 1);
  }
  return undefined;
}

/**
 * The scope a REPEATER ROW binds — `data` inside a `type: 'record'` /
 * `repeater` / `composite` sub-field list (#6254). Here the containers ARE
 * transparent: the form's `fields` entry declares the collection, and each row
 * is one element of it.
 */
function rowScopeOf(scope: unknown, key: string): unknown {
  const prop = propertyOf(scope, key);
  if (prop === undefined) return undefined;
  let node = peel(prop);
  for (let i = 0; i < 25; i++) {
    const d = defOf(node);
    if (d?.type === 'array') node = peel(d.element);
    else if (d?.type === 'record') node = peel(d.valueType);
    else return node;
  }
  return node;
}

/** The outcome of resolving ONE `.`-segment against a scope. */
type Step =
  /** The segment is declared; `next` is the scope for the segment after it. */
  | { kind: 'declared'; next: unknown }
  /** The scope declares a key set and this segment is not in it. */
  | { kind: 'undeclared'; declared: string[] }
  /** The scope declares no key set — nothing below can be judged. */
  | { kind: 'opaque' };

function stepInto(scope: unknown, segment: string): Step {
  const u = peel(scope);
  const d = defOf(u);
  // A record map accepts ANY key by construction (`z.record(z.string(), X)`),
  // so the segment is a map KEY, not a declared name. Consume it and judge the
  // rest against the value schema.
  if (d?.type === 'record') return { kind: 'declared', next: d.valueType };
  const declared = keysOf(u);
  if (declared === null) return { kind: 'opaque' };
  if (!declared.includes(segment)) return { kind: 'undeclared', declared };
  return { kind: 'declared', next: propertyOf(u, segment) };
}

// ── CEL AST reading ─────────────────────────────────────────────────

type AstNode = { op?: string; args?: unknown };

function isNode(v: unknown): v is AstNode {
  return !!v && typeof v === 'object' && typeof (v as AstNode).op === 'string';
}

/**
 * The dotted segment chain a `.`-access node spells, or `null` when its head is
 * not a plain identifier (an index access, a call result, a literal). Built from
 * `.` member access only — `args[1]` of a `.` node is the member NAME string,
 * `args[0]` the receiver.
 */
function memberChain(node: unknown): string[] | null {
  if (!isNode(node)) return null;
  if (node.op === 'id' && typeof node.args === 'string') return [node.args];
  if (node.op === '.' && Array.isArray(node.args) && typeof node.args[1] === 'string') {
    const head = memberChain(node.args[0]);
    return head ? [...head, node.args[1]] : null;
  }
  return null;
}

/** Every `<ROOT>.<a>.<b>…` chain in the AST, as its segments below the root. */
function rootedPaths(node: unknown, out: string[][]): void {
  if (Array.isArray(node)) {
    for (const child of node) rootedPaths(child, out);
    return;
  }
  if (!isNode(node)) return;
  if (node.op === '.') {
    const chain = memberChain(node);
    if (chain && chain[0] === ROOT && chain.length > 1) {
      out.push(chain.slice(1));
      return;
    }
  }
  rootedPaths(node.args, out);
}

/**
 * Split the AST's identifiers into the ones used as a NAMESPACE (`a.b`, `a?.b`,
 * `a['b']`, `a.exists(…)`) or BOUND by a comprehension macro, and the plain
 * value references. Only the latter can be a dropped root.
 */
function classifyIdentifiers(node: unknown, values: Set<string>, excluded: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) classifyIdentifiers(child, values, excluded);
    return;
  }
  if (!isNode(node)) return;
  const args = node.args;
  if (Array.isArray(args)) {
    // `.` / `.?` / `[]` hold the receiver first; `rcall` holds the method NAME
    // first and the receiver second.
    const receiver = node.op === 'rcall' ? args[1] : args[0];
    if (
      (node.op === '.' || node.op === '.?' || node.op === '[]' || node.op === 'rcall')
      && isNode(receiver) && receiver.op === 'id' && typeof receiver.args === 'string'
    ) {
      excluded.add(receiver.args);
    }
    // A comprehension binds its loop variable: `x.all(t, …)` parses as
    // `rcall(['all', x, [id(t), body]])`.
    if (node.op === 'rcall' && typeof args[0] === 'string' && COMPREHENSION_MACROS.has(args[0])) {
      const macroArgs = args[2];
      if (Array.isArray(macroArgs) && macroArgs.length >= 2) {
        const bound = macroArgs[0];
        if (isNode(bound) && bound.op === 'id' && typeof bound.args === 'string') {
          excluded.add(bound.args);
        }
      }
    }
  }
  if (node.op === 'id' && typeof node.args === 'string') {
    values.add(node.args);
    return;
  }
  classifyIdentifiers(args, values, excluded);
}

// ── The walk ────────────────────────────────────────────────────────

/** Extract the CEL source from a predicate value (string, or `{ source }` envelope). */
function predicateSource(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as AnyRec).source === 'string') {
    return (v as AnyRec).source as string;
  }
  return undefined;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The `schemaId` a form view resolves its row shape from, or `undefined` when
 * the view is not schema-bound. Read off `ViewDataSourceSchema`'s `schema`
 * member (`view.zod.ts:151-161`) — the shape `defineForm` writes.
 */
function schemaIdOf(view: AnyRec): string | undefined {
  const data = view.data;
  if (!isRec(data)) return undefined;
  if (data.provider !== 'schema') return undefined;
  return typeof data.schemaId === 'string' ? data.schemaId : undefined;
}

function checkPredicate(
  source: string,
  scope: unknown,
  where: string,
  path: string,
  findings: PredicatePathFinding[],
): void {
  const ast = parseCelToAst(source);
  // Not parseable through the canonical front end — `visibility-predicate-syntax`
  // (#6253) owns that verdict; one broken predicate, one finding.
  if (!ast) return;

  // ── `predicate-path-unresolved` ──
  const paths: string[][] = [];
  rootedPaths(ast, paths);
  for (const segments of paths) {
    let cursor: unknown = scope;
    const walked: string[] = [];
    for (const segment of segments) {
      const step = stepInto(cursor, segment);
      if (step.kind === 'opaque') break;
      if (step.kind === 'undeclared') {
        const full = [ROOT, ...walked, segment].join('.');
        const container = walked.length ? `${ROOT}.${walked.join('.')}` : ROOT;
        findings.push({
          severity: 'error',
          rule: PREDICATE_PATH_UNRESOLVED,
          where,
          path,
          message:
            `predicate references \`${full}\`, which the target schema does not declare — `
            + `\`${segment}\` is not a key of \`${container}\`. The reference resolves to nothing, `
            + `so the predicate can never evaluate and the console falls OPEN: the element renders `
            + `unconditionally and looks exactly like one carrying no predicate at all (#5149).`,
          hint:
            `${formatSuggestion(findClosestMatches(segment, step.declared))
            || `\`${container}\` declares: ${step.declared.slice(0, 12).sort().join(', ')}`}`
            + ` Every reference must resolve against the schema the form edits.`,
        });
        break;
      }
      walked.push(segment);
      cursor = step.next;
    }
  }

  // ── `predicate-path-unrooted` ──
  const declaredHere = keysOf(scope);
  if (!declaredHere) return;
  const values = new Set<string>();
  const excluded = new Set<string>();
  classifyIdentifiers(ast, values, excluded);
  for (const id of values) {
    if (excluded.has(id) || !declaredHere.includes(id)) continue;
    findings.push({
      severity: 'error',
      rule: PREDICATE_PATH_UNROOTED,
      where,
      path,
      message:
        `predicate references \`${id}\` as a bare identifier, but \`${id}\` is a key of the schema `
        + `this form edits — the binding root was dropped. Values are bound under \`${ROOT}\` and are `
        + `never flattened to top level, so \`${id}\` resolves to nothing, the predicate can never `
        + `evaluate and the console falls OPEN: the element renders unconditionally and looks exactly `
        + `like one carrying no predicate at all (#5149, #6254).`,
      hint:
        `Write \`${ROOT}.${id}\` instead of \`${id}\`. A metadata-editing form binds the row under `
        + `edit as \`${ROOT}\` at every depth — inside a repeater \`${ROOT}\` is the ROW, but it is `
        + `still spelled \`${ROOT}\` (there is no implicit row scope).`,
    });
  }
}

function walkFields(
  entries: unknown,
  scope: unknown,
  where: string,
  base: string,
  findings: PredicatePathFinding[],
  depth: number,
): void {
  if (!Array.isArray(entries) || depth > 12) return;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isRec(entry)) continue;
    const path = `${base}[${i}]`;
    for (const key of PREDICATE_KEYS) {
      const source = predicateSource(entry[key]);
      if (source !== undefined && source.trim()) {
        checkPredicate(source, scope, where, `${path}.${key}`, findings);
        break; // canonical-first: `visibleWhen` wins when both are present
      }
    }
    // A composite / repeater / record sub-field list REBINDS `data` to the row.
    // When the row schema cannot be resolved the sub-tree is unjudged rather
    // than judged against the parent scope, which would report every sub-field.
    if (Array.isArray(entry.fields) && entry.fields.length > 0 && typeof entry.field === 'string') {
      const row = scope === undefined ? undefined : rowScopeOf(scope, entry.field);
      walkFields(entry.fields, row, where, `${path}.fields`, findings, depth + 1);
    }
  }
}

/**
 * Refuse a metadata-form predicate that names a path the target schema does not
 * declare (#7010).
 *
 * Walks `views[]` through the shared {@link formViewSites} ladder — the entry
 * itself (the bare `defineForm` shape every `*.form.ts` uses), the container's
 * default `form`, and each `formViews.<key>` — and judges only the sites whose
 * data source is `{ provider: 'schema', schemaId }`, resolving `schemaId`
 * through `opts.resolveSchema` (the canonical metadata-type registry by
 * default). A site bound to an ObjectQL object, or naming a `schemaId` no schema
 * resolves, is skipped: see the module note for why the `record.*` layer is out
 * of scope rather than merely unimplemented.
 *
 * Both rules emit `error` and the caller is expected to fail the build on them.
 * The corpus measurement behind that severity is on the PR for #7010: over the
 * shipped `METADATA_FORM_REGISTRY` (17 forms, 46 predicates) the count is **0**
 * for both, and 16 for `predicate-path-unrooted` once #6254's pre-fix
 * `object.form.ts` is restored.
 *
 * Returns findings (empty = clean).
 */
export function validatePredicatePathRefs(
  stack: AnyRec,
  opts: PredicatePathOptions = {},
): PredicatePathFinding[] {
  const resolveSchema = opts.resolveSchema
    ?? ((schemaId: string): unknown => getMetadataTypeSchema(schemaId));
  const findings: PredicatePathFinding[] = [];

  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    const viewName = typeof view.name === 'string' ? view.name
      : typeof view.object === 'string' ? view.object
        : viewPath;

    for (const site of formViewSites(view, viewPath)) {
      const schemaId = schemaIdOf(site.view);
      if (!schemaId) continue;
      let root: unknown;
      try {
        root = resolveSchema(schemaId);
      } catch {
        // A resolver that throws on an unknown id must not take the build down
        // with it — no oracle, no verdict, same as an id that resolves to
        // `undefined`.
        continue;
      }
      if (!root) continue;

      const where = site.surface
        ? `view "${viewName}" · ${site.surface} (schema "${schemaId}")`
        : `view "${viewName}" (schema "${schemaId}")`;

      for (const bucket of ['sections', 'groups'] as const) {
        const sections = Array.isArray(site.view[bucket]) ? (site.view[bucket] as unknown[]) : [];
        for (let s = 0; s < sections.length; s++) {
          const section = sections[s];
          if (!isRec(section)) continue;
          const sectionPath = `${site.path}.${bucket}[${s}]`;
          for (const key of PREDICATE_KEYS) {
            const source = predicateSource(section[key]);
            if (source !== undefined && source.trim()) {
              checkPredicate(source, root, where, `${sectionPath}.${key}`, findings);
              break;
            }
          }
          walkFields(section.fields, root, where, `${sectionPath}.fields`, findings, 0);
        }
      }
    }
  }

  return findings;
}
