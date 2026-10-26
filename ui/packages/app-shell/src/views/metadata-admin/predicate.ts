// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tiny predicate evaluator for FormView `visibleWhen` expressions.
 *
 * This is an interim stand-in for the full CEL runtime
 * (`@objectstack/formula`) — we keep it intentionally small so the
 * Setup admin engine has zero new runtime dependencies. When CEL is
 * unified across the platform (ROADMAP M9), swap `evaluatePredicate`
 * for the real CEL evaluator without touching SchemaForm.tsx.
 *
 * Supported subset (covers everything used in spec `*.form.ts` today):
 *   - `path == 'literal'`       string equality
 *   - `path != 'literal'`       string inequality
 *   - `path == 123`             number equality
 *   - `path == true|false`      boolean equality
 *   - `path in ['a','b']`       membership
 *   - `!path`                   negation (truthy)
 *   - `path`                    truthy check
 *   - `path && expr`            conjunction
 *   - `path || expr`            disjunction
 *
 * Paths support dot notation: `data.type`, `data.config.kind`.
 *
 * On any parse error → returns `true` (fail-open): better to show a
 * field than to silently hide it.
 *
 * ## Unresolvable identifiers also fail OPEN (objectstack#6936)
 *
 * The fail-open promise above used to cover only *thrown* errors. A path whose
 * ROOT identifier does not exist in the evaluation scope took a different route:
 * `resolveValue` returned `undefined`, and then every comparison quietly judged
 * it false — `['text','number'].includes(undefined)`, `undefined === 'text'` —
 * so a predicate referencing a name that isn't there HID the field. Fail-CLOSED,
 * the exact opposite of what this header promised, and undiagnosable: the
 * symptom is "the config item is gone", with nothing in the console.
 *
 * That is not hypothetical. `@objectstack/spec` ≤ 17.0.0-rc.5 spells the
 * `objectForm` sub-field predicates bare (`type in ['text',…]`) while this
 * engine evaluates them against a `{ data: draftRow }` scope, so a frontend
 * upgraded ahead of its backend resolved `type` to nothing and 16 type-
 * conditional Studio sub-fields (Min / Max / Precision / Scale / Max Length /
 * Min Length / reference / deleteBehavior / expression / returnType /
 * autonumberFormat / language …) vanished at once. objectstack#6254 re-spells
 * them `data.type`; this evaluator must not turn the version-skew window into
 * silent feature loss.
 *
 * Maintainer ruling on objectstack#6936 (option C): an unresolvable path makes
 * the predicate evaluate `true`, and dev mode says so, naming the path and the
 * predicate that carried it.
 *
 * ### The boundary this draws — read before widening it
 *
 * "Unresolvable" means **the path's root identifier is not a name this scope
 * declares** (`type`, `record.status`, `page.selectedId` against a scope that
 * declares `data` plus the identity roots of {@link IDENTITY_ROOTS}). It does
 * NOT mean "the value came out undefined":
 *
 *   - `data.type == 'text'` on a draft that has no `type` yet → the root `data`
 *     resolves, the draft simply has no value there. That is a legitimate
 *     `undefined` VALUE, it compares false, and the field stays hidden. A draft
 *     is allowed to be empty; treating an unfilled field as "unresolvable"
 *     would show every type-conditional sub-field at once on a fresh row.
 *   - `data.tpye == 'text'` — a typo one segment deep — is indistinguishable
 *     from the above WITHOUT the schema, which this evaluator does not have.
 *     Catching that is the producer's job (publish-time validation of predicate
 *     path references, filed separately), not something the renderer may guess
 *     at. Commandment #0.1: one strict contract at the producer beats a
 *     renderer heuristic.
 *
 * The signal is a thrown {@link UnresolvedPathError}, deliberately not a
 * sentinel value: fail-open is a property of the WHOLE predicate, not of the
 * sub-expression that failed. A sentinel would have to be threaded through
 * `!`, `&&`, `||`, `in` and `==` by hand, and the first spot that missed it
 * would invert the verdict — `!unresolvedPath` would evaluate the inner path to
 * "true-ish" and then negate it back to false, i.e. fail-CLOSED again, which is
 * the bug. Throwing routes every failure to the one fail-open gate that already
 * exists.
 *
 * Two consequences of evaluating in CEL order, both pinned in `predicate.test.ts`:
 * `false && <unresolvable>` is `false` and `true || <unresolvable>` is `true` —
 * the unresolvable half is short-circuited away, absorbed exactly as CEL absorbs
 * an erroring branch, and no warning fires because nothing needed it.
 *
 * ## A path on the RIGHT of `==` / `!=` is a string literal (objectui#4049)
 *
 * Only the LEFT side resolves. The right side goes to `parseLiteral`, whose tail
 * hands back anything it does not recognise as a literal VERBATIM — so
 * `data.a == data.b` compares the value of `data.a` against the seven-character
 * string "data.b". It is FALSE however equal the two sides are, and
 * `data.a != data.b` is correspondingly TRUE. The subset list above is honest
 * about this (`path == 'literal'`, never `path == path`), but the boundary was
 * enforced by silence: objectstack#6936's warning cannot reach it, because that
 * one hangs on `resolveValue` and the right side never enters it.
 *
 * Ruling on objectui#4049: **option B only — a dev-mode diagnostic here, zero
 * semantic change.** Resolving the right side (option A) was rejected: it would
 * flip `data.type == text`, the unquoted-string spelling that works today by
 * accident, into a fail-open `true`. The verdicts stay bit-for-bit what they
 * were and are pinned that way in `predicate.test.ts` §7.3; all that changes is
 * that the console stops being silent about the subset boundary.
 *
 * The semantic fix belongs to the producer — publish-time validation of
 * predicate expressions (objectstack#7010) — and to the real CEL runtime: as the
 * header says, this file is an interim stand-in for `@objectstack/formula`, so
 * **this diagnostic retires with the file** when ROADMAP M9 lands CEL. Do not
 * grow it into a second evaluator.
 *
 * ## An unparseable element inside `in [...]` also fails silently (objectui#4266)
 *
 * `path in [...]` hands the bracketed text to `parseLiteral`'s array branch,
 * which JSON-parses it after normalising quotes. An element that is not a JSON
 * literal — a path, a bare identifier, a trailing comma — makes that
 * `JSON.parse` throw, and the `catch` returned `[]` with nothing in the
 * console. `[].includes(anything)` is `false`, so the predicate silently reads
 * FALSE FOR EVERY ROW, and — because the parse is whole-set, not per-element —
 * one bad element discards every good literal sitting next to it too:
 * `data.type in ['text', data.a]` collapsed exactly as hard as `data.type in
 * [data.a]` alone.
 *
 * Same family as objectui#4049 (silently wrong verdict, zero warning) and the
 * same ruling: **diagnose only, zero semantic change.** The `catch` still
 * returns `[]` — an `in` set that fails to parse is still, and remains, the
 * empty set — this file does not gain the ability to resolve a path inside
 * `in [...]` (that stays outside the declared subset; #4049 already draws
 * that boundary for the right side of `==`/`!=` and it is not reopened here).
 * All that changes is that the console names the predicate and, best-effort,
 * the element that broke the parse, instead of staying silent. Verdicts are
 * pinned identical before and after in `predicate.test.ts` §8.3, the same
 * shape as #4049's §7.3.
 *
 * A louder option — making the whole predicate throw so the top-level
 * fail-open in {@link evaluatePredicate} turns it `true`, mirroring
 * objectstack#6936's unresolved-path ruling — was considered and rejected:
 * objectstack#6936's `true` verdict corrects a fail-CLOSED bug (a hidden field is worse
 * than a shown one), but here the existing verdict (`false`, i.e. hidden) is
 * not a bug — it is the documented behaviour for a set this evaluator cannot
 * parse, same as `#4049`'s tail returning the right-hand text verbatim
 * instead of resolving it. Flipping it to fail-open `true` would be a
 * semantic change with no ruling behind it, and would make an authoring
 * mistake (a stray non-literal element) MORE visible than a correctly
 * authored predicate that legitimately evaluates false — exactly backwards.
 *
 * This diagnostic retires with the file at ROADMAP M9, same as #4049's.
 *
 * ## `in` with a PATH on the right never reaches the `in` branch (objectui#6617)
 *
 * The `in` branch matches `/^(.+?)\s+in\s+(\[.*\])$/` — the right side must be a
 * BRACKETED literal set. A membership test whose right side is a PATH therefore
 * does not match that branch at all. It carries no `==`/`!=` either, so it falls
 * all the way to the bare-truthy tail and the WHOLE text is handed to
 * `resolveValue` as one operand:
 *
 *   - `'admin' in current_user.positions` — ADR-0068's own headline example, and
 *     the spelling `SelectOptionSchema`'s docblock names as the canonical use of
 *     the key — leads with a quote, so `resolveValue`'s literal shortcut hands it
 *     to `parseLiteral`, whose quoted-string branch declines it (it starts with a
 *     quote but does not END with one) and whose tail returns it VERBATIM. A
 *     non-empty string is truthy ⇒ the predicate is TRUE for every user, whatever
 *     `positions` holds. Fail-OPEN: an option, field or section gated to admins
 *     renders for everyone.
 *   - `data.roles in current_user.positions` — path-shaped, so `resolveValue`
 *     splits it on dots into `data` / `roles in current_user` / `positions`, walks
 *     off the draft at the second segment and returns `undefined` ⇒ FALSE for
 *     every row instead.
 *
 * Either way the verdict has nothing to do with the membership that was written,
 * and — this is the part this section closes — it was SILENT. objectstack#6936's
 * warning cannot see the first shape (the root is never resolved at all: the text
 * begins with a quote, so it never enters `resolveValue`'s path branch) and
 * objectui#4049's `PATH_SHAPED_LITERAL` cannot either (it only matches text
 * starting with an identifier character, and this text starts with a quote).
 * Binding or not binding `current_user` cannot change any of it — the gap is a
 * property of the operator's GRAMMAR, not of which names the scope declares, so
 * it is not a regression from objectui#6247 and is measured identical before and
 * after it.
 *
 * Ruling on objectui#6617: **diagnose only, zero semantic change** — the third
 * time this file takes the posture #4049 and #4266 took, and for the third time
 * the reason is the same: the verdict is not corrected here, only the silence is.
 * The hook sits at the bare-truthy tail, AFTER the `in` branch has already
 * declined the text, and asks one question — does this text nonetheless carry a
 * top-level `in`? Nothing is resolved that was not resolved before, no operand
 * handling is added, and no expression that evaluates today reaches a different
 * answer (pinned in `predicate.test.ts` §9.3, the same shape as §7.3 and §8.3).
 * Resolving the right side of `in` is the widening the header's standing
 * constraint names — this file is an interim stand-in for `@objectstack/formula`
 * and retires at ROADMAP M9; do not grow it into a second evaluator — so it is
 * NOT done here, and the diagnostic says so plainly rather than implying that
 * some other punctuation would work.
 *
 * ### Why the detection must be quote-aware, and why it reuses `splitTopLevel`
 *
 * ⚠️ A naive `expr.includes(' in ')` is WRONG. A predicate that is itself a bare
 * quoted literal containing the word — `'plug in adapter'` — is CORRECT code
 * (a non-empty string literal, truthy), and announcing it as a broken membership
 * test would be a false statement about the author's code: the exact failure the
 * `PATH_SHAPED_LITERAL` note refuses to commit. So the scan is `splitTopLevel`'s
 * existing `inStr`/`depth` walk, REUSED rather than rewritten — the same walk the
 * `&&`/`||` splitters and `findUnparseableSetElement` already trust — with `' in '`
 * as the operator. Inside a quoted run it never even tests the operator, so a
 * quoted literal cannot false-positive, and that reuse is also what keeps this a
 * DETECTION rather than a second parser.
 *
 * The argument that there is no other false positive is short: an expression that
 * reaches the bare-truthy tail and is CORRECT is either a path (no spaces are
 * possible in one) or a literal — and the only literal that can contain `' in '`
 * is a quoted string, which the `inStr` walk protects. So every remaining hit is
 * either a membership test this evaluator cannot run, or text that is not a valid
 * predicate at all.
 *
 * Two spellings are deliberately NOT detected, and both fail to SILENCE (the
 * status quo) rather than to a false claim: a tab-separated `in`, and a
 * parenthesised `('admin' in current_user.positions)` where the operator sits at
 * `depth > 0`. Widening the walk to reach them would mean teaching it about
 * whitespace classes and parentheses the evaluator itself does not support —
 * growing the parser to improve a warning, which is the trade this file does not
 * make.
 *
 * This diagnostic retires with the file at ROADMAP M9, same as #4049's and
 * #4266's.
 */

