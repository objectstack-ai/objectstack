/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8253 — `ObjectViewProps.views[n].tree` is DECLARED, so a host that
 * composes the entry gets a compile error instead of a silently dropped key.
 *
 * ## Which direction this declaration moves, measured rather than asserted
 *
 * The views entry closes with `[key: string]: any`. On a face like that a
 * declaration CANNOT widen — every spelling was already admitted, so no value
 * that used to be refused becomes accepted. It can only NARROW, by putting
 * validation where there was none. That is what happens here, and the two pins
 * below measure both halves of it:
 *
 *   - the LEG THAT NARROWS — a misspelled key inside `tree` is now an
 *     excess-property error on a host's object literal;
 *   - the LEG THAT DOES NOT MOVE — every OTHER undeclared key on the entry is
 *     still admitted through the index signature, exactly as before. Without
 *     this second leg "it narrows" would be indistinguishable from "the index
 *     signature was removed", which would be a breaking change to every host.
 *
 * ⚠️ Reach, stated because a pin that overclaims is worse than none. The
 * console's own call site does NOT receive this diagnostic today:
 * `app-shell/src/views/ObjectView.tsx` builds `mergedViews` as
 * `views.map((v: any) => …)` over STORED view records, so it arrives typed
 * `any[]` and nothing here reports on it. The diagnostic reaches a host that
 * writes the entry inline against this prop's declared type. Typing the
 * stored-record path is an app-shell change and was recorded, ⛔ not smuggled
 * into this card.
 *
 * ## `@object-ui/types`, not a relative path
 *
 * This package's `tsconfig.test.json` sets `"paths": {}`, so the specifier
 * resolves through the workspace dependency's `exports` map to
 * `packages/types/dist/index.d.ts` — the surface a published consumer sees.
 * ⚠️ `@object-ui/types` must therefore be BUILT for this file to mean anything.
 */

import { describe, it, expect } from 'vitest';
import type { TreeViewConfig } from '@object-ui/types';
import type { ObjectViewProps } from '../ObjectView';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

/** One element of the `views` prop — the shape a host composes. */
type ViewEntry = NonNullable<ObjectViewProps['views']>[number];

describe('objectui#8253 — the views entry declares its `tree` block', () => {
  it('is pinned at compile time', () => {
    // Non-vacuity: before this card `tree` resolved to `any` through the index
    // signature, and `any` satisfies every assignability pin below. This line
    // is what tells the two apart, and it is the line that would have failed
    // on the parent commit.
    type _TreeIsNotAny = Assert<Equal<IsAny<ViewEntry['tree']>, false>>;

    // ⛔ One declaration, not two: the entry's `tree` IS the exported type.
    // A structurally-equal local twin would pass an `extends` check, so this
    // is pinned as invariant equality.
    type _SameDeclaration = Assert<Equal<ViewEntry['tree'], TreeViewConfig | undefined>>;

    expect(true).toBe(true);
  });

  it('NARROWS: a misspelled key inside `tree` is now a compile error', () => {
    // The class-(c) defect in its original spelling — the console user writes
    // `parentFeild`, the block is stored, nothing reads it, nothing says so.
    // ⚠️ The directive must be the LAST comment line before the property.
    const composed: ViewEntry = {
      id: 'tree',
      label: 'Hierarchy',
      type: 'tree',
      tree: {
        // @ts-expect-error objectui#8253 — an undeclared key on the tree block is refused.
        parentFeild: 'parent',
      },
    };

    expect(composed.type).toBe('tree');
  });

  it('DOES NOT WIDEN OR BREAK: an undeclared key elsewhere on the entry is still admitted', () => {
    // The control leg. The index signature is untouched, so a host's own
    // bookkeeping key on the ENTRY still type-checks. If this line ever starts
    // failing, the change stopped being a narrowing of one key and became a
    // breaking change to every host that composes `views`.
    const withHostKey: ViewEntry = {
      id: 'tree',
      label: 'Hierarchy',
      type: 'tree',
      someHostBookkeepingKey: { anything: true },
    };

    expect(withHostKey.someHostBookkeepingKey).toEqual({ anything: true });
  });

  it('accepts every declared key, so the refusal above is about spelling', () => {
    const full: ViewEntry = {
      id: 'tree',
      label: 'Hierarchy',
      type: 'tree',
      tree: {
        parentField: 'parent',
        labelField: 'name',
        fields: ['name', 'manager'],
        defaultExpandedDepth: 1,
      },
    };

    expect(full.tree).toMatchObject({ parentField: 'parent', defaultExpandedDepth: 1 });
  });

  it('REFUSES `titleField` — the key the protocol rejects on `ListView.tree` (objectui#8841)', () => {
    // objectui#8253 declared `titleField` on this block; `@objectstack/spec@17.4.0`
    // REFUSES it there by name (`TreeConfigSchema` is a `strictObject` since spec
    // #15469). So the declaration accepted what the contract rejects, and a host
    // that followed this prop's type was refused at publish. objectui#8841
    // re-derives the block from the spec, which removes the key.
    //
    // This is the diagnostic that MOVED, and it is the point of the card: the
    // host writing the entry inline now learns at compile time what it used to
    // learn from a parse failure at publish.
    // ⚠️ The directive must be the LAST comment line before the property.
    const composed: ViewEntry = {
      id: 'tree',
      label: 'Hierarchy',
      type: 'tree',
      tree: {
        // @ts-expect-error objectui#8841 — spec 17.4.0 refuses `tree.titleField`; the block no longer declares it.
        titleField: 'subject',
      },
    };

    expect(composed.type).toBe('tree');
  });
});
