#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-doc-formula-expressions — the CEL **semantic** gate for formula examples
 * in the docs/skills corpus (#5116).
 *
 * ## The hole this closes
 *
 * `check:doc-authoring` checks the *shape* of a metadata literal (is it wrapped
 * in its `defineX` factory?). `check:skill-examples` runs `tsc --noEmit` over
 * blocks marked `os:check`. Between them, a formula example that **compiles
 * perfectly and is semantically wrong** passes every gate: `expression` is typed
 * `string`, so `'quantity * price'` type-checks exactly as well as
 * `'record.quantity * record.price'`. Only the second one works.
 *
 * That is not hypothetical. #5026 activated the field-formula check in
 * `validate-expressions.ts` (it had been keyed on `f.formula`, a name the schema
 * rejects, so it had never run against a stack that parses) and the sweep found
 * two doc examples teaching the bare-reference form — `content/docs/data-modeling/
 * fields.mdx` and `content/blog/context-window-is-the-constraint.mdx` (#5116).
 * A bare reference in a record-scoped CEL expression does not throw: it resolves
 * to nothing and the expression **silently evaluates to null**. Copy that line
 * into an app and `os build` now fails — the docs taught what the platform gate
 * rejects.
 *
 * Examples are corpus. An error here is copied, not merely read, so its cost is
 * multiplied by every AI author that reads the page.
 *
 * ## Why the verdict is imported, never reimplemented
 *
 * The judgment is `validateExpression('value', src, { scope: 'record' })` from
 * `@objectstack/formula` — the same call `validate-expressions.ts` makes for a
 * field `expression`, which is the same one `os build` / `os validate` and the
 * agent-callable `validate_expression` tool make. Reimplementing "does this look
 * bare?" here would create a SECOND opinion about one contract, which is the
 * thing Prime Directive #12 exists to prevent: the docs would then be gated by a
 * dialect of the rule rather than by the rule.
 *
 * ## Why the discriminator is the whole design (and is deliberately narrow)
 *
 * The verdict is free — it needs no object schema, because "bare reference" is a
 * property of the SCOPE, not of the field list. What is expensive is deciding
 * **which slots are record-scoped formulas at all**, because the corpus spells at
 * least three unrelated contracts with one key, `expression:`:
 *
 * | Site                                                  | Contract              | `amount * 2` is |
 * |-------------------------------------------------------|-----------------------|-----------------|
 * | `Field.formula({ expression })`                        | record-scoped CEL     | **wrong**       |
 * | decision node `config.conditions[].expression`         | flattened flow scope  | **correct**     |
 * | `schedule: { type: 'cron', expression: '0 9 * * *' }`   | a cron string, not CEL| not CEL at all  |
 *
 * Measured on the corpus at the time of writing: of 40 `expression:` sites, 7 are
 * flow-scoped and 4 are cron. A gate keyed on the KEY would have confidently
 * reported all 11 as bare-reference errors — a gate whose reds are wrong is worse
 * than no gate, because it teaches people to add ignores. So this scans the
 * parsed TypeScript, never the text, and opts a site in only on a structure that
 * can mean nothing else:
 *
 *   A. `Field.<anything>({ … expression … })` — a field factory call. Every
 *      `expression` a `Field.*` factory takes is the record-scoped computed-value
 *      slot; cron lives under `schedule`, flow predicates under a node's config.
 *   B. an object literal carrying both `type: 'formula'` and `expression` — the
 *      raw (non-factory) spelling of the same field.
 *
 * Both were verified against the real corpus to admit every genuine formula
 * example and none of the flow/cron sites.
 *
 * ## What this gate does NOT claim (stated, because silent scope is a lie)
 *
 * - **Only TS/TSX fenced blocks.** YAML/JSON examples are not parsed.
 * - **Only statically-extractable sources** — a string literal, a plain template,
 *   or a tagged template (`` F`…` ``, `` cel`…` ``) with no interpolation.
 * - **No field-existence check.** Doc fragments declare no object, so only the
 *   object-independent half of the verdict (syntax + scope) applies. That is the
 *   half that caught #5116.
 * - **Flow / action / validation predicates are out of scope**, deliberately:
 *   their scope depends on enclosing structure a fragment does not carry, and
 *   guessing it is exactly the false-red above.
 *
 * A block that LOOKS like it carries a formula expression but yields nothing is a
 * hard **error**, not a skip — "absence must be loud" (AGENTS.md). Silently
 * skipping what it cannot parse is how a gate comes to report success over a
 * surface it never read.
 *
 * Usage:
 *   node scripts/check-doc-formula-expressions.mjs             # scan the corpus
 *   node scripts/check-doc-formula-expressions.mjs --self-test # prove both directions
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { validateExpression } from '@objectstack/formula';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/**
 * The corpus roots, matching `scripts/check-doc-authoring.mjs`. `content` (not
 * `content/docs`) is load-bearing: one of the two #5116 defects was in
 * `content/blog/`, which `check:skill-examples` does not scan at all.
 */
const ROOTS = ['.claude', 'docs', 'skills', 'content'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Whole subtrees skipped by path. Same list and same reasoning as
 * `check-doc-authoring.mjs`: `.claude/worktrees` is a per-agent working copy of
 * the whole repo (this walker is `readdirSync`, so .gitignore does not exclude
 * it); `docs/{audits,handoff,plans}` are dated process records, not live
 * instruction. `content/docs/references` is generated from the schemas by
 * `build-docs.ts`, so it cannot drift independently of its source.
 */
const SKIP_PATHS = new Set([
  '.claude/worktrees',
  'docs/audits',
  'docs/handoff',
  'docs/plans',
  'content/docs/references',
]);

const posix = (p) => p.split(sep).join('/');

/**
 * Every root must resolve. `check-doc-authoring.mjs` learned this the hard way
 * (#4916): a walk wrapped in `try {} catch {}` turns a renamed root into a
 * silently smaller scan that still prints "clean".
 */
function assertRootsResolvable() {
  const missing = ROOTS.filter((r) => !existsSync(join(REPO_ROOT, r)));
  if (missing.length > 0) {
    console.error(
      `✗ check:doc-formula-expressions — declared corpus root(s) do not exist: ${missing.join(', ')}\n` +
        `  A root that cannot be opened must fail by name, not shrink the scan in silence.\n` +
        `  Fix the path in ROOTS, or remove the entry deliberately.`,
    );
    process.exit(1);
  }
}

function collectFiles() {
  const out = [];
  const walk = (dir) => {
    const rel = posix(relative(REPO_ROOT, dir));
    if (SKIP_PATHS.has(rel)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) {
        out.push(full);
      }
    }
  };
  for (const r of ROOTS) walk(join(REPO_ROOT, r));
  return out.sort();
}

/** ```ts|typescript|tsx blocks, with the 1-based source line of their first body line. */
export function fencedBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let open = -1;
  let lang = '';
  for (let i = 0; i < lines.length; i++) {
    const m = /^```([A-Za-z0-9]*)\s*$/.exec(lines[i]);
    if (open === -1 && m) {
      open = i;
      lang = m[1];
      continue;
    }
    if (open !== -1 && /^```\s*$/.test(lines[i])) {
      if (/^(ts|typescript|tsx)$/.test(lang)) {
        out.push({ code: lines.slice(open + 1, i).join('\n'), startLine: open + 2 });
      }
      open = -1;
    }
  }
  return out;
}

