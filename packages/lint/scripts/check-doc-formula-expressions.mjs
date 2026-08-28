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

import { requireDefaultExport, requireDependency } from '../../../scripts/import-prerequisite.mjs';
// The tree's one comment/literal/code scanner. Surface 2's docblock extractor reads
// its runs from here rather than from a block-comment regex — see {@link docblockSpans}.
import { scanSource } from '../../../scripts/js-comment-mask.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
const {
  validateExpression,
  isSupportedRlsExpression,
  sqlPredicateToCel,
  isPushdownableCel,
} = await requireDependency('@objectstack/formula', () => import('@objectstack/formula'), import.meta.url);
// The field-level `*When` root verdict AND its message, imported from the one
// place that owns them (#11407). Same discipline as `validateExpression` above:
// this gate is the SECOND consumer of that rule, and a second consumer that
// re-derives the rule owns a dialect of it instead. See surface 3 below.
const { fieldRuleRootIssue, FIELD_RULE_BOUND_ROOTS } = await requireDependency('@objectstack/lint', () => import('@objectstack/lint'), import.meta.url);

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

/**
 * ROOTS above, written in the subtree spelling `scripts/pm/dispatch-gates.mjs`
 * compares in. Provenance ONLY: nothing in this gate reads this list, and the
 * scan behaves exactly as it did without it.
 *
 * ## The gap this closes (#9964's declaration pattern, seventh instance)
 *
 * That tool builds every dispatch's gate list by scanning each gate's own
 * source for the path literals it operates on, and "looks like a path" there
 * means "carries a separator" — or names a top-level DOTTED directory, which is
 * the one arm that saved `.claude`. So three of the four ROOTS were bare words
 * that never became a hint, while `SKIP_PATHS` above spells its entries with
 * separators, and those DID.
 *
 * Measured on this tree, the gate's whole extracted hint set was:
 *
 *   .claude                          the one md/mdx root the dotted-dir arm
 *                                    admitted — 20 files
 *   packages/spec/src                SPEC_ROOT, surface 2 — already a path
 *                                    literal, so already visible: 972 files
 *   .claude/worktrees, docs/audits,  the exemptions, i.e. the subtrees it
 *   docs/handoff, docs/plans,        deliberately does NOT read
 *   content/docs/references
 *   @objectstack/formula             the import specifier, inert as a path
 *
 * Of the 1388 files this gate walks, 396 were declared by nothing at all
 * (28.5%) — every file under `docs` (156), `skills` (48) and `content` (192).
 * The three declarations below are what close that.
 *
 * Within the `docs` root the shape was inverted rather than merely absent: a
 * card touching `docs/plans/` DERIVED this gate (via the SKIP_PATHS literal —
 * a subtree the walk returns from immediately), while a card touching
 * `docs/qa/platform-checklist/` derived nothing. The exclusions were the
 * declaration and the population was not.
 *
 * That is worse than declaring nothing, and worse in the direction that hides
 * it: the residue line still PRINTED gate names, so the row read as "declared,
 * just not relevant to you" rather than as a blind spot. A card editing the
 * live docs corpus met this REQUIRED gate (lint.yml, `pnpm --filter
 * @objectstack/lint run check:doc-formula-expressions`) as red CI instead of as
 * a local command.
 *
 * `.claude/**` is redundant with the bare `.claude` the extractor already takes
 * on its dotted-dir arm, and is kept so the declaration is uniform across ROOTS
 * rather than depending on which arm happened to admit which root. SPEC_ROOT
 * needs no entry for the same reason `.claude` did not strictly need one — it
 * already carries a separator — and the self-test pins that it still does, so
 * renaming it to a bare word fails here instead of silently unhinting 972
 * files.
 *
 * ## Why the subtree spelling, and not a wider extractor
 *
 * `hintCovers` refuses a bare single-segment literal (`docs`) as too generic BY
 * DESIGN, and that refusal is measured rather than incidental: teaching the
 * extractor to accept bare top-level directory words was priced at +139084
 * fabricated (gate, file) pairs, because `packages`, `apps` and `examples` are
 * path COMPONENTS in dozens of gates that never read those roots. Nor can a
 * class-level guard author this for us — flagging any gate that names a bare
 * tracked directory none of its hints reach fires on 40 of 123 families, and
 * the majority are right as they stand. The distinction between "population
 * root" and "path component" is in the author's intent, not the source text,
 * which is why the declaration has to be authored, gate by gate.
 *
 * ## Why the ROOT, and not the live subtrees under it (the SKIP_PATHS question)
 *
 * `hintCovers` has no way to SUBTRACT: hints are positive containment, so
 * "`docs/**` except `docs/plans`" is not expressible. The exempt subtrees are
 * therefore claimed by this declaration, and that is a DELIBERATE, bounded
 * residual rather than an oversight — pinned as such in the self-test, so it
 * cannot silently grow past the exemptions it is accounted for.
 *
 * The same limit applies one level down, to the extension filter: `collectFiles`
 * keeps only `.md`/`.mdx` (and `.ts`/`.tsx` under SPEC_ROOT), which a subtree
 * hint cannot express either — so a card touching `content/docs.site.json`
 * derives this gate although the walk skips that file. Both residuals point the
 * same way: the declaration over-claims INSIDE what it walks, never outside,
 * and the negative half of the self-test is what holds that line.
 *
 * The residual is also not new, and this declaration does not widen it by one
 * path: those five subtrees derive this gate TODAY, via the `SKIP_PATHS`
 * literals themselves, which stay hints whatever this list says. Removing that
 * residual would mean unquoting the most safety-critical constant in this file.
 * The declaration subsumes those hints and adds nothing to that side while
 * closing all 396 files of the missing side.
 *
 * What the precedent does draw a line at is claiming a tree the ROOTS do not
 * reach at all, and the self-test in `scripts/pm/dispatch-gates.mjs` pins that
 * negative half against the real extractor — the load-bearing direction for a
 * declaration this broad, since a gate named on EVERY card is the louder
 * version of naming none.
 *
 * ## Provenance, never a lookup key
 *
 * The glob form appearing in ROOTS would send `walk()` at a directory that does
 * not exist — since #4916 a hard refusal rather than a silent skip, but one
 * that fails naming the wrong problem. The self-test pins both halves.
 */