/**
 * The evaluation scope this surface publishes.
 *
 * `data` is ALWAYS the current draft. The index signature carries the extra
 * roots {@link buildPredicateCtx} binds — today exactly {@link IDENTITY_ROOTS}.
 *
 * ⚠️ Read {@link buildPredicateCtx} before adding a root here. A root that is
 * bound is a root that no longer warns, so widening this bag silently converts
 * a loud diagnostic into a silent `undefined`-compares-false.
 */
export interface PredicateCtx {
  /** The current draft. Never the host provider's own `data` scope. */
  data: Record<string, unknown>;
  [root: string]: unknown;
}

/**
 * The identity spellings this surface binds, ADR-0068 D1 (objectui#6247).
 *
 * ONE user object under four names: the canonical `current_user`, the
 * back-compat `user`, the server-RLS-parity `ctx.user` and the server-CEL-parity
 * `os.user`. They are not four dialects — they are the four spellings
 * `buildExpressionScope` (`providers/ExpressionProvider.tsx`) already publishes
 * for the same object, restated here as a SELECTION from that bag rather than a
 * copy of it, so the alias set cannot drift from the one builder.
 *
 * ## What is deliberately NOT here — the whole of Fork A's ruling
 *
 * - ⛔ `data`. The host provider's bag also carries a `data` key, and it means
 *   the provider's data scope, NOT this form's draft. Adopting it head-on would
 *   be objectui#5926 gap 2's "same key, opposite meanings" — one authored
 *   `data.viewKind` reaching two different objects one nesting level apart. The
 *   2026-08-25/27 maintainer ruling (A2, affirmed three times on objectui#6247)
 *   binds the identity roots ALONGSIDE `data` and keeps `data` = the draft.
 * - ⛔ `record`. The sibling runtime surface binds it because it edits a data
 *   RECORD; metadata-admin edits source metadata and has no record. Leaving it
 *   unbound is what keeps `record.status` a loud diagnostic here instead of a
 *   silent false — `predicate.test.ts` pins that.
 * - ⛔ `app` / `features`. `features` is renderer-tier, not ADR-0068 identity,
 *   and not named by the ruling; `app` is not a root at ANY tier since
 *   objectui#8155 unbound it. Binding either as an empty object would turn
 *   `app.x` from a loud unresolved-root warning into a silent `undefined`.
 */
