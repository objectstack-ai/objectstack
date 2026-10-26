/**
 * objectui#9092 — the DECLARED face of group A accepts the spec's inline locale
 * map, and the three pairs no longer restate the key as a plain `string`.
 *
 * ## What this pins, and why the pin has to be two-sided
 *
 * objectui#4580's revised Q1 ruling (option A) widened the label keys to the
 * spec's INLINE locale map, and `BaseSchema` carries it on both faces. Three
 * pairs restated the key as a plain `string`, which is a NARROWING override of
 * the inherited member — so their zod mirrors accepted an authored locale map
 * and `tsc` refused it. The narrowing sat on the DECLARED side, where a forward
 * mirror-vs-declaration comparison reads the pair as clean; `zod-mirror-parity`'s
 * `WiderThanDeclared` ledger is the instrument that saw it, and its entries for
 * these keys retired with this card.
 *
 * A one-sided pin would have gone green for the wrong reason while `BaseSchema`
 * carried `[key: string]: any` (until objectui#8347): a key REMOVED from a
 * declaration type-checked exactly like a key WIDENED — the assignment below
 * would have kept compiling if someone deleted the member outright. So each positive case is paired with a
 * `@ts-expect-error` negative on a key that is genuinely a plain `string`: a
 * `@ts-expect-error` whose error stops occurring is itself a compile error, so
 * that half fails loudly if the narrow face ever becomes uncheckable.
 *
 * ⚠️ The vocabulary split this card does NOT touch. The FLAT
 * `BaseSchema.ariaLabel` is the KEYED form (`{ key, defaultValue?, params? }`,
 * resolved by `resolveKeyedI18nLabel`), and objectui#4580 Q2-B withdrew the
 * `I18nLabel` spelling there as measured-wrong. The NESTED `aria.ariaLabel`
 * asserted below is the INLINE form — the spec's own `AriaPropsSchema`
 * spelling, and the one objectui#5134 made `ListView` resolve with
 * `resolveI18nLabel`.
 *
 * ⚠️ What this file asserts about the FLAT key, exactly. Only that an inline
 * map is REFUSED there. The four widening cases are the three NESTED/INLINE
 * members plus the `BaseSchema` reference face, and that reference case asserts
 * `label` and `description` — `BaseSchema.ariaLabel` has no positive assertion
 * anywhere in this file. An earlier draft of this header said "both are
 * asserted here, each against its own vocabulary"; it overstated what is here.
 *
 * ⚠️ And neither vocabulary admits the other. An earlier draft said the two
 * shapes "each accept the other vacuously" — quoted from objectui#4580 Q2-B,
 * true when that was written and measured FALSE on the installed pin.
 * `InlineLocaleMapSchema` types its map with `key?: never; defaultValue?: never`
 * and its own `INLINE_LOCALE_KEY` pattern excludes both names, so the cross
 * assignment is refused at `tsc` AND at parse. The last describe block below is
 * the instrument that re-derives that on every run — read it rather than this
 * sentence. What a wrong slot still costs is a wrong ANSWER, not a silent
 * acceptance: `resolveI18nLabel` hands a keyed ref back as its own `key` string.
 * So the advice is unchanged — check which resolver owns a slot before writing
 * an object into it.
 *
 * ⚠️ Two halves, two runners. Every `@ts-expect-error` and every typed
 * assignment below is read ONLY by `tsc -p packages/types/tsconfig.test.json`
 * (the package `type-check` script, and CI's Type Check job). `vitest` strips
 * types, so a vitest-only run is a FALSE GREEN on that half of this file.
 */
import { describe, it, expect } from 'vitest';
import type { I18nLabel } from '@objectstack/spec/ui';

import type { AppComponentSchema } from '../app';
import type { ObjectGridSchema } from '../objectql';
import type { PageNodeSchema } from '../layout';
import type { BaseSchema } from '../base';

