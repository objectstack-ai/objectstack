// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared pieces of the #4001 strictness-ledger gate
 * (`../check-strictness-ledger.mts`), extracted so the gate and its regression
 * test cannot drift apart on the properties that have already broken silently:
 * whether the coverage walk descends into subdirectories, and whether the site
 * counter recognises the way schemas are actually written.
 */

import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/**
 * How an object site treats keys it does not declare.
 *
 * `strip` is zod's default and the thing #4001 exists to remove from authorable
 * surface: the key is discarded and the parse still succeeds.
 */
export type Posture = 'strict' | 'passthrough' | 'catchall' | 'strip';

/** One object site, located and classified. */
export interface Site {
  /** Path relative to the walked root, `/`-separated (`driver/postgres.zod.ts`). */
  file: string;
  line: number;
  /** Best-effort dotted name: enclosing `const`, plus object-literal property path. */
  name: string;
  posture: Posture;
  /** `z.object` | `strictObject` | `z.strictObject` | `z.looseObject`. */
  idiom: string;
}

/**
 * Which object-constructing call this is, or `null` if it is not one.
 *
 * `strictObject(` is the campaign's helper; the rest are zod's own. Adding a
 * spelling here is the ONLY place the instrument learns an idiom — see the note
 * on {@link analyzeSites} for why that used to be three places.
 */
function idiomOf(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e) && e.text === 'strictObject') return 'strictObject';
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'z') {
    if (e.name.text === 'object') return 'z.object';
    if (e.name.text === 'strictObject') return 'z.strictObject';
    if (e.name.text === 'looseObject') return 'z.looseObject';
  }
  return null;
}

/**
 * Posture from the method chain applied to the site (`.strict()`, `.passthrough()`, …).
 *
 * ## The idiom decides the START of the walk, never its end (#5072)
 *
 * This used to `return 'strict'` on the first line for `strictObject(` /
 * `z.strictObject(` — the campaign's own helper — and `return 'passthrough'` for
 * `z.looseObject(`, without looking at what was chained onto them. Only
 * `z.object(` ever walked the chain. So `strictObject(…).passthrough()` — a shape
 * that is **open at runtime**, deliberately — was recorded as `strict`.
 *
 * Two sites in the repo, both in `ui/view.zod.ts` (`GanttConfigSchema`,
 * `TreeConfigSchema`), both open on purpose so renderer-ahead config knobs reach
 * `plugin-gantt` / `plugin-tree` without waiting on a spec release. Measured, not
 * inferred: `GanttConfigSchema.parse({ …required, lockField: 'x' })` returns
 * `lockField` untouched.
 *
 * Two things made it worth fixing rather than rounding away. It **inflated the
 * strict count**, which is the number the campaign schedules against; and, the
 * worse half, it drew an OPEN shape on the map as a CLOSED one — the exact
 * question this instrument exists to answer, answered backwards. Same shape as
 * the #4852 defect (a counter returning a wrong reading that the walk then
 * correctly honoured), one field over: there the blind spot was in `count`, here
 * in `posture`. #4852 rebuilt `idiomOf`/`nameOf` on the AST and left this one
 * short-circuit behind.
 *
 * So the idiom now seeds the initial posture and the chain is ALWAYS walked, with
 * the last explicit call winning. `strictObject({}).passthrough()` reads
 * `passthrough`; a bare `strictObject({})` still reads `strict`.
 */
function postureOf(call: ts.CallExpression, idiom: string): Posture {
  let node: ts.Node = call;
  let posture: Posture =
    idiom === 'strictObject' || idiom === 'z.strictObject'
      ? 'strict'
      : idiom === 'z.looseObject'
        ? 'passthrough'
        : 'strip';
  for (;;) {
    const parent: ts.Node | undefined = node.parent;
    if (!parent) return posture;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const m = parent.name.text;
      if (m === 'strict') posture = 'strict';
      else if (m === 'passthrough' || m === 'loose') posture = 'passthrough';
      else if (m === 'strip') posture = 'strip';
      else if (m === 'catchall') posture = 'catchall';
      node = parent;
    } else if (ts.isCallExpression(parent) && parent.expression === node) {
      node = parent;
    } else {
      return posture;
    }
  }
}

