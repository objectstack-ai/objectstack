/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12821 — no component of the console settings page draws a bare
 * English literal: every JSX text node, every string a JSX child expression
 * renders, and every `title` / `aria-label` value goes through `t()`.
 *
 * A row chip drawn as a literal reads English on every other language and
 * nothing fails. That happened twice on this page: the source badges'
 * "Overrides" / "Inherited from" (objectui#12694) and the env-lock chip
 * "Locked by env" (objectui#12821). This pin holds the class for the page
 * rather than one chip, so the next chip added cannot ship English-only.
 *
 * ## How the files are read
 *
 * Every `*.tsx` directly under `apps/console/src/pages/settings/`, listed from
 * disk (a new component is enumerated with no edit here). Comments are blanked
 * by `scripts/js-comment-mask.mjs`, the one comment masker this tree uses,
 * before the TypeScript parser reads the result, so prose naming a literal is
 * never a finding.
 *
 * ## What counts as a rendered literal
 *
 * A string with a letter in it (`\p{L}`, so any script, not only Latin) that
 * reaches the DOM: a JSX text node, or a string in a RENDERED position of a JSX
 * child expression or a `title` / `aria-label` value. A rendered position is
 * the expression itself, a branch of `?:`, either side of `??` / `||`, the
 * right of `&&`, or a template's text. A string inside a call (`t('key')`,
 * `t(key, { defaultValue })`) or a comparison is not rendered, and a
 * `className` is not copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { maskComments } from '../../../../../../scripts/js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = join(HERE, '..');
const LETTER = /\p{L}/u;
const COPY_ATTRIBUTES = new Set(['title', 'aria-label']);

function renderedLiterals(file: string, raw: string): string[] {
  const source = maskComments(raw);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const hit = (where: string, text: string) => {
    if (LETTER.test(text)) hits.push(`${where}: ${JSON.stringify(text.trim())}`);
  };

  const rendered = (node: ts.Expression, where: string): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return hit(where, node.text);
    if (ts.isTemplateExpression(node)) {
      hit(where, node.head.text);
      for (const span of node.templateSpans) {
        rendered(span.expression, where);
        hit(where, span.literal.text);
      }
      return;
    }
    if (ts.isParenthesizedExpression(node)) return rendered(node.expression, where);
    if (ts.isConditionalExpression(node)) {
      rendered(node.whenTrue, where);
      rendered(node.whenFalse, where);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
        rendered(node.left, where);
        rendered(node.right, where);
      } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        rendered(node.right, where);
      }
    }
  };

  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) hit('text', node.text);
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      rendered(node.expression, 'child');
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (COPY_ATTRIBUTES.has(name)) {
        const init = node.initializer;
        if (ts.isStringLiteral(init)) hit(name, init.text);
        else if (ts.isJsxExpression(init) && init.expression) rendered(init.expression, name);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return hits;
}

const FILES = readdirSync(PAGE_DIR)
  .filter((name) => name.endsWith('.tsx'))
  .sort();

describe('the console settings page draws no bare English literal (objectui#12821)', () => {
  it('enumerates the page components (a short list would pass vacuously)', () => {
    expect(FILES).toContain('EnvLockBadge.tsx');
    expect(FILES).toContain('SettingsField.tsx');
  });

  it('the detector sees the shapes it claims, and not a t() call or a comment (control)', () => {
    const sample = [
      'export const A = ({ r, n }) => (',
      "  <B title={r ?? 'Pinned by env'} aria-label=\"Lock\">",
      '    Locked by env',
      "    {n ? `Deprecated → ${n}` : ''}",
      "    {t('console.settingsView.envLockBadge', { defaultValue: 'Locked by env' })}",
      "    <C title={t('k')} className=\"text-amber-700\" />",
      "    {/* Locked by env */}",
      '  </B>',
      ');',
    ].join('\n');
    expect(renderedLiterals('sample.tsx', sample)).toEqual([
      'title: "Pinned by env"',
      'aria-label: "Lock"',
      'text: "Locked by env"',
      'child: "Deprecated →"',
    ]);
  });

  it.each(FILES)('%s: no JSX text, rendered child string, title or aria-label is a literal', (file) => {
    expect(renderedLiterals(file, readFileSync(join(PAGE_DIR, file), 'utf8'))).toEqual([]);
  });
});