import { AppComponentSchema as AppComponentMirror } from '../zod/app.zod.js';
import { ObjectGridSchema as ObjectGridMirror } from '../zod/objectql.zod.js';
import { PageNodeSchema as PageNodeMirror } from '../zod/layout.zod.js';

/** The spec's inline locale map, as an author writes it. */
const LOCALE_MAP: I18nLabel = { en: 'Accounts', 'fr-FR': 'Comptes' };

describe('objectui#9092 — declared face admits the inline locale map', () => {
  it('AppComponentSchema.label takes the map, and a plain-string sibling still refuses one', () => {
    const widened: AppComponentSchema = { type: 'app', label: LOCALE_MAP };

    // CONTROL — `icon` is a genuinely plain `string` on the same interface and
    // is NOT in this card's scope. If this directive ever reports "unused", the
    // widening has leaked past the keys the ruling names.
    // @ts-expect-error `icon` is `string`; the map is refused here and must stay refused.
    const control: AppComponentSchema = { type: 'app', icon: LOCALE_MAP };

    expect(widened.label).toEqual(LOCALE_MAP);
    expect(control.icon).toEqual(LOCALE_MAP);
  });

  it('ObjectGridSchema.label and .description take the map; `objectName` still refuses one', () => {
    const label: ObjectGridSchema = { type: 'object-grid', objectName: 'accounts', label: LOCALE_MAP };
    const description: ObjectGridSchema = { type: 'object-grid', objectName: 'accounts', description: LOCALE_MAP };

    // CONTROL — `objectName` is a required plain `string` on the same interface.
    // @ts-expect-error `objectName` is `string`; the map is refused here and must stay refused.
    const control: ObjectGridSchema = { type: 'object-grid', objectName: LOCALE_MAP };

    expect(label.label).toEqual(LOCALE_MAP);
    expect(description.description).toEqual(LOCALE_MAP);
    expect(control.objectName).toEqual(LOCALE_MAP);
  });

  it('PageNodeSchema.aria.ariaLabel takes the map; the sibling `ariaDescribedBy` still refuses one', () => {
    const widened: PageNodeSchema = { type: 'page', aria: { ariaLabel: LOCALE_MAP } };

    // CONTROL — `ariaDescribedBy` is an ID reference, `string` in the spec's own
    // `AriaPropsSchema`. It is the sibling KEY on the SAME object, so it also
    // proves the widening landed on one member rather than on the whole slot.
    // @ts-expect-error `ariaDescribedBy` is `string`; the map is refused here and must stay refused.
    const control: PageNodeSchema = { type: 'page', aria: { ariaDescribedBy: LOCALE_MAP } };

    expect(widened.aria?.ariaLabel).toEqual(LOCALE_MAP);
    expect(control.aria?.ariaDescribedBy).toEqual(LOCALE_MAP);
  });

  it('the reference face did not move: BaseSchema.label already took the map before this card', () => {
    // objectui#4580's revised Q1 ruling landed here, and this card is forbidden
    // from touching `base.ts`. This case is the control that holds still.
    const reference: BaseSchema = { type: 'text', label: LOCALE_MAP, description: LOCALE_MAP };
    expect(reference.label).toEqual(LOCALE_MAP);
    expect(reference.description).toEqual(LOCALE_MAP);
  });
});

describe('objectui#9092 — the zod mirrors already accepted what tsc refused', () => {
  // The card's item 4: a mirror that did NOT accept the map would make the pair a
  // defect in the OPPOSITE direction, to be reported rather than silently fixed.
  // Every one of them accepts it, so the repair is declaration-only.
  it('the mirror accepts the map on every key this card widened', () => {
    expect(AppComponentMirror.safeParse({ type: 'app', label: LOCALE_MAP }).success).toBe(true);
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', label: LOCALE_MAP }).success).toBe(true);
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', description: LOCALE_MAP }).success).toBe(true);
    expect(PageNodeMirror.safeParse({ type: 'page', name: 'home', aria: { ariaLabel: LOCALE_MAP } }).success).toBe(true);
  });

  it('CONTROL — the same mirrors still refuse a value no arm admits', () => {
    // Without this, the assertions above pass on a mirror that accepts anything.
    expect(AppComponentMirror.safeParse({ type: 'app', label: 42 }).success).toBe(false);
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', label: 42 }).success).toBe(false);
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', description: 42 }).success).toBe(false);
    expect(PageNodeMirror.safeParse({ type: 'page', name: 'home', aria: { ariaLabel: 42 } }).success).toBe(false);
  });
});

