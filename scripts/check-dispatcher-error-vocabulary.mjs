#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dispatcher error-code vocabulary gate (#8087, ADR-0112).
 *
 *   node scripts/check-dispatcher-error-vocabulary.mjs
 *   node scripts/check-dispatcher-error-vocabulary.mjs --self-test
 *   node scripts/check-dispatcher-error-vocabulary.mjs --report   # print the derivation
 *
 * ## What it guards
 *
 * `ApiErrorSchema.code` parses against `ErrorCode` = `StandardErrorCode` ∪
 * `ERROR_CODE_LEDGER`, and the ledger's own note says an unregistered code
 * "fails schema parse — which fails the envelope conformance suites — which
 * fails CI. That friction is the point."
 *
 * The dispatcher door had no such friction. `HttpDispatcher.errorFromThrown`
 * put `resolveThrownHttpError(e).declaredCode` — the producer's own string,
 * un-narrowed — into `error.code`, and its conformance suite parsed only the
 * handful of cases it drove. Three suites pinned bodies `ApiErrorSchema` would
 * reject and CI stayed green. Since #9106 the door NARROWS (`error.code` takes
 * the resolver's closed `code`; an unregistered spelling rides the wire's
 * `declaredCode`), so the failure this gate catches changed shape without
 * getting smaller: an unswept producer's semantic code no longer breaks the
 * schema — it silently DEMOTES off `error.code` until registered, which is
 * still a real emitter hiding, and still this gate's job to report.
 *
 * The maintainer ruling of 2026-08-12 chose option B **delivered as a gate**:
 * parse every body the door emits, then register what the gate reports. This is
 * the finding half. `packages/runtime/src/dispatcher-error-vocabulary.ts` is the
 * declaration half; `error-envelope.conformance.test.ts` drives every code this
 * gate classifies as dispatcher-reachable through the real builder and parses
 * the body.
 *
 * ## Why a scan plus a declared table, rather than either alone
 *
 * A scan alone cannot answer the question that matters. Whether a stamped code
 * reaches an HTTP response envelope is REACHABILITY, and the two ends of that
 * question are written identically in source: `MEMORY_MULTI_TENANT_UNSUPPORTED`
 * and `FLOW_FAILED` are both `code` on a thrown value, and one of them is a boot
 * refusal the CLI rethrows before any HTTP boundary exists. Inferring a default
 * for an unknown site is exactly how a real emitter hides.
 *
 * A table alone is a snapshot that starts decaying the moment it lands — the
 * card's own objection to a one-time sweep ("an unswept producer just re-opens
 * the hole").
 *
 * So: the scan finds sites, the table records verdicts with evidence, and the
 * two are reconciled in BOTH directions. A site the table does not carry fails.
 * A table row whose site is gone fails. A `pending-registration` row whose code
 * has since been registered fails — which is how #8846 landing ratchets this
 * list down instead of leaving stale rows promising work already done.
 *
 * ## Why textual, not AST
 *
 * The same reasoning `check-error-code-casing` records: the failure mode is a
 * string literal in one of a handful of syntactic positions, and the positions
 * are more varied than an AST shape for "the value of an error's code property"
 * would cover (class field, constructor-side object literal, post-hoc
 * assignment, a constant one module over). The eight shapes below are published
 * rather than left inside the implementation, and `--self-test` pins each one —
 * because the price of a source scan is that it sees only the spellings it
 * knows, and an unrecognised one produces no finding, SILENTLY. Reaching for a
 * spelling that is not here? Extend `SHAPES` and add a `--self-test` case in the
 * same edit.
 *
 * [#9223] That price was being paid, by this gate, in the shape it scans most.
 * `objlit` demanded a QUOTED literal, so `code: SOME_CONST` and a
 * template-generated `` code: `A_${x}_B` `` in an object literal matched
 * nothing — not reported as unresolved, not reported at all. The bound below
 * ("REPORTED as unresolved, never dropped") held for `classconst` and for
 * nothing else, and #8885 had already paid for the gap once: it could not lean
 * on this gate for the template-generated `APPROVAL_*_FAILED` family and wrote
 * a bespoke runtime pin instead. `objlitconst` and `objlittemplate` close it.
 *
 * ## Declared bounds — printed on every run, so a partial gate cannot read as a
 * ## complete one
 *
 *   - Scanned: `packages/**` non-test TypeScript source. Not `apps/`, not
 *     `examples/`, not tests — a test that CONSTRUCTS a code is not a producer
 *     (the ledger's own rule, and #4984's phantom-check family).
 *   - Reported: only codes the registered vocabulary does NOT contain. A
 *     registered code is by construction parseable, whatever door it reaches.
 *   - [#9460] Lowercase and mixed-case codes are REPORTED, except in the two
 *     positions where a better-equipped gate already sees the identical text.
 *     ADR-0112 D1 rules the value space `^[A-Z][A-Z0-9_]*$`, so a lowercase
 *     code is outside the vocabulary by definition and the only real question
 *     is WHICH gate reports it. `check:error-code-casing` owns the lowercase
 *     sweep, and every pattern it has needs a QUOTED lowercase literal beside
 *     the token `code` — `code: 'x'`, `.code = 'x'`, `code === 'x'`,
 *     `code?: 'x' | 'y'`, [#10760] `code: parsed?.code || 'x'` /
 *     `.code = e?.code ?? 'x'` — the OUR-DEFAULT slot of a `||`/`??`
 *     fallback chain, that gate's `fallback` pattern — and [#10897] the same
 *     our-default slot one indirection earlier, in a `code`-named local's
 *     initializer (`const code = parsed?.code || 'x'`, typed or not), that
 *     gate's `local-fallback` pattern. Both still capture only a string
 *     literal, and a literal in our source is by construction the default WE
 *     author. Those last two are positions this gate has NO shape for rather
 *     than ones it hands over: an intervening expression leaves `objlit` and
 *     `assign` with no quote to match, and the local's chain is declined here
 *     by the ALL-OR-NOTHING rule below.
 *     In those positions (`objlit`, `assign`) the
 *     delegation is real: that gate reads the same characters and carries the
 *     D6/D6b/D6c discrimination — field-addressed catalogs, persisted audit
 *     columns, diagnostics payloads, Zod's own issue codes — that decides which
 *     lowercase literals are legitimate. Reporting them here would duplicate a
 *     gate that answers better and would call Zod's `code: 'custom'` an
 *     unregistered ObjectStack error code, which is false. Measured, not
 *     assumed: reporting every lowercase stamp took this gate from 12 sites to
 *     94, and 82 of the 82 new findings were D6/D6b/D6c or Zod.
 *
 *     Everywhere else the delegation was a HOLE, not a hand-off. A code
 *     arriving through a constant, a template, or a helper parameter has no
 *     quoted literal at the stamp site, so `check:error-code-casing` is
 *     structurally blind to it — and this gate dropping it for its casing meant
 *     NOBODY reported it. Two gates, each assuming the other. `plugin-security`
 *     threw a live 403 `owd_widening_forbidden` through both for two vocabulary
 *     batches. Those shapes carry `lowercase: 'here'` and are reported.
 *
 *     So what is measured is "outside the vocabulary AND unowned by the gate we
 *     delegate lowercase to", never "is it SCREAMING_SNAKE".
 *   - [#9460] A code assembled from RUNTIME values in a local variable
 *     (`const code = readFrom(x); err.code = code`) is out of reach for the
 *     same reason an interpolated template is, and — unlike a template, which
 *     at least has a stable family identity — has nothing to report under. It
 *     contributes no site.
 *   - [#9568] But "in a local variable" was doing too much work in that bound.
 *     A local whose initializer is a TERNARY, or a `||`/`??` chain, OF LITERALS
 *     is not a runtime value at all — every branch is right there in the
 *     source, and `sys-metadata-repository.ts` stamped two live 403s
 *     (`NOT_CREATABLE` / `NOT_OVERRIDABLE`) through one such local while both
 *     this gate and `check:error-code-casing` reported nothing. `resolveConstant`
 *     now reduces those to a SET of values, so the bound is what it always
 *     meant: a value a source scan cannot evaluate is out of reach; a value
 *     spelled out in every branch is not, whichever shape it arrives through.
 *     Reduction is ALL-OR-NOTHING — a chain with one runtime limb reduces to
 *     nothing rather than to its literal half, since half an expression's
 *     values is a finding that is wrong in both directions at once.
 *     [#10762] WHO owns a runtime-limbed chain then depends on WHERE it sits,
 *     and the two answers differ — measured against both gates' recognizers,
 *     not inferred from either one's prose. At the STAMP SITE
 *     (`{ code: parsed?.code || 'lit' }`, `err.code = e?.code ?? 'lit'`) no
 *     reduction is involved at all: `objlit`/`assign` need the quote
 *     immediately, so this gate never had a shape there — and since #10760
 *     `check:error-code-casing`'s `fallback` pattern reads that literal, so
 *     the shape is DELEGATED, not dropped. That is the position the two live
 *     SSO codes in `register-sso-provider.ts` shipped through. In a LOCAL'S
 *     INITIALIZER (`const code = parsed?.code || 'lit'; err.code = code`) it
 *     was owned by NOBODY: the ALL-OR-NOTHING rule above declines it here, and
 *     that gate's `fallback` pattern anchored on `code:`/`code?:`/`.code =`,
 *     so a `const code =` was out of ITS reach too. [#10897] closed the second
 *     half — that gate now carries a `local-fallback` pattern for exactly this
 *     position — so the local initializer is DELEGATED as well, on the same
 *     reasoning: the capture is a literal, and where we WRITE the chain does
 *     not change whose default it is. This side is unchanged and stays so; the
 *     ALL-OR-NOTHING bound is the deliberate half and closing the hole there
 *     would have moved the defect rather than fixed it.
 *     Not symmetric, and the asymmetry is the point: a local whose initializer
 *     is ALL literals (a bare literal, a ternary, a chain) IS reducible, so it
 *     stays THIS gate's site under `assignconst`, lowercase included, and that
 *     gate's pattern deliberately does not reach it. Measured on both sides,
 *     not inferred — one literal, one reporter.
 *   - [#10918] "Local" meant `const` alone, though — `declaredInitializers`
 *     anchored on that keyword, so a code held in a `let` or a `var` reduced to
 *     NOTHING and the `codehelper` branch read the `null` as the runtime-value
 *     bound: no site AND no unresolved, even when every branch was a literal
 *     spelled out in the source. `let code = 'A'; if (x) code = 'B';
 *     err.code = code` stamps two unregistered codes past both gates in
 *     silence. That is not the bound #9568 wrote — the value was out of reach
 *     only because of how the anchor was spelled. The anchor now reads
 *     `const|let|var`, and the mutability it lets in is handled rather than
 *     ignored, in three states:
 *       · a `let`/`var` this file never reassigns holds exactly its
 *         initializer, so it reduces like a `const` and produces SITES;
 *       · a `let`/`var` this file DOES reassign does not reduce at all — the
 *         initializer is not the value set, and claiming it would report a
 *         value the program may never stamp, which is the ALL-OR-NOTHING
 *         wrongness above. When an initializer is nonetheless a literal, the
 *         name is REPORTED as unresolved (reason `reassigned`), never dropped:
 *         a code is visibly spelled out and only the reassignment stops us
 *         claiming the set. The remedy is in the source — spell it `const`.
 *       · a mutable local with NO literal anywhere (`let code: unknown = null;
 *         code = read(x)`) is untouched by all of this. It is the #9460
 *         runtime-value bound exactly as before: nothing to report, nothing to
 *         fix, and reporting it would be the "every domain field named `code`
 *         is a finding" pressure this gate refuses.
 *     Only the DECLARATOR half is closed. A bare reassignment with no
 *     declarator (`code = p?.code || 'lit'` where `code` is declared
 *     elsewhere) has nothing to anchor on and no scopes to read, and
 *     `check:error-code-casing`'s `local-fallback` deliberately requires a
 *     declarator too — so that shape remains unowned by both gates, on record
 *     and not closed here.
 *   - A constant this gate cannot resolve is REPORTED as unresolved, never
 *     dropped: a deriver that goes quietly blind is the same failure one layer
 *     down. [#9223] A constant imported from a WORKSPACE package is resolved
 *     rather than reported — `packages/` is inside the scan by construction —
 *     but only to a unique value within that package; an ambiguous one is
 *     reported. A third-party dependency's constant stays out of reach.
 *   - [#9223] A code built by TEMPLATE INTERPOLATION cannot be evaluated by any
 *     source scan, so it is reported under its family identity (`${…}` → `*`)
 *     and must be classified like any other site. Its verdict may be
 *     `runtime-pinned` — the one verdict that names a test doing at runtime
 *     what this scan cannot do statically — and that verdict is refused on any
 *     other shape and requires a `pin:` file that EXISTS.
 *   - The sandbox limb is OUT of this scan's reach by construction — a metadata
 *     app's action code is authored at runtime, not in this repo. Ruled by
 *     #9106: demoted to the wire's `declaredCode` at the door. See
 *     `SANDBOX_AUTHORED_LIMB` in the declaration file.
 *   - [#9098] The scan answers "is this code registered", never "could an
 *     unregistered one be written here tomorrow". The second question is the
 *     DOOR TYPING half — see `checkDoorTyping` below, which is structural
 *     rather than vocabulary and is why this gate's name now undersells it: it
 *     guards both HTTP doors, not only the dispatcher.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { maskComments } from './js-comment-mask.mjs';
// [#12925] The OTHER gate's detector, imported so the kebab declaration below is
// pinned against its real recognizers rather than a paraphrase of them. That gate
// imports nothing from here, so this is a one-way edge.
import { findViolations } from './check-error-code-casing.mjs';
import { join, relative, dirname, resolve } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SCAN_ROOT = 'packages';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', 'build']);

const LEDGER_ZOD = 'packages/spec/src/api/error-code-ledger.zod.ts';
const ERRORS_ZOD = 'packages/spec/src/api/errors.zod.ts';
const DECLARATION = 'packages/runtime/src/dispatcher-error-vocabulary.ts';

// ---------------------------------------------------------------------------
// The registered vocabulary — read from spec SOURCE, never from a build
// ---------------------------------------------------------------------------

/**
 * `ERROR_CODE_LEDGER`'s members. Anchored on the declaration and its
 * `} as const` terminator rather than scanning the whole file, so the prose
 * above it (which quotes retired codes by name) cannot leak in.
 */
export function parseLedgerCodes(source) {
  const start = source.indexOf('export const ERROR_CODE_LEDGER');
  if (start < 0) throw new Error(`${LEDGER_ZOD}: ERROR_CODE_LEDGER not found — the deriver's anchor moved.`);
  const body = source.slice(start);
  const end = body.indexOf('\n} as const');
  if (end < 0) throw new Error(`${LEDGER_ZOD}: ERROR_CODE_LEDGER terminator not found — the deriver's anchor moved.`);
  return new Set([...body.slice(0, end).matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]));
}

/** `StandardErrorCode`'s members. */
export function parseStandardCodes(source) {
  const block = /export const StandardErrorCode = z\.enum\(\[([\s\S]*?)\]\)/.exec(source);
  if (!block) throw new Error(`${ERRORS_ZOD}: StandardErrorCode enum not found — the deriver's anchor moved.`);
  return new Set([...block[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]));
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------



/**
 * The recognised ways this repo stamps a semantic code onto a value.
 * PUBLISHED, and each pinned by `--self-test`. See the header on why.
 */
export const SHAPES = [
  // `err.code = 'X'` — stamped onto a value about to be thrown.
  // [#9460] The left-hand side is no longer required to be a BARE identifier.
  // The old anchor (`[^\w.$][\w$]+\.code`) demanded a word character where
  // `(err as any).code = 'X'` puts a `)`, so the single most common way this
  // repo stamps a code onto a caught-or-constructed value — through a cast —
  // was invisible in the very shape named for it.
  { name: 'assign', re: /\.code\s*=\s*'([A-Za-z][A-Za-z0-9_]*)'/g, resolve: 'literal', lowercase: 'casing-gate' },
  // `readonly code = 'X'` / `readonly code: T = 'X'` — an error class's identity.
  { name: 'classfield', re: /\breadonly\s+code\s*(?::[^=;\n]+)?=\s*'([A-Za-z][A-Za-z0-9_]*)'/g, resolve: 'literal', lowercase: 'here' },
  // `readonly code = CONST` — the same, one indirection away.
  { name: 'classconst', re: /\breadonly\s+code\s*(?::[^=;\n]+)?=\s*([A-Z][A-Z0-9_]*)\s*[;,\n]/g, resolve: 'constant', lowercase: 'here' },
  // `code: 'X'` in an object literal (constructor options, Object.assign, a
  // returned envelope). The broadest shape, and the reason verdicts exist:
  // plenty of these are not wire codes at all.
  { name: 'objlit', re: /\bcode:\s*'([A-Za-z][A-Za-z0-9_]*)'/g, resolve: 'literal', lowercase: 'casing-gate' },
  // [#9223] `code: CONST` in an object literal — the SAME indirection
  // `classconst` already follows, in the shape that stamps most of this repo's
  // codes. Left out of the original four, it was the gate's own blind spot:
  // `objlit` required a quoted literal, so a constant in an object literal
  // matched nothing at all and was never even reported as unresolved.
  { name: 'objlitconst', re: /\bcode:\s*([A-Z][A-Z0-9_]*)\s*[,;}\n]/g, resolve: 'constant', lowercase: 'here' },
  // [#9223] A template-literal `code:`. Evaluating one needs the RUNTIME values
  // of its interpolations, which a source scan does not have — so it is
  // reported as unresolved, which is what the header's bound requires of any
  // value this gate cannot reduce to a literal. A template with no
  // interpolation is just a literal wearing backticks and is treated as one.
  { name: 'objlittemplate', re: /\bcode:\s*`([^`]*)`/g, resolve: 'template', lowercase: 'here' },
  // [#9460] `x.code = ident` — the assign position's INDIRECT sibling, and the
  // last of the four stamp positions to get one. `objlitconst` (#9223) closed
  // this exact gap for object literals; the assign position kept it, so
  // `err.code = DENY_CODE` and `err.code = code` both matched nothing at all.
  //
  // Two different indirections arrive through one regex, so it emits two shape
  // names rather than pretending they are one thing:
  //   - `assignconst` — the identifier is a constant `resolveConstant` can
  //     reduce to a literal, exactly as in the object-literal position.
  //     [#9568] "Constant" is the resolver's question, not the casing's: a
  //     lower-case LOCAL `const code = cond ? 'A' : 'B'` reduces to both of
  //     its branches and is emitted under this same name (from the branch
  //     below, since this regex reads the SCREAMING_SNAKE convention).
  //   - `codehelper`  — the identifier is a PARAMETER of the enclosing function
  //     or constructor, which makes that function a code-carrying helper
  //     (`postureError(code, message)`, `makeError(status, code, message)`).
  //     The literal then lives at the CALL SITES, at that parameter's index,
  //     and nowhere near a `code` token — so no `code`-anchored pattern in
  //     either this gate or `check:error-code-casing` can see it. See
  //     `helperCodesFor`.
  { name: 'assignconst', re: /\.code\s*=\s*([A-Z][A-Z0-9_]*)\s*[;,\n)]/g, resolve: 'constant', lowercase: 'here' },
  // [#9460] `x.code = param` inside a CODE-CARRYING HELPER — the one stamp
  // position whose literal is nowhere near the token `code`. Structural, not
  // textual: it fires only when the assigned identifier is a PARAMETER of the
  // enclosing function or constructor, which is what makes that declaration a
  // helper and its call sites the place the codes live. See `helperCodesFor`.
  // [#9568] When it is NOT a parameter, this shape hands the identifier to
  // `resolveConstant` before giving up on it — that is where a local ternary
  // of literals is reduced, and it reports under `assignconst`.
  { name: 'codehelper', re: /\.code\s*=\s*([A-Za-z_$][\w$]*)\s*[;,\n)]/g, resolve: 'helper', lowercase: 'here' },
];

/**
 * ## [#12925] Kebab-case DIAGNOSTIC codes are a SEPARATE VOCABULARY — declared
 * ## out of BOTH gates' population, once, here
 *
 * This repo authors two families of code-shaped string. `error.code` is one:
 * ADR-0112 D1 rules its value space `^[A-Z][A-Z0-9_]*$`, this gate reports what
 * is outside the registered set, and `check:error-code-casing` owns the
 * lowercase sweep. The other is the AUTHOR-TIME DIAGNOSTIC code — `{ severity,
 * code, message, tag }` records that describe an ARTIFACT rather than a
 * request, carry a severity that can be a warning, and never reach `error.code`.
 * That is the D6c genre, and `@objectstack/sdui-parser` spells its whole
 * diagnostic vocabulary in KEBAB: `unknown-component`, `forbidden-tag`,
 * `missing-required-prop`, …
 *
 * Neither gate has ever covered that family, and until this declaration NOTHING
 * said so. Not one of the published grammars admits a hyphen — `assign`,
 * `classfield`, `objlit`, `literalCodeValues` and the template shape here, and
 * every pattern in `check:error-code-casing`, whose grammar is `[a-z][a-z0-9_]*`
 * — so a kebab literal matches NO pattern in EITHER gate. Both run green over
 * the file, both count it in "files scanned", and neither has anything to say.
 *
 * ⭐ This declaration is NOT a weakening. Coverage of this family is already
 * zero and this changes no verdict; what changes is that the silence is now
 * DECLARED rather than accidental. The bound this gate states for itself — a
 * value it cannot reduce is REPORTED, never dropped — was being honoured for
 * the constant form and quietly violated for the literal form, because a value
 * outside every grammar fires no pattern and so cannot report itself.
 *
 * ## Why the declaration is here and not in each gate
 *
 * Two gates each carrying half of a boundary is what produced the hole: this
 * one delegates a lowercase literal in `objlit`/`assign` to that one, that one
 * defers a value with no literal at the position back to this one, and a kebab
 * literal is in the seam — it HAS a literal, and it is lowercase, and neither
 * grammar spells it. So the boundary is stated ONCE, in the file that already
 * documents the pair's division of labour, and `--self-test` below pins it
 * against BOTH gates' recognizers by importing the other gate's detector rather
 * than paraphrasing it.
 *
 * ## The measurement behind it (re-measured on this tree, not relayed)
 *
 *   packages/sdui-parser, non-test source, 7 files in this gate's population:
 *     24 distinct diagnostic codes — 8 stamped as `code: '…'` directly,
 *        16 through the code-carrying helper `Parser#error(code, …)`
 *     24 of 24 kebab-shaped; 0 non-kebab code VALUES in the package
 *     this gate's SHAPES: 0 hits   ·   check:error-code-casing: 0 findings
 *   The zeros are readings, not dead instruments: on independent populations
 *   the same two instruments return 6 and 6 (`metadata-protocol/build-probes.ts`,
 *   snake_case diagnostics) and 25 and 0 (`runtime/dispatcher-error-vocabulary.ts`,
 *   SCREAMING_SNAKE). And the subject file IS inside the scanned set — it is
 *   read and matches nothing, which is the whole defect.
 *
 * ⚠️ And matching is not the same as seeing. Ablated while pinning this:
 * widening `objlit` alone to admit a hyphen makes the literal MATCH and still
 * reports nothing, because `objlit` carries `lowercase: 'casing-gate'` and that
 * delegation hands the value to the gate whose grammar excludes the hyphen —
 * back into the same seam, one layer deeper. So the boundary this declares, and
 * the boundary `--self-test` pins, is the RECOGNIZER population, not the finding
 * list: a pin watching findings sits green through that widening.
 *
 * ## ⛔ What this declaration deliberately does NOT do
 *
 * ⛔ It does not widen any grammar to admit a hyphen. Widening would newly
 * resolve other constants across the repo into SITES, and every new site then
 * needs a declaration row in the table this gate reconciles against. That blast
 * radius is UNMEASURED. Measuring it is a gate-POPULATION change, which is a
 * maintainer decision on its own card — never a rider on a declaration.
 *
 * ⛔ It does not rename the diagnostic family to SCREAMING_SNAKE so a regex can
 * see it. Kebab is that vocabulary's established convention across all 24 of
 * them; renaming bends a vocabulary to fit a pattern.
 *
 * ⛔ And it does not become a general licence: this covers the kebab DIAGNOSTIC
 * shape only. A hyphen in a value that reaches `error.code` is still outside
 * ADR-0112 D1 and still a defect — there is simply no gate that can see one, and
 * that is now on the record instead of in the gap between two regexes.
 */
export const KEBAB_DIAGNOSTIC_VOCABULARY = Object.freeze({
  /** The shape declared out of both gates' population. */
  shape: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/,
  /** A member, used by `--self-test` as the probe. */
  sample: 'unknown-component',
  /**
   * Its non-kebab TWIN — the same characters with the hyphens spelled `_`.
   * `--self-test` runs both through every recognizer, so the pin isolates the
   * HYPHEN as the only reason the sample is unseen, rather than asserting a
   * zero that a broken harness would also produce.
   */
  twin: 'unknown_component',
  /** The package that owns this vocabulary, and the witness for the pin. */
  owner: 'packages/sdui-parser',
  /** Governed by: NEITHER gate. Stated so a run can print it. */
  governedBy: 'neither — an author-time diagnostic vocabulary, ADR-0112 D6c genre',
});

/**
 * ## [#13131] A code-carrying helper that stamps through an OBJECT LITERAL is
 * ## invisible to `codehelper` — MEASURED, and deliberately NOT closed here
 *
 * `codehelper` above is anchored on an ASSIGNMENT: its regex is `.code = ident`.
 * The reasoning it implements — "the identifier is a PARAMETER, so the literals
 * live at the CALL SITES" — is a property of the HELPER, not of the assignment
 * operator, and it holds just as well for the equally ordinary helper that
 * builds an object literal:
 *
 *     function postureError(code: string, message: string) {
 *       return { severity: 'error', code, message };   // <- nothing matches
 *     }
 *
 * No shape in either gate anchors there. `objlit` needs a quote, `objlitconst`
 * needs a SCREAMING_SNAKE identifier after the colon (and the conventional
 * parameter name is `code`), `objlittemplate` needs backticks, and `codehelper`
 * needs the `.code =`. So this is worse than a wrong verdict: no pattern fires
 * at all, which means there is no site AND no unresolved entry either — nothing
 * is reported, and nothing says so. That is precisely the bound this gate
 * states for itself ("a value it cannot reduce is REPORTED, never dropped")
 * failing in the one way the bound cannot notice.
 *
 * ## TWO blindnesses, not one — and the second is why the first is not enough
 *
 * ① POSITION. The object-literal stamp position has no shape (above).
 * ② DECLARATION FORM. `enclosingDeclaration`'s `DECL_HEADER_RE` recognises
 *    `function f(`, `constructor(` and `const|let|var f = (` — and NO class
 *    method. So a code-carrying helper that is a METHOD is out of reach even in
 *    the position `codehelper` already implements: the same body that produces
 *    a site as a free function produces nothing as `private error(code, …)`.
 *    Measured with a same-genre positive control, and pinned below.
 *
 * These are independent, and the card's own live instance needs BOTH:
 * `Parser#error(code, message, start?, tag?)` in `packages/sdui-parser` is a
 * class method that stamps through an object literal. Widening the position
 * alone would still not reach it.
 *
 * ## The measurement (blast radius), on `packages/**` non-test source
 *
 * Method: the predicate — a `code` property of an object literal whose value is
 * an identifier that is a PARAMETER of the enclosing function — evaluated on
 * the real TypeScript AST, with call-site arguments reduced by THIS gate's own
 * literal grammar (`/^[A-Za-z][A-Za-z0-9_]*$/`, so a hyphen does not reduce)
 * and checked against the registered vocabulary and the declaration table.
 * A regex instrument was tried first and discarded: it matched `${code}` inside
 * a template and `f(a, code, b)` inside an argument list, and then LOST a true
 * positive because a bracket inside a regex literal unbalanced its scan.
 *
 *   predicate matches            13 helpers (12 named, 1 anonymous)
 *   (a) call sites newly reached 106   — 76 reduce to a literal, 30 do not
 *   (b) NEW verdict rows needed   29   — 0 of them already carry a row
 *   (c) undischargeable `unresolved` findings  4
 *
 * Split by whether `enclosingDeclaration` can see the declaration at all:
 *
 *   reachable today (blindness ① only)   9 helpers · 81 call sites · 29 rows · 1 unresolved
 *   blocked by blindness ②               4 helpers · 25 call sites ·  0 rows · 3 unresolved
 *
 * ⚠️ (b) is not the whole cost, and reading it as the whole cost is the trap
 * this note exists to prevent. All 29 new rows are LOWERCASE `FieldErrorCode`
 * diagnostics (`required`, `invalid_type`, `min_value`, …) in four files —
 * ADR-0112 D6 genre, not wire codes. The four `unresolved` findings are the
 * expensive half: an `unresolved` entry is pushed UNCONDITIONALLY and no
 * declaration row discharges it (see `reconcile`), so each one is a RED gate
 * with no verdict available — including `Parser#error`, whose 16 call sites all
 * pass kebab literals that this gate's grammar refuses to reduce.
 *
 * ## No victim today — verified, not assumed
 *
 * Of the 33 SCREAMING_SNAKE values reached, 33 are already registered; the
 * count of values that are BOTH ADR-0112 D1 shaped AND unregistered — i.e. a
 * real wire code hiding behind this blindness — is ZERO. `check:error-code-casing`
 * likewise reports nothing on any of the files involved. So the value of
 * closing this is preventing a future defect, not fixing a present one.
 *
 * ⚠️ One bound the measurement does NOT have. `helperCodesFor` scans only the
 * DECLARING file, so every count here is over IN-FILE call sites. An exported
 * helper called from other packages contributes 0 — `sendError` in
 * `packages/types/src/response-envelope.ts` has 0 in-file calls and is one of
 * the four `unresolved`. Counting cross-file callers needs resolution this
 * source scan does not have; that number is UNMEASURED, and it is a lower bound
 * on (a), never an upper one.
 *
 * ## ⛔ What this declaration deliberately does NOT do
 *
 * ⛔ It does not widen `codehelper`. Triage ruled the measuring round scoped to
 * measurement: 「先量出加宽后的爆炸半径, ⛔ 不先加宽。数没量出来之前,"该不该加宽"
 * 不是一个可裁的问题。」 The numbers above are that measurement; whether to
 * widen is now a decidable question and belongs on its own card, with the
 * verdict rows (`domain:cli`) as a rider on the same change.
 *
 * ⛔ It does not add verdict rows. A row for a site no shape derives is a
 * `stale-row` finding, so the rows cannot land before the widening.
 */
export const OBJECT_LITERAL_CODE_HELPER_BLINDNESS = Object.freeze({
  /**
   * The two spellings of the unseen position. Each is a complete helper whose
   * only difference from `SAME_GENRE_CONTROL` is the stamping line.
   */
  shorthand: `  return { severity: 'error', code, message };`,
  longhand: `  return { severity: 'error', code: code, message };`,
  /**
   * The SAME-GENRE POSITIVE CONTROL: the identical helper stamping through the
   * assignment `codehelper` does implement. `--self-test` runs both, so the
   * zero on the object-literal spellings is a READING rather than a harness
   * that stopped working — the discipline `KEBAB_DIAGNOSTIC_VOCABULARY` above
   * records, applied to a different axis.
   */
  control: `  const e = new Error(message);\n  (e as any).code = code;\n  return e;`,
  /** Unregistered in both `StandardErrorCode` and the ledger, in both casings. */
  probe: 'HELPER_SCREAMING',
  probeLowercase: 'helper_lowercase',
  /** Blindness ②: the declaration forms `enclosingDeclaration` cannot see. */
  invisibleDeclarationForms: Object.freeze(['class method', 'anonymous arrow']),
  /** The live instance, read as evidence only — it is NOT edited by this card. */
  liveInstance: 'packages/sdui-parser/src/parse.ts  Parser#error(code, message, start?, tag?)',
  /** Measured blast radius, `packages/**` non-test source. See the prose above. */
  measured: Object.freeze({
    helpers: 13,
    callSitesNewlyReached: 106,
    newVerdictRows: 29,
    undischargeableUnresolved: 4,
    unregisteredWireCodesHiding: 0,
  }),
});

const isTestFile = (rel) =>
  /\.(test|spec)\.[cm]?tsx?$/.test(rel) || /(^|\/)(__tests__|__mocks__|fixtures)\//.test(rel);

/**
 * The declaration file is a TABLE ABOUT producers, not a producer: every row
 * spells `code: 'X'` for a code stamped somewhere else, so scanning it makes the
 * gate rediscover its own contents as thirteen brand-new findings in the file
 * that classifies them. Excluded by path, and pinned by `--self-test` so the
 * exclusion cannot be widened into a blanket ignore that hides a real emitter.
 */
const isDeclarationFile = (rel) => rel === DECLARATION;

/** [#9223] Every workspace `package.json` under the scan root. */
export function* walkManifests(dir, root) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      yield* walkManifests(abs, root);
      continue;
    }
    if (entry !== 'package.json') continue;
    yield { rel: relative(root, abs).replace(/\\/g, '/'), abs };
  }
}

export function* walkSources(dir, root) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      yield* walkSources(abs, root);
      continue;
    }
    if (!/\.[cm]?tsx?$/.test(entry) || /\.d\.[cm]?ts$/.test(entry)) continue;
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (isTestFile(rel) || isDeclarationFile(rel)) continue;
    yield { rel, abs };
  }
}

/**
 * `@objectstack/spec/api` → `@objectstack/spec`; `node:path` → `node:path`.
 * The subpath is dropped because the package's export map, not the subpath,
 * decides which file actually declares a name — and this gate reads source.
 */
export function packageOfSpecifier(spec) {
  const m = /^(@[^/]+\/[^/]+|[^./][^/]*)/.exec(spec);
  return m ? m[1] : null;
}

/**
 * `name` → repo-relative directory, read from each workspace `package.json`.
 * Derived rather than assumed: `@objectstack/plugin-auth` lives at
 * `packages/plugins/plugin-auth`, so name-to-path arithmetic answers wrongly.
 */
export function parsePackageDirs(manifests) {
  const dirs = new Map();
  for (const { rel, source } of manifests) {
    let name;
    try { name = JSON.parse(source).name; } catch { continue; }
    if (typeof name === 'string' && name) dirs.set(name, rel.replace(/\/package\.json$/, ''));
  }
  return dirs;
}

/**
 * [#9568] The literal values an initializer EXPRESSION can hold, or `null` when
 * any limb of it is something a source scan cannot reduce.
 *
 * ## Why a SET of values rather than one
 *
 * `const code = intent === 'runtime-only' ? 'NOT_CREATABLE' : 'NOT_OVERRIDABLE'`
 * is a live 403 in `sys-metadata-repository.ts` that stamps TWO codes through
 * one identifier. A resolver that answers with one string has to pick a branch,
 * and picking is exactly what this gate refuses to do elsewhere (see the
 * two-drivers hazard below) — so resolution is value-SET valued end to end and
 * a ternary contributes both of its branches as sites.
 *
 * ## Why it stops where it does
 *
 * Reduction is ALL-OR-NOTHING per expression. `asSemanticCode(a) ?? asSemanticCode(b)`
 * (`packages/client`) has no literal in it at all, and a rule that harvested
 * the literal limbs of a partly-runtime expression would report a code the
 * program may never stamp while staying silent about the limb it cannot see —
 * a finding that is wrong in both directions at once. So: every limb reduces,
 * or the expression does not, and an unreducible one keeps the treatment its
 * shape already had (reported as unresolved where a constant was expected, out
 * of reach where a runtime local was).
 *
 * Reduced: a quoted literal · a ternary of reducible branches (nested, and the
 * CONDITION is never evaluated — only the branches must reduce) · a `||` / `??`
 * chain whose every operand reduces · either wearing parentheses or `as const`.
 * An identifier limb is handed to `resolveIdent`, which is how a ternary of two
 * named constants reduces; `depth` bounds a self-referential one rather than
 * spinning on it.
 */
export function literalCodeValues(expr, resolveIdent = () => null, depth = 0) {
  if (depth > 8) return null;
  const e = unwrapExpression(expr);
  if (!e) return null;

  const lit = /^'([A-Za-z][A-Za-z0-9_]*)'$/.exec(e) ?? /^`([A-Za-z][A-Za-z0-9_]*)`$/.exec(e);
  if (lit) return [lit[1]];

  const ternary = splitTernary(e);
  if (ternary) {
    const whenTrue = literalCodeValues(ternary[0], resolveIdent, depth + 1);
    const whenFalse = literalCodeValues(ternary[1], resolveIdent, depth + 1);
    if (!whenTrue || !whenFalse) return null;
    return [...new Set([...whenTrue, ...whenFalse])];
  }

  const chain = splitChain(e);
  if (chain) {
    const out = new Set();
    for (const operand of chain) {
      const vals = literalCodeValues(operand, resolveIdent, depth + 1);
      if (!vals) return null;
      for (const v of vals) out.add(v);
    }
    return out.size ? [...out] : null;
  }

  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const via = resolveIdent(e, depth + 1);
    return via && via.length ? via : null;
  }
  return null;
}

/** `('A')` and `'A' as const` are the same value wearing decoration. */
function unwrapExpression(expr) {
  let e = String(expr ?? '').trim();
  for (let i = 0; i < 8; i += 1) {
    const undecorated = e.replace(/\s+as\s+const$/, '').trim();
    if (undecorated !== e) { e = undecorated; continue; }
    if (e.startsWith('(') && sliceBalanced(e, 0) === e.slice(1, -1) && e.endsWith(')')) {
      e = e.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return e;
}

/**
 * Walk `src` calling `visit(char, index)` only at TOP level — inside no bracket,
 * no string and no template. Brackets only: `<` and `>` are comparison operators
 * far more often than generics inside a value expression, and counting them as
 * depth reads `a < b ? 'A' : 'B'` as unbalanced and gives up on a reducible one.
 */
function scanTopLevel(src, visit) {
  let depth = 0;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      continue;
    }
    if (depth === 0 && visit(c, i) === false) return;
  }
}

/** `cond ? A : B` → `[A, B]`, or `null`. Nested ternaries keep their own colon. */
export function splitTernary(expr) {
  let question = -1;
  scanTopLevel(expr, (c, i) => {
    if (c !== '?' || question >= 0) return;
    // `??` and `?.` are not the conditional operator.
    if (expr[i + 1] === '?' || expr[i + 1] === '.' || expr[i - 1] === '?') return;
    question = i;
    return false;
  });
  if (question < 0) return null;

  let nested = 0;
  let colon = -1;
  scanTopLevel(expr.slice(question + 1), (c, i) => {
    if (c === '?' ) {
      const rest = expr.slice(question + 1);
      if (rest[i + 1] === '?' || rest[i + 1] === '.' || rest[i - 1] === '?') return;
      nested += 1;
      return;
    }
    if (c !== ':') return;
    if (nested === 0) { colon = question + 1 + i; return false; }
    nested -= 1;
  });
  if (colon < 0) return null;
  return [expr.slice(question + 1, colon), expr.slice(colon + 1)];
}

/** `A ?? B ?? C` / `A || B` → the operands, or `null` when there is no chain. */
export function splitChain(expr) {
  const cuts = [];
  scanTopLevel(expr, (c, i) => {
    if ((c === '|' && expr[i + 1] === '|') || (c === '?' && expr[i + 1] === '?')) {
      if (cuts.length && i === cuts[cuts.length - 1] + 1) return; // the second char of the pair
      cuts.push(i);
    }
  });
  if (!cuts.length) return null;
  const parts = [];
  let start = 0;
  for (const cut of cuts) {
    parts.push(expr.slice(start, cut));
    start = cut + 2;
  }
  parts.push(expr.slice(start));
  return parts;
}

/**
 * [#9568] Every `const NAME = …` in `source`, as raw initializer text — the
 * declaration's own `;` terminates it, so a multi-line ternary survives intact.
 *
 * [#10918] `let` and `var` too. The anchor read `const` alone, so a code held
 * in a `let` reduced to nothing — `resolveConstant` answered `null`, the
 * `codehelper` branch read that as the runtime-value bound and contributed NO
 * site and NO unresolved, even when the value was a plain literal sitting right
 * there in the source. That is not the bound #9568 wrote ("a value spelled out
 * in every branch is not out of reach, whichever shape it arrives through"); it
 * was out of reach only because of how the anchor was spelled.
 *
 * This function stays purely syntactic — it answers "what initializers are
 * written for this name", not "what values does the name hold". Those differ
 * for a mutable binding, and the difference is `reassignedInFile`'s job below;
 * `inFileValues` is where the two are combined.
 */
export function declaredInitializers(name, source, { exported = false } = {}) {
  const head = new RegExp(
    `\\b${exported ? 'export\\s+' : '(?:export\\s+)?'}(?:const|let|var)\\s+${name}\\s*(?::[^=;\\n]+)?=\\s*`,
    'g',
  );
  const inits = [];
  for (const m of source.matchAll(head)) {
    const from = m.index + m[0].length;
    let end = -1;
    scanTopLevel(source.slice(from, from + 2000), (c, i) => {
      if (c !== ';') return;
      end = i;
      return false;
    });
    if (end < 0) continue; // no terminator in reach — not something to reduce
    inits.push(source.slice(from, from + end));
  }
  return inits;
}

/**
 * [#10918] Is `name` declared MUTABLE (`let`/`var`, WITH an initializer) in
 * `source`?
 *
 * The initializer is required deliberately. `let code;` followed by
 * `code = compute()` has nothing spelled out to read and is the runtime-value
 * bound #9460 states, not a value this scan declined to reduce — treating it as
 * the latter is how "report what you cannot reduce" turns into "report every
 * domain field named `code`", which this gate already refuses to do.
 */
export function declaredMutably(name, source, { exported = false } = {}) {
  return new RegExp(
    `\\b${exported ? 'export\\s+' : '(?:export\\s+)?'}(?:let|var)\\s+${name}\\s*(?::[^=;\\n]+)?=`,
  ).test(source);
}

/**
 * [#10918] Does `source` ASSIGN to `name` somewhere other than its declaration?
 *
 * This is the whole difficulty of widening the anchor above. A `let` can be
 * reassigned, so the set of values it holds is NOT its initializer — reducing
 * it to the initializer alone would report a value the program may never stamp,
 * which is the same wrongness the ALL-OR-NOTHING rule (#9568) exists to refuse.
 *
 * Deliberately biased toward OVER-detection, because the two errors are not
 * symmetric: a false "reassigned" costs a reduction we could have made (the
 * value is reported as unresolved instead — loud, and discharged by fixing the
 * source), while a missed reassignment costs a site asserted out of a value the
 * program may never stamp — silent, and wrong in the direction #9568 named. So
 * a destructuring default (`const { code = 'X' } = p`) and a `code` inside a
 * template string both read as reassignment here, and that is the safe answer.
 *
 * File-local is COMPLETE, not an approximation: a local cannot be assigned from
 * another file, and ES modules forbid an importer assigning to an imported
 * binding — only the declaring module can reassign an `export let`.
 *
 * Compound forms count (`code += x`, `code ||= x`, `code ??= x`); comparisons
 * and arrows do not (`==`, `===`, `>=`, `=>`), nor does a property of the same
 * name (`err.code = x`, `p?.code = x`) — that is a stamp, not a rebinding.
 */
export function reassignedInFile(name, source) {
  const re = new RegExp(
    `(^|[^\\w$.])${name}\\s*(?:\\|\\||&&|\\?\\?|[-+*/%&|^])?=(?![=>])`,
    'g',
  );
  for (const m of source.matchAll(re)) {
    // The declaration's own `=` is not a reassignment.
    if (/\b(?:const|let|var)\s+$/.test(source.slice(0, m.index + m[1].length))) continue;
    return true;
  }
  return false;
}

/**
 * [#10918] `name` is declared mutable in this file, this file reassigns it, AND
 * at least one of its written initializers reduces to literal code values.
 *
 * That conjunction is the reportable class, and each conjunct earns its place:
 *
 *   - mutable + reassigned ⇒ the initializer is not the value set, so
 *     `inFileValues` refuses to reduce it (below). Correct, but on its own it
 *     is SILENT in the `codehelper` position — the same silence this widening
 *     exists to end.
 *   - a reducible initializer ⇒ there IS a code spelled out in the source that
 *     we can see and are declining to claim. That is exactly what "reported as
 *     unresolved, never dropped" is for.
 *
 * Without the third conjunct this would report every runtime-valued mutable
 * local named `code` — `let code: unknown | null = null; code = read(x)` is the
 * live shape in `packages/metadata-protocol` — and turning those into a red
 * gate is the silencing pressure this family keeps re-learning (#9460, #9568).
 * There is no literal there, so there is nothing to report and nothing to fix.
 */
export function reassignedMutableLiteral(name, source, opts = {}) {
  if (!declaredMutably(name, source, opts)) return false;
  if (!reassignedInFile(name, source)) return false;
  return declaredInitializers(name, source, opts).some((init) =>
    literalCodeValues(init, (id, d) => (id === name ? null : inFileValues(id, source, opts, d))),
  );
}

/**
 * [#9568] The values `name` can hold according to THIS source, or `null`.
 *
 * Two declarations of one name that reduce differently answer `null` rather
 * than first-wins: a file-wide textual lookup has no scopes, so "the first
 * `const code = …` in the file" is a guess exactly like the repo-wide lookup
 * the two-drivers hazard rules out. Identifier limbs resolve within this same
 * source only — following an import from inside a ternary would need the
 * importing file's scope for each limb, and the shape that needs it has not
 * appeared.
 *
 * [#10918] A name this file declares MUTABLY and also reassigns answers `null`
 * for the same reason two differently-reducing declarations do: the written
 * initializers are not the value set, and half a value set is a finding wrong
 * in both directions at once. The refusal is file-wide rather than per
 * declaration — dropping just the mutable declarator and reducing the rest
 * would be the first-wins guess the two-drivers hazard rules out.
 */
function inFileValues(name, source, opts = {}, depth = 0) {
  const inits = declaredInitializers(name, source, opts);
  if (!inits.length) return null;
  if (declaredMutably(name, source, opts) && reassignedInFile(name, source)) return null;
  const sets = [];
  for (const init of inits) {
    const vals = literalCodeValues(init, (id, d) => (id === name ? null : inFileValues(id, source, opts, d)), depth);
    if (!vals) return null;
    sets.push(vals);
  }
  const distinct = new Set(sets.map((s) => [...s].sort().join('|')));
  return distinct.size === 1 ? sets[0] : null;
}

/**
 * Resolve `NAME` to the string values it can hold: the declaring file first,
 * then the module it is imported from. Two packages export a
 * `MULTI_TENANT_UNSUPPORTED_CODE` with DIFFERENT values, so a repo-wide name
 * lookup would answer confidently and wrongly — the in-file declaration has to
 * win, and the import has to be followed to its own file rather than guessed.
 *
 * [#9223] A bare specifier is followed too, but ONLY when it names a workspace
 * package: `import { ANONYMOUS_DENY_CODE } from '@objectstack/core'` points at
 * `packages/core/`, which is inside this scan by construction, so treating it
 * as out of reach reported eight resolvable constants as unresolvable. The
 * lookup is scoped to THAT package's sources and requires a UNIQUE value — the
 * two-drivers-one-constant-name hazard above is a repo-wide lookup's failure,
 * and the same hazard inside one package (two spellings, two values) resolves
 * to `null` and is reported rather than guessed. A genuine third-party
 * dependency has no workspace directory and stays out of reach.
 *
 * [#9568] Returns an ARRAY — a constant whose initializer is a ternary or a
 * `||`/`??` chain of literals holds more than one code, and every branch is a
 * real stamp. `null` when it cannot be resolved; the caller reports that, never
 * drops it.
 */
export function resolveConstant(name, fileSource, fileRel, readFile, ctx = {}) {
  const local = inFileValues(name, fileSource);
  if (local) return local;

  // `import { A, NAME, B } from './x.js'` — find the specifier that names it.
  const imports = [...fileSource.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/g)];
  for (const [, clause, spec] of imports) {
    const named = clause.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (!named.includes(name)) continue;
    if (!spec.startsWith('.')) return resolveFromWorkspacePackage(name, spec, ctx);
    const base = join(dirname(fileRel), spec.replace(/\.[cm]?js$/, ''));
    for (const cand of [`${base}.ts`, `${base}.mts`, `${base}/index.ts`]) {
      const abs = join(ROOT, cand);
      if (!existsSync(abs)) continue;
      const target = maskComments(readFile(abs));
      const hit = inFileValues(name, target, { exported: true });
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

/**
 * [#9223] A template's FAMILY identity: every `${…}` becomes `*`, so
 * `` `APPROVAL_${action.toUpperCase()}_FAILED` `` is `APPROVAL_*_FAILED`.
 *
 * Why an identity rather than an unresolved note. The gate's declared bound is
 * that a value it cannot reduce to a literal is REPORTED, never dropped — and
 * the strongest available report is the one the rest of this gate already uses:
 * a SITE, which the declaration table must classify with evidence and which
 * reconciles in BOTH directions (the row goes stale when the template moves).
 * An "unresolved" note would be reported once and could never be discharged,
 * which in practice means a permanently red gate or a deleted check.
 *
 * The family is also the right grain: the three approvals routes differ only in
 * how they spell the interpolation, one runtime pin covers all three, and a
 * NEW family (`BILLING_*_FAILED`) is a new identity and a new finding.
 */
export function templateFamily(raw) {
  return raw.replace(/\$\{[^}]*\}/g, '*');
}

/**
 * [#9223] The workspace half of the resolver. Scoped to the named package's
 * own scanned sources, and unique-or-nothing: two different values for one
 * name inside one package is exactly the ambiguity this gate must report
 * rather than pick a side of.
 */
function resolveFromWorkspacePackage(name, spec, { scanned, packageDirs } = {}) {
  if (!scanned || !packageDirs) return null;
  const dir = packageDirs.get(packageOfSpecifier(spec) ?? '');
  if (!dir) return null; // a genuine third-party dependency — out of scan reach
  // [#9568] Unique-or-nothing over the VALUE SETS, not over single values: a
  // ternary-valued export is one answer with two codes in it, and two files
  // answering the same pair is still one answer.
  const answers = new Map();
  for (const f of scanned) {
    if (!f.rel.startsWith(`${dir}/`)) continue;
    const values = inFileValues(name, f.stripped, { exported: true });
    if (values) answers.set([...values].sort().join('|'), values);
  }
  return answers.size === 1 ? [...answers.values()][0] : null;
}

/**
 * [#9460] The code-carrying-helper resolver.
 *
 * ## The shape, and why no `code`-anchored pattern can see it
 *
 * A file declares one small factory and throws through it everywhere:
 *
 *     function postureError(code: string, message: string): Error {
 *       const err = new Error(`[${code}] ${message}`);
 *       (err as any).code = code;                 // ← the stamp
 *       return err;
 *     }
 *     throw postureError('owd_widening_forbidden', '…');   // ← the value
 *
 * The stamp knows the token `code` but not the value; the call site knows the
 * value but never writes the token `code`. Every pattern in this gate AND every
 * pattern in `check:error-code-casing` anchors on the token — so both gates
 * read this file and both report nothing, each leaving it to the other. That is
 * how a live 403 refusal carrying a lowercase code sat unswept through two
 * vocabulary batches: not a missing table row, and not a case-sensitive regex,
 * but a stamp position with no `code` token next to its literal.
 *
 * The join is the PARAMETER: the assigned identifier is one of the enclosing
 * declaration's parameters, so its INDEX names the argument to read at each
 * call site. The index is derived, never assumed to be zero —
 * `makeError(status, code, message)` and `exposureError(message, code, status)`
 * both put it second, and a first-argument rule would have read a number and an
 * English sentence as error codes.
 *
 * Bounds, stated because a resolver that goes quietly blind is this gate's own
 * failure mode one layer down:
 *   - IN-FILE call sites only. These factories are file-local by construction
 *     (none is exported); an exported one resolves to no literals and is
 *     REPORTED as unresolved rather than passed.
 *   - An argument is read as a quoted literal, or as a CONSTANT put through the
 *     same `resolveConstant` the other indirect shapes use — the MCP bridge
 *     throws `exposureError(msg, OBJECT_API_DISABLED, 404)`, so a literals-only
 *     rule would have found the helper, seen no literal, and reported an
 *     unresolvable it could in fact resolve. An argument that reduces to
 *     neither contributes no site, and a helper that yields NOTHING at all is
 *     reported, never dropped.
 */

/** The substring inside the parentheses opening at `open`, brackets balanced. */
export function sliceBalanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
    }
  }
  return null;
}

/** Split on TOP-LEVEL commas — a nested call, generic or template keeps its own. */
export function splitTopLevel(args) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth -= 1;
    else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < args.length && args[i] !== quote) i += args[i] === '\\' ? 2 : 1;
    } else if (c === ',' && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out;
}

