import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FACTORY_NAMES as SCRIPT_FACTORY_NAMES, analyze } from '../check-i18n-call-site-keys.mjs';
import {
  FACTORY_NAMES as SCAN_FACTORY_NAMES,
  HAND_ROLLED_TABLES,
  scanDefaultsTables,
} from '../../packages/test-support/src/defaults-table-scan';

/**
 * objectui#7904 — one defaults POPULATION, two walks, held to each other.
 *
 * ## What is duplicated, and why it stays that way
 *
 * Two independently written AST walks discover the same `createSafeTranslation`
 * defaults tables:
 *
 *   - `packages/test-support/src/defaults-table-scan.ts` (`scanDefaultsTables`,
 *     objectui#7884) — TypeScript source, imported by the two vitest gates that
 *     judge the rows (the objectui#3512 placeholder-spelling case in
 *     `@object-ui/i18n`, and `@object-ui/app-shell`'s "every row names a key the
 *     en pack defines").
 *   - `scripts/check-i18n-call-site-keys.mjs` (`scanFactorySites` /
 *     `resolveFactoryTable` / `declaredConstant`, behind `analyze()`,
 *     objectui#7567) — the `factory-default-drift` class, a bare-node script.
 *
 * They were not merged for a structural reason, not an oversight:
 * `scripts/*.mjs` run under bare node and cannot import the TypeScript-source
 * module the vitest gates share (`exports["./defaults-table-scan"]` resolves to
 * `./src/*.ts`, and no fresh checkout has a `dist`). Giving the scripts lane a
 * loader or a build step is a capability expansion with no pull beyond this one
 * pin, so objectui#7904 took the cheaper half: pin the agreement instead of
 * merging the implementations.
 *
 * ## So this file is the guarantee instead
 *
 * The two walks agree exactly today, and that agreement is currently free of
 * luck — both were written from the same understanding of the factory. But
 * nothing asserted it, so the day one of them learns a new table shape (a table
 * behind a `satisfies`, a re-export, a computed member, a spread) and the other
 * does not, the two populations diverge in silence and one gate goes on
 * reporting full coverage of a population the other has already grown past.
 *
 * ⛔ This file judges only the POPULATION — which call sites, which tables,
 * which rows, and how much of it neither walk can read. It does not judge the
 * RULES: the script value-compares each row against its `en` value and abstains
 * where `en` defines none; the app-shell gate asks whether the key exists at
 * all. Those stay each side's own business, exactly as objectui#7310's
 * `placeholder-spelling-parity.test.ts` leaves both spelling suites alone.
 *
 * ## The trap: the two sides do NOT partition the population the same way
 *
 * `scanDefaultsTables` walks the factory call sites AND THEN appends every
 * declared hand-rolled table, into ONE `rows` / `tables` pair. The script keeps
 * the two halves in SEPARATE counters on purpose (its class-8 header says why:
 * a registry that resolved nothing would be invisible inside a combined number
 * next to 841 factory rows). Comparing the scan's totals against the script's
 * `factory*` counters would therefore compare 1072 rows against 841 and be red
 * for a reason that is not drift. So the scan side is partitioned first:
 *
 *   - HAND-ROLLED half — the scan labels a hand-rolled table exactly
 *     `NAME (file)`, built from the same `HAND_ROLLED_TABLES` registry the
 *     script reads (both sides read `hand-rolled-tables.json`, objectui#7877 —
 *     one declaration, not two copies). A FACTORY label is always
 *     `NAME (file:LINE)`, so the two label shapes cannot collide: the derived
 *     `NAME (file)` string is never produced by the factory branch.
 *   - FACTORY half — every other label, and the rows carrying it.
 *
 *   - THE OVERLAP. `TIMELINE_DEFAULT_TRANSLATIONS` is in the registry AND
 *     reaches the factory. The script de-duplicates on the literal's own
 *     position and counts it as `handRolledAlreadyFactoryCovered`, excluding its
 *     rows from `handRolledRows`. The scan deliberately double-lists it (its
 *     docstring: "a caller must de-duplicate on `where` + `key`"). This file is
 *     that caller: a hand-rolled table whose every row shares a `where` + `key`
 *     with a factory row IS the literal the factory walk already scanned.
 *
 * ## The mapping asserted below, counter by counter
 *
 *   scan factory table labels          = counters.factorySites
 *   distinct factory literals          = counters.factoryTables
 *   scan factory rows                  = counters.factoryRows
 *   HAND_ROLLED_TABLES.length          = counters.handRolledDeclared
 *   scan hand-rolled labels, overlap-free = counters.handRolledTables
 *   scan hand-rolled labels in overlap  = counters.handRolledAlreadyFactoryCovered
 *   scan hand-rolled rows, overlap-free = counters.handRolledRows
 *   scan.unreadable = []               = all four of the script's unreadable
 *                                        counters at 0
 *
 * Two of those rows hold only because of a property of TODAY's tree, and both
 * are asserted before the equalities rather than assumed:
 *
 *   - `factorySites` counts INVOCATIONS including ones whose table never
 *     resolves; the scan emits a label only for a resolved one. The two are
 *     equal only while `factoryUnreadableTables` is 0.
 *   - `factoryTables` counts DISTINCT literals; the scan pushes one label per
 *     site, so one table passed to two factories would make the scan's label
 *     count and row count exceed the script's. Distinct literals are recovered
 *     on the scan side from each table's row signature (a shared literal yields
 *     rows at identical `where` + `key` positions), which needs every factory
 *     table to contribute at least one row — asserted, because two EMPTY tables
 *     would otherwise collapse into one signature.
 *
 * ⚠️ Both are load-bearing rather than incidental: the day either stops holding,
 * the two walks genuinely answer differently about that table, and this pin
 * going red is the correct outcome — update the mapping deliberately, do not
 * relax the assertion.
 *
 * ## Known definitional differences this tree does not exercise
 *
 * Recorded so a future red is read correctly rather than papered over. The scan
 * DESCENDS into a nested object literal with a dotted key prefix; the script
 * deliberately does not (a flat `defaults[key]` lookup never reads a nested row,
 * so it counts one as an unreadable row instead). The scan also accepts a
 * property-access callee (`x.createSafeTranslation(...)`); the script requires a
 * bare identifier. Zero rows and zero call sites of either shape exist today, so
 * the counts agree; the first one written makes them disagree, which is
 * precisely the drift this file exists to surface.
 */

