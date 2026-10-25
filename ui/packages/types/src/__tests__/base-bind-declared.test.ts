/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — `bind`, the data-scope vocabulary read across the repo and
 * declared by no schema shape (objectui#6357).
 *
 * ## What was wrong
 *
 * Ten production sites read `bind` off a schema node and NOTHING declared it.
 * It resolved as `any` through `BaseSchema`'s index signature, while three
 * separate documents taught it as an authorable key of every node — this
 * repo's own `AGENTS.md` §4 ("Every node in the UI tree follows this shape
 * (`@object-ui/types`)", declaring `bind` as an optional string), the PUBLISHED agent-facing
 * `skills/objectui/rules/protocol.md` ("Every UI component node MUST follow
 * this shape"), and `content/docs/fields/grid.mdx`.
 *
 * The census that chose this home, measured on `origin/main` `c5037fd29`:
 *
 *   - **9** reads of `useDataScope(schema.bind)` — `components`' `list` and
 *     `tree-view`, and the `object-*` widgets in `plugin-charts`,
 *     `plugin-dashboard` (×2), `plugin-grid`, `plugin-kanban`, `plugin-list`,
 *     `plugin-timeline`;
 *   - **1** non-hook read — `plugin-grid/src/index.tsx`'s `gridNeedsDataSource`
 *     predicate, where `schema?.bind != null` is one of the escape hatches that
 *     makes a missing data-source adapter legitimate rather than a defect;
 *   - **2** DOM-strip destructures — `MetricWidget` / `MetricCard`, which
 *     destructure `bind` out so `SchemaRenderer`'s spread cannot write
 *     `bind="data.revenue"` onto the DOM (objectui#4357).
 *
 * ## Why `BaseSchema` and not nine per-component declarations
 *
 * Because per-component buys NOTHING extra — see the ceiling below, which is
 * symmetric: neither half can refuse the key on a non-reader either way. It
 * costs nine copies of one key for zero enforcement, and the class had already
 * generated FOUR local declarations before this one existed — three spelled
 * `string`, one spelled `unknown`. `schemaHostProps.ts`'s own header names the
 * hazard: "two copies of one key list is how a list becomes two disagreeing
 * lists". Exactly ONE of the four was a true duplicate of a base member —
 * `ObjectPivotTable`'s, whose `PivotTableSchema & {…}` intersection does extend
 * `BaseSchema`; it is removed by this card. The other three were load-bearing
 * at the time: their containing types never referenced `BaseSchema`, so
 * deleting the member would have deleted the declaration rather than
 * inheriting it. Two of them — the hand-rolled `schema` prop literals of
 * `ObjectGallery` and `ObjectDataTable` — were ratcheted here until
 * objectui#6576 anchored both to exported schema types that extend
 * `BaseSchema` (ruling 2026-08-31), at which point their local members became
 * true duplicates and were removed exactly as `ObjectPivotTable`'s was. The one
 * that remains is ratcheted below.
 *
 * `placeholder` is the standing precedent for a cross-cutting key declared here
 * and honoured by a subset: every node may write it, only inputs read it.
 *
 * ## The ceiling, stated rather than assumed (objectui#5155 / objectui#6269)
 *
 * Same ceiling as objectui#5903's gantt pin and objectui#6170's timeline pin.
 * `BaseSchema` carried `[key: string]: any` on the TS side until objectui#8347
 * and is `.passthrough()` on the zod side, so:
 *
 *   - an UNDECLARED key is still accepted by the zod half (and was by the TS
 *     half while the signature stood). Declaring `bind` did NOT buy rejection of
 *     `bindTo` there, and the counter-probe below pins that
 *     honestly rather than letting a reader assume otherwise;
 *   - a DECLARED key IS validated. `bind: 42` type-checked and parsed green
 *     before this card and is refused by both halves now — the accept-set
 *     narrowing this card lands;
 *   - on the TS side a read site could never be the detector while the index
 *     signature typed `schema.bind` as `any` either way. So the compile-time
 *     pin is the `@ts-expect-error` block at the bottom: when written, removing
 *     the declaration made the member resolve to `any`, the wrong-typed
 *     assignment started succeeding, and the now-unused directive failed the
 *     build (TS2578) NAMING the key. Since objectui#8347 a removal makes the
 *     indexed access itself an error, which the directive swallows, so a
 *     deletion is caught by the well-typed counter-probe beside it instead (its
 *     `bind` becomes an excess key). `tsconfig.test.json` compiles this file, so that is real
 *     enforcement and not decoration (objectui#3009).
 *
 * The narrowing only refuses what already crashed: `useDataScope` is
 * `(path?: string)` and resolves via `path.split('.')`, so a non-string `bind`
 * threw a TypeError at render time.
 *
 * ## What this pin deliberately does NOT cover
 *
 * `data-table` does not call `useDataScope`, so a `bind` on it is ignored and
 * the table renders its header over an empty body — no error, no warning. That
 * is recorded in `protocol.md` and already pinned in
 * `components/src/__tests__/skill-guide-data-table-binding.test.tsx`. Declaring
 * the key here neither causes nor cures it: `bind` was accepted on every node
 * before this declaration existed, via the index signature and `.passthrough()`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BaseSchema } from '../zod/base.zod.js';
import type { BaseSchema as BaseSchemaTS } from '../base.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const MINIMAL = { type: 'list' } as const;

describe('BaseSchema (zod) — `bind` is mirrored and validated', () => {
  it('declares `bind` in the mirror shape', () => {
    // The pair `base.zod.ts#BaseSchema` carries no `KnownDrift` /
    // `UnmirroredDeclared` entry, so `zod-mirror-parity.test.ts` independently
    // reddens by name if the TS declaration ever outruns this member. This
    // asserts the member directly so the failure is readable here too.
    expect(Object.keys(BaseSchema.shape)).toContain('bind');
  });

  it('accepts the path forms the readers resolve', () => {
    for (const bind of ['customerNames', 'app.settings.users', 'rows']) {
      expect(BaseSchema.safeParse({ ...MINIMAL, bind }).success, bind).toBe(true);
    }
  });

  it('refuses a non-string `bind` — the accept-set narrowing this card lands', () => {
    // Green before this card (`.passthrough()` waved it through); it then threw
    // `path.split is not a function` inside `useDataScope` at render time.
    for (const bind of [42, true, { path: 'customers' }, ['customers']]) {
      expect(BaseSchema.safeParse({ ...MINIMAL, bind }).success, JSON.stringify(bind)).toBe(false);
    }
  });

  it('still accepts a MISSPELLING — the ceiling, pinned honestly', () => {
    // Counter-probe against reading the two assertions above as more than they
    // are. `.passthrough()` accepts any undeclared key, so `bindTo` is waved
    // through exactly as `bind` used to be. Closing THAT is objectui#5155 /
    // objectui#6269, not this card; if it is ever closed, this expectation is
    // the one that must be revisited deliberately rather than silently.
    expect(BaseSchema.safeParse({ ...MINIMAL, bindTo: 'customers' }).success).toBe(true);
  });

  it('leaves `bind` optional — every node that never binds still parses', () => {
    expect(BaseSchema.safeParse(MINIMAL).success).toBe(true);
  });
});

describe('BaseSchema (TS) — compile-time pin on `bind`', () => {
  it('refuses a wrong-typed `bind`', () => {
    // This directive failed the build (TS2578, "unused '@ts-expect-error'") the
    // moment `bind` stopped being declared, while the index signature resolved
    // the member to `any` and the assignment started succeeding. Since
    // objectui#8347 a removal makes `BaseSchemaTS['bind']` itself an error, which
    // this directive swallows, so the deletion signal comes from the well-typed
    // counter-probe below; this directive still fails the build if `bind` is
    // widened to accept a number.

    // @ts-expect-error — `bind` is declared `string | undefined`.
    const bind: BaseSchemaTS['bind'] = 42;

    expect(bind).toBe(42);
  });

  it('accepts a well-typed `bind`', () => {
    // Counter-probe for the directive above: without this, a declaration
    // narrowed to `never` would satisfy it.
    const node: BaseSchemaTS = { type: 'list', bind: 'customerNames' };
    expect(node.bind).toBe('customerNames');
  });
});

/**
 * ONE declaration, not N.
 *
 * The card's own warning is that guessing the home "would produce the second
 * declaration this class keeps generating" — and two had already appeared
 * before anyone declared the key centrally. This scan is the guard against the
 * third: a schema-side optional `bind` member anywhere outside its home reads as a
 * local re-declaration, which is how the two disagreeing spellings (`string`
 * vs `unknown`) came to exist in the first place.
 */
describe('`bind` is declared in exactly one place (objectui#6357)', () => {
  /**
   * The one allowed non-home declaration, WITH ITS REASON.
   *
   * It is not a schema shape, which is why it does not inherit the declaration
   * and could not simply be deleted. Two more entries stood here from
   * objectui#6357 to objectui#6576 — the hand-rolled inline `schema` prop
   * literals of `ObjectGallery` and `ObjectDataTable`, RATCHETED because their
   * containing types never reached `BaseSchema`, so dropping the member would
   * have deleted the declaration instead of inheriting it. Those entries
   * attributed the defect to objectui#5155 / objectui#6269; that was wrong —
   * #5155 is about `BaseSchema`'s index signature leaving EXTENDERS open to
   * misspellings, and these two types never extended it at all. The defect was
   * objectui#6576's, and its 2026-08-31 ruling closed it by anchoring both to
   * `ObjectGallerySchema` / `ObjectDataTableSchema` (each `extends BaseSchema`),
   * so `bind` is inherited there now and the scan below is what keeps a local
   * copy from coming back. An entry here is a declared decision; a file that is
   * in neither this map nor the home fails the scan.
   */
  const ALLOWED = new Map<string, string>([
    [
      'packages/plugin-dashboard/src/schemaHostProps.ts',
      'DOM-strip props type, not a schema shape — all seven members are `unknown` by design, '
        + 'because the type exists to be destructured out and never read (objectui#4357).',
    ],
  ]);

  const HOME = 'packages/types/src/base.ts';

  it('no schema shape re-declares `bind` outside `BaseSchema`', async () => {
    const { execFileSync } = await import('node:child_process');
    // `git grep` over TRACKED files only, so an untracked scratch file or a
    // stray build artefact cannot fail this. `-n` for a readable failure.
    // ASSEMBLED, never written as one literal. `git grep` searches TRACKED
    // files, so the moment this file is committed a literal pattern would match
    // THIS file and the scan would report itself. Allow-listing itself would
    // have been the wrong repair — it puts a permanent hole in the scan at the
    // one path most likely to grow a copy of the pattern.
    const PATTERN = 'bind' + '?:';
    // Every `CHANGELOG.md` is excluded. `pnpm changeset:version` writes changeset
    // prose into them, and a changeset that reports a local declaration being
    // REMOVED quotes the pattern. On the 17.7.0 release head that made the
    // plugin-dashboard and types CHANGELOGs read as two new declarations
    // (objectui#11586). A CHANGELOG declares nothing.
    const EXCLUDE_CHANGELOGS = ':!*CHANGELOG.md';

    let out: string;
    try {
      out = execFileSync(
        'git',
        ['grep', '-n', '-F', '--', PATTERN, 'packages', EXCLUDE_CHANGELOGS],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
    } catch (err: any) {
      // `git grep` exits 1 on "no matches" — which would mean the home
      // declaration itself vanished. Fall through to the assertions below,
      // which then fail naming it.
      out = err?.stdout ?? '';
    }

    const hits = out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(0, line.indexOf(':')));

    // Counter-probe: a filter over an empty scan passes vacuously.
    expect(hits, 'the scan found nothing at all — check the pattern').not.toHaveLength(0);
    expect(hits, `\`${HOME}\` must declare \`bind\``).toContain(HOME);

    const strays = [...new Set(hits)].filter((f) => f !== HOME && !ALLOWED.has(f));
    expect(
      strays,
      `a second \`${PATTERN}\` declaration appeared — declare it once on \`BaseSchema\`, `
        + 'or add the file to ALLOWED above with its reason',
    ).toEqual([]);
  });

  it('the readers still read the key this declaration is about', () => {
    // The declaration is only worth its doc comment while the reads exist. One
    // representative per package, so a rename that leaves the key undeclared
    // again cannot pass quietly.
    const readers = [
      'packages/components/src/renderers/data-display/list.tsx',
      'packages/components/src/renderers/data-display/tree-view.tsx',
      'packages/plugin-charts/src/ObjectChart.tsx',
      'packages/plugin-dashboard/src/ObjectDataTable.tsx',
      'packages/plugin-dashboard/src/ObjectPivotTable.tsx',
      'packages/plugin-grid/src/ObjectGrid.tsx',
      'packages/plugin-kanban/src/ObjectKanban.tsx',
      'packages/plugin-list/src/ObjectGallery.tsx',
      'packages/plugin-timeline/src/ObjectTimeline.tsx',
    ];
    for (const rel of readers) {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(src, `${rel} no longer reads \`schema.bind\``).toContain('useDataScope(schema.bind)');
    }
    expect(readers).toHaveLength(9);
  });
});