export const IDENTITY_ROOTS = ['current_user', 'user', 'ctx', 'os'] as const;

/**
 * Build the scope a metadata-admin predicate evaluates against: the draft under
 * `data`, plus whichever of {@link IDENTITY_ROOTS} the host shell published.
 *
 * `hostScope` is `usePredicateScope()` (`@object-ui/react`) — the SAME bag the
 * sibling runtime form surface reads, so one authored `visibleWhen` text names
 * the same identity object on both. Roots the host did not publish stay ABSENT
 * rather than being bound to `{}`: absent is what raises
 * {@link UnresolvedPathError} and produces the loud diagnostic, and a gate that
 * cannot resolve its identity must say so, not quietly answer "no".
 *
 * `data` is assigned LAST and unconditionally, so no host key can displace the
 * draft even if the provider's bag grows one.
 */
export function buildPredicateCtx(
  draft: Record<string, unknown> | undefined,
  hostScope?: Record<string, unknown>,
): PredicateCtx {
  const ctx: PredicateCtx = { data: draft ?? {} };
  if (hostScope) {
    for (const root of IDENTITY_ROOTS) {
      if (Object.prototype.hasOwnProperty.call(hostScope, root)) ctx[root] = hostScope[root];
    }
  }
  ctx.data = draft ?? {};
  return ctx;
}

