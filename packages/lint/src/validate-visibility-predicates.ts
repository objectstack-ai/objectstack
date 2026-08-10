// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time conditional-visibility diagnostics (ADR-0089 D3b).
 *
 * ADR-0089 unifies the conditional-visibility predicate under the single
 * canonical key **`visibleWhen`** across data fields, view form sections/fields,
 * and page components. The deprecated spellings — `visibleOn` (view form) and
 * `visibility` (page component) — stay accepted and are folded into `visibleWhen`
 * before this file ever sees them.
 *
 * ## Why there is no alias-KEY rule here any more (#6318, retired)
 *
 * This file used to carry a fourth rule, `visibility-alias-deprecated`, whose
 * whole job was to report the alias KEY. It was **unreachable on every real
 * input shape** and is gone. The measurement, re-run at retirement time:
 *
 * | alias site | rule fed the RAW authored object | rule fed the `normalized` tier |
 * |---|---|---|
 * | `views[].form.sections[]` | 1 finding | **0** |
 * | `views[].formViews.edit.sections[]` | 1 finding | **0** |
 * | `pages[].regions[].components[]` | 1 finding | **0** |
 *
 * The `normalized` tier is what all three commands hand this rule family
 * (`authoring-rules.ts`, `input: 'normalized'`), and the ADR-0087 D2 conversions
 * `view-visibleOn-to-visibleWhen` / `page-component-visibility-to-visibleWhen`
 * rename the key INSIDE `normalizeStackInput` — whose output *is* that tier. So
 * the key was always already gone. The one shape the rule did still fire on,
 * `views[].sections[]` (a view CONTAINER with top-level sections), is the shape
 * its own unit tests used and the one strict `ViewSchema` refuses outright:
 * "Unrecognized key(s) on this view container: `sections`". A green unit test
 * over a fixture production can never send — the #4984 / #6251 signature.
 *
 * **The surface is still guarded, and better.** The same D2 conversion shouts
 * through `warnConversionNotice` in `defineStack`, with wording this rule never
 * had — it names the site, the conversion, and the retirement window:
 *
 * ```
 * defineStack: views[0].form.sections[0].visibleWhen: 'visibleOn' -> 'visibleWhen'
 *   (converted at load; conversion 'view-visibleOn-to-visibleWhen', retires in protocol 16).
 *   Update the source to the canonical shape — the conversion stops running then.
 * ```
 *
 * So no working app lost a signal when the rule went: authors were never hearing
 * this rule, and they do hear the conversion notice. Retired under ADR-0049
 * (declared ≠ enforced) rather than re-anchored, because re-anchoring would have
 * had to change `runAuthoringRules`' external input contract — a `packages/lint`
 * public-API question that is the maintainer's to settle, not this file's.
 * `authoring-rule-input-tier.test.ts` (premise 3) holds the regression pins.
 *
 * The three rules that remain judge the predicate's **value**, which the fold
 * carries into `visibleWhen` intact — all three report normally on the
 * normalized tier, and none was affected by the retirement.
 *
 * One advisory rule (`warning` — nothing is broken, a mis-rooted predicate just
 * never matches) plus TWO **gating** rules (`error` — the predicate can never
 * evaluate at all):
 *
 * - `visibility-predicate-syntax` (**error**, #6253) — a predicate the canonical
 *   CEL front end refuses outright (`country === "USA"` — `===` is not CEL). See
 *   the §Syntax block below for why this surface has to say it and who owns the
 *   verdict.
 * - `visibility-bare-identifier` (**error**, #6128 / #5149 requirement 3) — a
 *   predicate referencing a top-level identifier that no binding root can
 *   resolve (`status == 'active'` instead of `record.status == 'active'`). See
 *   the §Bare identifiers block below for the mechanism and the boundaries.
 * - `visibility-root-mislayered` — a visibility predicate whose binding root does
 *   not match its layer (ADR-0089 D3, §Context). The check is **bidirectional**:
 *   - **runtime** view/page surfaces (`*.view.ts` / `*.page.ts`) bind
 *     `record` + `current_user` (pages also expose `page.<var>`), so a `data.`-rooted
 *     predicate here is a wrong-layer paste that silently never matches; and
 *   - **metadata-editing** forms (`*.form.ts` — the row under edit) bind `data`, so
 *     a `record.`-rooted predicate there is the same bug in the other direction.
 *   The layer is supplied by the caller (`opts.layer`, default `'runtime'`): the
 *   app-lint path (`os validate` / `compile`) always lints runtime surfaces, while a
 *   file-aware caller linting a `*.form.ts` passes `layer: 'metadata'`.
 *
 * Scope: `views` — every form view reachable from a `views[]` entry (the entry
 * itself when it IS a form view, plus the container's `form` and each
 * `formViews.<key>`), through the shared `view-walk.ts` ladder (#6381; see
 * {@link formViewSites} for why reading only the first shape left this rule
 * reporting clean on real metadata, and why `listViews.<key>` is filtered out
 * rather than absent) — and `pages`, through the shared `walkPageComponents`
 * traversal. Data-field `visibleWhen` is already covered by
 * `validate-expressions` and is not re-checked here.
 *
 * The predicate family is read off the schema, not guessed: `visibleWhen` is the
 * canonical key on all three carriers (`FormFieldBaseSchema` `view.zod.ts:1416`,
 * `FormSectionSchema` `view.zod.ts:1510`, `PageComponentSchema`
 * `page.zod.ts:143`), `visibleOn` is the view-side deprecated alias
 * (`view.zod.ts:1418` / `:1512`) and `visibility` the page-side one
 * (`page.zod.ts:145`). There is no fourth spelling on this surface.
 *
 * ## Syntax — the one surface where "don't judge syntax" meant nobody judged it
 *
 * `visibility-predicate-syntax` exists because a policy that is right at three
 * call sites was wrong at this one. Both this rule and `validate-null-guards.ts`
 * used to skip a source `parseCelToAst` refuses, on the stated grounds that a
 * second syntax verdict must not be invented. That reasoning holds wherever
 * `validateExpression` (ADR-0032) runs over the same predicate — it does the
 * judging, and a duplicate would only disagree. It does NOT hold here:
 * `validate-expressions.ts` walks objects / flows / actions / sharingRules /
 * hooks and never `views` or `pages`, so on this surface "leave it to the gate
 * that owns it" resolved to no gate at all. `country === "USA"` — the spelling
 * `packages/spec/src/ui/view.test.ts` fixtures prove authors reach for — passed
 * the build with zero diagnostics, and then failed OPEN in the console for the
 * #5149 reason the whole family is about: eval faults, `evalFieldPredicate`
 * returns its fallback, the visibility fallback is `true`, and the element
 * renders unconditionally, pixel-identical to one carrying no predicate.
 *
 * Maintainer ruling (#6253, 2026-08-07): **blocking error**, at the same
 * severity every other predicate surface already applies to a syntax fault. No
 * warning tier and no documented exception for this surface — a warning that
 * does not fail CI is silence with extra steps.
 *
 * ### The verdict is still not ours (which is what the old policy was protecting)
 *
 * The policy's real content was "one answer to what parses", and that survives
 * intact: the verdict is `parseCelToAst`'s — the canonical front end, carrying
 * the #3306 rewrite and `DEFAULT_LIMITS` (#4812) — and this rule builds no
 * `Environment` and hand-rolls no tokenizer to second-guess it. What #6253 adds
 * is a REPORT of a verdict already reached, plus the corrective wording the raw
 * parser message lacks: cel-js says `Unexpected character: =` with a caret, which
 * names neither the operator the author actually typed nor the CEL spelling of
 * it. {@link NON_CEL_SPELLINGS} supplies that, and cannot change any verdict —
 * it is consulted only after the parse has already failed.
 *
 * Deliberately NOT `validateExpression` / `celEngine.compile`, though those are
 * the ADR-0032 entries and the temptation is obvious. `compile()` is parse **+
 * type-check**, and the difference is not theoretical: measured, it rejects
 * `type == 'grid'` with `no such overload: type == string`. That shape is this
 * file's pinned blind spot (see the CEL-TYPE bullet below) — a deliberate,
 * test-documented decision to stay conservative — and routing this rule through
 * `compile()` would silently overturn it from the syntax branch, widening an
 * `error`-level gate from "does not parse" to "does not type-check" on a surface
 * whose predicates are overwhelmingly `dyn`. The ruling says syntax; the parse
 * verdict is exactly syntax. `parseCelToAst` also refuses a `DEFAULT_LIMITS`
 * overrun, which is a bounds fault rather than a syntax one; it is reported here
 * too, quoting the front end's own words, exactly as ADR-0032 already reports it
 * under the same "invalid CEL predicate" heading.
 *
 * ## Bare identifiers — the gap between two gates that both wave it through
 *
 * `visibility-bare-identifier` exists because #5149 Repro 1 measured a predicate
 * written with bare field names (`status == 'active'`) passing **every** gate the
 * platform has and then failing OPEN in the console: the identifier resolves to
 * nothing, `evalFieldPredicate` returns its `fallback`, and for visibility that
 * fallback is `true` — so a predicate that never works is pixel-identical to no
 * predicate at all. The maintainer's 2026-08-06 ruling on #5149 kept fail-open
 * and closed the silence from both ends instead: warn-once at runtime
 * (objectui#3541, requirement 2) and refuse the metadata at build time (this
 * rule, requirement 3).
 *
 * The two gates that already exist each miss it for a structural reason, and
 * BOTH reasons must stay written down or this rule reads like a duplicate and
 * gets merged away:
 *
 * - **ADR-0032's identifier gate** (`validate-expressions.ts`) resolves bare
 *   refs on `record`-scoped sites — but its traversal covers objects, flows,
 *   actions, sharing rules and hooks. It never walks `views` or `pages`, so a
 *   view form field's `visibleWhen` is outside it entirely.
 * - **ADR-0089 D3b** (the two rules above, same file) walks exactly this
 *   surface — but it judges the *root* of a predicate that HAS one
 *   (`data.` in a runtime view, `record.` in a metadata form). A predicate with
 *   no root at all matches neither direction and falls through clean.
 *
 * ### How the verdict is decided (two oracles, neither of them ours)
 *
 * The declaredness verdict comes from `@objectstack/formula`'s
 * `firstUndeclaredReference` — the same strict-environment check
 * `validateExpression` uses for the `record`-scoped bare-ref error, so "what
 * resolves" has one answer across the platform. This rule builds no
 * `Environment` of its own: that is the #4812 lesson (a private parse front end
 * silently answers a different question), and the AST it does read comes from
 * `parseCelToAst`, the canonical entry.
 *
 * The checker alone is not enough, because cel-js reports every undeclared
 * top-level identifier — including the ROOT of a dotted path nobody binds
 * (`my_record.x`). Those are deliberately out of scope here: the set of legal
 * roots is not yet trustworthy enough to gate on (#6146 measured `current_user`
 * as documented-but-unbound at both ends), and the two ADR-0089 rules above
 * already own the wrong-root directions the spec DOES state. So the AST is
 * walked first for every identifier used in a **receiver position** (`a.b`,
 * `a?.b`, `a['b']`, `a.exists(…)`) and those names are declared before the
 * check runs. What survives is an identifier used as a bare VALUE — the one
 * shape that cannot resolve under any binding convention.
 *
 * ### What this rule deliberately does NOT reject
 *
 * - **Comprehension-macro variables.** `record.tags.all(t, t != '')` binds `t`
 *   inside the macro body; the AST reports it as a top-level id, the strict
 *   checker does not. Measured, not assumed — which is exactly why the verdict
 *   is the checker's and not a hand-rolled AST scan.
 * - **Shapes that are legal only under a SPARSE binding (#4953).** That issue
 *   measured the same evaluator giving opposite verdicts on a total vs sparse
 *   record: `has(record.a)` is `true`/`false` and `record.a != null` is
 *   `false`/FAULT depending on which one the surface binds. This rule is immune
 *   to that fork by construction — it never asks whether a KEY is present on a
 *   bound root, only whether the identifier has a root at all, and a rootless
 *   identifier resolves under neither binding. `has(record.x)`,
 *   `record.x != null` and every other guard idiom stay green here, whichever
 *   way #4953 is eventually settled.
 * - **A predicate the canonical front end will not parse.** `parseCelToAst`
 *   returns `null` there, so the declaredness check has no AST to reason about
 *   and this rule gives no BARE-IDENTIFIER verdict on it. That is a division of
 *   labour, not silence: since #6253 the same source is reported by
 *   `visibility-predicate-syntax` (§Syntax above), and the two are mutually
 *   exclusive by construction — a predicate that parses cannot be a syntax
 *   fault, and one that does not parse yields no identifiers to judge. A single
 *   broken predicate therefore produces exactly one finding, never two.
 * - **Nested composite / repeater sub-fields** (`fields[].fields[]`,
 *   `view.zod.ts:1477`). The traversal stops at a section's direct fields. A
 *   sub-field of a repeater row is evaluated against a binding this rule cannot
 *   cite a spec sentence for, and an `error`-level gate must not judge a
 *   convention it cannot name.
 * - **A field whose name collides with a CEL TYPE** — `type`, `int`, `string`,
 *   `bool`, `double`, `bytes`, `list`, `map`, `timestamp`, `duration`,
 *   `null_type`. CEL declares those identifiers itself (they denote type
 *   values), so bare `type == 'grid'` reaches the checker as a type-overload
 *   error rather than an unknown variable, and only the latter is a verdict
 *   here. It cannot be closed by reading the overload message instead:
 *   `type(record.x) == string` is legitimate CEL over the very same names. A
 *   measured blind spot in the safe direction — a missed catch, never a false
 *   build error — pinned by a test so it reads as a decision.
 */

import { collectCelRootIdentifiers, firstUndeclaredReference, parseCelToAst } from '@objectstack/formula';
import type { CelAstNode } from '@objectstack/formula';

import { collectionEntries } from './collection-entries.js';
import { walkPageComponents } from './page-walk.js';
import { formViewSites } from './view-walk.js';

export const VISIBILITY_ROOT_MISLAYERED = 'visibility-root-mislayered';
export const VISIBILITY_BARE_IDENTIFIER = 'visibility-bare-identifier';
export const VISIBILITY_PREDICATE_SYNTAX = 'visibility-predicate-syntax';

export type VisibilitySeverity = 'error' | 'warning';

/**
 * Which binding environment the linted surface belongs to (ADR-0089 §Context):
 * - `runtime`  — `*.view.ts` / `*.page.ts`; binds `record` + `current_user` (+ `page`).
 * - `metadata` — `*.form.ts` metadata-editing forms; binds `data` (the row under edit).
 */
export type VisibilityLayer = 'runtime' | 'metadata';

/** Options for {@link validateVisibilityPredicates}. */
export interface VisibilityOptions {
  /** Binding layer of the surface being linted. Defaults to `'runtime'`. */
  layer?: VisibilityLayer;
}

export interface VisibilityFinding {
  /**
   * `warning` for the ADR-0089 D3b advisory (`visibility-root-mislayered`);
   * `error` for the two rules that gate — `visibility-predicate-syntax` and
   * `visibility-bare-identifier` (see module note).
   */
  severity: VisibilitySeverity;
  /** Diagnostic rule id, e.g. `visibility-root-mislayered`. */
  rule: string;
  /** Human-readable location, e.g. `view "contact_form"`. */
  where: string;
  /** Config path, e.g. `views[2].sections[0].fields[3]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/**
 * The canonical predicate key (ADR-0089). The two deprecated spellings
 * (`visibleOn` / `visibility`) are read inline in `checkElement`, canonical-first
 * — the `ALIASES` list that used to sit here existed only to iterate the retired
 * alias-KEY rule, and went with it (#6318).
 */
const CANONICAL = 'visibleWhen';

/** Extract the CEL source from a predicate value (string, or `{ source }` envelope). */
function predicateSource(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as AnyRec).source === 'string') {
    return (v as AnyRec).source as string;
  }
  return undefined;
}

/** Does the predicate reference `<root>.<x>` as a leading binding root? */
function usesRoot(source: string, root: string): boolean {
  // `<root>` as a leading identifier followed by a property access. The leading
  // `(^|[^.\w$])` guard excludes a nested access like `foo.data` (a field named
  // `data`) or `my_record.x` (an identifier that merely ends in `record`).
  return new RegExp(`(^|[^.\\w$])${root}\\.\\w`).test(source);
}

// ── `visibility-predicate-syntax` (#6253) ───────────────────────────

/**
 * `source` with every string literal blanked out — same length, so nothing else
 * shifts. The spelling scan below must never read INSIDE a literal, because the
 * two things are independent: `record.msg == 'a === b'` parses fine and never
 * reaches this code at all, while `record.msg == 'x' and record.n > 1` fails on
 * `and` and would otherwise be blamed on the `===`-free string beside it. Only
 * the hint could ever be wrong that way — the verdict is already in — but a hint
 * naming the wrong token is worse than no hint.
 *
 * The alternation is unambiguous by construction (`[^'\\]` and `\\.` cannot both
 * match at one position), so this scans linearly — the same ReDoS discipline
 * `@objectstack/formula`'s `validate.ts` states for its own scanners.
 */
function withoutStringLiterals(source: string): string {
  return source.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, (lit) => ' '.repeat(lit.length));
}

/**
 * Non-CEL operator spellings an author — or a model fluent in JavaScript, SQL and
 * Python — reaches for, each with the CEL token that means the same thing.
 *
 * Every row is MEASURED to fail the canonical parse; none is a guess. None can
 * change a verdict either: the table is consulted only once `parseCelToAst` has
 * already refused the source, so its whole effect is on the wording of a finding
 * that was going to be emitted regardless.
 *
 * Order matters — `===` and `!==` contain shorter operators, so they match first
 * and the bare `=` row last.
 *
 * Deliberately absent, though both are measured to fail the parse and both are
 * still reported (with the front end's own diagnostic): `??`, because CEL has no
 * null-coalescing operator to swap in, and SQL's `IN (…)`, because the CEL
 * spelling changes the list literal too (`('a','b')` → `['a','b']`). A
 * "write X instead of Y" hint that is only half the fix sends the author round a
 * second lap, which is the opposite of self-correcting.
 */
const NON_CEL_SPELLINGS: ReadonlyArray<{
  wrote: string;
  cel: string;
  example: string;
  re: RegExp;
}> = [
  { wrote: '===', cel: '==', example: "record.country == 'USA'", re: /===/ },
  { wrote: '!==', cel: '!=', example: "record.country != 'USA'", re: /!==/ },
  { wrote: '<>', cel: '!=', example: "record.country != 'USA'", re: /<>/ },
  { wrote: 'and', cel: '&&', example: "record.a == 1 && record.b == 2", re: /(?<![.\w$])and(?![\w$])/i },
  { wrote: 'or', cel: '||', example: "record.a == 1 || record.b == 2", re: /(?<![.\w$])or(?![\w$])/i },
  { wrote: 'not', cel: '!', example: '!record.archived', re: /(?<![.\w$])not(?![\w$])/i },
  // Assignment where a comparison was meant. Last, and fenced off from every
  // operator that legitimately contains `=` (`==`, `!=`, `<=`, `>=`).
  { wrote: '=', cel: '==', example: "record.status == 'open'", re: /(?<![=!<>])=(?!=)/ },
];

/** What the canonical front end refused, and the corrective wording for it. */
interface CelSyntaxFault {
  /** The front end's own one-line diagnostic, quoted rather than paraphrased. */
  detail: string;
  /** The recognised non-CEL spelling, when the source contains one. */
  token: { wrote: string; cel: string; example: string } | null;
}

/** The predicate as it appears in a message — whitespace flattened, long sources elided. */
function quoteSource(source: string): string {
  const flat = source.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

/**
 * The canonical front end's refusal of `source`, or `null` when it parses.
 *
 * Two things are deliberately NOT done here (see the module note's §Syntax):
 * this function neither parses with an environment of its own nor reaches for
 * `celEngine.compile` / `validateExpression`, which would widen the gate from
 * "does not parse" to "does not type-check".
 */
function celSyntaxFault(source: string): CelSyntaxFault | null {
  // A blank predicate is not a syntax fault. `parseCelToAst` returns `null` for
  // an empty or whitespace-only source too, so without this guard the rule would
  // report `visibleWhen: '   '` — which is "no predicate", exactly what the
  // author meant, and what `validateExpression` itself short-circuits on.
  if (!source.trim()) return null;
  // The verdict, from the one entry that owns it (#4812).
  if (parseCelToAst(source) !== null) return null;
  // The MESSAGE, from the same package's parse-only classifier — `compile()`
  // would answer a wider question, and re-throwing the parse ourselves would be
  // the private front end #4812 removed.
  const parsed = collectCelRootIdentifiers(source);
  const detail = parsed.ok
    // Unreachable while both entries parse the same source through the same env
    // under the same limits. Kept as a truthful fallback rather than a `!`
    // assertion, so a future divergence degrades to a vaguer message instead of
    // throwing inside a linter.
    ? 'the expression could not be parsed'
    : parsed.error.split('\n')[0].trim();
  const scannable = withoutStringLiterals(source);
  return { detail, token: NON_CEL_SPELLINGS.find((s) => s.re.test(scannable)) ?? null };
}

// ── `visibility-bare-identifier` (#6128) ────────────────────────────

/**
 * Binding roots this surface exposes BEYOND the generous set
 * `@objectstack/formula`'s strict environment already declares (`record`,
 * `previous`, `data`, `parent`, `user`, `ctx`, … — `cel-engine.ts` SCOPE_ROOTS,
 * which errs toward declaring more precisely because a missing root is a false
 * build error while an extra one is only a missed catch).
 *
 * Both entries are read off the schema rather than chosen here:
 * `view.zod.ts:1416` / `:1510` state the runtime form binding as
 * `record` + `current_user`, and `page.zod.ts:143` adds page state as
 * `page.<var>` for a page component. The runtime side binds `record` +
 * `previous` + a caller-supplied extra scope (objectui
 * `packages/core/src/evaluator/fieldRules.ts` `evalFieldPredicate`), so the
 * union — not either list alone — is the safe set for an `error`-level gate.
 *
 * `current_user` is declared here even though #6146 measured it as
 * documented-but-unbound at both ends: whether that root RESOLVES is that
 * issue's verdict to give, and this rule must not pre-empt it by reporting a
 * spelling the spec currently tells authors to write.
 */
const VIEW_PAGE_EXTRA_ROOTS = ['current_user', 'page'] as const;

type AnyNode = { op?: string; args?: unknown };

function isNode(v: unknown): v is AnyNode & CelAstNode {
  return !!v && typeof v === 'object' && typeof (v as AnyNode).op === 'string';
}

/**
 * Every identifier the source uses in a **receiver position** — `a.b`, `a?.b`,
 * `a['b']`, `a.exists(…)`. The author is treating each of these as a namespace,
 * so an unbound one is a wrong-ROOT defect (ADR-0089 D3b's territory, or an
 * undocumented root this rule deliberately does not adjudicate), never the bare
 * field name #5149 Repro 1 is about.
 *
 * Declaring them before the strict check is what narrows this rule to bare
 * VALUE references. It is uniformly the conservative direction: every name it
 * adds can only remove a finding, so the widening costs coverage and can never
 * produce a false build error.
 */
function namespaceRoots(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) namespaceRoots(child, out);
    return;
  }
  if (!isNode(node)) return;
  const args = node.args;
  if (Array.isArray(args)) {
    // `.` / `.?` / `[]` hold the receiver first; `rcall` (a receiver-style call
    // such as `record.tags.all(t, …)`) holds the method NAME first and the
    // receiver second.
    const receiver = node.op === 'rcall' ? args[1] : args[0];
    if ((node.op === '.' || node.op === '.?' || node.op === '[]' || node.op === 'rcall')
      && isNode(receiver) && receiver.op === 'id' && typeof receiver.args === 'string') {
      out.add(receiver.args);
    }
  }
  namespaceRoots(args, out);
}

