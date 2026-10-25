// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11909 — Studio's field-type catalog holds every field type the
 * installed `@objectstack/spec` declares, and none it does not.
 *
 * The catalog lacked `user`, `secret` and `record`. A field of one of those
 * types (the showcase declares all three) read "(not found)" in the field
 * inspector's Type control, and neither the Type control nor the canvas's
 * add-field palette offered them, so an author could not model an owner field
 * in Studio.
 *
 * `FieldTypeId` is the spec's `FieldType`, so type-check already refuses a
 * catalog missing a member. This pin is the test-time half. It reads the
 * spec's exported enum when it runs, never a list copied here, and fails naming
 * the type in either direction:
 *
 * - a spec type the catalog lacks: Studio shows such a field as "(not found)"
 *   and cannot add one;
 * - a catalog type the spec does not declare: Studio offers a type the spec's
 *   field schema refuses at save.
 *
 * It also pins what an entry needs beyond its row in `FIELD_TYPE_META`: a
 * category the pickers draw, and a name and a description row in both of the
 * designer's tables. Without the rows, `t()` hands back the key itself, which a
 * test comparing a rendered name against `t()` cannot tell from a real name.
 */

import { describe, it, expect } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import {
  CATEGORY_ORDER,
  FIELD_TYPE_META,
  TYPES_BY_CATEGORY,
  resolveFieldTypeMeta,
} from './field-types';
import { t } from '../i18n';

const SPEC_TYPES: readonly string[] = FieldType.options;
const CATALOG_TYPES = Object.keys(FIELD_TYPE_META);
const OFFERED = TYPES_BY_CATEGORY.flatMap((g) => g.types as string[]);

describe('the field-type catalog matches the spec\'s FieldType (objectui#11909)', () => {
  it('reads its population from the installed spec, and that population is not empty', () => {
    // Lit control: an empty or unrelated enum would make both directions below
    // pass on nothing.
    expect(SPEC_TYPES.length).toBeGreaterThan(0);
    expect(SPEC_TYPES).toContain('lookup');
  });

  it('lists every field type the spec declares', () => {
    const missing = SPEC_TYPES.filter((id) => !CATALOG_TYPES.includes(id));
    expect(missing, 'spec field types the catalog lacks').toEqual([]);
  });

  it('lists no field type the spec does not declare', () => {
    const extra = CATALOG_TYPES.filter((id) => !SPEC_TYPES.includes(id));
    expect(extra, 'catalog types the spec does not declare').toEqual([]);
  });

  it('keys each entry by its own id', () => {
    const misKeyed = CATALOG_TYPES.filter(
      (key) => FIELD_TYPE_META[key as keyof typeof FIELD_TYPE_META].id !== key,
    );
    expect(misKeyed).toEqual([]);
  });

  it('the pickers offer every spec type exactly once, each under a category they draw', () => {
    expect([...OFFERED].sort()).toEqual([...SPEC_TYPES].sort());
    expect(new Set(OFFERED).size, 'a type offered twice').toBe(OFFERED.length);
    for (const g of TYPES_BY_CATEGORY) expect(CATEGORY_ORDER).toContain(g.category);
  });

  it('every type has a name row and a description row in both designer tables', () => {
    const missing: string[] = [];
    for (const id of SPEC_TYPES) {
      for (const key of [`engine.fieldType.${id}`, `engine.fieldTypeDesc.${id}`]) {
        for (const locale of ['en-US', 'zh-CN'] as const) {
          if (t(key, locale) === key) missing.push(`${locale} ${key}`);
        }
      }
    }
    expect(missing, 'rows the designer tables lack').toEqual([]);
  });

  it('user, secret and record resolve to their own entries, not to the unknown-type fallback', () => {
    for (const id of ['user', 'secret', 'record']) {
      expect(resolveFieldTypeMeta(id).id, id).toBe(id);
    }
    // Lit control: a type the spec does not declare still takes the fallback.
    expect(resolveFieldTypeMeta('legacy_widget')).toMatchObject({ id: 'text', label: 'legacy_widget' });
  });
});
