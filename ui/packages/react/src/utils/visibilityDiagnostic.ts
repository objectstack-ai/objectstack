/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Diagnostic: a node-gate predicate could not be evaluated (objectui#5454,
 * leg 3 of the 2026-08-21 ruling; production coverage added by objectui#6038,
 * maintainer ruling 2026-08-25 option B; the `disabled` / `disabledOn` gate
 * added by objectui#6445).
 *
 * ## The defect this names
 *
 * `SchemaRenderer`'s visibility chain is FAIL-SOFT: `evaluateCondition` answers
 * an unevaluable predicate with `true`. On the negated legs (`visible` /
 * `visibleWhen` / `visibleOn`) that `true` means SHOWN — so "this
 * predicate is broken" and "this predicate said yes" reach the screen as the
 * same pixel. An author who mistyped a root, or who wrote a `record.*` gate
 * before objectui#5454 bound the row, saw their block render and had no signal
 * at all that the gate had not been consulted.
 *
 * One of the three evaluation paths was already loud — a `{ dialect: 'cel' }`
 * envelope routes to `evalFieldPredicate`, which warns (objectstack#5149). The
 * bare-expression and `${…}` template paths were mute. So whether an author
 * heard about their own typo depended on which dialect they happened to write
 * it in, which is the arbitrariness this module removes.
 *
 * ## What it deliberately does NOT do
 *
 * It changes NO verdict. `evaluateCondition` already returned `true` for every
 * unevaluable predicate on every one of its paths, and the caller reproduces
 * exactly that from its catch — including on the two NON-negated legs
 * (`hidden` / `hiddenOn`), where the same `true` means HIDE — and, since
 * objectui#6445, on the `disabled` / `disabledOn` gate, where it means GREYED
 * OUT. Flipping fail-soft to fail-closed is a shipped-behaviour change tracked
 * separately upstream (objectstack#5149, appeal 1, undecided); this module is
 * the diagnostic half only, on every gate wired to it.
 *
 * ## Why a separate module
 *
 * Same reason as `unevaluatedExpression.ts` next door: exporting non-components
 * from the module that exports `SchemaRenderer` breaks Fast Refresh
 * (`react-refresh/only-export-components`), and a format/emit split lets the
 * pins assert the words a developer will actually read rather than that a spy
 * was called — a diagnostic whose only test is the latter goes green the moment
 * someone no-ops it.
 */

/**
 * Prefix every diagnostic line starts with. Exported so tests can match on it
 * and so an app can filter it out of its console transport if it must.
 */
export const UNRESOLVABLE_VISIBILITY_PREFIX =
  '[ObjectUI] A visibility predicate could not be evaluated';

/**
 * The same opening line for the ENABLEMENT gate (`disabled` / `disabledOn`,
 * objectui#6445). A sibling constant rather than a widened one: the six
 * visibility legs keep the bytes they ship today (objectui#6487 pinned them),
 * and calling a `disabled` predicate a "visibility predicate" would send an
 * author to the wrong gate on the first line - the one line a console filter
 * and a `grep` both read.
 *
 * Same posture as its sibling in every other respect: same reporter, same
 * severity, same dedupe `Set`, same key shape, same test-only reset. Only the
 * words that would be FALSE on this gate differ.
 */
export const UNRESOLVABLE_ENABLEMENT_PREFIX =
  '[ObjectUI] An enablement predicate could not be evaluated';

/** The raw predicate as an author would recognise it, envelope or not. */
function predicateSourceText(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const source = (raw as { source?: unknown }).source;
    if (typeof source === 'string') return source;
  }
  return typeof raw === 'string' ? raw : String(raw);
}

/**
 * Which SCOPE the faulting predicate was evaluated against (objectui#6487).
 *
 * ## Why the reporter needs to be told, rather than deducing it
 *
 * The closing paragraph of the message names the ROOTS an author can bind. That
 * is the half of the report an author acts on: a fault is usually a mistyped or
 * unbound root, and "which roots exist here" is the answer. It is therefore the
 * one part of the copy that is NOT true on every surface — the callers below
 * build genuinely different bags — and it was printed unconditionally in the
 * node tier's spelling, so an app-shell author was sent to check `record` and
 * `page.<var>`, which nothing at that tier binds.
 *
 * The alternative fix — generalising the copy to "whatever this surface binds"
 * plus a docs link — was refused deliberately: the concrete root names are the
 * whole value of the paragraph, and advice that names no roots is correct
 * everywhere and useful nowhere.
 *
 * Deducing the tier from the `type` slot was refused too. `type` carries the
 * SCHEMA NODE TYPE at the node tier and a surface label at the other two
 * (`page:tabs`, `app-shell:visible`), and `page:tabs` is a real registry key —
 * so a `page:tabs` NODE faulting its own `visibleWhen` inside `SchemaRenderer`
 * is indistinguishable, by `type` alone, from one of its ITEM predicates. An
 * explicit argument cannot collide that way.
 *
 * ## The tiers, each derived from the code that builds the bag
 *
 * `'page-component'` — the node gate. `SchemaRenderer.tsx` builds
 * `new ExpressionEvaluator({ ...predicateScope, current_user, [record], data,
 * page })`, so the roots the SPEC declares for the tier (`ui/page.zod.ts`:
 * *"Binds `record`, `current_user`, `page.<var>`"*) are the roots it binds.
 * `page:tabs` ITEM predicates (`containers.tsx`) are this tier as well: they
 * build the same three roots (plus the row spread flat, and `data` aliased to
 * the row rather than to the adapter — both undeclared breadth that the spec
 * does not promise and this paragraph therefore does not advertise).
 *
 * `'app-shell'` — the chrome gate. `ExpressionProvider.tsx` builds
 * `{ current_user, user, ctx: { user }, os: { user }, features }`.
 * There is no `record` and no `page` in it at all, which is the defect this
 * type exists to fix. The four identity spellings are the ADR-0068 aliases and
 * all four resolve; `features` is the deployment-flag root that provider's own
 * docblock documents for exactly this kind of predicate.
 *
 * ⛔ No `app`. It was in that bag and in the paragraph below until
 * objectui#8155 (ruled 2026-09-07): neither ADR-0068 nor
 * `@objectstack/formula`'s `SCOPE_ROOTS` declares such a root, so
 * `buildExpressionScope` stopped binding it. Naming it here would be worse
 * than stale — this paragraph is printed at the exact moment a saved `app.*`
 * predicate faults, so it would answer "why did my predicate not resolve?"
 * with the root that is the reason.
 *
 * ⛔ No `data` either, since objectui#8166 (ruled 2026-09-10). It WAS bound at
 * the app-shell tier and was already withheld from the paragraph below, on the
 * grounds that every `ExpressionProvider` mount passes `data={{}}` — but
 * `AppContent`'s own field-list evaluator passed the record under edit, so on
 * that one leg an authored `data.*` resolved silently against the host's record
 * instead of faulting. `buildExpressionScope` stopped binding it; a `data.*`
 * predicate at this tier now reaches this reporter with the engine's
 * `Unknown variable: data`, the same verdict the server gives it.
 */
export type PredicateScopeTier = 'page-component' | 'app-shell';

/**
 * The closing paragraph, per tier. The ONLY part of the message that varies —
 * everything above it (the node, the key, the source, the engine's reason, and
 * the "gate did NOT bite" sentence) is true on every surface wired to this
 * reporter, including the fail-open app-shell gate.
 *
 * Both entries end on the same sentence on purpose: whichever tier an author is
 * on, the two things to check are the roots and the CEL syntax.
 *
 * Indexed WITHOUT a `??` fallback to the node tier, deliberately (AGENTS.md
 * #0.1). A tier this table does not answer is a type violation, and quietly
 * substituting the node tier's paragraph for it would reproduce, one caller
 * further along, the exact defect this card fixes: confident advice about a
 * scope the predicate was never evaluated against. The default lives on the
 * PARAMETER, where it is a stated compatibility choice, not in the lookup.
 */
const SCOPE_TIER_ADVICE: Record<PredicateScopeTier, string> = {
  'page-component':
    'Page-component predicates bind `record` (the row on a record page),\n' +
    '`current_user`, and page state as `page.<var>`. Check those roots and the\n' +
    'CEL syntax.',
  'app-shell':
    'App-shell predicates bind `current_user` - also spelled `user`, `ctx.user`\n' +
    'and `os.user` - plus `features` (the deployment flags).\n' +
    'Neither `record` nor `page.<var>` exists at this tier.\n' +
    'Check those roots and the CEL syntax.',
};

/**
 * WHICH GATE the faulting predicate was authored on (objectui#6445).
 *
 * ## Why the reporter has to be told, when it already prints the key
 *
 * `evaluateCondition` answers an unevaluable predicate with `true` on every one
 * of its paths, and every caller reproduces that answer. What that `true` DOES
 * to the node is not a property of the predicate - it is a property of the gate
 * it was authored on, and the consequence paragraph has to say which:
 *
 * `'visibility'` - the visibility chain. Its `true` means SHOWN on the
 * negated legs, so the safe default does NOT bite: a predicate that could not be
 * evaluated reads on screen exactly like one that said yes, which is why the
 * console line is the only signal an author gets.
 *
 * `'enablement'` - `disabled` / `disabledOn`. The SAME `true` GREYS THE CONTROL
 * OUT, so here the safe default is the one that BITES. The author is looking at
 * a control they can see and cannot use; telling them the gate did not bite
 * would be the opposite of what is on their screen, and would send them looking
 * for a rendering bug rather than at their own predicate.
 *
 * ## Why a parameter, and not deduced from `key`
 *
 * Same reason {@link PredicateScopeTier} is a parameter (read its docblock): the
 * caller knows, and a deduction is a table that goes quietly wrong the moment a
 * spelling arrives that it has not heard of - a new alias, or a caller outside
 * this repo - which would inherit a consequence sentence written about some
 * other gate. That is the exact defect class this card and objectui#6487 both
 * exist to remove, so it is not worth re-introducing to save an argument.
 *
 * `'concealment'` - `hidden` / `hiddenOn` (objectui#6503). These are visibility
 * legs, but the only two whose verdict `SchemaRenderer` does NOT negate, so the
 * SAME `true` that SHOWS a node on the four negated legs REMOVES it here. They
 * resolved to `'visibility'` until objectui#6503 and were therefore handed the
 * one sentence that is false about them: the gate did not merely bite, it bit
 * hardest of the three, and the node is not on screen to be inspected at all.
 * This is the third member objectui#6445's docblock predicted, in the shape it
 * predicted - a table entry and a routing decision, no signature change.
 *
 * ## Why a third MEMBER, and not `'visibility'` plus a `negated` flag
 *
 * What varies is the consequence sentence, and it varies per GATE - not along
 * an independent axis a caller could set to contradict the gate it passed
 * alongside. Three flat members cannot be spelled inconsistently; a
 * `(kind, negated)` pair can, and `('enablement', negated: true)` would name a
 * combination no renderer in this repo produces. The table stays the one place
 * that decides what a fail-soft default DID.
 *
 * ## What widening this union costs, stated because it is a published surface
 *
 * `PredicateGateKind` is re-exported from `packages/react/src/index.ts` - the
 * package entry, and the chain stops there (no sibling package re-exports it,
 * and no file outside `packages/react` names it). A consumer switching
 * EXHAUSTIVELY over the union, or holding a `Record<PredicateGateKind, ...>`,
 * gains a case to answer. That is a type-level change only: no runtime
 * signature moved, and every value that was accepted before still is.
 *
 * `'withholding'` - a visibility predicate whose FAULT is answered
 * fail-CLOSED: the element it gates is withheld - not drawn - instead of being
 * drawn for everyone. Three gates report through it:
 *
 * - the app-shell's navigation `visible` gate (objectui#12700), whose usual
 *   fault is a `current_user.can(...)` asked before the permissions payload is
 *   there;
 * - the `page:tabs` item `visibleWhen` gate (objectui#13286);
 * - a page node's `visibleWhen` / `visible` / `visibleOn` (objectui#13299), for
 *   a DECLARED predicate - a blank gate still means "no gate" and still prints
 *   `'visibility'`.
 *
 * So the default BITES, and the sentence `'visibility'` prints - "reads on
 * screen exactly like one that said yes" - would be the opposite of what the
 * author sees. The paragraph calls the withheld thing "an element" because one
 * paragraph serves all three, and a noun for one surface is false on the other
 * two (objectui#13303). Same opening line as `'visibility'`, for the same
 * reason `'concealment'` keeps it.
 */
export type PredicateGateKind = 'visibility' | 'enablement' | 'concealment' | 'withholding';

/**
 * The two parts of the message that vary with the gate: the opening line (what
 * KIND of predicate failed) and the consequence paragraph (what the fail-soft
 * default DID to the node). Everything between them - the node, the key, the
 * source, the engine's reason - and the scope advice after them are true on
 * every gate.
 *
 * Indexed WITHOUT a `??` fallback, for the same reason {@link SCOPE_TIER_ADVICE}
 * is: quietly substituting one gate's consequence for another's IS the defect
 * being fixed here, and doing it at the lookup would only move it one caller
 * further along. The default lives on the PARAMETER, where it is a stated
 * compatibility choice.
 */
const GATE_KIND_COPY: Record<PredicateGateKind, { prefix: string; consequence: string }> = {
  visibility: {
    prefix: UNRESOLVABLE_VISIBILITY_PREFIX,
    consequence:
      'The node was treated as its safe default, which on this surface means the\n' +
      'gate did NOT bite - a predicate that cannot be evaluated reads on screen\n' +
      'exactly like one that said yes.\n',
  },
  // The two NON-negated visibility legs (objectui#6503). SAME opening line as
  // `visibility` above, deliberately: these ARE visibility predicates, the six
  // legs of that chain keep the bytes objectui#6487 pinned, and an app - or a
  // test - filtering the console by `UNRESOLVABLE_VISIBILITY_PREFIX` has to go
  // on catching them. objectui#6038's pin that the `hidden` leg reports AT ALL
  // reads through exactly that filter, and it must stay green: this card moves
  // the sentence that was false for these legs, and nothing else.
  concealment: {
    prefix: UNRESOLVABLE_VISIBILITY_PREFIX,
    consequence:
      'The node was treated as its safe default, which on THIS leg is the one\n' +
      'that BITES: `hidden` / `hiddenOn` are NOT negated, so that default\n' +
      'REMOVED the node - it is not on the page at all, and an absent node is\n' +
      'indistinguishable from metadata that meant to hide it. Nothing is broken\n' +
      'in the renderer: the block is missing because the predicate above could\n' +
      'not be evaluated.\n',
  },
  // The fail-CLOSED visibility gates: the app-shell navigation `visible` gate
  // (objectui#12700), the `page:tabs` item gate (objectui#13286) and a page
  // node's SHOW legs (objectui#13299). One paragraph serves all three, so it
  // names what is withheld as "an element", never as one surface's thing
  // (objectui#13303).
  withholding: {
    prefix: UNRESOLVABLE_VISIBILITY_PREFIX,
    consequence:
      'The element was treated as its safe default, which on THIS gate is the\n' +
      'one that BITES: an element whose visibility predicate cannot be evaluated\n' +
      'is WITHHELD - not drawn - until it can be, so a missing element may be\n' +
      'this fault rather than a gate that said no.\n',
  },
  enablement: {
    prefix: UNRESOLVABLE_ENABLEMENT_PREFIX,
    consequence:
      'The node was treated as its safe default, which on THIS gate is the one\n' +
      'that BITES: the node renders DISABLED - on screen, greyed out, refusing\n' +
      'input - and that is indistinguishable from a gate the author meant to\n' +
      'close. No pixel says a predicate failed, so this line is the only thing\n' +
      'that will ever name the one that did it.\n',
  },
};

/**
 * Build the message. Separate from the emit so a test can assert the words,
 * not merely that something was logged.
 *
 * `tier` defaults to `'page-component'` and `gate` to `'visibility'` so the
 * historical five-argument call keeps printing the exact bytes it printed
 * before (objectui#6487, objectui#6445) — the defaults are a compatibility
 * shim for callers outside this repo, not something this repo leans on: every
 * in-repo call site passes both explicitly, which is what makes each one a
 * stated decision rather than an inherited one.
 */
export function formatUnresolvableVisibilityMessage(
  type: unknown,
  id: unknown,
  key: string,
  raw: unknown,
  reason: string,
  tier: PredicateScopeTier = 'page-component',
  gate: PredicateGateKind = 'visibility',
): string {
  const node = typeof type === 'string' && type ? '"' + type + '"' : '(untyped node)';
  const where = typeof id === 'string' && id ? ' (id: "' + id + '")' : '';
  const copy = GATE_KIND_COPY[gate];
  return (
    copy.prefix + ' - node ' + node + where + '\n' +
    '  ' + key + ': ' + JSON.stringify(predicateSourceText(raw)) + '\n' +
    '  Reason: ' + reason + '\n' +
    copy.consequence +
    SCOPE_TIER_ADVICE[tier]
  );
}

/**
 * Reported (node type, key, predicate source) triples, so a re-render — or the
 * post-mount `forceUpdate` that picks up lazy plugin registrations — does not
 * repeat the line. Keyed on the predicate TEXT rather than the schema object:
 * the same broken predicate authored once and rendered over many rows is ONE
 * authoring bug, and an object key would report it once per row.
 *
 * This is the RATE LIMIT the 2026-08-25 ruling requires of the production leg,
 * and it is why that leg can be a plain `console.warn`: the ceiling is not "one
 * line per render" but "one line per distinct authored predicate", for the
 * lifetime of the page. Two properties have to hold together, and a test that
 * pins only the first cannot tell a working dedupe from one that suppresses
 * everything — so objectui#6038 pins both: N renders of ONE faulting predicate
 * emit exactly one line, and a SECOND distinct predicate source still emits.
 */
const _warnedVisibilityPredicates = new Set<string>();

/**
 * Reports a NODE-GATE predicate that could not be evaluated — in DEVELOPMENT
 * AND IN PRODUCTION since objectui#6038 (maintainer ruling 2026-08-25, option
 * B: "the silence is no longer an accepted property").
 *
 * The visibility chain was the first gate wired to it and is still the default
 * {@link PredicateGateKind}; `disabled` / `disabledOn` joined it in
 * objectui#6445, which is why the name is now narrower than the function. It is
 * kept anyway: this symbol is exported from the package entry and called from
 * `@object-ui/app-shell` and `@object-ui/components`, so renaming it would be a
 * cross-package edit that changes no behaviour, on a card scoped to one file's
 * wiring. What has to stay true is the posture the name once described — ONE
 * reporter, ONE dedupe `Set`, ONE severity, ONE reset — and a second reporter
 * for the second gate is exactly what that rules out.
 *
 * `console.warn`, not `error`: the verdict is unchanged and the page still
 * renders, so this is a diagnostic about a predicate — not the refusal
 * `reportUnevaluatedExpressions` emits once raw source has reached the DOM.
 *
 * ## `err` takes a reason, not only an `Error`
 *
 * The dev caller catches a throw and passes the `Error`; the production caller
 * is handed the evaluator's own reason STRING through `EvaluationOptions.onFault`
 * (no throw is raised there, because raising one would cost a second
 * evaluation). `String(err)` already covered that shape, so both callers reach
 * the same `Reason:` text and the same dedupe entry — which is what makes "dev
 * and production print the identical line" true rather than approximately true.
 *
 * ## `tier` is NOT in the dedupe key, and that is not an oversight
 *
 * The key stays `(type, key, predicate source)` — the rate limit objectui#6038
 * pinned in both directions. Adding `tier` could only ever LOOSEN it, and it
 * would take a `type` shared across two tiers to loosen anything: the app-shell
 * site's `type` is the constant `'app-shell:visible'`, which no node tier can
 * produce, and the two `'page-component'` callers are the same tier by
 * definition. So the tier is free of the key by measurement, not by assumption.
 *
 * ## Neither is `gate`, and for a stronger reason (objectui#6445)
 *
 * `gate` is a FUNCTION of `key`, which is already in the dedupe key: the
 * enablement gate is exactly `disabled` / `disabledOn` and the visibility gate
 * is exactly the six legs of the visibility chain, two disjoint sets. So adding
 * it could not separate two entries that `key` does not already separate, and
 * the cross-gate direction is pinned rather than argued: the SAME predicate
 * source authored on `disabled` and on `visibleWhen` produces TWO lines, not
 * one - the new reporting site cannot be swallowed by a visibility entry, and
 * cannot swallow one.
 */
export function reportUnresolvableVisibilityPredicate(
  type: unknown,
  id: unknown,
  key: string,
  raw: unknown,
  err: unknown,
  tier: PredicateScopeTier = 'page-component',
  gate: PredicateGateKind = 'visibility',
): void {
  const reason = err instanceof Error ? err.message : String(err);
  const dedupeKey = JSON.stringify([type, key, predicateSourceText(raw)]);
  if (_warnedVisibilityPredicates.has(dedupeKey)) return;
  _warnedVisibilityPredicates.add(dedupeKey);
  console.warn(formatUnresolvableVisibilityMessage(type, id, key, raw, reason, tier, gate));
}

/**
 * Test-only reset for the dedupe above — for BOTH legs, which is the point of
 * their sharing one `Set`. The `Set` is module state: without this, the second
 * test to assert the same warning reads the first test's dedupe entry and sees
 * silence — a green run that checked nothing.
 */
export function __resetVisibilityPredicateWarnings(): void {
  _warnedVisibilityPredicates.clear();
}

/* -------------------------------------------------------------------------- *
 * objectui#5687 — the NON-throwing half of the same silence
 * -------------------------------------------------------------------------- */

/**
 * Prefix for the objectui#5687 leg. A SIBLING of the constant above, not a
 * reuse of it, and the difference is deliberate.
 *
 * The maintainer ruling (2026-08-22, option A) says this path "emits the
 * dev-only unresolvable-predicate report". What is load-bearing there — and
 * what the dispatch restated — is the reporter's POSTURE: same module, same
 * severity (`console.warn`), same dedupe key shape, same dedupe Set, same
 * gate at the same call site, same test-only reset. All of that is shared
 * below.
 *
 * ⚠️ The two legs stopped sharing that gate's VALUE in objectui#6038, and only
 * that. The unresolvable leg now reports in production as well, because the
 * 2026-08-25 ruling retired its silence; THIS leg stays dev-only under its own
 * 2026-08-22 ruling, and the difference is not an oversight. A fault is a
 * predicate that could not be evaluated, and shipping a live gate that has
 * stopped biting is the class-1 defect production has to be able to see. This
 * leg reports something else: a predicate that evaluated perfectly, against the
 * wrong object. Its trigger is a LEXICAL scan of the predicate source with a
 * stated false-positive residue (the deliberate-absence idioms below), which is
 * a cost worth paying for an author at their keyboard and not for every user of
 * every production page. The first LINE is not reused, because on this path it would
 * state something false: the predicate did not fail to evaluate. It evaluated
 * perfectly, against the wrong object, and produced a constant. Telling an
 * author "could not be evaluated" would send them hunting for a syntax error
 * that is not there.
 */
export const ADAPTER_ONLY_DATA_PREDICATE_PREFIX =
  '[ObjectUI] A visibility predicate read `data.*` that the bound `data` does not answer';

/**
 * The `disabled` / `disabledOn` sibling of the prefix above (objectui#6504,
 * maintainer ruling 2026-08-27 option A). Same reason
 * {@link UNRESOLVABLE_ENABLEMENT_PREFIX} is a sibling of
 * {@link UNRESOLVABLE_VISIBILITY_PREFIX} rather than a reuse: calling a
 * `disabled` predicate "a visibility predicate" would send an author to the
 * wrong gate on the first line — the one line a console filter and a `grep`
 * both read.
 */
export const ADAPTER_ONLY_ENABLEMENT_PREDICATE_PREFIX =
  '[ObjectUI] An enablement predicate read `data.*` that the bound `data` does not answer';

/**
 * Which gates the objectui#5687 constant-predicate diagnostic is wired to
 * (objectui#6504, maintainer ruling 2026-08-27 option A: extend to the
 * enablement gate, dev-only; option C — always-on — was excluded, outside
 * the #5687 precedent).
 *
 * A NARROWER union than {@link PredicateGateKind} deliberately, not an
 * oversight: `'concealment'` (`hidden` / `hiddenOn`) is not one of them. Both
 * of this diagnostic's call sites are unchanged by this card — the visibility
 * one (`SchemaRenderer.tsx`'s `evaluateVisibilityPredicate`) still calls
 * {@link reportAdapterOnlyDataPredicate} with no `gate` argument at all, for
 * the six-leg chain exactly as objectui#5687 shipped it, so `'concealment'`
 * was never a value this table had to answer for. Giving it an entry nobody
 * can reach would be a decision this ruling did not make; widening this type
 * later is a decision for whichever card makes that call, not a `??` for this
 * table to paper over now.
 */
export type AdapterOnlyPredicateGateKind = Extract<PredicateGateKind, 'visibility' | 'enablement'>;

/**
 * The two parts of the message that vary with the gate, mirroring
 * {@link GATE_KIND_COPY}'s machinery (#6445) for this SIBLING diagnostic —
 * same discipline (indexed without a `??` fallback; the default lives on the
 * parameter), a separate table because the message TEMPLATE differs (this one
 * carries an "Unanswered by the bound `data`:" line and no {@link SCOPE_TIER_ADVICE}
 * tail; see {@link formatAdapterOnlyDataMessage}).
 *
 * ⛔⛔ BINDING INHERITANCE CLAUSE (2026-08-27 ruling, objectui#6504, verbatim
 * from the card thread): "the extension inherits #5687's dissolution note
 * verbatim — when #5330's deprecation window closes, both legs dissolve
 * together; the new copy entry must carry the same pointer so the teardown
 * finds it." The pointer, carried from this module's own docblock (see
 * {@link unresolvedDataPaths}'s "why this discriminator" section): objectui#5687
 * is "a diagnostic on a card that dissolves when objectui#5330's deprecation
 * window closes." BOTH entries below dissolve on that same clock, together —
 * this is not an independently-scheduled diagnostic. When that window closes,
 * delete this table, {@link ADAPTER_ONLY_ENABLEMENT_PREDICATE_PREFIX},
 * {@link ADAPTER_ONLY_DATA_PREDICATE_PREFIX}, {@link unresolvedDataPaths},
 * {@link formatAdapterOnlyDataMessage} and {@link reportAdapterOnlyDataPredicate}
 * in this file, and BOTH call sites in `SchemaRenderer.tsx`
 * (`evaluateVisibilityPredicate` and `evaluateEnablementPredicate`), in the
 * same stroke.
 */
const ADAPTER_ONLY_GATE_COPY: Record<AdapterOnlyPredicateGateKind, { prefix: string; consequence: string }> = {
  visibility: {
    prefix: ADAPTER_ONLY_DATA_PREDICATE_PREFIX,
    consequence:
      'At the node tier `data` is whatever the HOST published under that name\n' +
      'in the ambient predicate scope, and it is NOT the row. Since\n' +
      'objectui#9308 it is not the data-source adapter either - the renderer\n' +
      'binds no `data` of its own. The reads above are undefined on it, so\n' +
      'this predicate is a CONSTANT: it does not\n' +
      'depend on the row at all, and on this surface a constant `false` hides the\n' +
      'node on every row while looking exactly like a gate that said no.\n' +
      'Write the row as `record.*` (e.g. `record.status`), which page-component\n' +
      'predicates bind alongside `current_user` and page state as `page.<var>`.\n' +
      '`data.*` as a spelling for the row is deprecated (objectui#5330) and was\n' +
      'never bound to the row on this tier.',
  },
  // The constant-`true` direction, not a reuse of the sentence above: on THIS
  // gate the fail-soft default that BITES is `true` (a control that greys
  // out), the mirror image of the negated visibility legs where it is
  // `false` (a node that hides). Written to describe that direction, since it
  // is the one that leaves nothing on screen for an author to notice —
  // "greyed out" looks exactly like a gate that closed on purpose, the same
  // way "not on screen" looks exactly like a gate that hid on purpose.
  enablement: {
    prefix: ADAPTER_ONLY_ENABLEMENT_PREDICATE_PREFIX,
    consequence:
      'At the node tier `data` is whatever the HOST published under that name\n' +
      'in the ambient predicate scope, and it is NOT the row. Since\n' +
      'objectui#9308 it is not the data-source adapter either - the renderer\n' +
      'binds no `data` of its own. The reads above are undefined on it, so\n' +
      'this predicate is a CONSTANT: it does not\n' +
      'depend on the row at all, and on THIS gate the dangerous polarity is a\n' +
      'constant `true`: the node renders DISABLED - on screen, greyed out,\n' +
      'refusing input - on every row, in every build, while looking exactly\n' +
      'like a gate that said no. No pixel says the predicate is a constant, so\n' +
      'this line is the only thing that will ever name it.\n' +
      'Write the row as `record.*` (e.g. `record.status`), which page-component\n' +
      'predicates bind alongside `current_user` and page state as `page.<var>`.\n' +
      '`data.*` as a spelling for the row is deprecated (objectui#5330) and was\n' +
      'never bound to the row on this tier.',
  },
};

/**
 * Strip string literals before scanning for `data.*` reads.
 *
 * The scan below is LEXICAL, not a parse — it reads the predicate's source
 * text. Without this step a predicate that merely quotes the characters
 * (`note == 'data.status'`) would be reported for a read it never performs.
 * That class is not hypothetical in this repo: `examples/schema-catalog`'s
 * `components-complex-scroll-area/code-preview.json` carries `data.features`
 * inside a JS snippet in a `content` string.
 *
 * Replaced with an EMPTY literal of the same quote style rather than deleted,
 * so neighbouring tokens cannot be fused into a new false match.
 */
function stripStringLiterals(source: string): string {
  return source.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
}

/**
 * `data.<path>` reads, matched only where `data` is a ROOT identifier.
 *
 * The leading group is what keeps this from being the loose sweep the card's
 * own cross-reference warns about: `metadata.status` (a longer identifier that
 * ends in `data`) and `record.data.status` (`data` as a MEMBER, which is the
 * row's own field, not this evaluator's root) must not match. Both are pinned.
 * A capture group is used rather than a lookbehind for target-browser reach.
 */
const DATA_ROOT_PATH_RE =
  /(^|[^A-Za-z0-9_$.])data\.([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)/g;

/**
 * The `data.*` reads in `source` that are `undefined` on the object `data` is
 * actually bound to — i.e. the ones that make the comparison a constant.
 *
 * ## Why THIS discriminator, measured against the three alternatives
 *
 * The ruling's trigger is not "references `data.`" — a genuine adapter read has
 * to stay silent, and that half is what makes the loud half mean anything.
 * Measured on `packages/core`'s built evaluator, against the four candidate
 * definitions:
 *
 *   * "references `data.` at all" — fires on `data.total > 0` against an
 *     adapter that HAS `total`. Refused by the ruling in as many words.
 *   * "the whole predicate is constant-false" — measured: `data.total > 100`
 *     against `{ total: 99 }` returns `false`, and so does a correct
 *     `record.status == 'draft'` against a row whose status is `open`. The
 *     definition cannot tell a gate that correctly says NO from a gate that
 *     never asked. It would report every hiding gate in the repo.
 *   * "the comparison OPERAND is undefined" — the most precise reading, and it
 *     needs the expression engine to expose its operands. That is a change to
 *     `@object-ui/core`'s evaluator for a diagnostic on a card that dissolves
 *     when objectui#5330's deprecation window closes — BOTH legs together,
 *     the enablement one objectui#6504 added included; see
 *     {@link ADAPTER_ONLY_GATE_COPY}'s binding inheritance clause.
 *   * "a `data.*` read the bound object does not answer" — this one. On the
 *     card's repro (`data.status` against the adapter) it fires; on
 *     `${data.total}` against `{ total: 99 }` it does not; and it is
 *     STRUCTURALLY incapable of firing on the `record.*` bucket
 *     (objectui#5454), which is the adjacent card with a different correct fix.
 *
 * Residue, stated rather than hidden: deliberate absence idioms
 * (`data.status == null`, `!data.status`) are reported. They are not really
 * false positives at this tier — an adapter that has no `status` makes those
 * constants too, just constant-TRUE instead of constant-false — but they are
 * the shapes an author could have meant.
 *
 * The walk mirrors `useDataScope`'s own `path.split('.').reduce(…)` resolution
 * of a path, so "undefined here" means what it means everywhere else this repo
 * resolves a path against a scope.
 *
 * ⭐ WHAT `boundData` IS, since objectui#9308. It used to be the injected
 * ADAPTER (`SchemaRendererContext.dataSource`), because the renderer bound that
 * object as the `data` root. It no longer binds one: `boundData` is now the
 * `data` the HOST published in the ambient predicate scope, i.e. the exact
 * object the evaluator resolved `data.*` against. Passing the adapter after
 * that ruling would have inverted this diagnostic — silent for the hosts whose
 * predicates actually broke (their bag still answers), and loud for hosts whose
 * scope-channel `data` answers perfectly.
 *
 * ⚠️ Reachability, stated rather than assumed: when the host publishes NO
 * `data` root, a `data.*` predicate does not evaluate cleanly at all — it
 * throws `data is not defined`, which is objectui#5454's leg, reported by
 * {@link reportUnresolvableVisibilityPredicate} with a message that is true for
 * it. Both call sites of this function sit on the NON-throwing branch, so this
 * leg is reached only for a host that published a `data` root which does not
 * answer the read. That is the population it can still speak for, and the one
 * it now speaks about accurately.
 */
function unresolvedDataPaths(source: string, boundData: unknown): string[] {
  const scannable = stripStringLiterals(source);
  const out: string[] = [];
  DATA_ROOT_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DATA_ROOT_PATH_RE.exec(scannable)) !== null) {
    const path = match[2];
    let cursor: unknown = boundData;
    try {
      for (const segment of path.split('.')) {
        if (cursor === null || cursor === undefined) {
          cursor = undefined;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
      }
    } catch {
      // A throwing getter on the adapter is the OTHER reporter's case: the
      // evaluator would have thrown too. Stay silent rather than guess.
      return [];
    }
    const spelling = 'data.' + path;
    if (cursor === undefined && out.indexOf(spelling) === -1) out.push(spelling);
  }
  return out;
}

/**
 * Built separately from the emit, for the same reason as the message above.
 *
 * `gate` defaults to `'visibility'` so the historical four-argument call
 * (objectui#5687) keeps printing the exact bytes it printed before —
 * objectui#6504's own call site in `evaluateVisibilityPredicate`
 * (`SchemaRenderer.tsx`) is one of those unchanged callers, passing no `gate`
 * at all. `evaluateEnablementPredicate` is the one caller that states
 * `'enablement'` explicitly, matching {@link formatUnresolvableVisibilityMessage}'s
 * own compatibility-default pattern.
 */
export function formatAdapterOnlyDataMessage(
  type: unknown,
  id: unknown,
  key: string,
  raw: unknown,
  unresolved: string[],
  gate: AdapterOnlyPredicateGateKind = 'visibility',
): string {
  const node = typeof type === 'string' && type ? '"' + type + '"' : '(untyped node)';
  const where = typeof id === 'string' && id ? ' (id: "' + id + '")' : '';
  const copy = ADAPTER_ONLY_GATE_COPY[gate];
  return (
    copy.prefix + ' - node ' + node + where + '\n' +
    '  ' + key + ': ' + JSON.stringify(predicateSourceText(raw)) + '\n' +
    '  Unanswered by the bound `data`: ' + unresolved.join(', ') + '\n' +
    copy.consequence
  );
}

/**
 * Dev-build diagnostic for a node-gate predicate that reads `data.*` and gets
 * `undefined` back from the adapter (objectui#5687, maintainer ruling
 * 2026-08-22 option A).
 *
 * ## It changes NO verdict, and it is not allowed to
 *
 * The ruling is explicit that the node tier keeps its documented
 * `data` = adapter semantics: no verdict change, no interpolation change. This
 * function returns `void`, is called for its console output only, and the
 * caller passes the evaluator's answer through untouched. The constant-false
 * still hides the block; the author now hears about it.
 *
 * ## Why it lives beside `reportUnresolvableVisibilityPredicate`
 *
 * They are two halves of ONE silence. objectui#5454 made the THROWING paths
 * loud; measured on this base, a `{ dialect: 'cel' }` envelope reading
 * `data.status` already throws and is already reported by that function. The
 * bare-string and `${…}` template dialects do not throw for the same
 * predicate — they resolve `undefined == 'draft'` to a clean `false` — so the
 * author heard about the identical authoring mistake only if they happened to
 * write it in the CEL dialect. That is the same dialect-dependent arbitrariness
 * objectui#5454 existed to remove, one path further along.
 *
 * Sharing the module means sharing the LIFECYCLE, which is the part that has to
 * match: one dedupe Set, one reset, one severity. (One gate, too, until
 * objectui#6038 — see the prefix constant above for why only the sibling leg
 * crossed into production.) The dedupe
 * key is tagged with this leg's name so the two diagnostics cannot silence each
 * other for the same (type, key, source) triple — they are different faults,
 * and a node that faults one way is not evidence about the other.
 *
 * ## `gate` (objectui#6504) — NOT in the dedupe key, for the reason
 * {@link reportUnresolvableVisibilityPredicate}'s own docblock gives for the
 * same omission
 *
 * `gate` is a FUNCTION of `key`: the enablement gate is exactly `disabled` /
 * `disabledOn` and the visibility gate this leg is called for is the six-leg
 * chain, two disjoint sets. Adding it to the dedupe key could not separate two
 * entries `key` does not already separate — and the cross-gate direction is
 * the one that would matter if it could: the SAME predicate source authored on
 * `disabled` and on (say) `visibleWhen` must produce TWO lines, which it does
 * today because `key` differs, with or without `gate` in the tuple.
 *
 * Defaults to `'visibility'` — the objectui#5687 call site
 * (`evaluateVisibilityPredicate`) is unchanged by this card and still calls
 * this function with five arguments.
 */
export function reportAdapterOnlyDataPredicate(
  type: unknown,
  id: unknown,
  key: string,
  raw: unknown,
  boundData: unknown,
  gate: AdapterOnlyPredicateGateKind = 'visibility',
): void {
  const source = predicateSourceText(raw);
  // Fast reject: the overwhelming majority of predicates never mention `data.`
  // at all, and this runs for every visibility predicate of every node in dev.
  if (source.indexOf('data.') === -1) return;
  const unresolved = unresolvedDataPaths(source, boundData);
  // Every `data.*` read the adapter answers -> a genuine adapter read.
  // SILENT. This is the half of the ruling that makes the other half mean
  // something.
  if (unresolved.length === 0) return;
  const dedupeKey = JSON.stringify(['adapter-only-data', type, key, source]);
  if (_warnedVisibilityPredicates.has(dedupeKey)) return;
  _warnedVisibilityPredicates.add(dedupeKey);
  console.warn(formatAdapterOnlyDataMessage(type, id, key, raw, unresolved, gate));
}