/**
 * [#13227] The leading MODIFIER RUN of a TypeScript parameter, enumerated from
 * the grammar rather than approximated.
 *
 * A parameter property admits an accessibility modifier, then `override`, then
 * `readonly` — in that fixed order, up to THREE of them, and the compiler
 * rejects any other order (`readonly public x` → "'public' modifier must
 * precede 'readonly' modifier"; `readonly override x` → "'override' modifier
 * must precede 'readonly' modifier"). Measured against the repo's own
 * TypeScript 6.0.3 on a derived class, because `override` is only legal where a
 * base class exists and a check on a standalone class reports it as a class
 * error rather than as a parameter one. `static` and `abstract` are rejected on
 * a parameter outright, and `in`/`out` are TYPE-parameter modifiers, which
 * never appear in the value-parameter slice `enclosingDeclaration` hands over.
 *
 * The order is encoded rather than looped deliberately: a "strip any word in
 * this set, repeatedly" loop accepts spellings TypeScript does not, which is
 * the match-everything direction this gate has paid for before.
 */
const PARAM_MODIFIER_RUN = /^(?:(?:public|private|protected)\s+)?(?:override\s+)?(?:readonly\s+)?/;

/**
 * Parameter NAMES, in order: `readonly a: T = x` → `a`,
 * [#13227] `private readonly code: string` → `code`.
 *
 * The strip used to be a single anchored alternation carrying a `g` flag. The
 * flag reads as "strip them all", but `^` with no `m` matches at position 0
 * once, so exactly ONE modifier came off: `private readonly code: string`
 * parsed as a parameter literally named `readonly`, and `helperCodesFor`'s
 * `indexOf(ident)` then answered -1 — no site, no unresolved, the whole helper
 * dropped in silence, one layer inside the same failure class as #9223 /
 * #9460 / #10918 / #13131.
 *
 * ⚠️ A modifier word is only a modifier when a NAME follows it. `readonly`,
 * `override` and the accessibility words are not reserved, so each is a legal
 * parameter name in its own right — `override: MetricsRegistry | undefined` is
 * live in this tree three times over. `override:` / `override?:` never enter
 * the run (no whitespace follows the word), and the guard below covers the
 * spaced spelling `readonly : T`, where the run would otherwise eat the
 * parameter's own name and report nothing.
 *
 * ⛔ Textual on purpose, and the reason is measured rather than inherited.
 * `enclosingDeclaration`'s `DECL_HEADER_RE` also matches `const x = someCall(`,
 * so of the 7646 slices this function is handed on `packages/**` non-test
 * source, 1218 are not a valid parameter list at all — they are ARGUMENT
 * lists — and on 1072 of those a recovering TypeScript parse invents MORE THAN
 * ONE parameter: `authService as any` becomes three confident parameters named
 * `authService`, `as` and `any`; `await res.json()` becomes `await`, `res`,
 * `json`. Those names are exactly what `helperCodesFor` searches with
 * `indexOf(ident)`, so an AST route would MANUFACTURE the wrong-INDEX hazard
 * this card only warns about — a finding that reads as ordinary while naming a
 * value from another argument position — across a thousand slices. A textual
 * reader degrades to one bad name instead of several. The over-matching header
 * regex is #13226's subject and is deliberately untouched here.
 */