/**
 * The first identifier in `source` that no binding root can resolve, or `null`
 * when every reference is rooted. See the module note for why this is two
 * oracles (the canonical AST for namespace roots, the shared strict-environment
 * checker for the verdict) and for the shapes it deliberately leaves alone.
 */
function firstBareIdentifier(source: string): string | null {
  const ast = parseCelToAst(source);
  // Not parseable through the canonical front end (syntax fault, or over
  // DEFAULT_LIMITS) — not this rule's verdict to give.
  if (!ast) return null;
  const rooted = new Set<string>();
  namespaceRoots(ast, rooted);
  return firstUndeclaredReference(source, [...VIEW_PAGE_EXTRA_ROOTS, ...rooted]);
}

/**
 * The root an author on this layer should have written. Runtime view/page
 * surfaces bind the live record as `record`; a `*.form.ts` metadata-editing
 * form binds the row under edit as `data` (ADR-0089 D3, §Context).
 */
const CANONICAL_ROOT_BY_LAYER: Record<VisibilityLayer, string> = {
  runtime: 'record',
  metadata: 'data',
};

/**
 * Per-layer mis-rooted-predicate description. The `runtime` layer forbids the
 * metadata-editing-form root (`data.`); the `metadata` layer forbids the runtime
 * record-surface root (`record.`) — ADR-0089 D3 spells out both directions.
 */
