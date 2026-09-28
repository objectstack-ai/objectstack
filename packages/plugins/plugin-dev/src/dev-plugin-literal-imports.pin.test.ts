// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20376 — every dynamic `import()` in `dev-plugin.ts` names its package
// LITERALLY, except the one ADR-0132 requires to stay a variable.
//
// ## Why the FORM of the specifier is pinned
//
// Every suite in this family mocks the packages `DevPlugin.init()` loads, so
// `init()` should run in-process. For a literal `import('x')` it does: the
// specifier is rewritten when `dev-plugin.ts` is transformed, and the test's
// `vi.mock('x')` serves it inside the worker. A VARIABLE specifier is resolved
// at CALL time instead, by a round trip to the main vitest process, and that
// happens on every call, not only the first. Measured with a throwaway vite
// plugin logging every `resolveId` and `transform` the main process served,
// around six back-to-back `init()`s with setup and account mocked absent:
//
//   - With the loop importing through `spec[0]` (`dev-plugin.ts` as of
//     `0fcb10184`), the six `init()`s made the main process serve 20
//     requests: a `resolveId` of `@objectstack/setup` and one of
//     `@objectstack/account` on EVERY `init()`, and on the first one also the
//     transform of both packages' `dist` entries and the resolution of their
//     imports. The mount-refusal suite's nine `init()`s made 18 of those
//     `resolveId`s.
//   - With literal specifiers, the same six `init()`s made ZERO. Every
//     specifier this file names, the twelve literal loads beside the loop
//     included, is resolved once, when the file is transformed at collection.
//   - The main process is one process shared by every worker in the run, so
//     a request to it waits on whatever it is doing for OTHER files. On
//     `Test Core (6/6)` (job 108779589417), the mount-refusal suite's first
//     case timed out at 5026 ms and its second took 2336 ms, while its other
//     four took 16-72 ms, in a package run that read `transform 74.29s,
//     import 137.46s, tests 11.87s`.
//
// So re-introducing a variable specifier puts a main-process round trip back
// into every clocked window that boots this plugin, whatever the suite. A
// timeout raised to absorb it would only move the cliff to the next heavier
// shard.
//
// ## The one exception
//
// `@objectstack/organizations` is imported through `organizationsPkg`, with
// `webpackIgnore`, on purpose: ADR-0132's entitlement boundary forbids any
// framework package from declaring it (`no-framework-dependents.pin.test.ts`),
// so no bundler may try to resolve it. In the suites that mock it, its mock
// URL is the raw specifier, so the worker serves it without a round trip.
//
// ## How it reads the file
//
// Through the TypeScript compiler's own parser, never through the source text:
// a dynamic import is a call node whose callee is the `import` keyword, so a
// comment, a string or a regex that mentions `import(` is never read as one,
// and the leading `/* webpackIgnore: true */` is trivia, not part of the
// argument. The lit control (③) proves the walk still finds the literal
// loads, so a walk that found nothing cannot pass ① vacuously.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// `__dirname`, not `import.meta.url`: this package's build config compiles
// `src/**` as CommonJS, where `import.meta` is TS1470. Vitest's evaluator
// provides `__dirname` to every module it runs.
const HERE = __dirname;
const FILE = resolve(HERE, 'dev-plugin.ts');
const SOURCE = ts.createSourceFile(FILE, readFileSync(FILE, 'utf8'), ts.ScriptTarget.Latest, true);

/** Every node of the parsed file, depth first. */
function nodesOf(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

const NODES = nodesOf(SOURCE);

/** The first argument of every dynamic `import(…)` call in the file. */
const DYNAMIC_IMPORT_ARGS: ts.Expression[] = NODES
  .filter((n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
  .map((call) => call.arguments[0]);

/**
 * Only a plain string literal counts as naming its package: it is the form the
 * transform resolves ahead of time. Anything else is resolved at call time.
 */
const LITERAL_ARGS = DYNAMIC_IMPORT_ARGS.filter(ts.isStringLiteral).map((arg) => arg.text);
const VARIABLE_ARGS = DYNAMIC_IMPORT_ARGS.filter((arg) => !ts.isStringLiteral(arg)).map((arg) => arg.getText(SOURCE));

describe('#20376 — dev-plugin.ts loads its packages through literal specifiers', () => {
  it('① every dynamic import names its package literally, except the organizations one', () => {
    expect(VARIABLE_ARGS, 'a variable specifier costs a main-process round trip per call under vitest').toEqual([
      'organizationsPkg',
    ]);
  });

  it('② the exception is the ADR-0132 package, and nothing else hides behind that name', () => {
    const declarations = NODES.filter(
      (n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(SOURCE) === 'organizationsPkg',
    );
    expect(declarations).toHaveLength(1);
    const init = declarations[0].initializer;
    expect(init !== undefined && ts.isStringLiteral(init) ? init.text : undefined).toBe('@objectstack/organizations');
  });

  it('③ lit control: the walk sees the setup / account loads, and the loads beside them, as literals', () => {
    for (const pkg of ['@objectstack/setup', '@objectstack/account', '@objectstack/objectql']) {
      expect(LITERAL_ARGS, pkg).toContain(pkg);
    }
  });
});