export function parseParamNames(params) {
  if (!params.trim()) return [];
  return splitTopLevel(params).map((raw) => {
    const rest = raw.trim().replace(/^\.\.\.\s*/, '');
    const run = PARAM_MODIFIER_RUN.exec(rest)[0];
    const tail = rest.slice(run.length);
    const cleaned = /^[A-Za-z_$]/.test(tail) ? tail : rest;
    const m = /^([A-Za-z_$][\w$]*)/.exec(cleaned);
    return m ? m[1] : '';
  });
}

/**
 * [#13226] Words that open a parenthesised head but are NOT a method name.
 *
 * The list lives INSIDE the regex as a lookahead rather than in a post-match
 * `continue`, and that placement is load-bearing. A consumed match moves
 * `matchAll`'s cursor past it, so rejecting a word in JavaScript would eat the
 * very text a LATER alternative needs: the method form below is anchored at
 * the start of a line, so on `  public constructor(` it starts EARLIER than
 * the `constructor` alternative and wins the position. Reject it in code and
 * the constructor form goes blind the moment a class spells its constructor
 * with an accessibility modifier. Failing the alternative inside the regex
 * lets the engine advance and try the others at the next position.
 *
 * Only words that actually produce the `NAME(...) {` shape are listed —
 * `if (x) {`, `return (a) => {`, `} catch (e) {`. `type`, `interface`, `enum`
 * and `declare` are NOT here: they never take that shape, and each is a legal
 * method name a blanket keyword list would silently make unreachable.
 */