const MISLAYER_BY_LAYER: Record<
  VisibilityLayer,
  { forbiddenRoot: string; message: string; hint: string }
> = {
  runtime: {
    forbiddenRoot: 'data',
    message:
      'visibility predicate is rooted at `data.` — that is the ' +
      'metadata-editing-form root (a `*.form.ts` row under edit), not a runtime ' +
      'surface. A runtime view/page predicate that binds `data.` never matches ' +
      'and the element renders unconditionally (ADR-0089).',
    hint:
      'Runtime record surfaces bind `record` + `current_user` (pages also ' +
      "expose `page.<var>`). Use e.g. `record.status == 'open'` instead of " +
      "`data.status == 'open'`.",
  },
  metadata: {
    forbiddenRoot: 'record',
    message:
      'visibility predicate is rooted at `record.` — that is the runtime ' +
      'record-surface root (a `*.view.ts` / `*.page.ts` live record), not a ' +
      'metadata-editing form. A `*.form.ts` predicate that binds `record.` never ' +
      'matches and the element renders unconditionally (ADR-0089).',
    hint:
      'Metadata-editing forms bind `data` (the row under edit). Use e.g. ' +
      "`data.type == 'grid'` instead of `record.type == 'grid'`.",
  },
};

/**
 * Inspect one element carrying a visibility predicate. Emits the mis-layered-root
 * finding (when the effective predicate's binding root does not match `layer`),
 * the syntax finding, and the bare-identifier finding.
 *
 * There is no alias-KEY step here: `visibility-alias-deprecated` was retired
 * under #6318 (see the module note for the per-site measurement and for the D2
 * conversion notice that guards the surface instead).
 */