/**
 * Is this select option offered? — the ONE reader of
 * `SelectOptionSchema.visibleWhen` on this surface (objectui#6247).
 *
 * Routes through {@link evaluatePredicate}, the same evaluator the section,
 * field and repeater-row gates use. Deliberately NOT a local predicate check
 * bolted onto each option mapping: objectui#5926 gap 2 is the record of what a
 * second dialect costs, and this surface is already the third evaluator in the
 * platform — a fourth was ruled out.
 *
 * No predicate → offered, which is the same "absent means yes" every other gate
 * on this surface uses.
 */
export function isOptionVisible(
  opt: { visibleWhen?: string | { dialect?: string; source: string } },
  ctx: PredicateCtx,
): boolean {
  return evaluatePredicate(opt.visibleWhen, ctx);
}

/**
 * The rendered subset of an authored option list.
 *
 * ⚠️ This is the CONTENT half only. Per the Fork B ruling (B1) the control's
 * FACE — `resolveFieldFace`'s `hasOptions`, `resolveColorWidgetKey`, and each
 * `options.length > 0` branch condition — keeps reading the RAW list, so
 * withdrawing every option renders an EMPTY PICKER rather than flipping the
 * field to a free-text input or to a different widget registration. Call this
 * where the list is mapped to items, never where the branch is chosen.
 */
