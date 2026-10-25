/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4528 structural guard — the `packages/plugin-list` sibling of
 * `packages/components/src/__tests__/forwardref-props-annotation.guard.test.ts`
 * (objectui#4422 / PR #4438).
 *
 * ## Why a sibling and not a widened original
 *
 * The original resolves its scan root as `path.resolve(here, '..')`, i.e.
 * `packages/components/src`, and its own header says so. That ratchet therefore
 * structurally could not see this package, and would not have caught the
 * offender arriving — which is exactly how `ListView` kept the defect for the
 * whole life of #4438. objectui#4528 direction 3 (one guard over every
 * package's `src`) stays open and is NOT done here: a repo-wide widening goes
 * red on `packages/react/src/SchemaRenderer.tsx`, which is outside this card's
 * surface. Filed separately; see that finding before widening.
 *
 * ## The trap
 *
 * `forwardRef< T, P >` routes `P` through `PropsWithoutRef`, defined in
 * `@types/react` as:
 *
 *     Props extends any ? ('ref' extends keyof Props ? Omit< Props, 'ref' > : Props) : Props
 *
 * A string index signature puts `string` into `keyof Props`, so
 * `'ref' extends keyof Props` is ALWAYS true and the `Omit` branch always runs.
 * `Omit` over a type carrying a string index signature keeps only the index
 * signature — every declared property is erased, on BOTH sides:
 *
 *   * the render function receives `{ [x: string]: any }`, so every prop it
 *     reads (`schema` included) is `any` — which is how two genuine type
 *     defects inside `ListView` survived until objectui#4528 annotated the
 *     parameter and gave `schema` a real type; and
 *   * `ForwardRefExoticComponent`'s public props come through the same alias,
 *     so every JSX CALL SITE is unchecked too. Measured on the pre-fix source:
 *     `keyof React.ComponentProps< typeof ListView >` was `string | number` and
 *     `...['onRowClick']` was `any`, while `ListViewProps` went on declaring
 *     `(record: Record< string, unknown >) => void`.
 *
 * It is SILENT: the props type is right there in the source, so the component
 * reads as typed to every reviewer and every tool, and `noImplicitAny` does not
 * fire because the `any` is supplied EXPLICITLY by the index signature.
 *
 * ## Scope — WIDER than the original's, deliberately
 *
 * The original judges only `forwardRef` calls whose render function
 * DESTRUCTURES a `schema` prop. That heuristic misses components that take
 * their props whole and forward them, which is the shape of the sibling
 * package's public `DashboardRenderer` — and it is precisely the call-site half
 * objectui#4528 measured. So this guard's population is instead "every
 * `forwardRef` whose props TYPE ARGUMENT is a type declared in the SAME file",
 * i.e. every site where this package owns the props contract and a source scan
 * can actually read it.
 *
 * `ListViewBlock` is the worked example of what that leaves out: it is a
 * `forwardRef` on `ListViewProps` IMPORTED from `./ListView`, so a source scan
 * cannot see the declaration and this guard does not pretend to judge it. It is
 * covered where the type is declared — here, on `ListView.tsx` — which is the
 * only place the index signature could come back.
 *
 * ## If this fails
 *
 * Do not add the file to an allowlist, and do not delete a parameter annotation
 * to make the error go away — that silently untypes every prop the render
 * function reads. Keep the string index signature OFF the `forwardRef` type
 * argument, and annotate the render function's first parameter when it
 * destructures. Both halves move together: once `Omit` has erased the props, a
 * required prop in the annotation is a TS2345 on the render function itself.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-list/src/__tests__  ->  packages/plugin-list/src
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

/** A `forwardRef` call site, reduced to the facts this guard judges. */
interface Site {
  file: string;
  line: number;
  /** The render function's first parameter is an object binding pattern. */
  destructures: boolean;
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

/** Every `forwardRef(...)` whose props type argument is declared in this file. */
function collectSitesFrom(file: string, text: string): Site[] {
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
        const typeArg = node.typeArguments?.[1];
        // In scope only when THIS file owns the props contract: an inline type
        // literal, or a named type declared here. A props type imported from
        // elsewhere (`ListViewBlock`) is out of a source scan's reach and is
        // covered where it is declared instead.
        let ownsProps = false;
        if (typeArg) {
          ownsProps =
            !ts.isTypeReferenceNode(typeArg) ||
            !ts.isIdentifier(typeArg.typeName) ||
            localTypes.has(typeArg.typeName.text);
        }
        const render = node.arguments[0];
        if (ownsProps && render && (ts.isArrowFunction(render) || ts.isFunctionExpression(render))) {
          const first = render.parameters[0];
          sites.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            destructures: !!first && ts.isObjectBindingPattern(first.name),
            annotated: !!first?.type,
            indexSignatureOnTypeArg: hasStringIndexSignature(typeArg, localTypes),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

const collectSites = (file: string): Site[] => collectSitesFrom(file, readFileSync(file, 'utf8'));

const ALL_SITES = collectSourceFiles(srcRoot).flatMap(collectSites);
const rel = (s: Site) => `${path.relative(srcRoot, s.file)}:${s.line}`;

describe('objectui#4528 — plugin-list forwardRef props must not be erased', () => {
  it('finds the population (guards against a broken scan)', () => {
    // If this collapses, the walk or the AST matcher has gone stale and the
    // guard would silently pass on nothing. One site exists at the time of
    // writing — `ListView` on `ListViewProps`; `ListViewBlock` is deliberately
    // out of scope (imported props type, see the header).
    expect(ALL_SITES.length).toBeGreaterThanOrEqual(1);
  });

  it('detects the shapes it is meant to ban (guards against a dead matcher)', () => {
    // A guard whose matcher silently stops matching is worse than no guard, so
    // pin it against the exact pre-fix shapes plus the spellings that erase
    // props identically. Compiled in memory — no fixture files.
    const scan = (src: string): Site[] =>
      collectSitesFrom(path.join(srcRoot, '__inmemory__.tsx'), src);

    // 1. This package's exact PRE-FIX shape: a named interface carrying the
    //    index signature, handed straight to `forwardRef`, render function
    //    destructuring with no annotation. This is what erased every declared
    //    prop of `ListViewProps`.
    const named = scan(
      'interface P { schema: XSchema; onRowClick?: (r: Record<string, unknown>) => void; [key: string]: any }\n' +
        'const C = React.forwardRef<H, P>(({ schema, ...props }, ref) => null);',
    );
    expect(named).toHaveLength(1);
    expect(named[0].indexSignatureOnTypeArg).toBe(true);
    expect(named[0].annotated).toBe(false);

    // 2. Props taken whole and forwarded — the shape the objectui#4422 guard's
    //    `schema`-destructuring heuristic cannot see. The sibling package's
    //    public `DashboardRenderer` is spelled exactly this way, so a guard
    //    blind to it would pass on a fully erased public component.
    const whole = scan(
      'interface P { schema: XSchema; [key: string]: any }\n' +
        'const C = React.forwardRef<H, P>((props, ref) => null);',
    );
    expect(whole).toHaveLength(1);
    expect(whole[0].destructures).toBe(false);
    expect(whole[0].indexSignatureOnTypeArg).toBe(true);

    // 3. Hidden one level further, behind a type alias and an intersection.
    const aliased = scan(
      'type Pass = { [key: string]: any };\n' +
        'type P = { schema: XSchema } & Pass;\n' +
        'const C = React.forwardRef<H, P>(({ schema }, ref) => null);',
    );
    expect(aliased[0].indexSignatureOnTypeArg).toBe(true);

    // 4. And the compliant shape must read as compliant: signature off the type
    //    argument, on the parameter annotation, so the spread still collects
    //    arbitrary keys while the declared props survive.
    const fixed = scan(
      'interface P { schema: XSchema; className?: string }\n' +
        'const C = React.forwardRef<H, P>(' +
        '({ schema, className, ...props }: P & { [key: string]: any }, ref) => null);',
    );
    expect(fixed).toHaveLength(1);
    expect(fixed[0].annotated).toBe(true);
    expect(fixed[0].indexSignatureOnTypeArg).toBe(false);

    // 5. A NUMBER index signature does not trigger the collapse (`keyof` still
    //    excludes the string `'ref'`), so it must not be reported.
    const numeric = scan(
      'const C = React.forwardRef<H, { schema: XSchema; [i: number]: any }>(({ schema }, ref) => null);',
    );
    expect(numeric[0].indexSignatureOnTypeArg).toBe(false);

    // 6. A props type IMPORTED from another file — `ListViewBlock`'s shape — is
    //    out of a source scan's reach, and this guard does not pretend
    //    otherwise: it reports nothing rather than reporting a false verdict.
    const imported = scan(
      "import type { P } from './ListView';\n" +
        'const C = React.forwardRef<H, P>((props, ref) => null);',
    );
    expect(imported).toEqual([]);
  });

  it('no forwardRef carries a string index signature on its props type argument', () => {
    // If this fails: take the `[key: string]: any` OFF the type argument. On it,
    // `PropsWithoutRef` collapses the props to the bare index signature, which
    // erases every declared property from the render function AND from every
    // JSX call site. Move it to the render function's parameter annotation if
    // the component really does forward arbitrary keys. Do not allowlist.
    const offenders = ALL_SITES.filter(s => s.indexSignatureOnTypeArg).map(rel);
    expect(offenders).toEqual([]);
  });

  it('every destructuring forwardRef annotates its props parameter', () => {
    // If this fails: annotate the render function's FIRST PARAMETER directly.
    // Without it the parameter's type comes from `PropsWithoutRef` of the type
    // argument, and every declared prop the render function reads is `any`.
    const offenders = ALL_SITES.filter(s => s.destructures && !s.annotated).map(rel);
    expect(offenders).toEqual([]);
  });
});