function checkElement(
  el: AnyRec,
  where: string,
  path: string,
  layer: VisibilityLayer,
  findings: VisibilityFinding[],
): void {
  // (1) mis-layered binding root — check the effective predicate (canonical wins)
  // against the root expected for this layer.
  //
  // The two alias limbs STAY, and are not the thing #6318 retired. That issue is
  // about the alias KEY as a verdict; this is the predicate VALUE, and the value
  // is what all three surviving rules judge. Through the three CLI commands the
  // limbs are already unreachable (the D2 fold renamed the key one layer up), but
  // `validateVisibilityPredicates` is a PUBLISHED export that a caller — this
  // package's own unit tests included — may hand a raw authored object, and on
  // that door an alias-spelled predicate must still be judged rather than skipped
  // silently. Ordering is canonical-first per ADR-0089, so an alias can never
  // override a `visibleWhen` that is present: the limbs can only ever add
  // coverage, never change a verdict.
  const raw = el[CANONICAL] ?? el.visibleOn ?? el.visibility;
  const source = predicateSource(raw);
  const rule = MISLAYER_BY_LAYER[layer];
  if (source && usesRoot(source, rule.forbiddenRoot)) {
    findings.push({
      severity: 'warning',
      rule: VISIBILITY_ROOT_MISLAYERED,
      where,
      path,
      message: rule.message,
      hint: rule.hint,
    });
  }

  // (2) #6253 — the canonical CEL front end refuses the source outright. GATES,
  // at the severity every other predicate surface already applies to a syntax
  // fault (ADR-0032 via `validateExpression`); this surface is the one that had
  // no such gate, so a `===` shipped clean and then failed OPEN in the console.
  const syntaxFault = source ? celSyntaxFault(source) : null;
  if (source && syntaxFault) {
    findings.push({
      severity: 'error',
      rule: VISIBILITY_PREDICATE_SYNTAX,
      where,
      path,
      message:
        `visibility predicate is not valid CEL — ${syntaxFault.detail} ` +
        `(predicate: \`${quoteSource(source)}\`). A predicate that does not parse can never ` +
        `evaluate, and the console falls OPEN: the element renders unconditionally and looks ` +
        `exactly like one with no predicate at all (#5149).`,
      hint: syntaxFault.token
        ? `\`${syntaxFault.token.wrote}\` is not a CEL operator — CEL spells it ` +
          `\`${syntaxFault.token.cel}\`. Replace \`${syntaxFault.token.wrote}\` with ` +
          `\`${syntaxFault.token.cel}\`, e.g. \`${syntaxFault.token.example}\`.`
        : `Visibility predicates are bare CEL, e.g. \`record.status == 'open'\`. Spellings from ` +
          `other languages do not parse: write \`==\` (not \`===\`), \`!=\` (not \`!==\` or \`<>\`), ` +
          `\`&&\` (not \`and\`), \`||\` (not \`or\`), \`!\` (not \`not\`).`,
    });
  }

  // (3) #6128 — a reference no binding root can resolve. Unlike (1) this one
  // GATES: a mis-rooted predicate is at least a statement about a namespace
  // someone binds somewhere, while a bare identifier resolves nowhere, on no
  // layer, under neither a total nor a sparse record (#4953) — so there is no
  // reading of the metadata under which it was going to work.
  //
  // Skipped when (2) fired: the declaredness check needs an AST, and a source
  // that does not parse has none. Written as an explicit `else` rather than
  // relying on `firstBareIdentifier`'s own null-AST guard, so the one-finding
  // -per-broken-predicate property is visible at the call site instead of
  // depending on a callee's internals.
  if (source && !syntaxFault) {
    const bare = firstBareIdentifier(source);
    if (bare) {
      const root = CANONICAL_ROOT_BY_LAYER[layer];
      findings.push({
        severity: 'error',
        rule: VISIBILITY_BARE_IDENTIFIER,
        where,
        path,
        message:
          `visibility predicate references \`${bare}\` as a bare identifier. ` +
          `Values are bound under a namespace on this surface — they are never ` +
          `flattened to top level — so \`${bare}\` resolves to nothing, the predicate ` +
          `can never evaluate, and the console falls OPEN: the element renders ` +
          `unconditionally and looks exactly like one with no predicate at all (#5149).`,
        hint:
          `Write \`${root}.${bare}\` instead of \`${bare}\`` +
          (layer === 'runtime'
            ? ' (runtime view/page surfaces bind `record` + `current_user`; a page component also exposes page state as `page.<var>`).'
            : ' (a `*.form.ts` metadata-editing form binds the row under edit as `data`).'),
      });
    }
  }
}

