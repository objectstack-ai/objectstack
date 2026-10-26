/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11434 — the Field Designer's validation-rule labels are retired from
 * the ten packs.
 *
 * `appDesigner.fieldDesigner.validationRules` ('Validation Rules') and
 * `appDesigner.fieldDesigner.addRule` ('Add Rule') labelled an editor for
 * `DesignerFieldDefinition.validationRules` that was never built: no `t()` call
 * site asked for either (the reverse sweep `scripts/check-i18n-dead-keys.mjs`
 * listed both as NEEDS-REVIEW, their only other footprint the plugin-designer
 * defaults map), and objectui#11434 retired the member itself on both faces of
 * `@object-ui/types`. Both labels left every pack and that defaults map in the
 * same change.
 *
 * Why a pin: every other i18n gate runs call site → key, so none of them can see
 * a dead key come back (the reason `appDesigner-fieldDesigner-formula-retired-6310`
 * beside this file gives). The defaults-map half is held by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx` (objectui#4401):
 * a map row whose key the `en` pack lacks is red there, so re-adding the map row
 * alone fails that gate, and re-adding a pack key fails this one.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The retired leaves, named rather than counted. */
const RETIRED_VALIDATION_RULES_LABEL = 'appDesigner.fieldDesigner.validationRules';
const RETIRED_ADD_RULE_LABEL = 'appDesigner.fieldDesigner.addRule';

/**
 * Neighbours each confirmed live by a `t()` call site in `FieldDesigner.tsx`,
 * so a sweep that over-reached would land on them first.
 */
const SURVIVING = [
  'appDesigner.fieldDesigner.referenceTo',
  'appDesigner.fieldDesigner.defaultValue',
  'appDesigner.fieldDesigner.placeholder',
] as const;

describe('the Field Designer validation-rule labels are retired from the ten packs (objectui#11434)', () => {
  it('no pack defines either retired label', () => {
    expect(LANGS).toHaveLength(10);
    const revived: string[] = [];
    for (const lang of LANGS) {
      for (const key of [RETIRED_VALIDATION_RULES_LABEL, RETIRED_ADD_RULE_LABEL]) {
        if (at(builtInLocales[lang], key) !== undefined) revived.push(`${lang} :: ${key}`);
      }
    }
    expect(
      revived,
      'A retired Field Designer validation-rule label is back in a locale pack. It ' +
        'labelled an editor for `DesignerFieldDefinition.validationRules`, a member ' +
        'objectui#11434 retired on both faces: the spec refuses that spelling, and ' +
        'field bounds are `min` / `max` / `minLength` / `maxLength`. If such an editor ' +
        'is being built, author its labels alongside it rather than restoring these rows.',
    ).toEqual([]);
  });

  it('the deletion swept around its neighbours — the control', () => {
    for (const lang of LANGS) {
      for (const key of SURVIVING) {
        const value = at(builtInLocales[lang], key);
        expect(typeof value, `${lang} :: ${key}`).toBe('string');
        expect((value as string).length, `${lang} :: ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
