/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `EmptyDescription`'s props name the element it renders (objectui#8571).
 *
 * ## What was wrong
 *
 * `EmptyDescription` declared `React.ComponentProps<"p">` and rendered a
 * `div` — verbatim from upstream shadcn's `empty.tsx`, in this tree since
 * b1fd1a80f. Every sibling in the family declares the tag it ships. The ruled
 * repair is the TYPE: `React.ComponentProps<"div">`. ⛔ Not the element — a
 * `p` cannot hold block content, so making this a real paragraph is a
 * rendered-output change at every call site and its own card, with its own
 * call-site census. The last `it` below pins that ruling.
 *
 * ## Why the instrument is a SOURCE pin — measured, not predicted
 *
 * The card expected `type-check` to be the instrument. It is not. Four legs
 * were run through one narrow test program each (TypeScript 6.0.3,
 * @types/react 19.2.18): `"p"`, `"div"`, `"div" & "p"`, `any`.
 *
 *   * `Equal<ComponentProps<'div'>, ComponentProps<'p'>>` is TRUE. lib.dom
 *     declares `HTMLDivElement` and `HTMLParagraphElement` with the same
 *     members (a deprecated `align` plus the listener overloads), so under
 *     TypeScript's structural identity they are one type — and so are the two
 *     props types, and even their intersection. Identity, mutual
 *     assignability, a `p`-typed ref, `currentTarget`: every type-level
 *     assertion read the same on the first three legs. Only `any` moved.
 *   * There is no `div`-only prop to accept: `HTMLAttributes<T>` is one
 *     interface for every element, `keyof` identical.
 *
 * So `"p"` → `"div"` is invisible to `tsc`, and to vitest through the
 * component alone. What sees it is the SOURCE: the string literal in the
 * annotation against the tag of the returned JSX, read with the compiler's
 * parser, tied to the DOM by rendering each member and reading `tagName`.
 *
 * ## The caricatures, and which pin refuses each
 *
 *   * `ComponentProps<"div"> & ComponentProps<"p">` — identical to the fix for
 *     `tsc`; the source pin refuses it, because a member names exactly ONE
 *     intrinsic.
 *   * `any` / no annotation — the source pin refuses it (the member drops out
 *     of the judged population while the family enumeration requires it), and
 *     so does the type half (`IsAny`, identity, and the nonsense prop becoming
 *     accepted so its `@ts-expect-error` goes unused: TS2578).
 *
 * ## Scope of the sweep
 *
 * Every function component under `src/custom/` whose single parameter's
 * annotation names `React.ComponentProps<"TAG">` and whose root return is an
 * intrinsic JSX element. A root that is a variable (`Comp` for `asChild`) or
 * a component (`Separator`) is outside a syntactic reading and not claimed.
 * The offender left standing is ledgered with its card; the ledger is a
 * ratchet, not an allowlist — fix the file and delete the line.
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { render } from '@testing-library/react';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyValue,
} from '../custom/empty';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/components/src/__tests__  ->  packages/components/src/custom
const customDir = path.resolve(here, '../custom');

/** One function component, reduced to the two facts this guard compares. */
interface Member {
  /** Path relative to `src/custom/`. */
  file: string;
  name: string;
  /** Every `React.ComponentProps<"TAG">` literal in the parameter annotation, in source order. */
  declared: string[];
  /** The tag of the root JSX element the function returns; `null` when that root is not an intrinsic element. */
  rendered: string | null;
}

/** The intrinsic literal inside `React.ComponentProps<"TAG">` (or bare `ComponentProps<"TAG">`), if this node is one. */
function componentPropsLiteral(node: ts.Node, sf: ts.SourceFile): string | null {
  if (!ts.isTypeReferenceNode(node) || node.typeArguments?.length !== 1) return null;
  const name = node.typeName.getText(sf);
  if (name !== 'React.ComponentProps' && name !== 'ComponentProps') return null;
  const arg = node.typeArguments[0];
  return ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal) ? arg.literal.text : null;
}