/** A section field entry is either a bare field name or `{ field, visibleWhen, … }`. */
function isFieldObject(entry: unknown): entry is AnyRec {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry);
}

/**
 * Validate conditional-visibility predicates across authored views and pages.
 *
 * Every rule here judges the predicate's **VALUE**, which survives both the
 * ADR-0087 D2 alias fold and the Zod parse intact — so the registered
 * `normalized` tier sees exactly what a `parsed` one would. (It is registered
 * `normalized` for the tier's surviving reason, not the retired one: a
 * normalized-tier finding still reaches the author when an unrelated schema
 * error elsewhere would have stopped the parse. See `AuthoringRuleInputTier`.)
 *
 * Returns findings (empty = clean). `visibility-root-mislayered` is advisory
 * (`warning`); `visibility-predicate-syntax` (#6253) and
 * `visibility-bare-identifier` (#6128) are `error` and the caller is expected to
 * fail the build on them.
 *
 * The binding-root check is layer-directional (ADR-0089 D3): pass
 * `opts.layer = 'metadata'` when linting a `*.form.ts` metadata-editing form (so a
 * `record.`-rooted predicate is flagged), or leave it at the `'runtime'` default for
 * `*.view.ts` / `*.page.ts` surfaces (so a `data.`-rooted predicate is flagged). The
 * syntax and bare-identifier checks are layer-agnostic.
 */