const ROOT_WATCH_HINTS = ['.claude/**', 'docs/**', 'skills/**', 'content/**'];

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
  // Surface 3 (#11407) — same walk, same blocks: a second traversal would read
  // a different population the moment either extractor's roots drift.
  const ruleViolations = [];
  const ruleSkips = [];
  let blocks = 0;
  let checked = 0;
  let ruleChecked = 0;

  for (const file of files) {
    const rel = posix(relative(REPO_ROOT, file));
    for (const b of fencedBlocks(readFileSync(file, 'utf8'))) {
      blocks++;
      const found = extractFormulaExpressions(b.code);
      if (found.length === 0) {
        if (looksLikeFormulaBlock(b.code)) unextractable.push(`${rel}:${b.startLine}`);
      } else {
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

      const sites = extractFieldRuleSites(b.code);
      for (const s of sites.skipped) {
        ruleSkips.push({ where: `${rel}:${b.startLine + s.line}`, slot: s.slot, reason: s.reason });
      }
      for (const a of sites.admitted) {
        const where = `${rel}:${b.startLine + a.line}`;
        if (a.source === undefined) {
          // An interpolated source on an ADMITTED site is loud for surface 1's
          // reason: the layer IS known, so this is a source we should have read
          // and could not — never a silent pass.
          unextractable.push(`${where} (interpolated ${a.slot} on ${a.via} — source not statically knowable)`);
          continue;
        }
        ruleChecked++;
        for (const m of judgeFieldRule(a.slot, a.source)) {
          ruleViolations.push({ where, via: `${a.slot} on ${a.via}`, source: a.source, message: m });
        }
      }
    }
  }
  return { violations, unextractable, blocks, checked, ruleViolations, ruleSkips, ruleChecked };
}

// ── Surface 3: field-level `*When` conditional rules (#11407) ────────────────

/**
 * The three field-level conditional-rule slots this surface judges.
 *
 * ## The hole this closes
 *
 * A visibility predicate is authored as a bare assignment whose value is typed
 * `string`, so an `os:check` block's `tsc --noEmit` type-checks
 * `visibleWhen: "record.status != 'closed' && user.hasRole('admin')"` perfectly.
 * `hasRole` is a CEL function that exists nowhere — not in `CEL_STDLIB_FUNCTIONS`,
 * not in any registry — so at runtime the predicate FAULTS, and a field-level
 * `visibleWhen` fault is fail-OPEN: `resolveFieldRuleState` evaluates visibility
 * with `fallback: true`, so the element the author meant to hide is shown to
 * EVERYONE. A shipped doc taught exactly that (#11034 fixed the instance; this
 * closes the class).
 *
 * ## Why the layer must be decided FIRST, and where most of the difficulty is
 *
 * `visibleWhen` is one key spelling several unrelated contracts, and the binding
 * root genuinely differs by layer. Re-measured on objectui `origin/main`
 * @ `2aff580` (the card's table was taken at `365e334`, a sibling repo on its
 * own cadence — the PR body records what had drifted):
 *
 * | Layer                                   | Binds                                     |
 * |-----------------------------------------|-------------------------------------------|
 * | object field / form section `*When`     | `record` + `previous` (+ `parent`)        |
 * | per-option `visibleWhen`                | `record` + the HOST predicate scope       |
 * | page component / app-nav `visible`      | `current_user`/`user`/`ctx`/`os`/`app`/…  |
 * | flow-screen field `visibleWhen`         | the screen's own field names, FLATTENED   |
 *
 * The last row is not hypothetical and it is in this very corpus:
 * `content/docs/automation/flows.mdx` teaches
 * `visibleWhen: 'createOpportunity == true'` — a BARE reference, which is
 * correct there and which the record-scoped verdict would report as the #1928
 * defect. A gate keyed on the KEY would go red on a correct example. That is the
 * failure this file's own header calls worse than no gate, so:
 *
 * **A site whose layer cannot be determined statically is SKIPPED — and the skip
 * list is PRINTED and COUNTED on every run, never silent.** A gate that silently
 * skips is the same false-green this surface exists to prevent, one level up.
 *
 * ## The discriminator, and why these two arms and no key match
 *
 * Both arms identify the FIELD layer — the only layer whose scope a fragment's
 * enclosing structure pins without further context — and both are schema-backed,
 * not guessed:
 *
 *   C. `Field.<anything>({ … visibleWhen … })` — a field factory call, the same
 *      arm-A shape surface 1 uses. Every `*When` a `Field.*` factory takes is
 *      the field-level conditional-rule slot.
 *   D. the raw spelling: an object literal carrying a `type: '<string>'`
 *      discriminator that sits as a VALUE inside an object-literal `fields:`
 *      MAP — `fields: { due_date: { type: 'date', requiredWhen: … } }`.
 *
 * Arm D's map-vs-array test is the load-bearing half, and it is read off the
 * schemas rather than from taste: `ObjectSchema.fields` is
 * `z.record(name, FieldSchema)` (`object.zod.ts:1892`) — an object map — while
 * every UI/flow layer spells `fields:` as an ARRAY: `FormFieldSchema`
 * (`view.zod.ts:2058`) and `ScreenFieldConfigSchema`
 * (`builtin-node-config.zod.ts:447`) are both `z.array(…)`. So an object-literal
 * `fields:` map can be the object-field layer and nothing else, and a `fields:`
 * array is exactly the case that cannot be told apart — form view, flow screen
 * and action param all wear it.
 *
 * Both arms take the slot as a **DIRECT** property of the field object literal.
 * That is deliberate: a `visibleWhen` nested one level down in an `options:`
 * array is the PER-OPTION layer, which genuinely binds `current_user` and its
 * ADR-0068 aliases (`validate-expressions.ts` judges those two surfaces
 * differently for that exact reason). Admitting it here would false-red legal
 * metadata.
 *
 * ## Why there is no `looksLike…` tripwire on this surface
 *
 * Surface 1 makes a failed extraction a hard ERROR, because a block that says
 * `Field.formula({ expression })` and yields nothing is a parser failure. Here a
 * non-extraction is the EXPECTED outcome for three of the four layers, so the
 * same rule would fail the build on correct docs. The loudness requirement is
 * met by the skip list instead — printed, counted, and pinned by the self-test.
 */
