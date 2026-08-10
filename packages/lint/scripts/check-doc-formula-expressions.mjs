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
 * ## The second surface: spec TSDoc `@example` (#6763)
 *
 * A TSDoc `@example` is **not reachable from any import**, so no ordinary test
 * can go red on it, and until this extension no gate read one. #6641 was the
 * proof: `RowLevelSecurityPolicySchema.check` documented its enumerated-values
 * idiom as `"status IN ('draft', 'pending')"`, which does not compile — an
 * author copying the schema's own example got a policy that denies every row —
 * and it was found by hand, months late. Ruled in on #6763 as a **scan-surface
 * extension, not new machinery**: the judgment stays imported from
 * `@objectstack/formula`; only the surface it is pointed at is new.
 *
 * Three things were measured on `origin/main` @ `5087ac6` before this was
 * written, because two of them contradict the obvious design:
 *
 * 1. **The extraction half does NOT come for free.** Markdown TS fences and
 *    TSDoc `@example` blocks are different shapes, and #6641's defect was not
 *    in a fence at all — it was an INLINE `@example "<expr>" - caption` string
 *    on a property. Pointing `ROOTS` at `packages/spec` would have read nothing.
 * 2. **The existing admission rules admit ZERO on this surface.** All 424
 *    `@example` tags under `packages/spec/src/**` were run through
 *    {@link extractFormulaExpressions}: 0 admitted, 0 tripwires. There is no
 *    `Field.formula(…)` or `type: 'formula'` example in the spec sources today.
 *    Pass A below still applies that rule to this surface — it is the ruling's
 *    literal instruction and it costs nothing — but a gate that admitted only
 *    that would arrive green and **meaningless**, which is the one thing #6763's
 *    condition 2 forbids. Hence pass B.
 * 3. **Scope cannot be inferred from the slot's schema type.** 25 slots are
 *    typed `ExpressionInputSchema`, and they do not share a scope: `hook.condition`
 *    binds the record, `page.visibleWhen` also binds `page.<var>`, `flow.condition`
 *    is flow-scoped. Judging them all as record-scoped would report
 *    `page.selectedProjectId != ''` — a correct page predicate — as a bare
 *    reference. That is the same false-red the discriminator note above exists to
 *    prevent, one surface over.
 *
 * So pass B admits by a **declared slot registry** ({@link SPEC_EXAMPLE_SLOTS}):
 * a `(declaration, property)` pair, its dialect, and the imported verdict for
 * that dialect. Two entries today, both measured. The registry cannot rot
 * quietly in either direction:
 *
 * - an entry matching **no** site is an error (rename the schema or delete the
 *   examples and the gate says so, instead of shrinking in silence — the same
 *   reasoning as {@link assertRootsResolvable});
 * - a slot **typed** by an expression-input schema that carries an `@example`
 *   but is **not** registered is an error, naming the slot. That is the tripwire
 *   for the next expression slot someone documents: it cannot be admitted by
 *   guessing its scope, so the gate refuses to guess and asks for a registry
 *   entry (or an exemption) instead.
 *
 * ## Exemptions (#6763 condition 1) — named, reasoned, self-invalidating
 *
 * Deliberately partial snippets must be exemptable, so {@link EXEMPT_EXAMPLES}
 * exists — same discipline as the parity-gate exemption lists and
 * `check-error-code-casing.mjs`'s `EXEMPT_FILES`: an entry carries the site AND
 * its reason, never a blanket path ignore. It is self-invalidating in both
 * directions, which is what separates "we thought about this one" from a hole:
 * an exemption matching no site is an error (stale), and an exemption whose site
 * now judges **clean** is an error (unnecessary — delete it and let the rule
 * cover the site again).
 *
 * Usage:
 *   node scripts/check-doc-formula-expressions.mjs             # scan the corpus
 *   node scripts/check-doc-formula-expressions.mjs --self-test # prove both directions
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import {
  validateExpression,
  isSupportedRlsExpression,
  sqlPredicateToCel,
  isPushdownableCel,
} from '@objectstack/formula';

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
  const missing = [...ROOTS, SPEC_ROOT].filter((r) => !existsSync(join(REPO_ROOT, r)));
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

// ── Surface 2: spec TSDoc `@example` (#6763) ─────────────────────────────────

