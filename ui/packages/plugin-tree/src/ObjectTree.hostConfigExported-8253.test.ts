/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8253 — the host `tree` view config is EXPORTED, and this file is
 * what stops the next refactor un-exporting it in silence.
 *
 * ## What was wrong
 *
 * `tree` is a host-composition-only view type (objectui#5321, ruling B): it is
 * on neither authored union, so the branch runs only when a host passes a
 * `views` prop. On that path a per-view `tree` block is read — and its only
 * description anywhere was the module-local, non-exported `interface TreeConfig`
 * in `ObjectTree.tsx`. The live host is the console: it stores view records and
 * passes them as `views`, and its create-view dialog offers `tree`. So a real
 * consumer wrote this block with no type to write it against, and a misspelled
 * `parentFeild` was admitted by the views entry's `[key: string]: any`, read by
 * nobody, and reported by nothing. Declared ≠ enforced, class (c).
 *
 * Ruled on objectui#8253 (director seat, decision batch #78, 2026-09-07,
 * maintainer 「同意」), option (a): `packages/types` exports the config, the
 * module-local copy becomes an import of it, and ⛔ there is no second copy.
 *
 * ## What objectui#8841 changed here
 *
 * objectui#8253 shipped that export as a hand-written interface — a copy of the
 * protocol's `ListView.tree` block under a second name — and the copy declared a
 * fifth key, `titleField`, that `@objectstack/spec@17.4.0` REFUSES there. The
 * pins in this file did not catch it because the census was a LITERAL KEY LIST
 * maintained beside the type: the list was written to match the drift, so it
 * agreed with the defect. objectui#8841 re-derives the type from the protocol
 * and re-pins the census as PARITY WITH THE PROTOCOL — plus a runtime leg that
 * reads the installed `TreeConfigSchema` by content, because a compile-time pin
 * on a derived alias can only restate its own derivation.
 *
 * ## Why the import below says `@object-ui/types` and not `../../types/src`
 *
 * This is the load-bearing part of the pin, not a style choice. This package's
 * `tsconfig.test.json` sets `"paths": {}` precisely so `@object-ui/*` resolves
 * through the WORKSPACE DEPENDENCY rather than through the root tsconfig's
 * source-tree mapping — so the specifier below is resolved the way a published
 * consumer resolves it: `packages/types/package.json` `exports["."].types` →
 * `dist/index.d.ts`. A pin that imported `'../../types/src/views'` would never
 * touch `dist` or the `exports` map and would stay green through a barrel that
 * had stopped re-exporting the name, or an `exports` map that had stopped
 * publishing the entry. This one goes red for both.
 *
 * ⚠️ Consequence, and it is deliberate: `@object-ui/types` must be BUILT before
 * `pnpm --filter @object-ui/plugin-tree type-check` means anything. A stale
 * `dist/*.d.ts` lies in both directions.
 *
 * ## The assertions are compile-time; vitest alone would not catch a broken pin
 *
 * Same mechanism as `types/src/__tests__/drill-down-config-declared-keys.test.ts`:
 * `tsconfig.json` excludes tests (they must not emit into `dist`) and
 * `tsconfig.test.json` picks them back up, chained off the package's
 * `type-check` script. Vitest strips types without checking them. The runtime
 * `expect` at the foot of each type-level case is a marker, ⛔ never the pin.
 */

import { describe, it, expect } from 'vitest';

// Through the PACKAGE ENTRY — see the header. ⛔ Do not relax this to a
// relative path into `packages/types/src`.
import type { TreeViewConfig } from '@object-ui/types';

// The PROTOCOL's own declaration of this block, imported for the parity pins
// below (objectui#8841). `@object-ui/types` derives `TreeViewConfig` from
// `ListView['tree']`, so this import is the other end of that derivation and
// the only thing a census can honestly be total over.
import { TreeConfigSchema } from '@objectstack/spec/ui';
import type { ListView as SpecListView } from '@objectstack/spec/ui';

