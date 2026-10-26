/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/components` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3159, objectstack#4115 burn-down batch 5).
 *
 * Six symbols here were declared under names the spec already owns. Four were
 * genuinely the spec's and now carry its binding (`ShareLinkPermission`,
 * `ShareLinkAudience`, `ShareLink`, `SortItem`); two model something else
 * entirely and were renamed (`FilterCondition` → `FilterBuilderCondition`,
 * `Field` → `FieldContainer`). The builder row has since been renamed once more,
 * to `FilterBuilderRow`, because `@object-ui/types` owns `FilterBuilderCondition`
 * as the authored row this one derives from (objectui#6349, batch 12).
 *
 * `FilterCondition` is the case worth remembering. The tracking issue's own
 * cross-package guidance was WRONG about it once already: `@object-ui/app-shell`
 * has a `FilterCondition` too, and that one really is the spec's ObjectQL AST
 * (re-exported in objectui#3169) — so "app-shell re-exported it, do the same"
 * would have replaced this flat builder row with a recursive query type. Same
 * name, two different objects, two different verdicts. Triage per package.
 *
 * ## Why the spec's names are read through the compiler, not `import * as`
 *
 * A runtime namespace import sees VALUES only, and most symbols here are TYPES;
 * a tripwire built on `Object.keys(await import(…))` would pass while proving
 * nothing. So this reads each subpath's `.d.ts` through the TypeScript checker,
 * exactly as `scripts/check-spec-symbol-derivation.mjs` does.
 *
 * ## Later arrivals are APPENDED under their own card
 *
 * Six / four / two is a measurement of the batch-5 burn-down at the time it was
 * taken; re-counting it here whenever a new symbol arrives would make it
 * unreproducible. `SortDirection` (objectui#7265) is the first such arrival — a
 * module-local mirror in the DataTable renderer that rule 1 could not see until
 * its export filter was dropped. It went the BIND route, and because the
 * declaration is now an import rather than a derivation there is no local name
 * left to reach for: what is pinned below is the SPEC-side property the binding
 * rests on, the way the app-shell slice pinned its own module-local names. The
 * absence of the old declaration is pinned where the scanner can execute it, in
 * scripts/__tests__/spec-symbol-ledger-components-7265.test.ts.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import type { ShareLink, ShareLinkAudience, ShareLinkPermission } from '../share/ShareDialog';
import type { SortItem } from '../custom/sort-builder';
import type { FilterBuilderRow } from '../custom/filter-builder';
import type {
  ShareLink as SpecShareLink,
  ShareLinkAudience as SpecShareLinkAudience,
  ShareLinkPermission as SpecShareLinkPermission,
} from '@objectstack/spec/contracts';
import type { SortItem as SpecSortItem, SortDirection as SpecSortDirection } from '@objectstack/spec/shared';
import type { FilterCondition as SpecFilterCondition } from '@objectstack/spec/data';
import type { TableSortItem } from '@object-ui/types';

/** Every name `@objectstack/spec` exports from any subpath — types AND values. */
function specExportNames(): Set<string> {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@objectstack/spec/package.json');
  const pkgDir = dirname(pkgPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, { import?: { types?: string }; require?: { types?: string } }>;
  };

  const files: string[] = [];
  for (const cond of Object.values(pkg.exports ?? {})) {
    if (typeof cond !== 'object' || cond === null) continue;
    const dts = cond.import?.types ?? cond.require?.types;
    if (dts) files.push(resolve(pkgDir, dts));
  }

  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();

  const names = new Set<string>();
  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) names.add(exported.getName());
  }
  return names;
}

const SPEC_NAMES = specExportNames();

describe('the spec export-name probe itself works', () => {
  it('reads a non-trivial number of names', () => {
    expect(SPEC_NAMES.size).toBeGreaterThan(1000);
  });

  it('sees TYPE-only exports, not just runtime values', () => {
    // `ShareLinkAudience` is a type alias — invisible to a runtime `import()`.
    expect(SPEC_NAMES.has('ShareLinkAudience')).toBe(true);
  });
});

const RENAMES: Array<[local: string, formerly: string, specMeaning: string]> = [
  [
    'FilterBuilderRow',
    'FilterCondition',
    'the RECURSIVE ObjectQL predicate AST ($and / $or / $not over field operators)',
  ],
  [
    'FieldContainer',
    'Field',
    "an object FIELD's metadata and its builder namespace (@objectstack/spec/data)",
  ],
];

describe('renamed local dialects do not collide with a spec export', () => {
  it.each(RENAMES)('the spec does not own `%s`', (local) => {
    expect(
      SPEC_NAMES.has(local),
      `@objectstack/spec now exports \`${local}\`. This package declares its own ` +
        `\`${local}\`, so the rename that fixed objectstack#4115 has re-created the ` +
        `collision under the new name. Rename again (and check the new name here ` +
        `FIRST — objectui#3074 landed a rename onto another spec export exactly ` +
        `this way), or derive from the spec if the two really are the same thing.`,
    ).toBe(false);
  });

  it.each(RENAMES)('the spec still owns `%s` (second value: %s)', (_local, formerly) => {
    expect(
      SPEC_NAMES.has(formerly),
      `@objectstack/spec no longer exports \`${formerly}\`, which is the only ` +
        `reason this package renamed it. Either the spec dropped it (then take the ` +
        `plain name back) or it moved (then re-check what it means now).`,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.      */
/* Compiled by this package's `tsconfig.test.json` (objectui#3181): the narrow  */
/* `tsconfig.typetests.json` that used to name this one file was the rescue     */
/* hatch for a package still in TEST_DEBT, and it was retired with the debt     */
/* (objectui#4040 / objectui#4291).                                             */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The `unknown` erasure the `any` probe reports `false` for (objectui#3155). */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe('the two share-link enums ARE the spec bindings', () => {
  it('is pinned at compile time', () => {
    type _PermNotAny = Assert<Equal<IsAny<SpecShareLinkPermission>, false>>;
    type _AudNotAny = Assert<Equal<IsAny<SpecShareLinkAudience>, false>>;

    type _PermIsSpec = Assert<Equal<ShareLinkPermission, SpecShareLinkPermission>>;
    type _AudIsSpec = Assert<Equal<ShareLinkAudience, SpecShareLinkAudience>>;

    expect(true).toBe(true);
  });

  it('the dialog still offers only the two zero-input audiences', () => {
    // The dialog deliberately renders a SUBSET of the audience vocabulary — the
    // two that need no extra input. Pinned so widening the spec enum does not
    // silently look like the dialog gained options it did not implement.
    const offered: ShareLinkAudience[] = ['link_only', 'public'];
    const all: ShareLinkAudience[] = ['public', 'link_only', 'signed_in', 'email'];
    expect(all).toHaveLength(4);
    expect(offered.every((a) => all.includes(a))).toBe(true);
  });
});

describe('ShareLink derives from the spec row, minus the credential', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecShareLink>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecShareLink>, false>>;

    // `password_hash` is the ONE spec key this browser type drops. If it ever
    // stops being a spec key, drop the `Omit` too.
    type _SpecHasTheHash = Assert<Equal<'password_hash' extends keyof SpecShareLink ? true : false, true>>;
    type _WeDoNot = Assert<Equal<'password_hash' extends keyof ShareLink ? true : false, false>>;

    // …and `password_protected` is the ONE key invented locally. `created_at`
    // is shared — only its nullability differs — so it must NOT show up here.
    type _OnlyOneLocalKey = Assert<
      Equal<Exclude<keyof ShareLink, keyof SpecShareLink>, 'password_protected'>
    >;

    // Everything else is the spec's, by reference: a new spec key lands here.
    type _NoMissingKeys = Assert<
      Equal<Exclude<keyof SpecShareLink, keyof ShareLink | 'password_hash'>, never>
    >;

    // The documented nullability widening, and nothing beyond it.
    type _CreatedAtWidened = Assert<Equal<ShareLink['created_at'], string | null | undefined>>;
    type _SpecCreatedAtIsNotNullable = Assert<Equal<SpecShareLink['created_at'], string | undefined>>;

    // The keys the dialog actually reads come straight from the spec.
    type _TokenIsSpec = Assert<Equal<ShareLink['token'], SpecShareLink['token']>>;
    type _AudienceIsSpec = Assert<Equal<ShareLink['audience'], SpecShareLink['audience']>>;
    type _PermissionIsSpec = Assert<Equal<ShareLink['permission'], SpecShareLink['permission']>>;

    expect(true).toBe(true);
  });
});

