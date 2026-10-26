/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4548 — the REPO-WIDE closure of the `forwardRef` prop-erasure family
 * (objectui#4422 / PR #4438, objectui#4528 / PR #4551), and the direction the
 * two per-package siblings recorded as blocked.
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
 * signature — every declared property is erased, on BOTH sides: the render
 * function reads its own props as `any`, and every JSX CALL SITE goes unchecked.
 * It is silent, because the props type is right there in the source and
 * `noImplicitAny` never fires — the `any` is supplied explicitly.
 *
 * ## Why this guard is repo-wide where its predecessors were per-package
 *
 * #4438's ratchet resolves its scan root as `packages/components/src`, and
 * #4551's two siblings theirs as their own package. Each could only see the
 * package it lived in, which is exactly how each successive offender survived.
 * Measured across every `packages/*` `src` at the time of writing: **219**
 * `forwardRef` sites own their props type, and exactly **one** carried the
 * erasure — `packages/react/src/SchemaRenderer.tsx`, the renderer loop itself,
 * which this card fixed. One offender, then zero: the population is small enough
 * and the rule uniform enough that a single repo-wide assertion is now the
 * honest shape.
 *
 * ## The detector, and the spelling that motivated it
 *
 * `SchemaRenderer` spelled its erasure `Record< string, any >`, not
 * `[key: string]: any`. Both predecessors' `hasStringIndexSignature` walks for a
 * `ts.isIndexSignatureDeclaration` member and resolves type references only
 * through types declared in the SAME file, so `localTypes.get('Record')` missed
 * — `Record` is a global mapped type — and the function returned `false`. Both
 * guards reported the site CLEAN, and every sweep's grep for
 * `[key: string]: any` missed it too. So this detector resolves, in addition:
 *
 *   * `Record< string, … >` by name plus its first type argument;
 *   * any mapped type whose key constraint is `string` (`{ [K in string]: … }`),
 *     so the hole cannot be reopened by hand-rolling what `Record` expands to.
 *
 * ## Scope: the forwardRef TYPE ARGUMENT only — this is deliberate
 *
 * This guard judges the props TYPE ARGUMENT, and never an export annotation.
 * The distinction is the whole point:
 *
 *   * an index signature on the TYPE ARGUMENT is an ACCIDENTAL ERASER — it is
 *     fed to `PropsWithoutRef`, whose `Omit` then deletes every declared prop.
 *     Nobody writing it intends that, and nothing reports it;
 *   * an index signature in an EXPORT ANNOTATION is a STATED CONTRACT. It is
 *     applied to the already-built component, so `PropsWithoutRef` never runs
 *     over it and nothing is erased. `SchemaRenderer` is exactly this case: it
 *     is the renderer loop, it forwards unread props to the component the schema
 *     names at runtime, and `packages/react/README.md` documents that. Closing
 *     it would state a false contract.
 *
 * So the fixed `SchemaRenderer` passes this guard on the merits, not by
 * exemption — there is no allowlist here, and adding one would be the wrong
 * repair for anything this catches.
 *
 * ## What is NOT swept here
 *
 * #4551's second assertion — "every destructuring forwardRef annotates its props
 * parameter" — stays PER-PACKAGE and is deliberately not lifted to this file.
 * Measured repo-wide it names **200** sites, overwhelmingly the shadcn/ui
 * primitives in `packages/components/src/ui/*` plus `plugin-timeline`. None of
 * those is erased: their type arguments carry no index signature at all, so
 * `PropsWithoutRef` takes its identity branch and their props are intact. There
 * the annotation is a style preference, not a correctness gate, and sweeping it
 * repo-wide would turn 200 non-defects red and bury the one assertion that does
 * name a defect.
 *
 * ## If this fails
 *
 * Take the index signature OFF the type argument. If the component really does
 * forward arbitrary keys, put it on the render function's parameter annotation
 * (so the runtime spread stays typed) and, when the open surface is part of the
 * component's contract, state it in an explicit export annotation the way
 * `SchemaRenderer` does. Do not add an allowlist, and do not delete a parameter
 * annotation to quiet the error — that silently untypes every prop the render
 * function reads.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
// scripts/__tests__  ->  <repo root>
const repoRoot = path.resolve(here, '..', '..');
const packagesRoot = path.join(repoRoot, 'packages');

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
  /** The props TYPE ARGUMENT syntactically carries a string index signature. */
  indexSignatureOnTypeArg: boolean;
  /** Which spelling matched — reported so a failure names the shape. */
  how: string | null;
}

