// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A registration's `defaultProps` entry must not disagree with the fallback the
 * same file's renderer applies (objectui#8229, folded into objectui#7735's
 * ruling — director seat, decision batch #69, 2026-09-07).
 *
 * `flex.tsx` declared two different defaults for `align` fifteen lines apart:
 *
 *   flex.tsx:18    const align = schema.align || 'start';   // renderer fallback
 *   flex.tsx:132     align: 'center',                       // registration seed
 *
 * so a `flex` node the designer created was written out carrying
 * `align: 'center'`, while a hand-authored `flex` that simply omitted the key
 * rendered `start`. One component type, one key, two answers — and no gate saw
 * it, because nothing had ever compared the two faces.
 *
 * objectui#7735 ruled which face wins: the **renderer's fallback is the single
 * authoritative default**. The JSDoc `@default` describes it, the zod mirror
 * authors nothing (`../../../../types/src/__tests__/zod-mirror-authors-no-defaults-7735.test.ts`),
 * and this file is the third face — the one the designer writes into new nodes.
 * `'center'` moved to `'start'` under that ruling; `align` now has ONE value.
 *
 * ## Why this pin is bounded to `flex.tsx` and `stack.tsx`
 *
 * That is the surface objectui#8229 measured, and it is the surface the ruling
 * folded in. It is deliberately NOT repo-wide, and the reason is a measurement
 * rather than caution: re-deriving this comparison across every registration in
 * the repository at the head this landed on found **55 comparable pairs and 7
 * disagreements** — the `flex.align` row here, plus six more in
 * `action-bar.tsx`, `action-button.tsx`, `action-group.tsx`, `pagination.tsx`,
 * `file-upload.tsx` and `plugin-markdown/src/index.tsx`.
 *
 * Those six are NOT simply six more instances of this defect, and a repo-wide
 * pin would have asserted that they were. `defaultProps` is a designer SEED as
 * much as a default claim — `pagination`'s `totalPages: 10` and `flex`'s own
 * three-button `children` array are seeds, not statements about what the key
 * means when omitted — and whether the two roles may diverge is precisely the
 * question objectui#4631 is holding, `pm:on-hold`. Widening this pin would
 * decide that question by gate rather than by ruling. The six are recorded on
 * objectui#7735 for whoever takes objectui#4631.
 *
 * ## Both sides are read off disk
 *
 * Nothing below is a list. The `defaultProps` entries and the fallback reads
 * are both parsed out of the two renderer sources, so the pin turns red if
 * EITHER side moves — a renderer changing its fallback without the seed
 * following is the same defect in the other direction. The pair count is
 * asserted to be non-zero first, because a parser that quietly matched nothing
 * would make every comparison below vacuously true.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ['flex.tsx', 'stack.tsx'] as const;
const read = (file: string): string => readFileSync(join(HERE, '..', file), 'utf8');

type Literal = { kind: 'string' | 'number' | 'boolean'; value: string | number | boolean };

/** A JS literal, or `null` for anything else (arrays, objects, identifiers). */
function literalOf(node: ts.Node, _sf: ts.SourceFile): Literal | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: 'string', value: node.text };
  if (ts.isNumericLiteral(node)) return { kind: 'number', value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'boolean', value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'boolean', value: false };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return { kind: 'number', value: -Number(node.operand.text) };
  }
  return null;
}

type Fallback = Literal & { line: number; op: string };

interface Faces {
  /** `schema.<key> || <literal>` / `schema.<key> ?? <literal>` — what RUNS. */
  fallbacks: Map<string, Fallback>;
  /** `defaultProps: { <key>: <literal> }` — what the DESIGNER seeds. */
  seeds: Map<string, { literal: Literal | null; line: number }>;
}

