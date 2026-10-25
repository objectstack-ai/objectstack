/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4422 structural guard — a `forwardRef` render function must declare
 * the props it reads, and the compiler cannot tell you when it stops doing so.
 *
 * ## The trap
 *
 * `forwardRef<T, P>` routes `P` through `PropsWithoutRef`, defined in
 * `@types/react` as:
 *
 *     Props extends any ? ('ref' extends keyof Props ? Omit< Props, 'ref' > : Props) : Props
 *
 * A string index signature puts `string` into `keyof Props`, so
 * `'ref' extends keyof Props` is ALWAYS true and the `Omit` branch always runs.
 * `Omit` over a type carrying a string index signature keeps only the index
 * signature — every declared property is erased. The render function therefore
 * receives `{ [x: string]: any }` and `schema` resolves through the index
 * signature to `any`.
 *
 * This is worse than a missing annotation because it is SILENT. The props type
 * is right there in the source, so the component reads as typed to every
 * reviewer and every tool. `noImplicitAny` does not see it either: the `any` is
 * supplied EXPLICITLY by the index signature, so nothing is implicit and no
 * TS7006/TS7031 is raised. That is what let the action renderers declare the
 * deprecated `ActionSchema` while being written against `UIActionSchema` for as
 * long as they did (objectui#4418) — a contradiction that became four compiler
 * errors the instant those values were given a real type.
 *
 * ## Why a test and not a lint rule or a compiler flag
 *
 * No strictness flag reports this — the hole is invisible to the compiler by
 * construction, which is exactly what objectui#4422 recorded. So the invariant
 * needs a structural pin, in the same ratchet style as
 * `app-shell/src/no-component-any-cast.ratchet.test.ts`.
 *
 * ## The shape this pins
 *
 *   forwardRef< El, { schema: XSchema; className?: string } >(
 *     ({ schema, className, ...props }: { schema: XSchema; className?: string; [key: string]: any }, ref) => …
 *   )
 *
 * The index signature lives on the PARAMETER ANNOTATION and not on the type
 * argument. Both halves are load-bearing:
 *
 *   * Off the type argument, so `PropsWithoutRef` has nothing to collapse and
 *     the declared props survive. Note the annotation cannot simply repeat the
 *     type argument: once `Omit` has erased `schema`, a required `schema` in
 *     the annotation is a TS2345 on the render function itself.
 *   * On the parameter, so `...props` still collects arbitrary keys for the
 *     DOM / Shadcn hand-off. This is therefore NOT the "drop the index
 *     signature and name the pass-through props" direction (objectui#4422
 *     direction 2, deferred) — no component's real prop surface is enumerated
 *     and no spread changes behaviour.
 *
 * ## If this fails
 *
 * Do not add the file to an allowlist, and do not delete the parameter
 * annotation to make the error go away — that silently untypes every prop the
 * render function reads. Annotate the render function's first parameter, and
 * keep the string index signature off the `forwardRef` type argument.
 *
 * SCOPE — `packages/components/src`, production sources only, and only
 * `forwardRef` calls whose render function reads a `schema` prop. Those are the
 * registered renderers, the population the finding measured. Index signatures
 * are detected SYNTACTICALLY (inline object type, or a type/interface declared
 * in the same file); a props type imported from elsewhere is out of reach of a
 * source scan and is not claimed to be covered.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/components/src/__tests__  ->  packages/components/src
const srcRoot = path.resolve(here, '..');

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return out;
}

/** A `forwardRef` call site, reduced to the two facts this guard judges. */
interface Site {
  file: string;
  line: number;
  /** The render function's first parameter carries a direct type annotation. */
  annotated: boolean;
  /** The props TYPE ARGUMENT syntactically carries a string index signature. */
  indexSignatureOnTypeArg: boolean;
}