export function visibleOptions<T extends { visibleWhen?: string | { dialect?: string; source: string } }>(
  options: readonly T[],
  ctx: PredicateCtx,
): T[] {
  return options.filter((o) => isOptionVisible(o, ctx));
}

export function evaluatePredicate(
  expr: string | { dialect?: string; source: string } | null | undefined,
  ctx: PredicateCtx,
): boolean {
  if (expr == null) return true;
  const source = typeof expr === 'string' ? expr : expr.source;
  if (!source) return true;
  try {
    return evalExpr(source.trim(), ctx, source);
  } catch (err) {
    // Fail-open either way; an unresolvable path additionally gets a name.
    if (err instanceof UnresolvedPathError) warnUnresolvedPath(err.path, source, ctx);
    return true;
  }
}

/**
 * Signalled when a path's root identifier is not a name in the evaluation
 * scope. Carries the path so the top-level handler can name it alongside the
 * predicate source (which only the top level knows).
 */
class UnresolvedPathError extends Error {
  constructor(readonly path: string) {
    super(`unresolved predicate path: ${path}`);
    this.name = 'UnresolvedPathError';
  }
}

// Warn once per (path, predicate) pair, not once per evaluation: these
// predicates run on every keystroke of the form they gate, and a warning that
// floods the console is a warning that gets muted. Keyed by the predicate
// source as well as the path, deliberately — keying on the path alone would
// report the FIRST predicate referencing `type` and stay silent about the other
// fifteen, sending the author to fix one row of a systemic problem. Mirrors
// `warnOnUnknownActionKeys` in `@object-ui/core` (`actions/actionKeys.ts`).
const warnedUnresolvedPaths = new Set<string>();

/**
 * The same warn-once discipline for the right-hand-literal diagnostic
 * (objectui#4049), keyed on (right-hand text, predicate) for the same reason:
 * keyed on the text alone, a form with fifteen predicates comparing against
 * `data.b` would report one of them and hide the rest.
 */
const warnedPathShapedLiterals = new Set<string>();

/**
 * The same warn-once discipline for the `in`-array parse-failure diagnostic
 * (objectui#4266), keyed on (raw set text, predicate) for the same reason as
 * the two Sets above: keying on the set text alone would report the first
 * predicate carrying it and stay silent about a sibling predicate that
 * happens to spell the same broken set.
 */
const warnedUnparseableInSets = new Set<string>();

/**
 * The same warn-once discipline for the `in`-without-a-literal-set diagnostic
 * (objectui#6617), keyed on (the sub-expression that carried the top-level `in`,
 * predicate) for the same reason as the three Sets above: keying on the
 * sub-expression alone would report the first predicate spelling it and stay
 * silent about every sibling gate that spells the same membership test.
 */
const warnedInWithoutLiteralSet = new Set<string>();

/** Reset the warn-once memos. Exported for tests. */
export function resetPredicateWarnings(): void {
  warnedUnresolvedPaths.clear();
  warnedPathShapedLiterals.clear();
  warnedUnparseableInSets.clear();
  warnedInWithoutLiteralSet.clear();
}

const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV !==
  'production';

function warnUnresolvedPath(path: string, source: string, ctx: PredicateCtx): void {
  if (!isDev()) return;
  const memo = `${path}::${source}`;
  if (warnedUnresolvedPaths.has(memo)) return;
  warnedUnresolvedPaths.add(memo);
  const root = path.split('.')[0];
  // The bound names are READ OFF THE ACTUAL SCOPE, never restated as a literal.
  // They differ between call sites — the identity roots are present only where a
  // host `ExpressionProvider` published them (objectui#6247) — and a hardcoded
  // list would be a diagnostic that lies in whichever world it was not written
  // for. A wrong "the only name is X" is worse than no diagnostic: it sends the
  // author to un-write a spelling that is in fact correct.
  const bound = Object.keys(ctx).sort().map((n) => `\`${n}\``).join(', ');
  console.warn(
    `[metadata-admin] visibility predicate \`${source}\` references \`${path}\`, but \`${root}\` ` +
      `is not a name in this form's evaluation scope — the names here are ${bound} ` +
      '(`data` is the current draft; the identity roots are bound only under a host ' +
      '`ExpressionProvider`). The predicate was treated as TRUE (fail-open) so the field stays ' +
      'visible instead of disappearing without a trace; check the spelling — draft values are ' +
      'addressed as `data.<field>` (e.g. `data.type in [...]`) and the signed-in user as ' +
      '`current_user.<field>`. A predicate served by an older backend is the usual cause ' +
      '(objectstack#6254 re-spelled the bare `objectForm` predicates; objectstack#6936).',
  );
}