const NOT_A_METHOD_NAME =
  'if|for|while|switch|catch|do|else|case|return|throw|new|delete|void|typeof|await|yield|super|function|constructor|class|import|export|const|let|var';

/**
 * [#13226] A class-method HEADER, and why it is spelled as a header SHAPE
 * rather than as "directly inside a class body".
 *
 * The other three forms carry their own keyword (`function`, `constructor`,
 * `const|let|var`). A method header does not — it is bare `NAME(` — so the
 * discriminator the card names is CONTEXT: being directly inside a class body.
 * A textual scan has to earn that, and the honest reading is that it cannot,
 * for a measured reason rather than a squeamish one. Brace depth is the only
 * textual route to "inside a class body", and the source this gate scans is
 * `maskComments`ed, which by contract leaves STRINGS, TEMPLATES and REGEX
 * LITERALS standing — so a `{` inside a string flips the depth of everything
 * after it. Masking literals too (`scanSource` exposes the flags) fixes that
 * half and leaves the other: finding where a class BODY opens means walking
 * `class X extends Y<{ a: string }>` past a brace that sits inside a type
 * argument, and telling a type argument from a comparison textually is the
 * problem TypeScript wrote a parser for. An AST route was weighed and refused
 * on the evidence already in `parseParamNames` above: over-matching headers
 * hand this scan 1218 argument lists a recovering parse turns into confident
 * wrong parameter names, so a parser here MANUFACTURES the wrong-INDEX hazard
 * across a thousand slices to close one blindness.
 *
 * So the discriminator implemented is the header's own shape, which a textual
 * scan CAN earn:
 *
 *   line start · optional modifier run · NAME · balanced `(...)` · optional
 *   return-type annotation · `{`
 *
 * The trailing `{` is the half that does the work. It is what separates a
 * method from a line-initial CALL (`sendError(res, 400);` — a `;` follows) and
 * from an interface or `abstract` SIGNATURE (`error(code: string): void;` — no
 * body, so no stamp can be inside it either). The keyword lookahead above
 * removes the statement forms that share the shape.
 *
 * ⚠️ DECLARED, not accidental: this shape also admits an OBJECT-LITERAL method
 * (`const handlers = { fail(code, message) { … } }`). That is the same helper
 * genre — a named parameter list with a body — and admitting it is a widening
 * beyond the card's `class method`, so it is stated here rather than left to be
 * discovered. It costs nothing today (measured: zero object-literal methods in
 * `packages/**` non-test source stamp a code in the assignment position) and it
 * cannot produce a WRONG site if one appears: `helperCodesFor` admits only a
 * `this.` receiver, so an `obj.fail(…)` caller matches nothing, the helper
 * reduces to no literals, and it is REPORTED as `unresolved` — the bound this
 * gate states, degrading in the safe direction.
 *
 * ⛔ Still NOT recognised, and deliberately: a class PROPERTY holding an arrow
 * (`private fail = (code) => { … }`). It is a fourth declaration form, not this
 * one, and no census has been run on it.
 */
const METHOD_HEADER = String.raw`(?:^|\n)[ \t]*(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:abstract\s+)?(?:override\s+)?(?:async\s+)?(?:\*\s*)?(?:(?:get|set)\s+)?(?!(?:${NOT_A_METHOD_NAME})\s*\()([A-Za-z_$][\w$]*)\s*\(`;

