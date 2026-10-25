/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7697 — `ComboboxOption` is reachable from BOTH published entry
 * points of `@object-ui/types`: the root barrel and the `/form` subpath.
 *
 * ## The defect
 *
 * objectui#7691 made this package the single AUTHORITY for `ComboboxOption`:
 * `@object-ui/components` stopped declaring its own copy and now re-exports
 * this one (`packages/components/src/custom/combobox.tsx` imports and
 * re-exports it `from "@object-ui/types/form"`). But the authority was
 * reachable only through that subpath. Measured on `origin/main` `a4611b3e2`,
 * with the same word-boundary grep on `packages/types/src/index.ts`:
 *
 *   | name                       | hits |
 *   | -------------------------- | ---: |
 *   | `ComboboxOption`           |    0 |
 *   | `SelectOption`   (control) |    2 |
 *   | `RadioOption`    (control) |    1 |
 *   | `ComboboxSchema` (control) |    1 |
 *
 * The instrument was lit — the three controls read non-zero under the same
 * query — so the zero was a reading, not a dark instrument. The consequence a
 * consumer saw was `TS2305` on `import type { ComboboxOption } from
 * '@object-ui/types'` while the two sibling option types on the same list,
 * `SelectOption` and `RadioOption`, resolved.
 *
 * ⛔ This is NOT a defect in objectui#7691. The subpath was chosen there
 * deliberately (the root barrel was held by objectui#7683 at the time, and a
 * barrel line would have been both a fence breach and a second
 * published-surface addition), and that review judged it sound on its own
 * merits — the subpath is a house pattern, alongside `@object-ui/types/zod`
 * and `@object-ui/types/internal/retired-field-keys`. This card is the
 * follow-up objectui#7691 could not take.
 *
 * ## Why BOTH spellings are pinned, and not just the new one
 *
 * The fix is ADDITIVE: one name added to the root barrel's existing named
 * re-export list. Nothing is removed, retyped or narrowed, and the subpath
 * keeps working. That is exactly the property a later "tidy" is most likely to
 * undo without noticing — having put the name on the barrel, dropping the
 * `./form` subpath or the components-side import looks like cleanup. Pinning
 * only the root spelling would have let that through green. So both are
 * asserted, at the type level AND at the manifest level, and neither is
 * allowed to stand in for the other.
 *
 * ## Why there is a SOURCE scan next to the type-level pins
 *
 * The type-level pins below are erased by the compiler, so they say nothing
 * during `pnpm test` — their enforcement is `tsc -p tsconfig.test.json`, the
 * third leg of this package's `type-check` script, which CI runs as its own
 * job. The source scan is the half that runs under `vitest`, and it is
 * deliberately NOT a `dist/` read: this repo's per-PR `test` job runs
 * `pnpm test` with no build step ahead of it (turbo's `test` task depends on
 * `^build`, the DEPENDENCY closure, never the package's own build), so a test
 * that needed a fresh `dist/` would be vacuously absent-or-red on a cold
 * cache. `package-exports-manifest.test.ts` records that same constraint for
 * the same package; this file follows it rather than re-litigating it.
 *
 * The scan also pins the two shapes the card ruled out by name:
 * ⛔ the list must stay an EXPLICIT named list, never `export * from
 * './form.js'` (a wildcard would satisfy "the name is reachable" while
 * deleting the deliberate list — and would publish every other name in
 * `form.ts` as a side effect), and ⛔ the declaration must stay in `form.ts`,
 * never move to `index.ts`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

import type { ComboboxOption as FromRootBarrel } from '../index';
import type { ComboboxOption as FromFormSubpath } from '../form';
// The two controls: sibling option types that were ALREADY on the root
// barrel's `./form.js` list before this change. If either of these fails to
// resolve, every reading in this file is dark.
import type { SelectOption as SelectFromRootBarrel } from '../index';
import type { RadioOption as RadioFromRootBarrel } from '../index';

const require = createRequire(import.meta.url);

const readSource = (relative: string): string =>
  readFileSync(require.resolve(relative), 'utf8');

const INDEX_SRC = readSource('../index.ts');
const FORM_SRC = readSource('../form.ts');

const pkg = JSON.parse(readSource('../../package.json')) as {
  exports?: Record<string, Record<string, string> | string>;
};

/**
 * Invariant type equality — the house spelling (`chart-series-keys-7546`,
 * `chat-message-avatar-keys-7295`, and others). Assignability alone would call
 * a widened or `any`-resolved type a match; this does not.
 */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * The bodies of every `export type { … } from './form.js';` clause in the root
 * barrel. There is exactly one, and the assertion below says so.
 *
 * The brace class is load-bearing, not tidiness. A lazy `[\s\S]*?` body reads
 * TWO matches here: the second one opens at some later `export type {` block
 * and closes on `index.ts`'s `import type { FormComponentSchema } from
 * './form.js';` — the only other line in the file ending in that exact
 * sequence — swallowing every export clause in between. Measured: it returned
 * 2, and the count assertion is what caught it.
 */
const formReExportBodies = (): string[] =>
  [...INDEX_SRC.matchAll(/export type \{([^{}]*?)\} from '\.\/form\.js';/gu)].map((m) => m[1] ?? '');

/** Every name on the root barrel's `./form.js` named re-export list. */
const formReExportNames = (): string[] => {
  const bodies = formReExportBodies();
  // One clause, or the extraction below is reading a shape this file was not
  // written against and every membership answer under it is unreliable.
  expect(bodies).toHaveLength(1);
  return (bodies[0] ?? '')
    .split('\n')
    .map((line) => line.trim())
    // Drop the prose. The list carries `//` commentary that spells sibling
    // names (`SelectOption`, `RadioOption`), so a substring read of the raw
    // block would count comments as exports and the controls would read high
    // for the wrong reason.
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .map((line) => /^([A-Za-z_$][\w$]*)\s*,?$/u.exec(line)?.[1] ?? '')
    .filter((name) => name.length > 0);
};

