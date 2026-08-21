#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-doc-security-posture — the AUTHOR-TIME-LINT gate for object examples in
 * the docs corpus (#10618).
 *
 * ## The hole this closes
 *
 * `check:skill-examples` compiles every `{/* os:check *\/}` block in
 * `content/docs/**` with `tsc --noEmit`, so a renamed export or a tightened
 * union goes red. But the author-time lint rules `os validate` runs
 * (`packages/lint/src/**`) never ran over those blocks, and the measured
 * consequence was #10581: 22 `ObjectSchema.create()` examples across 12 pages
 * omitted `sharingModel` — `z.enum([...]).optional()` with no `.default()`, so
 * the omission type-checks clean, while `os validate` rejects it as
 * `severity: 'error'` (`SECURITY_OWD_UNSET`, validate-security-posture.ts).
 * A reader copying a canonical docs example got a failing `os validate` with
 * no hint from the page. Sweep #10714 fixed those 22; this gate closes the
 * CLASS — and its own first run found 8 MORE instances on pages outside that
 * sweep's audited scope (protocol/, plugins/, ui/), fixed alongside it.
 *
 * ## Why the verdict is imported, never reimplemented
 *
 * The judgment is `validateSecurityPosture(stack)` from `@objectstack/lint` —
 * the same gating-tier registry entry (`authoring-rules.ts`) that `os validate`
 * / `os compile` and the runtime publish gate run. Reimplementing "is this OWD
 * posture acceptable?" here would create a SECOND opinion about one contract
 * (Prime Directive #12): the docs would be gated by a dialect of the rule
 * rather than by the rule. Same discipline, same home and same CI slot as
 * `check-doc-formula-expressions.mjs`, this gate's direct precedent — a docs
 * gate lives with the package that owns its verdict, which is why it is here
 * and not in `packages/spec/scripts/` (spec cannot depend on lint: lint
 * depends on spec, and a reverse devDependency would cycle the build graph).
 *
 * The rule's own docblock states it "accepts the NORMALIZED stack input
 * (works both pre- and post-zod-parse)", so feeding it the raw authored
 * literal is a supported entry point, not a trick. None of the keys it reads
 * on this path (`sharingModel`, `externalSharingModel`, `isSystem`, `name`,
 * `fields[].type/required/reference`) carries a zod default, so the pre-parse
 * judgment equals the post-parse one.
 *
 * ## What is admitted, and how the literal is obtained
 *
 * Only `ObjectSchema.create({ ... })` calls inside a marked block are judged
 * (`Data.ObjectSchema.create(...)` spellings included: the callee's rightmost
 * namespace identifier must be `ObjectSchema`). `App.create` / `Action.create`
 * / `Dashboard.create` etc. have no OWD posture and are not read. The literal
 * is STATICALLY evaluated, never executed — the same choice
 * `check-skill-examples` makes (tsc, no execution) and the reason
 * `check-doc-formula-expressions` gives: docs blocks are prose, not a
 * sandboxed runtime.
 *
 * Static evaluation is deliberately PARTIAL, with per-fact conservatism —
 * a value the evaluator cannot resolve (a `Field.text({...})` factory call, an
 * identifier, an interpolated template) becomes an opaque UNKNOWN sentinel,
 * and every rule verdict is then only trusted where its facts are known:
 *
 * - `SECURITY_OWD_UNSET` fires only when `sharingModel` is textually ABSENT
 *   from the literal — a present-but-unevaluable value is the sentinel, which
 *   is non-null, so "unset" can never be a guess.
 * - `SECURITY_OWD_ALIAS` / `SECURITY_EXTERNAL_WIDER` fire only on values that
 *   are static strings (the rule itself requires `typeof === 'string'`; the
 *   sentinel is not a string).
 * - `SECURITY_CBP_NO_RELATION` reads the `fields` subtree, so when that
 *   subtree is not fully static its findings are SUPPRESSED with a printed
 *   notice — a `Field.master_detail(...)` factory call must not read as "no
 *   relation". (No marked block declares `controlled_by_parent` today; the
 *   suppression exists so the first one that does cannot false-red.)
 *
 * Two shapes are refused loudly rather than skipped, because a silent skip is
 * how a gate comes to report success over a surface it never read ("absence
 * must be loud", AGENTS.md): a create call whose argument is not an object
 * literal (or carries a top-level spread / computed key), and a literal whose
 * `name` is not a static string (sys-object exemption and attribution both
 * need it). Neither occurs in today's corpus; a deliberate future one takes an
 * exemption entry below.
 *
 * ## Exemptions — named, reasoned, self-invalidating (house style)
 *
 * `EXEMPT_SITES` follows `check-doc-formula-expressions`' `EXEMPT_EXAMPLES`
 * discipline: an entry carries the site (file + object name) AND its reason,
 * never a blanket path ignore, and it is self-invalidating in both directions
 * — an entry matching no site is an error (stale), and an entry whose site now
 * judges clean is an error (unnecessary). Born EMPTY, deliberately: the 8
 * pre-existing instances this gate's first run found were fixed in the same
 * PR, not exempted — a gate born green over named debt of its own class would
 * be green in the way #10618 exists to forbid.
 *
 * ## What this gate does NOT claim
 *
 * - **Only `content/docs/**​/*.mdx`, only `{/* os:check *\/}`-marked ts/tsx
 *   fences** — the marker is the author's claim "this is a complete, copyable
 *   example", which is exactly the population whose posture must be clean.
 *   Unmarked fragments are not judged (they are not copyable wholes), matching
 *   `check-skill-examples`' own opt-in boundary. `content/docs/references/` is
 *   generated and excluded for the same reason it is there.
 * - **`skills/` is not scanned yet.** Its marked corpus has 4
 *   `ObjectSchema.create` examples with the same defect; `skills/**` is a
 *   governed surface (Prime Directive #14), so the fixes cannot ride a code
 *   PR. Extend `ROOTS` when they land — the follow-up issue filed from #10618
 *   carries both halves.
 * - **Only `error`-severity findings gate.** `warning`/`info` rules in the
 *   same function need permission sets / books a single-object doc example
 *   never carries, and firing advisory rules over fragments is the false-red
 *   that teaches people to add ignores. `validateSecurityRoleWord` is NOT run:
 *   the repo-level `check:role-word` ratchet already owns that vocabulary on
 *   the docs surface, and two gates adjudicating one word is a second opinion.
 *
 * Usage:
 *   node scripts/check-doc-security-posture.mjs             # scan the corpus
 *   node scripts/check-doc-security-posture.mjs --self-test # prove both directions
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import ts from 'typescript';
import { validateSecurityPosture, SECURITY_CBP_NO_RELATION } from '@objectstack/lint';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/**
 * The corpus root. Narrower than `check-doc-formula-expressions`' four ROOTS on
 * purpose: the card (#10618) scopes this gate to `content/docs/**` os:check
 * blocks, and `skills/` is deferred (see the header). `references/` is
 * generated by `build-docs.ts` from the schemas, so it cannot drift
 * independently of its source — same exclusion, same reason, as
 * `check-skill-examples`.
 */
const DOCS_ROOT = 'content/docs';
const EXCLUDE_SUBTREES = ['content/docs/references'];

/** The docs-root marker spelling — MDX comment syntax (`check-skill-examples`). */
const MARKER = '{/* os:check */}';

/**
 * Deliberate, reviewed exceptions. Entry shape:
 *   { file: 'content/docs/<page>.mdx', object: '<name>', reason: '<why>' }
 * Matching is by page + object name. Self-invalidating both directions — see
 * the header. Born empty.
 */
const EXEMPT_SITES = [];

/** Opaque sentinel for a value the static evaluator cannot resolve. */
const UNKNOWN = Object.freeze({ '<os-doc-posture:unevaluated>': true });

// ── Extraction (the check-skill-examples opt-in boundary, restated) ─────────

/** Every .mdx file under `root`, sorted, exclusions applied. */
export function mdxFiles(rootAbs, excludeAbs) {
  const out = [];
  const walk = (dir) => {
    if (excludeAbs.some((x) => dir === x || dir.startsWith(x + '/'))) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.mdx')) out.push(full);
    }
  };
  walk(rootAbs);
  return out.sort();
}

/**
 * Marked ```ts / ```typescript blocks in one file. Same admission as
 * `check-skill-examples.ts`: the line immediately above the opening fence is
 * exactly the marker (whitespace-trimmed). Returns
 * `{ bodyStartLine, code }[]` — bodyStartLine is the 1-based page line of the
 * first code line, so an AST line L (0-based) is page line
 * `bodyStartLine + L`.
 */
export function markedBlocks(fileAbs) {
  const lines = readFileSync(fileAbs, 'utf-8').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^```(ts|typescript)\s*$/.test(lines[i])) continue;
    const marked = i > 0 && lines[i - 1].trim() === MARKER;
    let close = i + 1;
    while (close < lines.length && !/^```\s*$/.test(lines[close])) close++;
    if (marked) blocks.push({ bodyStartLine: i + 2, code: lines.slice(i + 1, close).join('\n') });
    i = close;
  }
  return blocks;
}