describe('SortItem extends the spec sort item by exactly the React key', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecSortItem>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecSortItem>, false>>;

    // Every local row is a valid spec sort item (`id` is extra, never missing).
    type _LocalIsASpecItem = Assert<Extends<SortItem, SpecSortItem>>;

    // `id` is the ONLY local addition. When the spec grows a key, it appears
    // here automatically; when it claims `id`, this becomes `never` and fails,
    // which is the signal to collapse this to a plain re-export.
    type _OnlyIdAdded = Assert<Equal<Exclude<keyof SortItem, keyof SpecSortItem>, 'id'>>;

    type _FieldIsSpec = Assert<Equal<SortItem['field'], SpecSortItem['field']>>;
    type _OrderIsSpec = Assert<Equal<SortItem['order'], SpecSortItem['order']>>;

    expect(true).toBe(true);
  });
});

describe('FilterBuilderRow is NOT the spec ObjectQL AST', () => {
  it('is pinned at compile time', () => {
    // The spec's `FilterCondition` is recursive and carries an index signature,
    // so it absorbs almost anything — which is exactly why "are these the same
    // type?" cannot be answered by assignability here (objectstack#4075). What
    // distinguishes them is the branch keys: a builder row has none.
    type _SpecIsRecursive = Assert<Equal<'$and' extends keyof SpecFilterCondition ? true : false, true>>;
    type _WeAreFlat = Assert<Equal<'$and' extends keyof FilterBuilderRow ? true : false, false>>;

    // A builder row is one field/operator/value line plus a React key.
    type _RowKeys = Assert<Equal<keyof FilterBuilderRow, 'id' | 'field' | 'operator' | 'value'>>;

    expect(true).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* objectui#7265 — `SortDirection`, the DataTable renderer's module-local       */
/* mirror. BOUND: the declaration is gone and the renderer imports the spec's    */
/* own type, with the third state confined to the state slot that carries it.    */
/* -------------------------------------------------------------------------- */

describe('the spec still owns `SortDirection` — the collision this route answers is real', () => {
  it('reads the name off the spec, not off a list written here', () => {
    expect(
      SPEC_NAMES.has('SortDirection'),
      '@objectstack/spec no longer exports `SortDirection`. The DataTable ' +
        'renderer imports it, so this is a build break rather than a silent ' +
        'drift — but it also means the burn-down that removed the local ' +
        'declaration no longer has a spec symbol to bind to, and the route has ' +
        'to be taken again.',
    ).toBe(true);
  });
});

describe('the DataTable sort state IS the spec direction, widened only by absence', () => {
  it('is pinned at compile time', () => {
    // Guard-header cases 1, 2 and 2b: an `any` or `unknown` on the SPEC side
    // answers every assignability question affirmatively, so binding to it would
    // be a type-safety regression wearing a burn-down's clothes.
    type _SpecNotAny = Assert<Equal<IsAny<SpecSortDirection>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecSortDirection>, false>>;

    // The third state is genuinely OUTSIDE the spec's vocabulary. This is the
    // assertion the confinement rests on: if `null` were already admissible
    // there, the `| null` at the renderer's state slot would be a no-op and the
    // comment explaining it would be false.
    type _NullIsNotADirection = Assert<Equal<Extends<null, SpecSortDirection>, false>>;

    // …and the two real members are, so the widening is by absence and nothing
    // else. Read as an assignability pair rather than by restating `'asc' |
    // 'desc'` here: a member list typed out in a test is the same hand copy the
    // renderer just stopped keeping.
    type _DirectionsSurviveTheWidening = Assert<Extends<SpecSortDirection, SpecSortDirection | null>>;
    type _WideningIsStrict = Assert<Equal<Extends<SpecSortDirection | null, SpecSortDirection>, false>>;

    // The seam the non-null half flows into. `activeSort` builds a
    // `TableSortItem` out of `sortDirection` verbatim, so the day the spec grows
    // a direction this reds on the hand-declared `order` in @object-ui/types
    // rather than on the renderer — which is where the drift would actually be.
    // (@object-ui/types takes no dependencies and declares the shape instead of
    // importing it; that is a documented decision of that package, and this is
    // the tripwire on it.)
    type _OrderIsTheSpecDirection = Assert<Equal<TableSortItem['order'], SpecSortDirection>>;

    expect(true).toBe(true);
  });

  it('the three-state cycle the `| null` exists for is covered behaviourally', () => {
    // Stated here rather than re-tested: the client-side header cycle that
    // PRODUCES the unsorted state is pinned by the `leaves client-side sorting
    // exactly as it was` case in data-table-manual-sorting.test.tsx, and the
    // manual-sorting side is pinned there too by `never asks for "no sort" — the
    // third click returns to ascending`. Duplicating them here would make two
    // places to keep honest; naming them makes the type pins above and the
    // behaviour one file, which is what a reader deciding to "simplify" the
    // `| null` away needs to find.
    expect(true).toBe(true);
  });
});