const FIELD_RULE_SLOTS = ['visibleWhen', 'readonlyWhen', 'requiredWhen'];

/** The property key of a property assignment, when it is a plain name. */
function keyText(p) {
  if (!ts.isPropertyAssignment(p)) return undefined;
  return ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : undefined;
}

/**
 * Is `obj` the object literal of a field DEFINITION — i.e. does its enclosing
 * structure identify the field layer? Returns the `via` label, or `undefined`.
 * See the discriminator note above for why exactly these two shapes.
 */
function fieldDefinitionVia(obj) {
  const parent = obj.parent;
  // C — an argument of a `Field.<x>(…)` factory call.
  if (
    parent &&
    ts.isCallExpression(parent) &&
    parent.arguments.includes(obj) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    ts.isIdentifier(parent.expression.expression) &&
    parent.expression.expression.text === 'Field'
  ) {
    return `Field.${parent.expression.name.text}(…)`;
  }
  // D — a value in an object-literal `fields:` MAP, carrying a `type:` string.
  if (parent && ts.isPropertyAssignment(parent) && parent.initializer === obj) {
    const map = parent.parent;
    if (
      map &&
      ts.isObjectLiteralExpression(map) &&
      map.parent &&
      ts.isPropertyAssignment(map.parent) &&
      keyText(map.parent) === 'fields'
    ) {
      const t = propOf(obj, 'type');
      if (t && ts.isStringLiteralLike(t)) {
        return `fields: { ${keyText(parent) ?? '?'}: { type: '${t.text}' } }`;
      }
    }
  }
  return undefined;
}

/**
 * Why a `*When` site was not admitted — named as specifically as the tree
 * allows, because "skipped" with no reason is indistinguishable from a bug in
 * the discriminator.
 */
function fieldRuleSkipReason(prop) {
  for (let n = prop.parent; n; n = n.parent) {
    if (ts.isPropertyAssignment(n)) {
      const k = keyText(n);
      if (k === 'options') {
        return {
          rank: 3,
          text:
            'nested in an `options:` array — a per-option `visibleWhen` binds `record` PLUS the ' +
            'host predicate scope (`current_user` and its ADR-0068 aliases), which the field ' +
            'level does not bind; judging it here would false-red legal metadata',
        };
      }
      if (k === 'fields' && ts.isArrayLiteralExpression(n.initializer)) {
        return {
          rank: 3,
          text:
            'nested in a `fields:` ARRAY — form-view fields, flow-screen fields and action ' +
            'params all spell `fields:` as an array, and a flow screen FLATTENS its own field ' +
            'names to top level (a bare reference is correct there), so the layer is ambiguous',
        };
      }
    }
    // `fields:` at STATEMENT position parses as a LabeledStatement, not a
    // property assignment — the same structure wearing a different node type,
    // and the array/map distinction survives it: `fields: [ … ]` keeps its
    // ArrayLiteralExpression one node down. Read it, so this reading reaches the
    // same rank as the parsed one instead of degrading to the generic reason.
    if (ts.isLabeledStatement(n) && n.label.text === 'fields') {
      const stmt = n.statement;
      if (ts.isExpressionStatement(stmt) && ts.isArrayLiteralExpression(stmt.expression)) {
        return {
          rank: 3,
          text:
            'nested in a `fields:` ARRAY — form-view fields, flow-screen fields and action ' +
            'params all spell `fields:` as an array, and a flow screen FLATTENS its own field ' +
            'names to top level (a bare reference is correct there), so the layer is ambiguous',
        };
      }
      return {
        rank: 2,
        text:
          'under a `fields:` label read at statement position — the enclosing expression did ' +
          'not parse, so nothing here names the layer',
      };
    }
  }
  return {
    rank: 1,
    text:
      'no enclosing structure identifies the layer — the same key is authored on the field, ' +
      'per-option, page-component, app-nav and flow-screen layers, and they do not share a scope',
  };
}

/**
 * `*When:` immediately followed by a quoted or tagged-template VALUE — the text
 * shape of a predicate site. Used ONLY to make a missing parse loud, never to
 * judge one, exactly as {@link looksLikeFormulaBlock} is used on surface 1.
 *
 * The value test is what keeps it honest in both directions. It admits
 * `visibleWhen: "…"`, `requiredWhen: P\`…\``; it does NOT admit
 * `visibleWhen: ExpressionInputSchema.optional()`, which is how
 * `docs/adr/0089-unify-visibility-predicate-naming.md` quotes the SCHEMA rather
 * than authoring a predicate — three text hits that are not sites at all.
 */
