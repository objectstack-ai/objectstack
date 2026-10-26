/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every name `src/form.ts` exports is on the root barrel's `./form.js` named
 * re-export list -- or it is ledgered below with the reason it is not
 * (objectui#9406).
 *
 * ## The defect this closes, twice over
 *
 * `@object-ui/types` publishes the same declarations through more than one
 * entry point: the root (`.`), the `./form` subpath, and -- for the zod twins
 * -- `./zod`. `index.ts` re-exports `form.ts` through an EXPLICIT named list,
 * so a declaration added to `form.ts` and not to that list is published on the
 * subpath and invisible from the root, with nothing to say whether that was a
 * decision or an oversight.
 *
 * It has now been found three times, one card at a time:
 *
 *  - objectui#7697 -- `ComboboxOption`. `import type { ComboboxOption } from
 *    '@object-ui/types'` read `TS2305` while its two siblings on the same list
 *    resolved. Repaired by one additive barrel line.
 *  - objectui#9406 -- `InputShorthandSchema` and `UiCalendarSchema`, armed on
 *    the zod barrel by objectui#9067 and still unnamed on this one. Repaired
 *    the same way, by the director seat's decision batch #133 item 2, letter
 *    (a), maintainer 2026-09-14.
 *  - objectui#9526 -- `CommandItem` and `CommandGroup`, the element types of
 *    `CommandSchema.groups` and its `items`. THIS pin found them on its first
 *    run and ledgered them `ABSENT_PENDING_DECISION`, because objectui#9406
 *    authorised exactly two names; objectui#9526 moved both onto the list by
 *    the same additive route and emptied that ledger.
 *
 * ⭐ What made the second one worse than "the name is not there" is the
 * compiler's guess: the root spelling answered `error TS2724: '"@object-ui/
 * types"' has no exported member named 'UiCalendarSchema'. Did you mean
 * 'CalendarSchema'?` and `... named 'InputShorthandSchema'. Did you mean
 * 'InputOTPSchema'?`. Those are DIFFERENT components -- `ui:calendar` and
 * `calendar` resolve to different renderers, and `InputOTPSchema` is not an
 * input at all. An author following the suggestion writes an import that
 * compiles and means something else, which is worse than one that fails.
 *
 * ## Why this pin is DERIVED and not a pair of presence assertions
 *
 * ⛔ A pin reading "`InputShorthandSchema` and `UiCalendarSchema` are present"
 * would pass on the day a thirty-third declaration lands in `form.ts` and is
 * forgotten -- which is this class reopening a third time, the exact thing the
 * ruling asked to be made impossible. So the population is DERIVED on every
 * run from `form.ts`'s own export statements, the barrel's list is derived from
 * the clause itself, and the verdict is the SET DIFFERENCE. No count and no
 * name list is written down here except in the ledger, where each row is a
 * decision carrying its reason.
 *
 * ⚠️ Every name a ledger row holds is re-checked for LIVENESS: a row whose name
 * `form.ts` no longer declares, or which has since reached the barrel, fails
 * this file. A ledger that keeps rows after their reason is gone stops being
 * read -- and the whole value of ledgering an absence is that the reason lives
 * in the tree rather than in a `.changeset/*.md` the next release deletes.
 *
 * ## Two legs, because one of them is invisible to `vitest`
 *
 * The type-level block is erased by the compiler and says nothing during
 * `pnpm test`; its enforcement is `tsc -p tsconfig.test.json`, the third leg of
 * this package's `type-check` script, which CI runs as its own job. The source
 * scan is the half that runs under `vitest`. It is deliberately NOT a `dist/`
 * read, for the reason `combobox-option-root-barrel-7697.test.ts` and
 * `package-exports-manifest.test.ts` already record for this package: the
 * per-PR `test` job runs `pnpm test` with no build ahead of it, so a test
 * needing a fresh `dist/` would be vacuously absent-or-red on a cold cache.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

// The names this card added. RED on the untouched base: `../index` has no
// exported member with either name, so these imports do not resolve under
// `tsc -p tsconfig.test.json` and every alias below is an error.
import type { InputShorthandSchema as ShorthandFromRoot } from '../index';
import type { UiCalendarSchema as UiCalendarFromRoot } from '../index';
import type { InputShorthandSchema as ShorthandFromForm } from '../form';
import type { UiCalendarSchema as UiCalendarFromForm } from '../form';
// The controls: the two schemas each of the above NARROWS, both already on the
// root barrel's list before this change. If either fails to resolve, every
// type-level reading in this file is dark.
import type { InputSchema as InputFromRoot } from '../index';
import type { CalendarSchema as CalendarFromRoot } from '../index';

// objectui#9526 -- the element types of `CommandSchema.groups` and its `items`.
// RED on the base that card measured: `TS2305` on each root spelling below,
// while the `/form` spellings and the control resolve in the same pass.
import type { CommandItem as CommandItemFromRoot } from '../index';
import type { CommandGroup as CommandGroupFromRoot } from '../index';
import type { CommandItem as CommandItemFromForm } from '../form';
import type { CommandGroup as CommandGroupFromForm } from '../form';
// The control: the schema that CONTAINS them, already on the root barrel's
// list before objectui#9526. If it fails to resolve, the block is dark.
import type { CommandSchema as CommandFromRoot } from '../index';

const require = createRequire(import.meta.url);

const readSource = (relative: string): string => readFileSync(require.resolve(relative), 'utf8');

const INDEX_SRC = readSource('../index.ts');
const FORM_SRC = readSource('../form.ts');
const LAYOUT_SRC = readSource('../layout.ts');

/**
 * Invariant type equality -- the house spelling
 * (`combobox-option-root-barrel-7697`, `chart-series-keys-7546`, and others).
 * Assignability alone would call a widened or `any`-resolved type a match; this
 * does not.
 */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/* == the two populations ==================================================== */

/**
 * The bodies of every `export type { ... } from '<module>';` clause in the root
 * barrel, for one module.
 *
 * The `[^{}]` body class is load-bearing, not tidiness, and the reason is
 * recorded on `combobox-option-root-barrel-7697.test.ts`: a lazy `[\s\S]*?`
 * body reads a SECOND match here, opening at a later `export type {` block and
 * closing on `index.ts`'s own `import type { FormComponentSchema } from
 * './form.js';` -- the only other line ending in that exact sequence --
 * swallowing every export clause in between. The clause-count assertion below
 * is what catches that, so it is never skipped.
 */
const reExportBodies = (module: string): string[] => {
  const pattern = new RegExp(`export type \\{([^{}]*?)\\} from '\\.\\/${module}\\.js';`, 'gu');
  return [...INDEX_SRC.matchAll(pattern)].map((m) => m[1] ?? '');
};

/** Every name on the root barrel's named re-export list for one module. */
const reExportNames = (module: string): string[] => {
  const bodies = reExportBodies(module);
  // Exactly one clause, or the extraction is reading a shape this file was not
  // written against and every membership answer under it is unreliable.
  expect(
    bodies,
    `Expected exactly one \`export type { ... } from './${module}.js';\` clause in index.ts. `
    + 'Every reading in this file is a membership test against that one clause; with a '
    + 'different number of them this file measures nothing rather than measuring wrong.',
  ).toHaveLength(1);
  return (bodies[0] ?? '')
    .split('\n')
    .map((line) => line.trim())
    // Drop the prose. This list carries `//` commentary that spells sibling
    // names, so a substring read of the raw block would count comments as
    // exports -- and the controls would read high for the wrong reason.
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .map((line) => /^([A-Za-z_$][\w$]*)\s*,?$/u.exec(line)?.[1] ?? '')
    .filter((name) => name.length > 0);
};

/**
 * Every name a module publishes: the declarations it exports, plus the names on
 * any `export { ... };` clause it carries.
 *
 * ⚠️ The clause half is not hypothetical -- `layout.ts` carries
 * `export type { PageVariable };`, and a declaration-only scan reported that
 * module one name short. A population that under-reports is worse than a
 * missing one here: it is the DENOMINATOR of the gap below, so every name it
 * misses is a gap entry that silently never appears.
 *
 * ⛔ A STAR re-export cannot be read from source at all -- the names are in
 * another module and only a resolver knows them -- so `no module under this pin
 * star-re-exports` below fails rather than letting the population go quietly
 * short again.
 */
const declaredExports = (source: string): string[] => {
  const declarations = [...source.matchAll(/^export (?:declare )?(?:abstract )?(?:interface|type|const|let|function|class|enum)\s+([A-Za-z_$][\w$]*)/gmu)]
    .map((m) => m[1] ?? '');
  // `export { A, B as C };` and `export type { D } from './x.js';` alike. The
  // EXPORTED spelling is what a consumer can name, so an `as` alias contributes
  // its right-hand side.
  const clauses = [...source.matchAll(/^export (?:type )?\{([^{}]*)\}[^;]*;/gmu)]
    .flatMap((m) => (m[1] ?? '').split(','))
    .map((entry) => entry.trim().replace(/^type\s+/u, ''))
    .map((entry) => (/\sas\s/u.test(entry) ? entry.split(/\sas\s/u)[1] ?? '' : entry))
    .map((entry) => entry.trim());
  return [...declarations, ...clauses].filter((name) => /^[A-Za-z_$][\w$]*$/u.test(name));
};

const FORM_DECLARED = declaredExports(FORM_SRC);
const BARREL_FORM_NAMES = reExportNames('form');

/** The verdict: declared by `form.ts`, not carried by the barrel. */
const GAP = FORM_DECLARED.filter((name) => !BARREL_FORM_NAMES.includes(name));

/* == the ledger ============================================================= */

/*
 * ⛔ NOT a claim that every name in `form.ts` must be on the barrel -- only that
 * the answer is DECLARED, in the tree, where it is re-read on every run. The
 * shape is the one `arm-named-export-8784.test.ts` settled on for the zod
 * barrel: two ledgers, because "someone decided not to" and "nobody has decided
 * yet" are different facts and collapsing them loses the one that still needs
 * an owner.
 */

/** Names whose absence from the barrel is a decision someone took, with its reason. */
const ABSENT_BY_DECISION: Readonly<Record<string, string>> = {};

/**
 * Names whose absence from the barrel is UNDECIDED -- no ruling covers them.
 *
 * ⛔ Do not repurpose this as a second `ABSENT_BY_DECISION`. A row here means
 * "nobody has decided yet", and it is the honest answer for a name a card found
 * but was not authorised to move.
 */
const ABSENT_PENDING_DECISION: Readonly<Record<string, string>> = {};
// Empty since objectui#9526: its two rows, `CommandItem` and `CommandGroup`,
// were settled by putting both names on the barrel list, so the liveness check
// below would have failed them as stale.

const LEDGER: Readonly<Record<string, string>> = { ...ABSENT_BY_DECISION, ...ABSENT_PENDING_DECISION };

/**
 * Own-key test. ⛔ Not `key in ledger`: these are plain object literals, so `in`
 * answers `true` for every `Object.prototype` key, and a declaration named
 * `constructor` or `toString` would ledger itself. ⛔ Not `Object.hasOwn`
 * either -- `arm-named-export-8784.test.ts` measured that it does not compile
 * under this package's `lib`, and moving the `lib` is not this pin's to do.
 */
function hasRow(ledger: Readonly<Record<string, string>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(ledger, key);
}

/* == the exclusions recorded by the ruling, which live in ANOTHER module ===== */

/**
 * `SemanticElementSchema` / `HtmlElementSchema` -- recorded here because
 * objectui#9406's ruling asks for them by name, and checked so the record
 * cannot rot.
 *
 * ⚠️ They are NOT rows of the ledger above, and the distinction is the whole
 * reason this block is separate: both are declared in `layout.ts`, not
 * `form.ts`, so they are outside the population this pin computes. A ledger row
 * for a name this file's denominator never contains would be a claim nothing
 * re-derives.
 *
 * What IS settled, and where: objectui#9067 (director seat, decision batch #121
 * item 5, maintainer 2026-09-12) ruled the pair ABSENT BY DECISION from the
 * `./zod` barrel, on the reason objectui#8499 recorded when it armed the arms
 * and deferred the naming -- exporting a `SemanticElementSchema` /
 * `HtmlElementSchema` pair "would publish a NAMED authoring surface (`z.enum`
 * families, not per-tag schemas) that this card's ruling does not cover".
 * Splitting the families into per-tag schemas was ruled out in the same record
 * as expansion for a consumer nobody has measured. `arm-named-export-8784.
 * test.ts` holds that ruling's own rows for the zod side.
 *
 * ⛔ Their absence from the TYPESCRIPT root barrel is a different question and
 * objectui#9406 deliberately did not widen to it: the filing card says so in as
 * many words ("their TS counterparts raise a different question and should not
 * ride on this one"). So what is asserted below is only what is true today --
 * they are declared in `layout.ts` and the root barrel's `./layout.js` list
 * does not carry them. The day a ruling puts either on that list, this block
 * fails and asks for the record to be updated, which is the point of writing it
 * down at all.
 */
const EXCLUDED_BY_RULING_ELSEWHERE = ['SemanticElementSchema', 'HtmlElementSchema'] as const;

/* == (a) the type level: both names resolve from the ROOT entry point ======== */

describe('objectui#9406 -- the two names resolve from the root barrel', () => {
  it('`InputShorthandSchema` resolves from the root, with its narrowed `type`', () => {
    // `InputSchema` without `type` / `inputType`, re-narrowed: `type` is the two
    // shorthand literals, and `inputType` is unwritable here (objectui#8762).
    const type: Eq<ShorthandFromRoot['type'], 'email' | 'password'> = true;
    const inputType: Eq<ShorthandFromRoot['inputType'], undefined> = true;
    expect([type, inputType]).toEqual([true, true]);
  });

  it('`UiCalendarSchema` resolves from the root, with its namespaced `type`', () => {
    // `ui:calendar` and `calendar` are different components (objectui#8499):
    // this literal is the whole difference, so it is the member pinned.
    const type: Eq<UiCalendarFromRoot['type'], 'ui:calendar'> = true;
    expect(type).toBe(true);
  });

  it('each root spelling is the SAME declaration as its `/form` spelling', () => {
    // A barrel line publishing a DIFFERENT type under the same name would
    // satisfy both assertions above and reintroduce the two-meanings defect
    // `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` guards.
    const shorthand: Eq<ShorthandFromRoot, ShorthandFromForm> = true;
    const uiCalendar: Eq<UiCalendarFromRoot, UiCalendarFromForm> = true;
    expect([shorthand, uiCalendar]).toEqual([true, true]);
  });

  it('CONTROL -- the two schemas they narrow already resolved from the root', () => {
    const input: Eq<InputFromRoot['type'], 'input'> = true;
    const calendar: Eq<CalendarFromRoot['type'], 'calendar'> = true;
    expect([input, calendar]).toEqual([true, true]);
  });
});

describe('objectui#9526 -- the element types of `CommandSchema` resolve from the root barrel', () => {
  it('each root spelling is the element type the root `CommandSchema` actually contains', () => {
    // Pinned as the CONTAINMENT, not as a member list: `groups` holds
    // `CommandGroup`, and `CommandGroup.items` holds `CommandItem`. That is the
    // whole reason the card moved the pair together.
    const group: Eq<NonNullable<CommandFromRoot['groups']>[number], CommandGroupFromRoot> = true;
    const item: Eq<CommandGroupFromRoot['items'][number], CommandItemFromRoot> = true;
    expect([group, item]).toEqual([true, true]);
  });

  it('each root spelling is the SAME declaration as its `/form` spelling', () => {
    // The containment reading ties each root name to what the root
    // `CommandSchema` holds; this ties it to the `/form` spelling a subpath
    // consumer already imports, so the two entry points cannot drift apart.
    const item: Eq<CommandItemFromRoot, CommandItemFromForm> = true;
    const group: Eq<CommandGroupFromRoot, CommandGroupFromForm> = true;
    expect([item, group]).toEqual([true, true]);
  });

  it('CONTROL -- the schema that contains them already resolved from the root', () => {
    const command: Eq<CommandFromRoot['type'], 'command'> = true;
    expect(command).toBe(true);
  });
});

/* == (b) the instrument: the barrel list against `form.ts`'s exports ========= */

describe('objectui#9406 -- the root barrel mirrors `form.ts`, or says why not', () => {
  it('no `form.ts` export is missing from the barrel without a ledger row', () => {
    // `hasRow`, ⛔ not `in` -- see its docblock.
    const undeclared = GAP.filter((name) => !hasRow(LEDGER, name));
    expect(
      undeclared,
      'These names are exported by packages/types/src/form.ts and are NOT on the root barrel\'s '
      + "`./form.js` named re-export list, so `import type { X } from '@object-ui/types'` fails "
      + 'for each while its neighbours on the same list resolve -- and the compiler answers with '
      + 'a suggestion naming a DIFFERENT component, which is how objectui#9406 was found. Three '
      + "answers are acceptable and a fourth is not. Add the name to that list; or, if it is "
      + 'deliberately reachable only through the `@object-ui/types/form` subpath, add a row to '
      + 'ABSENT_BY_DECISION with the reason and the ruling; or, if naming it is a decision your '
      + 'card does not cover, add a row to ABSENT_PENDING_DECISION saying so. What is not '
      + 'acceptable is leaving the answer to be inferred from an absence.',
    ).toEqual([]);
  });

  it.each(Object.keys(LEDGER))('ledger row `%s` still names a live, still-absent export', (name) => {
    expect(
      FORM_DECLARED,
      `packages/types/src/form.ts no longer exports \`${name}\`. The ledger row in this file `
      + 'outlived the declaration it excused -- delete the row.',
    ).toContain(name);
    expect(
      BARREL_FORM_NAMES,
      `\`${name}\` IS on the root barrel's \`./form.js\` list now, so its ledger row is stale -- `
      + 'delete the row. A ledger that keeps rows after their reason is gone stops being read.',
    ).not.toContain(name);
  });

  it('states each absence once -- the two ledgers do not overlap', () => {
    const both = Object.keys(ABSENT_BY_DECISION).filter((key) => hasRow(ABSENT_PENDING_DECISION, key));
    expect(both, 'A name cannot be both a decision taken and a decision owed.').toEqual([]);
  });
});

/* == (c) the two exclusions objectui#9406 asked to be recorded =============== */

describe('objectui#9406 -- the recorded exclusions are outside this pin, and still absent', () => {
  it.each([...EXCLUDED_BY_RULING_ELSEWHERE])('`%s` is declared in `layout.ts`, not `form.ts`', (name) => {
    // Which is why it is not a ledger row above: this pin's denominator is
    // `form.ts`, so a row here would be a claim nothing re-derives.
    expect(declaredExports(LAYOUT_SRC)).toContain(name);
    expect(FORM_DECLARED).not.toContain(name);
  });

  it.each([...EXCLUDED_BY_RULING_ELSEWHERE])('`%s` is still absent from the root barrel', (name) => {
    expect(
      reExportNames('layout'),
      `\`${name}\` is on the root barrel's \`./layout.js\` list now. objectui#9406 deliberately `
      + 'did NOT widen to the TS counterparts of the two `z.enum` families objectui#9067 ruled '
      + 'absent by decision on the zod side, so this file records them as out of its scope. If a '
      + 'later ruling put the name there, that ruling -- not this one -- is now the record: '
      + 'update this block to cite it, or drop the name from EXCLUDED_BY_RULING_ELSEWHERE.',
    ).not.toContain(name);
  });
});

/* == (d) the shapes this ruling excluded ==================================== */

describe('objectui#9406 -- the list stays an explicit list and the declarations stay put', () => {
  it('no wildcard re-export from `./form.js`', () => {
    // ⛔ A wildcard would make every membership reading above vacuous AND
    // publish every other name in `form.ts` as a side effect -- a far wider
    // surface change than the two names this card authorises.
    expect(INDEX_SRC).not.toMatch(/export (?:type )?\* (?:as \w+ )?from '\.\/form\.js';/u);
  });

  it('no module under this pin star-re-exports -- the population stays readable', () => {
    // `declaredExports` reads declarations and named clauses. A STAR re-export
    // publishes names that are not in the file at all, so the population would
    // silently go short and the gap above would shrink with it. Fail here
    // instead of measuring a denominator this file cannot see.
    for (const [label, source] of [['form.ts', FORM_SRC], ['layout.ts', LAYOUT_SRC]] as const) {
      expect(source, `${label} grew a star re-export; its published names are no longer readable `
        + 'from this file and the gap computed above is measured against a short population.')
        .not.toMatch(/^export (?:type )?\*/mu);
    }
  });

  it('the declarations did NOT move -- `form.ts` still owns both', () => {
    // ⛔ The fix is two barrel lines, not a relocation. `index.ts` re-exports;
    // it never declares.
    expect(FORM_SRC).toMatch(/^export interface InputShorthandSchema\b/mu);
    expect(FORM_SRC).toMatch(/^export interface UiCalendarSchema\b/mu);
    expect(INDEX_SRC).not.toMatch(/\b(?:interface|type)\s+(?:InputShorthandSchema|UiCalendarSchema)\b/u);
  });

  it('CONTROL -- the extraction is lit on both sides', () => {
    // If these read empty or short, every verdict in this file is dark rather
    // than green. The four names are the card's own controls: two neighbours
    // already on the barrel list, and the two declarations it is about.
    expect(BARREL_FORM_NAMES).toEqual(expect.arrayContaining(['InputSchema', 'CalendarSchema']));
    expect(FORM_DECLARED).toEqual(
      expect.arrayContaining(['InputSchema', 'CalendarSchema', 'InputShorthandSchema', 'UiCalendarSchema']),
    );
    expect(BARREL_FORM_NAMES.length).toBeGreaterThan(0);
    // The barrel list is a SUBSET of what `form.ts` declares, by construction:
    // a name on it that the module does not declare means one of the two
    // extractions is reading the wrong thing, and the gap above is then a
    // difference between two populations that do not belong to each other.
    expect(
      BARREL_FORM_NAMES.filter((name) => !FORM_DECLARED.includes(name)),
      'The barrel re-exports these from `./form.js` and the declaration scan did not find them '
      + 'in form.ts. Either the module grew a shape `declaredExports` cannot read, or the clause '
      + 'extraction is picking up something that is not the form list.',
    ).toEqual([]);
  });
});