/**
 * The identifier grammar the LEFT side accepts: a root identifier followed by
 * dot-separated segments (`text`, `data.type`, `data.config.kind`) — i.e. the
 * shape `resolveValue` would have resolved had this text been on the other side
 * of the operator.
 *
 * Deliberately NOT "contains a dot". `1.2.3` also reaches `parseLiteral`'s tail
 * (via the digit-leading literal shortcut in `resolveValue`) and is likewise
 * compared as text, but it is a malformed NUMBER, not a path; announcing it as
 * a path would be a false statement about the author's code. Quoted strings,
 * numbers, booleans, null and arrays never reach the tail at all — they return
 * from their own branches above.
 */
const PATH_SHAPED_LITERAL = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

function warnPathShapedLiteral(text: string, source: string): void {
  if (!isDev()) return;
  const memo = `${text}::${source}`;
  if (warnedPathShapedLiterals.has(memo)) return;
  warnedPathShapedLiterals.add(memo);
  console.warn(
    `[metadata-admin] visibility predicate \`${source}\` compares against \`${text}\`, which looks ` +
      `like a path but is being used as the literal string "${text}" — this evaluator resolves ` +
      'paths only on the LEFT of `==` / `!=`; the right-hand side is always a literal (supported ' +
      "subset: `path == 'literal'`). So `data.a == data.b` is FALSE even when both sides hold the " +
      'same value, and `data.a != data.b` is TRUE — the verdict does not depend on the right-hand ' +
      "path at all. If you meant the text, quote it (`== 'text'`). If you meant to compare two " +
      'paths, that is outside this evaluator\'s subset: it is an interim stand-in for ' +
      '`@objectstack/formula` until CEL lands (ROADMAP M9), and predicate expressions are ' +
      'validated at publish time (objectstack#7010). objectui#4049.',
  );
}

/**
 * Best-effort identification of WHICH element inside an unparseable `in [...]`
 * set actually broke the parse — for the warning text only, never to change
 * the return value. Splits on top-level commas (reusing `splitTopLevel`,
 * which already tracks bracket depth and quotes for the `&&`/`||` splitters
 * above) and re-runs the exact same quote-normalising `JSON.parse` the array
 * branch itself uses, one element at a time, so the reported culprit is
 * judged by literally the same rule that judged the whole set. Returns `null`
 * when every individual element parses fine on its own (e.g. a stray trailing
 * comma broke the whole-string parse but no single element is at fault) —
 * the warning then falls back to naming the whole set.
 */
function findUnparseableSetElement(raw: string): string | null {
  const inner = raw.slice(1, -1);
  if (!inner.trim()) return null;
  for (const part of splitTopLevel(inner, ',')) {
    const el = part.trim();
    if (!el) continue;
    try {
      const json = el.replace(/'([^']*)'/g, (_, innerStr) => JSON.stringify(innerStr));
      JSON.parse(json);
    } catch {
      return el;
    }
  }
  return null;
}

function warnUnparseableInSet(raw: string, source: string): void {
  if (!isDev()) return;
  const memo = `${raw}::${source}`;
  if (warnedUnparseableInSets.has(memo)) return;
  warnedUnparseableInSets.add(memo);
  const element = findUnparseableSetElement(raw);
  console.warn(
    `[metadata-admin] visibility predicate \`${source}\` has an \`in\` set \`${raw}\`` +
      (element != null
        ? ` containing \`${element}\`, which is not a literal this evaluator can parse — `
        : ', which this evaluator could not parse — ') +
      'the WHOLE set was treated as EMPTY, so the predicate is FALSE for every row (not just the ' +
      'element that failed — one bad element discards the good literals next to it too). This ' +
      "evaluator only supports literal elements inside `in [...]` (supported subset: `path in " +
      "['a','b']`); it does not resolve paths there — paths resolve only on the LEFT of an operator " +
      '(objectui#4049). If you meant a literal, quote it. If you meant to test membership against ' +
      "another field, that is outside this evaluator's subset: it is an interim stand-in for " +
      '`@objectstack/formula` until CEL lands (ROADMAP M9), and predicate expressions are validated ' +
      'at publish time (objectstack#7010). objectui#4266.',
  );
}

