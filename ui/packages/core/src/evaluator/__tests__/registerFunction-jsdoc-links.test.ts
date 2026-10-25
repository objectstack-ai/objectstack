/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Binding pins for objectui#5580 — the `{@link}` targets in the
 * `registerFunction` doc block resolve to the entities the prose means.
 *
 * `ExpressionEvaluator.ts` declares TWO things spelled `evaluateExpression`:
 * the METHOD on `ExpressionEvaluator` (bare expression, throws) and the
 * MODULE-LEVEL export (context bag, fail-soft, delegates to `evaluate`). The
 * `registerFunction` block refers to both, four lines apart, and calls one of
 * them "the throwing sibling".
 *
 * Why this file drives `tsc` itself: a `{@link}` that binds to the WRONG entity
 * is indistinguishable in source from one that binds right — both are just
 * text in a comment. Nothing at runtime observes it, and no lint rule in this
 * repo resolves link targets. The only thing that actually performs the binding
 * is the TypeScript checker, which is what an editor hover and the published
 * `.d.ts` reader both go through, so the checker is what these cases ask.
 *
 * The hazard is not hypothetical and it is not symmetric. Measured on the
 * pre-fix source, the unqualified `{@link evaluateExpression}` resolved to the
 * module-level `FunctionDeclaration` — the FAIL-SOFT one — while the sentence
 * containing it calls it the throwing sibling. Sibling `{@link evaluate}` in
 * the same block binds to the method, but only because no module-level
 * `evaluate` exists to outrank it. So "an unqualified link in a class member
 * resolves to that class's member" is FALSE here, and that false reading is
 * exactly what the card this file closes had assumed.
 *
 * NO BUILD ARTIFACT SITS BETWEEN THE EDIT AND THESE ASSERTIONS. The program is
 * created over the SOURCE file by relative path, so `dist/` is not in the loop
 * and no rebuild sits between an edit and a result.
 *
 * The discrimination proof is built in rather than promised in prose:
 * `bindingOf(ABLATED)` compiles the same source a SECOND time with the single
 * qualification removed — everything else byte-identical — and asserts the link
 * lands back on the module-level function. A pin that cannot fail is not a pin,
 * so the failing leg is measured here, in-suite, on every run.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBJECT = join(HERE, '..', 'ExpressionEvaluator.ts');

/** The qualification under test, and the bare spelling it replaced. */
const QUALIFIED = '{@link ExpressionEvaluator.evaluateExpression}';
const BARE = '{@link evaluateExpression}';

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
};

/** Where a resolved symbol actually lives, in terms that survive line drift. */
interface Binding {
  readonly kind: string;
  /** Enclosing class for a method; `'<module>'` for a top-level function. */
  readonly owner: string;
  readonly file: string;
}

/**
 * Compile `text` as the subject file and report what each `{@link}` in the
 * `registerFunction` doc block binds to, keyed by the link's literal text.
 */
