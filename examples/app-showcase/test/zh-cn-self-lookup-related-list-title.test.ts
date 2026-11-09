// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under zh-CN, the title of a self-lookup's related list is served translated.
 *
 * `showcase_business_unit.parent` points back at the same object, so a unit's
 * record page lists its child units. The console derives that list (the side
 * card, or the body table of a `relatedList: 'primary'` list) from the served
 * CHILD field's `relatedListTitle`, read off `GET /meta/object`; with no
 * translatable title it was headed by the object's own label, the same word
 * as the record it sits beside. So the pin is the translator applied to the
 * app's own object with the app's own bundle, exactly what the REST boundary
 * does per request locale.
 */
import { describe, expect, it } from 'vitest';
import { translateMetadataDocument, type TranslationBundle } from '@objectstack/spec/system';
import { BusinessUnit } from '../src/data/objects/business-unit.object.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

const bundle = ShowcaseTranslationBundle as unknown as TranslationBundle;

describe('showcase under zh-CN — a self-lookup\'s related-list title', () => {
  it('is a lookup from the object back to itself that authors a title', () => {
    const parent = BusinessUnit.fields.parent as Record<string, unknown>;
    expect(parent.type).toBe('lookup');
    expect(parent.reference).toBe(BusinessUnit.name);
    expect(parent.relatedListTitle).toBe('Sub-units');
  });

  it('serves the title translated, distinct from the object\'s own translated label', () => {
    const out = translateMetadataDocument('object', BusinessUnit, bundle, { locale: 'zh-CN' });
    expect(out.fields.parent.relatedListTitle).toBe('下级单元');
    expect(out.label).toBe('业务单元');
  });

  it('leaves the authored English in place for a locale the bundle does not carry', () => {
    const out = translateMetadataDocument('object', BusinessUnit, bundle, { locale: 'en' });
    expect(out.fields.parent.relatedListTitle).toBe('Sub-units');
  });
});
