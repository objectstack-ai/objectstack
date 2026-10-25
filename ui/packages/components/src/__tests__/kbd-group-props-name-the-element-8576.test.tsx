/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `KbdGroup`'s props name the element it renders (objectui#8576).
 *
 * ## What was wrong
 *
 * `KbdGroup` declared `React.ComponentProps<"div">` and returned a `kbd` —
 * upstream shadcn's shape too. objectui#8571 repaired the same class of defect
 * on `EmptyDescription`; this file exists because the two are NOT the same
 * measurement, and assuming they were is exactly what this card was filed to
 * stop.
 *
 * ## The measurement: `div` vs `kbd` DIFFER, where `div` vs `p` did not
 *
 * Measured in this tree (TypeScript 6.0.3, `@types/react` 19.2.18), every leg
 * through one narrow program:
 *
 *   * `Equal<ComponentProps<'div'>, ComponentProps<'kbd'>>` is FALSE.
 *   * Positive control in the SAME program:
 *     `Equal<ComponentProps<'div'>, ComponentProps<'p'>>` is TRUE — objectui#8571's
 *     reading reproduced, so the FALSE above is a measurement and not a broken
 *     `Equal`.
 *   * The difference is carried entirely by the ELEMENT type parameter, not by
 *     the prop names: `keyof` of the two props types is identical
 *     (`HTMLAttributes<T>` is one interface for every element), and the only
 *     member `HTMLDivElement` adds over `HTMLElement` is the deprecated
 *     `align`. What actually moves is `ref` and `currentTarget`.
 *
 * ⇒ Unlike objectui#8571, `tsc` IS a discriminating instrument here, so both
 * halves are pinned below: the TYPE half (erased at runtime — checked by
 * `tsc -p tsconfig.test.json`, which the package `type-check` script chains and
 * CI's `Type Check` job runs) and the DOM half (`tagName` after a real render).
 * The SOURCE half — the annotation's literal must equal the returned intrinsic
 * tag — is the class-wide sweep in
 * `empty-description-props-name-the-element-8571.test.tsx`, whose `LEDGER`
 * carried `'kbd.tsx:KbdGroup': 'div -> kbd'` until this card deleted it. That
 * deletion was exercised before the repair: with the line gone and the
 * declaration still `"div"`, the sweep failed on
 * `every judged member under src/custom names the intrinsic it returns, except
 * the ledgered cards`.
 *
 * ## The ruling: the TYPE moves, not the element
 *
 * `kbd` is what ships, what upstream shadcn ships, and a `kbd` grouping `kbd`s
 * is legal HTML. Making the element follow the declaration would change the DOM
 * every existing consumer already receives, and drop the semantics the element
 * was presumably chosen for. So the half that was lying is the half that moved.
 *
 * ## Why this cannot break a caller — the census that licensed the direction
 *
 * Tree-wide census: `KbdGroup` had no call site in this repository at all, only
 * its own definition and the `export *` barrel. For consumers of the published
 * package the props type WIDENS, so nothing that compiled stops compiling:
 * `ComponentProps<'div'>` is assignable to `ComponentProps<'kbd'>` and the
 * reverse is not (measured), and a `div`-typed ref is still accepted — pinned
 * in the last case below, together with the fact that such a ref now receives a
 * `kbd`, which is the honest consequence of the widening rather than a defect.
 *
 * ## The caricature, and which pin refuses it
 *
 * Widening the props to `ComponentProps<'div'> & ComponentProps<'kbd'>` (or to
 * `any`) makes the mismatch vanish by deleting the constraint. On objectui#8571
 * that caricature was INVISIBLE to `tsc`, because all three types were one
 * type; here it is not — the intersection is identical to neither side
 * (measured) — so the identity assertion below refuses it, and the source pin
 * next door refuses it independently (a judged member names exactly ONE
 * intrinsic).
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render } from '@testing-library/react';
import { Kbd, KbdGroup } from '../custom/kbd';

