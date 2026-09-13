// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17130] No BARE refusal this package raises may be readable as a driver
 * saying "the backing table is gone".
 *
 * ## The fragility this exists to hold down
 *
 * `queryDataset`'s catch asks two questions in order (`analytics-service.ts`):
 * {@link isMissingSourceError} runs only for an error whose producer declared
 * NOTHING, and when it says yes the widget is served
 * `{rows: [], fields: [], totals: []}` — no exception, no 4xx, no 5xx, one
 * `warn`, a confident empty chart. That is #5033's deliberate leniency, and it
 * is correct for a driver reporting an absent table.
 *
 * It is a heuristic over driver PHRASING, and three of its six limbs —
 * `not registered`, `unknown object`, `is not a registered object` — are
 * exactly the phrasings a REGISTRY or SECURITY refusal reaches for. So a bare
 * refusal this package raises on purpose is one wording away from being served
 * to the caller as "no data": a fail-closed gate turned back into a fail-open
 * one by substring match. PR #17125's row-scope refusal propagates today
 * because its text happens to match none of the six — a coincidence, not a
 * construction, and the coincidence is what this file removes.
 *
 * ⛔ The remedy is NOT to subtract this or any other message from the sniffer
 * by hand. #6035 already recorded why that road ends: the missing-COLUMN
 * wording literally CONTAINS a well-formed missing-relation wording, so *"no
 * tightening of 'does this say a relation is missing' can ever exclude it —
 * only asking the more specific question FIRST can. That makes the ORDER the
 * fix, not the pattern."* Subtracting a string fixes one string and leaves the
 * class standing.
 *
 * ## Two defences, and which one this file is
 *
 *   - **The envelope (the primary).** A refusal that declares `code` + `status`
 *     is re-thrown at `hasDeclaredErrorEnvelope` before the sniffer is asked at
 *     all (#5717 defence B), so its wording cannot classify it and its runtime
 *     interpolations cannot either. #17130's other half gives the two
 *     read-scope refusals that envelope.
 *   - **This guard (the second line).** A refusal that is deliberately bare —
 *     an internal invariant, the families `dataset-refusal.ts`'s header lists
 *     as staying bare on purpose — still reaches the sniffer, so its AUTHORED
 *     wording must not collide with it. That is the property asserted here, and
 *     it keeps being asserted for refusals written after today.
 *
 * The split is why an enveloped refusal is deliberately NOT held to the wording
 * rule: forcing one to be reworded would buy no safety (nothing reads its
 * words) and would push authors toward picking luckier strings — the exact move
 * #17130 forbids.
 *
 * ## Where the population comes from — ⛔ never a hand-written list
 *
 * A guard whose corpus is typed out rots the same way the sniffer did: it
 * describes the refusals someone remembered. So both halves are derived from
 * the source, at run time:
 *
 *   - **the sites** — every `throw` statement in every non-test `.ts` file
 *     under this package's `src/`, found by walking the TypeScript AST
 *     (`typescript` is already this package's devDependency). Adding a file, or
 *     a `throw` in one, enlarges the corpus with no edit here.
 *   - **the words** — every string / template literal reachable from that
 *     throw's expression, followed THROUGH calls to functions declared in this
 *     package. That transitive step is what reaches the message of
 *     `readAdmissionDeniedError(objectName)` or `undefinedComparandError(field,
 *     path)`, whose throw sites carry no literal of their own.
 *   - **the verdict** — {@link isMissingSourceError} itself, imported from
 *     `analytics-service.ts`. ⛔ Not a copy of its six limbs: a copy answers a
 *     question about the copy and stays green when a seventh limb lands.
 *   - **enveloped vs bare** — also derived. A throw is ENVELOPED when its
 *     expression calls an in-package function that assigns both `.code` and
 *     `.status` (directly, or through another function that does).
 *
 * ## What it cannot see, stated rather than implied
 *
 * A template literal's INTERPOLATED value is a runtime string; `${object}` is
 * replaced by a placeholder here. So this guard covers authored wording only —
 * which is exactly why it is the second line and the envelope is the first. A
 * refusal whose text is assembled from an upstream message at run time is made
 * safe by declaring `code` + `status`, never by this scan.
 *
 * ## Positive control (⛔ a probe that can only answer zero is NOT MEASURED)
 *
 * `the scan can see a colliding refusal` runs the whole pipeline over a
 * synthetic source file carrying one bare colliding `throw` and asserts it is
 * found — so a green verdict from the real corpus means "looked and found
 * none", never "looked at nothing". The census case pins that both classes are
 * non-empty, for the same reason.
 *
 * MEASURED live as well, on the real tree, before this file was finished: a
 * bare `throw new Error('[Analytics] object "x" is not registered on this
 * datasource.')` inserted into `plugin.ts` turned the collision case RED and
 * named that site; removing it turned it green. The PR body carries both runs.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { isMissingSourceError } from '../analytics-service.js';

/** This package's `src/` — the scan root. Stays inside the package. */
const SRC_ROOT = resolve(import.meta.dirname, '..');

/** A `throw` site, with the wording it can put in front of the sniffer. */
interface ThrowSite {
  /** `src/`-relative path, e.g. `plugin.ts` or `strategies/filter-normalizer.ts`. */
  file: string;
  line: number;
  /** The throw expression's first line, for a failure a reader can act on. */
  source: string;
  /** Does its producer declare `code` + `status`? */
  enveloped: boolean;
  /** Authored message texts, interpolations replaced by a placeholder. */
  texts: string[];
}

/** What an interpolation becomes — a token no limb of the sniffer can match. */
const INTERPOLATION = '{value}';

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      collectSourceFiles(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/**
 * Every function in the package, indexed by the name it is CALLED by. Two files
 * may declare the same name (`undefinedComparandError` exists in both
 * `read-scope-sql.ts` and `filter-normalizer.ts`); both are kept, and a call
 * resolves to all of them. Over-resolution only widens the corpus, which is the
 * safe direction for a guard.
 */
function indexFunctions(files: readonly ts.SourceFile[]): Map<string, FunctionLike[]> {
  const index = new Map<string, FunctionLike[]>();
  const add = (name: string, fn: FunctionLike) => {
    const bucket = index.get(name);
    if (bucket) bucket.push(fn);
    else index.set(name, [fn]);
  };
  for (const sf of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node);
      else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) add(node.name.text, node);
      else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isFunctionLike(node.initializer)
      ) {
        add(node.name.text, node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return index;
}

/** Does this function body assign BOTH `.code` and `.status` on something? */
function assignsEnvelopeFields(fn: FunctionLike): boolean {
  let code = false;
  let status = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      if (node.left.name.text === 'code') code = true;
      if (node.left.name.text === 'status') status = true;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return code && status;
}

/**
 * Which in-package functions produce an ADR-0112 envelope — a fixpoint, so a
 * constructor that delegates to another constructor counts as one too.
 */
function resolveEnvelopingNames(index: Map<string, FunctionLike[]>): Set<string> {
  const enveloping = new Set<string>();
  for (const [name, fns] of index) {
    if (fns.some(assignsEnvelopeFields)) enveloping.add(name);
  }
  for (let pass = 0; pass < 8; pass += 1) {
    const before = enveloping.size;
    for (const [name, fns] of index) {
      if (enveloping.has(name)) continue;
      const delegates = fns.some((fn) => {
        let hit = false;
        const visit = (node: ts.Node): void => {
          if (hit) return;
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && enveloping.has(node.expression.text)) {
            hit = true;
            return;
          }
          ts.forEachChild(node, visit);
        };
        if (fn.body) visit(fn.body);
        return hit;
      });
      if (delegates) enveloping.add(name);
    }
    if (enveloping.size === before) break;
  }
  return enveloping;
}

/** The authored text of one literal node, interpolations neutralised. */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += INTERPOLATION + span.literal.text;
    return text;
  }
  return undefined;
}