/**
 * objectui#9092 — the two vocabularies do not admit each other, on either face.
 *
 * This block exists because the header used to ASSERT that in prose, in words
 * ("each accepts the other vacuously") that an instrument now refutes. AGENTS.md
 * #9: point at the thing that re-derives the claim instead of writing the answer
 * down. So the claim lives here, where every run re-derives it, and the header
 * points at this block.
 *
 * ⚠️ The `tsc` half and the `safeParse` half are read by DIFFERENT runners —
 * see the header. Both are needed: the type face and the parse face are
 * separate contracts, and this pair is precisely where they were once believed
 * to disagree.
 */
describe('objectui#9092 — the INLINE and KEYED vocabularies refuse each other', () => {
  /** objectui's KEYED reference — legal on the FLAT `BaseSchema.ariaLabel`, nowhere below. */
  const KEYED_REF = { key: 'grid.accounts', defaultValue: 'Accounts' };

  it('tsc: a keyed ref is refused by every member this card widened', () => {
    // @ts-expect-error `label` is `string | I18nLabel`; `key`/`defaultValue` are `never` on the map arm.
    const grid: ObjectGridSchema = { type: 'object-grid', objectName: 'accounts', label: KEYED_REF };
    // @ts-expect-error same arm, same refusal.
    const app: AppComponentSchema = { type: 'app', label: KEYED_REF };
    // @ts-expect-error the NESTED aria slot is the inline vocabulary too.
    const page: PageNodeSchema = { type: 'page', aria: { ariaLabel: KEYED_REF } };

    expect(grid.label).toEqual(KEYED_REF);
    expect(app.label).toEqual(KEYED_REF);
    expect(page.aria?.ariaLabel).toEqual(KEYED_REF);
  });

  it('tsc: an inline map is refused by the FLAT `BaseSchema.ariaLabel`, which the keyed ref owns', () => {
    // @ts-expect-error `ariaLabel` is `string | KeyedI18nLabel`; an inline map is excess there.
    const refused: BaseSchema = { type: 'text', ariaLabel: LOCALE_MAP };

    // CONTROL — the keyed ref IS legal here. Without this the negative above
    // would also pass on a slot that refused every object, which would say
    // nothing about the two vocabularies.
    const accepted: BaseSchema = { type: 'text', ariaLabel: KEYED_REF };

    expect(refused.ariaLabel).toEqual(LOCALE_MAP);
    expect(accepted.ariaLabel).toEqual(KEYED_REF);
  });

  it('parse: the mirrors refuse a keyed ref on the same keys that take the map', () => {
    expect(AppComponentMirror.safeParse({ type: 'app', label: KEYED_REF }).success).toBe(false);
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', label: KEYED_REF }).success).toBe(false);
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', description: KEYED_REF }).success).toBe(false);
    expect(PageNodeMirror.safeParse({ type: 'page', name: 'home', aria: { ariaLabel: KEYED_REF } }).success).toBe(false);
  });

  it('parse CONTROL — the keyed ref is a legal value on the FLAT `ariaLabel`', () => {
    // The refusals above are about the SLOT, not about the value: the same
    // object parses green one property away, on the key that owns it.
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', ariaLabel: KEYED_REF }).success).toBe(true);
    // …and the inline map is refused THERE, the other direction of the same split.
    expect(ObjectGridMirror.safeParse({ type: 'object-grid', objectName: 'accounts', ariaLabel: LOCALE_MAP }).success).toBe(false);
  });
});
