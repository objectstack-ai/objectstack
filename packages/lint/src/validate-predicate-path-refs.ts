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
 *    oracle, no verdict — for the two RESOLUTION limbs. The site is still
 *    walked so the oracle-free right-hand limb runs (#7696); before that it was
 *    skipped wholesale, which is the shape a shared walk quietly imposes on a
 *    rule that never needed the thing being shared.
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
 *
 * ## The right-hand side is a different question entirely (#7659)
 *
 * Both rules above ask whether a path RESOLVES. `data.a == data.b` answers yes
 * twice and is still broken, because the right-hand **position** does not
 * evaluate paths at all. objectui's metadata-admin evaluator
 * (`packages/app-shell/src/views/metadata-admin/predicate.ts`) resolves the LEFT
 * side through `resolveValue` and hands the RIGHT side to `parseLiteral`, whose
 * tail returns anything it does not recognise as a literal VERBATIM — so
 * `data.a == data.b` compares `data.a`'s value against the seven-character
 * string `"data.b"`. It is FALSE however equal the two sides are, and
 * `data.a != data.b` is correspondingly TRUE. The declared subset says so
 * (`path == 'literal'`, never `path == path`), but until objectui#4049 the
 * boundary was enforced by silence, and #7010's resolution check cannot reach
 * it: both paths resolve, so there is nothing for it to report.
 *
 * ### One grammar, two enforcement points
 *
 * {@link PATH_SHAPED_RHS} is quoted verbatim from the consumer's
 * `PATH_SHAPED_LITERAL` (objectui PR #4264, verified against
 * `objectstack-ai/objectui@37cd8e4` rather than against the issue body — a regex
 * relayed through two issue texts is exactly the thing that drifts by a
 * character). Producer and renderer must refuse and warn about the same set, or
 * an author fixes one door and trips the other.
 *
 * The token comes from the canonical AST, not from re-splitting the source: a
 * `==` / `!=` node whose right operand is a plain identifier or a `.`-chain of
 * identifiers. That agrees with the consumer on every shape it can reach —
 * `foo(1)`, `data.b[0]` and `-3` all fail the consumer's regex on their text and
 * all fail `memberChain` here — and it costs exactly one case: an identifier
 * containing `$`, which the grammar admits but CEL's own identifier syntax does
 * not, so `data.a == $b` never parses and is `visibility-predicate-syntax`'s
 * (#6253) verdict rather than a missed catch here. `true` / `false` / `null` /
 * numbers / quoted strings arrive as `value` nodes, never identifiers, so the
 * negative controls are structural rather than a hand-maintained deny-list —
 * the same early returns `parseLiteral` makes before its tail.
 *
 * ### Two severities under one id, and why that is not a hedge
 *
 * The shape is one question with one fix; the CONSEQUENCE splits, and the
 * family's own bar is written on consequence — `error` where "there is no
 * reading of the metadata under which it was going to work"
 * (`visibility-bare-identifier`), `warning` where the predicate is merely
 * advisory-wrong (`visibility-root-mislayered`).
 *
 *  - **A dotted chain** (`data.a == data.b`, or `'x' == data.a` with the sides
 *    swapped) — `error`. Nobody writes a dotted identifier chain meaning the
 *    literal text of it, so there is no reading under which this worked; the
 *    verdict does not depend on the right-hand path at all, and for `==` it is
 *    false whatever the two sides hold, which HIDES the element. That is the
 *    same silent-wrong-verdict consequence
 *    `predicate-path-unresolved` already gates on one function up, so gating
 *    here is the file's existing bar, not a new one.
 *  - **A bare single word** (`status == active`) — `warning`. This one WORKS
 *    today, and the consumer's ruling says so in as many words: resolving the
 *    right side was rejected precisely because "it would flip
 *    `data.type == text`, the unquoted-string spelling that works today by
 *    accident, into a fail-open `true`". An author who meant the text gets the
 *    text. It is still outside the declared subset and still stops working when
 *    ROADMAP M9 swaps this evaluator for `@objectstack/formula` (bare `active`
 *    becomes an undeclared reference), so it must be reported — but refusing a
 *    `view` write at the runtime publish door over metadata that renders
 *    correctly is a false build error in the one direction a gate may not fail
 *    in.
 *
 * ### One position, one prescription (#7696)
 *
 * A BARE word on the right — `data.type == active` — used to draw three
 * findings across two files, and they prescribed opposite fixes:
 * `visibility-bare-identifier` (`error`) and `predicate-path-unrooted`
 * (`error`, when the word is also a schema key) both read it as a dropped
 * binding root and said write `<root>.active`; this rule read it as a literal
 * missing its quotes and said write `'active'`. The `error`s were the ones that
 * blocked the write.
 *
 * They are not two defensible opinions. The rooted spelling they prescribe —
 * `data.type == data.active` — is a path on the RIGHT, which is this rule's own
 * `error` arm one paragraph up: an author who obeys the loud finding lands on a
 * louder one, and if they then "fix" that by making the path resolve, #7214's
 * `predicate-path-unresolved` is the third corner. So the root reading is not a
 * competing fix on this surface; it is a spelling the surface does not have,
 * and the `error`'s own bar ("there is no reading of the metadata under which it
 * was going to work") is FALSE here — the literal reading works today, which is
 * why the bare arm is `warning` in the first place.
 *
 * Both root-prescribing rules therefore stand down for identifiers that occur
 * ONLY as a bare right operand of `==` / `!=` on a metadata-editing form
 * ({@link bareRhsOnlyIdentifiers}), and this rule's bare-arm finding absorbs
 * what they were trying to say: it names BOTH readings, gives the sanctioned
 * spelling for each, and says in as many words that adding the root in place is
 * not one of them. ⛔ Which reading the author meant is still not decided — that
 * is the thing no linter can know, and inventing an answer is what the three
 * contradicting messages were doing.
 *
 * The stand-down is per-IDENTIFIER, never per-predicate: `status == active`
 * keeps its refusal, because `status` on the left is a genuine dropped root and
 * nothing about the right-hand word says otherwise.
 *
 * ### What this rule deliberately does NOT do
 *
 *  - **Suppress the resolution limbs.** `data.a == data.tpye` reports twice —
 *    once because `tpye` is not a key, once because the position is a literal.
 *    Both statements are true and their fixes differ, and #7214's behaviour is
 *    not this rule's to narrow. The one exception is the bare-word position
 *    above, where the two verdicts were not merely different but mutually
 *    unsatisfiable.
 *  - **Judge `in`'s array parse.** The same `parseLiteral` tail is reachable
 *    through `x in [...]` (objectui#4266), which is a distinct defect in the
 *    consumer and deliberately not folded in here.
 *  - **Descend into a comprehension macro body.** `data.tags.all(t, t == x)`
 *    binds `t` inside the body; the interim evaluator supports no macros at all,
 *    so a comparison in there is not a statement about this subset. The receiver
 *    is still walked.
 *  - **Reach a form whose `schemaId` resolves to no schema.** This rule needs no
 *    oracle, but it shares the walk with the two that do, and that walk stops at
 *    an unresolvable `schemaId`. A missed catch in the safe direction, stated
 *    here rather than silently inherited.
 */

import { parseCelToAst } from '@objectstack/formula';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { findClosestMatches, formatSuggestion } from '@objectstack/spec';

import { collectionEntries } from './collection-entries.js';
import {
  COMPREHENSION_MACROS,
  EQUALITY_OPS,
  bareRhsOnlyIdentifiers,
  schemaIdOf,
} from './predicate-rhs-position.js';
import { formViewSites } from './view-walk.js';

export const PREDICATE_PATH_UNRESOLVED = 'predicate-path-unresolved';
export const PREDICATE_PATH_UNROOTED = 'predicate-path-unrooted';
/**
 * A `==` / `!=` RIGHT-hand side that is path-shaped — an unquoted identifier
 * chain (#7659). See the module note's §The right-hand side for the two
 * severities this one id carries and why they are not the same defect.
 */
export const PREDICATE_RHS_PATH_SHAPED = 'predicate-rhs-path-shaped';

/**
 * The two path-RESOLUTION rules always GATE; {@link PREDICATE_RHS_PATH_SHAPED}
 * gates on a dotted chain and is advisory on a bare word — see the module note
 * for why the same shape earns two answers.
 */
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
 * The identifier grammar a path-shaped right-hand side matches — quoted
 * verbatim from objectui's `PATH_SHAPED_LITERAL`
 * (`packages/app-shell/src/views/metadata-admin/predicate.ts`, objectui#4049 /
 * PR #4264). One grammar, two enforcement points: the renderer warns on exactly
 * this set in dev, and this rule refuses it at the publish door.
 *
 * Every chain {@link memberChain} can build already satisfies it (CEL's
 * identifier syntax is a strict subset — no `$`), so today it accepts
 * everything it is handed. It stays as the DEFINITION rather than as a
 * comment: it is the line a reviewer diffs against the consumer, and it is the
 * boundary if either side ever widens.
 */
const PATH_SHAPED_RHS = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** One `==` / `!=` site: the operator as written, and its right operand. */
interface EqualitySite {
  op: string;
  right: unknown;
}

/**
 * Every `==` / `!=` comparison in the AST, with its RIGHT operand.
 *
 * A comprehension macro's BODY is skipped (its receiver is not) — see the
 * module note. Written as an explicit early return rather than a filter on the
 * results, so the boundary is visible where the walk makes it.
 */
function equalitySites(node: unknown, out: EqualitySite[]): void {
  if (Array.isArray(node)) {
    for (const child of node) equalitySites(child, out);
    return;
  }
  if (!isNode(node)) return;
  const args = node.args;
  if (
    node.op === 'rcall' && Array.isArray(args) && typeof args[0] === 'string'
    && COMPREHENSION_MACROS.has(args[0])
  ) {
    equalitySites(args[1], out);
    return;
  }
  if (typeof node.op === 'string' && EQUALITY_OPS.has(node.op) && Array.isArray(args) && args.length === 2) {
    out.push({ op: node.op, right: args[1] });
  }
  equalitySites(args, out);
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
  //
  // Skipped entirely when the scope is not key-bearing (no oracle, no verdict).
  // Written as a guarded BLOCK rather than an early return so the right-hand
  // limb below still runs: that one asks about a POSITION and needs no oracle
  // at all, and gating it behind a resolvable schema is how it went silent on a
  // form whose `schemaId` this package cannot see.
  const declaredHere = keysOf(scope);
  // #7696 — an identifier that occurs ONLY as the bare right operand of
  // `==` / `!=` is in a LITERAL slot, so it is not a dropped root. Suppressed
  // here rather than re-diagnosed: the right-hand limb below reports the same
  // token, once, with the prescription that surface actually accepts.
  const rhsOnly = bareRhsOnlyIdentifiers(ast);
  if (declaredHere) {
    const values = new Set<string>();
    const excluded = new Set<string>();
    classifyIdentifiers(ast, values, excluded);
    for (const id of values) {
      if (excluded.has(id) || rhsOnly.has(id) || !declaredHere.includes(id)) continue;
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

  // ── `predicate-rhs-path-shaped` (#7659) ──
  //
  // Deliberately independent of `scope`: this asks about the POSITION a token
  // sits in, never about what it resolves to. It therefore runs even where the
  // two limbs above went opaque, and it does not suppress them where they have
  // something of their own to say — see the module note's §The right-hand side.
  // For the ONE position where they contradicted it, they now stand down and
  // this is the single finding (#7696, §One position, one prescription).
  const sites: EqualitySite[] = [];
  equalitySites(ast, sites);
  for (const { op, right } of sites) {
    const chain = memberChain(right);
    if (!chain) continue;
    const text = chain.join('.');
    if (!PATH_SHAPED_RHS.test(text)) continue;
    const dotted = chain.length > 1;
    findings.push({
      severity: dotted ? 'error' : 'warning',
      rule: PREDICATE_RHS_PATH_SHAPED,
      where,
      path,
      message: dotted
        ? `predicate compares against \`${text}\` on the RIGHT of \`${op}\`, which is a path but is `
          + `not evaluated as one. A metadata-editing form resolves paths on the LEFT of \`${op}\` `
          + `only; the right-hand side goes to the literal parser, so \`${text}\` is compared as the `
          + `literal string "${text}". The verdict therefore does not depend on the right-hand path `
          + `at all: \`a == ${text}\` is FALSE even when both sides hold the same value, and `
          + `\`a != ${text}\` is correspondingly TRUE. An \`==\` written this way hides the element `
          + `on every row, and nothing in the console says why (objectui#4049).`
        : `predicate compares against the unquoted word \`${text}\` on the RIGHT of \`${op}\`. The `
          + `right-hand side of \`${op}\` is a literal, never a reference, so this is read as the `
          + `literal string "${text}" — which is probably what you meant, and is why it appears to `
          + `work. It is outside the declared subset all the same (\`path == 'literal'\`), and it `
          + `stops working when this surface moves to the real CEL evaluator, where a bare `
          + `\`${text}\` resolves to nothing (objectui#4049). The token also reads as a \`${ROOT}.\` `
          + `root someone dropped, so this one finding carries BOTH readings: which one you meant `
          + `is the thing no linter can know, and it changes the fix (#7696).`,
      hint: dotted
        ? `Two sanctioned spellings. (1) If you meant the TEXT, quote it: \`${op} '${text}'\`. `
          + `(2) If you meant the PATH, restructure so the path is on the LEFT and a literal is on `
          + `the right — comparing one path against another is outside the subset this surface `
          + `renders, which is \`path == 'literal'\` / \`path != 'literal'\` and nothing wider. There `
          + `is no third spelling that compares two paths here.`
        : `Two sanctioned spellings, and you must pick — they are not the same predicate. `
          + `(1) If you meant the TEXT \`${text}\`, quote it: \`${op} '${text}'\`. That is what this `
          + `renders as today, so it changes no behaviour and is the fix unless you know otherwise. `
          + `(2) If you meant the FIELD \`${ROOT}.${text}\`, move it to the LEFT and put a literal on `
          + `the right, e.g. \`${ROOT}.${text} == 'yes'\`. ⛔ Do NOT simply add the root in place: `
          + `\`${op} ${ROOT}.${text}\` is a path on the RIGHT, which this surface parses as the `
          + `literal string "${ROOT}.${text}" — it is refused by this same rule at \`error\`, and it `
          + `is FALSE on every row. The subset here is \`path == 'literal'\` and nothing wider.`,
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
 * Both path-resolution rules emit `error` and the caller is expected to fail the
 * build on them. The corpus measurement behind that severity is on the PR for
 * #7010: over the shipped `METADATA_FORM_REGISTRY` (17 forms, 46 predicates) the
 * count is **0** for both, and 16 for `predicate-path-unrooted` once #6254's
 * pre-fix `object.form.ts` is restored.
 *
 * The third rule, `predicate-rhs-path-shaped` (#7659), asks a different question
 * about the same predicates — whether a `==` / `!=` RIGHT-hand side is
 * path-shaped, which the renderer parses as a literal — and carries two
 * severities: `error` on a dotted chain, `warning` on a bare word. Its corpus
 * count over the same shipped forms is **0** at both severities. See the module
 * note.
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
      // An id no schema resolves leaves the two RESOLUTION limbs without an
      // oracle, and they go quiet on their own (`keysOf(undefined)` is `null`,
      // and every `stepInto` is `opaque`). The site is still walked, because
      // the right-hand-position limb needs no oracle — and since #7696 the
      // sibling rules STAND DOWN on this surface, walking past it would turn a
      // reconciliation into a silence. A resolver that throws on an unknown id
      // is the same case and must not take the build down with it.
      let root: unknown;
      try {
        root = resolveSchema(schemaId);
      } catch {
        root = undefined;
      }

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
