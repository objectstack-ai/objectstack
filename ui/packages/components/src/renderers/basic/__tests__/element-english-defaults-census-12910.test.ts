/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12910 — no `element:*` renderer registered from `renderers/basic`
 * draws an English literal default. This is the family-closing pin of
 * objectui#12889 / objectui#12910: a test beside the renderers, ⛔ not a repo
 * gate (the card's triage).
 *
 * ## The population, stated as a rule
 *
 * Every `.tsx` file directly in this directory that calls
 * `ComponentRegistry.register(…)` with `namespace: 'element'`. The population
 * control below names the files that rule finds today, so a walk that read
 * nothing cannot pass.
 *
 * ## What counts as an English literal default
 *
 * Read from the TypeScript AST (comments are trivia to the scanner, so prose
 * that quotes a default is never read as code). A token is judged only when it
 * carries a letter, read with `\p{L}` (AGENTS.md's i18n forensics rule), and
 * it is an offender in any of these positions:
 *
 *  - `jsx-text`: JSX text, such as `<p>No details</p>`;
 *  - `display-attr`: a string or template on a display attribute (`title`,
 *    `placeholder`, `alt`, `label`, `hint`, `subtitle`, `message`,
 *    `emptyText`, `description`, `aria-label`), directly or as an arm of a
 *    `?:` / `??` / `||` inside it;
 *  - `jsx-child`: the same inside a `{…}` JSX child;
 *  - `fallback`: the right operand of `??` / `||` anywhere, when it reads as
 *    prose (a space, an ellipsis, a capital or a non-ASCII letter), such as
 *    `e?.message ?? 'aggregate failed'`. An identifier-shaped fallback
 *    (`?? 'name'`, `?? 'cover'`) is a value, not copy.
 *
 * Not judged, by rule: anything inside a `t(…)` call (the bundle read and its
 * `defaultValue`, which `pnpm check:i18n-keys` holds to the `en` pack); the
 * `ComponentRegistry.register(…)` call itself (its `label` and input
 * `description`s are designer metadata, not page copy); and JSX text inside a
 * `code` / `Code` element, which draws an identifier (`state_machine`,
 * `detail: technical`), not a sentence.
 *
 * ## Controls
 *
 *  - Lit control: every offender shape is planted in memory and must be found
 *    by the same classifier the tree scan uses; the allowed shapes must not be.
 *  - Population control: the scan must find the five registering files and
 *    must SEE their bundle reads (a `t(…)` call in each), so a classifier that
 *    read nothing cannot pass.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * This directory, derived from THIS file's own location, never from
 * `process.cwd()` (AGENTS.md; the spelling `select-placeholder-literal-11252.test.ts`
 * uses).
 */
const BASIC_DIR = decodeURIComponent(new URL(import.meta.url).pathname).split('/').slice(0, -2).join('/');

const DISPLAY_ATTRS = new Set([
  'title',
  'placeholder',
  'alt',
  'label',
  'hint',
  'subtitle',
  'message',
  'emptyText',
  'description',
  'aria-label',
]);

const LETTER = /\p{L}/u;
const PROSE = /\s|…|\p{Lu}|\P{ASCII}/u;

type Kind = 'jsx-text' | 'display-attr' | 'jsx-child' | 'fallback';
interface Hit {
  kind: Kind;
  line: number;
  text: string;
}

function isTCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't';
}

function isRegisterCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'register' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'ComponentRegistry'
  );
}

function registersElement(node: ts.Node): boolean {
  if (!isRegisterCall(node)) return false;
  const opts = (node as ts.CallExpression).arguments[2];
  return (
    !!opts &&
    ts.isObjectLiteralExpression(opts) &&
    opts.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name.getText() === 'namespace' &&
        ts.isStringLiteral(p.initializer) &&
        p.initializer.text === 'element',
    )
  );
}

function tagName(el: ts.JsxElement): string {
  return el.openingElement.tagName.getText();
}

/** Walks up through the expression shapes a default hides behind. */
function displayContext(node: ts.Node): Kind | null {
  let cur: ts.Node = node;
  for (;;) {
    const parent = cur.parent;
    if (!parent) return null;
    if (ts.isParenthesizedExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)) {
      cur = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.condition !== cur) {
      cur = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === cur &&
      [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(
        parent.operatorToken.kind,
      )
    ) {
      cur = parent;
      continue;
    }
    if (ts.isJsxExpression(parent)) {
      const holder = parent.parent;
      if (holder && ts.isJsxAttribute(holder)) return DISPLAY_ATTRS.has(holder.name.getText()) ? 'display-attr' : null;
      return 'jsx-child';
    }
    if (ts.isJsxAttribute(parent)) return DISPLAY_ATTRS.has(parent.name.getText()) ? 'display-attr' : null;
    return null;
  }
}

function isProseFallback(node: ts.Node, text: string): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    ts.isBinaryExpression(parent) &&
    parent.right === node &&
    (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
    PROSE.test(text)
  );
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('');
  return null;
}

