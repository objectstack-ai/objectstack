/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView.tsx` reads its schema through the type, never through
 * `(schema as any)` (objectstack#25918).
 *
 * Every key the file used to read through the `any` cast (`kanban`,
 * `calendar`, `gallery`, `timeline`, `gantt`, `tree`, `chart`,
 * `bulkActionDefs`) is a declared member of `ListViewSchema`, so the cast hid
 * nothing but the type: a misspelt key or a wrong-shaped use compiled. The one
 * undeclared key, the host-composed `rowActionDefs`, is refused by the spec on
 * the list surface (objectui#8653), so it is read through a single narrow cast
 * (`hostRowActionDefsOf`), typed as the `object-grid` child declares it.
 *
 * The scan is a TypeScript AST walk, so the prose that quotes a retired cast
 * (the `userActions` collision note, the retired `title` arm) is trivia and
 * does not count.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Rooted at THIS file, never at `process.cwd()`. */
const LIST_VIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'ListView.tsx');

/** `x`, with any wrapping parentheses taken off. */
function unparen(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
}

/** The 1-based lines of every `schema as any` / `props.schema as any` cast in `text`. */
function anySchemaCasts(text: string, file: string): number[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: number[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      const operand = unparen(node.expression);
      const isSchema =
        (ts.isIdentifier(operand) && operand.text === 'schema') ||
        (ts.isPropertyAccessExpression(operand) && operand.name.text === 'schema');
      if (isSchema) hits.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return hits;
}

describe('ListView.tsx reads its schema through the type (objectstack#25918)', () => {
  it('no `(schema as any)` cast is left', () => {
    const hits = anySchemaCasts(readFileSync(LIST_VIEW, 'utf8'), 'ListView.tsx')
      .map((line) => `plugin-list/src/ListView.tsx line ${line}`);
    expect(hits, 'read a declared key as schema.KEY; an undeclared key takes a narrow typed cast').toEqual([]);
  });

  it('FIRING CONTROL: the scanner catches each cast shape, and skips comments, typed casts and other objects', () => {
    const probe = [
      '// (schema as any).kanban in a comment is prose',
      'const a = (schema as any).kanban;',
      'const b = ((schema as any)).tree?.parentField;',
      'const c = (props.schema as any).chart;',
      'const d = (schema as Pick<DataTableSchema, "rowActionDefs">).rowActionDefs;',
      'const e = (field as any).options;',
    ].join('\n');
    expect(anySchemaCasts(probe, 'probe.ts')).toEqual([2, 3, 4]);
  });
});