// ── Static evaluation ───────────────────────────────────────────────────────

/** Is this callee an `ObjectSchema.create` spelling (namespaced included)? */
function isObjectSchemaCreate(callee) {
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'create') return false;
  let target = callee.expression;
  // Rightmost identifier of the target chain must be `ObjectSchema`.
  while (ts.isPropertyAccessExpression(target)) target = target.name;
  return ts.isIdentifier(target) && target.text === 'ObjectSchema';
}

/**
 * Evaluate one expression to a JSON-ish value.
 * Returns `{ value, complete }` — `complete` is true only when every part of
 * the value (deeply) was statically resolved. An unresolvable node yields
 * `{ value: UNKNOWN, complete: false }`; containers propagate incompleteness.
 */
function evalStatic(node) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return evalStatic(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.text, complete: true };
  }
  if (ts.isNumericLiteral(node)) return { value: Number(node.text), complete: true };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return { value: -Number(node.operand.text), complete: true };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true, complete: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false, complete: true };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null, complete: true };
  if (ts.isArrayLiteralExpression(node)) {
    const out = [];
    let complete = true;
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        out.push(UNKNOWN);
        complete = false;
        continue;
      }
      const r = evalStatic(el);
      out.push(r.value);
      complete = complete && r.complete;
    }
    return { value: out, complete };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    let complete = true;
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) {
        // spread / shorthand / method — unknowable keys or values
        complete = false;
        continue;
      }
      let key;
      if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) key = p.name.text;
      else {
        complete = false;
        continue;
      }
      const r = evalStatic(p.initializer);
      out[key] = r.value;
      complete = complete && r.complete;
    }
    return { value: out, complete };
  }
  return { value: UNKNOWN, complete: false };
}

