// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `appDesigner.fieldDesigner.formula` is retired from all ten packs, and the
 * Field Designer vocabulary it sat in must keep naming real controls
 * (objectui#6310).
 *
 * ## What was removed and why
 *
 * One row per pack (`en: 'Formula'`, `zh: '公式'`, `ru: 'Формула'`, …). objectui#6043
 * retired the Field Designer's formula-expression textarea, which held the key's
 * ONLY call site — the `{ name: 'formula', label:
 * t('appDesigner.fieldDesigner.formula') }` field descriptor in
 * `FieldDesigner.tsx`. The label outlived the control it labelled by eleven
 * files: the ten packs, plus the `DESIGNER_DEFAULT_TRANSLATIONS` row that mirrors
 * them.
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site -> key**, never key -> call site
 * (objectui#4145's mechanism, restated by objectui#4392, objectui#4730 and
 * objectui#5504):
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` asks whether each call site's key
 *     resolves in `en`. A key with no call site is never visited.
 *   - `all-locales-key-parity.test.ts` compares the ten packs' key SETS to each
 *     other. One dead key present in all ten is exactly what it wants.
 *   - `scripts/check-i18n-en-drift.mjs` only fires when an `en` value CHANGES.
 *   - `scripts/check-i18n-dead-keys.mjs` IS the reverse direction, and it is
 *     report-only by design and wired into no workflow (objectui#4658).
 *
 * So the retired row can return to all ten packs with every gate green, and a
 * translator filling in "the missing formula label" is a plausible way for that
 * to happen — the surrounding vocabulary still describes a field editor, so the
 * gap reads like an oversight rather than a decision. Restoring it goes red here.
 *
 * ## The other half of the retirement is guarded elsewhere, on purpose
 *
 * The `DESIGNER_DEFAULT_TRANSLATIONS` row is pinned by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx` (objectui#4401),
 * which fails any map row whose key the `en` pack lacks. This file cannot assert
 * it: `@object-ui/plugin-designer` depends on `@object-ui/i18n`, so importing the
 * map back into this package inverts the dependency — the same reason #4401's
 * gate lives in `app-shell` and `gantt-count-interpolation-4157.test.ts` asserts
 * `en` values as literals. The two halves interlock: re-add the pack key and this
 * file reds; re-add the map row alone and #4401's gate reds.
 *
 * ## What this file does NOT claim
 *
 * - **`designer.field.formula` (`'Formula (CEL)'`) is a DIFFERENT, LIVE key** —
 *   metadata-admin's `ObjectFieldInspector`, the surface that still authors
 *   formula expressions, reads it from
 *   `packages/app-shell/src/views/metadata-admin/i18n.ts`. It is not in the
 *   locale packs and is out of this file's reach by the same dependency
 *   direction as above. Two keys end in `.formula`; only the
 *   `appDesigner.fieldDesigner.*` spelling is retired. Grep the full dotted path.
 * - **`appDesigner.fieldDesigner` is a live namespace.** Only the one leaf went;
 *   {@link SURVIVING} exists so a green here cannot be bought by deleting the
 *   neighbourhood.
 * - **{@link SURVIVING} is deliberately not "the rows next to it".** The row that
 *   followed the retired one (`options`) is absent from that list, along with
 *   `addOption`, `addRule`, `noFields`, `searchPlaceholder`, `systemBadge`,
 *   `ungrouped` and `validationRules`: objectui#6310 measured all eight as
 *   NEEDS-REVIEW candidates of the same reverse sweep, with the same
 *   defaults-map-only footprint the retired key had, and none of them has been
 *   individually confirmed either way (that is objectui#4730's job). Pinning
 *   "these survive" against keys that may themselves be dead would bake an
 *   unverified claim into the guard. Every key in {@link SURVIVING} was confirmed
 *   live by call site in `packages/plugin-designer/src/FieldDesigner.tsx`.
 *   objectui#11434 later settled two of the eight: `validationRules` and
 *   `addRule` labelled an editor for `DesignerFieldDefinition.validationRules`
 *   that was never built, and left the ten packs and the designer defaults map
 *   when that member was retired.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The retired leaf, named rather than counted. */
const RETIRED = 'appDesigner.fieldDesigner.formula';

/**
 * Rows the deletion swept around — each one confirmed live by a `t()` call site
 * in `FieldDesigner.tsx`, not merely by sitting nearby. `referenceTo` is the row
 * that immediately PRECEDED the retired one in every pack, and
 * `typeSpecificSection` is the drawer section the formula textarea used to be
 * rendered in, so a sweep that over-reached would land on them first.
 */
const SURVIVING = [
  'appDesigner.fieldDesigner.referenceTo',
  'appDesigner.fieldDesigner.typeSpecificSection',
  'appDesigner.fieldDesigner.defaultValue',
  'appDesigner.fieldDesigner.placeholder',
  'appDesigner.fieldDesigner.fieldType',
  'appDesigner.fieldDesigner.title',
  'appDesigner.fieldDesigner.allTypes',
] as const;

/**
 * The namespace's only dynamically built family —
 * ``t(`appDesigner.fieldDesigner.typeCategory.${cat}`)`` at
 * `FieldDesigner.tsx`. No member is spelled literally at any call site, so a
 * future reverse sweep reading only literal arguments is precisely where these
 * would look dead. They are the live half of the same namespace and are pinned
 * by name here.
 */
const TYPE_CATEGORY = [
  'appDesigner.fieldDesigner.typeCategory.text',
  'appDesigner.fieldDesigner.typeCategory.number',
  'appDesigner.fieldDesigner.typeCategory.date',
  'appDesigner.fieldDesigner.typeCategory.choice',
  'appDesigner.fieldDesigner.typeCategory.relation',
  'appDesigner.fieldDesigner.typeCategory.advanced',
] as const;

describe('`appDesigner.fieldDesigner.formula` is retired from the ten packs (objectui#6310)', () => {
  it('covers all ten packs and a live `appDesigner.fieldDesigner` root', () => {
    // Guards the premise the rest of the file rests on: a pin that iterates an
    // empty pack list, or asserts absence inside a namespace that itself
    // vanished, is green for the wrong reason.
    expect(LANGS).toHaveLength(10);
    for (const lang of LANGS) {
      const root = at(builtInLocales[lang], 'appDesigner.fieldDesigner');
      expect(root, `${lang} lost the appDesigner.fieldDesigner root`).toBeDefined();
      expect(Object.keys(root as Record<string, unknown>).length, lang).toBeGreaterThanOrEqual(20);
    }
  });

  it('no pack defines the retired formula label', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      if (at(builtInLocales[lang], RETIRED) !== undefined) revived.push(`${lang} :: ${RETIRED}`);
    }
    // Named, not counted: a half-reverted retirement is repaired pack by pack.
    expect(
      revived,
      'The retired Field Designer formula label is back in a locale pack. It ' +
        'labelled a formula-expression textarea that objectui#6043 removed, so ' +
        'nothing reads it — and no other i18n gate can see a dead key return, ' +
        'because every one of them runs call site -> key (objectui#6310). If a ' +
        'formula control is being reintroduced to the Field Designer, author ' +
        'its label alongside the control rather than restoring this row. The ' +
        'live key for the surface that DOES author formula expressions is ' +
        '`designer.field.formula` in ' +
        'packages/app-shell/src/views/metadata-admin/i18n.ts — a different key, ' +
        'not this one.',
    ).toEqual([]);
  });

  it('the deletion swept around its neighbours', () => {
    for (const lang of LANGS) {
      for (const key of SURVIVING) {
        const value = at(builtInLocales[lang], key);
        expect(typeof value, `${lang} :: ${key}`).toBe('string');
        expect((value as string).length, `${lang} :: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every member of the dynamically built `typeCategory` family', () => {
    // `all-locales-key-parity` would be satisfied by all ten packs dropping a
    // member together, and no literal-argument scan can see these are read at
    // all. State the vocabulary here, by name, so the substitution cannot be
    // left pointing at a key nothing defines.
    const missing: string[] = [];
    for (const lang of LANGS) {
      for (const key of TYPE_CATEGORY) {
        if (typeof at(builtInLocales[lang], key) !== 'string') missing.push(`${lang} :: ${key}`);
      }
    }
    expect(
      missing,
      'a member of the `appDesigner.fieldDesigner.typeCategory.*` family is gone; ' +
        'FieldDesigner.tsx builds these keys by substitution, so the loss renders ' +
        'as a raw key in the type filter rather than failing any other gate',
    ).toEqual([]);
  });
});