/**
 * Parse a block into one or more scannable units.
 *
 * A doc fragment is very often a bare object literal — `{ type: 'formula',
 * expression: '…' }` — and at STATEMENT position TypeScript parses a leading `{`
 * as a block statement, so the tree holds no object literal and a scan finds
 * nothing. That is a false negative, and a silent one.
 *
 * The recovery is structural rather than a whole-block heuristic: parse the
 * block normally, then re-read every top-level *block statement* as a
 * parenthesized expression. This covers both the fragment that IS one object
 * literal and the common doc shape where imports are shown first and the literal
 * follows (`import { F } … \n { type: 'formula', … }`), which a
 * starts-with-`{` test misses. Each unit carries the line offset needed to map
 * back to the original block, so locations stay exact.
 */
function parseUnits(code) {
  const direct = ts.createSourceFile('block.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const units = [{ sf: direct, lineOffset: 0 }];
  for (const stmt of direct.statements) {
    if (!ts.isBlock(stmt)) continue;
    const start = stmt.getStart(direct);
    const startLine = ts.getLineAndCharacterOfPosition(direct, start).line;
    const wrapped = ts.createSourceFile(
      'block.tsx',
      `(\n${code.slice(start, stmt.getEnd())}\n)`,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
    );
    // The wrapper puts the original first line on line 1 of `wrapped`.
    units.push({ sf: wrapped, lineOffset: startLine - 1 });
  }
  return units;
}

function propOf(obj, name) {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const k = ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : undefined;
    if (k === name) return p.initializer;
  }
  return undefined;
}

/**
 * The CEL source behind an `expression` initializer, when it is statically
 * knowable: `'…'`, `` `…` ``, or a tagged template with no interpolation
 * (`` F`…` ``, `` cel`…` `` — the blessed authoring spellings). An interpolated
 * template is reported as unknowable rather than guessed at.
 */
export function staticSource(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTaggedTemplateExpression(node) && ts.isNoSubstitutionTemplateLiteral(node.template)) {
    return node.template.text;
  }
  return undefined;
}

/**
 * Every record-scoped formula `expression` in one block, by structure.
 * See the discriminator note in the header for why these two shapes and no
 * key-based match.
 */