/** Enclosing `const X` plus any object-literal property path down to the site. */
function nameOf(call: ts.CallExpression): string {
  const segs: string[] = [];
  let node: ts.Node = call;
  let root = '';
  while (node.parent) {
    const p = node.parent;
    if (ts.isPropertyAssignment(p) && p.initializer === node) {
      const n = p.name;
      segs.unshift(ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : '?');
    } else if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
      root = p.name.text;
      break;
    } else if (ts.isFunctionDeclaration(p) && p.name) {
      root = `${p.name.text}()`;
      break;
    }
    node = p;
  }
  if (!root) root = '(anonymous)';
  return segs.length ? `${root}.${segs.join('.')}` : root;
}

/**
 * Every object site in `file`, with its posture — read from the AST.
 *
 * ## Why this is not a regex any more
 *
 * The ledger's stated method was "`z.object(` or `strictObject(` occurrences per
 * file", matched textually. That method was wrong in BOTH directions at once,
 * and the #4001 re-measurement found seven files where it disagreed with the
 * source:
 *
 * - **It counted prose.** A `z.object({ … })` inside a JSDoc example is not a
 *   site. `ui/action.zod.ts` declared 9 and has 8; `kernel/metadata-protection`
 *   and `shared/suggestions` were entirely comment.
 * - **It missed the wrapped call.** Prettier breaks a long chain as `z\n
 *   .object({`, which `z\.object\(` cannot match. That hid a site in
 *   `ui/chart.zod.ts`, two in `kernel/manifest.zod.ts`, and — worst —
 *   `automation/time-relative-trigger.zod.ts` read as ZERO sites, which made the
 *   coverage walk SKIP the file as "nothing to classify". An undeclared
 *   authorable schema in `automation/`, invisible behind a zero.
 * - **It did not know `z.looseObject(`.** `data/field-value.zod.ts` has two
 *   sites and declared one.
 *
 * On `ui/` the two errors cancelled: `action` over by one, `chart` under by one,
 * section total exactly right. A green section header over two wrong rows is the
 * campaign's own subject matter reproduced in its own instrument — the fourth
 * time a measuring tool here reported coverage it did not have (the ledger's
 * findings 9 and its non-recursive walk being the earlier ones).
 *
 * The AST cannot be fooled by formatting or comments, and — the point — it stops
 * the instrument needing to learn each new spelling separately. Posture comes
 * from the same walk, which is what makes a per-file strict/strip split
 * measurable at all; the old method could only ask "does this FILE contain any
 * `.strict()`", never "how many of its sites are still open".
 */
export function analyzeSites(file: string, rel = path.basename(file)): Site[] {
  const src = fs.readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const idiom = idiomOf(node);
      if (idiom) {
        out.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          name: nameOf(node),
          posture: postureOf(node, idiom),
          idiom,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.sort((a, b) => a.line - b.line);
}

/** Object sites in `file` — the ledger's per-file count. */
export function countSites(file: string): number {
  return analyzeSites(file).length;
}

/** Object sites in `file` that still silently discard unknown keys. */
export function countStripSites(file: string): number {
  return analyzeSites(file).filter((s) => s.posture === 'strip').length;
}

/**
 * Every `*.zod.ts` under `dir`, **recursively**, as `/`-separated paths relative
 * to `dir` (so a nested file reads `driver/postgres.zod.ts` — exactly how the
 * ledger declares it).
 *
 * The recursion is the whole point of this function existing. The gate's first
 * version listed each triaged directory one level deep, which made
 * `data/driver/` — three per-driver connection-config files, nine authorable
 * sites — invisible to the check whose entire promise is "no undeclared
 * surface". It printed "no undeclared schema files" and was believed.
 *
 * A gate that under-reports is worse than no gate: it converts "I should
 * classify this" into "it is already classified". Keep the walk recursive, and
 * see `strictness-ledger.test.ts`, which fails if it stops being.
 */
export function listSchemaFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((f) => String(f).split(path.sep).join('/'))
    .filter((f) => f.endsWith('.zod.ts'))
    .sort();
}

/** Every site under `dir`, recursively, with `file` relative to `dir`. */
export function analyzeTree(dir: string): Site[] {
  return listSchemaFiles(dir).flatMap((rel) => analyzeSites(path.join(dir, rel), rel));
}