const FIELD_RULE_TEXT_RE = /\b(visibleWhen|readonlyWhen|requiredWhen)\s*:\s*(?:[A-Za-z_$][\w$]*\s*)?["'`]/g;

export function textFieldRuleSites(code) {
  const out = [];
  for (const m of code.matchAll(FIELD_RULE_TEXT_RE)) {
    let line = 0;
    for (let i = 0; i < m.index; i++) if (code[i] === '\n') line++;
    out.push({ line, slot: m[1] });
  }
  return out;
}

/**
 * Every `*When` site in one block, split into the ones whose layer the enclosing
 * structure PINS and the ones it does not. One function returns both, so the two
 * lists can never disagree about what was admitted.
 *
 * ## The third population: sites the PARSER never sees (measured, not assumed)
 *
 * A doc fragment is very often a bare `key: value` line, and at statement
 * position TypeScript reads `visibleWhen: "…"` as a LABELLED STATEMENT — there
 * is no property assignment in the tree, so an AST-only walk finds nothing and
 * says nothing. Measured on this corpus: 23 text-level `*When:` occurrences
 * against 17 the AST could see. Of the six-way gap, three were the ADR quoting
 * `field.zod.ts`'s schema (`visibleWhen: ExpressionInputSchema.optional()` — not
 * predicates, correctly not sites) and three were REAL predicate examples in
 * `content/docs/protocol/objectui/layout-dsl.mdx`, invisible to the walk.
 *
 * Three invisible predicate examples is precisely the silent skip this surface
 * exists to prevent, one level up — so the text tripwire reconciles the two
 * counts and any unaccounted text site becomes a LISTED skip. It is ranked
 * LOWEST, so a real parse always outranks it and it can never mask a site the
 * tree actually explains.
 */
export function extractFieldRuleSites(code) {
  // One entry per (line, slot) — one property assignment, however many parse
  // units reach it. `parseUnits` deliberately reads the same fragment twice (a
  // doc fragment at statement position parses as a BLOCK, so the direct parse
  // holds no object literal), and the two readings do not see the same tree.
  // Resolution is by strength, never by arrival order:
  //
  //  - ADMITTED beats SKIPPED. The recovery unit is the one that can see a
  //    `Field.*(…)` call the direct parse read as a labelled statement, so
  //    first-wins would have SKIPPED sites this gate can actually judge —
  //    silently, and in the direction that under-covers.
  //  - among skips, the higher-ranked reason wins, so the skip list names the
  //    most specific enclosing structure any reading could see.
  const best = new Map();
  for (const { sf, lineOffset } of parseUnits(code)) {
    const visit = (n) => {
      if (ts.isPropertyAssignment(n) && FIELD_RULE_SLOTS.includes(keyText(n) ?? '')) {
        const slot = keyText(n);
        const line = ts.getLineAndCharacterOfPosition(sf, n.getStart(sf)).line + lineOffset;
        const owner = n.parent;
        const via = owner && ts.isObjectLiteralExpression(owner) ? fieldDefinitionVia(owner) : undefined;
        const key = `${line} ${slot}`;
        const prev = best.get(key);
        if (via) {
          if (!prev || !prev.via) {
            best.set(key, { line, slot, via, source: staticSource(n.initializer) });
          }
        } else if (!prev) {
          best.set(key, { line, slot, reason: fieldRuleSkipReason(n) });
        } else if (!prev.via) {
          const r = fieldRuleSkipReason(n);
          if (r.rank > prev.reason.rank) best.set(key, { line, slot, reason: r });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // Reconcile against the text shape: anything the parser never surfaced is a
  // skip that gets NAMED, rather than a site nobody ever hears about.
  for (const t of textFieldRuleSites(code)) {
    const key = `${t.line} ${t.slot}`;
    if (best.has(key)) continue;
    best.set(key, {
      line: t.line,
      slot: t.slot,
      reason: {
        rank: 0,
        text:
          'the enclosing expression does not parse — a bare `key: value` line at statement ' +
          'position is a LABELLED STATEMENT, not a property, so the tree carries no enclosing ' +
          'structure at all and there is nothing to read the layer off',
      },
    });
  }

  const byLine = (a, b) => a.line - b.line;
  const all = [...best.values()];
  return {
    admitted: all.filter((e) => e.via).sort(byLine),
    skipped: all
      .filter((e) => !e.via)
      .map((e) => ({ line: e.line, slot: e.slot, reason: e.reason.text }))
      .sort(byLine),
  };
}

/**
 * The verdict for an admitted (field-layer) `*When`, composed of exactly the two
 * imported judgments the metadata walk applies to the same slot — nothing local:
 *
 *  1. `validateExpression('predicate', src, { scope: 'record' })` — syntax, the
 *     unknown-function/overload catch that answers this card's `hasRole` case,
 *     and the #1928 bare-reference rule. No object schema is passed: a doc
 *     fragment declares no object, so only the object-independent half applies
 *     (the same limit surface 1 states).
 *  2. `fieldRuleRootIssue(slot, src)` — the closed-root rule, which is the half
 *     that DEPENDS on the layer: `current_user.profile == 'admin'` is a correct
 *     per-option predicate and an unbound root on the field itself.
 *
 * Both come from the packages that own them, in the order the metadata walk runs
 * them, so a docs example and a real stack get the same verdict in the same
 * words.
 */
export function judgeFieldRule(slot, source) {
  const out = validateExpression('predicate', source, { scope: 'record' }).errors.map((e) => e.message);
  const rootIssue = fieldRuleRootIssue(slot, source);
  if (rootIssue) out.push(rootIssue.message);
  return out;
}

/**
 * The skip report, as a pure function so "it is printed" is pinnable. Returns
 * the empty string only when there is genuinely nothing skipped.
 *
 * ## Why the trailer says what a skip is NOT (#11673)
 *
 * Each entry's reason names the structure the PARSER could not read a layer
 * off. That is the only thing this gate is entitled to say: the layer a
 * fragment DOCUMENTS is not derivable from the tree, and a skip entry that
 * confidently named one would be believed — the precise failure #11407 was
 * built to refuse. So the list quotes its difficulty and concludes nothing.
 *
 * The cost of that silence is measured, not hypothetical. Three independent
 * passes over #11651 (the report, the PM triage, the dispatch) read this list
 * as a WORKLIST and partitioned seven skips 4 re-authorable / 3 permanent;
 * judging the sites first gave 1 / 6. One of the "re-authorable" four was
 * `layout-dsl.mdx:863`, whose predicate is byte-identical to `pages.mdx:165` —
 * a skip the same ruling protected BY NAME as a false red on correct docs. The
 * two instructions contradicted each other and the contradiction was invisible.
 *
 * The failure was a framing error, not an information deficit, and that is why
 * the fix is a trailer sentence rather than per-entry context: #11651's own
 * report QUOTED the layer comments above `:821` and `:824` (`// e.g. on a
 * PageComponent`, `// e.g. on a FormSection / FormField`) and filed both under
 * "re-authorable" anyway. Per-entry context would have reprinted what that
 * author already had in hand and had already published. What was missing was
 * the instruction not to read the list as a worklist.
 */
export function renderFieldRuleSkips(skips) {
  if (skips.length === 0) return '';
  const lines = [
    `  ${skips.length} \`*When\` site(s) SKIPPED — layer not statically determinable, so NOT judged:`,
  ];
  for (const s of skips) lines.push(`    ${s.where}  [${s.slot}]\n      ${s.reason}`);
  lines.push(
    '  Skipping is correct here — the same key is authored on layers that do not share a scope,\n' +
      '  and judging one layer\'s text by another\'s rule produces a red that is WRONG. The list is\n' +
      '  printed so the skips stay visible: a gate that skips in silence is the false-green this\n' +
      '  surface exists to prevent, one level up.',
  );
  lines.push(
    '\n  A skip is NOT a to-do item. Every reason above answers "why could this scan not read a\n' +
      '  layer here?" — it never answers "what layer does this fragment document?". Those are\n' +
      '  different questions, and only the second one decides whether a site could be re-authored,\n' +
      '  so read the layer off the DOCUMENT before re-authoring anything listed here. Triaging this\n' +
      '  list FROM the list has already gone wrong once: three independent passes partitioned it\n' +
      '  4 re-authorable / 3 permanent, where judging the sites first gave 1 / 6 — and one site in\n' +
      '  the "re-authorable" half held a predicate that is correct exactly where it is (#11651,\n' +
      '  #11673).',
  );
  return lines.join('\n');
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
  // Empty: the HookSchema.condition entry (#7175) was deleted once the example
  // was corrected to canonical CEL — leaving it would itself be an error (an
  // exemption over a now-clean example is the "unnecessary" direction above).
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
 * The DOCBLOCK spans in a source, as `[start, end)` offsets — decided by
 * `scripts/js-comment-mask.mjs`, this tree's one answer to "comment, literal, or
 * code".
 *
 * ## Why this is not a regex (#12833)
 *
 * It was one: `/\/\*\*[\s\S]*?\*\//g`, an EXTRACTOR built out of the naive
 * block-comment strip that `js-comment-mask.mjs`'s header exists to retire. A
 * regex cannot see a string literal, so a `/**` sitting inside one opens a
 * PHANTOM docblock that runs to the next real terminator, and `lastIndex` then
 * skips every genuine docblock in between. The failure is silent and it is the
 * bad direction: the gate reads FEWER `@example` bodies than the file holds and
 * reports clean over prose it never looked at.
 *
 * Measured on `packages/spec/src` (1,061 `.ts`/`.tsx`, 13.7 MB) at
 * `28a5c3e002`, which is why this is a fix rather than a tidy-up:
 *
 * - **9 files** where the regex's claimed docblock spans hold characters this
 *   scanner does not call comment at all — 13,139 of them in
 *   `kernel/manifest.test.ts`, where a glob string literal opens the phantom.
 * - **9 files** (an OVERLAPPING BUT DIFFERENT set — 5 in common) where the
 *   docblock COUNT moves.
 * - **5 real docblocks** the regex was swallowing whole and this scan recovers.
 *
 * What did NOT move, stated because a fix nobody can see the effect of invites
 * being undone: the `@example` body set is byte-identical either way, 416
 * bodies, because none of the 5 recovered docblocks carries an `@example` and
 * none of the phantoms fabricated one. So surface 2's "admits 0 sites today" is
 * unchanged — but it is now a reading rather than the output of an extractor
 * that provably could not see its own population. ⛔ Do not read the unchanged
 * count as a reason to go back: the swallowed span is 13 KB wide and the next
 * `@example` written behind one is invisible under the regex and judged here.
 *
 * ## What a "docblock run" is here
 *
 * `scanSource().comment` flags a comment's delimiters as well as its body, so a
 * maximal run of flagged characters is one comment — except in two shapes the
 * split below handles: block comments that ABUT (`/**a*\/\/**b*\/` is one run,
 * two comments), and a run that opens with `//`, which is a line comment and
 * never a docblock. An unterminated `/**` at EOF stays a docblock, matching what
 * the TypeScript parser does with it; dropping it would be the silent direction.
 */
function docblockSpans(text) {
  const { comment } = scanSource(text);
  const spans = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (comment[i] !== 1) { i++; continue; }
    let runEnd = i;
    while (runEnd < n && comment[runEnd] === 1) runEnd++;
    let k = i;
    while (k + 1 < runEnd && text[k] === '/' && text[k + 1] === '*') {
      const term = text.indexOf('*/', k + 2);
      const end = term === -1 || term + 2 > runEnd ? runEnd : term + 2;
      // `/**\/` is an empty block comment, not a docblock — and the regex this
      // replaced did not match it either, so the parity is deliberate.
      if (text.startsWith('/**', k) && end - k > 4) spans.push([k, end]);
      k = end;
    }
    i = runEnd;
  }
  return spans;
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
 * Text walk, but not a text SPLIT: which spans are docblocks comes from
 * {@link docblockSpans} above, i.e. from the shared scanner.
 *
 * The gutter strip is line-for-line, so a body line's index maps straight back to
 * a file line.
 */
export function tsdocExampleBodies(text) {
  const out = [];
  for (const [start, end] of docblockSpans(text)) {
    const commentStartLine = text.slice(0, start).split('\n').length; // 1-based
    const raw = text.slice(start, end).split('\n');
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

/**
 * The `scripts/pm/dispatch-gates.mjs` declaration (#9964's pattern, seventh
 * instance), pinned in both directions.
 *
 * Enforcement cannot hold any of these: the declaration is read by another tool
 * entirely, so a wrong or stale one runs green here forever and pays itself out
 * as a dev dispatched on a docs card with this REQUIRED gate missing from the
 * brief — which is exactly how it stood before this block. Both sides are
 * derived from ROOTS rather than re-spelled, so renaming or widening a root
 * cannot leave the declaration describing the old population.
 */
/**
 * The docblock EXTRACTOR's own both-directions test (#12833).
 *
 * {@link tsdocExampleBodies} used to split docblocks with a lazy block-comment
 * regex, and the fixtures below are the two failure families
 * `scripts/js-comment-mask.mjs`'s header names, reduced from shapes measured
 * live in `packages/spec/src`:
 *
 * - **SWALLOWED** — a `/**` inside a glob string opens a phantom docblock whose
 *   terminator is the NEXT real one, so the inline `@example` behind it lands on
 *   the phantom's LAST line, the `*\/` strip runs instead of the `/**` strip, and
 *   the tag no longer matches. The gate then reports clean over an example it
 *   never read. `kernel/manifest.test.ts` holds a 13,139-character span of this.
 * - **FABRICATED** — the same opener inside a string or template manufactures a
 *   docblock that is not there, handing the gate prose to judge. This is the
 *   over-count measured on `data/hook-body.zod.ts` and `ui/action.zod.ts`.
 *
 * The POSITIVE CONTROL is not decoration: every case above asserts a body count,
 * and four of them assert a SMALLER one than the regex produced. Without a case
 * that must come back non-empty, an extractor that returned nothing at all would
 * pass this block.
 */
const EXTRACTOR_SELF_TEST_CASES = [
  {
    name: 'EXTRACTOR — POSITIVE CONTROL: an ordinary inline @example is extracted, at its own line',
    holds: () => {
      const found = tsdocExampleBodies(
        'const A = 1;\nconst S = strictObject({\n'
        + '  /** @example "status in [\'draft\']" - only drafts */\n  check: z.string(),\n});\n');
      return found.length === 1 && found[0].startLine === 4;
    },
  },
  {
    name: 'EXTRACTOR — SWALLOWED: a glob string opens no docblock, so the @example behind it '
      + 'is READ (the regex this replaced returned nothing here)',
    holds: () => {
      const found = tsdocExampleBodies(
        "const GLOB = 'src/**/*.ts';\nconst S = strictObject({\n"
        + '  /** @example "status in [\'draft\']" - only drafts */\n  check: z.string(),\n});\n');
      return found.length === 1 && found[0].startLine === 4;
    },
  },
  {
    name: 'EXTRACTOR — FABRICATED: an @example quoted inside a string literal is prose, not a site',
    holds: () => tsdocExampleBodies(
      "const DOC = 'spell it /** @example \"a > 1\" */ above the field';\nexport const X = 1;\n",
    ).length === 0,
  },
  {
    name: 'EXTRACTOR — FABRICATED: ...and inside a TEMPLATE literal, where the phantom is not '
      + 'line-bounded, only the real docblock survives',
    holds: () => {
      const found = tsdocExampleBodies(
        'const T = `a /** @example "bogus" */ b`;\n/**\n * @example "record.a > 1"\n */\nconst X = 1;\n');
      return found.length === 1 && found[0].startLine === 4;
    },
  },
  {
    name: 'EXTRACTOR — FABRICATED: the house-style note that spells `/** */` inside a `//` '
      + 'comment is one line comment, not a second docblock',
    holds: () => docblockSpans(
      "// Declared with `//` (never `/** */`) and ABOVE the enum's JSDoc.\n"
      + '/**\n * @example "record.a > 1"\n */\nconst X = 1;\n',
    ).length === 1,
  },
  {
    name: 'EXTRACTOR — two ABUTTING docblocks are two runs, not one (the shared scanner flags '
      + 'them as a single contiguous comment span)',
    holds: () => docblockSpans('/** @example "a > 1" *//** @example "b > 1" */\nconst X = 1;\n').length === 2,
  },
  {
    name: 'EXTRACTOR — an empty block comment is not a docblock (parity with the regex this '
      + 'replaced, which did not match it either)',
    holds: () => docblockSpans('/**/\nconst X = 1;\n').length === 0,
  },
];

const DECLARATION_SELF_TEST_CASES = [
  {
    name: 'DECLARATION — every ROOT the hint extractor cannot see is declared as a subtree '
      + '(a root with no path separator is refused as too generic)',
    holds: () => ROOTS.filter((r) => !r.includes('/')).every((r) => ROOT_WATCH_HINTS.includes(`${r}/**`)),
  },
  {
    name: 'DECLARATION — and it declares no root this gate does not walk (a declaration that '
      + 'can drift from the scan is worse than none — it replaces a silent gate with a lying one)',
    holds: () => ROOT_WATCH_HINTS.every((h) => ROOTS.includes(h.replace(/\/\*+$/, ''))),
  },
  {
    // Provenance, never a lookup key: the glob form appearing in ROOTS would
    // send `walk()` at a directory that does not exist. Since #4916 that is a
    // hard refusal rather than a silent skip, but it fails naming the wrong
    // problem.
    name: 'DECLARATION — the declared glob form is NOT a ROOTS entry',
    holds: () => !ROOT_WATCH_HINTS.some((h) => ROOTS.includes(h)),
  },
  {
    // The residual, pinned rather than hidden. `hintCovers` is positive
    // containment with no way to subtract, so declaring a ROOT necessarily
    // claims the exempt subtrees carved out of it. That is accounted for — but
    // only for the exemptions themselves: every SKIP_PATHS entry must sit UNDER
    // a declared root, so a future exemption somewhere this declaration does not
    // reach fails here instead of quietly widening the over-claim.
    name: 'DECLARATION — every skipped subtree is one this declaration knowingly over-claims, '
      + 'and none is a surprise from outside the declared roots',
    holds: () => [...SKIP_PATHS].every((p) => ROOTS.some((r) => p.startsWith(`${r}/`))),
  },
  {
    // The exemptions must stay a strict SUBSET of the walked roots: an entry
    // that WAS a whole root would mean the gate declares a population it never
    // reads.
    name: 'DECLARATION — no exemption swallows a declared root whole',
    holds: () => ![...SKIP_PATHS].some((p) => ROOTS.includes(p)),
  },
  {
    // Surface 2 is declared by SPEC_ROOT itself, which the extractor takes
    // because it carries a separator — 972 files riding on one property of one
    // string. Renaming it to a bare word (`spec`, say) would unhint all of them
    // exactly the way `docs` was unhinted, and this is the only place that
    // would notice.
    name: 'DECLARATION — SPEC_ROOT still carries a path separator, so surface 2 needs no '
      + 'subtree spelling of its own',
    holds: () => SPEC_ROOT.includes('/'),
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

/**
 * Surface 3's cases (#11407). Both directions, and the pair that matters most is
 * the LAYER pair: the same predicate text must go red where the field level does
 * not bind its root and stay unjudged where another layer does. A gate that can
 * only go red proves nothing about a corpus that is currently clean.
 */
const FIELD_RULE_SELF_TEST_CASES = [
  {
    name: "RED — the card's example: a CEL function that exists nowhere (`hasRole`)",
    code: "status: Field.text({ visibleWhen: \"record.status != 'closed' && user.hasRole('admin')\" }),",
    expect: { admitted: 1, errors: 2, match: /no matching overload for 'dyn\.hasRole\(string\)'/ },
  },
  {
    name: 'RED — a bare reference on the field layer is the #1928 defect',
    code: "x: Field.text({ visibleWhen: 'status == \"closed\"' }),",
    expect: { admitted: 1, errors: 1, match: /bare reference `status`/ },
  },
  {
    name: 'RED — `current_user` is UNBOUND on the field layer (the #6146 fail-open class)',
    code: "x: Field.text({ visibleWhen: \"current_user.profile == 'admin'\" }),",
    expect: { admitted: 1, errors: 1, match: /`current_user` is unbound here/ },
  },
  {
    // Wrapped in the factory the corpus actually uses (`skills/objectstack-upgrade`).
    // A BARE `fields: { … }` line is unreachable by design — see the third
    // population note on `extractFieldRuleSites`: at statement position the whole
    // fragment degrades to nested labelled statements and the parser surfaces no
    // property at all. That case is covered by the text tripwire below, not here.
    name: 'RED — the raw arm-D spelling reaches the same verdict as the factory',
    code: "ObjectSchema.create({ fields: { due_date: { type: 'date', requiredWhen: 'stage == \"closed\"' } } })",
    expect: { admitted: 1, errors: 1, match: /bare reference `stage`/ },
  },
  {
    name: 'GREEN — the canonical record-scoped predicate',
    code: "x: Field.text({ visibleWhen: \"record.status == 'closed'\" }),",
    expect: { admitted: 1, errors: 0 },
  },
  {
    name: 'GREEN — `previous` and `parent` ARE bound at the field level, so neither is a root error',
    code: "x: Field.number({ readonlyWhen: P`parent.status == 'paid' && record.stage != previous.stage` }),",
    expect: { admitted: 1, errors: 0 },
  },
  {
    name: 'GREEN — arm D admits the raw spelling in a `fields:` MAP, and judges it clean',
    code: "ObjectSchema.create({ fields: { due_date: { type: 'date', requiredWhen: 'record.stage == \"closed\"' } } })",
    expect: { admitted: 1, errors: 0 },
  },
  {
    // The layer pair. Same text as the `current_user` case above, one level
    // down: per-option genuinely binds it, so a red here would be WRONG.
    name: 'SKIPPED — the SAME `current_user` text under `options:` is a per-option predicate, '
      + 'which binds it — the layer decides, not the key',
    code: "x: Field.select({ options: [{ value: 'a', visibleWhen: \"current_user.profile == 'admin'\" }] }),",
    expect: { admitted: 0, skipped: 1, skipMatch: /`options:` array/ },
  },
  {
    // Live in the corpus at content/docs/automation/flows.mdx.
    name: 'SKIPPED — a flow-screen field FLATTENS its own names, so the bare ref is correct there',
    code: "config: { fields: [{ name: 'opportunityName', type: 'text', visibleWhen: 'createOpportunity == true' }] },",
    expect: { admitted: 0, skipped: 1, skipMatch: /`fields:` ARRAY/ },
  },
  {
    // Live in the corpus at content/docs/ui/pages.mdx:165 — a page component
    // carrying `type:` but NOT inside a `fields:` map. Admitting it on the
    // `type:` discriminator alone would false-red a correct example.
    name: 'SKIPPED — a page component binds `current_user`; the `type:` key alone must not admit it',
    code: "{ type: 'chart', id: 'c', visibleWhen: \"'sales_manager' in current_user.positions\" }",
    expect: { admitted: 0, skipped: 1 },
  },
  {
    name: 'SKIPPED — a bare field-def fragment with no `fields:` map above it is not pinned to a layer',
    code: "{ name: 'rating', type: 'select', visibleWhen: P`record.status == 'qualified'` }",
    expect: { admitted: 0, skipped: 1 },
  },
  {
    name: 'LOUD — an interpolated source on an ADMITTED site is reported, not silently passed',
    code: 'x: Field.text({ visibleWhen: `record.${key} == 1` }),',
    expect: { admitted: 1, unknowable: true },
  },
  {
    name: 'NOT A SITE — `visible` (the page/nav spelling) is a different key and is not this surface',
    code: "x: Field.text({ visible: \"current_user.profile == 'admin'\" }),",
    expect: { admitted: 0, skipped: 0 },
  },
  {
    // Live in the corpus at content/docs/protocol/objectui/layout-dsl.mdx:820.
    // Before the text tripwire this block yielded ZERO sites and printed nothing
    // — an invisible skip, which is the exact false-green one level up.
    name: 'SKIPPED (text tripwire) — a bare `visibleWhen: "…"` line the PARSER cannot see is '
      + 'still listed, never invisible',
    code: '// e.g. on a PageComponent\nvisibleWhen: "record.account_type == \'premium\'"',
    expect: { admitted: 0, skipped: 1, skipMatch: /LABELLED STATEMENT/ },
  },
  {
    // The other direction: the tripwire must not invent sites out of prose or
    // out of a schema quotation, or the skip list stops being readable.
    name: 'NOT A SITE — the ADR quoting `visibleWhen: ExpressionInputSchema.optional()` is the '
      + 'SCHEMA, not a predicate, and the tripwire must not fabricate a site from it',
    code: 'visibleWhen:  ExpressionInputSchema.optional(),  // shown when TRUE',
    expect: { admitted: 0, skipped: 0 },
  },
];

/**
 * The skip list is part of the deliverable, so two things are pinned rather than
 * assumed: that the renderer produces a report naming every skip, and that the
 * GREEN path still prints it. The second is the one that rots — a summary line
 * carrying only a COUNT reads like coverage while naming nothing, and deleting
 * the print call breaks no other test in this file.
 */
const FIELD_RULE_REPORT_SELF_TEST_CASES = [
  {
    name: 'REPORT — the skip renderer names the count, the site, the slot and the reason',
    holds: () => {
      const out = renderFieldRuleSkips([
        { where: 'content/docs/x.mdx:12', slot: 'visibleWhen', reason: 'because reasons' },
      ]);
      return out.includes('1 `*When` site(s) SKIPPED')
        && out.includes('content/docs/x.mdx:12')
        && out.includes('visibleWhen')
        && out.includes('because reasons');
    },
  },
  {
    name: 'REPORT — an empty skip list renders nothing (no phantom section on a corpus with no skips)',
    holds: () => renderFieldRuleSkips([]) === '',
  },
  {
    // The trailer is the whole of #11673's fix, and it is a string nobody else
    // reads — deleting it breaks no other assertion in this file and no gate
    // anywhere goes red. Pin the two load-bearing halves: that a skip is not a
    // to-do item, and that its layer comes from the document.
    name: 'REPORT — the trailer says a skip is NOT a to-do item and that the layer comes from the document',
    holds: () => {
      const out = renderFieldRuleSkips([
        { where: 'content/docs/x.mdx:12', slot: 'visibleWhen', reason: 'because reasons' },
      ]);
      return out.includes('A skip is NOT a to-do item')
        && /read the layer off the DOCUMENT before re-authoring/.test(out);
    },
  },
  {
    // And that it never becomes a CLAIM. The trailer may describe the list's
    // status; the moment it names a layer for a site it did not derive, it has
    // done the one thing #11407 exists to refuse. This is the guard on the fix
    // itself, not on the gate.
    name: 'REPORT — no rendered skip entry names a layer the gate did not derive',
    holds: () => {
      const out = renderFieldRuleSkips([
        { where: 'content/docs/x.mdx:12', slot: 'visibleWhen', reason: 'because reasons' },
      ]);
      // The reason text and the trailer may DISCUSS layers in the abstract; what
      // must never appear is a verdict sentence binding this site to one.
      return !/\bthis (?:site|fragment|example) (?:is|documents|describes) (?:a|an|the)\b/i.test(out);
    },
  },
  {
    name: 'REPORT — the GREEN summary path still PRINTS the skip list, not merely its count',
    holds: () => {
      const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
      // Everything after the last summary line is the green path; the error path
      // lives above it, so finding the call here cannot be satisfied by the copy
      // inside `if (ruleViolations.length > 0)`.
      const green = self.slice(self.lastIndexOf('const specBreakdown'));
      return green.includes('renderFieldRuleSkips(ruleSkips)') && green.includes('console.log(skipReport)');
    },
  },
];

function fieldRuleSelfTest() {
  let failed = 0;
  for (const c of FIELD_RULE_SELF_TEST_CASES) {
    const { admitted, skipped } = extractFieldRuleSites(c.code);
    const problems = [];
    if (c.expect.admitted !== undefined && admitted.length !== c.expect.admitted) {
      problems.push(`admitted ${admitted.length}, expected ${c.expect.admitted}`);
    }
    if (c.expect.skipped !== undefined && skipped.length !== c.expect.skipped) {
      problems.push(`skipped ${skipped.length}, expected ${c.expect.skipped}`);
    }
    if (c.expect.skipMatch && !skipped.some((s) => c.expect.skipMatch.test(s.reason))) {
      problems.push(`no skip reason matched ${c.expect.skipMatch}: ${skipped.map((s) => s.reason).join(' | ')}`);
    }
    if (c.expect.unknowable) {
      if (admitted[0]?.source !== undefined) problems.push('expected a non-statically-knowable source');
    } else if (admitted.length === 1 && c.expect.errors !== undefined) {
      const errs = admitted[0].source === undefined ? [] : judgeFieldRule(admitted[0].slot, admitted[0].source);
      if (errs.length !== c.expect.errors) {
        problems.push(`${errs.length} error(s), expected ${c.expect.errors}` +
          (errs.length ? `: ${errs.map((e) => e.split('\n')[0]).join(' | ')}` : ''));
      }
      if (c.expect.match && !errs.some((e) => c.expect.match.test(e))) {
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
  for (const c of FIELD_RULE_REPORT_SELF_TEST_CASES) {
    if (c.holds()) console.log(`  ✓ ${c.name}`);
    else { failed++; console.error(`  ✗ ${c.name}`); }
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
  failed += fieldRuleSelfTest();
  for (const c of [...DECLARATION_SELF_TEST_CASES, ...EXTRACTOR_SELF_TEST_CASES]) {
    if (c.holds()) console.log(`  ✓ ${c.name}`);
    else { failed++; console.error(`  ✗ ${c.name}`); }
  }
  const total = SELF_TEST_CASES.length + SPEC_SELF_TEST_CASES.length + EXEMPTION_SELF_TEST_CASES.length
    + DECLARATION_SELF_TEST_CASES.length + EXTRACTOR_SELF_TEST_CASES.length
    + FIELD_RULE_SELF_TEST_CASES.length + FIELD_RULE_REPORT_SELF_TEST_CASES.length;
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
const { violations, unextractable, blocks, checked, ruleViolations, ruleSkips, ruleChecked } = scan(files);

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

if (ruleViolations.length > 0) {
  console.error(
    `✗ check:doc-formula-expressions — ${ruleViolations.length} field-level \`*When\` example(s) in the\n` +
      `  docs/skills corpus would be REJECTED by \`os build\` / \`os validate\` (#11407):\n`,
  );
  for (const v of ruleViolations) {
    console.error(`    ${v.where}  [${v.via}]`);
    console.error(`      source: ${JSON.stringify(v.source)}`);
    console.error(`      ${v.message.split('\n').join('\n      ')}\n`);
  }
  const skipReport = renderFieldRuleSkips(ruleSkips);
  if (skipReport) console.error(`${skipReport}\n`);
  console.error(
    `  A field-level \`visibleWhen\` that faults is fail-OPEN — the renderer falls back to VISIBLE —\n` +
      `  so a wrong example does not merely not work, it shows the thing it was written to hide to\n` +
      `  everyone who copies it. The verdict above is \`@objectstack/formula\`'s \`validateExpression\`\n` +
      `  plus \`@objectstack/lint\`'s \`fieldRuleRootIssue\` — the same two the metadata walk applies to\n` +
      `  this slot, imported rather than restated.`,
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
console.log(
  `✓ check:doc-formula-expressions (field-level \`*When\`, #11407): ${ruleChecked} predicate(s) on a ` +
    `statically determinable field layer judged clean; ${ruleSkips.length} skipped as undeterminable.`,
);
// Printed on the GREEN path too, and unconditionally: the skip list is part of
// the deliverable, not an escape hatch. A run that judged nothing and said so
// only in a count is how a gate comes to cover nothing while still reporting
// success (#11407).
const skipReport = renderFieldRuleSkips(ruleSkips);
if (skipReport) console.log(skipReport);