export function validateVisibilityPredicates(
  stack: AnyRec,
  opts: VisibilityOptions = {},
): VisibilityFinding[] {
  const layer: VisibilityLayer = opts.layer ?? 'runtime';
  const findings: VisibilityFinding[] = [];

  // ── Views: every reachable form view's sections / groups, and their fields ──
  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    // A container names itself with `name`, or binds with `object` — and an
    // artifact-emitted one may carry neither, so the path is the last resort.
    const viewName = typeof view.name === 'string' ? view.name
      : typeof view.object === 'string' ? view.object
        : viewPath;

    for (const site of formViewSites(view, viewPath)) {
      const where = site.surface ? `view "${viewName}" · ${site.surface}` : `view "${viewName}"`;
      // `sections` (canonical) and `groups` (legacy alias → sections) both hold
      // FormSection objects with an optional visibility predicate + `fields`.
      for (const bucket of ['sections', 'groups'] as const) {
        const sections = Array.isArray(site.view[bucket]) ? (site.view[bucket] as unknown[]) : [];
        for (let s = 0; s < sections.length; s++) {
          const sec = sections[s];
          if (!sec || typeof sec !== 'object') continue;
          const secPath = `${site.path}.${bucket}[${s}]`;
          checkElement(sec as AnyRec, where, secPath, layer, findings);

          const secFields = Array.isArray((sec as AnyRec).fields) ? ((sec as AnyRec).fields as unknown[]) : [];
          for (let f = 0; f < secFields.length; f++) {
            const entry = secFields[f];
            if (isFieldObject(entry)) {
              checkElement(entry, where, `${secPath}.fields[${f}]`, layer, findings);
            }
          }
        }
      }
    }
  }

  // ── Pages: every component, through the SHARED walk ─────────────────
  //
  // `walkPageComponents` (#3583) is the one traversal that knows where page
  // components actually live: `regions[].components[]`, the slotted-page
  // `slots.<slot>` map (single component OR array), and the sub-trees hidden in
  // the untyped `properties` bag (`page:tabs` / `page:accordion`
  // `items[].children`, `page:card` `body` / `footer`). It also skips
  // source-authored (`html` / `react` / `jsx`) pages, whose `regions` are a
  // derived cache the author never wrote — reporting a gating error against
  // that cache would be a build failure over metadata nobody authored.
  //
  // Taken rather than hand-rolled for the reason that file states in its own
  // header: duplicating this walk has already produced one dead rule. A
  // hand-rolled `regions[].components[]` loop is exactly the copy that misses
  // slots and nested children — and `visibility-bare-identifier` GATES, so
  // `authoring-rules.ts`'s standard applies: partial coverage is not a stricter
  // check, it is a coin flip.
  for (const { rec: page, path: pagePath } of collectionEntries(stack.pages, 'pages')) {
    const pageName = typeof page.name === 'string' ? page.name : undefined;
    const where = `page "${pageName ?? pagePath}"`;
    for (const walked of walkPageComponents(page, pagePath)) {
      checkElement(walked.component, where, walked.path, layer, findings);
    }
  }

  return findings;
}
