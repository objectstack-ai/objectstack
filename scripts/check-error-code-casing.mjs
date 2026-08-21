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
];

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



export function findViolations(src, file) {
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
      if (/adr0112-ok:\s*\S/.test(own) || /adr0112-ok:\s*\S/.test(prev)) continue;
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
  ];
  let failed = 0;
  for (const [src, want, label] of cases) {
    const got = findViolations(src, 'self-test.ts').length;
    if (got !== want) {
      console.error(`  ✗ self-test "${label}": expected ${want} hit(s), got ${got}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\n✗ check-error-code-casing self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ check-error-code-casing self-test: ${cases.length} cases pass.`);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)));
  const violations = [];
  for (const full of files) {
    const rel = relative(ROOT, full).split(sep).join('/');
    if (EXEMPT_FILES.has(rel)) continue;
    violations.push(...findViolations(readFileSync(full, 'utf8'), rel));
  }

  if (violations.length === 0) {
    console.log(`✓ no lowercase error codes in ${files.length} scanned file(s) (ADR-0112).`);
    return;
  }

  console.error(`\n✗ lowercase error-code literal(s) in a code position (ADR-0112 D1):\n`);
  for (const v of violations) {
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
`);
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