/**
 * The spec sources whose TSDoc is authoring corpus. `src` and not the package
 * root: `dist` is a build artifact of the same comments, and scanning both would
 * report every finding twice.
 */
const SPEC_ROOT = 'packages/spec/src';

/** The record-scoped CEL verdict, reused verbatim from surface 1. */
function judgeRecordScoped(source) {
  return judge(source).map((e) => e.message);
}

/**
 * The ADR-0056 D4 RLS predicate verdict.
 *
 * The VERDICT is `isSupportedRlsExpression` and nothing else — the same single
 * call `@objectstack/lint`'s `validateRlsPredicateEnforceability` and
 * `RLSCompiler.compileExpression` stand on. `false` means "this predicate will
 * never enforce", which at runtime is `RLS_DENY_FILTER`: a single-policy object
 * matching zero rows.
 *
 * The `reason` below is **decoration on a decided verdict**, not a second
 * opinion: it is only computed once the boolean has already said no, purely so
 * the failure names the parse error instead of printing "false".
 */
function judgeRlsPredicate(source) {
  if (isSupportedRlsExpression(source)) return [];
  const bridged = sqlPredicateToCel(source);
  const reason = isPushdownableCel(bridged).reason ?? 'does not lower to an ObjectQL filter';
  return [
    `RLS predicate does not compile (${reason}). After the deprecated SQL bridge this reads ` +
      `${JSON.stringify(bridged)}. A predicate that does not lower fails CLOSED — the policy ` +
      `matches zero rows, so an author who copies this example gets a policy that denies all access.`,
  ];
}

/**
 * The declared expression slots on the spec TSDoc surface. See the header for
 * why admission here is a registry and not an inferred property of the slot's
 * schema type.
 *
 * `declaration` is the enclosing `const` (the Zod schema), `properties` the slots
 * on it. Every entry must match at least one `@example`, so a rename or a
 * deletion fails loudly rather than shrinking the scan.
 */
const SPEC_EXAMPLE_SLOTS = [
  {
    id: 'rls-predicate',
    declaration: 'RowLevelSecurityPolicySchema',
    properties: ['using', 'check'],
    dialect: 'RLS predicate (ADR-0056 D4)',
    judge: judgeRlsPredicate,
    // The slot #6641 was found in, by hand. Its `z.string()` type says nothing
    // about the dialect, which is exactly why the registry names it.
    why: 'the compiled RLS predicate grammar; a predicate that does not lower denies every row',
  },
  {
    id: 'hook-record-condition',
    declaration: 'HookSchema',
    properties: ['condition'],
    dialect: 'record-scoped CEL (ADR-0058 D1)',
    judge: judgeRecordScoped,
    why: "the slot's own .describe() pins the scope: \"Predicate (CEL); hook runs only when TRUE\", "
      + 'evaluated against the record',
  },
];

/**
 * Slot types that MEAN "an expression is authored here". Used only for the
 * tripwire — a slot of one of these types that carries an `@example` and is not
 * registered is reported, never judged, because its scope is not knowable from
 * the type (header, point 3).
 */
const EXPRESSION_SLOT_TYPES =
  /\b(ExpressionInputSchema|PredicateInputSchema|CronExpressionInputSchema|TemplateExpressionInputSchema)\b/;

/**
 * Sites deliberately not judged, each with its reason. See the header: named,
 * reasoned, and self-invalidating in both directions.
 *
 * `source` is the example's exact text, not a line number: a line number rots on
 * the next edit anywhere above it, and the point of an exemption is to survive
 * reflow while dying with the example it excuses.
 */
const EXEMPT_EXAMPLES = [
  {
    file: 'packages/spec/src/data/hook.zod.ts',
    slot: 'HookSchema.condition',
    source: "status = 'active' AND amount > 1000",
    // NOT a partial snippet — a real defect, of exactly the #6641 class, found by
    // this gate's own stock pass (#6763). It is SQL where the slot is CEL, and it
    // contradicts the `.describe()` on the very next line, which spells the same
    // idea as P`record.status == "closed" && record.amount > 1000`. Bare `status`
    // and `amount` would resolve to nothing even after the operators were fixed.
    // Exempted rather than corrected only because `packages/spec/src/**` belongs
    // to the spec-surface seat and #6763 landed in spec-tooling; filed for
    // transfer as #7175. Delete this entry with that fix — leaving it behind is
    // itself an error (the "unnecessary" direction above), so the cleanup cannot
    // be forgotten silently.
    reason: 'REAL DEFECT pending cross-seat fix (#7175) — SQL `=`/`AND` and bare refs in a record-scoped CEL slot',
  },
];