function facesOf(file: string): Faces {
  const text = read(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fallbacks: Faces['fallbacks'] = new Map();
  const seeds: Faces['seeds'] = new Map();
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === 'schema'
    ) {
      const lit = literalOf(node.right, sf);
      const key = node.left.name.text;
      // First read wins: a later `x || y || 'z'` chain restates the same key.
      if (lit && !fallbacks.has(key)) {
        fallbacks.set(key, {
          ...lit,
          line: lineOf(node),
          op: node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? '||' : '??',
        });
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'defaultProps' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
        if (!name) continue;
        seeds.set(name, { literal: literalOf(prop.initializer, sf), line: lineOf(prop) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { fallbacks, seeds };
}

/** Keys a file declares on BOTH faces — the only ones this pin can judge. */
function comparablePairs(file: string): { key: string; seed: Literal; fallback: Fallback }[] {
  const { fallbacks, seeds } = facesOf(file);
  const out: { key: string; seed: Literal; fallback: Fallback }[] = [];
  for (const [key, seed] of seeds) {
    const fallback = fallbacks.get(key);
    // A seed with no literal (`children: [...]`) or a key with no fallback read
    // is NOT comparable. objectui#8229 says so explicitly for the second case
    // and does not assert anything about it; neither does this pin.
    if (!fallback || !seed.literal) continue;
    out.push({ key, seed: seed.literal, fallback });
  }
  return out;
}

describe('registration `defaultProps` agree with the renderer fallback (objectui#8229 / objectui#7735)', () => {
  describe('positive controls — the parser sees both faces', () => {
    it.each(FILES)('%s declares comparable pairs on both faces', (file) => {
      const { fallbacks, seeds } = facesOf(file);
      expect(fallbacks.size, `no \`schema.x || 'lit'\` fallback found in ${file}`).toBeGreaterThan(0);
      expect(seeds.size, `no \`defaultProps\` entries found in ${file}`).toBeGreaterThan(0);
      expect(comparablePairs(file).length).toBeGreaterThan(0);
    });

    it('the census still spans the population objectui#8229 measured', () => {
      // Its table compared 10 rows across the two files and found 8 comparable.
      // A drop here means the parser lost a face, not that the code got simpler.
      const total = FILES.reduce((n, f) => n + comparablePairs(f).length, 0);
      expect(total).toBeGreaterThanOrEqual(8);
    });

    it('`align` is genuinely a divergent key — the reason objectui#8229 exists', () => {
      // `flex` reads `'start'` and `stack` reads `'stretch'`. If they ever
      // converged, the row this pin was built around would stop being
      // interesting and the fix below would need re-reading.
      expect(facesOf('flex.tsx').fallbacks.get('align')?.value).not.toEqual(
        facesOf('stack.tsx').fallbacks.get('align')?.value,
      );
    });
  });

  describe('the rule', () => {
    it.each(FILES)('%s: every comparable pair agrees', (file) => {
      const disagreements = comparablePairs(file)
        .filter(({ seed, fallback }) => seed.kind !== fallback.kind || seed.value !== fallback.value)
        .map(({ key, seed, fallback }) => `${key}: defaultProps ${JSON.stringify(seed.value)} vs renderer ${fallback.op} ${JSON.stringify(fallback.value)} (${file}:${fallback.line})`);
      expect(
        disagreements,
        'the renderer fallback is the single authoritative default (objectui#7735). Move the ' +
          '`defaultProps` seed to match the fallback — not the other way round, which relayouts ' +
          'every hand-authored node that omits the key.',
      ).toEqual([]);
    });
  });

  describe('the row this landed for', () => {
    it('`flex.defaultProps.align` is the value `flex.tsx` actually applies', () => {
      const { fallbacks, seeds } = facesOf('flex.tsx');
      expect(fallbacks.get('align')?.value).toBe('start');
      expect(seeds.get('align')?.literal?.value).toBe('start');
    });

    it('no longer seeds `center` — the value NEITHER flex nor stack applies', () => {
      expect(facesOf('flex.tsx').seeds.get('align')?.literal?.value).not.toBe('center');
      expect(facesOf('stack.tsx').fallbacks.get('align')?.value).not.toBe('center');
    });
  });
});