describe('objectui#8576 — KbdGroup declares the element it renders', () => {
  it('puts a kbd in the DOM, and so does its sibling Kbd (render)', () => {
    // The DOM half. `Kbd` is the control: it already agreed with its
    // declaration before this card and must read the same in both worlds, so a
    // failure here that takes both members with it is a broken harness, not
    // this defect.
    const group = render(
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
      </KbdGroup>,
    );
    const root = group.container.firstElementChild;
    expect(root, 'KbdGroup renders one root element').not.toBeNull();
    expect(root!.tagName).toBe('KBD');
    expect(root!.getAttribute('data-slot')).toBe('kbd-group');
    expect(root!.firstElementChild!.tagName).toBe('KBD');
    expect(root!.firstElementChild!.getAttribute('data-slot')).toBe('kbd');
    group.unmount();
  });

  it('the type half: the props are the `kbd` props, and are NOT the `div` props', () => {
    // Erased at runtime — `tsc -p tsconfig.test.json` is what checks these.
    // Every assertion here MOVED when measured against the pre-fix
    // declaration, which is what makes `tsc` an instrument on this card and
    // not on objectui#8571.
    type Assert<T extends true> = T;
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
    type IsAny<T> = 0 extends 1 & T ? true : false;
    type KbdProps = React.ComponentProps<'kbd'>;
    type DivProps = React.ComponentProps<'div'>;
    type GroupProps = React.ComponentProps<typeof KbdGroup>;

    type _Group = Assert<Equal<GroupProps, KbdProps>>;
    // The pre-fix declaration, refused by name.
    type _GroupIsNotDiv = Assert<Equal<Equal<GroupProps, DivProps>, false>>;
    // The caricature, refused by name: on this card the intersection is a
    // third type, so it cannot pass the identity above.
    type _GroupIsNotWidened = Assert<Equal<Equal<GroupProps, DivProps & KbdProps>, false>>;
    // The erasure caricature.
    type _GroupIsNotAny = Assert<Equal<IsAny<GroupProps>, false>>;
    // The sibling control: correct before this card, unchanged by it.
    type _Kbd = Assert<Equal<React.ComponentProps<typeof Kbd>, KbdProps>>;
    // The two props types name the same PROPS; only the element type moved.
    type _SamePropNames = Assert<Equal<keyof DivProps, keyof KbdProps>>;

    const accepted = <KbdGroup className="c" data-testid="g" />;
    const refused = (
      // @ts-expect-error a prop no element has stays refused — under the `any` caricature this directive goes unused (TS2578)
      <KbdGroup nonsenseProp="x" />
    );
    expect(React.isValidElement(accepted) && React.isValidElement(refused)).toBe(true);
  });

  it('a `div`-typed ref still compiles, and receives the `kbd` that ships', () => {
    // The census leg, both halves. Type: a caller who declared
    // `useRef<HTMLDivElement>` keeps compiling, because `Ref` is read-covariant
    // and `RefObject<HTMLDivElement | null>` is assignable to the new props'
    // ref (measured). Runtime: what that ref receives is the `kbd` — the
    // element this component has always rendered. The widening is what makes
    // the declaration honest; it does not make the DOM lie.
    type Assert<T extends true> = T;
    type Extends<A, B> = [A] extends [B] ? true : false;
    type KbdRef = NonNullable<React.ComponentProps<'kbd'>['ref']>;
    type _RefObject = Assert<Extends<React.RefObject<HTMLDivElement | null>, KbdRef>>;
    type _RefCallback = Assert<Extends<(el: HTMLDivElement | null) => void, KbdRef>>;

    const divTypedRef = React.createRef<HTMLDivElement>();
    const { unmount } = render(<KbdGroup ref={divTypedRef} />);
    expect(divTypedRef.current).not.toBeNull();
    expect(divTypedRef.current!.tagName).toBe('KBD');
    unmount();
  });
});