/** `packages/spec/src/**` sources, sorted. */
function collectSpecFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(join(REPO_ROOT, SPEC_ROOT));
  return out.sort();
}

/**
 * Every `@example` body in a file, as text, with the 1-based source line of its
 * first body line.
 *
 * Deliberately a text walk rather than an AST walk, and the two passes below
 * disagree about this on purpose. `ts.getJSDocTags` only reaches comments the
 * parser attached to a node, which on the spec sources is 110 of the 424
 * `@example` tags — the rest sit on module docblocks and on the schema
 * declaration itself, which is precisely where the fenced `typescript` examples
 * live. Pass A must see all 424; pass B needs the node (to know the slot) and so
 * is AST-bound by nature.
 *
 * The gutter strip is line-for-line, so a body line's index maps straight back to
 * a file line.
 */
export function tsdocExampleBodies(text) {
  const out = [];
  const re = /\/\*\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const commentStartLine = text.slice(0, m.index).split('\n').length; // 1-based
    const raw = m[0].split('\n');
    const lines = raw.map((l, i) => {
      let s = l;
      if (i === 0) s = s.replace(/^\s*\/\*\*/, '');
      if (i === raw.length - 1) s = s.replace(/\*\/\s*$/, '');
      return s.replace(/^\s*\*( |$)/, '');
    });
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*@example\b/.test(lines[i])) continue;
      const body = [];
      for (let j = i + 1; j < lines.length && !/^\s*@[a-zA-Z]/.test(lines[j]); j++) body.push(lines[j]);
      out.push({ body: body.join('\n'), startLine: commentStartLine + i + 1 });
    }
  }
  return out;
}

/**
 * Pass A — the existing record-scoped formula discriminator, pointed at the
 * fenced TS blocks inside spec TSDoc `@example` bodies.
 *
 * This is #6763's ruling taken literally: same admission, same verdict, new
 * surface. It admits 0 sites today (header, point 2) and is kept because the
 * rule it carries is live on surface 1, and the day a spec docblock grows a
 * `Field.formula({ expression: 'qty * price' })` example it is judged here
 * instead of shipping.
 */
function specFencedFormulaSites(rel, text) {
  const sites = [];
  const loud = [];
  for (const ex of tsdocExampleBodies(text)) {
    for (const b of fencedBlocks(ex.body)) {
      const blockStart = ex.startLine + b.startLine - 1;
      const found = extractFormulaExpressions(b.code);
      if (found.length === 0) {
        if (looksLikeFormulaBlock(b.code)) loud.push(`${rel}:${blockStart} (fenced @example)`);
        continue;
      }
      for (const f of found) {
        const where = `${rel}:${blockStart + f.line}`;
        if (f.source === undefined) {
          loud.push(`${where} (interpolated ${f.via} — source not statically knowable)`);
          continue;
        }
        sites.push({
          where, file: rel, rule: 'record-formula', slot: f.via,
          dialect: 'record-scoped CEL', source: f.source, judge: judgeRecordScoped,
        });
      }
    }
  }
  return { sites, loud };
}

/**
 * The expression behind an inline `@example "<expr>" - caption`.
 *
 * #6641's shape, and the shape every registered slot uses: a double-quoted
 * literal FIRST, then optional prose (` - Only allow certain statuses`) or a
 * trailing `// §7.3.1 pre-resolved`. Anything after the literal is caption and is
 * ignored; anything that does not START with a literal is not silently skipped —
 * the caller reports it.
 */
export function inlineExampleSource(tagText) {
  const m = /^\s*("(?:[^"\\]|\\.)*")/.exec(tagText ?? '');
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

/**
 * Pass B — registered slots, plus the unregistered-expression-slot tripwire.
 *
 * Returns `matched` (registry ids that found at least one site) so the caller can
 * fail a registry entry that has gone blind.
 */