/** Does this type node syntactically carry a string index signature? */
function hasStringIndexSignature(
  node: ts.TypeNode | undefined,
  localTypes: Map<string, ts.Node>,
  seen = new Set<string>(),
): boolean {
  if (!node) return false;
  const members = (n: ts.Node): readonly ts.TypeElement[] | undefined =>
    ts.isTypeLiteralNode(n) || ts.isInterfaceDeclaration(n) ? n.members : undefined;

  const scan = (n: ts.Node): boolean => {
    const ms = members(n);
    if (ms) {
      for (const m of ms) {
        if (ts.isIndexSignatureDeclaration(m)) {
          const p = m.parameters[0];
          if (p?.type && p.type.kind === ts.SyntaxKind.StringKeyword) return true;
        }
      }
      // an interface may inherit one
      if (ts.isInterfaceDeclaration(n) && n.heritageClauses) {
        for (const h of n.heritageClauses) {
          for (const t of h.types) {
            if (ts.isIdentifier(t.expression) && localTypes.has(t.expression.text)) {
              const target = localTypes.get(t.expression.text)!;
              if (!seen.has(t.expression.text)) {
                seen.add(t.expression.text);
                if (scan(target)) return true;
              }
            }
          }
        }
      }
      return false;
    }
    if (ts.isTypeAliasDeclaration(n)) return scan(n.type);
    if (ts.isIntersectionTypeNode(n) || ts.isUnionTypeNode(n)) return n.types.some(scan);
    if (ts.isParenthesizedTypeNode(n)) return scan(n.type);
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) {
      const name = n.typeName.text;
      if (seen.has(name)) return false;
      seen.add(name);
      const decl = localTypes.get(name);
      return decl ? scan(decl) : false;
    }
    return false;
  };
  return scan(node);
}