/**
 * The operator spelling this detection looks for. Both boundaries are part of
 * the token on purpose: `' in'` alone would also match the leading three
 * characters of `' integer'`, and `'in '` the trailing three of `'begin '` —
 * either would be the false claim about correct code this diagnostic exists to
 * avoid.
 */
const IN_OPERATOR = ' in ';

/**
 * Does this text carry a top-level `in` that the `in` branch already declined?
 *
 * ⚠️ Quote-aware BY REUSE, never by a second scan: {@link splitTopLevel} is the
 * same `inStr`/`depth` walk the `&&` / `||` splitters and
 * {@link findUnparseableSetElement} already run, so a bare quoted literal that
 * happens to contain the word (`'plug in adapter'` — correct code, a truthy
 * string) is inside a quoted run when the operator would be tested and is never
 * tested at all. A hand-rolled `expr.includes(' in ')` would report it as broken
 * and send the author to un-write a spelling that is in fact fine; see the
 * header section on why this stays a detection rather than becoming a parser.
 *
 * Returns false for the two spellings the reused walk cannot see — a
 * tab-separated `in`, and one nested at `depth > 0` inside parentheses. Both are
 * misses, i.e. silence, which is the pre-existing behaviour; neither is a false
 * statement about the author's code.
 */
function carriesTopLevelIn(expr: string): boolean {
  return splitTopLevel(expr, IN_OPERATOR).length > 1;
}

function warnInWithoutLiteralSet(expr: string, source: string): void {
  if (!isDev()) return;
  const memo = `${expr}::${source}`;
  if (warnedInWithoutLiteralSet.has(memo)) return;
  warnedInWithoutLiteralSet.add(memo);
  console.warn(
    `[metadata-admin] visibility predicate \`${source}\` spells a membership test \`${expr}\` whose ` +
      'right-hand side is not a bracketed literal set. This evaluator matches `in` ONLY against a ' +
      "bracketed set of literals (supported subset: `path in ['a','b']`), so this text was never " +
      'treated as a membership test at all — it fell through every operator branch to a BARE TRUTHY ' +
      'check of the whole string, and the verdict has nothing to do with the membership that was ' +
      "written. With a quoted left side — ADR-0068's own headline example `'admin' in " +
      'current_user.positions` — the whole text comes back verbatim as a non-empty string, so the ' +
      'predicate reads TRUE for EVERY user and a gate meant for admins is open to everyone; with a ' +
      'path-shaped left side it reads FALSE for every row instead. There is no working spelling of ' +
      'this form on this surface: a path on the RIGHT of `in` CANNOT be written here today. Paths ' +
      'resolve only on the LEFT of an operator (objectui#4049) and the right of `in` must be a ' +
      'literal set spelled out in the predicate itself, so testing membership against a value the ' +
      "draft or the signed-in user holds is outside this evaluator's subset and cannot be expressed " +
      '— not with different punctuation, not with a different spelling, not at all. This evaluator ' +
      'is an interim stand-in for `@objectstack/formula` until CEL lands (ROADMAP M9), and predicate ' +
      'expressions are validated at publish time (objectstack#7010). objectui#6617.',
  );
}