/* ── (a) the type level: both spellings resolve, to ONE declaration ───────── */

describe('objectui#7697 — `ComboboxOption` resolves from BOTH entry points', () => {
  it('resolves from the ROOT barrel, with its three declared members', () => {
    // RED on the untouched base: `../index` has no exported member
    // `ComboboxOption`, so the import above fails to resolve under
    // `tsc -p tsconfig.test.json` (TS2305) and each alias below is an error.
    //
    // Members are pinned one at a time rather than as a whole-shape equality:
    // a later key ADDED to the declaration is a decision for its own card, not
    // a reason for this one to red, but a member RETYPED here would be exactly
    // the "nothing retyped or narrowed" claim breaking.
    const value: Eq<FromRootBarrel['value'], string> = true;
    const label: Eq<FromRootBarrel['label'], string> = true;
    const disabled: Eq<FromRootBarrel['disabled'], boolean | undefined> = true;
    expect([value, label, disabled]).toEqual([true, true, true]);
  });

  it('STILL resolves from the `/form` subpath — the fix removes nothing', () => {
    const value: Eq<FromFormSubpath['value'], string> = true;
    const label: Eq<FromFormSubpath['label'], string> = true;
    const disabled: Eq<FromFormSubpath['disabled'], boolean | undefined> = true;
    expect([value, label, disabled]).toEqual([true, true, true]);
  });

  it('the two spellings are the SAME declaration, not two forks of one name', () => {
    // The point of objectui#7691 was one authority. A root-barrel line that
    // published a *different* `ComboboxOption` would satisfy both assertions
    // above and still reintroduce the two-meanings defect
    // `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` guards.
    const same: Eq<FromRootBarrel, FromFormSubpath> = true;
    expect(same).toBe(true);
  });

  it('CONTROL — the two sibling option types already on the list still resolve', () => {
    const select: Eq<SelectFromRootBarrel['value'], string | number | boolean> = true;
    const radio: Eq<RadioFromRootBarrel['value'], string | number> = true;
    expect([select, radio]).toEqual([true, true]);
  });
});

/* ── (b) the source: an explicit named list, the declaration left in place ── */

describe('objectui#7697 — the root barrel lists the name, explicitly', () => {
  it('`ComboboxOption` is on the `./form.js` named re-export list', () => {
    // RED on the untouched base: the list closed without this name.
    expect(formReExportNames()).toContain('ComboboxOption');
  });

  it('CONTROL — the siblings and the schema are on the same list', () => {
    // If these three fail, the extraction is dark and the reading above says
    // nothing. They are the same three controls the card measured.
    const names = formReExportNames();
    expect(names).toEqual(expect.arrayContaining(['SelectOption', 'RadioOption', 'ComboboxSchema']));
  });

  it('the list is still an EXPLICIT named list — no wildcard from `./form.js`', () => {
    // ⛔ Ruled out by the card. A wildcard would make the assertion above
    // vacuous and would publish every other name in `form.ts` as a side
    // effect — a far wider surface change than the one this card authorises.
    expect(INDEX_SRC).not.toMatch(/export (?:type )?\* (?:as \w+ )?from '\.\/form\.js';/u);
  });

  it('the declaration did NOT move — `form.ts` still owns it', () => {
    // ⛔ Also ruled out by the card: the fix is a barrel line, not a
    // relocation. `index.ts` re-exports; it never declares.
    expect(FORM_SRC).toMatch(/^export interface ComboboxOption\b/mu);
    expect(INDEX_SRC).not.toMatch(/\b(?:interface|type)\s+ComboboxOption\b/u);
  });
});

/* ── (c) the manifest: the subpath cannot be silently dropped ─────────────── */

describe('objectui#7697 — the `/form` subpath stays a published entry point', () => {
  it('`exports["./form"]` still points at the built `form` entry', () => {
    // The type-level pin above proves `../form` COMPILES; only this proves the
    // spelling `@object-ui/types/form` is still resolvable by a consumer.
    // `packages/components/src/custom/combobox.tsx` is the live one.
    expect(pkg.exports?.['./form']).toEqual({
      types: './dist/form.d.ts',
      import: './dist/form.js',
    });
  });

  it('CONTROL — the root entry point is declared too', () => {
    // Its exact shape is pinned by `package-exports-manifest.test.ts`
    // (objectui#4896); restated here only as the control that keeps the
    // reading above from being a dark instrument.
    expect(pkg.exports?.['.']).toBeDefined();
  });
});