/** The protocol's `ListView.tree` block. */
type SpecTreeConfig = NonNullable<SpecListView['tree']>;

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('objectui#8253/#8841 — TreeViewConfig is the protocol\'s block, reachable through @object-ui/types', () => {
  it('is pinned at compile time', () => {
    // Non-vacuity. `keyof any` is `string | number | symbol`, and every
    // `Equal<…>` below would report whatever an `any` made convenient. If the
    // import ever resolves to `any` — a broken export map degrades exactly
    // this way — this line fails FIRST and names the reason.
    type _ConfigIsReal = Assert<Equal<IsAny<TreeViewConfig>, false>>;
    type _SpecConfigIsReal = Assert<Equal<IsAny<SpecTreeConfig>, false>>;

    // ⭐ THE CENSUS, and objectui#8841 changed what it is made of. It used to be
    // a LITERAL key list maintained here by hand — and a hand-maintained list
    // is exactly what let `titleField` through: the list was updated to match
    // the drift, so the pin agreed with the defect and stayed green while the
    // published type accepted a key `@objectstack/spec@17.4.0` refuses on
    // `ListView.tree`. A census can only be total over something it does not
    // also author.
    //
    // So it is PARITY WITH THE PROTOCOL now. Structural equality, not `extends`:
    // a hand-written twin passes an assignability check in both directions and
    // would defeat the derivation entirely.
    type _ParityWithSpec = Assert<Equal<TreeViewConfig, SpecTreeConfig>>;

    // FIRING CONTROL for the line above. An `Equal<…>` loosened until it cannot
    // report `false` reads exactly like one that still works. This feeds it the
    // near-miss that actually shipped — the spec's block plus `titleField` — and
    // requires it to say `false`.
    type _ParityCanFail = Assert<Equal<Equal<TreeViewConfig, SpecTreeConfig & { titleField?: string }>, false>>;

    // The defect, pinned by name so its return is reported as itself rather
    // than as an anonymous parity failure.
    type _TitleFieldIsGone = Assert<Equal<'titleField' extends keyof TreeViewConfig ? true : false, false>>;

    // ⛔ No index signature. This does NOT fall out of parity above: were the
    // protocol's block `.passthrough()` again (it was, at 17.3.0), both sides
    // would carry `[key: string]: unknown` and parity would still hold while
    // every misspelling became assignable again. This line is what pins the
    // STRICTNESS the card depends on, and it is the line that fires if the
    // resolved `@objectstack/spec` ever predates 17.4.0, the release that closed it.
    type _NoIndexSignature = Assert<Equal<string extends keyof TreeViewConfig ? true : false, false>>;

    // Every key is optional: a host writes the subset it means. `Partial<T>`
    // is structurally identical to `T` only when nothing is required.
    type _AllOptional = Assert<Equal<TreeViewConfig, Partial<TreeViewConfig>>>;

    expect(true).toBe(true);
  });

  it('parity is a measurement, not a tautology: the protocol\'s RUNTIME shape agrees', () => {
    // The type-level pins above are all compile-time, and a compile-time pin on
    // a derived alias can only ever restate the derivation. This is the leg that
    // reads the installed artifact instead: the same `TreeConfigSchema` the
    // publisher parses against, by content.
    //
    // ⛔ Deliberately NOT a literal key-set equality. Freezing the protocol's
    // key list here would make a benign spec addition red in objectui and would
    // put a second hand-maintained list back in the file this card emptied. What
    // is pinned is the DEFECT and the INSTRUMENT, not the census.
    const keys = Object.keys(TreeConfigSchema.shape);
    expect(keys).not.toContain('titleField');

    // FIRING CONTROL for the line above, same instrument: a key the protocol
    // DOES declare is found, so the zero is a reading about `titleField` and
    // not about an empty shape or an import that resolved to a stub.
    expect(keys).toContain('parentField');

    // FIRING CONTROL — the schema accepts what it declares, so the refusal
    // below is a statement about the KEY and not about a schema that refuses
    // everything.
    expect(TreeConfigSchema.safeParse({ parentField: 'parent_id' }).success).toBe(true);

    // The refusal the card was filed for, taken from the protocol itself.
    const refused = TreeConfigSchema.safeParse({ titleField: 'name' });
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('titleField');
  });

  it('refuses the misspelling the card was filed for, at compile time', () => {
    // ⭐ A FRESH object literal is the right instrument HERE, and it is the
    // wrong one in `types/src/__tests__/menu-item-union.test.ts` — worth
    // saying why, because the two files disagree on purpose. That file pins a
    // `?: never` TOMBSTONE, where a fresh literal's excess-property rejection
    // would be evidence-identical to the key simply not being declared. This
    // file pins the opposite property: that an UNDECLARED key is refused at
    // all. Excess-property checking on a fresh literal IS that property, and
    // it is the diagnostic a host composing a view entry inline actually
    // receives.
    //
    // `@ts-expect-error` is self-firing: if the line below ever STOPS being an
    // error — an index signature added, the type widened to `any`, the export
    // replaced by a looser one — this file fails with "unused
    // '@ts-expect-error' directive" rather than passing quietly.
    //
    // `parentFeild` is the triage comment's own example of the silently-dropped
    // misspelling. Refusing it here is the entire point of exporting this type.
    // ⚠️ The directive must be the LAST comment line before the offending
    // property — TypeScript matches it to the line that follows it, so prose
    // underneath it would disarm the pin silently.
    const misspelled: TreeViewConfig = {
      // @ts-expect-error objectui#8253 — an undeclared key on the host tree config is refused.
      parentFeild: 'parent',
    };

    // The correctly-spelled twin, so the refusal above is a statement about
    // the SPELLING and not about the type refusing objects in general. If this
    // line ever fails, the pin above stops being evidence of anything.
    const spelled: TreeViewConfig = { parentField: 'parent' };

    expect(spelled.parentField).toBe('parent');
    expect(misspelled).toBeTruthy();
  });
});

/*
 * ⚠️ The off-disk reader census that belongs beside these pins does NOT live
 * here, and the reason is mechanical rather than aesthetic: this package's
 * `tsconfig.test.json` carries no `"types": ["node"]`, so `node:fs` is not a
 * name this project can resolve, and adding it would put a Node API within
 * reach of a package that ships to browsers. The census lives in
 * `packages/types/src/__tests__/tree-view-config-readers-8253.test.ts`, beside
 * the declaration it is total over, in a project that already declares `node`
 * for exactly this purpose. What stays HERE is the half only this package can
 * assert: that the name resolves through the published `exports` map.
 */