function specSlotSites(rel, text) {
  const sites = [];
  const loud = [];
  const matched = new Set();
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name) {
      const tags = ts.getJSDocTags(node).filter((t) => t.tagName.text === 'example');
      if (tags.length > 0) {
        const prop = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : undefined;
        let anc = node.parent;
        let decl;
        while (anc) {
          if (ts.isVariableDeclaration(anc) && ts.isIdentifier(anc.name)) { decl = anc.name.text; break; }
          anc = anc.parent;
        }
        const entry = SPEC_EXAMPLE_SLOTS.find(
          (s) => s.declaration === decl && s.properties.includes(prop),
        );
        const slot = `${decl ?? '(anonymous)'}.${prop ?? '(computed)'}`;
        if (entry) {
          matched.add(entry.id);
          for (const t of tags) {
            const line = ts.getLineAndCharacterOfPosition(sf, t.getStart(sf)).line + 1;
            const raw = typeof t.comment === 'string'
              ? t.comment
              : (t.comment ?? []).map((c) => c.text ?? '').join('');
            const source = inlineExampleSource(raw);
            if (source === undefined) {
              loud.push(
                `${rel}:${line} [${slot}] — a registered ${entry.dialect} slot whose @example does not ` +
                  `open with a quoted expression, so nothing was judged: ${JSON.stringify(raw.slice(0, 80))}`,
              );
              continue;
            }
            sites.push({
              where: `${rel}:${line}`, file: rel, rule: entry.id, slot,
              dialect: entry.dialect, source, judge: entry.judge,
            });
          }
        } else if (node.initializer && EXPRESSION_SLOT_TYPES.test(node.initializer.getText(sf))) {
          const line = ts.getLineAndCharacterOfPosition(sf, tags[0].getStart(sf)).line + 1;
          loud.push(
            `${rel}:${line} [${slot}] — an expression-typed slot carrying ${tags.length} @example(s) ` +
              `that no entry in SPEC_EXAMPLE_SLOTS claims. Its SCOPE is not knowable from its schema ` +
              `type (an ExpressionInputSchema slot may bind the record, a page, or a flow), so this ` +
              `gate refuses to guess it. Add a registry entry naming the dialect, or an exemption.`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, loud, matched };
}

/**
 * Reconcile judged sites against the exemption list — the whole exemption
 * contract, as a pure function so the self-test can drive all three directions
 * (covered, stale, unnecessary) without a corpus that happens to contain them.
 *
 * `judged` is `[{ where, file, slot, dialect, source, messages }]`.
 */
export function applyExemptions(judged, exemptions) {
  const violations = [];
  const used = new Set();
  const unnecessary = [];
  let cleared = 0;

  for (const site of judged) {
    const i = exemptions.findIndex(
      (e) => e.file === site.file && e.slot === site.slot && e.source === site.source,
    );
    if (i !== -1) {
      used.add(i);
      // Self-invalidating the other way: an exemption over a site that now judges
      // clean is dead weight pretending to be diligence.
      if (site.messages.length === 0) unnecessary.push({ index: i, where: site.where });
      continue;
    }
    cleared++;
    for (const message of site.messages) {
      violations.push({ where: site.where, via: `${site.slot} — ${site.dialect}`, source: site.source, message });
    }
  }

  const stale = exemptions
    .map((e, i) => ({ e, i }))
    .filter(({ i }) => !used.has(i))
    .map(({ e }) => `${e.file} [${e.slot}] ${JSON.stringify(e.source)}`);

  return { violations, stale, unnecessary, cleared };
}

/**
 * Judge every spec TSDoc site, applying the exemption list.
 *
 * Returns the violations, the loud-but-unjudged sites, the per-rule site counts
 * (so a bare zero can never pass for a clean corpus), and the exemption
 * bookkeeping the caller turns into stale/unnecessary errors.
 */
function scanSpecTsdoc(files) {
  const loud = [];
  const counts = new Map();
  const matchedRules = new Set();
  const judged = [];

  for (const file of files) {
    const rel = posix(relative(REPO_ROOT, file));
    const text = readFileSync(file, 'utf8');
    const a = specFencedFormulaSites(rel, text);
    const b = specSlotSites(rel, text);
    loud.push(...a.loud, ...b.loud);
    for (const id of b.matched) matchedRules.add(id);

    for (const site of [...a.sites, ...b.sites]) {
      counts.set(site.rule, (counts.get(site.rule) ?? 0) + 1);
      judged.push({ ...site, messages: site.judge(site.source) });
    }
  }

  const { violations, stale, unnecessary, cleared } = applyExemptions(judged, EXEMPT_EXAMPLES);
  const blindRules = SPEC_EXAMPLE_SLOTS.filter((s) => !matchedRules.has(s.id)).map((s) => s.id);

  return {
    violations, loud, counts, judged: cleared, blindRules,
    staleExemptions: stale, exemptionsUnnecessary: unnecessary,
  };
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

/**
 * Surface 2's own both-directions test (#6763).
 *
 * `code` is a spec-source FRAGMENT, not an expression: the whole point of this
 * surface is that the docblock, the slot it hangs on and the enclosing schema
 * are all part of the admission decision, so a fixture that skipped straight to
 * the string would test nothing that broke.
 *
 * The RED fixtures are the verbatim defects — #6641's `check` example as it
 * shipped, and the `HookSchema.condition` example this gate's own stock pass
 * found. This test therefore fails if the gate ever stops catching either.
 */
const SPEC_SELF_TEST_CASES = [
  {
    name: 'RED — #6641 verbatim: the RLS `check` example that compiles to a deny-everything policy',
    code: 'const RowLevelSecurityPolicySchema = strictObject({\n'
      + "  /** @example \"status IN ('draft', 'pending')\" - Only allow certain statuses */\n"
      + '  check: z.string().optional(),\n});',
    expect: { sites: 1, errors: 1, match: /does not compile/ },
  },
  {
    name: 'GREEN — the shipped fix (#6729): the same idiom as a CEL bracket list',
    code: 'const RowLevelSecurityPolicySchema = strictObject({\n'
      + "  /** @example \"status in ['draft', 'pending']\" - Only allow certain statuses */\n"
      + '  check: z.string().optional(),\n});',
    expect: { sites: 1, errors: 0 },
  },
  {
    name: 'GREEN — the `using` examples the SQL bridge still carries, caption and all',
    code: 'const RowLevelSecurityPolicySchema = strictObject({\n'
      + '  /**\n   * @example "organization_id = current_user.organization_id"\n'
      + '   * @example "assigned_to_id IN (current_user.team_member_ids)" // §7.3.1 pre-resolved\n'
      + '   * @example "1 = 1" // privileged-position allow-all\n   */\n'
      + '  using: z.string().optional(),\n});',
    expect: { sites: 3, errors: 0 },
  },
  {
    name: 'RED — the record-scoped hook `condition` example is SQL where the slot is CEL (#6763 stock pass)',
    code: 'const HookSchema = strictObject({\n'
      + '  /** @example "status = \'active\' AND amount > 1000" */\n'
      + '  condition: ExpressionInputSchema.optional(),\n});',
    expect: { sites: 1, errors: 1, match: /invalid CEL/ },
  },
  {
    name: 'NOT ADMITTED — a neighbouring slot\'s JSON @example is not an expression',
    code: 'const RowLevelSecurityPolicySchema = strictObject({\n'
      + '  /** @example ["sales_rep", "account_manager"]\n   * @example ["employee"] - Apply to all employees */\n'
      + '  positions: z.array(z.string()).optional(),\n});',
    expect: { sites: 0, loud: 0 },
  },
  {
    name: 'LOUD — an expression-typed slot nobody registered is reported, never guessed at',
    code: 'const PageComponentSchema = strictObject({\n'
      + '  /** @example "page.selectedProjectId != \'\'" */\n'
      + '  visibleWhen: ExpressionInputSchema.optional(),\n});',
    expect: { sites: 0, loud: 1, loudMatch: /no entry in SPEC_EXAMPLE_SLOTS claims/ },
  },
  {
    name: 'LOUD — a registered slot whose @example is prose carries no judged expression',
    code: 'const HookSchema = strictObject({\n'
      + '  /** @example see the cookbook for a worked predicate */\n'
      + '  condition: ExpressionInputSchema.optional(),\n});',
    expect: { sites: 0, loud: 1, loudMatch: /does not open with a quoted expression/ },
  },
  {
    name: 'PASS A — a fenced formula example inside spec TSDoc is judged by the existing rule',
    code: '/**\n * @example\n * ```ts\n'
      + " * total: Field.formula({ expression: 'quantity * price' }),\n"
      + ' * ```\n */\nexport const X = 1;',
    expect: { sites: 1, errors: 1, match: /bare reference `quantity`/ },
  },
  {
    name: 'PASS A — the canonical spelling in a fenced spec example is clean',
    code: '/**\n * @example\n * ```ts\n'
      + " * total: Field.formula({ expression: 'record.quantity * record.price' }),\n"
      + ' * ```\n */\nexport const X = 1;',
    expect: { sites: 1, errors: 0 },
  },
];

/** The exemption contract's three directions, executed rather than described. */
const EXEMPTION_SELF_TEST_CASES = [
  {
    name: 'EXEMPTION — a red site with a matching entry is cleared, and nothing is stale',
    judged: [{ where: 'f.ts:1', file: 'f.ts', slot: 'S.c', dialect: 'd', source: 'bad', messages: ['boom'] }],
    exemptions: [{ file: 'f.ts', slot: 'S.c', source: 'bad', reason: 'deliberately partial' }],
    expect: { violations: 0, stale: 0, unnecessary: 0 },
  },
  {
    name: 'EXEMPTION — an entry that matches no site is STALE, not a silent pass',
    judged: [],
    exemptions: [{ file: 'gone.ts', slot: 'S.c', source: 'bad', reason: 'r' }],
    expect: { violations: 0, stale: 1, unnecessary: 0 },
  },
  {
    name: 'EXEMPTION — an entry over a site that now judges clean is UNNECESSARY',
    judged: [{ where: 'f.ts:1', file: 'f.ts', slot: 'S.c', dialect: 'd', source: 'ok', messages: [] }],
    exemptions: [{ file: 'f.ts', slot: 'S.c', source: 'ok', reason: 'r' }],
    expect: { violations: 0, stale: 0, unnecessary: 1 },
  },
  {
    name: 'EXEMPTION — the match is exact: a near-miss source does NOT excuse the site',
    judged: [{ where: 'f.ts:1', file: 'f.ts', slot: 'S.c', dialect: 'd', source: 'bad', messages: ['boom'] }],
    exemptions: [{ file: 'f.ts', slot: 'S.c', source: 'bad ', reason: 'r' }],
    expect: { violations: 1, stale: 1, unnecessary: 0 },
  },
];

function specSelfTest() {
  const problemsFor = (c) => {
    const problems = [];
    const a = specFencedFormulaSites('fixture.zod.ts', c.code);
    const b = specSlotSites('fixture.zod.ts', c.code);
    const sites = [...a.sites, ...b.sites];
    const loud = [...a.loud, ...b.loud];
    if (sites.length !== (c.expect.sites ?? 0)) {
      problems.push(`admitted ${sites.length} site(s), expected ${c.expect.sites ?? 0}`);
    }
    if (c.expect.loud !== undefined && loud.length !== c.expect.loud) {
      problems.push(`${loud.length} loud site(s), expected ${c.expect.loud}: ${loud.join(' | ')}`);
    }
    if (c.expect.loudMatch && !loud.some((l) => c.expect.loudMatch.test(l))) {
      problems.push(`no loud site matched ${c.expect.loudMatch}`);
    }
    if (c.expect.errors !== undefined && sites.length > 0) {
      const errs = sites.flatMap((s) => s.judge(s.source));
      if (errs.length !== c.expect.errors) {
        problems.push(`${errs.length} error(s), expected ${c.expect.errors}` +
          (errs.length ? `: ${errs.map((e) => e.split('\n')[0]).join(' | ')}` : ''));
      }
      if (c.expect.match && !errs.some((e) => c.expect.match.test(e))) {
        problems.push(`no error matched ${c.expect.match}`);
      }
    }
    return problems;
  };

  const exemptionProblemsFor = (c) => {
    const problems = [];
    const r = applyExemptions(c.judged, c.exemptions);
    if (r.violations.length !== c.expect.violations) {
      problems.push(`${r.violations.length} violation(s), expected ${c.expect.violations}`);
    }
    if (r.stale.length !== c.expect.stale) problems.push(`${r.stale.length} stale, expected ${c.expect.stale}`);
    if (r.unnecessary.length !== c.expect.unnecessary) {
      problems.push(`${r.unnecessary.length} unnecessary, expected ${c.expect.unnecessary}`);
    }
    return problems;
  };

  let failed = 0;
  for (const c of SPEC_SELF_TEST_CASES) {
    const problems = problemsFor(c);
    if (problems.length) { failed++; console.error(`  ✗ ${c.name}\n      ${problems.join('\n      ')}`); }
    else console.log(`  ✓ ${c.name}`);
  }
  for (const c of EXEMPTION_SELF_TEST_CASES) {
    const problems = exemptionProblemsFor(c);
    if (problems.length) { failed++; console.error(`  ✗ ${c.name}\n      ${problems.join('\n      ')}`); }
    else console.log(`  ✓ ${c.name}`);
  }
  return failed;
}

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
  failed += specSelfTest();
  const total = SELF_TEST_CASES.length + SPEC_SELF_TEST_CASES.length + EXEMPTION_SELF_TEST_CASES.length;
  if (failed > 0) {
    console.error(`\n✗ check:doc-formula-expressions self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`\n✓ check:doc-formula-expressions self-test: ${total} cases passed`);
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

// ── Surface 2 — spec TSDoc `@example` (#6763) ────────────────────────────────

const specFiles = collectSpecFiles();
const spec = scanSpecTsdoc(specFiles);

if (spec.blindRules.length > 0) {
  console.error(
    `✗ check:doc-formula-expressions — ${spec.blindRules.length} SPEC_EXAMPLE_SLOTS entr(y/ies) matched\n` +
      `  NO @example anywhere under ${SPEC_ROOT}: ${spec.blindRules.join(', ')}\n\n` +
      `  A registry entry that matches nothing is a gate that has gone blind while still\n` +
      `  reporting success — the schema was renamed, the slot moved, or the examples were\n` +
      `  deleted. Re-point the entry at where the slot lives now, or remove it deliberately.`,
  );
  process.exit(1);
}

if (spec.staleExemptions.length > 0 || spec.exemptionsUnnecessary.length > 0) {
  console.error(`✗ check:doc-formula-expressions — the EXEMPT_EXAMPLES list no longer describes reality:\n`);
  for (const s of spec.staleExemptions) {
    console.error(`    STALE (matches no example): ${s}`);
  }
  for (const u of spec.exemptionsUnnecessary) {
    console.error(`    UNNECESSARY (the example now judges clean): ${u.where}`);
  }
  console.error(
    `\n  An exemption outlives the thing it excuses only by accident, and a list nobody has to\n` +
      `  maintain is how a gate quietly stops covering its own corpus. Delete the entry — a\n` +
      `  clean example needs no excuse, and a missing one has no site to excuse.`,
  );
  process.exit(1);
}

if (spec.loud.length > 0) {
  console.error(
    `✗ check:doc-formula-expressions — ${spec.loud.length} spec TSDoc @example site(s) look like they\n` +
      `  carry an expression but were NOT judged:\n`,
  );
  for (const l of spec.loud) console.error(`    ${l}`);
  console.error(
    `\n  Same reason as the docs corpus above: a gate that silently drops what it cannot read\n` +
      `  reports success over a surface it never looked at.`,
  );
  process.exit(1);
}

if (spec.violations.length > 0) {
  console.error(
    `✗ check:doc-formula-expressions — ${spec.violations.length} spec TSDoc @example(s) would be\n` +
      `  REJECTED by the runtime that compiles them:\n`,
  );
  for (const v of spec.violations) {
    console.error(`    ${v.where}  [${v.via}]`);
    console.error(`      source: ${JSON.stringify(v.source)}`);
    console.error(`      ${v.message.split('\n').join('\n      ')}\n`);
  }
  console.error(
    `  A schema's own @example is the first-hand transcription source for an author — #6641\n` +
      `  shipped one that compiled to a deny-everything policy and survived until someone read\n` +
      `  it by hand. If a snippet is deliberately partial, add it to EXEMPT_EXAMPLES with the\n` +
      `  reason; do not weaken the rule.`,
  );
  process.exit(1);
}

const specBreakdown = SPEC_EXAMPLE_SLOTS.map((s) => `${s.id}=${spec.counts.get(s.id) ?? 0}`)
  .concat(`record-formula=${spec.counts.get('record-formula') ?? 0}`)
  .join(', ');

console.log(
  `✓ check:doc-formula-expressions: ${checked} record-scoped formula example(s) across ` +
    `${files.length} files / ${blocks} TS blocks judged clean by @objectstack/formula.`,
);
console.log(
  `✓ check:doc-formula-expressions (spec TSDoc, #6763): ${spec.judged} @example(s) judged clean across ` +
    `${specFiles.length} ${SPEC_ROOT} files — ${specBreakdown}; ` +
    `${EXEMPT_EXAMPLES.length} exempt.`,
);