export function extractFormulaExpressions(code) {
  const found = [];
  // Deduplicated by (line, source): the same expression can be reached both by
  // the direct parse and by a recovery unit, and it is one example either way.
  const seen = new Set();

  for (const { sf, lineOffset } of parseUnits(code)) {
    const take = (initializer, via) => {
      const line = ts.getLineAndCharacterOfPosition(sf, initializer.getStart(sf)).line + lineOffset;
      const source = staticSource(initializer);
      // The separator and the "no static source" sentinel are control chars so
      // they cannot collide with real expression text. Both MUST stay written as
      // escape SEQUENCES, never raw bytes: a raw byte is invisible in review, and
      // one literal NUL makes grep/ripgrep treat the whole file as binary and
      // return zero matches — the file drops out of code search and out of every
      // grep-based lint with no error saying so (#4890, pnpm check:nul-bytes).
      const key = `${line}\u0000${source ?? '\u0001unknowable'}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ line, via, source });
    };

    const visit = (n) => {
      // A — a `Field.*` factory call. Any object-literal argument that carries an
      // `expression` is the record-scoped computed-value slot.
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === 'Field'
      ) {
        for (const arg of n.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          const e = propOf(arg, 'expression');
          if (e) take(e, `Field.${n.expression.name.text}(…)`);
        }
      }
      // B — the raw spelling: an object literal declaring `type: 'formula'`.
      if (ts.isObjectLiteralExpression(n)) {
        const t = propOf(n, 'type');
        const e = propOf(n, 'expression');
        if (e && t && ts.isStringLiteralLike(t) && t.text === 'formula') take(e, "type: 'formula'");
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * Does this block's TEXT claim to carry a formula expression? Used only to make
 * a failed extraction loud — never to judge one.
 */
export function looksLikeFormulaBlock(code) {
  return /expression\s*:/.test(code) && /(Field\.\w+\s*\(|type:\s*['"]formula['"])/.test(code);
}

/** The imported verdict. Never a local reimplementation — see the header. */
export function judge(source) {
  return validateExpression('value', source, { scope: 'record' }).errors;
}

function scan(files) {
  const violations = [];
  const unextractable = [];
  let blocks = 0;
  let checked = 0;

  for (const file of files) {
    const rel = posix(relative(REPO_ROOT, file));
    for (const b of fencedBlocks(readFileSync(file, 'utf8'))) {
      blocks++;
      const found = extractFormulaExpressions(b.code);
      if (found.length === 0) {
        if (looksLikeFormulaBlock(b.code)) unextractable.push(`${rel}:${b.startLine}`);
        continue;
      }
      for (const f of found) {
        const where = `${rel}:${b.startLine + f.line}`;
        if (f.source === undefined) {
          unextractable.push(`${where} (interpolated ${f.via} — source not statically knowable)`);
          continue;
        }
        checked++;
        for (const e of judge(f.source)) {
          violations.push({ where, via: f.via, source: f.source, message: e.message });
        }
      }
    }
  }
  return { violations, unextractable, blocks, checked };
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Both directions, executed rather than described, plus the two false-red shapes
 * the discriminator must NOT admit. The bad fixtures are the verbatim pre-#5116
 * sources, so this test fails if the gate ever stops catching the defect it was
 * built for.
 */
const SELF_TEST_CASES = [
  {
    name: 'RED — the fields.mdx defect (#5116), verbatim',
    code: "total: Field.formula({\n  label: 'Total',\n  expression: 'quantity * price * (1 - discount / 100)',\n}),",
    expect: { extracted: 1, errors: 1, match: /bare reference `quantity`/ },
  },
  {
    name: 'RED — the blog defect (#5116), verbatim (tagged template)',
    code: "expected_revenue: Field.formula({\n  label: 'Expected Revenue',\n  expression: cel`amount * probability`,\n}),",
    expect: { extracted: 1, errors: 1, match: /bare reference `amount`/ },
  },
  {
    name: 'RED — the raw `type: \'formula\'` spelling, bare refs',
    code: "{ name: 'full_name', type: 'formula', expression: 'first_name + \" \" + last_name' }",
    expect: { extracted: 1, errors: 1, match: /bare reference `first_name`/ },
  },
  {
    name: 'RED — a syntactically broken formula',
    code: "total: Field.formula({ expression: 'record.amount *' }),",
    expect: { extracted: 1, errors: 1, match: /invalid CEL/ },
  },
  {
    name: 'GREEN — the canonical fix (the gate discriminates, it is not just on)',
    code: "total: Field.formula({\n  expression: 'record.quantity * record.price * (1 - record.discount / 100)',\n}),",
    expect: { extracted: 1, errors: 0 },
  },
  {
    name: 'GREEN — helper functions and ternaries are ordinary CEL',
    code: "x: Field.formula({ expression: F`record.revenue > 0 ? ((record.revenue - record.cost) / record.revenue) * 100 : 0` }),",
    expect: { extracted: 1, errors: 0 },
  },
  {
    name: 'GREEN — a multi-line template formula',
    code: "x: Field.formula({ expression: `\n  record.amount > 1000 ? \"big\" :\n  \"small\"\n` }),",
    expect: { extracted: 1, errors: 0 },
  },
  {
    name: 'NOT ADMITTED — a cron schedule spells `expression` too, and is not CEL',
    code: "config: { schedule: { type: 'cron', expression: '0 9 * * *' } },",
    expect: { extracted: 0 },
  },
  {
    name: 'NOT ADMITTED — a decision branch is FLATTENED scope, where a bare ref is correct',
    code: "config: {\n  conditions: [\n    { label: 'High Value', expression: 'order_amount > 10000' },\n  ],\n},",
    expect: { extracted: 0 },
  },
  {
    name: 'NOT ADMITTED — a validation rule `condition` is a different slot entirely',
    code: "validations: [{ name: 'r', type: 'cross_field', condition: 'record.a > record.b' }],",
    expect: { extracted: 0 },
  },
  {
    name: 'LOUD — a formula block whose source is interpolated is reported, not skipped',
    code: 'x: Field.formula({ expression: `record.${fieldName} * 2` }),',
    expect: { extracted: 1, unknowable: true },
  },
];

function selfTest() {
  let failed = 0;
  for (const c of SELF_TEST_CASES) {
    const found = extractFormulaExpressions(c.code);
    const problems = [];
    if (found.length !== (c.expect.extracted ?? 0)) {
      problems.push(`extracted ${found.length}, expected ${c.expect.extracted ?? 0}`);
    }
    if (c.expect.unknowable) {
      if (found[0]?.source !== undefined) problems.push('expected a non-statically-knowable source');
      // And the text-level tripwire must also fire, so a whole unparsed block is loud.
      if (!looksLikeFormulaBlock(c.code)) problems.push('looksLikeFormulaBlock() should flag this');
    } else if (found.length === 1 && c.expect.errors !== undefined) {
      const errs = found[0].source === undefined ? [] : judge(found[0].source);
      if (errs.length !== c.expect.errors) {
        problems.push(`${errs.length} error(s), expected ${c.expect.errors}` +
          (errs.length ? `: ${errs.map((e) => e.message.split('\n')[0]).join(' | ')}` : ''));
      }
      if (c.expect.match && !errs.some((e) => c.expect.match.test(e.message))) {
        problems.push(`no error matched ${c.expect.match}`);
      }
    }
    if (problems.length) {
      failed++;
      console.error(`  ✗ ${c.name}\n      ${problems.join('\n      ')}`);
    } else {
      console.log(`  ✓ ${c.name}`);
    }
  }
  if (failed > 0) {
    console.error(`\n✗ check:doc-formula-expressions self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`\n✓ check:doc-formula-expressions self-test: ${SELF_TEST_CASES.length} cases passed`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

assertRootsResolvable();
const files = collectFiles();
const { violations, unextractable, blocks, checked } = scan(files);

if (unextractable.length > 0) {
  console.error(
    `✗ check:doc-formula-expressions — ${unextractable.length} block(s) appear to carry a formula\n` +
      `  expression that could not be extracted and therefore was NOT checked:\n`,
  );
  for (const u of unextractable) console.error(`    ${u}`);
  console.error(
    `\n  This is an error rather than a skip on purpose: a gate that silently drops what it\n` +
      `  cannot read reports success over a surface it never looked at. Either write the\n` +
      `  expression as a plain string/template literal, or — if the block genuinely has no\n` +
      `  formula in it — adjust the discriminator in this script deliberately.`,
  );
  process.exit(1);
}

if (violations.length > 0) {
  console.error(
    `✗ check:doc-formula-expressions — ${violations.length} formula example(s) in the docs/skills\n` +
      `  corpus would be REJECTED by \`os build\` / \`os validate\`:\n`,
  );
  for (const v of violations) {
    console.error(`    ${v.where}  [${v.via}]`);
    console.error(`      source: ${JSON.stringify(v.source)}`);
    console.error(`      ${v.message.split('\n').join('\n      ')}\n`);
  }
  console.error(
    `  These are copied verbatim by human and AI authors, so the cost of a wrong one is\n` +
      `  multiplied by every reader. The verdict above is the platform's own\n` +
      `  \`validateExpression\` — the same call \`os build\` makes — not a lookalike.`,
  );
  process.exit(1);
}

console.log(
  `✓ check:doc-formula-expressions: ${checked} record-scoped formula example(s) across ` +
    `${files.length} files / ${blocks} TS blocks judged clean by @objectstack/formula.`,
);