/** Collect every `forwardRef(...)` whose render function reads a `schema` prop. */
function collectSites(file: string): Site[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const localTypes = new Map<string, ts.Node>();
  const indexDecls = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) localTypes.set(n.name.text, n);
    ts.forEachChild(n, indexDecls);
  };
  indexDecls(sf);

  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isForwardRef =
        (ts.isIdentifier(callee) && callee.text === 'forwardRef') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'forwardRef');
      if (isForwardRef) {
        const render = node.arguments[0];
        if (render && (ts.isArrowFunction(render) || ts.isFunctionExpression(render))) {
          const first = render.parameters[0];
          // Only judge renderers — the population objectui#4422 measured.
          const readsSchema =
            !!first &&
            ((ts.isObjectBindingPattern(first.name) &&
              first.name.elements.some(
                e => ts.isIdentifier(e.propertyName ?? e.name) && (e.propertyName ?? e.name).getText() === 'schema',
              )) ||
              false);
          if (readsSchema) {
            sites.push({
              file,
              line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              annotated: !!first!.type,
              indexSignatureOnTypeArg: hasStringIndexSignature(node.typeArguments?.[1], localTypes),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

const ALL_SITES = collectSourceFiles(srcRoot).flatMap(collectSites);
const rel = (s: Site) => `${path.relative(srcRoot, s.file)}:${s.line}`;

describe('objectui#4422 — forwardRef renderers must annotate their props parameter', () => {
  it('finds the renderer population (guards against a broken scan)', () => {
    // If this collapses, the walk or the AST matcher has gone stale and the
    // guard would silently pass on nothing. 15 `schema`-reading forwardRef
    // renderers exist at the time of writing; the floor is deliberately loose
    // so adding or removing one renderer does not fail the wrong assertion.
    expect(ALL_SITES.length).toBeGreaterThanOrEqual(12);
  });

  it('detects the shapes it is meant to ban (guards against a dead matcher)', () => {
    // A guard whose matcher silently stops matching is worse than no guard, so
    // pin it against the exact pre-fix shapes plus the spellings that erase
    // props identically. These are compiled in memory — no fixture files.
    const scan = (src: string): Site[] => {
      const f = path.join(srcRoot, '__inmemory__.tsx');
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const localTypes = new Map<string, ts.Node>();
      const idx = (n: ts.Node): void => {
        if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) localTypes.set(n.name.text, n);
        ts.forEachChild(n, idx);
      };
      idx(sf);
      const out: Site[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'forwardRef') {
          const render = node.arguments[0];
          if (render && ts.isArrowFunction(render)) {
            const first = render.parameters[0];
            if (
              first &&
              ts.isObjectBindingPattern(first.name) &&
              first.name.elements.some(e => (e.propertyName ?? e.name).getText() === 'schema')
            ) {
              out.push({
                file: f,
                line: 1,
                annotated: !!first.type,
                indexSignatureOnTypeArg: hasStringIndexSignature(node.typeArguments?.[1], localTypes),
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return out;
    };

    // 1. The exact pre-fix shape: index signature on the type argument, no
    //    parameter annotation. This is what erased `ActionBarSchema`.
    const inline = scan(
      'const C = forwardRef<HTMLDivElement, { schema: XSchema; [key: string]: any }>(({ schema, ...props }, ref) => null);',
    );
    expect(inline).toHaveLength(1);
    expect(inline[0].annotated).toBe(false);
    expect(inline[0].indexSignatureOnTypeArg).toBe(true);

    // 2. Same defect hidden behind a named interface — the spelling that made
    //    objectui#4422's own file list undercount by two (action-button /
    //    action-icon declared theirs as `ActionButtonProps` / `ActionIconProps`).
    const named = scan(
      'interface P { schema: XSchema; [key: string]: any }\n' +
        'const C = forwardRef<HTMLButtonElement, P>(({ schema, ...props }, ref) => null);',
    );
    expect(named).toHaveLength(1);
    expect(named[0].indexSignatureOnTypeArg).toBe(true);
    expect(named[0].annotated).toBe(false);

    // 3. Hidden one level further, behind a type alias and an intersection.
    const aliased = scan(
      'type Pass = { [key: string]: any };\n' +
        'type P = { schema: XSchema } & Pass;\n' +
        'const C = forwardRef<HTMLDivElement, P>(({ schema }, ref) => null);',
    );
    expect(aliased[0].indexSignatureOnTypeArg).toBe(true);

    // 4. And the compliant shape must read as compliant.
    const fixed = scan(
      'const C = forwardRef<HTMLDivElement, { schema: XSchema; className?: string }>(' +
        '({ schema, className, ...props }: { schema: XSchema; className?: string; [key: string]: any }, ref) => null);',
    );
    expect(fixed).toHaveLength(1);
    expect(fixed[0].annotated).toBe(true);
    expect(fixed[0].indexSignatureOnTypeArg).toBe(false);

    // 5. A NUMBER index signature does not trigger the collapse (`keyof` still
    //    excludes the string `'ref'`), so it must not be reported.
    const numeric = scan(
      'const C = forwardRef<HTMLDivElement, { schema: XSchema; [i: number]: any }>(({ schema }, ref) => null);',
    );
    expect(numeric[0].indexSignatureOnTypeArg).toBe(false);
  });

  it('every schema-reading forwardRef annotates its props parameter', () => {
    // If this fails: annotate the render function's FIRST PARAMETER directly.
    // Without it the parameter's type comes from `PropsWithoutRef` of the type
    // argument, and every declared prop the render function reads is `any`.
    const offenders = ALL_SITES.filter(s => !s.annotated).map(rel);
    expect(offenders).toEqual([]);
  });

  it('no schema-reading forwardRef carries a string index signature on its props type argument', () => {
    // If this fails: move the `[key: string]: any` off the `forwardRef` type
    // argument and onto the parameter annotation. On the type argument it makes
    // `PropsWithoutRef` collapse the props to the bare index signature, which
    // erases every declared property — and a required prop in the annotation
    // then becomes a TS2345 on the render function, so the two halves have to
    // move together. Do not allowlist.
    const offenders = ALL_SITES.filter(s => s.indexSignatureOnTypeArg).map(rel);
    expect(offenders).toEqual([]);
  });
});
