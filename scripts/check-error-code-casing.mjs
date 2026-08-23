#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-code casing guard (ADR-0112, #4003).
 *
 * ## What it guards
 *
 * `error.code` is a closed set: `StandardErrorCode` ∪ `ERROR_CODE_LEDGER`, all
 * SCREAMING_SNAKE, and `ApiErrorSchema.code` validates against it. The ledger's
 * own test enforces the casing of every code someone **registers**.
 *
 * That leaves the hole this guard closes. An unregistered lowercase string in a
 * code position is invisible to the ledger — there is nothing to check the
 * casing of — and invisible to the schema on any route that doesn't parse its
 * own response. That is precisely how 208 lowercase literals accumulated across
 * 10 packages before batch 2 swept them (#4003). Without a guard, number 209
 * lands the same way: quietly, in a package nobody is looking at.
 *
 * ## Why textual, not AST
 *
 * The failure mode here is a string literal in one of a handful of syntactic
 * positions, and batch 2 learned the hard way that the positions are more
 * varied than they look: emission (`code: 'x'`), property assignment
 * (`err.code = 'x'`), comparison (`code === 'x'`), computed ternaries, literal
 * union *types*, and test assertions. An AST pass buys nothing over a regex for
 * "is this literal lowercase_snake" while costing a parse of every file — and
 * the union-type case is a type annotation, which the AST shapes for the value
 * cases would miss anyway.
 *
 * ## The vocabularies this does NOT govern
 *
 * ADR-0112 D6/D6b/D6c draw the line: the catalog governs the code a failing
 * REQUEST answers with. Three neighbours legitimately stay lowercase, and each
 * is skipped by a rule below rather than by a blanket ignore, so a new file in
 * one of those families still has to say which family it joins:
 *
 *   - **D6 — field/param-addressed** (`{ field, code }`, `{ param, code }`):
 *     the field-level catalog, which ADR-0114 closed and made lowercase on purpose
 *     (a field code names the violated CONSTRAINT, and constraints are declared in
 *     the metadata's own snake_case).
 *   - **D6b — persisted**: `sys_metadata_audit.code` is audit history; old rows
 *     keep their spelling forever and the column also holds `ok`.
 *   - **D6c — diagnostics**: probe/diff records that ship as payload of a 200.
 *
 * Zod's own issue codes (`invalid_type`, `too_small`, `custom`, …) are a fourth
 * — they are Zod's API, not ours.
 *
 * Run `--self-test` to check the matcher against known-good and known-bad
 * samples before trusting a green run.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { maskComments } from './js-comment-mask.mjs';
import { join, relative, sep } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SCAN_ROOTS = ['packages'];

/**
 * Files exempt as a whole, each because it OWNS one of the non-catalog
 * vocabularies above. A path earns a line here only with the reason; a blanket
 * directory ignore is what lets a real emitter hide.
 */
const EXEMPT_FILES = new Map([
  // D6 — field-addressed validator vocabularies (#3977)
  ['packages/objectql/src/validation/record-validator.ts', 'D6/ADR-0114 field-level catalog codes'],
  ['packages/objectql/src/validation/rule-validator.ts', 'D6 field-level validator codes'],
  ['packages/rest/src/import-coerce.ts', 'D6 field-level import coercion codes'],
  ['packages/rest/src/import-runner.ts', 'D6 field-level import row codes'],
  ['packages/plugins/plugin-sharing/src/rule-criteria.ts', 'D6 field-level; top-level code is VALIDATION_FAILED'],
  ['packages/spec/src/ui/action-params.zod.ts', 'D6/ADR-0114 param-addressed issues'],
  ['packages/services/service-automation/src/screen-input-contract.ts', 'D6/ADR-0114 screen-field-addressed issues; the refusal code is INVALID_SCREEN_INPUT'],
  // D6b — persisted audit column
  ['packages/metadata-core/src/objects/sys-metadata-audit.object.ts', 'D6b persisted audit vocabulary'],
  ['packages/spec/src/api/errors.test.ts', 'D6 FieldError tests spell field-level codes'],
  ['packages/objectql/src/validation/skip-provenance.test.ts', 'D6 field-level assertions'],
  ['packages/rest/src/import-runner-selfref.test.ts', 'D6 field-level import codes'],
  // D6c — diagnostics payloads of a 200
  ['packages/metadata-protocol/src/build-probes.ts', 'D6c runtime build-probe diagnostics'],
  ['packages/metadata-protocol/src/metadata-diagnostics.ts', 'D6c spec-validation diagnostics'],
  ['packages/objectql/src/build-probes.test.ts', 'D6c build-probe diagnostics tests'],
  ['packages/objectql/src/metadata-diagnostics.test.ts', 'D6c diagnostics tests'],
  ['packages/objectql/scripts/dry-run-hash-compat.ts', 'D6c findings report of a dev script'],
  ['packages/objectql/src/dry-run-hash-compat.test.ts', 'D6c findings report tests'],
  // Zod's own vocabulary, and this file's own samples
  ['packages/spec/src/shared/error-map.zod.ts', "Zod issue codes, not ours"],
  ['packages/spec/src/api/odata.zod.ts', "OData's own error vocabulary, a foreign protocol"],
  ['packages/spec/src/api/odata.test.ts', "OData's own error vocabulary, a foreign protocol"],
  ['packages/spec/src/system/license.test.ts', 'plan/feature codes are domain data; the nearby toThrow() is the tripwire'],
  // The ledger and its test spell codes for a living
  ['packages/spec/src/api/error-code-ledger.zod.ts', 'the ledger itself'],
  ['packages/spec/src/api/error-code-ledger.test.ts', 'the ledger admission test'],
]);

/** Literals that are never an error code, however they look. */
const NOT_CODES = new Set([
  // Zod issue codes and API constants
  'custom', 'invalid_type', 'invalid_value', 'invalid_format', 'invalid_union',
  'too_small', 'too_big', 'unrecognized_keys', 'invalid_key', 'invalid_element',
  'invalid_arguments', 'invalid_return_type', 'not_multiple_of',
  // service/AI/queue status vocabularies that share the word "code"
  'unavailable', 'default', 'string', 'ok',
]);

const CODE_POSITION_PATTERNS = [
  // emission and object literals: code: 'x'
  { name: 'emission', re: /\bcode\s*:\s*'([a-z][a-z0-9_]*)'/g },
  // property assignment: err.code = 'x'
  { name: 'assignment', re: /\.code\s*=\s*'([a-z][a-z0-9_]*)'/g },
  // comparison — the silent one: code === 'x'
  { name: 'comparison', re: /\bcode\s*(?:===|!==)\s*'([a-z][a-z0-9_]*)'/g },
  // literal-union type: code?: 'x' | 'y'   (the one that breaks a consumer's dts)
  { name: 'union-type', re: /\bcode\??\s*:\s*'([a-z][a-z0-9_]*)'\s*\|/g },
  // [#10658] the OUR-DEFAULT slot of a fallback chain:
  //   code: parsed?.code || 'verify_domain_failed'
  //   err.code = e?.code ?? 'lookup_failed'
  //
  // The four patterns above all anchor the quote DIRECTLY after the position
  // token, so any intervening expression makes the literal invisible to the
  // whole set — silently, and then the run prints a total that reads as
  // complete. Two live wire codes shipped through exactly that gap.
  //
  // Where the line is drawn, and why it cannot start flagging a pass-through:
  // this pattern still only ever captures a STRING LITERAL, and a literal in
  // our source is by construction ours. A vendor code "passing through" is a
  // RUNTIME value (`parsed?.code`, `err.code`, a variable) — it has no literal
  // for any pattern here to capture, before or after this widening. So the
  // operand this reaches is only ever the default WE author. (A vendor's
  // spelling hard-coded as our default — `parsed?.code || 'invalid_grant'` — is
  // a real D1 violation: it is the code OUR failing request answers with.)
  //
  // The gap class is what keeps the match inside one property's value. It
  // admits an operand chain (identifiers, member/optional access, calls,
  // indexes, further `||`/`??`) and refuses `, ; : { } =` and every quote, so a
  // match cannot leap out of `code:` into a NEIGHBOUR's fallback — the real
  // false positive here is `{ code: a.code, message: m || 'lower' }`, and that
  // comma is what stops it. The length bound is a runaway guard; both are
  // pinned in --self-test.
  {
    name: 'fallback',
    re: /(?:\bcode\s*\??\s*:|\.code\s*=(?!=))\s*(?![`'"])[\w$.?!()[\]|&\s]{0,80}?(?:\|\||\?\?)\s*'([a-z][a-z0-9_]*)'/g,
  },
  // [#10897] The SAME our-default slot, one indirection EARLIER — in the
  // initializer of a `code`-named local, rather than at the stamp site:
  //
  //   const code = parsed?.code || 'lower_thing';   err.code = code;
  //   const code: string = e?.code ?? 'lower_thing';
  //
  // The pattern above anchors on the POSITION token (`code:` / `code?:` /
  // `.code =`), so it reaches a fallback chain only where the chain sits AT
  // the stamp site. `const code =` is neither spelling, and a TYPE ANNOTATION
  // does not rescue it: `const code: string = …` does match `code:`, but then
  // the gap has to cross an `=`, which that character class refuses on purpose
  // (refusing `=` is part of what stops a match leaping out of one property's
  // value into a neighbour's). So both spellings matched nothing.
  //
  // And nothing else saw them either — this was a hole between two gates, not
  // a hand-off. `check:dispatcher-error-vocabulary` does reach the local:
  // `err.code = code` is its `codehelper`/`assignconst` shape, and its
  // `resolveConstant` reduces a local whose initializer is a ternary or a
  // chain OF LITERALS (#9568). But that reduction is ALL-OR-NOTHING by design:
  // one runtime limb (`parsed?.code`) reduces the whole chain to nothing,
  // because half an expression's values is a finding wrong in both directions
  // at once. That bound is deliberate, correct, and unchanged by this pattern.
  //
  // Which leaves the literal half to this gate, on exactly the reasoning
  // #10760 published for the stamp site: the capture is still only ever a
  // STRING LITERAL, and a literal in our source is by construction ours — the
  // default WE author, which is the operand ADR-0112 D1 governs. A vendor code
  // passing through is a RUNTIME value with no literal to capture. WHERE we
  // write the chain does not change whose default it is; the asymmetry between
  // the two positions was an artifact of where the recognizer anchored, not a
  // decision anyone took.
  //
  // The delegation runs the OTHER way for a local this gate must NOT touch: an
  // all-literal initializer (`const code = 'lower_thing'`, a ternary of
  // literals, a chain of literals) IS reducible, so the dispatcher gate emits
  // a site for it under `assignconst` — measured, all three cases, lowercase
  // included. The lookahead `(?!['"`])` and the gap class (which admits no
  // quote at all) together keep this pattern off the head of such a chain, so
  // the two gates never both report one literal.
  //
  // The annotation gap is `[^=;\n]`, the spelling `check-dispatcher-error-
  // vocabulary`'s own `classfield` uses for this same job, so it cannot
  // swallow the `=` it is meant to stop before. Everything after the `=` is
  // the pattern above's gap class and tail verbatim: same operand alphabet,
  // same 80-char runaway bound, same lowercase value space — an uppercase
  // default stays out of it, and every filter in `findViolations` (D6
  // field-addressed, NOT_CODES, `adr0112-ok:`) still applies. All pinned in
  // --self-test, in both directions.
  {
    name: 'local-fallback',
    re: /\b(?:const|let|var)\s+code\s*(?::[^=;\n]+)?=\s*(?![`'"])[\w$.?!()[\]|&\s]{0,80}?(?:\|\||\?\?)\s*'([a-z][a-z0-9_]*)'/g,
  },
];

/**
 * ⛔ SHRINK-ONLY. Lowercase codes that are ALREADY ON THE WIRE and whose rename
 * belongs to another lane's card, keyed `<file>::<literal>` so a line shift
 * cannot invalidate an entry.
 *
 * This list exists for one reason and admits nothing else: widening the
 * recognizer above made this gate able to see codes that shipped while it was
 * blind. Renaming them is a WIRE change — a client matching on the old spelling
 * breaks, and one is pinned by name in
 * `packages/qa/dogfood/test/admin-route-nonadmin-refusal.dogfood.test.ts` — so
 * it is owned by the service that emits them, not by the tooling change that
 * revealed them.
 *
 * The list only ever shrinks. An entry that stops matching is a FAILURE (the
 * rename landed — delete the line), which is what keeps this from drifting into
 * an allowlist nobody re-reads. A NEW lowercase code never joins it: the gate
 * refuses that, and the remedy for a fresh finding is a registered SCREAMING
 * code, never a line here.
 *
 * [#10716] It is now EMPTY, and that is this list reaching its designed end
 * rather than a list that never had a use: both entries it was created for
 * (`request_domain_verification_failed`, `verify_domain_failed`) were renamed
 * onto the registered ledger code `DOMAIN_VERIFICATION_FAILED` by the services
 * lane, and the owning PR deleted them here — the coordination #10658 asked
 * for, so the gate ends up green with zero exceptions. Emptiness costs no
 * coverage: --self-test drives the shrink-only semantics against a FIXTURE
 * registry, and pins the live one AT zero so a future exception cannot be
 * added quietly.
 */
const KNOWN_LOWERCASE_CODES = new Map([]);

/** Split findings into the two the wire already carries and everything else. */
export function partitionKnown(violations, registry = KNOWN_LOWERCASE_CODES) {
  const known = [];
  const fresh = [];
  for (const v of violations) {
    (registry.has(`${v.file}::${v.literal}`) ? known : fresh).push(v);
  }
  const reached = new Set(known.map((v) => `${v.file}::${v.literal}`));
  const stale = [...registry.keys()].filter((k) => !reached.has(k)).sort();
  return { known, fresh, stale };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo' || entry === 'coverage') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}



export function findViolations(src, file, stats = null) {
  const text = maskComments(src);
  const hits = [];
  for (const { name, re } of CODE_POSITION_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const literal = m[1];
      if (NOT_CODES.has(literal)) continue;
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const lineEnd = text.indexOf('\n', m.index);
      const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const lineNo = text.slice(0, m.index).split('\n').length;
      // `typeof x.code === 'number'` and friends: a type guard, not a code
      if (/typeof\s+[\w.?]*code\s*(?:===|!==)/.test(line)) continue;
      // D6: the literal sits in a field/param/path-addressed record. Check a
      // small window, not just the hit line — `{ code, field, message }` is
      // routinely spread over three lines, and the discriminating key is as
      // likely to be below the code as beside it.
      const allLines = text.split('\n');
      const window = allLines.slice(Math.max(0, lineNo - 3), lineNo + 2).join('\n');
      if (/\b(field|param|path|target)\s*[:,=]/.test(window)) continue;
      // `code` is also a plain domain field name — a license plan code, an
      // industry code, a locale. Require an error-shaped neighbour before
      // calling a lowercase literal a violation, or the guard starts policing
      // seed data and gets switched off.
      if (!/\b(error|message|throw|reject|httpStatus|statusCode|status|issues|failed|denied|refus)/i.test(window)) continue;
      // not an error code at all: locale/language/currency/country code fields
      if (/\b(locale|language|currency|country|label)\b/.test(line)) continue;
      // site-level opt-out for a file that legitimately holds BOTH vocabularies
      // (e.g. protocol.ts throws a catalog code and writes an audit row beside
      // it). Must name a reason, on the hit line or the line above it.
      const rawLines = src.split('\n');
      const own = rawLines[lineNo - 1] ?? '';
      const prev = rawLines[lineNo - 2] ?? '';
      if (/adr0112-ok:\s*\S/.test(own) || /adr0112-ok:\s*\S/.test(prev)) {
        // Counted, not just skipped: a suppression this run APPLIED is part of
        // what the verdict line has to own up to.
        if (stats) stats.optOuts++;
        continue;
      }
      hits.push({ file, line: lineNo, literal, form: name });
    }
  }
  return hits;
}

function selfTest() {
  const cases = [
    // [source, expectedHitCount, label]
    [`return c.json({ error: { code: 'not_found', message: 'x' } }, 404);`, 1, 'emission'],
    [`const err = new Error('locked'); (err as any).code = 'item_locked';`, 1, 'assignment'],
    [`if (err?.code === 'destructive_change') throw err;`, 1, 'comparison'],
    [`interface R { error?: string; code?: 'forbidden' | 'invalid_signal'; }`, 1, 'union type'],
    [`error: { code: 'RESOURCE_NOT_FOUND', message: 'x' }`, 0, 'SCREAMING passes'],
    [`ctx.addIssue({ code: 'custom', message: 'x' });`, 0, "Zod's own code"],
    [`issues.push({ field: 'email', code: 'invalid_email', message: 'x' });`, 0, 'D6 field-addressed'],
    [`// legacy servers sent code: 'not_found' here`, 0, 'comment is not code'],
    [`if (info.services.i18n.status === 'unavailable') {}`, 0, 'status vocabulary'],
    [`locales.push({ code: 'en', label: 'en', isDefault: true });`, 0, 'locale code is not an error code'],
    [`expect(f.field === 'organization_id' && f.code === 'required').toBe(true);`, 0, 'D6 via field ==='],
    [`code: 'item_locked', // adr0112-ok: D6b persisted audit column`, 0, 'inline opt-out, same line'],
    [`// adr0112-ok: D6b persisted audit column\n            code: 'item_locked',`, 0, 'inline opt-out, line above'],
    [`throw Object.assign(new Error('x'), { code: 'item_locked' }); // adr0112-ok:`, 1, 'opt-out without a reason does not count'],
    [`const plan = PlanSchema.parse({ code: 'pro_v1', features: [] });`, 0, 'license plan code is domain data'],
    [`records: [{ code: 'tech', name: 'Technology' }],`, 0, 'seed industry code is domain data'],
    [`{ code: 'required', message: 'x', target: 'email' }`, 0, "D6 via OData's target"],

    // [#10658] The `||` / `??` fallback slot. Pinned as a PAIR with the direct
    // spelling of the same code: a recognizer that reached the new shape by
    // breaking the old one would pass a self-test that only pinned the new one.
    [`error: { code: 'verify_domain_failed', message }`, 1, 'direct spelling (the pair half that must not regress)'],
    [`error: { code: parsed?.code || 'verify_domain_failed', message }`, 1, 'our default behind an || fallback'],
    [`error: { code: parsed?.code ?? 'lookup_failed', message }`, 1, 'our default behind a ?? fallback'],
    [`const err = new Error(msg); (err as any).code = e?.code || 'lookup_failed';`, 1, 'fallback in the assignment position'],
    [`error: { code: a?.code || b?.code || 'chained_failed', message }`, 1, 'fallback at the end of a chain'],

    // Reject side. A vendor code PASSING THROUGH is a runtime value, so it has
    // no literal to capture — that is the line, and it is why widening here
    // cannot start flagging one.
    [`return { status: resp.status, body: { error: { code: parsed?.code, message } } };`, 0, 'vendor code passing through has no literal'],
    [`error: { code: parsed?.code || 'VERIFY_DOMAIN_FAILED', message }`, 0, 'a SCREAMING default is compliant'],
    [`{ code: a.code, message: m || 'lower_thing' }`, 0, "a neighbour's fallback is not this code's value"],
    [`issues.push({ field: 'email', code: e?.code || 'invalid_email' });`, 0, 'D6 still wins through the fallback shape'],
    [`{ code: row.code || 'ok', message: 'x' }`, 0, 'NOT_CODES still applies through the fallback shape'],
    [`error: { code: e?.code || 'item_locked', message } // adr0112-ok: D6b persisted audit column`, 0, 'opt-out still applies through the fallback shape'],
    [
      `error: { code: a.b.c.${'d'.repeat(90)} || 'far_away_failed', message }`,
      0,
      'the gap is bounded: a runaway expression is a declared miss, not a leap',
    ],

    // [#10897] The same our-default slot in a LOCAL'S INITIALIZER. Pinned as a
    // pair with the stamp-site spellings for the same reason those were pinned
    // as a pair with the direct one: a recognizer that reached the new position
    // by breaking an older one would pass a self-test that only pinned the new
    // position. Every case below carries the error-shaped neighbour the filters
    // require, positive AND negative — a zero that comes from a MISSING
    // neighbour would be a broken probe testing nothing about the recognizer.
    [`const code = parsed?.code || 'local_lower_failed'; const err = new Error(msg); err.code = code;`, 1, 'our default in an untyped local initializer'],
    [`const code: string = parsed?.code ?? 'typed_lower_failed'; const err = new Error(msg); err.code = code;`, 1, 'our default in a TYPED local initializer (the annotation is what puts an = in the gap)'],
    [`let code = e?.code || 'let_lower_failed'; const err = new Error(msg); err.code = code;`, 1, 'let, not only const'],
    [`const code = a?.code || b?.code || 'local_chained_failed'; const err = new Error(msg); err.code = code;`, 1, 'local initializer, fallback at the end of a chain'],
    [`error: { code: parsed?.code || 'stamp_still_seen_failed', message }`, 1, 'stamp-site objlit still matches (the pair half that must not regress)'],
    [`const err = new Error(msg); (err as any).code = e?.code || 'assign_still_seen_failed';`, 1, 'stamp-site assignment still matches (the pair half that must not regress)'],

    // Reject side for the local position.
    [`const code = parsed?.code || 'LOCAL_UPPER_FAILED'; const err = new Error(msg); err.code = code;`, 0, 'a SCREAMING default in a local is compliant'],
    [`const code = parsed?.code; const err = new Error(msg); err.code = code;`, 0, 'a vendor code through a local has no literal to capture, before or after this widening'],
    [`const codeName = parsed?.code || 'not_the_code_local'; throw new Error(codeName);`, 0, 'a local whose name merely STARTS with code is not the code position'],
    [`const message = parsed?.message || 'lower_thing'; throw new Error(message);`, 0, "a NEIGHBOUR's local fallback is not the code's value"],
    [`const code = 'local_direct_failed'; const err = new Error(msg); err.code = code;`, 0, 'an all-literal local REDUCES (#9568), so its site is the dispatcher gate\'s, not ours'],
    [`const code = 'chain_lower_a' || 'chain_lower_b'; const err = new Error(msg); err.code = code;`, 0, 'an all-literal chain reduces too, and stays the dispatcher gate\'s'],
    [`const code: Foo = fallbackFor(e); const other = x || 'leapt_failed'; throw new Error(msg);`, 0, 'the annotation gap refuses ; and =, so a match cannot leap into the NEXT statement'],
    [`const code = row.code || 'ok'; const err = new Error(msg); err.code = code;`, 0, 'NOT_CODES still applies through the local shape'],
    [`issues.push({ field: 'email' }); const code = e?.code || 'invalid_email'; throw new Error(msg);`, 0, 'D6 still wins through the local shape'],
    [`const code = e?.code || 'local_optout_failed'; throw new Error(msg); // adr0112-ok: D6b persisted audit column`, 0, 'opt-out still applies through the local shape'],
    [
      `const code = a.b.c.${'d'.repeat(90)} || 'local_far_away_failed'; const err = new Error(msg); err.code = code;`,
      0,
      'the local gap is bounded too: a runaway expression is a declared miss, not a leap',
    ],
  ];
  let failed = 0;
  for (const [src, want, label] of cases) {
    const got = findViolations(src, 'self-test.ts').length;
    if (got !== want) {
      console.error(`  ✗ self-test "${label}": expected ${want} hit(s), got ${got}`);
      failed++;
    }
  }
  // [#10658] The shrink-only registry, in both directions. The second one is
  // the load-bearing half: when the owning card's rename lands, a stale line
  // must FAIL rather than sit there as a quiet allowlist entry.
  //
  // [#10716] These drive a FIXTURE registry rather than the live one, which is
  // now empty. The semantics being pinned belong to the MECHANISM (an entry
  // that stops matching is stale and fails; a new code is never absorbed), and
  // they have to survive the live list reaching zero — otherwise emptying it
  // would have silently taken the coverage with it. The live list gets its own
  // assertion below.
  const SSO = 'packages/plugins/plugin-auth/src/register-sso-provider.ts';
  const row = (literal) => ({ file: SSO, line: 1, literal, form: 'fallback' });
  const fixtureRegistry = new Map([
    [`${SSO}::request_domain_verification_failed`, 'fixture — the shape the live list had before #10716'],
    [`${SSO}::verify_domain_failed`, 'fixture — the shape the live list had before #10716'],
  ]);
  const partitionCases = [
    [[row('request_domain_verification_failed'), row('verify_domain_failed')], { known: 2, fresh: 0, stale: 0 }, 'both known rows still present'],
    [
      [row('request_domain_verification_failed'), row('verify_domain_failed'), row('brand_new_failure')],
      { known: 2, fresh: 1, stale: 0 },
      'a NEW lowercase code is fresh, never absorbed by the list',
    ],
    [[row('verify_domain_failed')], { known: 1, fresh: 0, stale: 1 }, 'a landed rename goes STALE and must fail'],
    [[], { known: 0, fresh: 0, stale: 2 }, 'an empty tree makes every entry stale'],
  ];
  for (const [input, want, label] of partitionCases) {
    const got = partitionKnown(input, fixtureRegistry);
    const shape = { known: got.known.length, fresh: got.fresh.length, stale: got.stale.length };
    if (shape.known !== want.known || shape.fresh !== want.fresh || shape.stale !== want.stale) {
      console.error(`  ✗ self-test "${label}": expected ${JSON.stringify(want)}, got ${JSON.stringify(shape)}`);
      failed++;
    }
  }

  // [#10716] The live registry, at zero. It is closed to new entries by the rule
  // above, so "closed" is checked rather than merely written down: a wire-visible
  // code that genuinely needs deferring is a call for the ADR-0112 owner to make
  // in the open, not a line someone adds back here on the way past.
  if (KNOWN_LOWERCASE_CODES.size !== 0) {
    console.error(
      `  ✗ self-test "the live registry stays empty": KNOWN_LOWERCASE_CODES holds ${KNOWN_LOWERCASE_CODES.size} entry/entries — ` +
        `this list is closed (#10658/#10716); a new deferral is an ADR-0112 decision, not a line here.`,
    );
    failed++;
  }

  if (failed) {
    console.error(`\n✗ check-error-code-casing self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(
    `✓ check-error-code-casing self-test: ${cases.length} recognizer case(s) + ${partitionCases.length + 1} registry case(s) pass.`,
  );
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)));
  const stats = { optOuts: 0, exempt: 0 };
  const violations = [];
  for (const full of files) {
    const rel = relative(ROOT, full).split(sep).join('/');
    if (EXEMPT_FILES.has(rel)) {
      stats.exempt++;
      continue;
    }
    violations.push(...findViolations(readFileSync(full, 'utf8'), rel, stats));
  }

  const { known, fresh, stale } = partitionKnown(violations);

  if (fresh.length === 0 && stale.length === 0) {
    console.log(`✓ no unlisted lowercase error codes in ${files.length} scanned file(s) (ADR-0112).`);
    console.log(unreadable(stats, known));
    return;
  }

  if (stale.length) {
    console.error(`\n✗ ${stale.length} stale KNOWN_LOWERCASE_CODES entry/entries:\n`);
    for (const key of stale) console.error(`  ${key.replace('::', "  '")}'  — no longer present`);
    console.error(`
Good news, and the list has to say so out loud: the rename landed, so DELETE
each line above from KNOWN_LOWERCASE_CODES in this script. That list only ever
shrinks, and a stale line is how it would have started drifting into an
allowlist nobody re-reads.
`);
    if (fresh.length === 0) process.exit(1);
  }

  console.error(`\n✗ lowercase error-code literal(s) in a code position (ADR-0112 D1):\n`);
  for (const v of fresh) {
    console.error(`  ${v.file}:${v.line}  '${v.literal}'  (${v.form})`);
  }
  console.error(`
error.code is a closed set of SCREAMING_SNAKE values — StandardErrorCode
(packages/spec/src/api/errors.zod.ts) for generic conditions, ERROR_CODE_LEDGER
(packages/spec/src/api/error-code-ledger.zod.ts) for service-specific ones.

  - a generic condition (not found / permission / validation / rate limit) should
    use the standard catalog rather than register a synonym;
  - anything else gets a SCREAMING code registered under its owning package.

If this literal is NOT an error.code — a field/param-addressed validator code
(D6), a persisted column (D6b), or a diagnostics record shipped inside a 200
(D6c) — add the file to EXEMPT_FILES in this script WITH its reason.

KNOWN_LOWERCASE_CODES is not a way out and this gate does not offer it: that
registry only ever shrinks, it is closed to a code found here, and no new line
is admitted to it. It holds codes that were already on the wire when this gate
was still blind to their shape, each owned by the card that renames it.
`);
  console.error(unreadable(stats, known));
  process.exit(1);
}

/**
 * The other half of the fraction (#10501): a scan that reports only what it
 * FOUND renders a bounded read exactly like a complete one, and that is the
 * defect this gate shipped — an unqualified "no lowercase error codes" over a
 * tree carrying two. Every blindness below is deliberate and this run can count
 * it, so the verdict states it rather than implying none exists.
 */
function unreadable(stats, known) {
  return [
    `  what this run did NOT read — the line above is a bounded claim, not a clean bill:`,
    `    · ${stats.exempt} file(s) skipped whole (EXEMPT_FILES: D6/D6b/D6c and foreign vocabularies)`,
    `    · ${stats.optOuts} literal(s) suppressed by an adr0112-ok: reason`,
    `    · ${known.length} known lowercase code(s) deferred to their owning card (KNOWN_LOWERCASE_CODES)`,
    `    · a code value with NO literal at the position — a constant, a template, a ternary,`,
    `      a helper parameter — is out of reach for every pattern here by construction; that`,
    `      half belongs to check:dispatcher-error-vocabulary, which reports its own scope.`,
  ].join('\n');
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