function bindingsIn(text: string): Map<string, Binding> {
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (join(fileName) === SUBJECT) {
      return ts.createSourceFile(fileName, text, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  };

  const program = ts.createProgram([SUBJECT], COMPILER_OPTIONS, host);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(SUBJECT);
  if (!sourceFile) throw new Error(`subject not loaded: ${SUBJECT}`);

  const method = findRegisterFunction(sourceFile);
  if (!method) throw new Error('registerFunction declaration not found');

  const out = new Map<string, Binding>();
  for (const link of linksOf(method)) {
    const nameNode = (link as ts.JSDocLink).name;
    if (!nameNode) continue;
    const literal = `{@link ${nameNode.getText(sourceFile)}}`;
    const symbol = checker.getSymbolAtLocation(nameNode);
    const declaration = symbol?.getDeclarations()?.[0];
    if (!declaration) continue;
    out.set(literal, {
      kind: ts.SyntaxKind[declaration.kind],
      owner: ownerOf(declaration),
      file: declaration.getSourceFile().fileName.split('/').pop() ?? '',
    });
  }
  return out;
}

function findRegisterFunction(sourceFile: ts.SourceFile): ts.MethodDeclaration | undefined {
  let found: ts.MethodDeclaration | undefined;
  const walk = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name.getText(sourceFile) === 'registerFunction') {
      found = node;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return found;
}

/** Every `{@link}` node inside a declaration's own doc comment. */
function linksOf(node: ts.Node): ts.Node[] {
  const links: ts.Node[] = [];
  const collect = (n: ts.Node): void => {
    if (
      n.kind === ts.SyntaxKind.JSDocLink ||
      n.kind === ts.SyntaxKind.JSDocLinkCode ||
      n.kind === ts.SyntaxKind.JSDocLinkPlain
    ) {
      links.push(n);
    }
    ts.forEachChild(n, collect);
    const comment = (n as ts.JSDoc).comment;
    if (Array.isArray(comment)) comment.forEach(collect);
    const tags = (n as ts.JSDoc).tags;
    if (tags) tags.forEach(collect);
  };
  for (const doc of ts.getJSDocCommentsAndTags(node)) collect(doc);
  return links;
}

function ownerOf(declaration: ts.Declaration): string {
  const parent = declaration.parent;
  if (parent && ts.isClassDeclaration(parent)) {
    return parent.name?.getText(parent.getSourceFile()) ?? '<anonymous class>';
  }
  if (parent && ts.isSourceFile(parent)) return '<module>';
  return ts.SyntaxKind[parent?.kind ?? ts.SyntaxKind.Unknown];
}

const PRISTINE = readFileSync(SUBJECT, 'utf8');
const ABLATED = PRISTINE.replace(QUALIFIED, BARE);

describe('registerFunction JSDoc — {@link} targets bind to the entity the prose means', () => {
  it('the source carries the qualification, exactly once, and the ablation is a real edit', () => {
    // Trap #4 in reverse: a zeroed anchor and an absent one look identical, so
    // the anchors are asserted pristine BEFORE anything is concluded from them.
    expect(PRISTINE.split(QUALIFIED).length - 1).toBe(1);
    expect(ABLATED).not.toBe(PRISTINE);
    expect(ABLATED.split(BARE).length - 1).toBe(1);
  });

  it('"the throwing sibling" resolves to the METHOD, not the module-level export', () => {
    const binding = bindingsIn(PRISTINE).get(QUALIFIED);
    expect(binding).toBeDefined();
    expect(binding).toEqual({
      kind: 'MethodDeclaration',
      owner: 'ExpressionEvaluator',
      file: 'ExpressionEvaluator.ts',
    });
  });

  it('ABLATION — dropping the qualification puts the link back on the fail-soft function', () => {
    // This is the leg that proves the pin above can fail. If this ever reports a
    // MethodDeclaration, the qualification has stopped being load-bearing and
    // the pin above is green for the wrong reason.
    const binding = bindingsIn(ABLATED).get(BARE);
    expect(binding).toBeDefined();
    expect(binding).toEqual({
      kind: 'FunctionDeclaration',
      owner: '<module>',
      file: 'ExpressionEvaluator.ts',
    });
  });

  it('the other two links in the block still bind where they read', () => {
    const bindings = bindingsIn(PRISTINE);
    // `evaluate` is unqualified and CORRECT — no module-level `evaluate` exists
    // to outrank it. Pinned so that adding one is a visible break, not a silent
    // rebinding of this sentence.
    expect(bindings.get('{@link evaluate}')).toEqual({
      kind: 'MethodDeclaration',
      owner: 'ExpressionEvaluator',
      file: 'ExpressionEvaluator.ts',
    });
    expect(bindings.get('{@link FormulaFunctions.register}')).toEqual({
      kind: 'MethodDeclaration',
      owner: 'FormulaFunctions',
      file: 'FormulaFunctions.ts',
    });
  });

  it('no link in the block dangles', () => {
    const bindings = bindingsIn(PRISTINE);
    expect(bindings.size).toBe(3);
    for (const [literal, binding] of bindings) {
      expect(binding.kind, `${literal} resolved nowhere`).toBeTruthy();
    }
  });
});