function evalExpr(
  expr: string,
  ctx: PredicateCtx,
  // The WHOLE predicate, threaded down unchanged so a diagnostic raised deep in
  // a sub-expression can name the predicate the author actually wrote — the
  // same pairing objectstack#6936's warning makes via UnresolvedPathError.
  source: string,
): boolean {
  // Handle || (lowest precedence)
  const orParts = splitTopLevel(expr, '||');
  if (orParts.length > 1) {
    return orParts.some((p) => evalExpr(p.trim(), ctx, source));
  }
  // Handle &&
  const andParts = splitTopLevel(expr, '&&');
  if (andParts.length > 1) {
    return andParts.every((p) => evalExpr(p.trim(), ctx, source));
  }
  // Handle negation
  if (expr.startsWith('!')) {
    return !evalExpr(expr.slice(1).trim(), ctx, source);
  }
  // Handle 'in'
  const inMatch = expr.match(/^(.+?)\s+in\s+(\[.*\])$/);
  if (inMatch) {
    const left = resolveValue(inMatch[1].trim(), ctx, source);
    const right = parseLiteral(inMatch[2], source);
    return Array.isArray(right) && right.includes(left as never);
  }
  // Handle == / != (CEL-style loose equality: null == undefined)
  const eqMatch = expr.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
  if (eqMatch) {
    const left = resolveValue(eqMatch[1].trim(), ctx, source);
    const right = parseLiteral(eqMatch[3].trim(), source);
    const nullish = (v: unknown) => v === null || v === undefined;
    const equal = nullish(left) && nullish(right) ? true : left === right;
    return eqMatch[2] === '==' ? equal : !equal;
  }
  // Bare truthy check.
  //
  // objectui#6617: the `in` branch above has already DECLINED this text — its
  // right side is not a bracketed literal set — and yet the text may still carry
  // a top-level `in`, in which case what follows evaluates the whole membership
  // spelling as one bare operand and the verdict is unrelated to it. Diagnose
  // that here, where the decline is already a fact.
  //
  // Placed BEFORE `resolveValue` deliberately: the operand may be unresolvable
  // (`type in current_user.positions`), and from inside the throw this line is
  // never reached again. An unbound root therefore raises objectstack#6936's
  // warning as well — both statements are true, and neither is the other's
  // cause. The call cannot alter the verdict: it returns void, touches only its
  // own memo Set, and `splitTopLevel` cannot throw on a string.
  if (carriesTopLevelIn(expr)) warnInWithoutLiteralSet(expr, source);
  return Boolean(resolveValue(expr, ctx, source));
}

function splitTopLevel(expr: string, op: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let buf = '';
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      buf += ch;
      if (ch === inStr && expr[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (
      depth === 0 &&
      expr.slice(i, i + op.length) === op &&
      // Not a sub-operator (e.g. == when looking for =)
      expr[i + op.length] !== '='
    ) {
      out.push(buf);
      buf = '';
      i += op.length - 1;
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function resolveValue(
  path: string,
  ctx: PredicateCtx,
  source: string,
): unknown {
  // Allow literals on the left side too.
  if (/^['"]/.test(path) || /^-?\d/.test(path) || path === 'true' || path === 'false' || path === 'null') {
    return parseLiteral(path, source);
  }
  const segs = path.split('.');
  // The root identifier must be a name the scope actually declares. `hasOwn`,
  // not `in`: `constructor`/`toString` are inherited, and resolving them to
  // `Object`'s members would compare a function against a string literal (false,
  // silently) instead of reporting a path the author cannot have meant.
  if (!Object.prototype.hasOwnProperty.call(ctx, segs[0])) {
    throw new UnresolvedPathError(path);
  }
  let cur: any = ctx;
  for (const seg of segs) {
    // A nullish value part-way down is a VALUE fact, not a resolution failure:
    // `data.config.kind` on a draft with no `config` means the draft has no
    // value there, which compares false. See the header's boundary note.
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function parseLiteral(raw: string, source: string): unknown {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    return s.slice(1, -1);
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      // JSON-parse after normalising single-quoted strings to double.
      const json = s.replace(/'([^']*)'/g, (_, inner) => JSON.stringify(inner));
      return JSON.parse(json);
    } catch {
      // Whole-set parse failure (a non-literal element, a trailing comma, …).
      // Diagnose only (objectui#4266) — the verdict is UNTOUCHED: the set is
      // still `[]`, `in` is still false for every row. See the header section
      // "An unparseable element inside `in [...]` also fails silently".
      warnUnparseableInSet(s, source);
      return [];
    }
  }
  // The tail: `s` is not a literal this evaluator recognises, so it is handed
  // back as itself and compared as text. Every route to this line carries the
  // diagnostic (objectui#4049) — the right side of `==` / `!=`, and the
  // digit-leading literal shortcut in `resolveValue` used by `in`'s left side,
  // a bare truthy check and the left of `==`. NOTE the verdict is untouched:
  // `s` is still returned verbatim, exactly as before.
  if (PATH_SHAPED_LITERAL.test(s)) warnPathShapedLiteral(s, source);
  return s;
}