/** A method header owns a BODY: `): void {`, `) {` — never `): void;` or `);`. */
const METHOD_BODY_FOLLOWS_RE = /^[ \t]*(?::[^\n{;]*)?\{/;

/** Declaration headers that own a parameter list, with the offset of their `(`. */
const DECL_HEADER_RE = new RegExp(
  [
    String.raw`\bfunction\s+([A-Za-z_$][\w$]*)\s*\(`,
    String.raw`\bconstructor\s*\(`,
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:function\s*[A-Za-z_$][\w$]*\s*)?\(`,
    METHOD_HEADER,
  ].join('|'),
  'g',
);

/**
 * The declaration enclosing `offset`: `{ name, params, isConstructor, isMethod }`,
 * or `null`. Nearest-preceding-header, which is what a textual scan can honestly
 * offer — a helper is a handful of lines and its stamp sits inside it.
 */
export function enclosingDeclaration(src, offset) {
  DECL_HEADER_RE.lastIndex = 0;
  let best = null;
  for (const m of src.matchAll(DECL_HEADER_RE)) {
    if (m.index >= offset) break;
    const open = m.index + m[0].length - 1;
    const params = sliceBalanced(src, open);
    if (params === null) continue;
    const isConstructor = /\bconstructor\s*\($/.test(m[0]);
    const isMethod = m[3] !== undefined;
    // [#13226] The header must own a BODY. Checked here rather than in the
    // regex because it reads past the balanced parameter list, which is
    // `sliceBalanced`'s job and not a regex's.
    if (isMethod && !METHOD_BODY_FOLLOWS_RE.test(src.slice(open + params.length + 2))) continue;
    let name = m[1] ?? m[2] ?? m[3] ?? null;
    if (isConstructor) {
      const before = src.slice(0, m.index);
      // The LAST class declared before this constructor, not the first — a
      // greedy `[\s\S]*$` anchor answers with the file's first class and
      // silently mis-names every helper in a multi-class file.
      let cls = null;
      for (const c of before.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) cls = c[1];
      name = cls;
    }
    if (!name) continue;
    best = { name, params, isConstructor, isMethod, open, end: open + params.length + 2 };
  }
  return best;
}

/**
 * Literal codes a code-carrying helper is called with, or `null` when the
 * assigned identifier is not one of the enclosing declaration's parameters
 * (so the site is an ordinary unresolvable constant, reported as such).
 */
export function helperCodesFor(ident, offset, src, resolveIdent = () => null) {
  const decl = enclosingDeclaration(src, offset);
  if (!decl) return null;
  const index = parseParamNames(decl.params).indexOf(ident);
  if (index < 0) return null;

  // [#13226] A METHOD is reached through a RECEIVER. The plain form below
  // excludes a preceding `.` on purpose — without that, a property access
  // `err.fail(` would read as a call to a free function named `fail` — so a
  // method needs the receiver spelled back in, or every method helper reduces
  // to nothing and lands as `unresolved` no matter how literal its callers are.
  // `this.` and only `this.`: the scan is IN-FILE, so a method helper's callers
  // here are its own siblings. Any other receiver stays unmatched, which is the
  // safe direction — the helper reports as `unresolved` rather than borrowing
  // an argument list from a same-named method on some other object.
  const callRe = decl.isConstructor
    ? new RegExp(`\\bnew\\s+${decl.name}\\s*\\(`, 'g')
    : decl.isMethod
      ? new RegExp(`(?:^|[^\\w.$])(?:this\\.)?${decl.name}\\s*\\(`, 'g')
      : new RegExp(`(?:^|[^\\w.$])${decl.name}\\s*\\(`, 'g');
  const codes = new Set();
  for (const call of src.matchAll(callRe)) {
    const open = call.index + call[0].length - 1;
    // The declaration's own header is not a call to itself. Checked by OFFSET
    // as well as by text: [#13226] a method header is preceded by a modifier or
    // by nothing at all, so the textual guard below cannot see it, and the
    // header's own parameter list would otherwise be read as an argument list.
    if (open === decl.open) continue;
    if (/\b(?:function|const|let|var)\s*$/.test(src.slice(Math.max(0, call.index - 12), call.index + call[0].length - decl.name.length - 1))) continue;
    const args = sliceBalanced(src, open);
    if (args === null) continue;
    const parts = splitTopLevel(args);
    const arg = (parts[index] ?? '').trim();
    // [#9568] One value-level reducer for all three argument spellings: a
    // quoted literal, a constant (the MCP bridge's `exposureError(msg, CONST,
    // 404)`), and — the class this widening adds — a ternary or `||`/`??`
    // chain of literals handed straight to the helper.
    const values = literalCodeValues(arg, resolveIdent);
    if (values) for (const v of values) codes.add(v);
  }
  return [...codes];
}

/**
 * One entry per (file, shape, value). The same constant stamped six times in
 * one file is one unresolved value to go and fix, not six lines of noise —
 * but the file is part of the key, so the same name in two files (the
 * two-drivers-one-constant-name case) stays two findings.
 */
function addUnresolved(list, entry) {
  if (list.some((u) => u.file === entry.file && u.shape === entry.shape && u.value === entry.value)) return;
  list.push(entry);
}

/**
 * Every site in scanned source that stamps a code the registered vocabulary
 * does not contain.
 */
export function deriveSites({ registered, files, readFile, packageDirs = new Map() }) {
  const sites = [];
  const unresolved = [];
  // Stripped once: the workspace resolver reads these same sources, and a
  // comment naming a constant must not resolve one either.
  const scanned = files.map(({ rel, source }) => ({ rel, stripped: maskComments(source) }));
  const ctx = { scanned, packageDirs };

  /**
   * [#9460] Is this value this gate's to report?
   *
   * A SCREAMING_SNAKE code always is. A lowercase or mixed-case one is outside
   * the ADR-0112 value space (D1) by definition, so the only question is WHICH
   * gate reports it — and the answer is the one that can actually see it.
   *
   * `check:error-code-casing` owns the lowercase sweep, and every pattern it
   * has requires a QUOTED lowercase literal sitting next to the token `code`:
   * `code: 'x'`, `.code = 'x'`, `code === 'x'`, `code?: 'x' | 'y'`,
   * [#10760] `code: parsed?.code || 'x'` / `.code = e?.code ?? 'x'`, the
   * OUR-DEFAULT slot of a `||`/`??` fallback chain (that gate's `fallback`
   * pattern), and [#10897] the same slot in a `code`-named local's
   * initializer, `const code = parsed?.code || 'x'` (its `local-fallback`
   * pattern). Each still captures only a literal, which in our source is the
   * default we author. Where this
   * gate finds a lowercase code in one of those same positions — `objlit`,
   * `assign` — the delegation is real: that gate sees the identical text, and
   * it carries the D6/D6b/D6c discrimination (field-addressed catalogs,
   * persisted audit columns, diagnostics payloads, Zod's own issue codes) that
   * decides which lowercase literals are legitimate. Reporting those here would
   * duplicate a gate that answers better, and would call Zod's `code: 'custom'`
   * an unregistered ObjectStack error code, which is simply false.
   *
   * But a code that arrives through a CONSTANT, a TEMPLATE, or a HELPER
   * PARAMETER has no quoted literal at the stamp site for a `code`-anchored
   * pattern to match, so that gate is structurally blind to it — and this gate
   * dropping it for its casing meant NOBODY reported it. That is not a
   * delegation; it is a hole between two gates, each assuming the other. Those
   * shapes are marked `lowercase: 'here'` and are reported.
   *
   * So the measured question is "is this code outside the vocabulary and unowned
   * by the gate we hand lowercase to", never "is it SCREAMING_SNAKE".
   */
  const keep = (value, shapeName, isFamily = false) => {
    const screaming = isFamily ? /^[A-Z*][A-Z0-9_*]*$/ : /^[A-Z][A-Z0-9_]*$/;
    if (!screaming.test(value)) {
      const shape = SHAPES.find((sh) => sh.name === shapeName);
      const owner = shapeName === 'codehelper' ? 'here' : shape?.lowercase ?? 'here';
      if (owner === 'casing-gate') return false;
    }
    return !registered.has(value);
  };

  for (const { rel, stripped } of scanned) {
    for (const shape of SHAPES) {
      shape.re.lastIndex = 0;
      for (const m of stripped.matchAll(shape.re)) {
        let code = m[1];
        let emitAs = shape.name;
        const emit = (value, shapeName) => {
          if (!keep(value, shapeName)) return;
          if (sites.some((s) => s.code === value && s.file === rel && s.shape === shapeName)) return;
          sites.push({ code: value, file: rel, shape: shapeName });
        };
        if (shape.resolve === 'constant') {
          // [#9568] A constant holds a SET of values — `const X = c ? 'A' : 'B'`
          // stamps both, and each is its own site to classify.
          const values = resolveConstant(code, stripped, rel, readFile, ctx);
          if (values === null || values.length === 0) {
            addUnresolved(unresolved, { file: rel, shape: shape.name, value: code, reason: 'constant' });
            continue;
          }
          for (const value of values) emit(value, shape.name);
          continue;
        } else if (shape.resolve === 'helper') {
          // [#9460] Structural: the identifier must be a PARAMETER of the
          // enclosing declaration. Anything else — a module constant, a local
          // holding a runtime value — is not this shape, and `null` here means
          // "not a helper", not "a code I dropped": the constant case is
          // `assignconst`'s, and the runtime case is a declared bound above.
          const helperCodes = helperCodesFor(code, m.index, stripped, (arg) =>
            resolveConstant(arg, stripped, rel, readFile, ctx),
          );
          if (helperCodes === null) {
            // [#9568] Not a parameter — so this is the OTHER indirection the
            // assign position carries: an identifier holding a constant. It
            // reaches here rather than `assignconst` only because that shape's
            // regex reads the SCREAMING_SNAKE module-constant convention, and
            // the live case is a lower-case LOCAL: `const code = intent === 'x'
            // ? 'NOT_CREATABLE' : 'NOT_OVERRIDABLE'; err.code = code`, two live
            // 403s in `sys-metadata-repository.ts` that both gates were blind
            // to. Reduced by the same resolver and emitted under the same shape
            // name, because it is the same thing: the assign position, one
            // constant indirection away.
            //
            // Unreducible keeps its old treatment — no site, no unresolved.
            // That is the header's RUNTIME-VALUE bound, not a silencing: a
            // `const code = readFrom(x)` has no value to report and no family
            // to report it under, and turning every domain field named `code`
            // into a finding is what this branch already refuses to do.
            //
            // [#10918] With ONE class carved out of it. A local this file
            // declares `let`/`var` and also REASSIGNS, whose initializer is a
            // literal, is not a runtime value: a code is spelled out right
            // there, and only the reassignment stops us claiming it is the
            // whole set. Dropping that silently is the hole this card found —
            // `let code = 'A'; if (x) code = 'B'; err.code = code` stamped two
            // unregistered literals and NO gate said a word. It is reported as
            // unresolved, under `assignconst` for the same reason the reduced
            // path emits there: it is the assign position, one indirection
            // away. Reported, never reduced — the ALL-OR-NOTHING rule is what
            // forbids picking the initializer out of the set (#9568).
            const localValues = resolveConstant(code, stripped, rel, readFile, ctx);
            if (localValues === null) {
              if (reassignedMutableLiteral(code, stripped)) {
                addUnresolved(unresolved, { file: rel, shape: 'assignconst', value: code, reason: 'reassigned' });
              }
              continue;
            }
            for (const value of localValues) emit(value, 'assignconst');
            continue;
          }
          if (helperCodes.length === 0) {
            // A helper this scan CAN see but whose callers all pass variables.
            // Reported, never dropped — the bound this gate states for every
            // value it cannot reduce to a literal.
            addUnresolved(unresolved, { file: rel, shape: shape.name, value: code, reason: 'helper' });
            continue;
          }
          for (const hc of helperCodes) {
            if (!keep(hc, shape.name)) continue;
            if (sites.some((x) => x.code === hc && x.file === rel && x.shape === shape.name)) continue;
            sites.push({ code: hc, file: rel, shape: shape.name });
          }
          continue;
        } else if (shape.resolve === 'template' && !/^[A-Za-z][A-Za-z0-9_]*$/.test(code)) {
          // Interpolated: no literal exists to check against the registry. It
          // becomes a site under its FAMILY identity (`${…}` → `*`) rather than
          // being dropped — see `templateFamily`.
          code = templateFamily(code);
          if (!/^[A-Za-z*][A-Za-z0-9_*]*$/.test(code)) continue;
          if (!keep(code, shape.name, true)) continue;
          if (!sites.some((s) => s.code === code && s.file === rel && s.shape === shape.name)) {
            sites.push({ code, file: rel, shape: shape.name });
          }
          continue;
        }
        if (!keep(code, emitAs)) continue;
        if (sites.some((s) => s.code === code && s.file === rel && s.shape === emitAs)) continue;
        sites.push({ code, file: rel, shape: emitAs });
      }
    }
  }
  sites.sort((a, b) => a.code.localeCompare(b.code) || a.file.localeCompare(b.file));
  return { sites, unresolved };
}

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

/**
 * Read the declared table out of the TypeScript source. Textual for the same
 * reason the rest of this file is, and anchored on the array so the doc prose
 * (which names codes) cannot leak in.
 */
export function parseDeclaration(source) {
  const start = source.indexOf('export const UNREGISTERED_CODE_SITES');
  if (start < 0) throw new Error(`${DECLARATION}: UNREGISTERED_CODE_SITES not found — the anchor moved.`);
  const body = maskComments(source).slice(start);
  const end = body.indexOf('\n];');
  if (end < 0) throw new Error(`${DECLARATION}: UNREGISTERED_CODE_SITES terminator not found — the anchor moved.`);
  const rows = [];
  for (const entry of body.slice(0, end).split(/\}\s*,/)) {
    const code = /\bcode:\s*'([^']+)'/.exec(entry);
    const file = /\bfile:\s*'([^']+)'/.exec(entry);
    const shape = /\bshape:\s*'([^']+)'/.exec(entry);
    const door = /\bdoor:\s*'([^']+)'/.exec(entry);
    const verdict = /\bverdict:\s*'([^']+)'/.exec(entry);
    const pin = /\bpin:\s*'([^']+)'/.exec(entry);
    if (!code || !file || !shape || !door || !verdict) continue;
    rows.push({
      code: code[1],
      file: file[1],
      shape: shape[1],
      door: door[1],
      verdict: verdict[1],
      pin: pin ? pin[1] : undefined,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

const key = (s) => `${s.code}@${s.file}#${s.shape}`;

export function reconcile({ sites, declared, registered, unresolved }) {
  const findings = [];
  const declaredByKey = new Map(declared.map((d) => [key(d), d]));
  const siteKeys = new Set(sites.map(key));

  for (const site of sites) {
    if (declaredByKey.has(key(site))) continue;
    if (site.shape === 'objlittemplate') {
      findings.push({
        kind: 'unclassified-site',
        text:
          `${site.file} stamps its code from a TEMPLATE of the family '${site.code}' and ${DECLARATION} ` +
          `does not classify it.\n` +
          `      This gate cannot evaluate an interpolation, so it cannot tell you whether what the ` +
          `template produces is registered — reported rather than dropped, per the header's bounds.\n` +
          `      Two ways out: stamp a LITERAL code per branch (then the scan checks it like any other, ` +
          `and the door can narrow it), or add a row whose verdict is 'runtime-pinned' naming the ` +
          `\`pin:\` that enumerates the family's codes and parses each against the closed union.`,
      });
      continue;
    }
    findings.push({
      kind: 'unclassified-site',
      text:
        `${site.file} stamps unregistered code '${site.code}' (${site.shape}) and ` +
        `${DECLARATION} does not classify it.\n` +
        `      Add a row with a verdict and its evidence. If it reaches a wire, the verdict is ` +
        `'pending-registration' and the code belongs in #8846's ledger batch.`,
    });
  }

  for (const row of declared) {
    if (!siteKeys.has(key(row))) {
      findings.push({
        kind: 'stale-row',
        text:
          `${DECLARATION} declares '${row.code}' at ${row.file} (${row.shape}) but the scan no longer ` +
          `finds it. The producer moved or went away — delete the row.`,
      });
    }
    // [#9223] `runtime-pinned` exists for the one case a source scan cannot
    // decide — an interpolated code. On any other shape it would be a way to
    // declare a literal exempt from the registry check, which is the hole this
    // gate is, so it is refused there. The pin must also still EXIST: an
    // evidence file that has been deleted is the same silent blindness one
    // layer out, and the header's anchor rule already says so.
    if (row.verdict === 'runtime-pinned') {
      if (row.shape !== 'objlittemplate') {
        findings.push({
          kind: 'misused-verdict',
          text:
            `${DECLARATION} declares '${row.code}' at ${row.file} (${row.shape}) as 'runtime-pinned', but ` +
            `that verdict is only for an interpolated \`code:\` this gate cannot evaluate. A ${row.shape} ` +
            `site spells a literal — check it against the registry instead of exempting it.`,
        });
      } else if (!row.pin) {
        findings.push({
          kind: 'missing-pin',
          text:
            `${DECLARATION} declares '${row.code}' at ${row.file} as 'runtime-pinned' without a \`pin:\` ` +
            `naming the test that enumerates the family. The verdict IS the pin — without it the row ` +
            `only says the gate gave up.`,
        });
      } else if (!existsSync(join(ROOT, row.pin))) {
        findings.push({
          kind: 'missing-pin',
          text:
            `${DECLARATION} declares '${row.code}' at ${row.file} as 'runtime-pinned' by '${row.pin}', but ` +
            `that file does not exist. The runtime half is what makes this verdict honest — restore it, ` +
            `point the row at its replacement, or make the site stamp literal codes.`,
        });
      }
    }
    if (row.verdict === 'pending-registration' && registered.has(row.code)) {
      findings.push({
        kind: 'now-registered',
        text:
          `'${row.code}' is registered now — the row in ${DECLARATION} has done its job and must come ` +
          `out. (This is the ratchet: #8846 landing a registration turns its row stale.)`,
      });
    }
  }

  for (const u of unresolved) {
    // [#10918] A reassigned mutable local has a literal in it — the reduction
    // is refused for a reason the author can act on, so the remedy named is the
    // one that applies. Telling them to "teach resolveConstant() the spelling"
    // would point at the resolver when the fix is in their source.
    findings.push({
      kind: 'unresolved-constant',
      text:
        u.reason === 'reassigned'
          ? `${u.file}: '${u.value}' (${u.shape}) is a \`let\`/\`var\` this file also REASSIGNS, so its ` +
            `initializer is not the set of codes it stamps and reducing it would report a value the ` +
            `program may never send. Reported rather than dropped. Make it a \`const\` (a ternary or a ` +
            `\`||\`/\`??\` chain of literals reduces fine), or stamp the literals at the site.`
          : `${u.file}: the code constant '${u.value}' (${u.shape}) could not be resolved to a literal. ` +
            `Reported rather than dropped — see the header's bounds. Resolve it, or teach ` +
            `resolveConstant() the spelling.`,
    });
  }

  findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.text.localeCompare(b.text));
  return findings;
}

// ---------------------------------------------------------------------------
// The REST door's TYPING (#9098)
// ---------------------------------------------------------------------------

/**
 * [#9098] The vocabulary half of this gate answers "is this code registered".
 * It cannot answer "could an unregistered one be written here tomorrow" — and
 * that second question is what the REST door failed.
 *
 * The history, because it is the whole argument for these three assertions:
 * `packages/rest` exported a `sendError(res, error: any)` whose name collided
 * with `@objectstack/types`' strict `sendError(res, status, code: ErrorCode,
 * message)`. A cross-door parity note cited the strict one's closed parameter
 * as the reason the REST door was safe; route modules used the loose one. The
 * door read as closed for as long as anyone cared to look, and the hole was
 * eventually found by this scan (`FIELD_VISIBILITY_UNRESOLVED`) rather than by
 * the door. #9098 split the two responsibilities by name and typed the
 * author-side one.
 *
 * Typing alone does not stay put — it is three keystrokes from `any`, and the
 * scan above would go on passing because a code that IS registered is invisible
 * to it. So the structure is pinned here:
 *
 *   ① the author-side door exists and narrows `code` to the closed `ErrorCode`;
 *   ② nothing in that file re-exports the name `sendError`, so the collision
 *      that hid the hole cannot be reintroduced;
 *   ③ no author-declared literal is handed to the CLASSIFICATION door — that
 *      parameter is `any` by design (narrowing a caught error's `code` is an
 *      ADR-0112 contract decision, not this gate's), which is exactly why a
 *      decided refusal must not travel through it.
 *
 * ⛔ An anchor this cannot find is a FINDING, never a pass — the same rule the
 * header states for unresolvable constants. A structural gate that silently
 * matches nothing is the failure it exists to prevent, one layer down.
 */
export const REST_DOOR_FILE = 'packages/rest/src/error-response.ts';

/** Author-declared literal handed to the classification door. Flat object literal on purpose. */
const DECIDED_THROUGH_THROWN_RE =
  /\bsendThrownError\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\{[^{}]*\bcode\s*:\s*'([A-Za-z][A-Za-z0-9_]*)'/g;

export function checkDoorTyping({ doorSource, files }) {
  const findings = [];
  const add = (text) => findings.push({ kind: 'door-typing', text });

  if (doorSource === null || doorSource === undefined) {
    add(`${REST_DOOR_FILE} could not be read — this gate's door-typing anchor moved. ` +
        `Point REST_DOOR_FILE at the file that now owns the REST error doors.`);
    return findings;
  }
  const stripped = maskComments(doorSource);

  // ① the author-side door narrows to the closed vocabulary
  const decl = /export\s+function\s+sendDeclaredFault\s*\(([\s\S]*?)\)\s*:\s*void/.exec(stripped);
  if (!decl) {
    add(`${REST_DOOR_FILE}: no \`export function sendDeclaredFault(...): void\` found. ` +
        `That is the REST door's typed author-side responder (#9098); without it a decided ` +
        `refusal has no narrowed door and an unregistered code reaches the wire silently.`);
  } else if (!/\bcode\s*:\s*ErrorCode\b/.test(decl[1])) {
    add(`${REST_DOOR_FILE}: \`sendDeclaredFault\` no longer types its \`code\` as \`ErrorCode\`. ` +
        `The closed ADR-0112 union is the only thing making an unregistered code a BUILD failure ` +
        `at this door — widening it re-opens #9098 while every test here stays green.`);
  }

  // ② the collision that hid the hole cannot come back
  if (/export\s+(?:function|const)\s+sendError\b/.test(stripped)) {
    add(`${REST_DOOR_FILE} exports \`sendError\` again. That name belongs to the SHARED strict ` +
        `writer in \`@objectstack/types\`; a second one here is the #9098 collision, which is how ` +
        `the door's own looseness came to be documented as strictness. Name the local doors ` +
        `\`sendThrownError\` (caught values) and \`sendDeclaredFault\` (decided refusals).`);
  }

  // ③ decided refusals do not travel through the `any` door
  for (const { rel, source } of files) {
    if (!rel.startsWith('packages/rest/')) continue;
    const s = maskComments(source);
    DECIDED_THROUGH_THROWN_RE.lastIndex = 0;
    for (const m of s.matchAll(DECIDED_THROUGH_THROWN_RE)) {
      add(`${rel}: hands the author-declared code '${m[1]}' to \`sendThrownError\`, whose \`error\` ` +
          `parameter is \`any\` by design (it takes CAUGHT values). A refusal this repo decides must ` +
          `go through \`sendDeclaredFault\`, which narrows \`code\` to the closed union. Same wire ` +
          `answer, checked at compile time.`);
    }
  }

  findings.sort((a, b) => a.text.localeCompare(b.text));
  return findings;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const fail = [];
  let cases = 0;
  const ok = (cond, what) => { cases += 1; if (!cond) fail.push(what); };

  // Each published SHAPE matches what it claims to.
  const samples = {
    assign: `const err = new Error('x'); err.code = 'FLOW_FAILED'; throw err;`,
    classfield: `class E extends Error { readonly code = 'ERR_X' as const; }`,
    classconst: `const ERR_CONST = 'RESOLVED_ONE';\nclass E { readonly code = ERR_CONST; }`,
    objlit: `throw Object.assign(new Error('x'), { code: 'OBJ_LIT_ONE' });`,
    // [#9223] the two shapes that used to match nothing at all.
    objlitconst: `const OBJ_CONST = 'OBJ_CONST_ONE';\nthrow Object.assign(new Error('x'), { code: OBJ_CONST });`,
    objlittemplate: 'send(res, { code: `TEMPLATE_${action.toUpperCase()}_FAILED`, status: 500 });',
    // [#9460] the two shapes in the ASSIGN position that used to match nothing.
    assignconst: `const ASSIGN_CONST = 'ASSIGN_CONST_ONE';\nconst err = new Error('x'); err.code = ASSIGN_CONST;`,
    codehelper:
      `function fail(code: string, msg: string): Error {\n` +
      `  const e = new Error(msg);\n  (e as any).code = code;\n  return e;\n}\n` +
      `throw fail('HELPER_ONE', 'x');`,
  };
  const registered = new Set(['ALREADY_REGISTERED']);
  for (const [name, source] of Object.entries(samples)) {
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source }],
      readFile: () => '',
    });
    ok(sites.some((s) => s.shape === name), `SHAPE '${name}' matched nothing in its own sample`);
  }

  // A resolved constant reports its VALUE, not the constant's name.
  {
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source: samples.classconst }],
      readFile: () => '',
    });
    ok(
      sites.some((s) => s.code === 'RESOLVED_ONE'),
      'classconst resolved to the constant name instead of its value',
    );
  }

  // The in-file declaration WINS over an import of the same name — the
  // two-drivers-one-constant-name case that a repo-wide lookup gets wrong.
  {
    const source = `import { MULTI_TENANT_UNSUPPORTED_CODE } from './other.js';\nexport const MULTI_TENANT_UNSUPPORTED_CODE = 'MEMORY_ONE';\nclass G { readonly code = MULTI_TENANT_UNSUPPORTED_CODE; }`;
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source }],
      readFile: () => `export const MULTI_TENANT_UNSUPPORTED_CODE = 'MONGO_ONE';`,
    });
    ok(sites.some((s) => s.code === 'MEMORY_ONE'), 'in-file constant did not win over the imported one');
    ok(!sites.some((s) => s.code === 'MONGO_ONE'), 'resolved through the import when a local declaration existed');
  }

  // An unresolvable constant is REPORTED, never silently dropped.
  {
    const { sites, unresolved } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source: `class E { readonly code = SOME_UNKNOWN_CONST; }` }],
      readFile: () => '',
    });
    ok(unresolved.length === 1, 'an unresolvable code constant produced no finding');
    ok(sites.length === 0, 'an unresolvable constant leaked into the site list');
  }

  // A registered code produces no finding; comments never do.
  {
    const { sites } = deriveSites({
      registered: new Set(['ALREADY_REGISTERED']),
      files: [
        { rel: 'packages/x/src/a.ts', source: `err.code = 'ALREADY_REGISTERED';` },
        { rel: 'packages/x/src/b.ts', source: `// err.code = 'IN_A_COMMENT';\n/* code: 'BLOCK_COMMENT' */` },
      ],
      readFile: () => '',
    });
    ok(sites.length === 0, `registered/commented codes produced findings: ${JSON.stringify(sites)}`);
  }

  // Lowercase belongs to check:error-code-casing, not here.
  {
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source: `err.code = 'lowercase_thing';` }],
      readFile: () => '',
    });
    ok(sites.length === 0, 'a lowercase literal was claimed by this gate');
  }

  // [#9223] The two new shapes, in both directions. Each is pinned on the
  // property that was missing: a constant in an object literal RESOLVES (it
  // used to match nothing), and an interpolated code becomes a reportable
  // site (it used to match nothing either).
  {
    const one = (source, extra = {}) =>
      deriveSites({ registered, files: [{ rel: 'packages/x/src/a.ts', source }], readFile: () => '', ...extra });

    // A constant in an object literal reports its VALUE, like `classconst`.
    const resolved = one(samples.objlitconst);
    ok(
      resolved.sites.some((s) => s.code === 'OBJ_CONST_ONE' && s.shape === 'objlitconst'),
      'objlitconst reported the constant name instead of its value',
    );
    ok(
      !resolved.sites.some((s) => s.code === 'OBJ_CONST'),
      'objlitconst leaked the constant NAME into the site list',
    );

    // …and an unresolvable one is reported, not dropped — the bound that did
    // not hold for object literals before this shape existed.
    const blind = one(`throw Object.assign(new Error('x'), { code: SOME_UNKNOWN_CONST });`);
    ok(blind.unresolved.length === 1, 'an unresolvable constant in an object literal produced no finding');
    ok(blind.sites.length === 0, 'an unresolvable objlit constant leaked into the site list');

    // The same constant stamped many times in one file is ONE thing to fix.
    const repeated = one(
      `f({ code: UNKNOWN_ONE });\ng({ code: UNKNOWN_ONE });\nh({ code: UNKNOWN_ONE });`,
    );
    ok(repeated.unresolved.length === 1, `repeated unresolvable constants were not deduped: ${repeated.unresolved.length}`);

    // A template becomes a site under its FAMILY identity.
    const tpl = one(samples.objlittemplate);
    ok(
      tpl.sites.some((s) => s.code === 'TEMPLATE_*_FAILED' && s.shape === 'objlittemplate'),
      `a template code did not report its family: ${JSON.stringify(tpl.sites)}`,
    );
    ok(templateFamily('APPROVAL_${a.b()}_FAILED') === 'APPROVAL_*_FAILED', 'templateFamily did not collapse the interpolation');

    // Three spellings of one family in one file are ONE finding — which is the
    // grain a runtime pin covers.
    const family = one(
      'a({ code: `AP_${x.toUpperCase()}_FAILED` });\n' +
      "b({ code: `AP_${y.toUpperCase().replace('-', '_')}_FAILED` });",
    );
    ok(
      family.sites.filter((s) => s.shape === 'objlittemplate').length === 1,
      `one template family produced ${family.sites.length} sites instead of one`,
    );

    // A template with NO interpolation is a literal wearing backticks.
    const plain = one('a({ code: `PLAIN_BACKTICK_ONE` });');
    ok(plain.sites.some((s) => s.code === 'PLAIN_BACKTICK_ONE'), 'a non-interpolated template was not read as a literal');
    ok(
      one('a({ code: `ALREADY_REGISTERED` });').sites.length === 0,
      'a registered code in backticks was still reported',
    );

    // [#9460] A lowercase TEMPLATE family is now claimed here, and that flip is
    // the point: `check:error-code-casing` has no pattern for a backtick, so
    // leaving it "to that gate" left it to nobody.
    ok(
      one('a({ code: `lower_${x}_thing` });').sites.some((s) => s.code === 'lower_*_thing'),
      'a lowercase template family was still delegated to a gate that cannot see a backtick',
    );
    // `objlitconst` reads SCREAMING constant NAMES only, so a lowercase-named
    // one is not this shape at all — unchanged by #9460, and stated so the
    // bound is not mistaken for the casing rule above.
    ok(
      one(`const lc = 'lower_thing';\na({ code: lc });`).sites.length === 0,
      'a lowercase-NAMED constant was read as an objlitconst',
    );
  }

  // [#9460] The lowercase ownership rule, in BOTH directions — the whole point
  // of the widening, so a regression must fail here rather than go quiet.
  {
    const one = (source) =>
      deriveSites({ registered, files: [{ rel: 'packages/x/src/a.ts', source }], readFile: () => '' });

    // Delegated: `check:error-code-casing` reads these exact characters and
    // carries the D6/D6b/D6c discrimination this gate does not have.
    ok(one(`err.code = 'lowercase_thing';`).sites.length === 0, 'a quoted lowercase assign was claimed by this gate');
    ok(one(`f({ code: 'lowercase_thing' });`).sites.length === 0, 'a quoted lowercase objlit was claimed by this gate');
    ok(one(`ctx.addIssue({ code: 'custom' });`).sites.length === 0, "Zod's own `custom` was called an ObjectStack code");

    // Owned here: no quoted literal sits at the stamp site, so that gate is
    // structurally blind and dropping it reported the code to NOBODY.
    ok(
      one(`const LC = 'lower_const';\nclass E { readonly code = LC; }`).sites.some((s) => s.code === 'lower_const'),
      'a lowercase value reached through a constant was delegated to a gate that cannot see it',
    );
    ok(
      one(`class E extends Error { readonly code = 'lower_field'; }`).sites.some((s) => s.code === 'lower_field'),
      'a lowercase classfield was delegated — that gate has no pattern for `readonly code =`',
    );

    // The card's own producer, reduced to its shape: the stamp knows the token
    // `code` and not the value; the call site knows the value and never writes
    // the token. Both gates read it and both reported nothing.
    const posture =
      `function postureError(code: string, message: string): Error {\n` +
      `  const err = new Error(message);\n  (err as any).code = code;\n  return err;\n}\n` +
      `throw postureError('owd_widening_forbidden', 'x');`;
    ok(
      one(posture).sites.some((s) => s.code === 'owd_widening_forbidden' && s.shape === 'codehelper'),
      'the code-carrying-helper producer this widening exists for was not reported',
    );
  }

  // [#9460] The helper resolver's own machinery.
  {
    const one = (source) =>
      deriveSites({ registered, files: [{ rel: 'packages/x/src/a.ts', source }], readFile: () => '' });

    // The parameter INDEX is derived, never assumed to be zero: two live
    // helpers put `code` second, and a first-argument rule reads a number and
    // an English sentence as error codes.
    const second =
      `function makeError(status: number, code: string, message: string): Error {\n` +
      `  const err = new Error(message);\n  err.code = code;\n  return err;\n}\n` +
      `throw makeError(422, 'SECOND_ARG_ONE', 'x');`;
    const secondSites = one(second);
    ok(secondSites.sites.some((s) => s.code === 'SECOND_ARG_ONE'), 'the helper read the wrong argument index');
    ok(!secondSites.sites.some((s) => s.code === '422'), 'the helper read argument zero regardless of the parameter');

    // A CONSTRUCTOR is a helper too, and its call sites are `new Class(...)`.
    const ctor =
      `class Refusal extends Error {\n  readonly code: string;\n` +
      `  constructor(code: string, message: string) {\n    super(message);\n    this.code = code;\n  }\n}\n` +
      `throw new Refusal('CTOR_ONE', 'x');`;
    ok(one(ctor).sites.some((s) => s.code === 'CTOR_ONE'), 'a code-carrying constructor was not resolved');

    // …and it must name the ENCLOSING class, not the file's first one.
    const twoClasses = `class Unrelated { constructor(x: string) {} }\n${ctor}`;
    ok(one(twoClasses).sites.some((s) => s.code === 'CTOR_ONE'), 'the constructor resolved against the wrong class');

    // An argument that is a CONSTANT resolves through the same machinery the
    // indirect shapes use — the MCP bridge throws `exposureError(msg, CONST, 404)`.
    const viaConst =
      `const BRIDGE_CODE = 'VIA_CONST_ONE';\n` +
      `function boom(message: string, code: string): Error {\n` +
      `  const e = new Error(message);\n  e.code = code;\n  return e;\n}\n` +
      `throw boom('x', BRIDGE_CODE);`;
    ok(one(viaConst).sites.some((s) => s.code === 'VIA_CONST_ONE'), 'a constant argument to a helper did not resolve');

    // A helper this scan CAN see but whose callers all pass runtime values is
    // REPORTED, never dropped — the bound the header states.
    const opaque =
      `function boom(code: string, message: string): Error {\n` +
      `  const e = new Error(message);\n  e.code = code;\n  return e;\n}\n` +
      `throw boom(pickCode(), 'x');`;
    ok(one(opaque).unresolved.length === 1, 'a helper with no resolvable argument produced no finding');

    // An identifier that is NOT a parameter is not this shape — it is either
    // `assignconst`'s (a module constant) or a runtime value, and calling it a
    // helper would invent a call site that does not exist.
    ok(
      one(`for (const rec of rows) { slot.code = rec; }`).sites.length === 0,
      'a plain domain field named `code` was read as a code stamp',
    );
    ok(
      one(`for (const rec of rows) { slot.code = rec; }`).unresolved.length === 0,
      'a plain domain field named `code` was reported as an unresolvable code',
    );

    // The declaration's own header is not a call to itself.
    ok(
      one(`function boom(code: string): Error { const e = new Error('x'); e.code = code; return e; }`)
        .sites.length === 0,
      'the helper declaration was read as its own call site',
    );

    // The argument splitter keeps nested commas out of the count.
    ok(
      splitTopLevel(`a, f(b, c), \`t${'${x}'}\`, d`).length === 4,
      'splitTopLevel counted a nested or templated comma as a separator',
    );
    ok(parseParamNames('readonly a: Map<string, number> = x, b?: string').join(',') === 'a,b', 'parseParamNames mis-read a parameter list');

    // [#13227] The MODIFIER RUN, pinned at every length TypeScript admits and
    // in the order it admits them. `private readonly code: string` parsed as a
    // parameter named `readonly` because the strip was anchored-plus-`g`,
    // which takes exactly ONE modifier off. The run is up to three long
    // (accessibility → `override` → `readonly`), measured against the repo's
    // own TypeScript rather than assumed from the card's two-modifier example.
    for (const [params, expected, note] of [
      ['code: string, msg: string', 'code,msg', 'no modifier'],
      ['readonly code: string', 'code', 'one modifier'],
      ['private code: string', 'code', 'one modifier, accessibility'],
      ['private readonly code: string, private readonly msg: string', 'code,msg', 'two modifiers, both parameters'],
      ['public readonly code: string, msg: string', 'code,msg', 'two modifiers, mixed list'],
      ['protected readonly code: string', 'code', 'two modifiers, protected'],
      ['override readonly code: string', 'code', 'two modifiers, no accessibility'],
      ['private override readonly code: string', 'code', 'THREE modifiers — the maximum'],
      ['public override readonly code: string, msg: string', 'code,msg', 'three modifiers, mixed list'],
      ['private readonly code: Map<string, number> = x, b?: string', 'code,b', 'modifier run plus a generic default'],
      ['...rest: string[]', 'rest', 'rest parameter, unchanged by the run'],
    ]) {
      ok(
        parseParamNames(params).join(',') === expected,
        `parseParamNames mis-read a parameter list (${note}): ${JSON.stringify(params)} → ` +
          `${JSON.stringify(parseParamNames(params))}, expected ${JSON.stringify(expected.split(','))}`,
      );
    }

    // ⛔ The NEGATIVE half — the strip must not become a match-everything.
    // None of these words is reserved, so each is a legal parameter name, and
    // `override` is one THREE TIMES in this repo's own `packages/**` source
    // (`observability-service-plugin.ts`, `cache-service-plugin.ts`,
    // `storage-service-plugin.ts`). A run that ate them would rename a real
    // parameter and hand `helperCodesFor` a wrong INDEX — a finding that reads
    // as ordinary while naming a value from another argument position.
    for (const [params, expected, note] of [
      ['ctx: PluginContext, override?: ErrorReporter', 'ctx,override', 'a parameter named `override`'],
      ['override: MetricsRegistry | undefined', 'override', '`override` alone'],
      ['readonly: string, message: string', 'readonly,message', 'a parameter named `readonly`'],
      ['public: number', 'public', 'a parameter named `public`'],
      ['readonly : string', 'readonly', '`readonly` spaced off its own colon — no name follows the run'],
      ['private: string, readonly: string', 'private,readonly', 'two modifier-WORDS used as names'],
    ]) {
      ok(
        parseParamNames(params).join(',') === expected,
        `parseParamNames ate a real parameter name (${note}): ${JSON.stringify(params)} → ` +
          `${JSON.stringify(parseParamNames(params))}, expected ${JSON.stringify(expected.split(','))}`,
      );
    }

    // [#13227] End to end through the real `deriveSites`, because the parse is
    // only interesting for what it costs downstream: the whole helper was
    // DROPPED — no site AND no unresolved — which is the silent-drop class this
    // gate exists to refuse. Paired with the single-modifier POSITIVE CONTROL,
    // so the zero on `main` was a reading rather than a dead harness.
    {
      const helper = (params, arg) =>
        `class E {\n  constructor(${params}) {\n    (this as any).code = code;\n  }\n}\n` +
        `throw new E('${arg}', 'x');\n`;
      const derive = (source) =>
        deriveSites({ registered: new Set(['ALREADY_REGISTERED']), files: [{ rel: 'packages/x/src/a.ts', source }], readFile: () => '' });
      for (const [params, probe, note] of [
        ['readonly code: string, readonly message: string', 'ONE_MODIFIER_HELPER', 'the single-modifier positive control'],
        ['private readonly code: string, readonly message: string', 'PARAM_PROPERTY_HELPER', 'the two-modifier parameter property'],
      ]) {
        const { sites, unresolved } = derive(helper(params, probe));
        ok(
          sites.some((s) => s.shape === 'codehelper' && s.code === probe),
          `a constructor code helper was dropped — ${note} derived ${sites.length} site(s) and ` +
            `${unresolved.length} unresolved, neither naming ${probe}`,
        );
      }
    }
  }

  // [#9568] The value-level reduction: a constant holding a TERNARY or a
  // `||`/`??` chain of literals. Every assertion here is pinned on the property
  // that was missing, and the block as a whole is what fails if the reduction
  // is reverted — the widening's own regression test.
  {
    const one = (source) =>
      deriveSites({ registered, files: [{ rel: 'packages/x/src/a.ts', source }], readFile: () => '' });
    const codesOf = (r) => r.sites.map((s) => s.code).sort().join(',');

    // The card's live producer, reduced to its shape: two 403 codes reaching
    // the stamp through ONE lower-case local, which is neither a helper
    // parameter nor a module constant, so before this widening the site
    // contributed nothing at all.
    const specimen =
      `const code = intent === 'runtime-only' ? 'NOT_CREATABLE_ONE' : 'NOT_OVERRIDABLE_ONE';\n` +
      `const err: any = new Error(\`[\${code}] x\`);\nerr.code = code;\nerr.status = 403;\nthrow err;`;
    const reduced = one(specimen);
    ok(
      codesOf(reduced) === 'NOT_CREATABLE_ONE,NOT_OVERRIDABLE_ONE',
      `a local ternary of literals did not reduce to BOTH branches: ${JSON.stringify(reduced.sites)}`,
    );
    ok(
      reduced.sites.every((s) => s.shape === 'assignconst'),
      'a reduced local reported under a shape other than the assign position it is stamped in',
    );

    // The same reduction in the other constant-resolving positions — it lives
    // in `resolveConstant`, so every shape that routes through it gets it.
    ok(
      codesOf(one(`const PAIR = flag ? 'OBJ_TERNARY_A' : 'OBJ_TERNARY_B';\nthrow Object.assign(new Error('x'), { code: PAIR });`))
        === 'OBJ_TERNARY_A,OBJ_TERNARY_B',
      'objlitconst did not reduce a ternary constant to both branches',
    );
    ok(
      codesOf(one(`const CHAIN = A ?? 'CHAIN_A';\nclass E { readonly code = CHAIN; }`)) === '',
      'a chain with a runtime operand was harvested for its literal half',
    );
    ok(
      codesOf(one(`const CHAIN = 'CHAIN_A' || 'CHAIN_B';\nerr.code = CHAIN;`)) === 'CHAIN_A,CHAIN_B',
      'a `||` chain of literals did not reduce to its operands',
    );
    ok(
      codesOf(one(`const N = a ? 'NEST_A' : b ? 'NEST_B' : 'NEST_C';\nerr.code = N;`)) === 'NEST_A,NEST_B,NEST_C',
      'a nested ternary lost a branch',
    );
    ok(
      codesOf(one(`const A_CODE = 'VIA_A';\nconst B_CODE = 'VIA_B';\nconst PICK = f ? A_CODE : B_CODE;\nerr.code = PICK;`))
        === 'VIA_A,VIA_B',
      'a ternary of two named constants did not resolve through the identifier limb',
    );

    // A ternary handed straight to a code-carrying helper is the same class.
    ok(
      codesOf(one(
        `function boom(code: string, message: string): Error {\n` +
        `  const e = new Error(message);\n  e.code = code;\n  return e;\n}\n` +
        `throw boom(flag ? 'ARG_TERNARY_A' : 'ARG_TERNARY_B', 'x');`,
      )) === 'ARG_TERNARY_A,ARG_TERNARY_B',
      'a ternary argument to a helper did not reduce',
    );

    // ALL-OR-NOTHING, in both directions. `packages/client` builds its code as
    // `asSemanticCode(a) ?? asSemanticCode(b)` — no literal anywhere — and a
    // genuinely runtime local is the bound #9460 stated. Neither may become a
    // site, and neither may become an `unresolved` finding either: turning
    // every runtime-valued local named `code` into a red gate is the silencing
    // pressure this family keeps re-learning.
    for (const [what, source] of [
      ['a chain of calls', `const errorCode = asSemanticCode(a) ?? asSemanticCode(b);\nerror.code = errorCode;`],
      ['a runtime local', `const code = readFrom(x);\nerr.code = code;`],
      ['a ternary of runtime values', `const code = flag ? readA() : readB();\nerr.code = code;`],
    ]) {
      const r = one(source);
      ok(r.sites.length === 0, `${what} produced a site out of values no scan can see: ${JSON.stringify(r.sites)}`);
      ok(r.unresolved.length === 0, `${what} was reported as an unresolvable code constant`);
    }

    // Two declarations of one name that reduce differently: REPORTED, never
    // first-wins. A file-wide textual lookup has no scopes, so picking the
    // first is the same guess the two-drivers hazard rules out repo-wide.
    const twice = one(`const DUP = a ? 'DUP_A' : 'DUP_B';\nfunction g() { const DUP = 'DUP_C'; }\nerr.code = DUP;`);
    ok(twice.sites.length === 0, `two declarations of one constant were resolved to one of them: ${JSON.stringify(twice.sites)}`);
    ok(twice.unresolved.length === 1, 'an ambiguous in-file constant was not reported');

    // The splitters' own hazards, pinned because both are silent when wrong.
    ok(
      JSON.stringify(splitTernary(`a < b ? 'LT' : 'GE'`)) === JSON.stringify([` 'LT' `, ` 'GE'`]),
      'splitTernary read a comparison operator as a bracket and gave up on a reducible ternary',
    );
    ok(splitTernary(`a?.b ?? c`) === null, 'splitTernary read `?.` or `??` as the conditional operator');
    ok(splitChain(`f(a || b) ?? 'X'`).length === 2, 'splitChain cut inside a nested call');
    ok(literalCodeValues(`('WRAPPED' as const)`).join(',') === 'WRAPPED', 'a parenthesised / `as const` literal did not reduce');
    ok(literalCodeValues(`x ? 'A' : y`) === null, 'a ternary with one runtime branch reduced to half its values');
  }

  // [#10918] The DECLARATOR widening: `let` / `var`, and the reassignment that
  // makes a mutable binding's initializer not its value set. Three states, and
  // the `const` path pinned alongside them — a widening whose test does not
  // also hold the path it must NOT disturb proves only half of what it claims.
  {
    const one = (source) =>
      deriveSites({ registered, files: [{ rel: 'packages/x/src/a.ts', source }], readFile: () => '' });
    const codesOf = (r) => r.sites.map((s) => s.code).sort().join(',');
    const stamp = (decl) => `${decl}\nconst err: any = new Error('x');\nerr.code = code;\nthrow err;`;

    // STATE 1 — a `let`/`var` the file never reassigns holds exactly its
    // initializer, so it reduces like a `const`. Before this, it reduced to
    // NOTHING and the codehelper branch dropped it in silence.
    ok(
      codesOf(one(stamp(`let code = 'LET_DIRECT_ONE';`))) === 'LET_DIRECT_ONE',
      'an unreassigned `let` holding a literal produced no site',
    );
    ok(
      codesOf(one(stamp(`var code = 'VAR_DIRECT_ONE';`))) === 'VAR_DIRECT_ONE',
      'an unreassigned `var` holding a literal produced no site',
    );
    ok(
      codesOf(one(stamp(`let code = flag ? 'LET_TERN_A' : 'LET_TERN_B';`))) === 'LET_TERN_A,LET_TERN_B',
      'an unreassigned `let` holding a ternary did not reduce to both branches',
    );
    // …and it reduces to EXACTLY what the same source spelled `const` does.
    // The reduction lives in one resolver; the declarator must not change it.
    ok(
      codesOf(one(stamp(`let code = flag ? 'SAME_A' : 'SAME_B';`)))
        === codesOf(one(stamp(`const code = flag ? 'SAME_A' : 'SAME_B';`))),
      'the `let` and `const` spellings of one initializer reduced differently',
    );
    // The SCREAMING module-constant spelling routes through `assignconst`'s own
    // regex rather than the codehelper branch — the widening is in the shared
    // resolver, so both arrive.
    ok(
      codesOf(one(`let ERR_CODE = 'LET_CONSTNAME_ONE';\nerr.code = ERR_CODE;`)) === 'LET_CONSTNAME_ONE',
      'an unreassigned `let` in the SCREAMING spelling produced no site',
    );
    // …including across a package boundary, where the resolver reads the OTHER
    // file's source. The `exported` half of the anchor is widened too.
    ok(
      declaredInitializers('LET_EXPORTED', `export let LET_EXPORTED = 'X';`, { exported: true }).length === 1,
      'the exported half of the anchor did not read an `export let`',
    );
    ok(
      deriveSites({
        registered,
        files: [
          { rel: 'packages/runtime/src/x.ts', source: `import { LET_EXPORTED } from '@objectstack/core';\nerr.code = LET_EXPORTED;` },
          { rel: 'packages/core/src/deny.ts', source: `export let LET_EXPORTED = 'LET_EXPORTED_ONE';` },
        ],
        readFile: () => '',
        packageDirs: parsePackageDirs([{ rel: 'packages/core/package.json', source: '{"name":"@objectstack/core"}' }]),
      }).sites.some((s) => s.code === 'LET_EXPORTED_ONE'),
      'an unreassigned exported `let` did not resolve across the package boundary',
    );

    // STATE 2 — reassigned. The initializer is NOT the value set, so it does
    // not reduce; and because a literal IS spelled out, it is reported rather
    // than dropped. This is the card's row 1: two unregistered literals that
    // reached the stamp with no gate saying a word.
    const reassigned = one(stamp(`let code = 'REASSIGN_FALLBACK';\nif (x) code = 'REASSIGN_OTHER';`));
    ok(
      reassigned.unresolved.length === 1 && reassigned.unresolved[0].reason === 'reassigned',
      `a reassigned \`let\` holding a literal was not reported: ${JSON.stringify(reassigned.unresolved)}`,
    );
    // ⛔ The wrong patch. Reducing a reassigned `let` to its initializer would
    // report a value the program may never stamp — the ALL-OR-NOTHING wrongness
    // #9568 exists to refuse. Neither branch may become a site.
    ok(
      reassigned.sites.length === 0,
      `a reassigned \`let\` was reduced to a value the program may never stamp: ${JSON.stringify(reassigned.sites)}`,
    );
    // The card's row 2 — the reassignment RHS is a fallback chain rather than a
    // bare literal. Same answer: reported, not reduced. (Reading the RHS is the
    // card's half 2, and is deliberately NOT closed here.)
    const rowTwo = one(stamp(`let code = 'REASSIGN_FALLBACK';\nif (x) code = p?.code || 'reassigned_lower_failed';`));
    ok(rowTwo.sites.length === 0, 'a reassigned `let` with a chain RHS produced a site');
    ok(rowTwo.unresolved.length === 1, 'a reassigned `let` with a chain RHS was dropped in silence');

    // STATE 3 — a mutable local with NO literal anywhere is the #9460
    // runtime-value bound, untouched. `packages/metadata-protocol` holds this
    // exact shape; reporting it would be the "every domain field named `code`
    // is a finding" pressure this gate keeps refusing.
    for (const [what, decl] of [
      ['a null-initialized mutable local', `let code: unknown | null = null;\ncode = readFrom(x);`],
      ['a mutable local read at runtime', `let code = readFrom(x);\nif (y) code = readFrom(z);`],
      ['a mutable local with no initializer', `let code;\ncode = readFrom(x);`],
    ]) {
      const r = one(stamp(decl));
      ok(r.sites.length === 0, `${what} produced a site out of values no scan can see: ${JSON.stringify(r.sites)}`);
      ok(r.unresolved.length === 0, `${what} was reported as an unresolvable code`);
    }

    // THE CONTROL — the `const` path this widening must leave exactly as it
    // was. These are the card's rows 3-5, and they are what makes the rows
    // above readable as a gap rather than a broken probe.
    ok(
      codesOf(one(stamp(`const code = 'local_direct_failed';`))) === 'local_direct_failed',
      'the `const` control lost its site (lowercase locals are THIS gate\'s, #9460)',
    );
    ok(
      codesOf(one(stamp(`const code = flag ? 'tern_lower_a' : 'tern_lower_b';`))) === 'tern_lower_a,tern_lower_b',
      'the `const` ternary control lost a branch',
    );
    const rowFive = one(stamp(`const code = p?.code || 'reassigned_lower_failed';`));
    ok(
      rowFive.sites.length === 0 && rowFive.unresolved.length === 0,
      "the `const` runtime-chain control moved — it is check:error-code-casing's `local-fallback`, not this gate's",
    );

    // Two declarations that reduce differently are REPORTED, whatever their
    // declarators — the same refusal #9568 pinned for two `const`s. Dropping
    // the mutable one and reducing the rest would be the first-wins guess the
    // two-drivers hazard rules out.
    const shadowed = one(`const DUP = 'DUP_A';\nfunction g() { let DUP = 'DUP_B'; }\nerr.code = DUP;`);
    ok(shadowed.sites.length === 0, `a shadowing \`let\` was resolved to one declaration: ${JSON.stringify(shadowed.sites)}`);
    ok(shadowed.unresolved.length === 1, 'a name declared both `const` and `let` was not reported');

    // The reassignment scan's own hazards, pinned because every one of them is
    // SILENT when wrong: a missed reassignment reduces a value the program may
    // never stamp, and a spurious one costs a reduction.
    ok(!reassignedInFile('code', `let code = 'A';`), "the declaration's own `=` was read as a reassignment");
    ok(!reassignedInFile('code', `let code = 'A';\nerr.code = code;`), 'stamping `.code =` was read as rebinding the local');
    ok(!reassignedInFile('code', `let code = 'A';\nif (code === 'A') f();\nif (code >= b) g();`), 'a comparison was read as a reassignment');
    ok(!reassignedInFile('code', `let code = 'A';\nconst f = (code) => code;`), 'an arrow `=>` was read as a reassignment');
    ok(!reassignedInFile('code', `let code = 'A';\np?.code = 'B';`), 'an optional-chained property stamp was read as rebinding');
    ok(!reassignedInFile('code', `let code = 'A';\nlet decoded = 'B';`), 'a longer identifier ending in the name matched');
    for (const op of ['=', '+=', '||=', '&&=', '??=']) {
      ok(reassignedInFile('code', `let code = 'A';\ncode ${op} 'B';`), `\`code ${op}\` was not seen as a reassignment`);
    }
    // An initializer is required before a mutable declaration counts: `let
    // code;` has nothing spelled out to decline, so it stays the #9460 bound.
    ok(declaredMutably('code', `let code = 'A';`), '`let code = …` was not seen as a mutable declaration');
    ok(declaredMutably('code', `var code: string = 'A';`), 'an annotated `var` was not seen as a mutable declaration');
    ok(!declaredMutably('code', `let code;`), 'an uninitialized `let` was counted as a reducible mutable declaration');
    ok(!declaredMutably('code', `const code = 'A';`), '`const` was read as mutable');
    ok(
      reassignedMutableLiteral('code', `let code = 'A';\ncode = 'B';`),
      'a reassigned mutable local holding a literal was not the reportable class',
    );
    ok(
      !reassignedMutableLiteral('code', `let code = readFrom(x);\ncode = readFrom(y);`),
      'a reassigned mutable local with NO literal was made reportable',
    );
    ok(
      declaredInitializers('code', `let code = 'A';`).join(',') === ` 'A'`.trim(),
      'declaredInitializers did not read a `let` initializer',
    );

    // The finding TEXT names the remedy that applies. A reassigned local is not
    // a spelling `resolveConstant` has to learn — the fix is in the source.
    const text = reconcile({
      sites: [],
      declared: [],
      registered: new Set(),
      unresolved: [{ file: 'packages/x/src/a.ts', shape: 'assignconst', value: 'code', reason: 'reassigned' }],
    })[0].text;
    ok(/REASSIGNS/.test(text) && /const/.test(text), `the reassigned finding did not name its remedy: ${text}`);
  }

  // [#9223] Workspace-package resolution: `packages/` is inside the scan, so a
  // sibling package's constant resolves rather than being reported.
  {
    const consumer = {
      rel: 'packages/runtime/src/x.ts',
      source: `import { DENY_CODE } from '@objectstack/core';\nf({ code: DENY_CODE });`,
    };
    const declarer = { rel: 'packages/core/src/deny.ts', source: `export const DENY_CODE = 'WORKSPACE_ONE';` };
    const packageDirs = parsePackageDirs([
      { rel: 'packages/core/package.json', source: '{"name":"@objectstack/core"}' },
      { rel: 'packages/plugins/plugin-auth/package.json', source: '{"name":"@objectstack/plugin-auth"}' },
    ]);
    ok(
      packageDirs.get('@objectstack/plugin-auth') === 'packages/plugins/plugin-auth',
      'parsePackageDirs assumed name-to-path arithmetic instead of reading the manifest',
    );
    ok(packageOfSpecifier('@objectstack/spec/api') === '@objectstack/spec', 'a subpath import lost its package name');

    const resolved = deriveSites({ registered, files: [consumer, declarer], readFile: () => '', packageDirs });
    ok(
      resolved.sites.some((s) => s.code === 'WORKSPACE_ONE'),
      `a workspace constant did not resolve: ${JSON.stringify(resolved)}`,
    );
    ok(resolved.unresolved.length === 0, 'a resolvable workspace constant was still reported unresolved');

    // Two values for one name inside one package: reported, never guessed —
    // the two-drivers hazard, one package in.
    const ambiguous = deriveSites({
      registered,
      files: [consumer, declarer, { rel: 'packages/core/src/other.ts', source: `export const DENY_CODE = 'OTHER_ONE';` }],
      readFile: () => '',
      packageDirs,
    });
    ok(ambiguous.unresolved.length === 1, 'an ambiguous workspace constant was resolved to one of its two values');
    ok(!ambiguous.sites.some((s) => s.code === 'OTHER_ONE' || s.code === 'WORKSPACE_ONE'), 'an ambiguous constant produced a site');

    // A genuine third-party dependency stays out of reach, and says so.
    const thirdParty = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source: `import { CODE } from 'better-auth';\nf({ code: CODE });` }],
      readFile: () => '',
      packageDirs,
    });
    ok(thirdParty.unresolved.length === 1, "a third-party dependency's constant was not reported as unresolved");
  }

  // [#9223] `runtime-pinned` is narrow by construction: template shapes only,
  // and only with a pin file that exists. Otherwise it is a way to declare a
  // literal exempt from the registry — the hole this gate is.
  {
    const tplSite = { code: 'AP_*_FAILED', file: 'packages/rest/src/r.ts', shape: 'objlittemplate' };
    const row = (over = {}) => ({ ...tplSite, door: 'rest', verdict: 'runtime-pinned', pin: DECLARATION, ...over });

    ok(
      reconcile({ sites: [tplSite], declared: [row()], registered: new Set(), unresolved: [] }).length === 0,
      'a template row pinned by an existing file still failed',
    );
    ok(
      reconcile({ sites: [tplSite], declared: [row({ pin: undefined })], registered: new Set(), unresolved: [] })
        .some((f) => f.kind === 'missing-pin'),
      'a runtime-pinned row with no pin passed',
    );
    ok(
      reconcile({
        sites: [tplSite],
        declared: [row({ pin: 'packages/rest/src/deleted-pin.test.ts' })],
        registered: new Set(),
        unresolved: [],
      }).some((f) => f.kind === 'missing-pin'),
      'a runtime-pinned row whose pin file is gone passed — the runtime half can vanish silently',
    );
    const literalSite = { code: 'LITERAL_ONE', file: 'packages/x/src/a.ts', shape: 'objlit' };
    ok(
      reconcile({
        sites: [literalSite],
        declared: [{ ...literalSite, door: 'rest', verdict: 'runtime-pinned', pin: DECLARATION }],
        registered: new Set(),
        unresolved: [],
      }).some((f) => f.kind === 'misused-verdict'),
      'runtime-pinned exempted a LITERAL code from the registry check',
    );
  }

  // Reconciliation: both directions, plus the now-registered ratchet.
  {
    const sites = [{ code: 'NEW_ONE', file: 'packages/x/src/a.ts', shape: 'assign' }];
    const findings = reconcile({ sites, declared: [], registered: new Set(), unresolved: [] });
    ok(findings.some((f) => f.kind === 'unclassified-site'), 'an unclassified site did not fail');
  }
  {
    const declared = [{ code: 'GONE', file: 'packages/x/src/a.ts', shape: 'assign', door: 'dispatcher', verdict: 'pending-registration' }];
    const findings = reconcile({ sites: [], declared, registered: new Set(), unresolved: [] });
    ok(findings.some((f) => f.kind === 'stale-row'), 'a stale declared row did not fail');
  }
  {
    const site = { code: 'FLOW_FAILED', file: 'packages/x/src/a.ts', shape: 'assign' };
    const declared = [{ ...site, door: 'dispatcher', verdict: 'pending-registration' }];
    const findings = reconcile({
      sites: [site],
      declared,
      registered: new Set(['FLOW_FAILED']),
      unresolved: [],
    });
    ok(findings.some((f) => f.kind === 'now-registered'), 'a registered pending row did not ratchet down');
  }
  {
    const site = { code: 'STILL_PENDING', file: 'packages/x/src/a.ts', shape: 'assign' };
    const findings = reconcile({
      sites: [site],
      declared: [{ ...site, door: 'dispatcher', verdict: 'pending-registration' }],
      registered: new Set(),
      unresolved: [],
    });
    ok(findings.length === 0, `a matched declaration still failed: ${JSON.stringify(findings)}`);
  }

  // The two path exclusions are exactly as narrow as they claim to be — a
  // blanket directory ignore is what lets a real emitter hide.
  {
    ok(isTestFile('packages/x/src/a.test.ts'), 'a .test.ts file was not treated as a test');
    ok(isTestFile('packages/x/src/__tests__/a.ts'), 'a __tests__/ file was not treated as a test');
    ok(!isTestFile('packages/x/src/testing-helpers.ts'), 'a source file with "test" in its name was skipped');
    ok(isDeclarationFile(DECLARATION), 'the declaration file is not excluded from its own scan');
    ok(
      !isDeclarationFile('packages/runtime/src/dispatcher-error-vocabulary-extra.ts'),
      'the declaration exclusion matched by prefix instead of exactly',
    );
    ok(!isDeclarationFile('packages/runtime/src/http-dispatcher.ts'), 'the declaration exclusion is too wide');
  }

  // The spec anchors still parse — a moved anchor must throw, not return empty.
  {
    const ledger = parseLedgerCodes(readFileSync(join(ROOT, LEDGER_ZOD), 'utf8'));
    ok(ledger.size > 100, `ledger parse returned ${ledger.size} codes — the anchor probably moved`);
    ok(ledger.has('DESTRUCTIVE_CHANGE'), 'ledger parse missed a known member');
    const standard = parseStandardCodes(readFileSync(join(ROOT, ERRORS_ZOD), 'utf8'));
    ok(standard.size > 20, `StandardErrorCode parse returned ${standard.size} codes — the anchor probably moved`);
    ok(standard.has('INTERNAL_ERROR'), 'StandardErrorCode parse missed a known member');
    let threw = false;
    try { parseLedgerCodes('export const SOMETHING_ELSE = {};'); } catch { threw = true; }
    ok(threw, 'a missing ledger anchor returned quietly instead of throwing');
  }

  // The declaration file parses into rows with every field present.
  {
    const rows = parseDeclaration(readFileSync(join(ROOT, DECLARATION), 'utf8'));
    ok(rows.length > 0, 'the declaration parsed to zero rows');
    ok(
      rows.every((r) => r.code && r.file && r.shape && r.door && r.verdict),
      'a declaration row parsed with a missing field',
    );
  }

  // [#9098] Door typing. Each assertion is pinned in BOTH directions: the
  // healthy shape passes, and the specific regression it names fails. A
  // structural gate that only ever ran against a healthy tree would be a
  // phantom check — it must be shown capable of failing.
  {
    const healthy = `
      import type { ErrorCode } from '@objectstack/spec/api';
      export function sendThrownError(res: any, error: any, object?: string): void {}
      export function sendDeclaredFault(
          res: any,
          fault: { code: ErrorCode; status: number; message: string },
      ): void { sendThrownError(res, fault); }
      export function sendFieldVisibilityFault(res: any, o: string): void {
          sendDeclaredFault(res, { code: 'FIELD_VISIBILITY_UNRESOLVED', message: o, status: 503 });
      }`;
    ok(
      checkDoorTyping({ doorSource: healthy, files: [] }).length === 0,
      'the healthy door shape produced a door-typing finding',
    );

    const widened = healthy.replace('code: ErrorCode;', 'code: string;');
    ok(
      checkDoorTyping({ doorSource: widened, files: [] }).some((f) => /no longer types/.test(f.text)),
      'widening sendDeclaredFault\'s `code` to string did not fail',
    );

    const missing = healthy.replace(/export function sendDeclaredFault[\s\S]*?\): void \{[^}]*\}/, '');
    ok(
      checkDoorTyping({ doorSource: missing, files: [] }).some((f) => /no .*sendDeclaredFault/.test(f.text)),
      'deleting the typed author-side door did not fail',
    );

    const collided = `${healthy}\nexport function sendError(res: any, error: any): void {}`;
    ok(
      checkDoorTyping({ doorSource: collided, files: [] }).some((f) => /collision/.test(f.text)),
      'reintroducing the `sendError` collision did not fail',
    );

    // ③ both directions, and the CAUGHT-value call must stay legal.
    const bypass = `sendThrownError(res, { code: 'SOMETHING_NEW', message: 'x', status: 400 });`;
    ok(
      checkDoorTyping({
        doorSource: healthy,
        files: [{ rel: 'packages/rest/src/some-routes.ts', source: bypass }],
      }).some((f) => /SOMETHING_NEW/.test(f.text)),
      'an author-declared literal sent through the `any` door did not fail',
    );
    ok(
      checkDoorTyping({
        doorSource: healthy,
        files: [{ rel: 'packages/rest/src/some-routes.ts', source: `sendThrownError(res, error, object);` }],
      }).length === 0,
      'passing a CAUGHT error through the classification door was flagged — that is its job',
    );
    ok(
      checkDoorTyping({
        doorSource: healthy,
        files: [{ rel: 'packages/rest/src/x.ts', source: `// sendThrownError(res, { code: 'IN_A_COMMENT' });` }],
      }).length === 0,
      'a commented-out bypass produced a door-typing finding',
    );

    // A missing door file is a FINDING, never a quiet pass.
    ok(
      checkDoorTyping({ doorSource: null, files: [] }).some((f) => /anchor moved/.test(f.text)),
      'an unreadable door file passed quietly instead of failing',
    );

    // And the real file on disk satisfies all three.
    ok(
      existsSync(join(ROOT, REST_DOOR_FILE)),
      `${REST_DOOR_FILE} does not exist — the door-typing anchor moved`,
    );
  }


  // [#12925] The kebab-case DIAGNOSTIC vocabulary is declared OUT of BOTH
  // gates' population — `KEBAB_DIAGNOSTIC_VOCABULARY` above. It is pinned HERE,
  // in the one place the declaration lives, so a later widening of ANY grammar
  // in EITHER gate cannot adopt that family silently: something fails, and what
  // fails names the decision.
  //
  // ⚠️ Both gates are green over the kebab family TODAY, so "still green" would
  // prove nothing. Nothing below asserts a bare zero: every case runs the kebab
  // sample AND its non-kebab TWIN — the same characters, hyphens spelled `_` —
  // through the same recognizer. A harness that stopped working fails on the
  // twin instead of passing on the sample, which is what makes the zero a
  // reading. The other gate's detector is IMPORTED rather than paraphrased, so
  // widening `check:error-code-casing` trips this too.
  {
    const K = KEBAB_DIAGNOSTIC_VOCABULARY;
    const DECISION =
      'a grammar now admits a hyphen, so the kebab DIAGNOSTIC vocabulary that ' +
      'KEBAB_DIAGNOSTIC_VOCABULARY (#12925) declares OUT of both gates is being adopted into a ' +
      "gate's population. That is a gate-POPULATION change — measure the blast radius (how many " +
      'constants repo-wide newly resolve into sites that then need declaration rows) and route it ' +
      'to the maintainer on its own card. Do not widen quietly, and do not adjust this pin to match.';

    // The population question is whether any published RECOGNIZER MATCHES the
    // value — not whether a run ends up REPORTING it. ⚠️ Measured, not assumed:
    // widening `objlit` alone makes a kebab literal match and still reports
    // nothing, because `objlit` carries `lowercase: 'casing-gate'` and that
    // delegation hands the value to a gate whose grammar still excludes the
    // hyphen — straight back into the same seam, one layer deeper. A pin that
    // watched FINDINGS sat green through exactly that widening when this was
    // ablated. So both sides are counted by MATCHES.
    const matched = (source) => {
      let n = 0;
      for (const shape of SHAPES) n += [...source.matchAll(new RegExp(shape.re.source, shape.re.flags))].length;
      return n + findViolations(source, 'packages/x/src/a.ts').length;
    };

    // ① The declared shape discriminates: it admits the sample and refuses the twin.
    ok(K.shape.test(K.sample), `KEBAB_DIAGNOSTIC_VOCABULARY.shape rejects its own sample — ${DECISION}`);
    ok(!K.shape.test(K.twin), 'KEBAB_DIAGNOSTIC_VOCABULARY.shape admits its non-kebab twin — the pin below cannot isolate the hyphen');

    // ② In each literal STAMP POSITION: the kebab value is seen by NEITHER gate,
    //    and its twin is seen by ONE of them. Same text, same position, one byte
    //    class apart — so the hyphen is the only thing that puts it outside.
    const positions = {
      objlit: `throw Object.assign(new Error('x'), { code: '%CODE%' });`,
      assign: `const e = new Error('x'); e.code = '%CODE%'; throw e;`,
      classfield: `class E extends Error { readonly code = '%CODE%' as const; }`,
    };
    for (const [name, tmpl] of Object.entries(positions)) {
      const kebab = matched(tmpl.replace('%CODE%', K.sample));
      const twin = matched(tmpl.replace('%CODE%', K.twin));
      ok(
        kebab === 0,
        `a kebab diagnostic code in the '${name}' position is now MATCHED by a recognizer — ${DECISION}`,
      );
      ok(
        twin > 0,
        `the non-kebab twin in the '${name}' position matches nothing either — the '${name}' probe ` +
          'measures nothing, so the zero beside it is not a reading. Fix the probe before trusting either.',
      );
    }

    // ③ The reducer itself: a kebab literal does not reduce, its twin does.
    ok(
      literalCodeValues(`'${K.sample}'`) === null,
      `literalCodeValues now reduces a kebab literal — ${DECISION}`,
    );
    ok(
      (literalCodeValues(`'${K.twin}'`) ?? []).includes(K.twin),
      'literalCodeValues no longer reduces the non-kebab twin — the check above is vacuous',
    );

    // ④ The CONSTANT form is UNDISCHARGEABLE, which is why the inline literal
    //    is the form this gate pair currently rewards. `objlitconst` matches the
    //    constant NAME, the reducer refuses the kebab VALUE, and the resulting
    //    `unresolved-constant` is pushed unconditionally — no declaration row
    //    classifies it. Pinned because the declaration's argument rests on it.
    {
      const source =
        `const SOME_DIAGNOSTIC = '${K.sample}';\n` +
        `emit({ code: SOME_DIAGNOSTIC, message: 'x' });`;
      const { sites, unresolved } = deriveSites({
        registered,
        files: [{ rel: 'packages/x/src/a.ts', source }],
        readFile: () => '',
      });
      ok(sites.length === 0, `a kebab constant now resolves to a site — ${DECISION}`);
      ok(unresolved.length === 1, 'a kebab code constant produced no unresolved finding — the bound this gate states for itself');
      const undischarged = (declared) =>
        reconcile({ sites, declared, registered, unresolved }).filter((f) => f.kind === 'unresolved-constant').length;
      ok(undischarged([]) === 1, 'the unresolved kebab constant produced no finding');
      ok(
        undischarged([
          { code: K.sample, file: 'packages/x/src/a.ts', shape: 'objlitconst', door: 'none', verdict: 'not-dispatcher-reachable', evidence: 'x' },
        ]) === 1,
        'a declaration row now discharges an unresolved kebab constant — the escape hatch this card ' +
          'declared absent exists after all; the declaration above must be rewritten, not the pin',
      );
    }

    // ⑤ The declared WITNESS is real and still homogeneous. This is what stops
    //    the declaration outliving its subject: it fails if the owning package
    //    moves, and it fails the moment that vocabulary stops being all-kebab —
    //    at which point the family is no longer what was declared out.
    {
      const ownerDir = join(ROOT, K.owner);
      ok(existsSync(ownerDir), `${K.owner} does not exist — KEBAB_DIAGNOSTIC_VOCABULARY.owner moved`);
      let kebab = 0;
      const foreign = [];
      for (const f of walkSources(ownerDir, ROOT)) {
        const src = maskComments(readFileSync(f.abs, 'utf8'));
        for (const m of src.matchAll(/\bcode:\s*'([^']*)'/g)) {
          if (K.shape.test(m[1])) kebab += 1;
          else foreign.push(`${f.rel}: '${m[1]}'`);
        }
      }
      ok(kebab > 0, `${K.owner} stamps no kebab diagnostic code at all — the declared witness is empty`);
      ok(
        foreign.length === 0,
        `${K.owner} now stamps a NON-kebab code value (${foreign.join(', ')}) — the vocabulary declared ` +
          'out of both gates is no longer homogeneous, so the declaration no longer describes it.',
      );
    }
  }

  // [#13131] The OBJECT-LITERAL stamp position inside a code-carrying helper,
  // and the CLASS-METHOD declaration form, are both outside this gate —
  // MEASURED (see OBJECT_LITERAL_CODE_HELPER_BLINDNESS above) and declared out
  // rather than closed, because the round that measured them was scoped to
  // measurement. Pinned HERE, in the one place the declaration lives, so a
  // later widening of either half cannot land silently: something fails, and
  // what fails names the decision.
  //
  // ⚠️ Nothing below asserts a bare zero. Every zero is paired with the
  // SAME-GENRE POSITIVE CONTROL — the identical helper stamping through the
  // assignment this gate does implement — so a harness that stopped working
  // fails on the control instead of passing on the subject.
  {
    const B = OBJECT_LITERAL_CODE_HELPER_BLINDNESS;
    const DECISION =
      'a code-carrying helper that stamps through an OBJECT LITERAL, or one declared as a CLASS ' +
      'METHOD, is now visible to a gate. That is a gate-POPULATION change: #13131 measured the ' +
      'blast radius at 106 newly reached call sites, 29 new verdict rows in ' +
      `${DECLARATION}, and 4 UNDISCHARGEABLE unresolved findings. Land the rows and the ` +
      'declaration together, and rewrite OBJECT_LITERAL_CODE_HELPER_BLINDNESS — do not adjust ' +
      'this pin to match.';

    const helper = (body, probe) =>
      `export function postureError(code: string, message: string) {\n${body}\n}\n` +
      `export function deny() { throw postureError('${probe}', 'x'); }\n`;
    const REL = 'packages/x/src/a.ts';
    const derive = (source) =>
      deriveSites({ registered: new Set(['ALREADY_REGISTERED']), files: [{ rel: REL, source }], readFile: () => '' });
    // Population = MATCHES across BOTH gates' recognizers, never the finding
    // list — the lesson the kebab pin above paid for in an ablation.
    const matched = (source) => {
      let n = 0;
      for (const shape of SHAPES) n += [...source.matchAll(new RegExp(shape.re.source, shape.re.flags))].length;
      return n + findViolations(source, REL).length;
    };

    // ① BLINDNESS ①, the stamp POSITION. The control fires; the two
    //    object-literal spellings of the same helper are seen by NOTHING —
    //    not matched, so not reported, and not unresolved either.
    const control = helper(B.control, B.probe);
    ok(matched(control) > 0, `the same-genre control matches no recognizer at all — the pin below cannot read as a zero`);
    ok(
      derive(control).sites.some((s) => s.shape === 'codehelper' && s.code === B.probe),
      'the assignment-spelled code helper no longer derives a `codehelper` site — the control for #13131 is dead',
    );
    for (const [name, body] of [['shorthand', B.shorthand], ['longhand', B.longhand]]) {
      for (const probe of [B.probe, B.probeLowercase]) {
        const source = helper(body, probe);
        ok(matched(source) === 0, `a recognizer now MATCHES the ${name} object-literal code helper ('${probe}') — ${DECISION}`);
        const { sites, unresolved } = derive(source);
        ok(
          sites.length === 0 && unresolved.length === 0,
          `the ${name} object-literal code helper ('${probe}') now derives ${sites.length} site(s) and ` +
            `${unresolved.length} unresolved — ${DECISION}`,
        );
      }
    }

    // ② BLINDNESS ②, the DECLARATION FORM — and it is pinned on SITES rather
    //    than on matches, deliberately. Here the recognizer DOES match: the
    //    body is the very `.code = code` `codehelper` is written for. What
    //    drops it is structural — `enclosingDeclaration`'s DECL_HEADER_RE has
    //    no header for a class method, so the identifier is never recognised
    //    as a parameter. Same body, same probe, one declaration form apart.
    const body = B.control.replace(/^/gm, '  ');
    const asFunction =
      `export function fail(code: string, message: string) {\n${body}\n}\n` +
      `export function run() { throw fail('${B.probe}', 'x'); }\n`;
    const asMethod =
      `class Thing {\n  private fail(code: string, message: string) {\n${body}\n  }\n` +
      `  run(): void { throw this.fail('${B.probe}', 'x'); }\n}\n`;
    ok(
      derive(asFunction).sites.some((s) => s.shape === 'codehelper' && s.code === B.probe),
      'the free-function control for #13131 blindness ② derives no site — the comparison below is dead',
    );
    ok(matched(asMethod) > 0, 'the class-method form matches no recognizer — blindness ② is not what was measured');
    {
      const { sites, unresolved } = derive(asMethod);
      ok(
        sites.length === 0 && unresolved.length === 0,
        `a CLASS-METHOD code helper now derives ${sites.length} site(s) and ${unresolved.length} unresolved — ${DECISION}`,
      );
    }
    // The mechanism itself, named so the failure above is diagnosable.
    {
      const at = asMethod.indexOf('.code = code');
      const decl = enclosingDeclaration(asMethod, at);
      ok(
        !decl || !parseParamNames(decl.params).includes('code'),
        'enclosingDeclaration now resolves a CLASS METHOD, so `codehelper` reaches method helpers — ' + DECISION,
      );
    }
    ok(
      B.invisibleDeclarationForms.includes('class method'),
      'OBJECT_LITERAL_CODE_HELPER_BLINDNESS no longer declares the class-method form out',
    );
  }

  if (fail.length) {
    console.error('check-dispatcher-error-vocabulary --self-test FAILED:');
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `check-dispatcher-error-vocabulary --self-test: ${Object.keys(samples).length} shapes ` +
    `+ ${cases} assertions OK (vocabulary + #9098 door typing)`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const readFile = (abs) => readFileSync(abs, 'utf8');
  const ledger = parseLedgerCodes(readFileSync(join(ROOT, LEDGER_ZOD), 'utf8'));
  const standard = parseStandardCodes(readFileSync(join(ROOT, ERRORS_ZOD), 'utf8'));
  const registered = new Set([...ledger, ...standard]);

  const files = [];
  for (const { rel, abs } of walkSources(join(ROOT, SCAN_ROOT), ROOT)) {
    files.push({ rel, source: readFile(abs) });
  }

  const packageDirs = parsePackageDirs(
    [...walkManifests(join(ROOT, SCAN_ROOT), ROOT)].map(({ rel, abs }) => ({ rel, source: readFile(abs) })),
  );

  const { sites, unresolved } = deriveSites({ registered, files, readFile, packageDirs });
  const declared = parseDeclaration(readFileSync(join(ROOT, DECLARATION), 'utf8'));
  const findings = reconcile({ sites, declared, registered, unresolved });

  // [#9098] The door-typing half. `walkSources` skips the door file only if it
  // is a test or the declaration — it is neither, so read it from the scanned
  // set and fall back to disk rather than assuming either.
  const doorEntry = files.find((f) => f.rel === REST_DOOR_FILE);
  const doorAbs = join(ROOT, REST_DOOR_FILE);
  const doorSource = doorEntry?.source ?? (existsSync(doorAbs) ? readFile(doorAbs) : null);
  findings.push(...checkDoorTyping({ doorSource, files }));

  const pending = declared.filter((d) => d.verdict === 'pending-registration');
  const bounds =
    `  scope: ${files.length} non-test source files under ${SCAN_ROOT}/; ` +
    `${registered.size} registered codes (${ledger.size} ledger + ${standard.size} standard); ` +
    `${sites.length} unregistered code-stamping site(s) found; ${declared.length} classified.\n` +
    `  door typing (#9098): ${REST_DOOR_FILE} checked for the typed author-side responder, the ` +
    `absence of a second \`sendError\`, and decided refusals bypassing it.\n` +
    `  the sandbox limb (author-thrown codes from metadata-app action code) is outside this scan ` +
    `by construction — see SANDBOX_AUTHORED_LIMB in ${DECLARATION}.` +
    `\n  kebab-case DIAGNOSTIC codes (e.g. '${KEBAB_DIAGNOSTIC_VOCABULARY.sample}', owned by `+
    `${KEBAB_DIAGNOSTIC_VOCABULARY.owner}) are a SEPARATE vocabulary, governed by `+
    `${KEBAB_DIAGNOSTIC_VOCABULARY.governedBy}: no grammar in this gate or in check:error-code-casing `+
    `admits a hyphen, so coverage of them is zero BY DECLARATION, not by accident — see `+
    `KEBAB_DIAGNOSTIC_VOCABULARY in this file, pinned by --self-test.` +
    `\n  [#13131] a code-carrying helper that stamps through an OBJECT LITERAL ({ code }) — and one ` +
    `declared as a CLASS METHOD, in either stamp position — is outside this gate: no shape matches, so ` +
    `there is no site AND no unresolved. Coverage of them is zero BY DECLARATION, not by accident. ` +
    `Measured blast radius of closing it: ${OBJECT_LITERAL_CODE_HELPER_BLINDNESS.measured.callSitesNewlyReached} ` +
    `call sites, ${OBJECT_LITERAL_CODE_HELPER_BLINDNESS.measured.newVerdictRows} new verdict rows, ` +
    `${OBJECT_LITERAL_CODE_HELPER_BLINDNESS.measured.undischargeableUnresolved} undischargeable unresolved, ` +
    `${OBJECT_LITERAL_CODE_HELPER_BLINDNESS.measured.unregisteredWireCodesHiding} unregistered wire code(s) ` +
    `hiding today — see OBJECT_LITERAL_CODE_HELPER_BLINDNESS in this file, pinned by --self-test.`;

  if (argv.includes('--report')) {
    console.log('Derived sites (code / shape / file):');
    for (const s of sites) {
      const row = declared.find((d) => key(d) === key(s));
      console.log(`  ${s.code.padEnd(40)} ${s.shape.padEnd(11)} ${row ? row.verdict : 'UNCLASSIFIED'}  ${s.file}`);
    }
    console.log(`\nPending ledger registration (#8846's input): ${pending.length}`);
    for (const p of [...new Set(pending.map((d) => d.code))].sort()) {
      const doors = [...new Set(pending.filter((d) => d.code === p).map((d) => d.door))].join(',');
      console.log(`  ${p.padEnd(40)} door=${doors}`);
    }
    console.log(`\n${bounds}`);
  }

  if (findings.length) {
    console.error(`\ncheck-dispatcher-error-vocabulary: ${findings.length} finding(s)\n`);
    for (const f of findings) console.error(`  [${f.kind}] ${f.text}\n`);
    console.error(bounds);
    process.exit(1);
  }

  console.log(
    `check-dispatcher-error-vocabulary: OK — ${sites.length} unregistered code-stamping site(s), all classified; ` +
      `${new Set(pending.map((d) => d.code)).size} awaiting a ledger entry (#8846).`,
  );
  console.log(bounds);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