/*
 * Both package-owned imports above are RELATIVE on purpose, and it is not a
 * style choice: `scripts/__tests__/scripts-type-check.test.ts` pins that no root
 * file of `tsconfig.scripts.json`'s program names an `@object-ui/*` specifier,
 * because that premise is what lets `ci.yml` run `pnpm type-check:scripts`
 * ABOVE the build. `placeholder-spelling-parity.test.ts` carries the full
 * reasoning and the measurement behind it; this file follows it.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `NAME (file)` — the label the scan gives a table it reached from the registry. */
function handRolledLabel(entry: { readonly file: string; readonly name: string }): string {
  return `${entry.name} (${entry.file})`;
}

describe('the createSafeTranslation defaults population has one definition, not two (objectui#7904)', () => {
  // Both walks run once, in the collection phase: `scanDefaultsTables` is
  // memoised per repo root and measures ~0.5s, `analyze` measures ~3s on this
  // container, and neither belongs inside a test's timeout budget.
  const scan = scanDefaultsTables(REPO_ROOT);
  const { counters } = analyze(REPO_ROOT);

  const handRolledLabels = new Set(HAND_ROLLED_TABLES.map(handRolledLabel));
  const factoryTableLabels = scan.tables.filter((label) => !handRolledLabels.has(label));
  const scannedHandRolledLabels = scan.tables.filter((label) => handRolledLabels.has(label));
  const factoryRows = scan.rows.filter((row) => !handRolledLabels.has(row.table));
  const handRolledRows = scan.rows.filter((row) => handRolledLabels.has(row.table));

  /** Where + key of every factory row — the identity a shared literal repeats. */
  const factoryRowIds = new Set(factoryRows.map((row) => `${row.where}|${row.key}`));
  const rowsOf = (label: string) => scan.rows.filter((row) => row.table === label);
  /** The one label shape the script drops as `handRolledAlreadyFactoryCovered`. */
  const overlappingHandRolledLabels = scannedHandRolledLabels.filter((label) => {
    const rows = rowsOf(label);
    return rows.length > 0 && rows.every((row) => factoryRowIds.has(`${row.where}|${row.key}`));
  });
  const ownHandRolledLabels = scannedHandRolledLabels.filter(
    (label) => !overlappingHandRolledLabels.includes(label),
  );
  const ownHandRolledRows = handRolledRows.filter(
    (row) => !overlappingHandRolledLabels.includes(row.table),
  );

  /** Distinct LITERALS behind the factory labels — see the header's second caveat. */
  const distinctFactoryLiterals = new Set(
    factoryTableLabels.map((label) =>
      rowsOf(label)
        .map((row) => `${row.where}|${row.key}`)
        .join('\n'),
    ),
  );

  it('is asking two different implementations', () => {
    // The one way this gate could pass while checking nothing: both populations
    // coming from one walk. Merging them is the change this file exists to make
    // unnecessary — and if someone does merge them, this file must be DELETED
    // rather than left reading as a guarantee.
    expect(scanDefaultsTables).not.toBe(analyze);
    expect(typeof scanDefaultsTables).toBe('function');
    expect(typeof analyze).toBe('function');
    // Same reason, one level down: the recogniser is declared twice too. Two
    // Set objects, and they must hold the same names — a factory alias taught to
    // one side alone is the cheapest way for these populations to diverge.
    expect(SCAN_FACTORY_NAMES).not.toBe(SCRIPT_FACTORY_NAMES);
    expect([...SCAN_FACTORY_NAMES].sort()).toEqual([...SCRIPT_FACTORY_NAMES].sort());
  });

  it('both walks ran over the real tree, not an empty one', () => {
    // Floors, not equalities: the population grows on its own schedule, and a
    // floor is what stops it silently shrinking to nothing while the equality
    // assertions below go on passing over two empty walks (the objectui#3009
    // shape). The hand-rolled floor is 150, the same number the script's own
    // collapse floor uses, chosen there to sit above the LARGER of the two
    // tables so that losing either one fails.
    expect(scan.sourceFiles.length).toBeGreaterThan(1000);
    expect(factoryTableLabels.length).toBeGreaterThan(25);
    expect(factoryRows.length).toBeGreaterThan(700);
    expect(counters.factorySites).toBeGreaterThan(25);
    expect(counters.factoryRows).toBeGreaterThan(700);
    expect(ownHandRolledRows.length).toBeGreaterThan(150);
    expect(counters.handRolledRows).toBeGreaterThan(150);
    // Every factory table contributes rows — the premise the distinct-literal
    // signature needs, since two empty tables would share the empty signature.
    expect(factoryTableLabels.filter((label) => rowsOf(label).length === 0)).toEqual([]);
  });

  it('neither walk has a blind spot to hide a divergence in', () => {
    // A table or row neither walk can read is not an exemption, it is coverage
    // leaving the surface — and it is also where a divergence could hide, since
    // the two sides classify unreadability differently (see the header's
    // "known definitional differences"). Both instruments report zero today.
    expect(scan.unreadable).toEqual([]);
    expect({
      factoryUnreadableTables: counters.factoryUnreadableTables,
      factoryUnreadableRows: counters.factoryUnreadableRows,
      handRolledUnreadableTables: counters.handRolledUnreadableTables,
      handRolledUnreadableRows: counters.handRolledUnreadableRows,
    }).toEqual({
      factoryUnreadableTables: 0,
      factoryUnreadableRows: 0,
      handRolledUnreadableTables: 0,
      handRolledUnreadableRows: 0,
    });
  });

  it('the two walks discover the same population', () => {
    const comparisons: readonly { counter: string; scan: number; script: number }[] = [
      { counter: 'factorySites', scan: factoryTableLabels.length, script: counters.factorySites },
      { counter: 'factoryTables', scan: distinctFactoryLiterals.size, script: counters.factoryTables },
      { counter: 'factoryRows', scan: factoryRows.length, script: counters.factoryRows },
      {
        counter: 'handRolledDeclared',
        scan: HAND_ROLLED_TABLES.length,
        script: counters.handRolledDeclared,
      },
      {
        counter: 'handRolledTables',
        scan: ownHandRolledLabels.length,
        script: counters.handRolledTables,
      },
      {
        counter: 'handRolledAlreadyFactoryCovered',
        scan: overlappingHandRolledLabels.length,
        script: counters.handRolledAlreadyFactoryCovered,
      },
      {
        counter: 'handRolledRows',
        scan: ownHandRolledRows.length,
        script: counters.handRolledRows,
      },
    ];

    const divergent = comparisons
      .filter(({ scan: left, script: right }) => left !== right)
      .map(
        ({ counter, scan: left, script: right }) =>
          `${counter}: defaults-table-scan.ts -> ${left}, check-i18n-call-site-keys.mjs -> ${right}`,
      );

    expect(
      divergent,
      'The two walks over the createSafeTranslation defaults population no longer agree. One of ' +
        'them has learned a table shape, a factory alias or a row form the other has not — teach ' +
        'the other one too. If the population itself changed shape (a table passed to two ' +
        'factories, a nested or unreadable row), update this file\'s header mapping deliberately. ' +
        'Do NOT relax this gate: a gate reporting full coverage of a population the other walk ' +
        'has already grown past is exactly what it exists to prevent.',
    ).toEqual([]);
  });
});
