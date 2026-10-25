/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9550 - `ObjectTreeSchema` is nameable on the ROOT barrel of
 * `@object-ui/types`.
 *
 * ## The defect
 *
 * `ObjectTreeSchema` is a declared node schema that an author could not import
 * from `@object-ui/types`. Its eleven sibling arms of
 * `ObjectQLComponentSchema` could be. Historical reading, taken once on
 * `origin/main` `72f55c9ec1` before this repair and deliberately not restated
 * as a live figure - the assertions below are what re-derive the claim:
 *
 *   | name                        | hits in the root barrel source |
 *   | --------------------------- | -----------------------------: |
 *   | `ObjectTreeSchema`          |                              0 |
 *   | `ObjectGridSchema` (control)|                              2 |
 *   | `ListViewSchema`   (control)|                              3 |
 *   | `BreadcrumbSchema` (control)|                              1 |
 *
 * Three controls read non-zero under the same query, so the zero was a reading
 * and not a dark instrument. `ObjectTreeSchema` was and is declared in
 * `objectql.ts` and re-exported by the zod barrel (objectui#7917 repaired that
 * half, objectui#8784 keeps it repaired); only the TypeScript barrel omitted
 * it, and this package publishes NO `./objectql` subpath to reach around the
 * barrel - its `exports` map declares `.`, `./base`, `./complex`, `./data`,
 * `./data-display`, `./feedback`, `./form`,
 * `./internal/retired-field-keys`, `./layout`, `./navigation`, `./overlay` and
 * `./zod`. The root barrel was the only route, and it did not carry the name.
 *
 * ## The measured consequence, which is the natural "before" of leg (a2)
 *
 * The seat delivering objectui#8655 needed this type to stop
 * `ObjectTreeProps.schema` being `any`. Because the name could not be
 * imported, it had to spell the node as
 * `Extract<ObjectQLComponentSchema, { type: 'object-tree' }>`. That idiom is
 * correct and it still is; what it is not is discoverable. So leg (a2) asserts
 * the imported name and that Extract are the SAME type - a barrel line that
 * published a fork of the name would satisfy leg (a1) and still leave the
 * reader with two things to reconcile.
 *
 * ## Why a SOURCE scan sits next to the type-level pins
 *
 * The type-level pins are erased by the compiler, so they say nothing during
 * `pnpm test`; their enforcement is `tsc -p tsconfig.test.json`, the third leg
 * of this package's `type-check` script, which CI runs as its own job. The
 * source scan is the half that runs under `vitest`, and it is deliberately NOT
 * a `dist/` read: this repo's per-PR `test` job runs `pnpm test` with no build
 * step ahead of it (turbo's `test` task depends on `^build`, the DEPENDENCY
 * closure, never the package's own build), so a test needing a fresh `dist/`
 * would be vacuously absent-or-red on a cold cache.
 * `package-exports-manifest.test.ts` and
 * `combobox-option-root-barrel-7697.test.ts` record that same constraint for
 * the same package; this file follows them rather than re-litigating it.
 *
 * ## What this file is NOT
 *
 * It is a PER-NAME pin, not a barrel-completeness gate. The card that ordered
 * this repair offered such a gate as its option 3 and it was ruled out for
 * this change: a gate over "every declared node schema is reachable from the
 * barrel that publishes its family" is a wider design with its own review, and
 * it would arrive here unrequested. objectui#9526 is the sibling card in the
 * same family. If that gate is ever built, this file becomes one of its
 * regression cases rather than its substitute.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

import type { ObjectTreeSchema as FromRootBarrel } from '../index';
import type { ObjectQLComponentSchema } from '../index';
// The two controls: sibling arms that were ALREADY on the root barrel's
// `./objectql.js` list before this change. If either fails to resolve, every
// reading in this file is dark.
import type { ObjectMapSchema as MapFromRootBarrel } from '../index';
import type { ObjectGanttSchema as GanttFromRootBarrel } from '../index';

const require = createRequire(import.meta.url);

const readSource = (relative: string): string =>
  readFileSync(require.resolve(relative), 'utf8');

const INDEX_SRC = readSource('../index.ts');
const OBJECTQL_SRC = readSource('../objectql.ts');

/**
 * Invariant type equality - the house spelling
 * (`combobox-option-root-barrel-7697`, `chart-series-keys-7546`, and others).
 * Assignability alone would call a widened or `any`-resolved type a match;
 * this does not.
 */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** The spelling objectui#8655 was forced into, kept here as leg (a2)'s probe. */
type ViaExtract = Extract<ObjectQLComponentSchema, { type: 'object-tree' }>;

/**
 * The bodies of every `export type { ... } from './objectql.js';` clause in
 * the root barrel. There is exactly one, and the assertion below says so.
 *
 * The brace class is load-bearing, not tidiness: a lazy `[\s\S]*?` body would
 * be free to open at some earlier `export type {` and close on the file's
 * other `./objectql.js` line - the `import type { ObjectQLComponentSchema,
 * ListViewSchema }` near the node-union declaration - swallowing every export
 * clause in between. The count assertion is what would catch that.
 */
const objectqlReExportBodies = (): string[] =>
  [...INDEX_SRC.matchAll(/export type \{([^{}]*?)\} from '\.\/objectql\.js';/gu)].map(
    (m) => m[1] ?? '',
  );

/** Every name on the root barrel's `./objectql.js` named re-export list. */
const objectqlReExportNames = (): string[] => {
  const bodies = objectqlReExportBodies();
  // One clause, or the extraction below is reading a shape this file was not
  // written against and every membership answer under it is unreliable.
  expect(bodies).toHaveLength(1);
  return (bodies[0] ?? '')
    .split('\n')
    .map((line) => line.trim())
    // Drop the prose. The list carries `//` commentary, so a substring read of
    // the raw block would count comments as exports.
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .map((line) => /^([A-Za-z_$][\w$]*)\s*,?$/u.exec(line)?.[1] ?? '')
    .filter((name) => name.length > 0);
};

/* -- (a) the type level: the name resolves, to the union's own arm --------- */

describe('objectui#9550 - `ObjectTreeSchema` resolves from the root barrel', () => {
  it('a1 - resolves, with its declared members', () => {
    // RED on the untouched base: `../index` has no exported member
    // `ObjectTreeSchema`, so the import above fails to resolve under
    // `tsc -p tsconfig.test.json` (TS2305) and each alias below is an error.
    //
    // Members are pinned one at a time rather than as a whole-shape equality:
    // a key ADDED to the declaration is a decision for its own card, not a
    // reason for this one to red, while a member RETYPED here would be exactly
    // the "nothing retyped or narrowed" claim breaking.
    const tag: Eq<FromRootBarrel['type'], 'object-tree'> = true;
    // `string | undefined` since objectui#11168 slice 3: the member went
    // OPTIONAL (a tree on inline rows never reads it; the zod twin's
    // `requireRecordSource` refinement carries "one of the three"), measured
    // against `@objectstack/spec` 17.5.0's `object-tree` row and the renderer.
    const objectName: Eq<FromRootBarrel['objectName'], string | undefined> = true;
    const parentField: Eq<FromRootBarrel['parentField'], string | undefined> = true;
    const labelField: Eq<FromRootBarrel['labelField'], string | undefined> = true;
    const fields: Eq<FromRootBarrel['fields'], string[] | undefined> = true;
    const depth: Eq<FromRootBarrel['defaultExpandedDepth'], number | undefined> = true;
    expect([tag, objectName, parentField, labelField, fields, depth]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('a2 - the barrel name IS the union arm, not a fork of it', () => {
    // The `Extract` spelling objectui#8655 had to write keeps working, and it
    // names the same declaration the barrel now publishes. Both halves matter:
    // a fork would pass a1 and still leave two meanings behind one word, the
    // trap `scripts/__tests__/one-authority-per-exported-name-6273.test.ts`
    // guards for the declaration case.
    const same: Eq<FromRootBarrel, ViaExtract> = true;
    expect(same).toBe(true);
  });

  it('a3 - CONTROL: two sibling arms already on the list still resolve', () => {
    const map: Eq<MapFromRootBarrel['type'], 'object-map'> = true;
    const gantt: Eq<GanttFromRootBarrel['type'], 'object-gantt'> = true;
    expect([map, gantt]).toEqual([true, true]);
  });
});

/* -- (b) the source: an explicit named list, the declaration left in place - */

describe('objectui#9550 - the root barrel lists the name, explicitly', () => {
  it('b1 - `ObjectTreeSchema` is on the `./objectql.js` named re-export list', () => {
    // RED on the untouched base: the list closed without this name.
    expect(objectqlReExportNames()).toContain('ObjectTreeSchema');
  });

  it('b2 - CONTROL: the sibling arms are on the same list', () => {
    // If these fail, the extraction is dark and the reading above says
    // nothing. They are the arms the card measured as already present.
    const names = objectqlReExportNames();
    expect(names).toEqual(
      expect.arrayContaining([
        'ObjectGridSchema',
        'ObjectFormSchema',
        'ObjectViewSchema',
        'ObjectMapSchema',
        'ObjectGanttSchema',
        'ObjectCalendarSchema',
        'ObjectKanbanSchema',
        'ObjectChartSchema',
        'ObjectGallerySchema',
        'ObjectDataTableSchema',
        'ListViewSchema',
      ]),
    );
  });

  it('b3 - the list is still an EXPLICIT named list - no wildcard', () => {
    // A wildcard would make b1 vacuous and would publish every other name in
    // `objectql.ts` as a side effect - a far wider surface change than the one
    // this card authorises.
    expect(INDEX_SRC).not.toMatch(/export (?:type )?\* (?:as \w+ )?from '\.\/objectql\.js';/u);
  });

  it('b4 - the declaration did NOT move - `objectql.ts` still owns it', () => {
    // The fix is a barrel line, not a relocation: `index.ts` re-exports, it
    // never declares. Held under a file fence on this card as well - the
    // declaration file was owned by another open pull request while this
    // repair was made.
    expect(OBJECTQL_SRC).toMatch(/^export interface ObjectTreeSchema\b/mu);
    expect(INDEX_SRC).not.toMatch(/\b(?:interface|type)\s+ObjectTreeSchema\b/u);
  });
});