// ── Judgment ────────────────────────────────────────────────────────────────

/**
 * Judge every marked block of one file. Returns
 * `{ sites, violations, refusals, notices }`:
 * - sites: judged `ObjectSchema.create` calls (for census / anti-idle)
 * - violations: error-severity findings `{ pageLine, object, finding }`
 * - refusals: shapes the gate refuses to guess about `{ pageLine, why }`
 * - notices: suppressed unknown-fact verdicts (informational lines)
 */
export function judgeFile(fileAbs, relPath) {
  const sites = [];
  const violations = [];
  const refusals = [];
  const notices = [];

  for (const block of markedBlocks(fileAbs)) {
    const sf = ts.createSourceFile('block.ts', block.code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && isObjectSchemaCreate(node.expression)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const pageLine = block.bodyStartLine + line;
        const arg = node.arguments[0];
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          refusals.push({
            pageLine,
            why: 'ObjectSchema.create argument is not an object literal — the posture cannot be judged statically',
          });
        } else {
          const topLevelDynamic = arg.properties.some(
            (p) => !ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)),
          );
          if (topLevelDynamic) {
            refusals.push({
              pageLine,
              why: 'ObjectSchema.create literal has a spread / computed / shorthand top-level member — key absence cannot be asserted',
            });
          } else {
            const evaluated = evalStatic(arg);
            const obj = evaluated.value;
            if (typeof obj.name !== 'string') {
              refusals.push({
                pageLine,
                why: 'object `name` is not a static string — the sys-object exemption and attribution both need it',
              });
            } else {
              // Is the `fields` subtree fully static? Only the CBP rule reads it.
              const fieldsProp = arg.properties.find(
                (p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'fields',
              );
              const fieldsComplete = fieldsProp ? evalStatic(fieldsProp.initializer).complete : true;

              const findings = validateSecurityPosture({ objects: [obj] }).filter((f) => f.severity === 'error');
              const kept = [];
              for (const f of findings) {
                if (f.rule === SECURITY_CBP_NO_RELATION && !fieldsComplete) {
                  notices.push(
                    `${relPath}:${pageLine}  object "${obj.name}": ${f.rule} suppressed — ` +
                      `the fields subtree is not statically evaluable (factory calls), so "no relation" would be a guess`,
                  );
                  continue;
                }
                kept.push(f);
              }
              sites.push({ pageLine, object: obj.name, clean: kept.length === 0 });
              for (const f of kept) violations.push({ pageLine, object: obj.name, finding: f });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }
  return { sites, violations, refusals, notices };
}

// ── Scan ────────────────────────────────────────────────────────────────────

/**
 * Scan a docs tree. Parameterized for the self-test; the real run passes the
 * repo's own paths and exemption table.
 */
export function scan({ rootAbs, excludeAbs, exemptions }) {
  const files = mdxFiles(rootAbs, excludeAbs);
  let markedBlockCount = 0;
  const allSites = [];
  const allViolations = [];
  const allRefusals = [];
  const allNotices = [];
  const errors = [];

  for (const file of files) {
    const relPath = relative(REPO_ROOT, file).split('\\').join('/');
    markedBlockCount += markedBlocks(file).length;
    const { sites, violations, refusals, notices } = judgeFile(file, relPath);
    for (const s of sites) allSites.push({ ...s, file: relPath });
    for (const v of violations) allViolations.push({ ...v, file: relPath });
    for (const r of refusals) allRefusals.push({ ...r, file: relPath });
    allNotices.push(...notices);
  }

  // Exemption discipline: stale and unnecessary entries are both errors.
  const exemptKey = (file, object) => `${file}\u0000${object}`;
  const exemptMap = new Map((exemptions ?? []).map((e) => [exemptKey(e.file, e.object), e]));
  const usedExemptions = new Set();

  const gatingViolations = [];
  for (const v of allViolations) {
    const key = exemptKey(v.file, v.object);
    if (exemptMap.has(key)) {
      usedExemptions.add(key);
      continue;
    }
    gatingViolations.push(v);
  }
  for (const [key, e] of exemptMap) {
    if (usedExemptions.has(key)) continue;
    const siteExists = allSites.some((s) => exemptKey(s.file, s.object) === key);
    errors.push(
      siteExists
        ? `unnecessary exemption: ${e.file} object "${e.object}" now judges CLEAN — delete the entry so the rule covers the site again (reason was: ${e.reason})`
        : `stale exemption: ${e.file} object "${e.object}" matches no ObjectSchema.create site in a marked block — delete or update the entry (reason was: ${e.reason})`,
    );
  }

  // Refusals are errors: the gate refuses to guess, and refusing silently
  // would be a hole. A deliberate dynamic example takes an exemption entry —
  // but a refusal has no object name, so today the remedy is restructuring
  // the example (make the literal static) or widening this gate's evaluator.
  for (const r of allRefusals) {
    errors.push(`${r.file}:${r.pageLine}  ${r.why}`);
  }

  return { files, markedBlockCount, allSites, gatingViolations, allNotices, errors };
}

// ── Main ────────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function main() {
  console.log('🛡  Linting ObjectSchema.create examples in os:check docs blocks (validateSecurityPosture)...\n');

  const rootAbs = resolve(REPO_ROOT, DOCS_ROOT);
  if (!existsSync(rootAbs)) fail(`docs root not found: ${DOCS_ROOT} — the corpus moved and this gate must move with it`);
  const { files, markedBlockCount, allSites, gatingViolations, allNotices, errors } = scan({
    rootAbs,
    excludeAbs: EXCLUDE_SUBTREES.map((p) => resolve(REPO_ROOT, p)),
    exemptions: EXEMPT_SITES,
  });

  // Anti-idle guards (`check-skill-examples` house rule: a gate that checks
  // nothing must not report success). The corpus carries ~190 marked blocks
  // and 20+ create sites today; zero of either means the extraction rotted,
  // not that the docs stopped teaching objects.
  if (markedBlockCount === 0) {
    fail(`no ${MARKER} blocks found under ${DOCS_ROOT} — extraction is broken (the corpus has ~190)`);
  }
  if (allSites.length === 0 && errors.length === 0) {
    fail(
      `no ObjectSchema.create site found in any marked block under ${DOCS_ROOT} — ` +
        `the corpus has 20+; the call matcher or evaluator has rotted`,
    );
  }

  for (const n of allNotices) console.log(`   ℹ ${n}`);

  if (errors.length > 0 || gatingViolations.length > 0) {
    if (gatingViolations.length > 0) {
      console.error(`\n✗ docs example(s) carry a security posture \`os validate\` rejects as severity: 'error':\n`);
      for (const v of gatingViolations) {
        console.error(`  ${v.file}:${v.pageLine}  object "${v.object}"  [${v.finding.rule}]`);
        console.error(`      ${v.finding.message}`);
        console.error(`      fix: ${v.finding.hint}\n`);
      }
      console.error(
        `  These are examples an AI copies verbatim; \`os validate\` runs this same rule\n` +
          `  (validateSecurityPosture, gating tier) and fails the copied app. Fix the example —\n` +
          `  do not weaken the rule, and do not drop the os:check marker to dodge the gate.\n`,
      );
    }
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log(
    `\n✅ ${allSites.length} ObjectSchema.create example(s) in ${markedBlockCount} marked block(s) ` +
      `across ${files.length} docs file(s) carry an os validate-clean security posture`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────

function selfTest() {
  const failures = [];
  const check = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const dir = mkdtempSync(join(tmpdir(), 'doc-posture-selftest-'));
  try {
    const run = (exemptions = []) => scan({ rootAbs: dir, excludeAbs: [], exemptions });

    // ── RED: the measured #10581 defect — create without sharingModel. ──────
    writeFileSync(
      join(dir, 'red.mdx'),
      [
        '# Red fixture', // 1
        '', // 2
        '{/* os:check */}', // 3
        '```ts', // 4
        `import { ObjectSchema } from '@objectstack/spec/data';`, // 5
        '', // 6
        'export const Task = ObjectSchema.create({', // 7 ← the create call
        `  name: 'project_task',`, // 8
        `  fields: { subject: { type: 'text', required: true } },`, // 9
        '});', // 10
        '```', // 11
        '',
      ].join('\n'),
    );
    {
      const r = run();
      check(r.gatingViolations.length === 1, `red: expected 1 violation, got ${r.gatingViolations.length} — the gate is DORMANT on the measured defect`);
      if (r.gatingViolations.length === 1) {
        const v = r.gatingViolations[0];
        check(v.finding.rule === 'security-owd-unset', `red: expected security-owd-unset, got ${v.finding.rule}`);
        check(v.object === 'project_task', `red: attributed to "${v.object}", expected "project_task"`);
        check(v.pageLine === 7, `red: reported page line ${v.pageLine}, expected 7 — line mapping is wrong`);
      }
      check(r.errors.length === 0, `red: unexpected structural errors: ${r.errors.join(' | ')}`);
    }

    // ── RED: retired alias value. ───────────────────────────────────────────
    writeFileSync(
      join(dir, 'alias.mdx'),
      [
        '{/* os:check */}',
        '```typescript',
        'export const O = ObjectSchema.create({',
        `  name: 'legacy_thing',`,
        `  sharingModel: 'read',`,
        '  fields: {},',
        '});',
        '```',
        '',
      ].join('\n'),
    );
    {
      const r = run();
      const alias = r.gatingViolations.filter((v) => v.object === 'legacy_thing');
      check(alias.length === 1 && alias[0].finding.rule === 'security-owd-alias', `alias: expected 1 security-owd-alias on legacy_thing, got ${JSON.stringify(alias.map((v) => v.finding.rule))}`);
      rmSync(join(dir, 'alias.mdx'));
    }

    // ── GREEN: declared posture + non-static fields (factory calls) — the
    //    partial evaluator must not turn Field.* calls into findings. ────────
    writeFileSync(
      join(dir, 'green.mdx'),
      [
        '{/* os:check */}',
        '```ts',
        `import { ObjectSchema, Field } from '@objectstack/spec/data';`,
        'export const Contact = ObjectSchema.create({',
        `  name: 'contact',`,
        `  sharingModel: 'private',`,
        '  fields: {',
        `    first_name: Field.text({ label: 'First Name', required: true }),`,
        `    account: Field.lookup('account', { required: true }),`,
        '  },',
        '});',
        '```',
        '',
        'An UNMARKED block with the defect — must not be read:',
        '',
        '```ts',
        `export const X = ObjectSchema.create({ name: 'unread_thing', fields: {} });`,
        '```',
        '',
        'A marked sys_ object without sharingModel — exempt, same as the rule:',
        '',
        '{/* os:check */}',
        '```ts',
        `export const S = ObjectSchema.create({ name: 'sys_holiday_calendar', fields: {} });`,
        '```',
        '',
        'A marked create whose sharingModel is a non-static value — conservative, no guess:',
        '',
        '{/* os:check */}',
        '```ts',
        'declare const model: any;',
        `export const D = ObjectSchema.create({ name: 'dynamic_thing', sharingModel: model, fields: {} });`,
        '```',
        '',
        'Other .create factories carry no OWD posture and are not read:',
        '',
        '{/* os:check */}',
        '```ts',
        `export const A = App.create({ name: 'crm_app' });`,
        '```',
        '',
      ].join('\n'),
    );
    {
      const r = run();
      const mine = r.gatingViolations.filter((v) => v.file.endsWith('green.mdx'));
      check(
        mine.length === 0,
        `green: ${mine.length} false positive(s) — ${mine.map((v) => `${v.object}:${v.finding.rule}`).join(', ')}. ` +
          `Factory-call fields, sys_ objects, unmarked blocks, dynamic values and non-ObjectSchema .create must all stay silent.`,
      );
      const judged = r.allSites.filter((s) => s.file.endsWith('green.mdx')).map((s) => s.object).sort();
      check(
        JSON.stringify(judged) === JSON.stringify(['contact', 'dynamic_thing', 'sys_holiday_calendar']),
        `green: judged ${JSON.stringify(judged)} — expected contact, dynamic_thing, sys_holiday_calendar (unread_thing unmarked, crm_app not ObjectSchema)`,
      );
    }

    // ── CBP with non-static fields: suppressed with a notice, not a red. ────
    writeFileSync(
      join(dir, 'cbp.mdx'),
      [
        '{/* os:check */}',
        '```ts',
        'export const Line = ObjectSchema.create({',
        `  name: 'order_line',`,
        `  sharingModel: 'controlled_by_parent',`,
        `  fields: { order: Field.masterDetail('order', { required: true }) },`,
        '});',
        '```',
        '',
      ].join('\n'),
    );
    {
      const r = run();
      const mine = r.gatingViolations.filter((v) => v.object === 'order_line');
      check(mine.length === 0, `cbp: expected suppression, got ${JSON.stringify(mine.map((v) => v.finding.rule))}`);
      check(
        r.allNotices.some((n) => n.includes('order_line') && n.includes('suppressed')),
        `cbp: expected a printed suppression notice for order_line`,
      );
      rmSync(join(dir, 'cbp.mdx'));
    }

    // ── Refusal: top-level spread is a loud error, never a silent skip. ─────
    writeFileSync(
      join(dir, 'spread.mdx'),
      [
        '{/* os:check */}',
        '```ts',
        'declare const base: any;',
        `export const O = ObjectSchema.create({ ...base, name: 'spread_thing' });`,
        '```',
        '',
      ].join('\n'),
    );
    {
      const r = run();
      check(
        r.errors.some((e) => e.includes('spread.mdx') && e.includes('spread')),
        `spread: expected a loud refusal error, got ${JSON.stringify(r.errors)}`,
      );
      rmSync(join(dir, 'spread.mdx'));
    }

    // ── Exemption discipline: stale and unnecessary entries are errors;
    //    a live entry suppresses exactly its site. ───────────────────────────
    {
      const relRed = relative(REPO_ROOT, join(dir, 'red.mdx')).split('\\').join('/');
      const live = run([{ file: relRed, object: 'project_task', reason: 'self-test' }]);
      check(live.gatingViolations.length === 0, `exempt-live: entry did not suppress its site`);
      check(live.errors.length === 0, `exempt-live: unexpected errors ${JSON.stringify(live.errors)}`);

      const stale = run([{ file: 'content/docs/nope.mdx', object: 'ghost', reason: 'self-test' }]);
      check(stale.errors.some((e) => e.startsWith('stale exemption')), `exempt-stale: expected a stale-exemption error`);

      const relGreen = relative(REPO_ROOT, join(dir, 'green.mdx')).split('\\').join('/');
      const unnecessary = run([{ file: relGreen, object: 'contact', reason: 'self-test' }]);
      check(
        unnecessary.errors.some((e) => e.startsWith('unnecessary exemption')),
        `exempt-unnecessary: a clean site's entry must be an error so the rule covers the site again`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`✗ self-test: ${f}`);
    console.error(`\ncheck-doc-security-posture --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    '✅  self-test: flags the measured defect (owd-unset) and the alias value at the right page line;\n' +
      '    stays silent on declared postures, factory-call fields, sys_ objects, unmarked blocks,\n' +
      '    dynamic values and non-ObjectSchema factories; refuses spreads loudly; and holds the\n' +
      '    exemption ledger to the self-invalidating discipline in both directions.',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else main();