interface Scan {
  registersElement: boolean;
  bundleReads: number;
  hits: Hit[];
}

function scan(source: string, fileName = 'planted.tsx'): Scan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Scan = { registersElement: false, bundleReads: 0, hits: [] };
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (registersElement(node)) out.registersElement = true;
    if (isTCall(node)) {
      out.bundleReads += 1;
      return;
    }
    if (isRegisterCall(node) || ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      const parent = node.parent;
      const inCode = ts.isJsxElement(parent) && /^(code|Code)$/.test(tagName(parent));
      if (LETTER.test(text) && !inCode) out.hits.push({ kind: 'jsx-text', line: line(node), text });
      return;
    }
    const text = literalText(node);
    if (text !== null) {
      if (LETTER.test(text)) {
        const kind = displayContext(node) ?? (isProseFallback(node, text) ? 'fallback' : null);
        if (kind) out.hits.push({ kind, line: line(node), text });
      }
      if (!ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const FILES = readdirSync(BASIC_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .sort()
  .map((f) => ({ file: f, result: scan(readFileSync(`${BASIC_DIR}/${f}`, 'utf8'), f) }))
  .filter(({ result }) => result.registersElement);

describe('element:* renderers in renderers/basic draw no English literal default (objectui#12910)', () => {
  it('population: the rule finds the five registering files, and sees their bundle reads', () => {
    expect(FILES.map((f) => f.file)).toEqual([
      'data-list.tsx',
      'elements.tsx',
      'metadata-viewer.tsx',
      'record-picker.tsx',
      'text-input.tsx',
    ]);
    // Every file but `text-input.tsx` (whose copy is all authored) reads the
    // bundle; a scanner that saw no `t(…)` call would read zero everywhere.
    for (const { file, result } of FILES) {
      if (file !== 'text-input.tsx') expect(result.bundleReads, file).toBeGreaterThan(0);
    }
  });

  it.each(['data-list.tsx', 'elements.tsx', 'metadata-viewer.tsx', 'record-picker.tsx', 'text-input.tsx'])(
    '%s draws no English literal default',
    (file) => {
      const found = FILES.find((f) => f.file === file);
      expect(found, `${file} no longer registers an element:* renderer`).toBeDefined();
      expect(found!.result.hits.map((h) => `${file}:${h.line} [${h.kind}] ${h.text}`)).toEqual([]);
    },
  );
});

describe('the classifier (lit control)', () => {
  const kinds = (source: string) => scan(source).hits.map((h) => `${h.kind} ${h.text}`);

  it('finds every offender shape the card names', () => {
    expect(kinds(`const a = <p className="x">No details</p>;`)).toEqual(['jsx-text No details']);
    expect(kinds(`const a = <Panel title="This metric’s data source could not be resolved" />;`)).toEqual([
      'display-attr This metric’s data source could not be resolved',
    ]);
    expect(kinds(`const a = <V placeholder={loading ? 'Loading…' : error ? 'Failed to load' : p} />;`)).toEqual([
      'display-attr Loading…',
      'display-attr Failed to load',
    ]);
    expect(kinds(`const a = <S>{n?.label ?? '(step)'}</S>;`)).toEqual(['jsx-child (step)']);
    expect(kinds(`const a = <S>{cond ? \`named “\${name}”\` : ''}</S>;`)).toEqual(['jsx-child named “”']);
    expect(kinds(`setError(e?.message ?? 'aggregate failed');`)).toEqual(['fallback aggregate failed']);
    expect(kinds(`const p = pick(props.emptyText ?? 'No records', lang);`)).toEqual(['fallback No records']);
    expect(kinds(`const x = props.placeholder || 'Select a record…';`)).toEqual(['fallback Select a record…']);
  });

  it('counts a letter in any script, not only ASCII (AGENTS.md i18n forensics)', () => {
    expect(kinds(`const a = <p>暂无数据</p>;`)).toEqual(['jsx-text 暂无数据']);
    expect(/[A-Za-z]/.test('暂无数据')).toBe(false);
  });

  it('leaves the allowed shapes alone', () => {
    expect(
      kinds(`
        // A comment quoting "No details" is prose.
        const a = <p className="text-sm text-muted-foreground">{t('common.noData', { defaultValue: 'No data' })}</p>;
        const b = props.labelField ?? 'name';
        const c = <img alt={props.alt ?? ''} data-testid="x" />;
        const d = <code className="font-mono">detail: technical</code>;
        const e = <Code key="a">state_machine</Code>;
        const f = <div className={cond ? 'flex items-baseline gap-3' : 'flex flex-col'}>{' · '}</div>;
        ComponentRegistry.register('x', X, { namespace: 'element', label: 'Record Picker' });
      `),
    ).toEqual([]);
  });

  it('reads a registration with namespace element, and not another namespace', () => {
    expect(scan(`ComponentRegistry.register('x', X, { namespace: 'element' });`).registersElement).toBe(true);
    expect(scan(`ComponentRegistry.register('x', X, { namespace: 'ui' });`).registersElement).toBe(false);
  });
});