/** The tag of the root JSX element in the first `return` of `body`, `null` if it is not an intrinsic element. */
function rootIntrinsicTag(body: ts.Block): string | null {
  let found: string | null = null;
  let seen = false;
  const visit = (n: ts.Node): void => {
    if (seen) return;
    if (ts.isFunctionLike(n)) return; // a nested function's return is not this component's
    if (ts.isReturnStatement(n)) {
      seen = true;
      let e = n.expression;
      while (e && ts.isParenthesizedExpression(e)) e = e.expression;
      const tag = e && ts.isJsxElement(e) ? e.openingElement.tagName : e && ts.isJsxSelfClosingElement(e) ? e.tagName : null;
      if (tag && ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) found = tag.text;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** Every function component in `text` that annotates its single parameter, as the two facts. */
function readMembers(file: string, text: string): Member[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Member[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body && node.parameters.length === 1) {
      const annotation = node.parameters[0].type;
      if (annotation) {
        const declared: string[] = [];
        const walk = (t: ts.Node): void => {
          const lit = componentPropsLiteral(t, sf);
          if (lit !== null) declared.push(lit);
          ts.forEachChild(t, walk);
        };
        walk(annotation);
        out.push({ file, name: node.name.text, declared, rendered: rootIntrinsicTag(node.body) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A member this guard can judge: names at least one intrinsic AND returns one. */
const judged = (m: Member): boolean => m.declared.length > 0 && m.rendered !== null;
/** `true` when the one intrinsic named is the one returned. */
const agrees = (m: Member): boolean => m.declared.length === 1 && m.declared[0] === m.rendered;
const key = (m: Member): string => `${m.file}:${m.name}`;
const shape = (m: Member): string => `${m.declared.join(' & ')} -> ${m.rendered}`;

function collectCustomSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry.name) && !/\.(test|spec)\.tsx$/.test(entry.name)) {
        out.push({ file: path.relative(customDir, full), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(customDir);
  return out;
}

const ALL_MEMBERS = collectCustomSources().flatMap(({ file, text }) => readMembers(file, text));
const FAMILY = ['Empty', 'EmptyHeader', 'EmptyMedia', 'EmptyTitle', 'EmptyDescription', 'EmptyContent', 'EmptyValue'] as const;
const familyMember = (name: (typeof FAMILY)[number]): Member | undefined =>
  ALL_MEMBERS.find((m) => m.file === 'empty.tsx' && m.name === name);

/**
 * Members whose declaration and element still disagree, each with the card
 * that owns the decision. A ratchet: fixing one means deleting its line, and a
 * NEW disagreement anywhere under `custom/` fails regardless of this list.
 */
const LEDGER: Record<string, string> = {
  // Empty. The one entry this ledger ever carried — `kbd.tsx:KbdGroup`, which
  // declared "div" and returned a `kbd` — was retired by objectui#8576, which
  // ruled the TYPE moves (`React.ComponentProps<"kbd">`) and pinned the result
  // in `kbd-group-props-name-the-element-8576.test.tsx`. An empty ledger is the
  // ratchet at its floor: any disagreement under `custom/` now fails outright.
};

describe('objectui#8571 — the declared intrinsic is the rendered one, across src/custom', () => {
  it('detects the shapes it judges (guards against a dead matcher)', () => {
    const one = (src: string): Member => {
      const members = readMembers('__inmemory__.tsx', src);
      expect(members).toHaveLength(1);
      return members[0];
    };
    // 1. The exact pre-fix shape: a paragraph promised, a division shipped.
    const defect = one('function D({ className, ...props }: React.ComponentProps<"p">) { return (<div className={className} {...props} />) }');
    expect(judged(defect)).toBe(true);
    expect(agrees(defect)).toBe(false);
    expect(shape(defect)).toBe('p -> div');
    // 2. The fix reads as agreement, through the parenthesised multi-line return the file uses.
    const fixed = one('function D({ className, ...props }: React.ComponentProps<"div">) {\n  return (\n    <div\n      data-slot="x"\n      {...props}\n    />\n  )\n}');
    expect(judged(fixed) && agrees(fixed)).toBe(true);
    // 3. The intersection caricature names two intrinsics: judged, and refused.
    const widened = one('function D(p: React.ComponentProps<"div"> & React.ComponentProps<"p">) { return <div {...p} /> }');
    expect(judged(widened)).toBe(true);
    expect(agrees(widened)).toBe(false);
    expect(shape(widened)).toBe('div & p -> div');
    // 4. `any` names no intrinsic: it leaves the judged population (the family enumeration catches that).
    const erased = one('function D(p: any) { return <div {...p} /> }');
    expect(judged(erased)).toBe(false);
    // 5. A variance intersection still reads its one intrinsic (EmptyMedia's shape).
    const variant = one('function D({ variant, ...p }: React.ComponentProps<"div"> & VariantProps<typeof v>) { return <div {...p} /> }');
    expect(agrees(variant)).toBe(true);
    // 6. A root that is not an intrinsic element is not claimed.
    const dynamic = one('function D({ asChild, ...p }: React.ComponentProps<"div"> & { asChild?: boolean }) { const Comp = asChild ? Slot : "div"; return <Comp {...p} /> }');
    expect(judged(dynamic)).toBe(false);
    // 7. The bare spelling is read too.
    const bare = one('function D(p: ComponentProps<"span">) { return <span {...p} /> }');
    expect(agrees(bare)).toBe(true);
  });

  it('finds the population (guards against a broken walk)', () => {
    // 17 agreeing members plus the ledger at the time of writing; the floor is
    // loose so adding or removing one wrapper does not fail the wrong assertion.
    expect(ALL_MEMBERS.filter(judged).length).toBeGreaterThanOrEqual(12);
  });

  it('every judged member under src/custom names the intrinsic it returns, except the ledgered cards', () => {
    // If this fails on a NEW line: make the annotation name the element that
    // ships (this card's direction), or open the card that rules otherwise —
    // do not extend the ledger without one. If it fails on a ledgered line
    // that is now fixed: delete the line; that is the ratchet turning.
    const disagreeing = Object.fromEntries(
      ALL_MEMBERS.filter((m) => judged(m) && !agrees(m)).map((m) => [key(m), shape(m)]),
    );
    expect(disagreeing).toEqual(LEDGER);
  });
});

describe('objectui#8571 — the Empty family, member by member', () => {
  it('every member names exactly one intrinsic and returns it (source)', () => {
    for (const name of FAMILY) {
      const m = familyMember(name);
      expect(m, `${name} is a judged member of empty.tsx`).toBeDefined();
      expect(judged(m!), `${name} names an intrinsic and returns one`).toBe(true);
      expect(shape(m!), name).toBe(`${m!.rendered} -> ${m!.rendered}`);
    }
  });

  it('the element each member puts in the DOM is the one its source names (render)', () => {
    // Ties the syntactic reading to the real DOM: a member whose root tag the
    // parser misread would disagree with what actually renders.
    const rendered: Array<[(typeof FAMILY)[number], React.ReactElement]> = [
      ['Empty', <Empty />],
      ['EmptyHeader', <EmptyHeader />],
      ['EmptyMedia', <EmptyMedia />],
      ['EmptyTitle', <EmptyTitle />],
      ['EmptyDescription', <EmptyDescription />],
      ['EmptyContent', <EmptyContent />],
      ['EmptyValue', <EmptyValue />],
    ];
    for (const [name, element] of rendered) {
      const { container, unmount } = render(element);
      const root = container.firstElementChild;
      expect(root, `${name} renders one root element`).not.toBeNull();
      expect(root!.tagName.toLowerCase(), name).toBe(familyMember(name)!.declared[0]);
      unmount();
    }
  });

  it('EmptyDescription stays a div — the element was ruled, not just the type', () => {
    // objectui#8571 ruled option 1 (type follows element). A real `p` is a
    // rendered-output change at every call site, and `p` cannot hold block
    // content; that is a different card with its own census, and it updates
    // this pin deliberately. It does not arrive as a "tidy-up".
    const { container } = render(<EmptyDescription>text</EmptyDescription>);
    expect(container.firstElementChild!.tagName).toBe('DIV');
    expect(container.firstElementChild!.getAttribute('data-slot')).toBe('empty-description');
  });

  it('the type half: each member declares the props of the element it ships, and nothing is `any`', () => {
    // Checked by `tsc -p tsconfig.test.json` (the package `type-check` script),
    // erased here. Measured on objectui#8571: these CANNOT tell "p" from "div"
    // (see the header) — they refuse the `any` / erasure caricature and spell
    // the contract a consumer reads off the `.d.ts`, no more.
    type Assert<T extends true> = T;
    type Extends<A, B> = [A] extends [B] ? true : false;
    type IsAny<T> = 0 extends 1 & T ? true : false;
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
    type Div = React.ComponentProps<'div'>;
    type MediaLike = Div & { variant?: 'default' | 'icon' | null };

    type _Empty = Assert<Equal<React.ComponentProps<typeof Empty>, Div>>;
    type _Header = Assert<Equal<React.ComponentProps<typeof EmptyHeader>, Div>>;
    type _Title = Assert<Equal<React.ComponentProps<typeof EmptyTitle>, Div>>;
    type _Description = Assert<Equal<React.ComponentProps<typeof EmptyDescription>, Div>>;
    type _Content = Assert<Equal<React.ComponentProps<typeof EmptyContent>, Div>>;
    type _MediaIn = Assert<Extends<React.ComponentProps<typeof EmptyMedia>, MediaLike>>;
    type _MediaOut = Assert<Extends<MediaLike, React.ComponentProps<typeof EmptyMedia>>>;
    type _Value = Assert<Equal<React.ComponentProps<typeof EmptyValue>, React.ComponentProps<'span'> & { glyph?: string }>>;
    type _NotAny = Assert<Equal<IsAny<React.ComponentProps<typeof EmptyDescription>>, false>>;

    const accepted = <EmptyDescription data-testid="d" className="c" />;
    const refused = (
      // @ts-expect-error a prop no element has stays refused — under the `any` caricature this directive goes unused (TS2578)
      <EmptyDescription nonsenseProp="x" />
    );
    expect(React.isValidElement(accepted) && React.isValidElement(refused)).toBe(true);
  });
});