/**
 * Every authored literal reachable from `root`, following calls to functions
 * this package declares (bounded by a visited set, so mutual recursion between
 * two constructors terminates).
 */
function reachableTexts(
  root: ts.Node,
  index: Map<string, FunctionLike[]>,
  seen: Set<ts.Node> = new Set(),
): string[] {
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== undefined) {
      texts.push(text);
      // A template's spans hold expressions that may call a message helper.
      if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) {
      for (const fn of index.get(node.expression.text) ?? []) {
        if (seen.has(fn)) continue;
        seen.add(fn);
        if (fn.body) texts.push(...reachableTexts(fn.body, index, seen));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return texts;
}

/** Is this throw's producer one of the enveloping constructors? */
function throwIsEnveloped(expression: ts.Node, enveloping: ReadonlySet<string>): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && enveloping.has(node.expression.text)) {
      hit = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return hit;
}

/** The whole pipeline, over an arbitrary set of parsed sources. */
function scanThrowSites(sources: readonly ts.SourceFile[]): ThrowSite[] {
  const index = indexFunctions(sources);
  const enveloping = resolveEnvelopingNames(index);
  const sites: ThrowSite[] = [];
  for (const sf of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isThrowStatement(node) && node.expression) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        sites.push({
          file: relative(SRC_ROOT, sf.fileName).split(sep).join('/'),
          line: line + 1,
          source: node.expression.getText(sf).split('\n')[0].trim().slice(0, 120),
          enveloped: throwIsEnveloped(node.expression, enveloping),
          texts: reachableTexts(node.expression, index),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

const REAL_SOURCES = collectSourceFiles(SRC_ROOT).sort().map((f) => parse(f, readFileSync(f, 'utf8')));
const REAL_SITES = scanThrowSites(REAL_SOURCES);

/** Every colliding (site, text) pair in a scan — the failure report itself. */
function collisions(sites: readonly ThrowSite[]): string[] {
  const found: string[] = [];
  for (const site of sites) {
    if (site.enveloped) continue;
    for (const text of site.texts) {
      if (isMissingSourceError({ message: text })) {
        found.push(`${site.file}:${site.line} — ${JSON.stringify(text)} · ${site.source}`);
      }
    }
  }
  return found;
}

describe('[#17130] the refusals this package raises cannot be mistaken for a missing source table', () => {
  it('the corpus is derived from source, and both classes are populated', () => {
    // ⛔ The census, not decoration. A scan that silently found nothing — a
    // renamed directory, a walk that stopped at the first subfolder — would
    // pass the collision case below by finding no refusals at all. These
    // floors are deliberately far under today's counts so ordinary authoring
    // never touches them; only a broken scan can.
    expect(REAL_SOURCES.length).toBeGreaterThan(10);
    expect(REAL_SITES.length).toBeGreaterThan(40);
    expect(REAL_SITES.filter((s) => s.texts.length > 0).length).toBeGreaterThan(40);
    // Both verdicts must be reachable: an all-bare classification would make
    // the exemption meaningless, an all-enveloped one would empty the corpus
    // the collision case reads.
    expect(REAL_SITES.some((s) => s.enveloped)).toBe(true);
    expect(REAL_SITES.some((s) => !s.enveloped && s.texts.length > 0)).toBe(true);
    // The transitive step earns its keep: these two throw sites carry no
    // literal of their own, and their wording lives one call away.
    const helperOnly = REAL_SITES.filter((s) => /readAdmissionDeniedError|undefinedComparandError/.test(s.source));
    expect(helperOnly.length).toBeGreaterThan(0);
    for (const site of helperOnly) {
      expect(site.texts.length, `${site.file}:${site.line} resolved no wording`).toBeGreaterThan(0);
    }
  });

  it('the scan can see a colliding refusal — the positive control', () => {
    // The same pipeline over a synthetic file. Two throws: one bare and
    // colliding (must be reported), one enveloped through a local constructor
    // and equally colliding (must NOT be — the envelope answers first).
    const control = parse(
      join(SRC_ROOT, '__control__.ts'),
      [
        'function envelopedRefusal(message: string): Error {',
        '  const err = new Error(message) as Error & { code?: string; status?: number };',
        "  err.code = 'READ_SCOPE_COMPILE_FAILED';",
        '  err.status = 500;',
        '  return err;',
        '}',
        'export function bare(object: string): never {',
        '  throw new Error(`[Analytics] object "${object}" is not registered on this datasource.`);',
        '}',
        'export function declared(object: string): never {',
        '  throw envelopedRefusal(`[Analytics] object "${object}" is not registered on this datasource.`);',
        '}',
      ].join('\n'),
    );
    const found = collisions(scanThrowSites([control]));
    expect(found.length, 'the scan is blind to a colliding bare refusal').toBe(1);
    expect(found[0]).toMatch(/__control__\.ts:8/);
    expect(found[0]).toMatch(/is not registered/);
  });

  it('the verdict is the real predicate, not a copy of its limbs', () => {
    // If this ever goes red, `isMissingSourceError` moved and the import above
    // is answering a different question than `queryDataset` asks.
    expect(isMissingSourceError({ message: 'no such table: opportunity' })).toBe(true);
    expect(isMissingSourceError({ message: 'object "crm_account" is not registered' })).toBe(true);
    expect(isMissingSourceError({ message: 'unknown object: crm_account' })).toBe(true);
    expect(isMissingSourceError({ message: '"crm_account" is not a registered object' })).toBe(true);
    expect(isMissingSourceError({ message: `[Analytics] refused for "${'x'}" (fail-closed).` })).toBe(false);
  });

  it('⛔ no bare refusal in this package matches isMissingSourceError', () => {
    // The property. A red here is NOT a licence to subtract the message from
    // the sniffer, nor to hunt for a luckier phrasing: give the refusal a
    // declared `code` + `status` (see `dataset-refusal.ts` and
    // `read-scope-refusal.ts`) so the door classifies it by declaration, or —
    // when it is genuinely a driver reporting an absent table — leave it bare
    // and let it degrade on purpose.
    expect(collisions(REAL_SITES)).toEqual([]);
  });
});