/**
 * Does this type node carry a string index signature, in ANY of its spellings?
 * Resolves local aliases, intersections, unions, `Record< string, … >`, and
 * mapped types keyed by `string`.
 */
export function hasStringIndexSignature(
  node: ts.TypeNode | undefined,
  localTypes: Map<string, ts.Node>,
  seen = new Set<string>(),
): { hit: boolean; how: string | null } {
  if (!node) return { hit: false, how: null };
  let how: string | null = null;

  const members = (n: ts.Node): readonly ts.TypeElement[] | undefined =>
    ts.isTypeLiteralNode(n) || ts.isInterfaceDeclaration(n) ? n.members : undefined;

  const scan = (n: ts.Node): boolean => {
    const ms = members(n);
    if (ms) {
      for (const m of ms) {
        if (ts.isIndexSignatureDeclaration(m)) {
          const p = m.parameters[0];
          if (p?.type && p.type.kind === ts.SyntaxKind.StringKeyword) {
            how = 'index-signature';
            return true;
          }
        }
      }
      // an interface may inherit one
      if (ts.isInterfaceDeclaration(n) && n.heritageClauses) {
        for (const h of n.heritageClauses) {
          for (const t of h.types) {
            if (ts.isIdentifier(t.expression) && localTypes.has(t.expression.text)) {
              const name = t.expression.text;
              if (!seen.has(name)) {
                seen.add(name);
                if (scan(localTypes.get(name)!)) return true;
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
    // `{ [K in string]: … }` — what `Record< string, … >` expands to.
    if (ts.isMappedTypeNode(n)) {
      const constraint = n.typeParameter?.constraint;
      if (constraint && constraint.kind === ts.SyntaxKind.StringKeyword) {
        how = 'mapped-type';
        return true;
      }
      return false;
    }
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) {
      const name = n.typeName.text;
      // The global mapped type, which a local-declaration lookup cannot see.
      // This is the objectui#4548 spelling.
      if (name === 'Record') {
        const key = n.typeArguments?.[0];
        if (key && key.kind === ts.SyntaxKind.StringKeyword) {
          how = 'Record< string, … >';
          return true;
        }
        return false;
      }
      if (seen.has(name)) return false;
      seen.add(name);
      const decl = localTypes.get(name);
      return decl ? scan(decl) : false;
    }
    return false;
  };

  const hit = scan(node);
  return { hit, how };
}

/** Every `forwardRef(...)` whose props type argument this file can resolve. */
export function collectSitesFrom(file: string, text: string): Site[] {
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
        // literal, a named type declared here, or a bare global mapped type
        // (`Record< string, any >`) whose shape is fully readable from source.
        // A props type IMPORTED from elsewhere is out of a source scan's reach
        // and is covered where it is declared instead.
        let ownsProps = false;
        if (typeArg) {
          ownsProps =
            !ts.isTypeReferenceNode(typeArg) ||
            !ts.isIdentifier(typeArg.typeName) ||
            localTypes.has(typeArg.typeName.text) ||
            typeArg.typeName.text === 'Record';
        }
        const render = node.arguments[0];
        if (ownsProps && render && (ts.isArrowFunction(render) || ts.isFunctionExpression(render))) {
          const r = hasStringIndexSignature(typeArg, localTypes);
          sites.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            indexSignatureOnTypeArg: r.hit,
            how: r.how,
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

const ALL_SITES = readdirSync(packagesRoot, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .flatMap(d => {
    const src = path.join(packagesRoot, d.name, 'src');
    try {
      if (!statSync(src).isDirectory()) return [];
    } catch {
      return [];
    }
    return collectSourceFiles(src).flatMap(collectSites);
  });

const rel = (s: Site) => `${path.relative(repoRoot, s.file)}:${s.line}`;

describe('objectui#4548 — no forwardRef props type is erased, repo-wide', () => {
  it('finds the population (guards against a broken scan)', () => {
    // 219 sites at the time of writing. If this collapses, the walk or the AST
    // matcher has gone stale and the guard would silently pass on nothing.
    expect(ALL_SITES.length).toBeGreaterThanOrEqual(150);
  });

  it('detects every spelling it is meant to ban (guards against a dead matcher)', () => {
    const scan = (src: string): Site[] =>
      collectSitesFrom(path.join(packagesRoot, '__inmemory__.tsx'), src);

    // 1. objectui#4548's OWN pre-fix shape — the spelling both shipped guards
    //    report as CLEAN, and the reason this detector exists.
    const record = scan(
      'const C = React.forwardRef<any, { schema: SchemaNode } & Record<string, any>>' +
        '(({ schema, ...props }, _ref) => null);',
    );
    expect(record).toHaveLength(1);
    expect(record[0].indexSignatureOnTypeArg).toBe(true);
    expect(record[0].how).toBe('Record< string, … >');

    // 2. The classic literal spelling (objectui#4422 / #4528).
    const named = scan(
      'interface P { schema: XSchema; [key: string]: any }\n' +
        'const C = React.forwardRef<H, P>(({ schema, ...props }, ref) => null);',
    );
    expect(named).toHaveLength(1);
    expect(named[0].indexSignatureOnTypeArg).toBe(true);
    expect(named[0].how).toBe('index-signature');

    // 3. Hidden behind a local alias and an intersection.
    const aliased = scan(
      'type Pass = { [key: string]: any };\n' +
        'type P = { schema: XSchema } & Pass;\n' +
        'const C = React.forwardRef<H, P>(({ schema }, ref) => null);',
    );
    expect(aliased[0].indexSignatureOnTypeArg).toBe(true);

    // 4. `Record` behind a local alias — both extensions cooperating.
    const aliasedRecord = scan(
      'type P = { schema: XSchema } & Record<string, unknown>;\n' +
        'const C = React.forwardRef<H, P>((props, ref) => null);',
    );
    expect(aliasedRecord[0].indexSignatureOnTypeArg).toBe(true);
    expect(aliasedRecord[0].how).toBe('Record< string, … >');

    // 5. A hand-rolled mapped type — what `Record` expands to. The hole must
    //    not be reopenable by spelling it out.
    const mapped = scan(
      'type P = { [K in string]: any };\n' +
        'const C = React.forwardRef<H, P>((props, ref) => null);',
    );
    expect(mapped[0].indexSignatureOnTypeArg).toBe(true);
    expect(mapped[0].how).toBe('mapped-type');

    // 6. The COMPLIANT shape reads as compliant: signature off the type
    //    argument, on the parameter annotation, so the spread still collects
    //    arbitrary keys while the declared props survive.
    const fixed = scan(
      'interface P { schema: XSchema }\n' +
        'const C = React.forwardRef<H, P>(' +
        '({ schema, ...props }: P & { [key: string]: any }, ref) => null);',
    );
    expect(fixed).toHaveLength(1);
    expect(fixed[0].indexSignatureOnTypeArg).toBe(false);

    // 7. And so does SchemaRenderer's shipped shape: a clean type argument with
    //    the open surface stated in the EXPORT ANNOTATION, which this guard
    //    does not read (see the header — stated contract, not accidental
    //    eraser). This is the case that would be an allowlist entry if the
    //    claim were drawn any wider.
    const stated = scan(
      'interface P { schema: XSchema }\n' +
        'export const C: ForwardRefExoticComponent<P & Record<string, any> & RefAttributes<any>> =\n' +
        '  forwardRef<any, P>(({ schema, ...props }: P & Record<string, any>, _ref) => null);',
    );
    expect(stated).toHaveLength(1);
    expect(stated[0].indexSignatureOnTypeArg).toBe(false);

    // 8. `Record< number, … >` does NOT collapse (`keyof` still excludes the
    //    string `'ref'`), so it must not be reported.
    const numericRecord = scan(
      'const C = React.forwardRef<H, { schema: X } & Record<number, any>>(({ schema }, ref) => null);',
    );
    expect(numericRecord[0].indexSignatureOnTypeArg).toBe(false);

    // 9. Nor does a NUMBER index signature.
    const numeric = scan(
      'const C = React.forwardRef<H, { schema: X; [i: number]: any }>(({ schema }, ref) => null);',
    );
    expect(numeric[0].indexSignatureOnTypeArg).toBe(false);

    // 10. A props type IMPORTED from another file is out of a source scan's
    //     reach, and this guard does not pretend otherwise: it reports nothing
    //     rather than a false verdict.
    const imported = scan(
      "import type { P } from './Other';\n" +
        'const C = React.forwardRef<H, P>((props, ref) => null);',
    );
    expect(imported).toEqual([]);
  });

  it('no forwardRef carries a string index signature on its props type argument', () => {
    // If this fails: read the header. Take the signature OFF the type argument —
    // on it, `PropsWithoutRef` collapses the props to the bare index signature,
    // erasing every declared property from the render function AND from every
    // JSX call site. Do not allowlist.
    const offenders = ALL_SITES.filter(s => s.indexSignatureOnTypeArg).map(
      s => `${rel(s)} [${s.how}]`,
    );
    expect(offenders).toEqual([]);
  });
});
